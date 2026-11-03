#!/usr/bin/env python3
"""Warmup global curve - consolidated daily stats for the warmup games.

Design rules (deliberate):
- stdlib only; binds to 127.0.0.1 by default
- keeps ONLY consolidated numbers per (game, day): n, sum, sumsq, min, max,
  and a small fixed histogram. No per-player records. No names. No text.
- fresh-day counting: a submission only tallies the live curve when it is
  for the current day's puzzle. Stale-day submissions are answered from
  the frozen archive and change nothing; future days are rejected. Only the
  people who played the puzzle while it was fresh shape the day's weights
- the archive handoff: on the first request after midnight ET (and once
  more on shutdown), each finished day's numbers collapse into a small
  static snapshot at <archive-dir>/<game>/<day>.json - how many played,
  the score distribution, and the aggregates needed to rebuild the
  weights. Written once, read-only forever. Each snapshot also records
  the edges and direction it was tallied under, so history keeps serving
  faithfully even if the manifest moves. This is the only disk write
  anywhere in the service
- warm start: on boot, today's archived partial board (a mid-day restart
  flushed it) returns to the live curve together with its dedupe set, so
  a compose update or a host reboot neither resets nor re-opens the day
- client ids are hashed to 8 bytes and kept in a per-day dedupe set that
  travels with the archive snapshot: the first submission of the day
  stands, reloads get a personalized reply but do not retally, and a
  mid-day restart restores the set so revisits cannot re-open the day
- per-IP daily request caps keep scripted flooding from doing damage:
  /health is exempt (the container healthcheck must never trip them) and
  the caps sit orders of magnitude above human play
- input is strictly validated: game must be in the fixed allowlist below,
  day/value are bounded numbers, bodies are capped at 2 KB, and no user
  text is accepted or stored anywhere
- dealt play (1.2) is per-SESSION, never per-PLAYER: an in-memory nonce map
  (game, day, counters - no identity attached) that is purged at the day
  rollover, on TTL, and when a round ends. It exists so answers can stop
  shipping to the client (rounds computes hotter/colder server-side) and so
  a clock can be stamped where it cannot be edited (sprint's starting gun).
  The consolidated-numbers privacy stance survives: a session is a random
  token, not a person

Endpoints (with or without the /api prefix):
    POST /submit   {"game", "day", "value", "id"}   -> personalized snapshot
                   {"game", "day", "id", "status", "answer", "meta"} -> evidence in,
                   points out (gated games: the answer is checked against the day's
                   key and the score derived server-side; self-reported value posts
                   are accepted only for the generator games)
    POST /deal    {"game", "day"}                  -> open a dealt session (live day only; the rounds deal carries the puzzle without its key)
    POST /guess   {"nonce", "y"}                     -> the rounds verdict with server-side heat (the distance never crosses the wire)
    POST /reveal  {"nonce"}                          -> the sprint starting gun (t0 stamped once, never reset; the window is enforced at submit)
    GET  /dist?game=&day=[&v=]                     -> snapshot (today live, past days from the archive; v personalizes without tallying)
    GET  /puzzle?game=&day=                         -> the day's puzzle (rounds on the live
                   day ships no key: dealt play owns the live round)
    GET  /manifest                                  -> the scoring manifest (epoch, tz, ledger)
    GET  /health                                    -> {"ok": true, "day", "num"}

Cache policy (deliberate): live numbers (/submit, /dist, /health) are
no-store; the day's puzzle is immutable so it is public and cacheable
until the next ET midnight; the manifest is cacheable for an hour.
"""
import argparse
import hashlib
import json
import math
import re
import secrets
import signal
import threading
import time
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None

MAX_BODY = 2048
MAX_ABS_VALUE = 1e6
DAY_MIN, DAY_MAX = -1000, 100000
ARCHIVE_DIR = Path(__file__).parent / 'archive'

# Per-IP daily caps (DoS damping). Human play is a few dozen requests a
# day even across every game; these sit far above that and exist only to
# stop scripted flooding. Counts reset with the ET day and the map is
# pruned if it ever grows past a fixed bound.
MAX_GETS_PER_IP = 10000
MAX_POSTS_PER_IP = 300
IP_HITS = {}   # ip -> [day, gets, posts, dealt]

# Per-game truth: which direction is better, and the fixed histogram edges.
# Bin i covers [edges[i], edges[i+1]); values beyond the last edge clamp into
# the final bin, values below the first edge clamp into bin 0.
# "better" lives here, server-side - the client never decides it.
# The truth itself lives in manifest.json (timezone, epoch, and one spec per
# game). server.py loads it at boot, the client pages carry the same
# timezone/epoch inline for offline play, and CI cross-checks both sides
# against the manifest so neither can drift.
with open(Path(__file__).parent / 'manifest.json', encoding='utf-8') as _mf:
    _MANIFEST = json.load(_mf)
TZ_NAME = _MANIFEST['tz']
EPOCH_KEY = _MANIFEST['epoch']
SPECS = _MANIFEST['games']
# Per-game puzzle stores: puzzles/<game>/puzzles.json at the repo root,
# committed and verified against the client banks by tools/export-puzzles.mjs
# in CI. Generator games keep an empty store (their puzzles are derived,
# not curated). The container copies them to ./puzzles next to server.py;
# a local run finds them at ../puzzles - the first existing one wins.
PUZZLES = {}
PUZZLES_DIR = next((p for p in (
    Path(__file__).parent / 'puzzles',
    Path(__file__).parent.parent / 'puzzles') if p.is_dir()),
    Path(__file__).parent / 'puzzles')
