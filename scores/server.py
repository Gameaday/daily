#!/usr/bin/env python3
"""Warmup team board — a tiny in-memory score service for daily.historylabs.dev.

Stdlib only. Scores live in RAM, never touch disk, and vanish on restart.
Boards older than 3 days are pruned. No accounts: clients send a random id
and an optional display name (sanitized).

Endpoints (with or without the /api prefix):
    POST /submit   body {game, day, value, better, name, id}  -> snapshot
    GET  /dist?game=&day=[&id=]                              -> snapshot
    GET  /health                                            -> {"ok": true}

Run: python3 server.py --port 8787 --host 127.0.0.1
"""
import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BOARDS = {}   # (game, day) -> {player_id: {"name": str, "value": float, "better": str}}
NEWEST = {}   # game -> newest day seen (client day numbering)
PRUNE_DAYS = 3
LOCK = threading.Lock()


def sanitize_name(raw):
    cleaned = re.sub(r"[^A-Za-z0-9 _.\-']", "", str(raw or "")).strip()
    return cleaned[:20] or "anon"


def ranks_better(a, b, direction):
    return a > b if direction == "high" else a < b


def prune(game):
    newest = NEWEST.get(game)
    if newest is None:
        return
    horizon = newest - PRUNE_DAYS
    for key in [k for k in BOARDS if k[0] == game and k[1] < horizon]:
        del BOARDS[key]


def snapshot(game, day, me_id=None):
    board = BOARDS.get((game, day), {})
    entries = list(board.values())
    me = board.get(me_id)
    direction = me["better"] if me else (entries[0]["better"] if entries else "high")
    values = [e["value"] for e in entries]
    count = len(entries)
    beat = None
    if me is not None:
        beat = sum(1 for e in entries
                   if e is not me and ranks_better(me["value"], e["value"], direction))
    bins = [{"lo": 0, "hi": 0, "count": 0, "you": False} for _ in range(8)]
    if values:
        lo, hi = min(values), max(values)
        span = (hi - lo) or 1.0
        for i in range(8):
            bins[i] = {
                "lo": round(lo + span * i / 8, 4),
                "hi": round(lo + span * (i + 1) / 8, 4),
                "count": 0,
                "you": False,
            }
        me_bin = None
        for e in entries:
            idx = min(7, max(0, int((e["value"] - lo) / span * 8)))
            bins[idx]["count"] += 1
            if me is not None and e is me:
                me_bin = idx
        if me_bin is not None:
            bins[me_bin]["you"] = True
    order = sorted(entries, key=lambda e: e["value"], reverse=(direction == "high"))
    top = [{"name": e["name"], "value": e["value"]} for e in order[:5]]
    return {"count": count, "beat": beat, "bins": bins, "top": top, "direction": direction}


class Handler(BaseHTTPRequestHandler):
    server_version = "warmup-scores/1.0"

    def log_message(self, fmt, *args):
        pass  # keep the journal quiet

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
                payload = {"ok": True, "boards": len(BOARDS)}
            self._json(payload)
        elif path in ("/dist", "/distribution"):
            qs = parse_qs(urlparse(self.path).query)
            game = (qs.get("game") or [""])[0]
            if not re.fullmatch(r"[A-Za-z0-9_.\-]{1,40}", game):
                self._json({"error": "bad game"}, 400)
                return
            try:
                day = int((qs.get("day") or ["0"])[0])
            except ValueError:
                self._json({"error": "bad day"}, 400)
                return
            me_id = (qs.get("id") or [""])[0][:40]
            with LOCK:
                payload = snapshot(game, day, me_id)
            self._json(payload)
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self._path() != "/submit":
            self._json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json({"error": "bad body"}, 400)
            return
        game = str(data.get("game") or "")
        if not re.fullmatch(r"[A-Za-z0-9_.\-]{1,40}", game):
            self._json({"error": "bad game"}, 400)
            return
        try:
            day = int(data.get("day"))
            value = float(data.get("value"))
        except (TypeError, ValueError):
            self._json({"error": "bad day or value"}, 400)
            return
        direction = str(data.get("better") or "high")
        if direction not in ("high", "low"):
            direction = "high"
        pid = re.sub(r"[^A-Za-z0-9_.\-]", "", str(data.get("id") or "anon"))[:40] or "anon"
        name = sanitize_name(data.get("name"))
        with LOCK:
            NEWEST[game] = max(NEWEST.get(game, day), day)
            prune(game)
            board = BOARDS.setdefault((game, day), {})
            prev = board.get(pid)
            if prev is None or ranks_better(value, prev["value"], direction):
                board[pid] = {"name": name, "value": value, "better": direction, "ts": time.time()}
            elif name != "anon":
                prev["name"] = name
            payload = snapshot(game, day, pid)
        self._json(payload)


def main():
    ap = argparse.ArgumentParser(description="Warmup team board")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("warmup team board on %s:%d (in-memory, prunes after %d days)"
          % (args.host, args.port, PRUNE_DAYS))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
