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
  weights. Written once, read-only forever. This is the only disk write
  anywhere in the service
- client ids are hashed to 8 bytes and kept only in a transient dedupe set:
  the first submission of the day stands; reloads get a personalized reply
  but do not retally
- per-IP daily request caps keep scripted flooding from doing damage:
  /health is exempt (the container healthcheck must never trip them) and
  the caps sit orders of magnitude above human play
- input is strictly validated: game must be in the fixed allowlist below,
  day/value are bounded numbers, bodies are capped at 2 KB, and no user
  text is accepted or stored anywhere

Endpoints (with or without the /api prefix):
    POST /submit   {"game", "day", "value", "id"}   -> personalized snapshot
    GET  /dist?game=&day=                           -> snapshot (today live, past days from the archive)
    GET  /puzzle?game=&day=                         -> the day's puzzle
    GET  /manifest                                  -> the scoring manifest (epoch, tz, ledger)
    GET  /health                                    -> {"ok": true}

Cache policy (deliberate): live numbers (/submit, /dist, /health) are
no-store; the day's puzzle is immutable so it is public and cacheable
until the next ET midnight; the manifest is cacheable for an hour.
"""
import argparse
import hashlib
import json
import math
import signal
import threading
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
IP_HITS = {}   # ip -> [day, gets, posts]

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


def bin_index(value, edges):
    n = len(edges) - 1
    if value < edges[0]:
        return 0
    for i in range(n):
        if value < edges[i + 1]:
            return i
    return n - 1


def current_day_index():
    try:
        tz = ZoneInfo(TZ_NAME) if ZoneInfo else None
    except Exception:
        tz = None
    today = datetime.now(tz).date() if tz else date.today()
    epoch = date.fromisoformat(EPOCH_KEY)
    return (today - epoch).days


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
    it. A failed write must never take the service down.
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
            return False
    payload = {
        "game": game, "day": day, "date": day_date(day),
        "n": st["n"], "sum": st["sum"], "sumsq": st["sumsq"],
        "min": st["min"], "max": st["max"], "bins": st["bins"],
        "edges": SPECS[game]["edges"], "better": SPECS[game]["better"],
    }
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(payload, indent=2) + "\n", encoding='utf-8')
        return True
    except OSError:
        return False


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


def flush_stale(force=False):
    """Hand finished days to the archive: snapshot once, then drop the board.

    Runs lazily on every request (so the first request after midnight ET
    settles yesterday cleanly), and forced on shutdown (so a restart does
    not silently drop the partial day).
    """
    today = current_day_index()
    for key in list(STATS.keys()):
        game, day = key
        if day == today and not force:
            continue
        if write_archive(game, day):
            print("archived %s day %d (%d plays)" % (game, day, STATS[key]["n"]), flush=True)
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


def snapshot(game, day, value=None, st=None):
    spec = SPECS[game]
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
    for i in range(nbins):
        bins[i]["count"] = st["bins"][i]
        bins[i]["you"] = (i == you_bin)
    mean = st["sum"] / st["n"]
    beat = beat_estimate(value, st, spec) if value is not None else None
    return {"count": st["n"], "beat": beat, "mean": round(mean, 2),
            "bins": bins, "better": spec["better"]}


class Handler(BaseHTTPRequestHandler):
    server_version = "warmup-curve/4.0"

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
                rec = [today, 0, 0]
                IP_HITS[ip] = rec
            idx = 1 if kind == "get" else 2
            rec[idx] += 1
            cap = MAX_GETS_PER_IP if kind == "get" else MAX_POSTS_PER_IP
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
            with LOCK:
                payload = {"ok": True, "boards": len(STATS)}
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
            today = current_day_index()
            with LOCK:
                flush_stale()
                if day > today:
                    self._json({"error": "future day not available"}, 403)
                    return
                if day == today:
                    payload = snapshot(game, day)
                else:
                    payload = snapshot(game, day, st=archived_stats(load_archive(game, day)))
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
                self._json({"game": game, "day": day, "puzzle": entry[idx], "today": today},
                           cache="public, max-age=%d" % seconds_to_midnight())
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self._path() != "/submit":
            self._json({"error": "not found"}, 404)
            return
        if not self._rate_ok("post"):
            self._json({"error": "too many requests"}, 429)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._json({"error": "bad length"}, 400)
            return
        if length <= 0 or length > MAX_BODY:
            self._json({"error": "bad length"}, 413)
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json({"error": "bad body"}, 400)
            return
        if not isinstance(data, dict):
            self._json({"error": "bad body"}, 400)
            return
        game = data.get("game")
        if not isinstance(game, str) or game not in SPECS:
            self._json({"error": "unknown game"}, 400)
            return
        day = data.get("day")
        if isinstance(day, bool) or not isinstance(day, int) or not (DAY_MIN <= day <= DAY_MAX):
            self._json({"error": "bad day"}, 400)
            return
        value = data.get("value")
        if isinstance(value, bool) or not isinstance(value, (int, float)) \
                or not math.isfinite(value) or abs(value) > MAX_ABS_VALUE:
            self._json({"error": "bad value"}, 400)
            return
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
                # archive replay: answered from the frozen snapshot, changes nothing
                payload = snapshot(game, day, value, st=archived_stats(load_archive(game, day)))
                payload["archived"] = True
        self._json(payload)


def main():
    global ARCHIVE_DIR, MAX_GETS_PER_IP, MAX_POSTS_PER_IP, EPOCH_KEY
    ap = argparse.ArgumentParser(description="Warmup global curve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--archive-dir", default=str(ARCHIVE_DIR),
                    help="where finished days collapse into static snapshots")
    ap.add_argument("--max-gets-per-ip", type=int, default=MAX_GETS_PER_IP,
                    help="per-IP daily cap for GET endpoints")
    ap.add_argument("--max-posts-per-ip", type=int, default=MAX_POSTS_PER_IP,
                    help="per-IP daily cap for POST /submit")
    ap.add_argument("--epoch", default=None,
                    help="override the manifest epoch (the effective day 0 date); the test suite pins this so it never depends on the wall clock")
    args = ap.parse_args()
    ARCHIVE_DIR = Path(args.archive_dir)
    MAX_GETS_PER_IP = args.max_gets_per_ip
    MAX_POSTS_PER_IP = args.max_posts_per_ip
    if args.epoch:
        EPOCH_KEY = args.epoch

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
