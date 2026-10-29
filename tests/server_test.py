#!/usr/bin/env python3
"""Integration test for scores/server.py - the global-curve service.

Spawns the real server on a scratch port and exercises the API with urllib:
health (bare and /api-prefixed), submit + dedupe (first submission of the day
stands), the /dist snapshot, strict input validation, fresh-day counting
(stale submits answered from the archive, future days rejected), and the
archive handoff itself (a unit section that imports the module and walks a
day over midnight). Stdlib only - no pytest, no requests, no docker needed.

Run: python3 tests/server_test.py   (exit 0 = pass, 1 = fail)
"""
import datetime
import importlib.util
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8971  # scratch port; nothing else listens here in CI or on the Pi

# one source of truth: the epoch and timezone come from the manifest the
# server itself loads, so this test can never disagree with server.py
MANIFEST = json.loads((ROOT / "scores" / "manifest.json").read_text(encoding="utf-8"))

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None


def today_day():
    """The same day index server.py computes: ET today minus the epoch in
    scores/manifest.json (one source of truth for both sides of this test)."""
    tz = None
    try:
        tz = ZoneInfo(MANIFEST["tz"]) if ZoneInfo else None
    except Exception:
        tz = None
    today = datetime.datetime.now(tz).date() if tz else date.today()
    return (today - date.fromisoformat(MANIFEST["epoch"])).days


def req(method, path, body=None, port=PORT):
    url = "http://127.0.0.1:%d%s" % (port, path)
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


def post(path, body, port=PORT):
    return req("POST", path, body, port)


