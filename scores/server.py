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
    POST /deal    {"game", "day"}                  -> open a dealt session (live day only; the deal carries the day's
                   puzzle without its key, per the dealt API schema below)
    POST /guess   {"nonce", <one game payload>}    -> the dealt verdict (dealt API schema below; the key never
                   crosses until the round is over)
    POST /reveal  {"nonce"}                          -> the sprint starting gun (t0 stamped once, never reset; the window is enforced at submit)

    Dealt API schema (one shape for every dealt game; required fields first):
      /deal   req  {"game": str (required, a dealt game), "day": int (required,
                    the live day)}
              res  {"nonce": str, "today": int, "puzzle": object (stripped per
                    its registry row, never the key)}
      /guess  req  {"nonce": str (required), then exactly one game payload:
                    rounds {"y": int} | brunch {"pick": int} | fermi {"v": number} |
                    well-actually {"pick": int} or {"correction": str} |
                    museum {"name": str} or {"clue": 1} | bogus {"pick": int} |
                    superlative {"pick": int} | sift {"pick": [str, str, str]} |
                    lightbox {"grid": [7 rows of "0"|"1"|"2"]} |
                    cipher {"check": {cipher: plain}} or {"hint": 1, "have": {...}} or {"give": 1} |
                    timeline {"order": [event indexes]} or {"give": 1} |
                    thread {"chain": [figure ids]} or {"give": 1}}
              res  {"verdict": "won"|"lost"|"gave"|"found"|"miss"|"clue"|"hit"|"hint"
                    (required),
                    "reveal": object (optional, terminal rounds only),
                    "left"|"guesses"|"score"|"bonus"|"clueIdx"|"a"|"final"|
                    "cat"|"n"|"i"|"bad"|"need"|"mistakes"|"right"|"total"|
                    "cipher"|"plain"|"hints"|"lock"|"checks" (optional)}
      /reveal req  {"nonce": str (required)} (sprint only)
      /submit with a "nonce" (optional): the session's graded verdict, answer
              and meta override whatever the client claims
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

# the gated-games list and the per-game meta caps live in the dealt
# adapter registry below: EVIDENCE_GAMES derives from the rows and each
# row carries its own caps, so a game and its grading rules can no
# longer drift apart


# ---------------------------------------------------------------------------
# Dealt play (1.2): the server deals the round and keeps the truth. A dealt
# session is a random nonce over an in-memory map - no identity, no disk, no
# player records - purged at the day rollover, on TTL, and when the round
# ends. Dealt traffic is per-action (a session can need a dozen calls), so it
# rides its own tighter per-IP daily cap, separate from /submit's.
# brunch and fermi deal per solve: their one guess ends the round, so the
# reveal can only ever arrive attached to a spent guess. well-actually
# deals the same way per pick: the lie never ships, so every pick and the
# one correction attempt travel to the session. museum deals per guess
# and meters the clues itself, so the name never ships either. bogus
# deals per pick the same way, and superlative deals per round: the
# per-question answers never ship and the session owns the sweep. The
# check games deal their own way: sift ships its tiles but never their
# categories, lightbox ships the clues its grid implies but never the
# grid or its name, and cipher ships a ciphertext under a server-side
# substitution, so the session grades every trio, development and
# decode, and meters the mistakes and hints itself. The windowed check
# games deal too: timeline ships its events without their years and
# thread ships its offered figures as one shuffled tray without the
# chain, the decoy split or the links, so both sessions grade every
# check and meter the checks themselves. The
# residual honesty note that stays open: a rounds loss reveal hands over
# the key a second session could mine, and sprint's solved count is
# still the client's word inside the server-stamped window.
# ---------------------------------------------------------------------------

DEALT_GAMES = ("rounds", "sprint", "brunch", "fermi", "well-actually", "museum",
               "bogus", "superlative", "sift", "lightbox", "cipher",
               "timeline", "thread")
# the per-game strip declarations live in the dealt adapter registry
# below: each row carries the keys its live day must never ship (the
# nested ones included), so a game and its strip can no longer drift
# apart


