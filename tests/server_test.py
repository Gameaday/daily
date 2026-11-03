#!/usr/bin/env python3
"""Integration test for scores/server.py - the global-curve service.

Spawns the real server on a scratch port and exercises the API with urllib:
health (bare and /api-prefixed), submit + dedupe (first submission of the day
stands), the /dist snapshot (with and without a personalizing value), strict
input validation, dealt play (session nonces, server-side heat, the
sprint starting gun, per-solve verdicts, session TTL), the dealt cutover
(the live rounds, brunch, fermi, well-actually and museum days ship
without their keys),
fresh-day counting (stale submits answered from the
archive, future days rejected), and the archive handoff itself, including
the dedupe set that survives a restart (a unit section that imports the module and walks a
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
from datetime import date, timedelta
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
    # every instance archives into its own scratch dir: the test must
    # never write snapshots into the repo's scores/archive, and the warm
    # start (which reloads today's snapshot on boot) must never carry one
    # instance's plays into another's checks
    scratch = tempfile.mkdtemp()
    scratch2 = tempfile.mkdtemp()
    scratch3 = tempfile.mkdtemp()
    scratch4 = tempfile.mkdtemp()
    scratch5 = tempfile.mkdtemp()
    scratch6 = tempfile.mkdtemp()
    scratch7 = tempfile.mkdtemp()
    # Every instance boots with --epoch <today's ET date>: inside them the
    # current day index is 0 no matter the real calendar and no matter whether
    # the committed epoch lies in the past or the future, so this suite never
    # depends on the wall clock.
    ET_TODAY = date.fromisoformat(MANIFEST["epoch"]) + timedelta(days=today_day())
    TODAY = 0
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT), "--host", "127.0.0.1", "--archive-dir", scratch,
         "--epoch", str(ET_TODAY)],
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
        check(b.get("day") == TODAY and b.get("num") == TODAY + 1,
              "GET /health -> the clamped day index echoes (day/num)")
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
        #     per-game stores under puzzles/<game>/puzzles.json) ---
        if not (ROOT / "puzzles" / "bogus" / "puzzles.json").exists():
            check(False, "puzzles/bogus/puzzles.json missing")
        else:
            s, b = req("GET", "/api/puzzle?game=bogus&day=0")
            check(s == 200 and b.get("puzzle", {}).get("l") == 5,
                  "GET /puzzle bogus day 0 -> lie is statement 5")
            s, b = req("GET", "/api/puzzle?game=rounds&day=0")
            check(s == 200 and b.get("puzzle", {}).get("q", "").startswith("King John")
                  and "y" not in b.get("puzzle", {}) and "w" not in b.get("puzzle", {}),
                  "GET /puzzle rounds day 0 (live) -> the question, never the key")
            s, b = req("GET", "/api/puzzle?game=brunch&day=0")
            check(s == 200 and "a" not in b.get("puzzle", {})
                  and "w" not in b.get("puzzle", {})
                  and len(b.get("puzzle", {}).get("opts", [])) == 4,
                  "GET /puzzle brunch day 0 (live) -> the table, never the impostor")
            s, b = req("GET", "/api/puzzle?game=fermi&day=0")
            check(s == 200 and "a" not in b.get("puzzle", {})
                  and "w" not in b.get("puzzle", {})
                  and b.get("puzzle", {}).get("q"),
                  "GET /puzzle fermi day 0 (live) -> the question, never the cited value")
            s, b = req("GET", "/api/puzzle?game=well-actually&day=0")
            check(s == 200 and "l" not in b.get("puzzle", {})
                  and "a" not in b.get("puzzle", {})
                  and "c" not in b.get("puzzle", {})
                  and "w" not in b.get("puzzle", {})
                  and len(b.get("puzzle", {}).get("s", [])) >= 4,
                  "GET /puzzle well-actually day 0 (live) -> the statement, never the lie")
            s, b = req("GET", "/api/puzzle?game=museum&day=0")
            check(s == 200 and "a" not in b.get("puzzle", {})
                  and "al" not in b.get("puzzle", {})
                  and "w" not in b.get("puzzle", {})
                  and len(b.get("puzzle", {}).get("c", [])) == 5,
                  "GET /puzzle museum day 0 (live) -> the clues, never the name")
            s, b = req("GET", "/api/puzzle?game=timeline&day=0")
            ev = b.get("puzzle", {}).get("events", [])
            check(s == 200 and len(ev) == 5, "GET /puzzle timeline day 0 -> 5 events")
            check(len({e.get("y") for e in ev}) == 5, "GET /puzzle timeline -> distinct years")
            store = json.loads((ROOT / "puzzles" / "timeline" / "puzzles.json").read_text(encoding="utf-8"))
            exp = [store["bank"][i] for i in store["picks"][0]]
            check(ev == exp, "GET /puzzle timeline matches the committed picks")
            s, b = req("GET", "/api/puzzle?game=thread&day=0")
            pz = b.get("puzzle", {})
            check(s == 200 and pz.get("s", {}).get("id") and pz.get("e", {}).get("id"),
                  "GET /puzzle thread day 0 -> start and end nodes")
            check(2 <= len(pz.get("m", [])) <= 4, "GET /puzzle thread -> 2-4 middles")
            check(len(pz.get("d", [])) == 2, "GET /puzzle thread -> two decoys")
            check(len(pz.get("links", [])) == len(pz.get("m", [])) + 1,
                  "GET /puzzle thread -> one link per hop")
            tstore = json.loads((ROOT / "puzzles" / "thread" / "puzzles.json").read_text(encoding="utf-8"))
            tp = tstore["picks"][0]
            check(pz["s"]["id"] == tp["s"] and pz["e"]["id"] == tp["e"]
                  and [n["id"] for n in pz["m"]] == tp["m"]
                  and [n["id"] for n in pz["d"]] == tp["d"],
                  "GET /puzzle thread matches the committed picks")
            s, b = req("GET", "/api/puzzle?game=timeline&day=-1")
            check(s == 404, "GET /puzzle windowed negative day -> 404")
            s, b = req("GET", "/api/puzzle?game=nosuchgame&day=0")
            check(s == 400, "GET /puzzle unknown game -> 400")
            s, b = req("GET", "/api/puzzle?game=bogus&day=notanumber")
            check(s == 400, "GET /puzzle bad day -> 400")
            s, b = req("GET", "/api/puzzle?game=bogus&day=99999")
            check(s == 403, "GET /puzzle future day -> 403")

        # --- fresh-day submit + dedupe ---
        s, b = post("/api/submit", {"game": "rings", "day": TODAY, "value": 3,
                                    "better": "high", "id": "a"})
        check(s == 200 and b.get("count") == 1, "first submit counts (today)")
        # same id, different value: deduped, first value stands
        s, b = post("/api/submit", {"game": "rings", "day": TODAY, "value": 0,
                                    "better": "high", "id": "a"})
        check(s == 200 and b.get("count") == 1 and b.get("mean") == 3,
              "re-submit same id is deduped (first stands, mean stays 3)")
        # a second player moves the mean to 2.5
        s, b = post("/api/submit", {"game": "rings", "day": TODAY,
                                    "value": 2, "better": "high", "id": "b"})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 2.5,
              "second player: count 2, mean 2.5")
        check(b.get("better") == "high", "snapshot echoes server-side direction")
        check(b.get("beat") in (0, 1, 2), "snapshot includes a beat estimate")
        check(b.get("archived") is None, "today's snapshot is live, not archived")

        # --- fresh-day counting: stale and future submissions ---
        s, b = post("/api/submit", {"game": "rings", "day": TODAY - 1,
                                    "value": 0, "better": "high", "id": "stale"})
        check(s == 200 and b.get("archived") is True and b.get("count") == 0,
              "stale submit -> archived snapshot, no live tally")
        s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "stale submit did not touch today's curve")
        s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY - 1))
        check(s == 200 and b.get("archived") is True and b.get("count") == 0,
              "GET /dist for a past day -> archived snapshot")
        s, b = post("/api/submit", {"game": "rings", "day": TODAY + 5,
                                    "value": 3, "better": "high", "id": "future"})
        check(s == 403, "future day submit rejected")
        s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY + 5))
        check(s == 403, "future day dist rejected")

        # --- dist endpoint ---
        s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "GET /api/dist -> count 2")
        check(isinstance(b.get("bins"), list) and len(b["bins"]) >= 4,
              "dist returns histogram bins")
        s, b = req("GET", "/dist?game=rings&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "GET /dist (no prefix) works")
        s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY) + "&v=3")
        check(s == 200 and b.get("count") == 2 and b.get("beat") in (0, 1, 2),
              "GET /dist with a value personalizes without tallying")
        s, _b = req("GET", "/api/dist?game=rings&day=" + str(TODAY) + "&v=abc")
        check(s == 400, "GET /dist with a bad value is rejected")

        # --- validation: the server is the source of truth ---
        s, _b = post("/api/submit", {"game": "nope", "day": TODAY, "value": 1,
                                     "better": "high", "id": "c"})
        check(s == 400, "unknown game rejected")
        s, _b = post("/api/submit", {"game": "rings", "day": "x", "value": 3,
                                     "better": "high", "id": "d"})
        check(s == 400, "non-integer day rejected")
        s, _b = post("/api/submit", {"game": "rings", "day": TODAY, "value": "3",
                                     "better": "high", "id": "e"})
        check(s == 400, "string value rejected")
        s, _b = post("/api/submit", {"game": "rings", "day": TODAY, "value": 3,
                                     "better": "high", "id": ""})
        check(s == 400, "empty id rejected")
        s, _b = post("/api/submit", {"game": "rings", "day": TODAY, "value": 3,
                                     "better": "high"})
        check(s == 400, "missing id rejected")
        # oversized body -> 413 (2 KB cap)
        s, _b = post("/api/submit", {"game": "rings", "day": TODAY, "value": 3,
                                     "better": "high", "id": "z" * 3000})
        check(s == 413, "oversized body rejected")
        # out-of-range values clamp into the final bin instead of corrupting bins
        s, b = post("/api/submit", {"game": "sprint", "day": TODAY, "value": 99,
                                    "better": "high", "id": "big"})
        check(s == 200 and b["bins"][-1]["count"] == 1 and b.get("count") == 1,
              "value beyond last edge clamps into the final bin")
        # day bounds
        s, _b = post("/api/submit", {"game": "rings", "day": 100001, "value": 3,
                                     "better": "high", "id": "f"})
        check(s == 400, "day beyond DAY_MAX rejected")
        # dist validation
        s, _b = req("GET", "/api/dist?game=nope&day=0")
        check(s == 400, "GET /dist unknown game rejected")
        s, _b = req("GET", "/api/dist?game=rings&day=x")
        check(s == 400, "GET /dist bad day rejected")
        s, _b = req("GET", "/api/dist?game=rings&day=100001")
        check(s == 400, "GET /dist day beyond DAY_MAX rejected")
        # stale tallies live per game: another game's stale submit is archived too
        s, b = post("/api/submit", {"game": "trace", "day": TODAY - 1,
                                    "value": 2, "better": "high", "id": "old"})
        check(s == 200 and b.get("archived") is True, "stale submit in another game also archived")
        s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY))
        check(s == 200 and b.get("count") == 2, "other games' stale days do not touch rings")

        # --- evidence-based validation: the answer and the play facts come
        #     in, the points come out - the client never names a number ---
        def ev(game, body):
            return post("/api/submit", dict(body, game=game, day=TODAY))

        s, b = ev("rounds", {"id": "ev1", "status": "won", "answer": 1215,
                             "meta": {"guesses": 2}})
        check(s == 200 and b.get("count") == 1 and b.get("mean") == 2,
              "evidence: rounds won in 2 guesses -> server derives 2")
        s, _b = ev("rounds", {"id": "ev2", "status": "won", "answer": 1943,
                              "meta": {"guesses": 1}})
        check(s == 422, "evidence: the wrong year is rejected")
        s, _b = ev("rounds", {"id": "ev3", "status": "won", "answer": 1215,
                              "meta": {"guesses": 0}})
        check(s == 422, "evidence: meta below the cap is rejected")
        s, b = ev("rounds", {"id": "ev4", "status": "lost"})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 1,
              "evidence: a loss is 0 points, enforced server-side (mean 1)")
        s, b = ev("bogus", {"id": "ev5", "status": "won", "answer": [5]})
        check(s == 200 and b.get("mean") == 3,
              "evidence: bogus first-pick find -> 3")
        s, _b = ev("bogus", {"id": "ev6", "status": "won", "answer": [0]})
        check(s == 422, "evidence: bogus wrong pick rejected")
        s, b = ev("well-actually", {"id": "ev7", "status": "won",
                                    "answer": {"picks": [1], "typed": "Leonardo da Vinci"}})
        check(s == 200 and b.get("mean") == 4,
              "evidence: found it and named the correction -> 4")
        s, b = ev("well-actually", {"id": "ev8", "status": "won",
                                    "answer": {"picks": [1], "typed": "nope"}})
        check(s == 200 and b.get("mean") == 3.5,
              "evidence: a wrong correction earns no bonus (mean 3.5)")
        s, b = ev("fermi", {"id": "ev9", "status": "won", "answer": 2500000000})
        check(s == 200 and b.get("count") == 1 and b.get("mean") == 3,
              "evidence: fermi spot-on derives 3")
        s, b = ev("fermi", {"id": "ev10", "status": "won", "answer": 1000000})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 1.5,
              "evidence: fermi beyond 100x derives 0 (mean 1.5)")
        s, b = ev("brunch", {"id": "ev11", "status": "won", "answer": 3})
        check(s == 200 and b.get("mean") == 1, "evidence: brunch right pick -> 1")
        s, _b = ev("brunch", {"id": "ev12", "status": "won", "answer": 0})
        check(s == 422, "evidence: brunch wrong pick rejected")
        s, b = ev("brunch", {"id": "ev13", "status": "lost", "answer": 0})
        check(s == 200 and b.get("mean") == 0.5, "evidence: brunch loss -> 0")
        sup = json.loads((ROOT / "puzzles" / "superlative" / "puzzles.json")
                         .read_text(encoding="utf-8"))[0]
        perfect = [q["a"] for q in sup["q"]]
        s, b = ev("superlative", {"id": "ev14", "status": "won", "answer": perfect})
        check(s == 200 and b.get("mean") == len(perfect),
              "evidence: superlative clean sweep -> full marks")
        imperfect = list(perfect)
        imperfect[0] = (imperfect[0] + 1) % len(sup["m"])
        s, b = ev("superlative", {"id": "ev15", "status": "lost", "answer": imperfect})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 4.5,
              "evidence: superlative partial credit is derived, not claimed")
        s, b = ev("museum", {"id": "ev16", "status": "won", "answer": "rosetta stone",
                             "meta": {"clues": 2}})
        check(s == 200 and b.get("mean") == 2,
              "evidence: museum named on clue 2 -> 2")
        s, _b = ev("museum", {"id": "ev17", "status": "won", "answer": "the mona lisa",
                              "meta": {"clues": 1}})
        check(s == 422, "evidence: museum wrong artifact rejected")
        sif = json.loads((ROOT / "puzzles" / "sift" / "puzzles.json")
                        .read_text(encoding="utf-8"))[0]
        s, b = ev("sift", {"id": "ev18", "status": "won",
                           "answer": [c["i"] for c in sif["cats"]],
                           "meta": {"mistakes": 1}})
        check(s == 200 and b.get("mean") == 2, "evidence: sift one-mistake win -> 2")
        bad = [list(c["i"]) for c in sif["cats"]]
        bad[0][0], bad[1][0] = bad[1][0], bad[0][0]
        s, _b = ev("sift", {"id": "ev19", "status": "won", "answer": bad,
                            "meta": {"mistakes": 0}})
        check(s == 422, "evidence: sift wrong grouping rejected")
        lb = json.loads((ROOT / "puzzles" / "lightbox" / "puzzles.json")
                        .read_text(encoding="utf-8"))[0]
        s, b = ev("lightbox", {"id": "ev20", "status": "won", "answer": lb["g"],
                               "meta": {"mistakes": 0}})
        check(s == 200 and b.get("mean") == 3, "evidence: lightbox clean grid -> 3")
        cip = json.loads((ROOT / "puzzles" / "cipher" / "puzzles.json")
                         .read_text(encoding="utf-8"))[0]
        s, b = ev("cipher", {"id": "ev21", "status": "won", "answer": cip["q"].lower(),
                             "meta": {"hints": 1}})
        check(s == 200 and b.get("mean") == 2,
              "evidence: cipher decoded with one hint -> 2")
        tl = json.loads((ROOT / "puzzles" / "timeline" / "puzzles.json")
                        .read_text(encoding="utf-8"))
        tyears = sorted(tl["bank"][i]["y"] for i in tl["picks"][0])
        s, b = ev("timeline", {"id": "ev22", "status": "won", "answer": tyears,
                               "meta": {"checks": 1}})
        check(s == 200 and b.get("mean") == 3,
              "evidence: timeline first-check win -> 3")
        s, _b = ev("timeline", {"id": "ev23", "status": "won",
                                "answer": list(reversed(tyears)),
                                "meta": {"checks": 1}})
        check(s == 422, "evidence: timeline wrong order rejected")
        th = json.loads((ROOT / "puzzles" / "thread" / "puzzles.json")
                        .read_text(encoding="utf-8"))
        tp = th["picks"][0]
        s, b = ev("thread", {"id": "ev24", "status": "won",
                             "answer": [tp["s"]] + list(tp["m"]) + [tp["e"]],
                             "meta": {"checks": 2}})
        check(s == 200 and b.get("mean") == 2, "evidence: thread two-check win -> 2")
        s, _b = ev("rings", {"id": "ev25", "status": "won", "answer": "anything"})
        check(s == 400, "evidence: generator games have no evidence path yet")
        s, b = ev("sift", {"id": "ev26", "status": "lost", "answer": [],
                           "meta": {"mistakes": 4}})
        check(s == 200 and b.get("count") == 2,
              "evidence: a sift loss at the fourth mistake still tallies")
        s, b = ev("cipher", {"id": "ev27", "status": "won", "answer": cip["q"],
                             "meta": {"hints": 5}})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 1,
              "evidence: a cipher win on the fifth hint derives 0, not a rejection")
        s, b = ev("timeline", {"id": "ev28", "status": "won", "answer": tyears,
                               "meta": {"checks": 12}})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 1.5,
              "evidence: a timeline win on the twelfth check derives 0, not a rejection")
        s, b = post("/api/submit", {"game": "bogus", "day": TODAY,
                                    "value": 3, "id": "legacy1"})
        check(s == 400, "cutover: a self-reported value post for a gated game is refused")

        # --- dealt play (1.2): the answers stop shipping to the client ---
        s, _b = post("/api/deal", {"game": "rings", "day": TODAY})
        check(s == 400, "deal: a game that has not moved to dealt play is refused")
        s, _b = post("/api/deal", {"game": "rounds", "day": "x"})
        check(s == 400, "deal: a non-integer day is refused")
        s, _b = post("/api/deal", {"game": "rounds", "day": TODAY + 5})
        check(s == 403, "deal: a future day is refused")
        s, _b = post("/api/deal", {"game": "rounds", "day": TODAY - 1})
        check(s == 403, "deal: a stale day is refused (replays stay on /puzzle)")
        s, b = post("/api/deal", {"game": "rounds", "day": TODAY})
        check(s == 200 and isinstance(b.get("nonce"), str)
              and len(b["nonce"]) == 32,
              "deal: rounds opens a session under a 32-char nonce")
        check("y" not in b.get("puzzle", {}) and "w" not in b.get("puzzle", {}),
              "deal: the target year and the reveal line never cross the wire")
        check(b.get("puzzle", {}).get("q", "").startswith("King John"),
              "deal: the day's question still arrives")
        rn = b["nonce"]
        s, b = post("/api/guess", {"nonce": rn, "y": 1900})
        check(s == 200 and b.get("verdict") == "miss" and b.get("guesses") == 1
              and b.get("heat") == "cold"
              and b.get("hint") == "go earlier \u00b7 wrong century",
              "guess: a miss is answered with heat and direction, never distance")
        s, b = post("/api/guess", {"nonce": rn, "y": 1217})
        check(s == 200 and b.get("guesses") == 2 and b.get("heat") == "scalding"
              and b.get("hint") == "go earlier \u00b7 right decade",
              "guess: within two years reads scalding")
        s, b = post("/api/guess", {"nonce": rn, "y": 1213})
        check(s == 200 and b.get("guesses") == 3
              and b.get("hint") == "go later \u00b7 right decade",
              "guess: the direction flips without the distance ever leaking")
        s, _b = post("/api/guess", {"nonce": rn, "y": "1215"})
        check(s == 400, "guess: a string year is refused")
        s, b = post("/api/guess", {"nonce": rn, "y": 1216})
        check(s == 200 and b.get("verdict") == "miss" and b.get("guesses") == 4,
              "guess: the fourth guess still misses")
        s, b = post("/api/guess", {"nonce": rn, "y": 1218})
        check(s == 200 and b.get("verdict") == "miss" and b.get("guesses") == 5
              and b.get("heat") == "hot",
              "guess: three years off reads hot")
        s, b = post("/api/guess", {"nonce": rn, "y": 2000})
        check(s == 200 and b.get("verdict") == "lost" and b.get("guesses") == 6,
              "guess: the sixth miss ends the round")
        check(b.get("reveal", {}).get("y") == 1215
              and "Runnymede" in b.get("reveal", {}).get("w", ""),
              "guess: the loss reveal carries the key only once the round is over")
        s, _b = post("/api/guess", {"nonce": rn, "y": 1215})
        check(s == 409, "guess: a finished session refuses further guesses")
        # the server counted all six: a nonce-bearing claim cannot under-report
        s, b = post("/api/submit", {"game": "rounds", "day": TODAY, "id": "dv1",
                                    "status": "won", "answer": 1215,
                                    "meta": {"guesses": 1}, "nonce": rn})
        check(s == 200 and b.get("count") == 3 and b.get("mean") == 0.67,
              "dealt submit: the session's verdict and count override the claim")
        s, b = post("/api/deal", {"game": "rounds", "day": TODAY})
        rn2 = b["nonce"]
        s, b = post("/api/guess", {"nonce": rn2, "y": 1500})
        check(s == 200 and b.get("verdict") == "miss",
              "guess: a fresh session plays on")
        s, b = post("/api/guess", {"nonce": rn2, "y": 1215})
        check(s == 200 and b.get("verdict") == "won" and b.get("guesses") == 2
              and b.get("reveal", {}).get("y") == 1215,
              "guess: the right year wins the round")
        s, b = post("/api/submit", {"game": "rounds", "day": TODAY, "id": "dv2",
                                    "status": "won", "answer": 1215,
                                    "meta": {"guesses": 1}, "nonce": rn2})
        check(s == 200 and b.get("count") == 4 and b.get("mean") == 1.0,
              "dealt submit: the server's guess count overrides the client's word")
        # --- dealt sprint: the starting gun is a server timestamp ---
        s, b = post("/api/deal", {"game": "sprint", "day": TODAY})
        check(s == 200 and isinstance(b.get("nonce"), str),
              "deal: sprint opens a timed session")
        sn = b["nonce"]
        s, _b = post("/api/guess", {"nonce": sn, "y": 1215})
        check(s == 400, "guess: a sprint session takes no year guesses")
        s, b = post("/api/reveal", {"nonce": sn})
        check(s == 200 and b.get("ok") is True and b.get("elapsed") == 0,
              "reveal: the starting gun stamps t0 once")
        s, b = post("/api/reveal", {"nonce": sn})
        check(s == 200 and b.get("elapsed") < 5,
              "reveal: a second reveal never restarts the clock")
        # the 400 needs a live rounds session: rn2 was consumed by its
        # own evidence submit (a spent nonce is no session), so deal one
        s, b = post("/api/deal", {"game": "rounds", "day": TODAY})
        rn3 = b["nonce"]
        s, _b = post("/api/reveal", {"nonce": rn3})
        check(s == 400, "reveal: a rounds session is not a starting gun")
        s, _b = post("/api/guess", {"nonce": "no-such-session", "y": 1215})
        check(s == 404, "guess: an unknown nonce is no session")
        s, b = post("/api/submit", {"game": "sprint", "day": TODAY, "value": 5,
                                    "better": "high", "id": "dv3", "nonce": sn})
        check(s == 200 and b.get("count") == 2 and b["bins"][-1]["you"] is True,
              "dealt submit: a claim inside the server-stamped window tallies")
        s, b = post("/api/submit", {"game": "sprint", "day": TODAY, "value": 5,
                                    "better": "high", "id": "dv4",
                                    "nonce": "deadbeef" * 4})
        check(s == 200 and b.get("count") == 3 and b["bins"][0]["you"] is True,
              "dealt submit: an unknown session derives 0 - the clock cannot be re-entered")
        s, b = post("/api/deal", {"game": "sprint", "day": TODAY})
        sn3 = b["nonce"]
        s, b = post("/api/submit", {"game": "sprint", "day": TODAY, "value": 5,
                                    "better": "high", "id": "dv5", "nonce": sn3})
        check(s == 200 and b.get("count") == 4 and b["bins"][0]["you"] is True,
              "dealt submit: claiming a score without ever starting derives 0")
        # --- dealt brunch and fermi: one guess ends the round, so the
        #     reveal can only arrive attached to a spent pick ---
        s, b = post("/api/deal", {"game": "brunch", "day": TODAY})
        check(s == 200 and isinstance(b.get("nonce"), str)
              and "a" not in b.get("puzzle", {}) and "w" not in b.get("puzzle", {})
              and len(b.get("puzzle", {}).get("opts", [])) == 4,
              "deal: brunch opens a session, the table arrives without its impostor")
        bn = b["nonce"]
        s, _b = post("/api/guess", {"nonce": bn, "pick": "x"})
        check(s == 400, "guess: brunch refuses a non-integer pick")
        s, _b = post("/api/guess", {"nonce": bn, "pick": 4})
        check(s == 400, "guess: brunch refuses an off-table pick")
        s, b = post("/api/guess", {"nonce": bn, "pick": 0})
        check(s == 200 and b.get("verdict") == "lost"
              and b.get("reveal", {}).get("a") == 3,
              "guess: a wrong pick is lost, the reveal rides the spent pick")
        s, _b = post("/api/guess", {"nonce": bn, "pick": 3})
        check(s == 409, "guess: a finished brunch session refuses a second pick")
        s, _b = post("/api/reveal", {"nonce": bn})
        check(s == 400, "reveal: a brunch session is not a starting gun")
        s, b = post("/api/submit", {"game": "brunch", "day": TODAY, "id": "dv6",
                                    "status": "won", "answer": 3, "nonce": bn})
        check(s == 200 and b.get("count") == 3 and b.get("mean") == 0.33,
              "dealt submit: the session's lost verdict overrides the claimed win")
        s, b = post("/api/deal", {"game": "brunch", "day": TODAY})
        bn2 = b["nonce"]
        s, b = post("/api/guess", {"nonce": bn2, "pick": 3})
        check(s == 200 and b.get("verdict") == "won"
              and b.get("reveal", {}).get("a") == 3,
              "guess: the right seat wins the table")
        s, b = post("/api/submit", {"game": "brunch", "day": TODAY, "id": "dv7",
                                    "status": "lost", "answer": 0, "nonce": bn2})
        check(s == 200 and b.get("count") == 4 and b.get("mean") == 0.5,
              "dealt submit: the session's won verdict overrides the claimed loss")
        s, b = post("/api/deal", {"game": "fermi", "day": TODAY})
        check(s == 200 and isinstance(b.get("nonce"), str)
              and "a" not in b.get("puzzle", {}) and "w" not in b.get("puzzle", {}),
              "deal: the fermi question arrives without its cited value")
        fn = b["nonce"]
        s, _b = post("/api/guess", {"nonce": fn, "v": -1})
        check(s == 400, "guess: fermi refuses a non-positive estimate")
        s, b = post("/api/guess", {"nonce": fn, "v": 2500000000})
        check(s == 200 and b.get("verdict") == "won" and b.get("score") == 3
              and b.get("reveal", {}).get("a") == 2500000000,
              "guess: a spot-on estimate scores 3, the cited value rides the spent guess")
        s, _b = post("/api/guess", {"nonce": fn, "v": 2500000000})
        check(s == 409, "guess: a finished fermi session refuses a second estimate")
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY, "id": "dv8",
                                    "status": "won", "answer": 1000000,
                                    "nonce": fn})
        check(s == 200 and b.get("count") == 3 and b.get("mean") == 2.0,
              "dealt submit: fermi points derive from the session's estimate, not the claim")
        s, b = post("/api/deal", {"game": "fermi", "day": TODAY})
        fn2 = b["nonce"]
        s, b = post("/api/guess", {"nonce": fn2, "v": 1000000})
        check(s == 200 and b.get("score") == 0,
              "guess: a wild estimate scores 0, the ratio buckets live server-side")
        s, b = post("/api/submit", {"game": "fermi", "day": TODAY, "id": "dv9",
                                    "status": "won", "answer": 2500000000,
                                    "nonce": fn2})
        check(s == 200 and b.get("count") == 4 and b.get("mean") == 1.5,
              "dealt submit: the session's wild estimate overrides the claimed spot-on")
        # --- dealt well-actually: the lie never ships, so every pick and
        #     the one correction attempt travel to the session ---
        s, b = post("/api/deal", {"game": "well-actually", "day": TODAY})
        check(s == 200 and isinstance(b.get("nonce"), str)
              and "l" not in b.get("puzzle", {})
              and "a" not in b.get("puzzle", {})
              and "c" not in b.get("puzzle", {})
              and "w" not in b.get("puzzle", {})
              and len(b.get("puzzle", {}).get("s", [])) >= 4,
              "deal: the statement arrives without its lie")
        wn = b["nonce"]
        s, _b = post("/api/guess", {"nonce": wn, "pick": "x"})
        check(s == 400, "guess: well-actually refuses a non-integer pick")
        s, _b = post("/api/guess", {"nonce": wn, "correction": "Leonardo"})
        check(s == 400, "guess: the correction cannot precede the find")
        s, b = post("/api/guess", {"nonce": wn, "pick": 0})
        check(s == 200 and b.get("verdict") == "miss" and b.get("left") == 2,
              "guess: a wrong pick misses, the lie stays hidden")
        s, _b = post("/api/guess", {"nonce": wn, "pick": 0})
        check(s == 400, "guess: a phrase cannot be picked twice")
        s, b = post("/api/guess", {"nonce": wn, "pick": 1})
        check(s == 200 and b.get("verdict") == "found",
              "guess: the lie is found, no reveal yet")
        s, b = post("/api/guess", {"nonce": wn, "correction": "leonardo"})
        check(s == 200 and b.get("verdict") == "won"
              and b.get("bonus") == "correct"
              and b.get("reveal", {}).get("c") == "Leonardo",
              "guess: the correction rides the spent attempt")
        s, _b = post("/api/guess", {"nonce": wn, "pick": 2})
        check(s == 409, "guess: a finished well-actually session takes no more picks")
        s, b = post("/api/submit", {"game": "well-actually", "day": TODAY,
                                    "id": "dv10", "status": "won",
                                    "answer": {"picks": [1],
                                               "typed": "Leonardo da Vinci"},
                                    "nonce": wn})
        check(s == 200 and b.get("count") == 3 and b.get("mean") == 3.33,
              "dealt submit: the session's picks and correction override the claim")
        s, b = post("/api/deal", {"game": "well-actually", "day": TODAY})
        wn2 = b["nonce"]
        s, b = post("/api/guess", {"nonce": wn2, "pick": 0})
        s, b = post("/api/guess", {"nonce": wn2, "pick": 2})
        s, b = post("/api/guess", {"nonce": wn2, "pick": 3})
        check(s == 200 and b.get("verdict") == "lost"
              and b.get("reveal", {}).get("l") == 1,
              "guess: three strikes lose, the lie rides the spent round")
        s, b = post("/api/submit", {"game": "well-actually", "day": TODAY,
                                    "id": "dv11", "status": "won",
                                    "answer": {"picks": [1],
                                               "typed": "Leonardo"},
                                    "nonce": wn2})
        check(s == 200 and b.get("count") == 4 and b.get("mean") == 2.5,
              "dealt submit: the session's lost verdict overrides the claimed win")
        # --- dealt museum: the name never ships and the session meters
        #     the clues, so the reveal rides the spent guess ---
        s, b = post("/api/deal", {"game": "museum", "day": TODAY})
        check(s == 200 and isinstance(b.get("nonce"), str)
              and "a" not in b.get("puzzle", {})
              and "al" not in b.get("puzzle", {})
              and "w" not in b.get("puzzle", {})
              and len(b.get("puzzle", {}).get("c", [])) == 5,
              "deal: the exhibit arrives without its name")
        mn = b["nonce"]
        s, _b = post("/api/guess", {"nonce": mn, "name": ""})
        check(s == 400, "guess: museum refuses an empty name")
        s, b = post("/api/guess", {"nonce": mn, "name": "not it"})
        check(s == 200 and b.get("verdict") == "miss"
              and b.get("clueIdx") == 1,
              "guess: a wrong name buys the next clue, metered by the session")
        s, b = post("/api/guess", {"nonce": mn, "clue": 1})
        check(s == 200 and b.get("verdict") == "clue"
              and b.get("clueIdx") == 2,
              "guess: a clue request meters itself")
        s, b = post("/api/guess", {"nonce": mn, "name": "the rosetta stone"})
        check(s == 200 and b.get("verdict") == "won"
              and b.get("reveal", {}).get("a") == "The Rosetta Stone",
              "guess: the name rides the spent guess")
        s, _b = post("/api/guess", {"nonce": mn, "name": "rosetta"})
        check(s == 409, "guess: a finished museum session takes no more guesses")
        s, b = post("/api/submit", {"game": "museum", "day": TODAY,
                                    "id": "dv12", "status": "won",
                                    "answer": "rosetta",
                                    "meta": {"clues": 1},
                                    "nonce": mn})
        check(s == 200 and b.get("count") == 2 and b.get("mean") == 1.5,
              "dealt submit: the session's clue meter overrides the claim")
        s, b = post("/api/deal", {"game": "museum", "day": TODAY})
        mn2 = b["nonce"]
        for _i in range(4):
            s, b = post("/api/guess", {"nonce": mn2, "clue": 1})
        s, _b = post("/api/guess", {"nonce": mn2, "clue": 1})
        check(s == 400, "guess: the fifth clue request is refused")
        s, b = post("/api/guess", {"nonce": mn2, "name": "not it"})
        check(s == 200 and b.get("verdict") == "lost",
              "guess: a wrong name at the last clue ends the visit")
        s, b = post("/api/submit", {"game": "museum", "day": TODAY,
                                    "id": "dv13", "status": "won",
                                    "answer": "rosetta stone",
                                    "meta": {"clues": 1},
                                    "nonce": mn2})
        check(s == 200 and b.get("count") == 3 and b.get("mean") == 1.0,
              "dealt submit: a lost visit overrides the claimed win")
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
         "--port", str(PORT2), "--host", "127.0.0.1", "--archive-dir", scratch2,
         "--epoch", str(ET_TODAY),
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
                      {"game": "rings", "day": TODAY, "value": 3,
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

    # --- pre-launch: before the epoch the day index clamps at 0 (the
    #     client clamps the same way in shell/common.js), so the launch
    #     weekend serves No. 1 and day-0 plays tally into the launch day's
    #     board. This instance boots with a future epoch to pin that. ---
    PORT3 = PORT + 2
    proc3 = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT3), "--host", "127.0.0.1", "--archive-dir", scratch3,
         "--epoch", str(ET_TODAY + timedelta(days=2))],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health", port=PORT3)
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            check(False, "pre-launch instance never came up on port %d" % PORT3)
        else:
            s, b = req("GET", "/api/puzzle?game=bogus&day=0", port=PORT3)
            check(s == 200 and b.get("puzzle", {}).get("l") == 5,
                  "pre-epoch: day 0 (No. 1) is served, not future")
            s, _b = req("GET", "/api/puzzle?game=bogus&day=1", port=PORT3)
            check(s == 403, "pre-epoch: day 1 stays future")
            s, b = post("/api/submit", {"game": "rings", "day": 0,
                                        "value": 3, "better": "high", "id": "pre"},
                        port=PORT3)
            check(s == 200 and b.get("count") == 1,
                  "pre-epoch: day 0 submit tallies live")
            s, b = req("GET", "/api/dist?game=rings&day=0", port=PORT3)
            check(s == 200 and b.get("count") == 1,
                  "pre-epoch: day 0 dist is live")
    finally:
        proc3.terminate()
        try:
            proc3.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc3.kill()
    # --- warm start: a mid-day restart flushed today's partial board to
    #     the archive on SIGTERM; a fresh boot brings it back, so
    #     restarts never reset the day's live curve ---
    PORT4 = PORT + 3
    args4 = [sys.executable, str(ROOT / "scores" / "server.py"),
             "--port", str(PORT4), "--host", "127.0.0.1", "--archive-dir", scratch4,
             "--epoch", str(ET_TODAY)]
    proc4 = subprocess.Popen(args4, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health", port=PORT4)
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            check(False, "warm-start instance never came up on port %d" % PORT4)
        else:
            s, b = post("/api/submit", {"game": "rings", "day": TODAY,
                                        "value": 4, "better": "high", "id": "w1"},
                        port=PORT4)
            check(s == 200 and b.get("count") == 1,
                  "warm start: the live instance tallies one play")
            proc4.terminate()
            proc4.wait(timeout=5)
            check((Path(scratch4) / "rings" / ("%d.json" % TODAY)).exists(),
                  "warm start: SIGTERM flushed today's partial board")
            proc4b = subprocess.Popen(args4, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                up = False
                for _ in range(50):
                    try:
                        s, _b = req("GET", "/health", port=PORT4)
                        if s == 200:
                            up = True
                            break
                    except Exception:
                        pass
                    time.sleep(0.1)
                if not up:
                    check(False, "restarted instance never came up on port %d" % PORT4)
                else:
                    s, b = req("GET", "/api/dist?game=rings&day=" + str(TODAY), port=PORT4)
                    check(s == 200 and b.get("count") == 1,
                          "warm start: the restarted instance serves the flushed partial day")
                    s, b = post("/api/submit", {"game": "rings", "day": TODAY,
                                                "value": 6, "better": "high", "id": "w2"},
                                port=PORT4)
                    check(s == 200 and b.get("count") == 2,
                          "warm start: new plays tally on top of the restored board")
                    s, b = post("/api/submit", {"game": "rings", "day": TODAY,
                                                "value": 9, "better": "high", "id": "w1"},
                                port=PORT4)
                    check(s == 200 and b.get("count") == 2 and b.get("mean") == 5,
                          "warm start: a pre-restart id stays deduped (no re-tally on revisit)")
            finally:
                proc4b.terminate()
                try:
                    proc4b.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc4b.kill()
    finally:
        if proc4.poll() is None:
            proc4.terminate()
            try:
                proc4.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc4.kill()

    # --- dealt-play rate limiting: its own per-IP daily cap ---
    PORT5 = PORT + 4
    proc5 = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT5), "--host", "127.0.0.1", "--archive-dir", scratch5,
         "--epoch", str(ET_TODAY), "--max-dealt-per-ip", "2"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health", port=PORT5)
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            check(False, "dealt-cap instance never came up on port %d" % PORT5)
        else:
            d = [post("/api/deal", {"game": "sprint", "day": TODAY}, port=PORT5)[0]
                 for _ in range(3)]
            check(d[:2] == [200, 200] and d[2] == 429,
                  "dealt cap: 2 per IP allowed, the 3rd is 429")
            s, b = post("/api/submit", {"game": "rings", "day": TODAY, "value": 3,
                                        "better": "high", "id": "dc"}, port=PORT5)
            check(s == 200 and b.get("count") == 1,
                  "dealt cap: submit traffic still flows under its own cap")
    finally:
        proc5.terminate()
        try:
            proc5.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc5.kill()

    # --- session TTL: an aged dealt session is gone for good, and the 1.1
    #     evidence checks stay as the fallback for a dropped session ---
    PORT6 = PORT + 5
    proc6 = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT6), "--host", "127.0.0.1", "--archive-dir", scratch6,
         "--epoch", str(ET_TODAY), "--session-ttl", "1", "--sprint-purge", "1"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health", port=PORT6)
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            check(False, "ttl instance never came up on port %d" % PORT6)
        else:
            s, b = post("/api/deal", {"game": "rounds", "day": TODAY}, port=PORT6)
            n6 = b["nonce"]
            s, b = post("/api/guess", {"nonce": n6, "y": 1900}, port=PORT6)
            check(s == 200 and b.get("verdict") == "miss",
                  "ttl: the session answers while fresh")
            time.sleep(1.3)
            s, _b = post("/api/guess", {"nonce": n6, "y": 1215}, port=PORT6)
            check(s == 404, "ttl: an aged session is no session")
            s, b = post("/api/submit", {"game": "rounds", "day": TODAY, "id": "tt1",
                                        "status": "won", "answer": 1215,
                                        "meta": {"guesses": 2}, "nonce": n6},
                        port=PORT6)
            check(s == 200 and b.get("count") == 1 and b.get("mean") == 2,
                  "ttl: an aged rounds nonce falls back to 1.1 validation")
            s, b = post("/api/deal", {"game": "sprint", "day": TODAY}, port=PORT6)
            s6 = b["nonce"]
            s, _b = post("/api/reveal", {"nonce": s6}, port=PORT6)
            time.sleep(1.3)
            s, b = post("/api/submit", {"game": "sprint", "day": TODAY, "value": 5,
                                        "better": "high", "id": "tt2", "nonce": s6},
                        port=PORT6)
            check(s == 200 and b.get("count") == 1 and b["bins"][0]["you"] is True,
                  "ttl: an aged sprint session derives 0, never the claim")
    finally:
        proc6.terminate()
        try:
            proc6.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc6.kill()

    # --- the dealt cutover: the live rounds day ships without its key, and
    #     a replayed day keeps it (the archive path grades locally). This
    #     instance boots with a past epoch, so inside it day 0 is history
    #     and day 1 is the live day ---
    PORT7 = PORT + 6
    proc7 = subprocess.Popen(
        [sys.executable, str(ROOT / "scores" / "server.py"),
         "--port", str(PORT7), "--host", "127.0.0.1", "--archive-dir", scratch7,
         "--epoch", str(ET_TODAY - timedelta(days=1))],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(50):
            try:
                s, _b = req("GET", "/health", port=PORT7)
                if s == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not up:
            check(False, "cutover instance never came up on port %d" % PORT7)
        else:
            s, b = req("GET", "/api/puzzle?game=rounds&day=0", port=PORT7)
            check(s == 200 and b.get("puzzle", {}).get("y") == 1215,
                  "cutover: a replayed rounds day still carries its key")
            s, b = req("GET", "/api/puzzle?game=rounds&day=1", port=PORT7)
            check(s == 200 and "y" not in b.get("puzzle", {})
                  and "w" not in b.get("puzzle", {}),
                  "cutover: the live rounds day ships without its key")
            s, b = req("GET", "/api/puzzle?game=bogus&day=0", port=PORT7)
            check(s == 200 and b.get("puzzle", {}).get("l") == 5,
                  "cutover: the other games' puzzles are untouched")
            bz = json.loads((ROOT / "puzzles" / "brunch" / "puzzles.json")
                            .read_text(encoding="utf-8"))[0]
            s, b = req("GET", "/api/puzzle?game=brunch&day=0", port=PORT7)
            check(s == 200 and b.get("puzzle", {}).get("a") == bz["a"]
                  and "w" in b.get("puzzle", {}),
                  "cutover: a replayed brunch day still carries its key")
            s, b = req("GET", "/api/puzzle?game=brunch&day=1", port=PORT7)
            check(s == 200 and "a" not in b.get("puzzle", {})
                  and len(b.get("puzzle", {}).get("opts", [])) == 4,
                  "cutover: the live brunch day ships the table, never the impostor")
            s, b = req("GET", "/api/puzzle?game=fermi&day=0", port=PORT7)
            check(s == 200 and b.get("puzzle", {}).get("a") == 2500000000,
                  "cutover: a replayed fermi day still carries its key")
            s, b = req("GET", "/api/puzzle?game=fermi&day=1", port=PORT7)
            check(s == 200 and "a" not in b.get("puzzle", {})
                  and "w" not in b.get("puzzle", {}),
                  "cutover: the live fermi day ships without its cited value")
            s, b = req("GET", "/api/puzzle?game=well-actually&day=0", port=PORT7)
            check(s == 200 and b.get("puzzle", {}).get("l") == 1,
                  "cutover: a replayed well-actually day still carries its lie")
            s, b = req("GET", "/api/puzzle?game=well-actually&day=1", port=PORT7)
            check(s == 200 and "l" not in b.get("puzzle", {})
                  and "a" not in b.get("puzzle", {})
                  and "c" not in b.get("puzzle", {}),
                  "cutover: the live well-actually day ships without its lie")
            s, b = req("GET", "/api/puzzle?game=museum&day=0", port=PORT7)
            check(s == 200 and b.get("puzzle", {}).get("a") == "The Rosetta Stone",
                  "cutover: a replayed museum day still carries its name")
            s, b = req("GET", "/api/puzzle?game=museum&day=1", port=PORT7)
            check(s == 200 and "a" not in b.get("puzzle", {})
                  and "al" not in b.get("puzzle", {})
                  and len(b.get("puzzle", {}).get("c", [])) == 5,
                  "cutover: the live museum day ships the clues, never the name")
    finally:
        proc7.terminate()
        try:
            proc7.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc7.kill()

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
        check(isinstance(rec.get("seen"), list) and len(rec["seen"]) == 2,
              "unit: the snapshot carries the day's dedupe set")
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
        # a failed snapshot write keeps the live board: the next flush
        # retries instead of silently losing the day's numbers
        srv.STATS[("rounds", day)] = {"n": 5, "sum": 15, "sumsq": 55, "min": 1,
                                      "max": 6, "bins": [0, 0, 0, 0, 5, 0, 0]}
        srv.SEEN[("rounds", day)] = {"retry1"}
        real_write = srv.write_archive
        real_today = srv.current_day_index
        srv.current_day_index = lambda: day + 1
        srv.write_archive = lambda g, d: None if d == day else real_write(g, d)
        srv.flush_stale()
        check(srv.STATS.get(("rounds", day)) is not None,
              "unit: a failed snapshot write keeps the live board")
        srv.write_archive = real_write
        srv.flush_stale()
        srv.current_day_index = real_today
        check(srv.STATS.get(("rounds", day)) is None,
              "unit: the retried flush archives and clears the board")
        check(srv.load_archive("rounds", day)["n"] == 5,
              "unit: the retry wrote the day's numbers after all")

        # --- a manifest change must never crash the service: history
        #     serves under the edges it was recorded under ---
        real_edges = srv.SPECS["rounds"]["edges"]
        srv.SPECS["rounds"]["edges"] = [0, 1, 2]  # pretend the manifest moved
        snap = srv.snapshot("rounds", day, 2, st=srv.archived_stats(rec),
                            spec=srv.archived_spec(rec, "rounds"))
        check(len(snap["bins"]) == len(real_edges) - 1
              and sum(b["count"] for b in snap["bins"]) == rec["n"],
              "unit: an archived day serves under its recorded edges")
        snap2 = srv.snapshot("rounds", day, 2,
                              st={"n": 3, "sum": 6, "sumsq": 14, "min": 1,
                                  "max": 3, "bins": [3]})
        check(len(snap2["bins"]) == 2 and sum(b["count"] for b in snap2["bins"]) == 3,
              "unit: a short board is fitted to the served bins, never an index error")
        srv.STATS[("rounds", day)] = {"n": 1, "sum": 2, "sumsq": 4, "min": 2,
                                      "max": 2, "bins": [1, 0, 0, 0, 0, 0, 0]}
        srv.SEEN[("rounds", day)] = set()
        srv.tally("rounds", day, 1, "fresh-id")
        check(srv.STATS[("rounds", day)]["bins"] == [0, 1],
              "unit: tally reshapes an inherited board instead of trusting its shape")
        srv.SPECS["rounds"]["edges"] = real_edges

        # --- warm start vs a manifest change: restart, do not crash ---
        with tempfile.TemporaryDirectory() as td2:
            srv.ARCHIVE_DIR = Path(td2)
            srv.STATS.clear()
            srv.SEEN.clear()
            day0 = srv.current_day_index()
            bad = Path(td2) / "rounds" / ("%d.json" % day0)
            bad.parent.mkdir(parents=True, exist_ok=True)
            bad.write_text(json.dumps({
                "game": "rounds", "day": day0, "n": 3, "sum": 9, "sumsq": 29,
                "min": 1, "max": 5, "bins": [3], "seen": ["x1", "x2", "x3"],
                "edges": [0, 1], "better": "low"}), encoding="utf-8")
            good = Path(td2) / "brunch" / ("%d.json" % day0)
            good.parent.mkdir(parents=True, exist_ok=True)
            good.write_text(json.dumps({
                "game": "brunch", "day": day0, "n": 2, "sum": 2, "sumsq": 2,
                "min": 1, "max": 1,
                "bins": [0] * (len(srv.SPECS["brunch"]["edges"]) - 1),
                "seen": ["y1"],
                "edges": srv.SPECS["brunch"]["edges"],
                "better": srv.SPECS["brunch"]["better"]}), encoding="utf-8")
            srv.warm_start(day0)
            check(srv.STATS.get(("rounds", day0)) is None,
                  "unit: warm start restarts a board recorded under other edges")
            check(srv.STATS.get(("brunch", day0)) is not None
                  and srv.STATS[("brunch", day0)]["n"] == 2,
                  "unit: warm start still loads a board recorded under current edges")

        # --- an unreadable snapshot never silences a bigger live tally ---
        srv.ARCHIVE_DIR = Path(td)
        srv.STATS[("rounds", day)] = {"n": 5, "sum": 15, "sumsq": 55, "min": 1,
                                      "max": 6, "bins": [0, 0, 0, 0, 5, 0, 0]}
        p.write_text("{not json", encoding="utf-8")
        check(srv.write_archive("rounds", day) is True,
              "unit: a corrupt snapshot is replaced by the live board")
        check(srv.load_archive("rounds", day)["n"] == 5,
              "unit: the overwrite carries the day's numbers")

    print("server tests: %s" % ("PASS" if not fails else "FAIL"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
