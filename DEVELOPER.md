# daily · Developer Documentation

**daily** is 16 morning warmup games for History Labs: one new puzzle per
game per day, self-hosted as dumb static files plus a tiny stdlib-only
Python scores service. Everything uses relative paths.

User-facing documentation lives in README.md; design notes and future ideas
in NOTES.md. This file is the short orientation for contributors.

## Architecture

- Each game is one self-contained `index.html` (puzzle + game logic).
- The shared shell (day math with midnight-ET rollover, localStorage, toast,
  countdown, help, share, the global-curve client) lives in
  `shell/common.js` / `shell/common.css`; games destructure what they need
  from the `SHELL` module.
- Word games share `assets/words-en.js` (`WORDS_EN`); Sprint keeps its own
  anagram banks by design.

## The knowledge layer

The history content is stored once, in `knowledge/`: entities (people,
events, places, artifacts, the wider world, animals) and quotes in one
id namespace, typed relations between them, the twist tellings for
bogus and well-actually, the shared stories, and each game's recipe.
`tools/build-knowledge.mjs` compiles the layer into the committed
per-game stores (`puzzles/<game>/puzzles.json`); CI runs it in verify
mode, so a hand-edited store or a layer change that shifts a store both
fail the build. `tools/export-puzzles.mjs` then re-emits the client
banks from the stores. `knowledge/SCHEMA.md` is the format reference.
New games arrive as recipes over the layer; lightbox stays
hand-banked by design.

## Puzzle delivery

Bank games (bogus, well-actually, rounds, fermi, cipher, museum, lightbox,
sift, timeline, thread, brunch, superlative) ship their bank inline (solo/offline play works with
zero infrastructure) and, when online, ask the scores service for the day's
puzzle:

    GET /api/puzzle?game=rounds&day=12   ->   { game, day, puzzle, today }

The served puzzle replaces the inline pick, so the online bundle ships with
every bank stripped (`tools/build-bundles.mjs`).

The server reads its puzzles from the committed per-game stores:

- `puzzles/<game>/puzzles.json`: the puzzle store, compiled from the
  knowledge layer (hand-banked only for lightbox) and
  deep-equal to the inline bank (verified in CI)
- `puzzles/timeline/puzzles.json` and `puzzles/thread/puzzles.json`:
  windowed, `{bank, picks}` with 1000 precomputed days
- sprint, trace, recycle-grid, recycle-rings: empty stores by design; the
  page generates boards at play time from seeded RNGs

To change history content, edit the knowledge layer, run
`node tools/build-knowledge.mjs --write`, then
`node tools/export-puzzles.mjs --write`, and push layer, stores and
banks together. For the hand-banked game (lightbox), edit the
game's `index.html` and run `node tools/export-puzzles.mjs --write`.
CI (verify mode) fails any store that drifts from the layer or from
its client bank.

## Scores server

`scores/server.py`, stdlib-only. Live state is in memory only: consolidated
per-(game, day) numbers (count, sum, sumsq, min, max, fixed histogram).
Client ids are blake2b-hashed to 8 bytes into a transient dedupe set; the
first submission of the day stands.

Fresh-day counting: a submission only tallies the live curve when its day
is the current day (ET). Stale submissions get the archived snapshot back
and change nothing; future days are rejected. This keeps the live weights
honest (only fresh puzzle-day plays count) and stops archive replays from
churning the numbers.

The archive handoff: when the first request arrives after midnight ET (and
again on shutdown), each finished day's numbers collapse into one static
snapshot at `<archive-dir>/<game>/<day>.json`:

    { "game", "day", "date", "n", "sum", "sumsq", "min", "max",
      "bins", "edges", "better" }

That is plays plus the score distribution plus the aggregates needed to
rebuild the weights. Written once, read-only forever, no per-player data.
`GET /dist?game=&day=` serves today from memory and past days from the
archive. The archive dir defaults to `scores/archive` and can be set with
`--archive-dir` (the compose stack mounts a named volume there; the systemd
unit wants one ReadWritePaths entry).

Endpoints (with or without the `/api` prefix): `POST /submit`,
`GET /dist?game=&day=`, `GET /puzzle?game=&day=`, `GET /manifest`,
`GET /health`. Cache policy: live endpoints are no-store; the day's
puzzle is public and cacheable until ET midnight; the manifest is
cacheable for an hour.
Metric directions ("better": high/low), histogram edges, the epoch, and
the timezone are owned by `scores/manifest.json`; server.py loads it at
boot, the client pages carry the same constants inline for offline play,
and CI cross-checks both sides against the manifest so neither can drift.
The client never decides them.

## Tests (all dependency-free)

    make test                          # or npm test
    node tools/build-knowledge.mjs     # verify the layer compiles to the stores
    node tools/export-puzzles.mjs      # verify committed stores vs client banks
    node checks/games.js               # compile every game + shell/id/landing wiring
    node tests/run.js                  # headless playthroughs + server-gated delivery
    python3 tests/server_test.py      # scores service API test (fresh-day + archive)

The Node layer is split per game: `tests/games/<game>.js` holds each
game's playthrough, `server-gated.js` the online-delivery tests,
`cross-checks.js` the shell/manifest/landing agreement checks, and
`tests/run.js` is only the orchestrator - dropping a game later means
deleting its folder and its module, nothing else.

CI (`.github/workflows/validate.yml`) runs the same layers on every push;
the Pi deploys only the newest stable `v*` tag whose validate run is green
(pushing a tag is the deploy act; see README).

## Adding a game

1. Copy an existing game folder; include `../shell/common.css` and
   `../shell/common.js`, then destructure what you need from `SHELL`.
2. Add the puzzle: a recipe over the knowledge layer for a history game,
   an inline bank (lightbox) or a seeded generator.
3. Add a card to the landing `index.html` and a row in README's games table.
4. If it has a score: call `syncBoard(value)` on reveal, add the game to
   `scores/manifest.json`, and for a layer game run
   `node tools/build-knowledge.mjs --write` then
   `node tools/export-puzzles.mjs --write`; for a hand-banked game just
   `node tools/export-puzzles.mjs --write`. Commit the stores either way.
5. Run `node checks/games.js` before you push.

## Copy conventions

New copy avoids em dashes (they keep surviving careless re-encoding as
mojibake; use commas, periods, semicolons, or parentheses). Bank literals in
client pages stay ASCII-safe via \uXXXX escapes; committed stores are plain
UTF-8. Well, Actually statements need at least four clickable phrases so
three picks can never brute-force the find.