for game in SPECS.keys():
    game_file = PUZZLES_DIR / game / 'puzzles.json'
    try:
        with game_file.open(encoding='utf-8') as f:
            PUZZLES[game] = json.load(f)
    except FileNotFoundError:
        PUZZLES[game] = []

STATS = {}   # (game, day) -> {"n", "sum", "sumsq", "min", "max", "bins": [ints]}
SEEN = {}    # (game, day) -> set of 8-byte id digests (transient dedupe only)
LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Evidence-based validation (1.1): the server already holds the day's
# answer key - the committed puzzle stores the /puzzle endpoint serves
# from - so a gated game's submission can carry the proposed answer and
# the raw play facts instead of a self-reported score. The server checks
# the answer, enforces the per-game meta caps, derives the points itself,
# and holds the loss rule (a loss or a give-up is 0 no matter the meta).
# Self-reported "value" posts are generator-only: the gated games refuse
# them outright. The generator games (rings, trace, grid) have no answer
# key by design - their puzzles are derived at play time, not curated -
# and sprint, the fourth generator, now rides a dealt clock instead.
# ---------------------------------------------------------------------------

EVIDENCE_GAMES = (
    "bogus", "well-actually", "fermi", "brunch", "superlative",
    "rounds", "museum", "sift", "lightbox", "cipher", "timeline", "thread",
)

# per-game meta caps on the won path: key, lo, hi
META_CAPS = {
    "rounds":   (("guesses", 1, 6),),
    "museum":   (("clues", 1, 5),),
    "sift":     (("mistakes", 0, 4),),
    "lightbox": (("mistakes", 0, 4),),
    "cipher":   (("hints", 0, 5),),
    "timeline": (("checks", 1, 999),),
    "thread":   (("checks", 1, 999),),
}


# ---------------------------------------------------------------------------
# Dealt play (1.2): the server deals the round and keeps the truth. A dealt
# session is a random nonce over an in-memory map - no identity, no disk, no
# player records - purged at the day rollover, on TTL, and when the round
# ends. Dealt traffic is per-action (a session can need a dozen calls), so it
# rides its own tighter per-IP daily cap, separate from /submit's.
# The residual honesty note: a loss reveal hands the player the key they
# failed to find, and a generator's solved count is still the client's word
# inside the server-stamped window - closing those needs the answers dealt
# per solve, which is the next phase, not this one.
# ---------------------------------------------------------------------------

DEALT_GAMES = ("rounds", "sprint")
SESSIONS = {}        # nonce -> {"game", "day", "created", "ip", "guesses",
                    #            "done", "verdict", "t0"}
MAX_DEALT_PER_IP = 400    # per-IP daily cap across /deal, /guess, /reveal
SPRINT_WINDOW = 90.0      # the sprint round is this many seconds, server clock
SPRINT_GRACE = 10.0       # network lag allowance on the window check
SPRINT_PURGE = 150.0      # t0 + this is when an unsubmitted round is reaped
SESSION_TTL = 1800.0      # housekeeping horizon for any dealt session


def purge_sessions(now=None):
    """Reclaim dealt sessions. Caller holds LOCK. A session dies when the
    day rolls over (dealt play is for the live day), when it ages past the
    TTL, when a sprint round is long over, or when a finished round has
    been submitted against. A purged sprint session is over for good: a
    later submit naming it derives 0, so the clock cannot be re-entered."""
    now = time.time() if now is None else now
    today = current_day_index()
    for nonce in list(SESSIONS):
        s = SESSIONS[nonce]
        if s["day"] != today:
            del SESSIONS[nonce]
        elif now - s["created"] > SESSION_TTL:
            del SESSIONS[nonce]
        elif (s["game"] == "sprint" and s["t0"] is not None
                and now - s["t0"] > SPRINT_PURGE):
            del SESSIONS[nonce]
        elif s["done"] and now - s.get("done_at", s["created"]) > 300:
            del SESSIONS[nonce]


def round_feedback(y, key):
    """Rounds hotter/colder, server-side: the distance in years never
    crosses the wire - only the heat bucket and the direction hint the
    page has always shown. A port of the client's heatOf/hintOf; the solo
    offline path keeps its own copy."""
    off = abs(y - key)
    if off <= 2:
        heat, sq = "scalding", "\U0001F7E9"
    elif off <= 5:
        heat, sq = "hot", "\U0001F7E8"
    elif off <= 15:
        heat, sq = "warm", "\U0001F7E7"
    else:
        heat, sq = "cold", "\U0001F7E5"
    parts = ["go earlier" if y > key else "go later"]
    if y // 100 != key // 100:
        parts.append("wrong century")
    elif y // 10 == key // 10:
        parts.append("right decade")
    return {"heat": heat, "sq": sq, "hint": " \u00b7 ".join(parts)}