def main():
    # both instances archive into a scratch dir: the test must never write
    # snapshots into the repo's scores/archive
    scratch = tempfile.mkdtemp()
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT), "--host", "127.0.0.1", "--archive-dir", scratch],
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

        TODAY = today_day()

        # --- health ---
        s, b = req("GET", "/health")
        check(s == 200 and b.get("ok") is True, "GET /health -> ok:true")
        s, b = req("GET", "/api/health")
        check(s == 200 and b.get("ok") is True, "GET /api/health (prefix stripped)")
        s, _b = req("OPTIONS", "/api/submit")
        check(s == 204, "OPTIONS preflight -> 204")

        # --- manifest endpoint + cache policy ---
        s, b = req("GET", "/api/manifest")
        check(s == 200 and b.get("epoch") == MANIFEST["epoch"],
              "GET /api/manifest -> the scoring manifest (epoch matches)")
        check(b.get("games", {}).get("fermi", {}).get("better") == "high",
              "GET /api/manifest -> per-game ledger present")

        def hdrs(method, path):
            r = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), method=method)
            try:
                with urllib.request.urlopen(r, timeout=5) as resp:
                    return dict(resp.headers)
            except urllib.error.HTTPError as e:
                return dict(e.headers)

        h = hdrs("GET", "/health")
        check("no-store" in (h.get("Cache-Control") or ""),
              "live endpoints are Cache-Control: no-store")
        h = hdrs("GET", "/api/puzzle?game=bogus&day=0")
        check((h.get("Cache-Control") or "").startswith("public, max-age="),
              "puzzle responses are publicly cacheable")
        h = hdrs("GET", "/api/manifest")
        check((h.get("Cache-Control") or "").startswith("public"),
              "manifest responses are cacheable")

        # --- puzzle delivery (server-gated games; needs the committed
        #     per-game stores under scores/<game>/puzzles.json) ---
        if not (ROOT / "scores" / "bogus" / "puzzles.json").exists():
            check(False, "scores/bogus/puzzles.json missing")
        else:
            s, b = req("GET", "/api/puzzle?game=bogus&day=0")
            check(s == 200 and b.get("puzzle", {}).get("l") == 5,
                  "GET /puzzle bogus day 0 -> lie is statement 5")
            s, b = req("GET", "/api/puzzle?game=rounds&day=0")
            check(s == 200 and b.get("puzzle", {}).get("y") == 1215,
                  "GET /puzzle rounds day 0 -> Magna Carta 1215")
            s, b = req("GET", "/api/puzzle?game=timeline&day=0")
            ev = b.get("puzzle", {}).get("events", [])
            check(s == 200 and len(ev) == 5, "GET /puzzle timeline day 0 -> 5 events")
            check(len({e.get("y") for e in ev}) == 5, "GET /puzzle timeline -> distinct years")
            store = json.loads((ROOT / "scores" / "timeline" / "puzzles.json").read_text(encoding="utf-8"))
            exp = [store["bank"][i] for i in store["picks"][0]]
            check(ev == exp, "GET /puzzle timeline matches the committed picks")
            s, b = req("GET", "/api/puzzle?game=timeline&day=-1")
            check(s == 404, "GET /puzzle windowed negative day -> 404")
            s, b = req("GET", "/api/puzzle?game=nosuchgame&day=0")
            check(s == 400, "GET /puzzle unknown game -> 400")
            s, b = req("GET", "/api/puzzle?game=bogus&day=notanumber")
            check(s == 400, "GET /puzzle bad day -> 400")
            s, b = req("GET", "/api/puzzle?game=bogus&day=99999")
            check(s == 403, "GET /puzzle future day -> 403")

        # --- fresh-day submit + dedupe ---
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY, "value": 3,
                                    "better": "high", "id": "a"})
        check(s == 200 and b.get("count") == 1, "first submit counts (today)")
        # same id, different value: deduped, first value stands
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY, "value": 0,
                                    "better": "high", "id": "a"})
        check(s == 200 and b.get("count") == 1 and b.get("mean") == 3,
              "re-submit same id is deduped (first stands, mean stays 3)")
        # a second player moves the mean to 2.5
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY,
                                    "value": 2, "better": "high", "id": "b"})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 2.5,
              "second player: count 2, mean 2.5")
        check(b.get("better") == "high", "snapshot echoes server-side direction")
        check(b.get("beat") in (0, 1, 2), "snapshot includes a beat estimate")
        check(b.get("archived") is None, "today's snapshot is live, not archived")

        # --- fresh-day counting: stale and future submissions ---
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY - 1,
                                    "value": 0, "better": "high", "id": "stale"})
        check(s == 200 and b.get("archived") is True and b.get("count") == 0,
              "stale submit -> archived snapshot, no live tally")
        s, b = req("GET", "/api/dist?game=fermi&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "stale submit did not touch today's curve")
        s, b = req("GET", "/api/dist?game=fermi&day=" + str(TODAY - 1))
        check(s == 200 and b.get("archived") is True and b.get("count") == 0,
              "GET /dist for a past day -> archived snapshot")
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY + 5,
                                    "value": 3, "better": "high", "id": "future"})
        check(s == 403, "future day submit rejected")
        s, b = req("GET", "/api/dist?game=fermi&day=" + str(TODAY + 5))
        check(s == 403, "future day dist rejected")

        # --- dist endpoint ---
        s, b = req("GET", "/api/dist?game=fermi&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "GET /api/dist -> count 2")
        check(isinstance(b.get("bins"), list) and len(b["bins"]) >= 4,
              "dist returns histogram bins")
        s, b = req("GET", "/dist?game=fermi&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "GET /dist (no prefix) works")

        # --- validation: the server is the source of truth ---
        s, _b = post("/api/submit", {"game": "nope", "day": TODAY, "value": 1,
                                     "better": "high", "id": "c"})
        check(s == 400, "unknown game rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": "x", "value": 3,
                                     "better": "high", "id": "d"})
        check(s == 400, "non-integer day rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": TODAY, "value": "3",
                                     "better": "high", "id": "e"})
        check(s == 400, "string value rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": TODAY, "value": 3,
                                     "better": "high", "id": ""})
        check(s == 400, "empty id rejected")
        s, _b = post("/api/submit", {"game": "fermi", "day": TODAY, "value": 3,
                                     "better": "high"})
        check(s == 400, "missing id rejected")
        # oversized body -> 413 (2 KB cap)
        s, _b = post("/api/submit", {"game": "fermi", "day": TODAY, "value": 3,
                                     "better": "high", "id": "z" * 3000})
        check(s == 413, "oversized body rejected")
        # out-of-range values clamp into the final bin instead of corrupting bins
        s, b = post("/api/submit", {"game": "sprint", "day": TODAY, "value": 99,
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
        # stale tallies live per game: another game's stale submit is archived too
        s, b = post("/api/submit", {"game": "rounds", "day": TODAY - 1,
                                    "value": 2, "better": "low", "id": "old"})
        check(s == 200 and b.get("archived") is True, "stale submit in another game also archived")
        s, b = req("GET", "/api/dist?game=fermi&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "other games' stale days do not touch fermi")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    # --- rate limiting: a second instance with tiny caps; /health exempt ---
    PORT2 = PORT + 1
    proc2 = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT2), "--host", "127.0.0.1", "--archive-dir", scratch,
         "--max-gets-per-ip", "3", "--max-posts-per-ip", "2"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health", port=PORT2)
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            check(False, "rate-limit instance never came up on port %d" % PORT2)
        else:
            g = [req("GET", "/api/manifest", port=PORT2)[0] for _ in range(4)]
            check(g[:3] == [200, 200, 200] and g[3] == 429,
                  "GET cap: 3 per IP allowed, the 4th is 429")
            p = [post("/api/submit",
                      {"game": "fermi", "day": TODAY, "value": 3,
                       "better": "high", "id": "r%d" % i}, port=PORT2)[0]
                 for i in range(3)]
            check(p[:2] == [200, 200] and p[2] == 429,
                  "submit cap: 2 per IP allowed, the 3rd is 429")
            s, _b = req("GET", "/health", port=PORT2)
            check(s == 200, "/health is exempt from the per-IP caps")
    finally:
        proc2.terminate()
        try:
            proc2.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc2.kill()

    # --- archive handoff (unit): a finished day collapses into a static,
    #     read-only snapshot and leaves the live state ---
    spec = importlib.util.spec_from_file_location("warmup_server", ROOT / "scores" / "server.py")
    srv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(srv)
    with tempfile.TemporaryDirectory() as td:
        srv.ARCHIVE_DIR = Path(td)
        srv.STATS.clear()
        srv.SEEN.clear()
        day = srv.current_day_index()
        check(srv.tally("rounds", day, 2, "d1") and srv.tally("rounds", day, 3, "d2"),
              "unit: two fresh-day plays tallied")
        check(srv.write_archive("rounds", day) is True, "unit: snapshot written")
        p = Path(td) / "rounds" / ("%d.json" % day)
        check(p.exists(), "unit: snapshot file exists where expected")
        rec = srv.load_archive("rounds", day)
        check(rec and rec["n"] == 2 and rec["sum"] == 5, "unit: snapshot keeps plays + distribution")
        check(rec.get("date") == srv.day_date(day), "unit: snapshot labels the ET date")
        # the day rolls over: the stale board flushes to the archive and dies
        real_today = srv.current_day_index
        srv.current_day_index = lambda: day + 1
        srv.flush_stale()
        srv.current_day_index = real_today
        check(srv.STATS.get(("rounds", day)) is None, "unit: flushed board removed from memory")
        check(srv.load_archive("rounds", day)["n"] == 2, "unit: archive readable after the flush")
        # write-once: a smaller tally never replaces a bigger snapshot
        srv.STATS[("rounds", day)] = {"n": 1, "sum": 2, "sumsq": 4, "min": 2, "max": 2,
                                      "bins": [0, 0, 1, 0, 0, 0, 0]}
        check(srv.write_archive("rounds", day) is False, "unit: smaller tally never rewrites the archive")
        check(srv.load_archive("rounds", day)["n"] == 2, "unit: archive stays read-only")

    print("server tests: %s" % ("PASS" if not fails else "FAIL"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
