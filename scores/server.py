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
    POST /guess   {"nonce", "move": {...}}       -> the dealt verdict (dealt API schema below; the key never
                   crosses until the round is over)
    POST /reveal  {"nonce"}                          -> the sprint starting gun (t0 stamped once, never reset; the window is enforced at submit)

    Dealt API schema (one shape for every dealt game; required fields first):
      /deal   req  {"game": str (required, a dealt game), "day": int (required,
                    the live day)}
              res  {"nonce": str, "today": int, "puzzle": object (stripped per
                    its registry row, never the key)}
      /guess  req  {"nonce": str (required), "move": exactly one game payload:
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

The service is a package now: this file is the entry point and the
module map, and the suites that load it directly still see every old
name re-exported at the bottom. The layout, one seam per module:

    config    the manifest, the caps, the day clock, the lock
    helpers   the pure derivation helpers
    puzzles   the store loading and the day's answer-key entries
    sessions  the dealt nonce map and its reaper
    curve     the live boards, the tally, the snapshot
    archive   the snapshot write/load, the flush, the warm start
    adapters  the dealt registry: graders, evidence, strips, transforms
    evidence  the evidence validator that consults the rows
    app       the HTTP shell and main()

How it runs is unchanged: python3 server.py, the same flags, the
same endpoints, byte for byte on the wire.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import adapters
import app
import archive
import config
import curve
import evidence
import helpers
import puzzles
import sessions

from adapters import (DEALT_ADAPTERS, DEALT_GAMES, EVIDENCE_GAMES,
                      _Reject, dealt_puzzle)
from app import Handler, main
from archive import (archive_path, archived_spec, archived_stats,
                     flush_stale, load_archive, warm_start, write_archive)
from config import (ARCHIVE_DIR, DAY_MAX, DAY_MIN, EPOCH_KEY, IP_HITS,
                    LOCK, MAX_ABS_VALUE, MAX_BODY, MAX_DEALT_PER_IP,
                    MAX_GETS_PER_IP, MAX_POSTS_PER_IP, SPECS, SPRINT_GRACE,
                    SPRINT_PURGE, SPRINT_WINDOW, SESSION_TTL, TZ_NAME,
                    _MANIFEST, current_day_index, day_date,
                    seconds_to_midnight)
from curve import (SEEN, STATS, beat_estimate, bin_index, fit_bins,
                   snapshot, tally)
from evidence import validate_evidence
from helpers import (_ALPHA, _alnum_norm, _build_sub, _cipher_sub,
                     _meta_int, _mulberry32, _name_norm, _runs,
                     _text_norm, round_feedback)
from puzzles import PUZZLES, PUZZLES_DIR, _list_entry, _window_entry
from sessions import SESSIONS, purge_sessions

if __name__ == "__main__":
    main()
