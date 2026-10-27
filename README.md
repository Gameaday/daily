# daily · daily.historylabs.dev

Morning warmup games for the History Labs team — one new puzzle per game per day,
self-hosted on a Raspberry Pi as dumb static files. No backend, no database, no accounts, no ads.

## Games

| Path | Game | Idea |
|---|---|---|
| / | Warmup | Landing page linking all games |
| /bogus/ | Bogus! | A history passage where one phrase is a lie — spot it in 3 picks |
| /well-actually/ | Well, Actually… | A statement with one wrong phrase — find it, then type the correction for a bonus point |

## How "daily" works (no server required)

Each game is a single self-contained index.html. The puzzle is derived from the date, not stored:

- puzzle number = days since the launch date, rolling over at midnight America/New_York
- puzzle content = PUZZLES[dayIndex % PUZZLES.length] — same for every player worldwide
- streaks and progress live in each player's localStorage
- change EPOCH_KEY in a game to reset its day numbering

So the Pi only ever serves bytes. Deploy with any static server, e.g. Caddy:

    warmup.historylabs.dev {
        root * /srv/daily
        file_server
    }

Caddy handles TLS automatically. Point DNS at the Pi (or use a tunnel if you are
behind CGNAT) and forward ports 80/443.

## Adding a game

1. Copy an existing game folder — bogus/ and well-actually/ share the same shell
   (header, daily selection, localStorage state, stats modal, share text, countdown).
2. Swap in your puzzle bank and the round logic.
3. Add a card to the landing page index.html.

## Content rules (worth keeping)

- Exactly one bogus element per puzzle.
- Everything else must remain true after the correction is applied — watch trailing
  clauses that would contradict the corrected statement.
- Vary the lie position across puzzles; do not always put it in the last phrase.
- Verify facts before committing — the whole team will fact-check you every morning.

## Roadmap

- [ ] Extract the shared shell (CSS + daily selection + stats) into common.js so new games are ~100 lines each
- [ ] Unified nav and theme across games
- [ ] More games: timeline ordering, year guessing, team mode with a room code
- [ ] Archive pages for past puzzles