_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _mulberry32(seed):
    """The pages' tiny PRNG, ported so a served layout or a served cipher
    stays deterministic per day without shipping anything else."""
    state = [seed & 0xFFFFFFFF]

    def rnd():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        a = state[0]
        t = ((a ^ (a >> 15)) * (a | 1)) & 0xFFFFFFFF
        w = ((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF
        t = ((t + w) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


def _build_sub(rnd):
    """The cipher page's substitution builder, ported: a seeded shuffle
    of the alphabet with no letter standing for itself."""
    while True:
        perm = list(_ALPHA)
        for i in range(len(perm) - 1, 0, -1):
            j = int(rnd() * (i + 1))
            perm[i], perm[j] = perm[j], perm[i]
        if all(perm[i] != _ALPHA[i] for i in range(len(perm))):
            enc = {_ALPHA[i]: perm[i] for i in range(len(perm))}
            dec = {perm[i]: _ALPHA[i] for i in range(len(perm))}
            return enc, dec


def _cipher_sub(day):
    """The day's substitution, seeded server-side: the live ciphertext is
    stable across requests and restarts, but its key never ships."""
    return _build_sub(_mulberry32((day * 668265261 + 8191) & 0xFFFFFFFF))


def _runs(line):
    """The lightbox page's clue builder: the runs of consecutive filled
    cells in one line, in order ([0] for an empty line)."""
    out, c = [], 0
    for v in line:
        if v:
            c += 1
        elif c:
            out.append(c)
            c = 0
    if c:
        out.append(c)
    return out or [0]


def dealt_puzzle(game, pz, day=0):
    """The day's puzzle as a dealt game may ship it. The transform games
    ship a derived puzzle instead of the stored one: lightbox ships the
    clues its grid implies, cipher ships the ciphertext (the substitution
    lives server-side), sift ships the tiles without their categories,
    timeline ships its events without their years, and thread ships its
    offered figures as one shuffled tray (the chain, the decoy split and
    the links stay server-side). Every other dealt game ships the stored
    puzzle minus the keys its registry row strips, so the live day's
    truth never crosses the wire."""
    adapter = DEALT_ADAPTERS.get(game) or {}
    transform = adapter.get("transform")
    if transform is not None:
        out = transform(pz, day)
        if out is not None:
            return out
    out = {k: v for k, v in pz.items()
           if k not in adapter.get("strip", ())}
    for path, keys in adapter.get("deep", {}).items():
        src = out.get(path)
        if isinstance(src, list):
            out[path] = [{k: v for k, v in it.items() if k not in keys}
                         if isinstance(it, dict) else it for it in src]
    return out
SESSIONS = {}        # nonce -> {"game", "day", "created", "ip", "guesses",
                    #            "done", "verdict", "t0", and the per-game
                    #            counters ("picks", "found", "clue")
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


def _window_entry(game, day):
    """The day's full puzzle for a windowed dict-store game (timeline,
    thread): the same entry the /puzzle endpoint serves, before any dealt
    strip. None when the day falls outside the precomputed window."""
    store = PUZZLES.get(game)
    picks = store.get("picks") if isinstance(store, dict) else None
    if not isinstance(picks, list) or not (0 <= day < len(picks)):
        return None
    if game == "thread":
        bank = store["bank"]
        nodes = {nd["id"]: nd for nd in bank["nodes"]}
        emap = {}
        for ed in bank["edges"]:
            emap.setdefault(ed["a"], {})[ed["b"]] = ed
            emap.setdefault(ed["b"], {})[ed["a"]] = ed
        pk = picks[day]
        seq = [pk["s"]] + list(pk["m"]) + [pk["e"]]
        links = [emap[a][b] for a, b in zip(seq, seq[1:])]
        return {"s": nodes[pk["s"]], "e": nodes[pk["e"]],
                "m": [nodes[i] for i in pk["m"]],
                "d": [nodes[i] for i in pk["d"]], "links": links}
    if game == "timeline":
        bank = store["bank"]
        return {"events": [bank[i] for i in picks[day]]}
    return None


def validate_evidence(game, day, body):
    """Check a gated game's evidence against the day's answer key and derive
    the points. Returns (points, None) on success, (None, reason) otherwise.
    The client never names a number: every point is computed here."""
    adapter = DEALT_ADAPTERS.get(game)
    if adapter is None or "evidence" not in adapter:
        return None, "no evidence path"
    status = body.get("status")
    if status not in ("won", "lost", "gave"):
        return None, "bad status"
    if status != "won" and not adapter.get("grades_loss"):
        # a loss or a give-up is 0 points no matter what the meta says,
        # and it never needs meta at all - a real loss (sift's fourth
        # mistake) must never trip a cap and go uncounted
        return 0, None
    meta = body.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    for key, lo, hi in adapter.get("caps", ()):
        if _meta_int(meta, key, lo, hi) is None:
            return None, "bad meta"
    # the game's own validator grades the answer against the day's key
    return adapter["evidence"](day, body.get("answer"), meta)


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


# ---------------------------------------------------------------------------
# The dealt adapter registry: each dealt game declares how its session
# grades a move and builds its verdict, so the /guess dispatcher is one
# lookup. The bodies are the graders exactly as they lived inline in the
# dispatcher - the session state, the answer key and every payload shape
# are untouched - and a refused move raises _Reject so the endpoint
# answers with the same status and message the inline branches always
# sent. Each row also declares the evidence validator that grades a
# gated submission against the day's key, the meta meter a nonce-bearing
# submit reports and the caps those facts must obey. The strip side lives in the rows too: the keys a live dealt day must never
# ship, the transform that ships a derived puzzle instead of the stored
# one, and the window flag that says the day's puzzle is a pick into a
# bank. The endpoints themselves never change.
# ---------------------------------------------------------------------------

class _Reject(Exception):
    """A dealt move the session refuses: (status, message) ride out."""
    def __init__(self, status, msg):
        Exception.__init__(self, msg)
        self.status, self.msg = status, msg


def _guess_brunch(sess, data, now):
    """brunch: one pick spends the round - the verdict and the reveal ride the spent pick."""
    i = data.get("pick")
    if isinstance(i, bool) or not isinstance(i, int):
        raise _Reject(400, "bad pick")
    e = _list_entry("brunch", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    if not 0 <= i < len(e["opts"]):
        raise _Reject(400, "bad pick")
    sess["done"] = True
    sess["verdict"] = "won" if i == e["a"] else "lost"
    sess["ans"] = i
    sess["done_at"] = now
    # one seat, one guess: the verdict and the reveal arrive
    # together, so the key crosses only once the pick is spent
    return {"verdict": sess["verdict"],
               "reveal": {"a": e["a"], "w": e.get("w")}}

def _guess_fermi(sess, data, now):
    """fermi: one estimate spends the round - the cited value and the ratio buckets ride the spent guess."""
    v = data.get("v")
    if isinstance(v, bool) or not isinstance(v, (int, float)) \
            or not math.isfinite(v) or v <= 0:
        raise _Reject(400, "bad estimate")
    e = _list_entry("fermi", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    ratio = max(v / e["a"], e["a"] / v)
    score = (3 if ratio <= 3 else 2 if ratio <= 10
             else 1 if ratio <= 100 else 0)
    sess["done"] = True
    sess["verdict"] = "won"
    sess["ans"] = v
    sess["done_at"] = now
    # the cited value and the ratio buckets stay server-side
    # until the one guess is spent
    return {"verdict": "won", "score": score,
               "reveal": {"a": e["a"], "w": e.get("w")}}

def _guess_well_actually(sess, data, now):
    """well-actually: the picks hunt the lie and the one correction ends the round."""
    e = _list_entry("well-actually", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    if sess["found"]:
        # phase two: the one shot at naming the correction
        corr = data.get("correction")
        if not isinstance(corr, str) or len(corr) > 200:
            raise _Reject(400, "bad correction")
        bonus = "correct" if _text_norm(corr) in (
            _text_norm(x) for x in e["a"]) else "wrong"
        sess["done"] = True
        sess["verdict"] = "won"
        sess["ans"] = {"picks": list(sess["picks"]),
                       "typed": corr}
        sess["done_at"] = now
        # the canonical correction and the explanation stay
        # server-side until the one attempt is spent
        return {"verdict": "won", "bonus": bonus,
                   "reveal": {"c": e["c"],
                              "w": e.get("w")}}
    elif isinstance(data.get("correction"), str):
        raise _Reject(400, "the lie is not found yet")
    else:
        i = data.get("pick")
        if isinstance(i, bool) or not isinstance(i, int) \
                or not (0 <= i < len(e["s"])):
            raise _Reject(400, "bad pick")
        if i in sess["picks"]:
            raise _Reject(400, "phrase already picked")
        sess["picks"].append(i)
        if i == e["l"]:
            sess["found"] = True
            # the pick was the lie: found, but no reveal
            # yet - the correction question is still to come
            return {"verdict": "found"}
        elif len(sess["picks"]) >= 3:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["ans"] = {"picks": list(sess["picks"]),
                           "typed": ""}
            sess["done_at"] = now
            # three strikes: the lie, the canonical
            # correction and the why ride the spent round
            return {"verdict": "lost",
                       "reveal": {"l": e["l"], "c": e["c"],
                                  "w": e.get("w")}}
        else:
            return {"verdict": "miss",
                       "left": 3 - len(sess["picks"])}

def _guess_museum(sess, data, now):
    """museum: the names guess and the clues meter at the session - the name rides the spent round."""
    e = _list_entry("museum", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    if data.get("clue"):
        if sess["clue"] >= 4:
            raise _Reject(400, "no more clues")
        sess["clue"] += 1
        # the session meters the clues itself, so a
        # nonce-bearing claim cannot under-report them
        return {"verdict": "clue", "clueIdx": sess["clue"]}
    else:
        name = data.get("name")
        if not isinstance(name, str) or not name \
                or len(name) > 40:
            raise _Reject(400, "bad name")
        names = [_name_norm(x) for x in
                 [e["a"]] + list(e.get("al") or ())]
        if _name_norm(name) in names:
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = name
            sess["result"] = sess["clue"] + 1
            sess["done_at"] = now
            # the name and the story stay server-side
            # until the guess is spent
            return {"verdict": "won",
                       "reveal": {"a": e["a"],
                                  "w": e.get("w")}}
        elif sess["clue"] < 4:
            sess["clue"] += 1
            return {"verdict": "miss",
                       "clueIdx": sess["clue"]}
        else:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["ans"] = ""
            sess["result"] = 6
            sess["done_at"] = now
            return {"verdict": "lost",
                       "reveal": {"a": e["a"],
                                  "w": e.get("w")}}

def _guess_bogus(sess, data, now):
    """bogus: three picks hunt the lie - the find or the third strike ends the round."""
    e = _list_entry("bogus", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    i = data.get("pick")
    if isinstance(i, bool) or not isinstance(i, int) \
            or not (0 <= i < len(e["s"])):
        raise _Reject(400, "bad pick")
    if i in sess["picks"]:
        raise _Reject(400, "phrase already picked")
    sess["picks"].append(i)
    if i == e["l"]:
        sess["done"] = True
        sess["verdict"] = "won"
        sess["ans"] = list(sess["picks"])
        sess["done_at"] = now
        # the lie and the why cross only once the find is
        # spent
        return {"verdict": "won",
                   "reveal": {"l": e["l"], "w": e.get("w")}}
    elif len(sess["picks"]) >= 3:
        sess["done"] = True
        sess["verdict"] = "lost"
        sess["ans"] = list(sess["picks"])
        sess["done_at"] = now
        # three strikes: the lie and the why ride the spent
        # round
        return {"verdict": "lost",
                   "reveal": {"l": e["l"], "w": e.get("w")}}
    else:
        return {"verdict": "miss",
                   "left": 3 - len(sess["picks"])}

def _guess_superlative(sess, data, now):
    """superlative: the rounds grade one at a time and the sweep verdict is the server's."""
    e = _list_entry("superlative", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    q = e["q"]
    r = len(sess["picks"])
    i = data.get("pick")
    if isinstance(i, bool) or not isinstance(i, int) \
            or not (0 <= i < len(e["m"])) or r >= len(q):
        raise _Reject(400, "bad pick")
    sess["picks"].append(i)
    right = i == q[r]["a"]
    if r + 1 >= len(q):
        # the last round ends the session: the sweep verdict
        # and the picks are the server's, never the word
        sess["done"] = True
        sess["verdict"] = "won" if all(
            p == qq["a"] for p, qq in zip(sess["picks"], q)) \
            else "lost"
        sess["ans"] = list(sess["picks"])
        sess["done_at"] = now
        return {"verdict": "hit" if right else "miss",
                   "a": q[r]["a"], "final": True}
    else:
        # the spent round hands over its own answer: the
        # questions ship without their key, so the record
        # settles each round at the session
        return {"verdict": "hit" if right else "miss",
                   "a": q[r]["a"]}

def _guess_sift(sess, data, now):
    """sift: each trio tests one group - the fourth miss spends the day and the board rides it."""
    e = _list_entry("sift", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    pick = data.get("pick")
    if not isinstance(pick, list) or len(pick) != 3 \
            or not all(isinstance(x, str) and x
                       and len(x) <= 60 for x in pick) \
            or len(set(pick)) != 3:
        raise _Reject(400, "bad pick")
    got = frozenset(pick)
    solved = [frozenset(e["cats"][ci]["i"])
              for ci in sess["solved"]]
    if got in solved:
        raise _Reject(400, "group already found")
    hit = next((ci for ci, c in enumerate(e["cats"])
                if frozenset(c["i"]) == got), None)
    if hit is not None:
        sess["solved"].append(hit)
        if len(sess["solved"]) >= len(e["cats"]):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = [list(c["i"]) for c in e["cats"]]
            sess["done_at"] = now
            return {"verdict": "hit", "cat": hit,
                       "n": e["cats"][hit]["n"],
                       "i": list(e["cats"][hit]["i"]),
                       "final": True}
        else:
            # the spent test hands over its group: the
            # name and the trio ride the find, never
            # the served board
            return {"verdict": "hit", "cat": hit,
                       "n": e["cats"][hit]["n"],
                       "i": list(e["cats"][hit]["i"])}
    else:
        sess["mistakes"] += 1
        if sess["mistakes"] >= 4:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["ans"] = [list(c["i"]) for c in e["cats"]]
            sess["done_at"] = now
            # the fourth miss spends the day: the whole
            # board rides the spent round
            return {"verdict": "lost",
                       "reveal": {"t": e.get("t"),
                                  "cats": e["cats"]}}
        else:
            return {"verdict": "miss",
                       "mistakes": sess["mistakes"]}

def _guess_lightbox(sess, data, now):
    """lightbox: each development spends a mistake - the fourth fog spends the film."""
    e = _list_entry("lightbox", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    grid = data.get("grid")
    if not isinstance(grid, list) or len(grid) != len(e["g"]) \
            or not all(isinstance(r, str)
                       and len(r) == len(e["g"][0])
                       and all(ch in "012" for ch in r)
                       for r in grid):
        raise _Reject(400, "bad grid")
    rows = [[1 if ch == "1" else 0 for ch in r] for r in grid]
    want = [[1 if ch == "#" else 0 for ch in r]
            for r in e["g"]]
    if rows == want:
        sess["done"] = True
        sess["verdict"] = "won"
        sess["ans"] = list(e["g"])
        sess["done_at"] = now
        # the picture and its name ride the spent
        # development
        return {"verdict": "won",
                   "reveal": {"n": e.get("n"),
                              "g": list(e["g"])}}
    else:
        bad = [[r, c] for r in range(len(rows))
               for c in range(len(rows[0]))
               if rows[r][c] == 1 and want[r][c] == 0]
        need = [[r, c] for r in range(len(rows))
                for c in range(len(rows[0]))
                if rows[r][c] == 0 and want[r][c] == 1]
        sess["mistakes"] += 1
        if sess["mistakes"] >= 4:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["done_at"] = now
            # the fourth fog spends the film: the picture
            # rides the spent round
            return {"verdict": "lost",
                       "reveal": {"n": e.get("n"),
                                  "g": list(e["g"])}}
        else:
            # the contradictions cross (the page has
            # always flashed them), the grid never does
            return {"verdict": "miss", "bad": bad,
                       "need": need,
                       "mistakes": sess["mistakes"]}

def _guess_cipher(sess, data, now):
    """cipher: the checks and hints grade against the day's substitution - the codebook opens only on the give-up."""
    e = _list_entry("cipher", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    enc, dec = _cipher_sub(sess["day"])
    freq = {}
    for ch in e["q"]:
        if "A" <= ch <= "Z":
            freq[enc[ch]] = freq.get(enc[ch], 0) + 1
    order = sorted(freq, key=lambda c: (-freq[c], c))
    sub = {enc[ch]: ch for ch in e["q"] if "A" <= ch <= "Z"}
    if data.get("give") is not None:
        sess["done"] = True
        sess["verdict"] = "gave"
        sess["done_at"] = now
        # the codebook opens only on the give-up: the
        # quote and the substitution ride the spent round
        return {"verdict": "gave",
                   "reveal": {"q": e["q"], "a": e.get("a"),
                              "sub": sub}}
    elif data.get("hint"):
        have = data.get("have")
        if not isinstance(have, dict):
            have = {}
        if sess["hints"] >= 5:
            raise _Reject(400, "no more hints")
        cand = next((c for c in order
                     if have.get(c) != dec[c]), None)
        if cand is None:
            raise _Reject(400, "nothing left to hint")
        sess["hints"] += 1
        # the session meters the hints itself, so a
        # nonce-bearing claim cannot under-report them
        return {"verdict": "hint", "cipher": cand,
                   "plain": dec[cand],
                   "hints": sess["hints"]}
    else:
        m = data.get("check")
        if not isinstance(m, dict) or not all(
                isinstance(k, str) and len(k) == 1
                and "A" <= k <= "Z"
                and isinstance(v, str) and len(v) == 1
                and "A" <= v <= "Z"
                for k, v in m.items()):
            raise _Reject(400, "bad decode")
        right = sum(1 for c in order if m.get(c) == dec[c])
        if right == len(order):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = e["q"]
            sess["done_at"] = now
            # the full decode spends the round: the quote
            # rides it, letter-true
            return {"verdict": "won",
                       "reveal": {"q": e["q"],
                                  "a": e.get("a"),
                                  "sub": sub}}
        else:
            # honest but unfarmable: how many letters are
            # right, never which ones
            return {"verdict": "miss", "right": right,
                       "total": len(order)}

def _guess_timeline(sess, data, now):
    """timeline: each order checks at the session - the years ride the spent round."""
    pz = _window_entry("timeline", sess["day"])
    if pz is None:
        raise _Reject(404, "no answer key")
    evs = pz["events"]
    if data.get("give") is not None:
        sess["done"] = True
        sess["verdict"] = "gave"
        sess["ans"] = sorted(ev["y"] for ev in evs)
        sess["done_at"] = now
        # the give-up lays the years out: the events ride
        # the spent visit
        return {"verdict": "gave",
                   "reveal": {"events": evs}}
    else:
        order = data.get("order")
        if not isinstance(order, list) \
                or len(order) != len(evs) \
                or not all(isinstance(i, int)
                           and not isinstance(i, bool)
                           and 0 <= i < len(evs)
                           for i in order) \
                or len(set(order)) != len(order):
            raise _Reject(400, "bad order")
        sess["guesses"] += 1
        want = sorted(range(len(evs)),
                      key=lambda i: evs[i]["y"])
        lock = [order[i] == want[i]
                for i in range(len(evs))]
        right = sum(lock)
        if right == len(evs):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = [evs[i]["y"] for i in want]
            sess["done_at"] = now
            # the spent round hands over the years
            return {"verdict": "won",
                       "checks": sess["guesses"],
                       "reveal": {"events": evs}}
        else:
            # honest feedback: which positions stand,
            # never a year
            return {"verdict": "miss", "right": right,
                       "lock": lock,
                       "checks": sess["guesses"]}

def _guess_thread(sess, data, now):
    """thread: each chain checks at the session - the middles, the decoys and the links ride the spent round."""
    pz = _window_entry("thread", sess["day"])
    if pz is None:
        raise _Reject(404, "no answer key")
    mids = [nd["id"] for nd in pz["m"]]
    dids = [nd["id"] for nd in pz["d"]]
    if data.get("give") is not None:
        sess["done"] = True
        sess["verdict"] = "gave"
        sess["ans"] = [pz["s"]["id"]] + mids + \
                [pz["e"]["id"]]
        sess["done_at"] = now
        # the give-up lays the chain out: the middles, the
        # decoys and the links ride the spent visit
        return {"verdict": "gave",
                   "reveal": {"m": mids, "d": dids,
                              "links": pz["links"]}}
    else:
        chain = data.get("chain")
        if not isinstance(chain, list) \
                or len(chain) != len(mids) \
                or not all(isinstance(x, str) and x
                           for x in chain) \
                or len(set(chain)) != len(chain) \
                or not set(chain) <= (set(mids) | set(dids)):
            raise _Reject(400, "bad chain")
        sess["guesses"] += 1
        lock = [chain[i] == mids[i]
                for i in range(len(mids))]
        right = sum(lock)
        if right == len(mids):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = [pz["s"]["id"]] + mids + \
                [pz["e"]["id"]]
            sess["done_at"] = now
            # the spent round hands over the chain
            return {"verdict": "won",
                       "checks": sess["guesses"],
                       "reveal": {"m": mids, "d": dids,
                                  "links": pz["links"]}}
        else:
            return {"verdict": "miss", "right": right,
                       "lock": lock,
                       "checks": sess["guesses"]}

def _guess_rounds(sess, data, now):
    """rounds: the heat and the direction grade server-side - the year never crosses until the round is spent."""
    y = data.get("y")
    if isinstance(y, bool) or not isinstance(y, int) \
            or not (1000 <= y <= 2200):
        raise _Reject(400, "bad year")
    entry = PUZZLES.get("rounds") or []
    pz = entry[sess["day"] % len(entry)]
    key = pz["y"]
    sess["guesses"] += 1
    if y == key:
        sess["done"] = True
        sess["verdict"] = "won"
        sess["done_at"] = now
        return {"verdict": "won", "guesses": sess["guesses"],
                   "reveal": {"y": key, "w": pz.get("w")}}
    elif sess["guesses"] >= 6:
        sess["done"] = True
        sess["verdict"] = "lost"
        sess["done_at"] = now
        # the reveal hands over the key anyway, so the sixth
        # row still reads like the five before it: heat and
        # direction
        return dict({"verdict": "lost",
                        "guesses": sess["guesses"],
                        "reveal": {"y": key, "w": pz.get("w")}},
                       **round_feedback(y, key))
    else:
        return dict({"verdict": "miss",
                        "guesses": sess["guesses"]},
                       **round_feedback(y, key))



def _evidence_bogus(day, ans, meta):
    """bogus: the picks must include the lie; each wrong pick costs a point."""
    e = _list_entry("bogus", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, list) or not ans or len(ans) > 3 \
            or not all(isinstance(p, int) and not isinstance(p, bool)
                       and 0 <= p < len(e["s"]) for p in ans):
        return None, "bad answer"
    if e["l"] not in ans:
        return None, "wrong answer"
    return max(0, 3 - sum(1 for p in ans if p != e["l"])), None


def _evidence_well_actually(day, ans, meta):
    """well-actually: the picks must name the lie, and the typed correction can earn the bonus point."""
    e = _list_entry("well-actually", day)
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


def _evidence_fermi(day, ans, meta):
    """fermi: the estimate grades by ratio bucket, won or lost."""
    e = _list_entry("fermi", day)
    if e is None:
        return None, "no answer key"
    if isinstance(ans, bool) or not isinstance(ans, (int, float)) \
            or not math.isfinite(ans) or ans <= 0:
        return None, "bad answer"
    ratio = max(ans / e["a"], e["a"] / ans)
    return (3 if ratio <= 3 else 2 if ratio <= 10
            else 1 if ratio <= 100 else 0), None


def _evidence_brunch(day, ans, meta):
    """brunch: the pick must be the impostor seat."""
    e = _list_entry("brunch", day)
    if e is None:
        return None, "no answer key"
    if isinstance(ans, bool) or not isinstance(ans, int) \
            or not (0 <= ans < len(e["opts"])):
        return None, "bad answer"
    if ans != e["a"]:
        return None, "wrong answer"
    return 1, None


def _evidence_superlative(day, ans, meta):
    """superlative: one point per round the pick matched."""
    e = _list_entry("superlative", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, list) or len(ans) != len(e["q"]) \
            or not all(isinstance(p, int) and not isinstance(p, bool)
                       and 0 <= p < len(e["m"]) for p in ans):
        return None, "bad answer"
    return sum(1 for p, q in zip(ans, e["q"]) if p == q["a"]), None


def _evidence_rounds(day, ans, meta):
    """rounds: the year must be exact; the guesses meter the points."""
    e = _list_entry("rounds", day)
    if e is None:
        return None, "no answer key"
    if isinstance(ans, bool) or not isinstance(ans, int) or ans != e["y"]:
        return None, "wrong answer"
    return max(0, 4 - meta["guesses"]), None


def _evidence_museum(day, ans, meta):
    """museum: the name must match the answer or an alias; the clues meter the points."""
    e = _list_entry("museum", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, str) or not ans or len(ans) > 200:
        return None, "bad answer"
    names = [_name_norm(x) for x in [e["a"]] + list(e.get("al") or ())]
    if _name_norm(ans) not in names:
        return None, "wrong answer"
    return max(0, 4 - meta["clues"]), None


def _evidence_sift(day, ans, meta):
    """sift: the groups must all be found; the mistakes meter the points."""
    e = _list_entry("sift", day)
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


def _evidence_lightbox(day, ans, meta):
    """lightbox: the grid must match; the mistakes meter the points."""
    e = _list_entry("lightbox", day)
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


def _evidence_cipher(day, ans, meta):
    """cipher: the decode must match the quote; the hints meter the points."""
    e = _list_entry("cipher", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, str) or not ans or len(ans) > 500:
        return None, "bad answer"
    if _alnum_norm(ans) != _alnum_norm(e["q"]):
        return None, "wrong answer"
    return max(0, 3 - meta["hints"]), None


def _evidence_timeline(day, ans, meta):
    """timeline: the years must be the bank's, in order; the checks meter the points."""
    store = PUZZLES.get("timeline")
    picks = store.get("picks") if isinstance(store, dict) else None
    if not isinstance(picks, list) or not (0 <= day < len(picks)):
        return None, "no answer key"
    years = sorted(store["bank"][i]["y"] for i in picks[day])
    if not isinstance(ans, list) or len(ans) != len(years) \
            or not all(isinstance(y, int) and not isinstance(y, bool)
                       for y in ans) or ans != years:
        return None, "wrong answer"
    return max(0, 4 - meta["checks"]), None


def _evidence_thread(day, ans, meta):
    """thread: the chain must be the pick's own middles; the checks meter the points."""
    store = PUZZLES.get("thread")
    picks = store.get("picks") if isinstance(store, dict) else None
    if not isinstance(picks, list) or not (0 <= day < len(picks)):
        return None, "no answer key"
    pk = picks[day]
    chain = [pk["s"]] + list(pk["m"]) + [pk["e"]]
    if ans != chain:
        return None, "wrong answer"
    return max(0, 4 - meta["checks"]), None


def _meta_rounds(sess):
    """rounds: the session counted the guesses itself."""
    return {"guesses": sess["guesses"]}


def _meta_clues(sess):
    """museum: the session metered the clues itself, so a nonce-bearing
    claim cannot under-report them."""
    return {"clues": sess.get("result", 1)}


def _meta_hints(sess):
    """cipher: the session metered the hints itself, so a nonce-bearing
    claim cannot under-report them."""
    return {"hints": sess.get("hints", 0)}


def _meta_mistakes(sess):
    """sift and lightbox: the session metered the mistakes itself, so a
    nonce-bearing claim cannot under-report them."""
    return {"mistakes": sess.get("mistakes", 0)}


def _meta_checks(sess):
    """timeline and thread: the session metered the checks itself, so a
    nonce-bearing claim cannot under-report them."""
    return {"checks": sess.get("guesses", 0)}


def _transform_lightbox(pz, day):
    """lightbox: the clues the grid implies ship instead of the grid."""
    if not isinstance(pz.get("g"), list):
        return None
    cells = [[1 if ch == "#" else 0 for ch in row] for row in pz["g"]]
    return {"rc": [_runs(row) for row in cells],
            "cc": [_runs([row[c] for row in cells])
                   for c in range(len(cells[0]))]}


def _transform_cipher(pz, day):
    """cipher: the ciphertext ships and the author stays; the quote and
    the substitution never do."""
    if not isinstance(pz.get("q"), str):
        return None
    enc, _dec = _cipher_sub(day)
    return {"a": pz.get("a"),
            "c": "".join(enc[ch] if ch in enc else ch for ch in pz["q"])}


def _transform_sift(pz, day):
    """sift: the tiles ship shuffled; their categories never do."""
    if not isinstance(pz.get("cats"), list):
        return None
    tiles = [txt for cat in pz["cats"] for txt in cat["i"]]
    rnd = _mulberry32(day * 6151 + 42)
    for i in range(len(tiles) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        tiles[i], tiles[j] = tiles[j], tiles[i]
    return {"t": pz.get("t"), "tiles": tiles}


def _transform_timeline(pz, day):
    """timeline: the events ship without their years."""
    if not isinstance(pz.get("events"), list):
        return None
    return {"events": [{k: v for k, v in ev.items() if k != "y"}
                       for ev in pz["events"]]}


def _transform_thread(pz, day):
    """thread: the offered figures ship as one shuffled tray; the chain,
    the decoy split and the links never do."""
    if not isinstance(pz.get("m"), list):
        return None
    tray = list(pz["m"]) + list(pz["d"])
    rnd = _mulberry32(day * 7919 + 17)
    for i in range(len(tray) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        tray[i], tray[j] = tray[j], tray[i]
    return {"s": pz.get("s"), "e": pz.get("e"), "k": len(pz["m"]),
            "tray": tray}


# One row per dealt game (sprint deals too, but its session is only the
# starting gun, so it keeps no row here). Each row declares how the
# session grades a move ("guess"), how a gated submission's answer is
# graded against the day's key ("evidence"), which play facts a
# nonce-bearing submit reports ("meta") and the caps those facts must
# obey ("caps"); fermi and superlative grade even a loss, so they say so
# ("grades_loss"). The strip side rides along: the keys a live dealt day
# must never ship ("strip", and the nested ones under "deep"), the
# transform that ships a derived puzzle instead of the stored one
# ("transform"), and a game whose day picks into a bank window says so
# ("windowed"); superlative's strip is empty because its questions lose
# their answer index in the nested pass instead.
DEALT_ADAPTERS = {
    "rounds":        {"guess": _guess_rounds, "evidence": _evidence_rounds,
                      "meta": _meta_rounds, "caps": (("guesses", 1, 6),),
                      "strip": ("y", "w")},
    "brunch":        {"guess": _guess_brunch, "evidence": _evidence_brunch,
                      "strip": ("a", "w")},
    "fermi":         {"guess": _guess_fermi, "evidence": _evidence_fermi,
                      "grades_loss": True, "strip": ("a", "w")},
    "well-actually": {"guess": _guess_well_actually,
                      "evidence": _evidence_well_actually,
                      "strip": ("l", "a", "c", "w")},
    "museum":        {"guess": _guess_museum, "evidence": _evidence_museum,
                      "meta": _meta_clues, "caps": (("clues", 1, 5),),
                      "strip": ("a", "al", "w")},
    "bogus":         {"guess": _guess_bogus, "evidence": _evidence_bogus,
                      "strip": ("l", "w")},
    "superlative":   {"guess": _guess_superlative,
                      "evidence": _evidence_superlative,
                      "grades_loss": True, "strip": (),
                      "deep": {"q": ("a",)}},
    "sift":          {"guess": _guess_sift, "evidence": _evidence_sift,
                      "meta": _meta_mistakes,
                      "caps": (("mistakes", 0, 4),),
                      "strip": ("cats",), "transform": _transform_sift},
    "lightbox":      {"guess": _guess_lightbox,
                      "evidence": _evidence_lightbox,
                      "meta": _meta_mistakes,
                      "caps": (("mistakes", 0, 4),),
                      "strip": ("g", "n"), "transform": _transform_lightbox},
    "cipher":        {"guess": _guess_cipher, "evidence": _evidence_cipher,
                      "meta": _meta_hints, "caps": (("hints", 0, 5),),
                      "strip": ("q",), "transform": _transform_cipher},
    "timeline":      {"guess": _guess_timeline,
                      "evidence": _evidence_timeline,
                      "meta": _meta_checks, "caps": (("checks", 1, 999),),
                      "strip": ("y",), "transform": _transform_timeline,
                      "windowed": True},
    "thread":        {"guess": _guess_thread, "evidence": _evidence_thread,
                      "meta": _meta_checks, "caps": (("checks", 1, 999),),
                      "strip": ("m", "d", "links"),
                      "transform": _transform_thread, "windowed": True},
}

# the gated-games list derives from the rows: a game is evidence-gated
# exactly when its row declares how to grade the answer server-side, so
# the list and the graders can no longer drift apart
EVIDENCE_GAMES = tuple(g for g in DEALT_GAMES
                       if "evidence" in DEALT_ADAPTERS.get(g, {}))


class Handler(BaseHTTPRequestHandler):
    server_version = "warmup-curve/4.8"

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
                # thread: picks index the graph bank; a replayed day carries
                # the start, the end, the chain, the decoys and the links,
                # while the live dealt day ships the offered figures as one
                # shuffled tray, never the chain
                pz = _window_entry(game, day)
                if pz is None:
                    self._json({"error": "no puzzles"}, 404)
                    return
                if day == today:
                    pz = dealt_puzzle(game, pz, day)
                self._json({"game": game, "day": day, "today": today,
                            "puzzle": pz},
                           cache="public, max-age=%d" % seconds_to_midnight())
            elif isinstance(entry, dict) and "picks" in entry:
                # windowed game: precomputed picks into the bank (timeline)
                picks = entry["picks"]
                if day < 0 or day >= len(picks):
                    self._json({"error": "no puzzles"}, 404)
                    return
                bank = entry["bank"]
                events = [bank[i] for i in picks[day]]
                pz = {"events": events}
                # the dealt cutover: the live day ships its events without
                # their years, so the order grades at the session
                if day == today and "strip" in DEALT_ADAPTERS.get(game, {}):
                    pz = dealt_puzzle(game, pz, day)
                self._json({"game": game, "day": day, "puzzle": pz, "today": today},
                           cache="public, max-age=%d" % seconds_to_midnight())
            else:
                if not entry:
                    self._json({"error": "no puzzles"}, 404)
                    return
                idx = day % len(entry)
                pz = entry[idx]
                # the dealt cutover: the dealt list-store games are played
                # server-dealt on the live day, so today's puzzle ships
                # without its key - the round lives in /deal and /guess.
                # A replayed day is long over, so its key stays and the
                # archive path keeps grading locally.
                if day == today and "strip" in DEALT_ADAPTERS.get(game, {}):
                    pz = dealt_puzzle(game, pz, day)
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
                    if "ans" in sess:
                        # brunch, fermi, well-actually and museum: the pick,
                        # the estimate, the picks-and-correction or the name
                        # the server graded, so the points derive from the
                        # session's own answer, never the client's word
                        data["answer"] = sess["ans"]
                    # the session meters the play facts itself (clues, hints,
                    # mistakes, checks), so a nonce-bearing claim cannot
                    # under-report them; the games without a meter carry no
                    # meta at all
                    meta_fn = DEALT_ADAPTERS.get(game, {}).get("meta")
                    data["meta"] = meta_fn(sess) if meta_fn else {}
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
        dealt round (rounds heat, the one-shot verdicts, well-actually's
        picks and correction, museum's names and clues, bogus's picks,
        superlative's rounds, sift's trios, lightbox's developments,
        cipher's checks and hints, timeline's and thread's checks), /reveal
        is the sprint starting gun. SESSIONS mutates under LOCK; a key
        leaves only when a round ends."""
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
                adapter = DEALT_ADAPTERS.get(game) or {}
                pz = None
                if "strip" in adapter:
                    if adapter.get("windowed"):
                        pz = _window_entry(game, day)
                    elif entry:
                        pz = entry[day % len(entry)]
                    if pz is None:
                        self._json({"error": "no puzzles"}, 404)
                        return
                SESSIONS[nonce] = {"game": game, "day": day, "created": now,
                                   "ip": self.client_address[0], "guesses": 0,
                                   "done": False, "verdict": None, "t0": None,
                                   "picks": [], "found": False, "clue": 0,
                                   "mistakes": 0, "hints": 0, "solved": []}
                if pz is not None:
                    # the deal carries the question but never the key: the
                    # row's strip keeps the answer server-side
                    payload = {"nonce": nonce, "today": today,
                               "puzzle": dealt_puzzle(game, pz, day)}
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
                guess = DEALT_ADAPTERS.get(sess["game"], {}).get("guess")
                if guess is None:
                    self._json({"error": "this session takes no guesses"}, 400)
                    return
                if sess["done"]:
                    self._json({"error": "the round is over"}, 409)
                    return
                try:
                    payload = guess(sess, data, now)
                except _Reject as r:
                    self._json({"error": r.msg}, r.status)
                    return
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
