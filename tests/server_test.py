#!/usr/bin/env python3
"""Integration test for scores/server.py - the global-curve service.

Spawns the real server on a scratch port and exercises the API with urllib:
health (bare and /api-prefixed), submit + dedupe (first submission of the day
stands), the /dist snapshot, strict input validation, and the 1-day pruning
horizon. Stdlib only - no pytest, no requests, no docker needed.

Run: python3 tests/server_test.py   (exit 0 = pass, 1 = fail)
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8971  # scratch port; nothing else listens here in CI or on the Pi


def req(method, path, body=None):
    url = "http://127.0.0.1:%d%s" % (PORT, path)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, (json.loads(raw) if raw else {})


def post(path, body):
    return req("POST", path, body)


def main():
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT), "--host", "127.0.0.1"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fails = []

    def check(cond, msg):
        print(("  ok    " if cond else "  FAIL  ") + msg)
        if not cond:
            fails.append(msg)

    try:
        # wait for the server to come up
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health")
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            print("FAIL: server never came up on port %d" % PORT)
            return 1

        # --- health ---
        s, b = req("GET", "/health")
        check(s == 200 and b.get("ok") is True, "GET /health -> ok:true")
        s, b = req("GET", "/api/health")
        check(s == 200 and b.get("ok") is True, "GET /api/health (prefix stripped)")
        s, _b = req("OPTIONS", "/api/submit")
        check(s == 204, "OPTIONS preflight -> 204")

        # --- submit + dedupe ---
        s, b = post("/api/submit", {"game": "fermi", "day": 0, "value": 3,
                                    "better": "high", "id": "a"})
        check(s == 200 and b.get("count") == 1, "first submit counts")
        # same id, different value: deduped, first value stands
        s, b = post("/api/submit", {"game": "fermi", "day": 0, "value": 0,
                                    "better": "high", "id": "a"})
        check(s == 200 and b.get("count") == 1 and b.get("mean") == 3,
              "re-submit same id is deduped (first stands, mean stays 3)")
        # a second player moves the mean to 2.5
        s, b = post("/api/submit", {"game": "fermi", "day": 0,
                                    "value": 2, "better": "high", "id": "b"})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 2.5,
              "second player: count 2, mean 2.5")
        check(b.get("better") == "high", "snapshot echoes server-side direction")
        check(b.get("beat") in (0, 1, 2), "snapshot includes a beat estimate")

        # --- dist endpoint ---
        s, b = req("GET", "/api/dist?game=fermi&day=0")
        check(s == 200 and b.get("count") == 2, "GET /api/dist -> count 2")
        check(isinstance(b.get("bins"), list) and len(b["bins"]) >= 4,
              "dist returns histogram bins")
        s, b = req("GET", "/dist?game=fermi&day=0")
        check(s == 200 and b.get("count") == 2, "GET /dist (no prefix) works")

        # --- validation: the server is the source of truth ---
        s, _b = post("/api/submit", {"game": "nope", "day": 0, "value": 1,
                                     "better": "high", "id": "c"})
        check(s == 400, "unknown game rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": "x", "value": 3,
                                     "better": "high", "id": "d"})
        check(s == 400, "non-integer day rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": 0, "value": "3",
                                     "better": "high", "id": "e"})
        check(s == 400, "string value rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": 0, "value": 3,
                                     "better": "high", "id": ""})
        check(s == 400, "empty id rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": 0, "value": 3,
                                     "better": "high"})
        check(s == 400, "missing id rejected")
        # oversized body -> 413 (2 KB cap)
        s, _b = post("/api/submit", {"game": "fermi", "day": 0, "value": 3,
                                     "better": "high", "id": "z" * 3000})
        check(s == 413, "oversized body rejected")
        # out-of-range values clamp into the final bin instead of corrupting bins
        s, b = post("/api/submit", {"game": "sprint", "day": 0, "value": 99,
                                    "better": "high", "id": "big"})
        check(s == 200 and b["bins"][-1]["count"] == 1 and b.get("count") == 1,
              "value beyond last edge clamps into the final bin")
        # day bounds
        s, _b = post("/api/submit", {"game": "fermi", "day": 100001, "value": 3,
                                     "better": "high", "id": "f"})
        check(s == 400, "day beyond DAY_MAX rejected")
        # dist validation
        s, _b = req("GET", "/api/dist?game=nope&day=0")
        check(s == 400, "GET /dist unknown game rejected")
        s, _b = req("GET", "/api/dist?game=fermi&day=x")
        check(s == 400, "GET /dist bad day rejected")

        # --- pruning: 1-day retention (PRUNE_DAYS = 1) ---
        for d in (5, 6, 7):
            s, _b = post("/api/submit", {"game": "rounds", "day": d, "value": 2,
                                         "better": "low", "id": "p%d" % d})
            check(s == 200, "rounds day %d accepted" % d)
        s, b = req("GET", "/api/dist?game=rounds&day=5")
        check(s == 200 and b.get("count") == 0, "day 5 pruned once day 7 arrived")
        s, b = req("GET", "/api/dist?game=rounds&day=6")
        check(s == 200 and b.get("count") == 1, "day 6 kept (newest - 1)")
        s, b = req("GET", "/api/dist?game=rounds&day=7")
        check(s == 200 and b.get("count") == 1, "day 7 kept (newest)")
        # fermi day 0 is untouched: pruning is per game
        s, b = req("GET", "/api/dist?game=fermi&day=0")
        check(s == 200 and b.get("count") == 2, "other games are not pruned by a new day elsewhere")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print("server tests: %s" % ("PASS" if not fails else "FAIL"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
