"""The HTTP shell: routing, the per-IP caps, the cache policy and
main(). Every endpoint answers exactly as it always has."""


import argparse
import hashlib
import json
import math
import secrets
import signal
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import adapters
import archive
import config
import curve
import evidence
import puzzles
import sessions


# the wire contract version: it moves with the /guess envelope, and
# /health and /manifest speak it beside server_version
API_VERSION = 2


class Handler(BaseHTTPRequestHandler):
    server_version = "warmup-curve/4.9"

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
        today = config.current_day_index()
        with config.LOCK:
            rec = config.IP_HITS.get(ip)
            if rec is None or rec[0] != today:
                if len(config.IP_HITS) > 100000:
                    for k in [k for k, v in config.IP_HITS.items() if v[0] != today]:
                        config.IP_HITS.pop(k, None)
                rec = [today, 0, 0, 0]
                config.IP_HITS[ip] = rec
            idx = {"get": 1, "post": 2, "dealt": 3}[kind]
            rec[idx] += 1
            cap = {"get": config.MAX_GETS_PER_IP, "post": config.MAX_POSTS_PER_IP,
                   "dealt": config.MAX_DEALT_PER_IP}[kind]
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
            today = config.current_day_index()
            with config.LOCK:
                # day/num echo the clamped day math, so a curl shows exactly
                # what the server thinks "today" is
                payload = {"ok": True, "api_version": API_VERSION,
                           "boards": len(curve.STATS),
                           "day": today, "num": today + 1}
            self._json(payload)
        elif path == "/manifest":
            # the scoring truth (epoch, tz, per-game ledger) as plain
            # JSON, with the wire's api_version riding beside it
            payload = dict(config._MANIFEST)
            payload["api_version"] = API_VERSION
            self._json(payload, cache="public, max-age=3600")
        elif path in ("/dist", "/distribution"):
            qs = parse_qs(urlparse(self.path).query)
            game = (qs.get("game") or [""])[0]
            if game not in config.SPECS:
                self._json({"error": "unknown game"}, 400)
                return
            try:
                day = int((qs.get("day") or ["0"])[0])
            except ValueError:
                self._json({"error": "bad day"}, 400)
                return
            if not (config.DAY_MIN <= day <= config.DAY_MAX):
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
                if not math.isfinite(value) or abs(value) > config.MAX_ABS_VALUE:
                    self._json({"error": "bad value"}, 400)
                    return
            today = config.current_day_index()
            with config.LOCK:
                archive.flush_stale()
                if day > today:
                    self._json({"error": "future day not available"}, 403)
                    return
                if day == today:
                    payload = curve.snapshot(game, day, value)
                else:
                    rec = archive.load_archive(game, day)
                    payload = curve.snapshot(game, day, value, st=archive.archived_stats(rec),
                                       spec=archive.archived_spec(rec, game))
                    payload["archived"] = True
            self._json(payload)
        elif path == "/puzzle":
            qs = parse_qs(urlparse(self.path).query)
            game = (qs.get("game") or [""])[0]
            if game not in puzzles.PUZZLES:
                self._json({"error": "unknown game"}, 400)
                return
            try:
                day = int((qs.get("day") or ["0"])[0])
            except ValueError:
                self._json({"error": "bad day"}, 400)
                return
            if not (config.DAY_MIN <= day <= config.DAY_MAX):
                self._json({"error": "bad day"}, 400)
                return
            today = config.current_day_index()
            if day > today:
                self._json({"error": "future day not available"}, 403)
                return
            entry = puzzles.PUZZLES[game]
            if game == "thread":
                # thread: picks index the graph bank; a replayed day carries
                # the start, the end, the chain, the decoys and the links,
                # while the live dealt day ships the offered figures as one
                # shuffled tray, never the chain
                pz = puzzles._window_entry(game, day)
                if pz is None:
                    self._json({"error": "no puzzles"}, 404)
                    return
                if day == today:
                    pz = adapters.dealt_puzzle(game, pz, day)
                self._json({"game": game, "day": day, "today": today,
                            "puzzle": pz},
                           cache="public, max-age=%d" % config.seconds_to_midnight())
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
                if day == today and "strip" in adapters.DEALT_ADAPTERS.get(game, {}):
                    pz = adapters.dealt_puzzle(game, pz, day)
                self._json({"game": game, "day": day, "puzzle": pz, "today": today},
                           cache="public, max-age=%d" % config.seconds_to_midnight())
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
                if day == today and "strip" in adapters.DEALT_ADAPTERS.get(game, {}):
                    pz = adapters.dealt_puzzle(game, pz, day)
                self._json({"game": game, "day": day, "puzzle": pz, "today": today},
                           cache="public, max-age=%d" % config.seconds_to_midnight())
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
        if length <= 0 or length > config.MAX_BODY:
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
        if not isinstance(game, str) or game not in config.SPECS:
            self._json({"error": "unknown game"}, 400)
            return
        day = data.get("day")
        if isinstance(day, bool) or not isinstance(day, int) or not (config.DAY_MIN <= day <= config.DAY_MAX):
            self._json({"error": "bad day"}, 400)
            return
        if "answer" in data or "status" in data:
            # evidence path: the answer and the raw play facts come in,
            # the points come out - the client never names a number
            if game not in adapters.EVIDENCE_GAMES:
                self._json({"error": "evidence not accepted for this game"}, 400)
                return
            # a dealt session is the stronger claim: the server counted the
            # guesses and knows the verdict, so a nonce-bearing post reports
            # the session's facts, never the client's word. An unknown or
            # aged nonce is simply absent - the checks below stay as the
            # fallback for a session that dropped mid-game
            if isinstance(data.get("nonce"), str):
                with config.LOCK:
                    sessions.purge_sessions()
                    sess = sessions.SESSIONS.pop(data["nonce"], None)
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
                    meta_fn = adapters.DEALT_ADAPTERS.get(game, {}).get("meta")
                    data["meta"] = meta_fn(sess) if meta_fn else {}
            value, reason = evidence.validate_evidence(game, day, data)
            if value is None:
                self._json({"error": reason}, 422)
                return
        else:
            if game in adapters.EVIDENCE_GAMES:
                # the cutover: a gated game no longer accepts a self-reported
                # score - the answer and the play facts come in, and the
                # points are derived here or not counted at all
                self._json({"error": "value posts retired for this game - send evidence"}, 400)
                return
            value = data.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)) \
                    or not math.isfinite(value) or abs(value) > config.MAX_ABS_VALUE:
                self._json({"error": "bad value"}, 400)
                return
            # a dealt sprint session owns the clock: a claimed score only
            # stands if the server-stamped window says it could have
            # happened. A session that was never started, or aged past the
            # window, is over - the claim derives 0 and the nonce can
            # never re-enter the window
            if game == "sprint" and isinstance(data.get("nonce"), str):
                with config.LOCK:
                    sessions.purge_sessions()
                    sess = sessions.SESSIONS.get(data["nonce"])
                    t0 = sess.get("t0") if sess and sess["game"] == "sprint" else None
                if t0 is None or time.time() - t0 > config.SPRINT_WINDOW + config.SPRINT_GRACE:
                    value = 0
        pid = data.get("id")
        if not isinstance(pid, str) or not pid or len(pid) > 64:
            self._json({"error": "bad id"}, 400)
            return
        digest = hashlib.blake2b(pid.encode("utf-8"), digest_size=8).hexdigest()
        today = config.current_day_index()
        with config.LOCK:
            archive.flush_stale()
            if day > today:
                self._json({"error": "future day not counted"}, 403)
                return
            if day == today:
                # fresh puzzle day: this is the only thing that moves the curve
                curve.tally(game, day, value, digest)
                payload = curve.snapshot(game, day, value)
            else:
                # archive replay: answered from the frozen snapshot under its
                # own recorded edges, changes nothing
                rec = archive.load_archive(game, day)
                payload = curve.snapshot(game, day, value, st=archive.archived_stats(rec),
                                   spec=archive.archived_spec(rec, game))
                payload["archived"] = True
        self._json(payload)

    def _dealt(self, path, data):
        """The dealt-play endpoints: /deal opens a session, /guess plays a
        dealt round (rounds heat, the one-shot verdicts, well-actually's
        picks and correction, museum's names and clues, bogus's picks,
        superlative's rounds, sift's trios, lightbox's developments,
        cipher's checks and hints, timeline's and thread's checks), /reveal
        is the sprint starting gun. Every game's move nests under
        "move"; the session map mutates under the lock; a key leaves
        only when a round ends."""
        now = time.time()
        if path == "/deal":
            game = data.get("game")
            if not isinstance(game, str) or game not in adapters.DEALT_GAMES:
                self._json({"error": "dealt play is not open for this game"}, 400)
                return
            day = data.get("day")
            if isinstance(day, bool) or not isinstance(day, int) \
                    or not (config.DAY_MIN <= day <= config.DAY_MAX):
                self._json({"error": "bad day"}, 400)
                return
            today = config.current_day_index()
            if day != today:
                self._json({"error": "dealt play is for the live day"}, 403)
                return
            nonce = secrets.token_hex(16)
            with config.LOCK:
                sessions.purge_sessions()
                entry = puzzles.PUZZLES.get(game) or []
                adapter = adapters.DEALT_ADAPTERS.get(game) or {}
                pz = None
                if "strip" in adapter:
                    if adapter.get("windowed"):
                        pz = puzzles._window_entry(game, day)
                    elif entry:
                        pz = entry[day % len(entry)]
                    if pz is None:
                        self._json({"error": "no puzzles"}, 404)
                        return
                sessions.SESSIONS[nonce] = {"game": game, "day": day, "created": now,
                                   "ip": self.client_address[0], "guesses": 0,
                                   "done": False, "verdict": None, "t0": None,
                                   "picks": [], "found": False, "clue": 0,
                                   "mistakes": 0, "hints": 0, "solved": []}
                if pz is not None:
                    # the deal carries the question but never the key: the
                    # row's strip keeps the answer server-side
                    payload = {"nonce": nonce, "today": today,
                               "puzzle": adapters.dealt_puzzle(game, pz, day)}
                else:
                    payload = {"nonce": nonce, "today": today}
            self._json(payload)
            return
        nonce = data.get("nonce")
        if not isinstance(nonce, str) or not nonce or len(nonce) > 64:
            self._json({"error": "bad nonce"}, 400)
            return
        with config.LOCK:
            sessions.purge_sessions()
            sess = sessions.SESSIONS.get(nonce)
            if sess is None or sess["day"] != config.current_day_index():
                self._json({"error": "no session"}, 404)
                return
            if path == "/guess":
                guess = adapters.DEALT_ADAPTERS.get(sess["game"], {}).get("guess")
                if guess is None:
                    self._json({"error": "this session takes no guesses"}, 400)
                    return
                if sess["done"]:
                    self._json({"error": "the round is over"}, 409)
                    return
                move = data.get("move")
                if not isinstance(move, dict):
                    self._json({"error": "bad move"}, 400)
                    return
                try:
                    payload = guess(sess, move, now)
                except adapters._Reject as r:
                    self._json({"error": r.msg}, r.status)
                    return
            else:  # /reveal
                if sess["game"] != "sprint":
                    self._json({"error": "this session takes no starting gun"}, 400)
                    return
                if sess["t0"] is None:
                    sess["t0"] = now  # stamped once, never reset
                payload = {"ok": True, "elapsed": round(now - sess["t0"], 3),
                           "window": config.SPRINT_WINDOW}
            self._json(payload)