def _text_norm(s):
    """The well-actually page's normalization of a typed correction:
    lowercase, punctuation to spaces, collapsed, leading 'the ' dropped."""
    s = re.sub(r"[.,!?;:'\u2019\u201c\u201d\"]", " ", str(s).lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[4:] if s.startswith("the ") else s


def _name_norm(s):
    """Museum-grade name matching: lowercase, punctuation dropped (an
    apostrophe vanishes instead of spacing), collapsed, leading 'the ' off."""
    s = re.sub(r"[^\w\s]", "", str(s).lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[4:] if s.startswith("the ") else s


def _alnum_norm(s):
    """Cipher-grade comparison: uppercase alphanumerics only."""
    return "".join(ch for ch in str(s).upper() if ch.isalnum())


def _meta_int(meta, key, lo, hi):
    v = meta.get(key)
    if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi):
        return None
    return v


def _list_entry(game, day):
    """The day's answer-key entry for a list-store game (the same entry the
    /puzzle endpoint serves)."""
    store = PUZZLES.get(game)
    if isinstance(store, list) and store:
        return store[day % len(store)]
    return None


def validate_evidence(game, day, body):
    """Check a gated game's evidence against the day's answer key and derive
    the points. Returns (points, None) on success, (None, reason) otherwise.
    The client never names a number: every point is computed here."""
    status = body.get("status")
    if status not in ("won", "lost", "gave"):
        return None, "bad status"
    if status != "won" and game not in ("fermi", "superlative"):
        # a loss or a give-up is 0 points no matter what the meta says,
        # and it never needs meta at all - a real loss (sift's fourth
        # mistake) must never trip a cap and go uncounted
        return 0, None
    meta = body.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    for key, lo, hi in META_CAPS.get(game, ()):
        if _meta_int(meta, key, lo, hi) is None:
            return None, "bad meta"
    ans = body.get("answer")

    if game == "bogus":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if not isinstance(ans, list) or not ans or len(ans) > 3 \
                or not all(isinstance(p, int) and not isinstance(p, bool)
                           and 0 <= p < len(e["s"]) for p in ans):
            return None, "bad answer"
        if e["l"] not in ans:
            return None, "wrong answer"
        return max(0, 3 - sum(1 for p in ans if p != e["l"])), None

    if game == "well-actually":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        picks = ans.get("picks") if isinstance(ans, dict) else None
        typed = ans.get("typed") if isinstance(ans, dict) else None
        if not isinstance(picks, list) or not picks or len(picks) > 3 \
                or not all(isinstance(p, int) and not isinstance(p, bool)
                          and 0 <= p < len(e["s"]) for p in picks):
            return None, "bad answer"
        if e["l"] not in picks:
            return None, "wrong answer"
        pts = max(0, 3 - sum(1 for p in picks if p != e["l"]))
        if isinstance(typed, str) and len(typed) <= 200 \
                and _text_norm(typed) in (_text_norm(x) for x in e["a"]):
            pts += 1
        return pts, None

    if game == "fermi":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if isinstance(ans, bool) or not isinstance(ans, (int, float)) \
                or not math.isfinite(ans) or ans <= 0:
            return None, "bad answer"
        ratio = max(ans / e["a"], e["a"] / ans)
        return (3 if ratio <= 3 else 2 if ratio <= 10
                else 1 if ratio <= 100 else 0), None

    if game == "brunch":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if isinstance(ans, bool) or not isinstance(ans, int) \
                or not (0 <= ans < len(e["opts"])):
            return None, "bad answer"
        if ans != e["a"]:
            return None, "wrong answer"
        return 1, None

    if game == "superlative":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if not isinstance(ans, list) or len(ans) != len(e["q"]) \
                or not all(isinstance(p, int) and not isinstance(p, bool)
                           and 0 <= p < len(e["m"]) for p in ans):
            return None, "bad answer"
        return sum(1 for p, q in zip(ans, e["q"]) if p == q["a"]), None

    if game == "rounds":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if isinstance(ans, bool) or not isinstance(ans, int) or ans != e["y"]:
            return None, "wrong answer"
        return max(0, 4 - meta["guesses"]), None

    if game == "museum":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if not isinstance(ans, str) or not ans or len(ans) > 200:
            return None, "bad answer"
        names = [_name_norm(x) for x in [e["a"]] + list(e.get("al") or ())]
        if _name_norm(ans) not in names:
            return None, "wrong answer"
        return max(0, 4 - meta["clues"]), None

    if game == "sift":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if not isinstance(ans, list) or len(ans) != len(e["cats"]) \
                or not all(isinstance(g, list) and g
                           and all(isinstance(x, str) for x in g) for g in ans):
            return None, "bad answer"
        want = [frozenset(c["i"]) for c in e["cats"]]
        got = [frozenset(g) for g in ans]
        if frozenset(want) != frozenset(got):
            return None, "wrong answer"
        return max(0, 3 - meta["mistakes"]), None

    if game == "lightbox":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if not isinstance(ans, list) or len(ans) != len(e["g"]) \
                or not all(isinstance(r, str) and r for r in ans):
            return None, "bad answer"
        norm = lambda rows: ["".join(ch for ch in row.upper() if ch in "#.")
                             for row in rows]
        if norm(ans) != norm(e["g"]):
            return None, "wrong answer"
        return max(0, 3 - meta["mistakes"]), None

    if game == "cipher":
        e = _list_entry(game, day)
        if e is None:
            return None, "no answer key"
        if not isinstance(ans, str) or not ans or len(ans) > 500:
            return None, "bad answer"
        if _alnum_norm(ans) != _alnum_norm(e["q"]):
            return None, "wrong answer"
        return max(0, 3 - meta["hints"]), None

    if game == "timeline":
        store = PUZZLES.get(game)
        picks = store.get("picks") if isinstance(store, dict) else None
        if not isinstance(picks, list) or not (0 <= day < len(picks)):
            return None, "no answer key"
        years = sorted(store["bank"][i]["y"] for i in picks[day])
        if not isinstance(ans, list) or len(ans) != len(years) \
                or not all(isinstance(y, int) and not isinstance(y, bool)
                           for y in ans) or ans != years:
            return None, "wrong answer"
        return max(0, 4 - meta["checks"]), None

    if game == "thread":
        store = PUZZLES.get(game)
        picks = store.get("picks") if isinstance(store, dict) else None
        if not isinstance(picks, list) or not (0 <= day < len(picks)):
            return None, "no answer key"
        pk = picks[day]
        chain = [pk["s"]] + list(pk["m"]) + [pk["e"]]
        if ans != chain:
            return None, "wrong answer"
        return max(0, 4 - meta["checks"]), None

    return None, "no evidence path"


def bin_index(value, edges):
    n = len(edges) - 1
    if value < edges[0]:
        return 0
    for i in range(n):
        if value < edges[i + 1]:
            return i
    return n - 1


def current_day_index():
    """Days since the epoch, clamped at 0: before launch the index never goes
    negative, matching shell/common.js, so the pre-launch weekend serves
    No. 1 and those plays tally into the launch day's board."""
    try:
        tz = ZoneInfo(TZ_NAME) if ZoneInfo else None
    except Exception:
        tz = None
    today = datetime.now(tz).date() if tz else date.today()
    epoch = date.fromisoformat(EPOCH_KEY)
    return max(0, (today - epoch).days)


def seconds_to_midnight():
    """Seconds until the next ET midnight - the puzzle cache horizon: the
    day's puzzle is immutable, so it can be cached right up to rollover."""
    try:
        tz = ZoneInfo(TZ_NAME) if ZoneInfo else None
    except Exception:
        tz = None
    now = datetime.now(tz)
    nxt = datetime.combine(now.date() + timedelta(days=1), datetime.min.time())
    if tz:
        nxt = nxt.replace(tzinfo=tz)
    return int(max(60, min((nxt - now).total_seconds(), 86400)))


def day_date(day):
    """The ET date a day index refers to (for the archive labels)."""
    return (date.fromisoformat(EPOCH_KEY) + timedelta(days=day)).isoformat()


def archive_path(game, day):
    return ARCHIVE_DIR / game / ("%d.json" % day)


def write_archive(game, day):
    """Collapse one finished day's live numbers into a static snapshot.

    Written once and then read-only: if a snapshot already exists (a mid-day
    restart archived a partial day), only a strictly larger tally replaces
    it. The day's dedupe set rides along with the numbers so a warm start
    can never re-open the day. A failed write must never take the service
    down.

    Returns True when a snapshot is on disk, False when there is nothing to
    write or an existing snapshot already covers the tally (either way the
    live board is safe to drop), and None only when the write itself
    failed: the caller must keep the live board so the next flush retries
    instead of silently losing the day.
    """
    st = STATS.get((game, day))
    if not st or st["n"] == 0:
        return False
    p = archive_path(game, day)
    if p.exists():
        try:
            with p.open(encoding='utf-8') as f:
                old = json.load(f)
            if old.get("n", 0) >= st["n"]:
                return False
        except (OSError, ValueError):
            pass  # unreadable snapshot: the live board is the better truth
    payload = {
        "game": game, "day": day, "date": day_date(day),
        "n": st["n"], "sum": st["sum"], "sumsq": st["sumsq"],
        "min": st["min"], "max": st["max"], "bins": st["bins"],
        "seen": sorted(SEEN.get((game, day), ())),
        "edges": SPECS[game]["edges"], "better": SPECS[game]["better"],
    }
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(payload, indent=2) + "\n", encoding='utf-8')
        return True
    except OSError:
        return None


