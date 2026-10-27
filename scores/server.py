#!/usr/bin/env python3
"""Warmup team curve - consolidated daily stats for the warmup games.

Design rules (deliberate):
- stdlib only; binds to 127.0.0.1; zero disk writes of any kind
- keeps ONLY consolidated numbers per (game, day): n, sum, sumsq, min, max,
  and a small fixed histogram. No per-player records. No names. No text.
- client ids are hashed to 8 bytes and kept only in a transient dedupe set:
  the first submission of the day stands; reloads get a personalized reply
  but do not retally
- boards older than 3 days are pruned from RAM; a restart forgets everything
- input is strictly validated: game must be in the fixed allowlist below,
  day/value are bounded numbers, bodies are capped at 2 KB, and no user
  text is accepted or stored anywhere

Endpoints (with or without the /api prefix):
    POST /submit   {"game", "day", "value", "id"}   -> personalized snapshot
    GET  /dist?game=&day=                           -> snapshot
    GET  /health                                    -> {"ok": true}
"""
import argparse
import hashlib
import json
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PRUNE_DAYS = 3
MAX_BODY = 2048
MAX_ABS_VALUE = 1e6
DAY_MIN, DAY_MAX = -1000, 100000

# Per-game truth: which direction is better, and the fixed histogram edges.
# Bin i covers [edges[i], edges[i+1]); values beyond the last edge clamp into
# the final bin, values below the first edge clamp into bin 0.
# "better" lives here, server-side - the client never decides it.
SPECS = {
    "bogus":         {"better": "high", "edges": [0, 1, 2, 3, 4]},
    "well-actually": {"better": "high", "edges": [0, 1, 2, 3, 4, 5]},
    "rings":         {"better": "low",  "edges": [0, 15, 30, 45, 60, 75, 90, 105, 120]},
    "grid":          {"better": "high", "edges": [0, 2, 4, 6, 8, 10, 12, 14, 16]},
    "fermi":         {"better": "high", "edges": [0, 1, 2, 3, 4]},
    "sift":          {"better": "low",  "edges": [0, 1, 2, 3, 4, 5]},
    "rounds":        {"better": "low",  "edges": [1, 2, 3, 4, 5, 6, 7, 8]},
    "trace":         {"better": "low",  "edges": [0, 5, 6, 7, 8, 9, 10, 11, 12]},
    "lightbox":      {"better": "low",  "edges": [0, 1, 2, 3, 4, 5]},
    "sprint":        {"better": "high", "edges": [0, 1, 2, 3, 4, 5, 6]},
}

STATS = {}   # (game, day) -> {"n", "sum", "sumsq", "min", "max", "bins": [ints]}
SEEN = {}    # (game, day) -> set of 8-byte id digests (transient dedupe only)
NEWEST = {}  # game -> newest day seen
LOCK = threading.Lock()


def bin_index(value, edges):
    n = len(edges) - 1
    if value < edges[0]:
        return 0
    for i in range(n):
        if value < edges[i + 1]:
            return i
    return n - 1


def prune(game):
    newest = NEWEST.get(game)
    if newest is None:
        return
    horizon = newest - PRUNE_DAYS
    for key in [k for k in STATS if k[0] == game and k[1] < horizon]:
        del STATS[key]
    for key in [k for k in SEEN if k[0] == game and k[1] < horizon]:
        del SEEN[key]


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


def snapshot(game, day, value=None):
    spec = SPECS[game]
    edges = spec["edges"]
    nbins = len(edges) - 1
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
    server_version = "warmup-curve/2.0"

    def log_message(self, fmt, *args):
        pass  # nothing is logged anywhere, on purpose

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
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

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self._path()
        if path == "/health":
            with LOCK:
                payload = {"ok": True, "boards": len(STATS)}
            self._json(payload)
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
            with LOCK:
                payload = snapshot(game, day)
            self._json(payload)
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self._path() != "/submit":
            self._json({"error": "not found"}, 404)
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
        with LOCK:
            NEWEST[game] = max(NEWEST.get(game, day), day)
            prune(game)
            tally(game, day, value, digest)
            payload = snapshot(game, day, value)
        self._json(payload)


def main():
    ap = argparse.ArgumentParser(description="Warmup team curve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("warmup team curve on %s:%d (consolidated stats only, prunes after %d days)"
          % (args.host, args.port, PRUNE_DAYS))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
