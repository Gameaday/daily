# daily · daily.historylabs.dev

Morning warmup games for the History Labs team — one new puzzle per game per day,
self-hosted on a Raspberry Pi as dumb static files. No database, no accounts, no ads.

Everything is relative-pathed: the site works at warmup.historylabs.dev,
daily.historylabs.dev, an IP, or a LAN hostname — nothing is hardcoded.
Design notes and future ideas live in NOTES.md.

## Games

| Path | Game | Idea |
|---|---|---|
| / | Warmup | Landing page linking all games |
| /bogus/ | Bogus! | A history passage where one phrase is a lie — spot it in 3 picks |
| /well-actually/ | Well, Actually… | A statement with one wrong phrase — find it, then type the correction for a bonus point |
| /recycle-rings/ | Recycle: Rings | Three letter wheels and one target word on the marked ray — clock starts on your first spin and never restarts |
| /recycle-grid/ | Recycle: Grid | Shift rows and columns of a 5×5 letter grid to build words, then Bank It — the clock never restarts |
| /fermi/ | Fermi | One order-of-magnitude estimation question per day, one guess, scored by how close you land |
| /sift/ | Sift | Twelve tiles, four hidden groups of three, four mistakes allowed |
| /rounds/ | Rounds | Slide toward the year of a hidden event — hot, warm, or cold, in six guesses |
| /trace/ | Trace | A daily word ladder — change one letter at a time from start to target, par five rungs |
| /lightbox/ | Lightbox | A 7×7 nonogram; reason from the clues and develop a picture from history — four bad developments fog the film |
| /sprint/ | Sprint | Five anagrams against one 90-second clock that starts on your first keystroke and never restarts |
| /cipher/ | Cipher | A daily substitution cipher hiding a line of history — decode it; hints count against you |
| /timeline/ | Timeline | Five events with no dates; each check locks correct placements in place |
| /museum/ | Museum | Name the day's artifact from five clues, obscure to obvious |

## How "daily" works

Each game is a single self-contained index.html. The puzzle is derived from the date, not stored:

- puzzle number = days since the launch date, rolling over at midnight America/New_York
- puzzle content is picked from an in-file bank or generated from a seeded RNG — same for every player worldwide
- streaks and progress live in each player's localStorage (keys of the form warmup.GAME.v1; bogus and well-actually are on v2)
- change EPOCH_KEY in a game to reset its day numbering

So the Pi only ever serves bytes. Deploy with Caddy:

    warmup.historylabs.dev {
        handle_path /api/* {
            reverse_proxy 127.0.0.1:8787
        }
        handle {
            root * /srv/daily
            file_server
        }
    }

Caddy handles TLS automatically. Point DNS at the Pi (or use a tunnel if you are
behind CGNAT) and forward ports 80/443.

## The team curve (optional, ~200 lines of stdlib Python)

Every game can show how you fared relative to the team today: a distribution of
results with your bar highlighted, roughly how many you beat, and the team
average. No names, no high-score table — just the shape of the day.

Design constraints, on purpose:

- scores/server.py is stdlib-only Python (http.server) on 127.0.0.1:8787
- nothing is ever written to disk — no score logs, no database, no files; a
  restart forgets everything, and boards are pruned after 1 day (see NOTES.md
  for the archive idea)
- the server keeps ONLY consolidated numbers per (game, day): count, sum,
  sum of squares, min, max, and a small fixed histogram. There are no
  per-player records at all
- the client id is hashed to 8 bytes and kept only in a transient dedupe set:
  the first submission of the day stands, and reloads get a personalized reply
  without retallying. The raw id never leaves the digest set
- no user text is accepted or stored anywhere: the only inputs are the game
  slug (checked against a fixed allowlist), a bounded day number, a bounded
  numeric score, and the hashed id. Request bodies are capped at 2 KB
- which direction is "better" is defined server-side per game (rings: lower
  seconds; sprint: more words; cipher: fewer hints) — the client never decides it
- total RAM for a team of ~40 across thirteen games is a few dozen kilobytes
- if the service is off, each game quietly notes "team curve offline —
  playing solo today" and everything else works

Install on the Pi:

    sudo cp -r scores /srv/daily/scores
    sudo cp scores/warmup-scores.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now warmup-scores

The service uses DynamicUser (no persistent system user), binds to localhost
only, and runs with a hardened systemd sandbox (no capabilities, no writes
anywhere, memory cannot become executable). The games also try localhost
directly as a fallback, so a browser on the Pi itself still gets the curve
even without the Caddy proxy.

## The recycle rule

Rings, Grid, and Sprint share a mechanic worth keeping consistent in future games:
the clock starts on your first move and never restarts — not for retries, not
for reloading the page, not for the Recycle button. The score is what you bank
(time in Rings, words in Grid, words saved in Sprint), so recycling your position
is free but dithering is not. The clock even survives closing the tab (startAt
timestamp in state).

## Adding a game

1. Copy an existing game folder — they all share the same shell
   (header, daily selection, localStorage state, reveal + share, countdown, curve client).
2. Swap in your puzzle bank or seeded generator and the round logic.
3. Add a card to the landing page index.html and a row in this table.
4. If the game has a score, call syncBoard(value) on reveal — the value is the
   metric — and add the game to SPECS in scores/server.py with its "better"
   direction and histogram edges. The curve appears for free.

## Content rules (worth keeping)

- Exactly one bogus element per Bogus!/Well, Actually puzzle.
- Everything else must remain true after the correction is applied — watch trailing
  clauses that would contradict the corrected statement.
- Vary the lie position across puzzles; do not always put it in the last phrase.
- Fermi: use commonly cited figures, present them as "commonly cited," and let the
  generous ratio buckets (3x / 10x / 100x) absorb honest disagreement.
- Sift: four groups of exactly three per board, no tile in two groups on the same
  board, and at least one tile that plausibly belongs elsewhere — that is the fun.
- Cipher: only well-attributed quotes; the author is the crib, so the attribution
  must be solid. Verify facts before committing — the whole team will fact-check
  you every morning.

## Roadmap

- [x] Batch 2 games: Rounds, Trace, Lightbox, Sprint
- [x] Team curve: consolidated in-memory daily stats, zero disk, zero accounts
- [x] Batch 3 games: Cipher, Timeline, Museum
- [ ] Curve representation cleanup: drop the "better than N of M" prose for a
      pure distribution chart with a you-marker (see NOTES.md)
- [ ] Archived days: freeze finished days' distributions; archive replays score
      against the frozen curve without changing totals (see NOTES.md)
- [ ] Extract the shared shell (CSS + daily selection + stats + curve) into
      common.js so new games are ~100 lines each
- [ ] Archive pages for past puzzles
- [ ] Unified nav across games