def main():
    ap = argparse.ArgumentParser(description="Warmup global curve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--archive-dir", default=str(config.ARCHIVE_DIR),
                    help="where finished days collapse into static snapshots")
    ap.add_argument("--max-gets-per-ip", type=int, default=config.MAX_GETS_PER_IP,
                    help="per-IP daily cap for GET endpoints")
    ap.add_argument("--max-posts-per-ip", type=int, default=config.MAX_POSTS_PER_IP,
                    help="per-IP daily cap for POST /submit")
    ap.add_argument("--max-dealt-per-ip", type=int, default=config.MAX_DEALT_PER_IP,
                    help="per-IP daily cap for the dealt-play endpoints")
    ap.add_argument("--session-ttl", type=float, default=config.SESSION_TTL,
                    help="seconds before an idle dealt session is purged")
    ap.add_argument("--sprint-purge", type=float, default=config.SPRINT_PURGE,
                    help="seconds after the starting gun before an unsubmitted sprint round is reaped")
    ap.add_argument("--epoch", default=None,
                    help="override the manifest epoch (the effective day 0 date); the test suite pins this so it never depends on the wall clock")
    args = ap.parse_args()
    config.ARCHIVE_DIR = Path(args.archive_dir)
    config.MAX_GETS_PER_IP = args.max_gets_per_ip
    config.MAX_POSTS_PER_IP = args.max_posts_per_ip
    config.MAX_DEALT_PER_IP = args.max_dealt_per_ip
    config.SESSION_TTL = args.session_ttl
    config.SPRINT_PURGE = args.sprint_purge
    if args.epoch:
        config.EPOCH_KEY = args.epoch

    # warm start: a mid-day restart (compose update, host reboot) flushed
    # today's partial boards to the archive on shutdown; bring them back
    # so the live curve never resets mid-day
    with config.LOCK:
        archive.warm_start(config.current_day_index())

    def _stop(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, _stop)

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("warmup global curve on %s:%d (fresh-day tallies only; archives in %s)"
          % (args.host, args.port, config.ARCHIVE_DIR))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with config.LOCK:
            archive.flush_stale(force=True)
