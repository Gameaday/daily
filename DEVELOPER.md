# daily · Developer Documentation

**daily** is 13 morning warmup games for History Labs (daily.historylabs.dev):
one new puzzle per game per day, self-hosted as dumb static files plus a tiny
stdlib-only Python scores service. Everything uses relative paths — the site
works at any domain, IP, or LAN hostname.

User-facing documentation lives in README.md; design notes and future ideas in
NOTES.md. This file is the short orientation for contributors.

## Architecture

- Each game is one self-contained `index.html` (puzzle + game logic).
- The shared shell — day math (midnight ET rollover), localStorage, toast,
  countdown, help, share, the global-curve client — lives in
  `shell/common.js` / `shell/common.css`; games destructure what they
  need from the `SHELL` module.
- Word games share `assets/words-en.js` (`WORDS_EN`); Sprint keeps its
  own anagram banks by design.

## Puzzle delivery

Bank games (bogus, well-actually, rounds, fermi, cipher, museum, lightbox,
sift, timeline) ship their curated bank inline — solo/offline play works
with zero infrastructure — and, when online, ask the scores service for the
day's puzzle:

    GET /api/puzzle?game=rounds&day=12   ->   { game, day, puzzle, today }

The served puzzle replaces the inline pick, so the published site carries no
tomorrow's answers: the online bundle ships with every bank stripped
(`tools/build-bundles.mjs`).

The server reads its puzzles from the committed per-game stores:

- `scores/<game>/puzzles.json` — the game's curated bank (deep-equal to
  the inline bank; `tools/export-puzzles.mjs` verifies this in CI)
- `scores/timeline/puzzles.json` — windowed: `{bank, picks}` with 1000
  precomputed days (the same five distinct-year events the offline page
  picks — same seed, same shuffle, same walk)
- sprint, trace, recycle-grid and recycle-rings are generator games: their
  stores are empty by design; the page generates boards at play time from
  seeded RNGs

To edit a bank: change the game's `index.html`, re-export its store, and
push both — CI fails a store that drifts from its client bank.

## Scores server

`scores/server.py` — stdlib-only, in-memory, zero disk writes. Keeps only
consolidated per-(game, day) numbers (count, sum, sumsq, min, max, fixed
histogram); client ids are blake2b-hashed to 8 bytes into a transient
dedupe set. Boards prune after 1 day. Binds to 127.0.0.1:8787 by default
(or inside the compose network); TLS belongs to the edge proxy.

Endpoints (with or without the `/api` prefix): `POST /submit`,
`GET /dist?game=&day=`, `GET /puzzle?game=&day=`, `GET /health`.

Metric directions ("better": high/low) and histogram edges are owned by the
`SPECS` table in server.py — the client never decides them.

## Tests (all dependency-free)

    make test                         # or npm test
    node tools/export-puzzles.mjs     # verify committed stores vs client banks
    node checks/games.js              # compile every game + shell/id/landing wiring
    node tests/run.js                 # headless playthroughs + server-gated delivery
    python3 tests/server_test.py     # scores service API test

CI (`.github/workflows/validate.yml`) runs the same layers on every push;
the Pi only deploys commits whose CI run is green.

## Adding a game

1. Copy an existing game folder; include `../shell/common.css` and
   `../shell/common.js`, then destructure what you need from `SHELL`.
2. Add the puzzle: an inline bank (bank game) or a seeded generator.
3. Add a card to the landing `index.html` and a row in README's games table.
4. If it has a score: call `syncBoard(value)` on reveal, add the game to
   `SPECS` in `scores/server.py`, and — for a bank game — commit a
   `scores/<game>/puzzles.json` store.
5. Run `node checks/games.js` before you push.