def load_archive(game, day):
    p = archive_path(game, day)
    try:
        with p.open(encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def archived_stats(rec):
    """An archive record reshaped into the live STATS board format."""
    if not rec:
        return None
    return {"n": rec["n"], "sum": rec["sum"], "sumsq": rec["sumsq"],
            "min": rec["min"], "max": rec["max"], "bins": rec["bins"]}


def archived_spec(rec, game):
    """The spec a snapshot was recorded under. A finished day is frozen
    truth: it keeps serving its own edges and direction even if the
    manifest moved on afterwards, so an edges change can never crash or
    silently re-label history."""
    if isinstance(rec, dict) and isinstance(rec.get("edges"), list) \
            and len(rec["edges"]) >= 2 and rec.get("better") in ("low", "high"):
        return {"edges": rec["edges"], "better": rec["better"]}
    return SPECS[game]


def fit_bins(bins, edges):
    """Counts fitted to a spec's bins: truncated or zero-padded, never an
    index error, whatever shape the board was recorded in."""
    n = len(edges) - 1
    out = list(bins)[:n]
    out.extend([0] * (n - len(out)))
    return out


def flush_stale(force=False):
    """Hand finished days to the archive: snapshot once, then drop the board.

    Runs lazily on every request (so the first request after midnight ET
    settles yesterday cleanly), and forced on shutdown (so a restart does
    not silently drop the partial day). A board whose snapshot write
    failed stays in memory: the next flush retries it, so a full disk
    costs a delayed archive, not the day's numbers.
    """
    today = current_day_index()
    for key in list(STATS.keys()):
        game, day = key
        if day == today and not force:
            continue
        ok = write_archive(game, day)
        if ok:
            print("archived %s day %d (%d plays)" % (game, day, STATS[key]["n"]), flush=True)
        if ok is None:
            # the snapshot write failed (full disk, lost mount): keep the
            # live board and its dedupe set so the next flush retries and
            # stale submits still get answered, instead of losing the day
            continue
        del STATS[key]
        SEEN.pop(key, None)


def tally(game, day, value, digest):
    """Add one result unless this id already submitted today. Returns counted."""
    key = (game, day)
    st = STATS.get(key)
    if st is None:
        edges = SPECS[game]["edges"]
        st = {"n": 0, "sum": 0.0, "sumsq": 0.0, "min": value, "max": value,
              "bins": [0] * (len(edges) - 1)}
        STATS[key] = st
    seen = SEEN.get(key)
    if seen is None:
        seen = set()
        SEEN[key] = seen
    counted = digest not in seen
    if counted:
        seen.add(digest)
        st["n"] += 1
        st["sum"] += value
        st["sumsq"] += value * value
        st["min"] = min(st["min"], value)
        st["max"] = max(st["max"], value)
        if len(st["bins"]) != len(SPECS[game]["edges"]) - 1:
            # a board inherited in another shape (a manifest change): the
            # recorded bins are not comparable, so the histogram restarts
            st["bins"] = [0] * (len(SPECS[game]["edges"]) - 1)
        st["bins"][bin_index(value, SPECS[game]["edges"])] += 1
    return counted


def beat_estimate(value, st, spec):
    """Roughly how many counted entries this value ranks strictly better than.

    Outside my own bin this is exact. Inside my bin we assume a uniform
    spread - except for width <= 1 bins, which hold a single integer score,
    so everyone in them ties and none of them count as beaten.
    """
    edges = spec["edges"]
    i = bin_index(value, edges)
    own = max(0, st["bins"][i] - 1)
    width = edges[i + 1] - edges[i]
    if spec["better"] == "high":
        outside = sum(st["bins"][:i])
        frac = (value - edges[i]) / width if width > 1 else 0.0
        return int(outside + max(0.0, min(1.0, frac)) * own)
    outside = sum(st["bins"][i + 1:])
    frac = (edges[i + 1] - value) / width if width > 1 else 0.0
    return int(outside + max(0.0, min(1.0, frac)) * own)


def snapshot(game, day, value=None, st=None, spec=None):
    spec = spec if spec is not None else SPECS[game]
    edges = spec["edges"]
    nbins = len(edges) - 1
    if st is None:
        st = STATS.get((game, day))
    you_bin = bin_index(value, edges) if value is not None else None
    bins = [{"lo": edges[i], "hi": edges[i + 1], "count": 0, "you": False}
            for i in range(nbins)]
    if not st or st["n"] == 0:
        return {"count": 0, "beat": None, "mean": None, "bins": bins,
                "better": spec["better"]}
    # whatever shape the board was recorded in, the response can never
    # crash: counts are fitted to the bins being served
    counts = fit_bins(st["bins"], edges)
    for i in range(nbins):
        bins[i]["count"] = counts[i]
        bins[i]["you"] = (i == you_bin)
    mean = st["sum"] / st["n"]
    beat = beat_estimate(value, dict(st, bins=counts), spec) if value is not None else None
    return {"count": st["n"], "beat": beat, "mean": round(mean, 2),
            "bins": bins, "better": spec["better"]}


class Handler(BaseHTTPRequestHandler):
    server_version = "warmup-curve/4.3"

    def log_message(self, fmt, *args):
        pass  # nothing is logged anywhere, on purpose

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload, status=200, cache="no-store"):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _path(self):
        p = urlparse(self.path).path
        if p.startswith("/api/"):
            p = p[len("/api"):]
        if len(p) > 1:
            p = p.rstrip("/")
        return p or "/"

    def _rate_ok(self, kind):
        """Count one request per client IP for the ET day; True if under cap."""
        ip = self.client_address[0]
        today = current_day_index()
        with LOCK:
            rec = IP_HITS.get(ip)
            if rec is None or rec[0] != today:
                if len(IP_HITS) > 100000:
                    for k in [k for k, v in IP_HITS.items() if v[0] != today]:
                        IP_HITS.pop(k, None)
                rec = [today, 0, 0, 0]
                IP_HITS[ip] = rec
            idx = {"get": 1, "post": 2, "dealt": 3}[kind]
            rec[idx] += 1
            cap = {"get": MAX_GETS_PER_IP, "post": MAX_POSTS_PER_IP,
                   "dealt": MAX_DEALT_PER_IP}[kind]
            return rec[idx] <= cap

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self._path()
        if path != "/health" and not self._rate_ok("get"):
            self._json({"error": "too many requests"}, 429)
            return
        if path == "/health":
            today = current_day_index()
            with LOCK:
                # day/num echo the clamped day math, so a curl shows exactly
                # what the server thinks "today" is
                payload = {"ok": True, "boards": len(STATS),
                           "day": today, "num": today + 1}
            self._json(payload)
        elif path == "/manifest":
            # the scoring truth (epoch, tz, per-game ledger) as plain JSON
            self._json(_MANIFEST, cache="public, max-age=3600")
        elif path in ("/dist", "/distribution"):
            qs = parse_qs(urlparse(self.path).query)
            game = (qs.get("game") or [""])[0]
            if game not in SPECS:
                self._json({"error": "unknown game"}, 400)
                return
            try:
                day = int((qs.get("day") or ["0"])[0])
            except ValueError:
                self._json({"error": "bad day"}, 400)
                return
            if not (DAY_MIN <= day <= DAY_MAX):
                self._json({"error": "bad day"}, 400)
                return
            # optional value: a revisit that already synced for the day
            # fetches its personalized snapshot here without tallying
            value = None
            raw_v = (qs.get("v") or [None])[0]
            if raw_v is not None:
                try:
                    value = float(raw_v)
                except ValueError:
                    self._json({"error": "bad value"}, 400)
                    return
                if not math.isfinite(value) or abs(value) > MAX_ABS_VALUE:
                    self._json({"error": "bad value"}, 400)
                    return
            today = current_day_index()
            with LOCK:
                flush_stale()
                if day > today:
                    self._json({"error": "future day not available"}, 403)
                    return
                if day == today:
                    payload = snapshot(game, day, value)
                else:
                    rec = load_archive(game, day)
                    payload = snapshot(game, day, value, st=archived_stats(rec),
                                       spec=archived_spec(rec, game))
                    payload["archived"] = True
            self._json(payload)
        elif path == "/puzzle":
            qs = parse_qs(urlparse(self.path).query)
            game = (qs.get("game") or [""])[0]
            if game not in PUZZLES:
                self._json({"error": "unknown game"}, 400)
                return
            try:
                day = int((qs.get("day") or ["0"])[0])
            except ValueError:
                self._json({"error": "bad day"}, 400)
                return
            if not (DAY_MIN <= day <= DAY_MAX):
                self._json({"error": "bad day"}, 400)
                return
            today = current_day_index()
            if day > today:
                self._json({"error": "future day not available"}, 403)
                return
            entry = PUZZLES[game]
            if game == "thread":
                # thread: picks index the graph bank; the served puzzle carries
                # the start, the end, the chain, the decoys, and the links
                picks = entry["picks"]
                if day < 0 or day >= len(picks):
                    self._json({"error": "no puzzles"}, 404)
                    return
                bank = entry["bank"]
                nodes = {nd["id"]: nd for nd in bank["nodes"]}
                emap = {}
                for ed in bank["edges"]:
                    emap.setdefault(ed["a"], {})[ed["b"]] = ed
                    emap.setdefault(ed["b"], {})[ed["a"]] = ed
                pk = picks[day]
                seq = [pk["s"]] + list(pk["m"]) + [pk["e"]]
                links = [emap[a][b] for a, b in zip(seq, seq[1:])]
                self._json({"game": game, "day": day, "today": today,
                            "puzzle": {"s": nodes[pk["s"]], "e": nodes[pk["e"]],
                                       "m": [nodes[i] for i in pk["m"]],
                                       "d": [nodes[i] for i in pk["d"]],
                                       "links": links}},
                           cache="public, max-age=%d" % seconds_to_midnight())
            elif isinstance(entry, dict) and "picks" in entry:
                # windowed game: precomputed picks into the bank (timeline)
                picks = entry["picks"]
                if day < 0 or day >= len(picks):
                    self._json({"error": "no puzzles"}, 404)
                    return
                bank = entry["bank"]
                events = [bank[i] for i in picks[day]]
                self._json({"game": game, "day": day, "puzzle": {"events": events}, "today": today},
                           cache="public, max-age=%d" % seconds_to_midnight())
            else:
                if not entry:
                    self._json({"error": "no puzzles"}, 404)
                    return
                idx = day % len(entry)
                pz = entry[idx]
                # the dealt cutover: rounds is played server-dealt on the live
                # day, so today's puzzle ships without its key - the round
                # lives in /deal and /guess. A replayed day is long over, so
                # its key stays and the archive path keeps grading locally.
                if game == "rounds" and day == today:
                    pz = {k: v for k, v in pz.items() if k not in ("y", "w")}
                self._json({"game": game, "day": day, "puzzle": pz, "today": today},
                           cache="public, max-age=%d" % seconds_to_midnight())
        else:
            self._json({"error": "not found"}, 404)

    def _read_json(self):
        """One bounded body read for every POST path: the length cap is the
        flood dam, the json and type checks keep every handler honest."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._json({"error": "bad length"}, 400)
            return None
        if length <= 0 or length > MAX_BODY:
            self._json({"error": "bad length"}, 413)
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json({"error": "bad body"}, 400)
            return None
        if not isinstance(data, dict):
            self._json({"error": "bad body"}, 400)
            return None
        return data

    def do_POST(self):
        path = self._path()
        if path not in ("/submit", "/deal", "/guess", "/reveal"):
            self._json({"error": "not found"}, 404)
            return
        # dealt play is per-action traffic (a session can need a dozen
        # calls), so it rides its own tighter per-IP daily cap
        if not self._rate_ok("post" if path == "/submit" else "dealt"):
            self._json({"error": "too many requests"}, 429)
            return
        data = self._read_json()
        if data is None:
            return
        if path == "/submit":
            self._submit(data)
        else:
            self._dealt(path, data)

    def _submit(self, data):
        game = data.get("game")
        if not isinstance(game, str) or game not in SPECS:
            self._json({"error": "unknown game"}, 400)
            return
        day = data.get("day")
        if isinstance(day, bool) or not isinstance(day, int) or not (DAY_MIN <= day <= DAY_MAX):
            self._json({"error": "bad day"}, 400)
            return
        if "answer" in data or "status" in data:
            # evidence path: the answer and the raw play facts come in,
            # the points come out - the client never names a number
            if game not in EVIDENCE_GAMES:
                self._json({"error": "evidence not accepted for this game"}, 400)
                return
            # a dealt session is the stronger claim: the server counted the
            # guesses and knows the verdict, so a nonce-bearing post reports
            # the session's facts, never the client's word. An unknown or
            # aged nonce is simply absent - the checks below stay as the
            # fallback for a session that dropped mid-game
            if isinstance(data.get("nonce"), str):
                with LOCK:
                    purge_sessions()
                    sess = SESSIONS.pop(data["nonce"], None)
                if (sess and sess["game"] == game and sess["day"] == day
                        and sess["done"]):
                    data = dict(data)
                    data["status"] = sess["verdict"]
                    data["meta"] = {"guesses": sess["guesses"]}
            value, reason = validate_evidence(game, day, data)
            if value is None:
                self._json({"error": reason}, 422)
                return
        else:
            if game in EVIDENCE_GAMES:
                # the cutover: a gated game no longer accepts a self-reported
                # score - the answer and the play facts come in, and the
                # points are derived here or not counted at all
                self._json({"error": "value posts retired for this game - send evidence"}, 400)
                return
            value = data.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)) \
                    or not math.isfinite(value) or abs(value) > MAX_ABS_VALUE:
                self._json({"error": "bad value"}, 400)
                return
            # a dealt sprint session owns the clock: a claimed score only
            # stands if the server-stamped window says it could have
            # happened. A session that was never started, or aged past the
            # window, is over - the claim derives 0 and the nonce can
            # never re-enter the window
            if game == "sprint" and isinstance(data.get("nonce"), str):
                with LOCK:
                    purge_sessions()
                    sess = SESSIONS.get(data["nonce"])
                    t0 = sess.get("t0") if sess and sess["game"] == "sprint" else None
                if t0 is None or time.time() - t0 > SPRINT_WINDOW + SPRINT_GRACE:
                    value = 0
        pid = data.get("id")
        if not isinstance(pid, str) or not pid or len(pid) > 64:
            self._json({"error": "bad id"}, 400)
            return
        digest = hashlib.blake2b(pid.encode("utf-8"), digest_size=8).hexdigest()
        today = current_day_index()
        with LOCK:
            flush_stale()
            if day > today:
                self._json({"error": "future day not counted"}, 403)
                return
            if day == today:
                # fresh puzzle day: this is the only thing that moves the curve
                tally(game, day, value, digest)
                payload = snapshot(game, day, value)
            else:
                # archive replay: answered from the frozen snapshot under its
                # own recorded edges, changes nothing
                rec = load_archive(game, day)
                payload = snapshot(game, day, value, st=archived_stats(rec),
                                   spec=archived_spec(rec, game))
                payload["archived"] = True
        self._json(payload)

    def _dealt(self, path, data):
        """The dealt-play endpoints: /deal opens a session, /guess plays a
        dealt rounds round, /reveal is the sprint starting gun. SESSIONS
        mutates under LOCK; a key leaves only when a round ends."""
        now = time.time()
        if path == "/deal":
            game = data.get("game")
            if not isinstance(game, str) or game not in DEALT_GAMES:
                self._json({"error": "dealt play is not open for this game"}, 400)
                return
            day = data.get("day")
            if isinstance(day, bool) or not isinstance(day, int) \
                    or not (DAY_MIN <= day <= DAY_MAX):
                self._json({"error": "bad day"}, 400)
                return
            today = current_day_index()
            if day != today:
                self._json({"error": "dealt play is for the live day"}, 403)
                return
            nonce = secrets.token_hex(16)
            with LOCK:
                purge_sessions()
                entry = PUZZLES.get(game) or []
                if game == "rounds":
                    if not entry:
                        self._json({"error": "no puzzles"}, 404)
                        return
                    pz = entry[day % len(entry)]
                SESSIONS[nonce] = {"game": game, "day": day, "created": now,
                                   "ip": self.client_address[0], "guesses": 0,
                                   "done": False, "verdict": None, "t0": None}
                if game == "rounds":
                    # the deal carries the question but never the key: the
                    # target year and the reveal line stay server-side
                    payload = {"nonce": nonce, "today": today,
                               "puzzle": {"t": pz.get("t"), "q": pz.get("q")}}
                else:
                    payload = {"nonce": nonce, "today": today}
            self._json(payload)
            return
        nonce = data.get("nonce")
        if not isinstance(nonce, str) or not nonce or len(nonce) > 64:
            self._json({"error": "bad nonce"}, 400)
            return
        with LOCK:
            purge_sessions()
            sess = SESSIONS.get(nonce)
            if sess is None or sess["day"] != current_day_index():
                self._json({"error": "no session"}, 404)
                return
            if path == "/guess":
                if sess["game"] != "rounds":
                    self._json({"error": "this session takes no guesses"}, 400)
                    return
                if sess["done"]:
                    self._json({"error": "the round is over"}, 409)
                    return
                y = data.get("y")
                if isinstance(y, bool) or not isinstance(y, int) \
                        or not (1000 <= y <= 2200):
                    self._json({"error": "bad year"}, 400)
                    return
                entry = PUZZLES.get("rounds") or []
                pz = entry[sess["day"] % len(entry)]
                key = pz["y"]
                sess["guesses"] += 1
                if y == key:
                    sess["done"] = True
                    sess["verdict"] = "won"
                    sess["done_at"] = now
                    payload = {"verdict": "won", "guesses": sess["guesses"],
                               "reveal": {"y": key, "w": pz.get("w")}}
                elif sess["guesses"] >= 6:
                    sess["done"] = True
                    sess["verdict"] = "lost"
                    sess["done_at"] = now
                    # the reveal hands over the key anyway, so the sixth row
                    # still reads like the five before it: heat and direction
                    payload = dict({"verdict": "lost", "guesses": sess["guesses"],
                                    "reveal": {"y": key, "w": pz.get("w")}},
                                   **round_feedback(y, key))
                else:
                    payload = dict({"verdict": "miss",
                                    "guesses": sess["guesses"]},
                                   **round_feedback(y, key))
            else:  # /reveal
                if sess["game"] != "sprint":
                    self._json({"error": "this session takes no starting gun"}, 400)
                    return
                if sess["t0"] is None:
                    sess["t0"] = now  # stamped once, never reset
                payload = {"ok": True, "elapsed": round(now - sess["t0"], 3),
                           "window": SPRINT_WINDOW}
            self._json(payload)


def warm_start(today):
    """Bring today's archived partial boards back to the live curve.

    A board recorded under different edges or direction (the manifest
    changed and the deploy landed mid-day) restarts clean instead of
    loading: those bins are not comparable to new submissions, and a
    mixed-shape board would crash the next tally. The day's curve starts
    over for that game; every other game keeps its numbers.
    """
    for game in SPECS:
        rec = load_archive(game, today)
        if rec and (rec.get("edges") != SPECS[game]["edges"]
                    or rec.get("better") != SPECS[game]["better"]):
            print("warm start: %s day %d was recorded under other edges - "
                  "restarting the board" % (game, today), flush=True)
            continue
        st = archived_stats(rec)
        if st:
            STATS[(game, today)] = st
            # the dedupe set rides along with the snapshot: without it
            # a restart would re-open the day and re-count every revisit
            seen = rec.get("seen") if isinstance(rec, dict) else None
            if isinstance(seen, list):
                SEEN.setdefault((game, today), set()).update(
                    d for d in seen if isinstance(d, str) and len(d) <= 16)


def main():
    global ARCHIVE_DIR, MAX_GETS_PER_IP, MAX_POSTS_PER_IP, MAX_DEALT_PER_IP, \
           SESSION_TTL, SPRINT_PURGE, EPOCH_KEY
    ap = argparse.ArgumentParser(description="Warmup global curve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--archive-dir", default=str(ARCHIVE_DIR),
                    help="where finished days collapse into static snapshots")
    ap.add_argument("--max-gets-per-ip", type=int, default=MAX_GETS_PER_IP,
                    help="per-IP daily cap for GET endpoints")
    ap.add_argument("--max-posts-per-ip", type=int, default=MAX_POSTS_PER_IP,
                    help="per-IP daily cap for POST /submit")
    ap.add_argument("--max-dealt-per-ip", type=int, default=MAX_DEALT_PER_IP,
                    help="per-IP daily cap for the dealt-play endpoints")
    ap.add_argument("--session-ttl", type=float, default=SESSION_TTL,
                    help="seconds before an idle dealt session is purged")
    ap.add_argument("--sprint-purge", type=float, default=SPRINT_PURGE,
                    help="seconds after the starting gun before an unsubmitted sprint round is reaped")
    ap.add_argument("--epoch", default=None,
                    help="override the manifest epoch (the effective day 0 date); the test suite pins this so it never depends on the wall clock")
    args = ap.parse_args()
    ARCHIVE_DIR = Path(args.archive_dir)
    MAX_GETS_PER_IP = args.max_gets_per_ip
    MAX_POSTS_PER_IP = args.max_posts_per_ip
    MAX_DEALT_PER_IP = args.max_dealt_per_ip
    SESSION_TTL = args.session_ttl
    SPRINT_PURGE = args.sprint_purge
    if args.epoch:
        EPOCH_KEY = args.epoch

    # warm start: a mid-day restart (compose update, host reboot) flushed
    # today's partial boards to the archive on shutdown; bring them back
    # so the live curve never resets mid-day
    with LOCK:
        warm_start(current_day_index())

    def _stop(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, _stop)

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("warmup global curve on %s:%d (fresh-day tallies only; archives in %s)"
          % (args.host, args.port, ARCHIVE_DIR))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with LOCK:
            flush_stale(force=True)


if __name__ == "__main__":
    main()
