# daily · daily.historylabs.dev

Morning warmup games for the History Labs team — one new puzzle per game per day,
self-hosted on a Raspberry Pi as dumb static files. No database, no accounts, no ads.

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

## The team board (optional, ~150 lines of stdlib Python)

Every game can show how you did against everyone else: a bell curve of today's
results, your place in it, and a top five. It is entirely optional — with the
board off, each game quietly notes "team board offline — playing solo today."

How it fits "no backend":

- scores/server.py is stdlib-only Python (http.server) listening on 127.0.0.1:8787
- scores live in RAM only: nothing is written to disk, nothing survives a restart,
  and boards older than 3 days are pruned
- no accounts: the browser generates a random id in localStorage and stores an
  optional display name; names are sanitized to 20 safe characters
- every game already contains the same small client: on finish it POSTs the result
  to /api/submit and renders the histogram it gets back

Install on the Pi:

    sudo cp -r scores /srv/daily/scores
    sudo cp scores/warmup-scores.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now warmup-scores

The service uses DynamicUser (no persistent system user) and binds to localhost,
so the board is only reachable through the Caddyfile's handle_path /api/* block
above. The games also try localhost directly as a fallback, so a browser on the
Pi itself still gets the board even without the proxy.

## The recycle rule

Rings, Grid, and Sprint share a mechanic worth keeping consistent in future games:
the clock starts on your first move and never restarts — not for retries, not
for reloading the page, not for the Recycle button. The score is what you bank
(time in Rings, words in Grid, words saved in Sprint), so recycling your position
is free but dithering is not. The clock even survives closing the tab (startAt
timestamp in state).

## Adding a game

1. Copy an existing game folder — they all share the same shell
   (header, daily selection, localStorage state, reveal + share, countdown, team-board client).
2. Swap in your puzzle bank or seeded generator and the round logic.
3. Add a card to the landing page index.html and a row in this table.
4. If the game has a score, call syncBoard(value) on reveal — with "better" set to
   "high" or "low" — and the bell curve appears for free.

## Content rules (worth keeping)

- Exactly one bogus element per Bogus!/Well, Actually puzzle.
- Everything else must remain true after the correction is applied — watch trailing
  clauses that would contradict the corrected statement.
- Vary the lie position across puzzles; do not always put it in the last phrase.
- Fermi: use commonly cited figures, present them as "commonly cited," and let the
  generous ratio buckets (3x / 10x / 100x) absorb honest disagreement.
- Sift: four groups of exactly three per board, no tile in two groups on the same
  board, and at least one tile that plausibly belongs elsewhere — that is the fun.
- Verify facts before committing — the whole team will fact-check you every morning.

## Roadmap

- [x] Batch 2 games: Rounds, Trace, Lightbox, Sprint
- [ ] Batch 3 candidates: Cipher (decode a daily substitution), Timeline (put the
      day's events in order), Museum (identify the day's artifact or artwork)
- [ ] Extract the shared shell (CSS + daily selection + stats + team board) into
      common.js so new games are ~100 lines each
- [ ] Archive pages for past puzzles
- [ ] Unified nav across games
