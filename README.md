# daily · daily.historylabs.dev

Morning warmup games for the History Labs team — one new puzzle per game per day,
self-hosted on a Raspberry Pi as dumb static files. No backend, no database, no accounts, no ads.

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

## How "daily" works (no server required)

Each game is a single self-contained index.html. The puzzle is derived from the date, not stored:

- puzzle number = days since the launch date, rolling over at midnight America/New_York
- puzzle content is picked from an in-file bank or generated from a seeded RNG — same for every player worldwide
- streaks and progress live in each player's localStorage (keys of the form warmup.GAME.v1)
- change EPOCH_KEY in a game to reset its day numbering

So the Pi only ever serves bytes. Deploy with any static server, e.g. Caddy:

    warmup.historylabs.dev {
        root * /srv/daily
        file_server
    }

Caddy handles TLS automatically. Point DNS at the Pi (or use a tunnel if you are
behind CGNAT) and forward ports 80/443.

## The recycle rule

Rings and Grid share a mechanic worth keeping consistent in future games:
the clock starts on your first move and never restarts — not for retries, not
for reloading the page, not for the Recycle button. The score is what you bank
(time in Rings, words in Grid), so recycling your position is free but
dithering is not. The clock even survives closing the tab (startAt timestamp
in state). Sprint (roadmap) should reuse this exact rule.

## Adding a game

1. Copy an existing game folder — they all share the same shell
   (header, daily selection, localStorage state, reveal + share, countdown).
2. Swap in your puzzle bank or seeded generator and the round logic.
3. Add a card to the landing page index.html and a row in this table.

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

- [ ] Batch 2 games: Rounds (year slider, hot/cold), Trace (word ladders),
      Lightbox (mini nonogram), Sprint (anagrams vs the shared recycle clock)
- [ ] Extract the shared shell (CSS + daily selection + stats) into common.js so new games are ~100 lines each
- [ ] Unified nav and theme across games
- [ ] Team mode with a room code
- [ ] Archive pages for past puzzles
