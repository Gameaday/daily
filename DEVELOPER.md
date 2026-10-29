# daily · Developer Documentation

## Project Overview

**daily** is a collection of 13 morning warmup games for History Labs (daily.historylabs.dev). Each game generates one new puzzle per day, self-hosted on a Raspberry Pi as dumb static files. The design is intentionally low-resource: stdlib-only Python server, zero disk writes, in-memory stats pruned after 1 day.

Everything uses relative paths — the site works at any domain, IP, or LAN hostname. Nothing is hardcoded to a specific domain.

---
## Running Locally

### Prerequisites

- **Python 3** (stdlib only — no pip dependencies required)
- **Node.js** (for generating puzzle banks: `npm run export`)

### Start the scores server

```bash
python3 scores/server.py
```

Server binds to `127.0.0.1:8787` by default. Plain HTTP — TLS belongs to the edge proxy in front of it.

### Generate puzzle banks

```bash
npm run export
```

or equivalently:

```bash
node tools/export-puzzles.mjs
```

This reads the game source files and generates `scores/puzzles.json` with the day's puzzle bank for each bank game.

## Adding a New Game

1. Create the game directory under the project root (e.g., `/new-game/`)

2. Add `index.html` with the game logic. The file must:
   - Include `../shell/common.css` for shared styling
   - Load `../shell/common.js` for shared functionality (palette, countdown, help, curve sync, share)
   - The puzzle is derived from the date, not stored — use the same seed-based approach as other games

3. Add shared references in `index.html`:
   ```html
   <link rel="stylesheet" href="../shell/common.css"/>
   <script src="../shell/common.js"></script>
   ```

4. Update `README.md` to document the new game in the games table

5. If the game needs a puzzle bank (bank games only):
   - The puzzle content is picked from an in-file bank or generated from a seeded RNG
   - Same puzzle for every player worldwide (deterministic from game:day seed)
   - See existing bank games for the pattern

6. If the game needs generator-based puzzles (rings, grid, sprint, trace, recycle-rings):
   - Puzzles are generated from a deterministic PRNG at play time
   - No server interaction needed for puzzle generation
   - Banks are client-side only

7. Test the game:
   - Run the server: `python3 scores/server.py`
   - Visit `http://127.0.0.1:8080/new-game/`
   - Verify the puzzle loads for the current day
## Scores Server API

The server runs on `127.0.0.1:8787` (default, configurable with `--host`/`--port`).

### Endpoints (with or without `/api` prefix):

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/submit` or `/api/submit` | Submit a guess value |
## Puzzle Uniqueness

Each game has a deterministic but unique sequence of puzzles:

- **Seed**: `blake2b(game:day)` produces a unique seed per game per day
- **mulberry32 PRNG**: deterministic but cycles after ~4 billion values
- **822 unique puzzles** per game (Oct 2026 – Dec 2028) without cycling/modulo issues
- Each game has its own seed for a unique sequence
| GET | `/dist?game=X&day=N` or `/api/dist?game=X&day=N` | Get consolidated stats for a game/day |
| `GET` | `/health` or `/api/health` | Health check: `{"ok": true}` |
## Commands Summary

```bash
# Start server
python3 scores/server.py

# Regenerate puzzle banks
npm run export      # or: node tools/export-puzzles.mjs

# Run tests (if applicable)
make test           # or: npm test

# Check project status
git status
git log --oneline -5
```

## Tools

This directory contains scripts for managing puzzle data and project maintenance.

| Script | Purpose |
|---|---|
| check-banks.js | Validates that each game's index.html uses etchPuzzle() to load puzzles from the scores service (no inline BANKS, no solo fallback). |

### check-banks.js

**Validates that each game's index.html fetches its puzzle from the scores service.**

Run: 
ode tools/check-banks.js. Reports: whether fetchPuzzle is used, whether BANKS or isSolo references remain.

### Maintenance Workflow

1. **Verify game files:** 
ode tools/check-banks.js
2. **Run game validation:** 
ode checks/games.js

### Design Notes

- **Server-driven puzzles:** Each game fetches its puzzle data from the scores service via etchPuzzle(game, dayIndex) on first load. Puzzle data lives in scores/<game>/puzzles.json (one file per game, 822 puzzles each). No inline const BANKS = [...] in frontend files.
- **Online only:** No isSolo() or offline fallback. All games require the scores service.
- **Per-game puzzle files:** scores/<game>/puzzles.json contains 822 puzzle entries per game, loaded by the server at startup.

### Design Notes

- **Deterministic PRNG:** All tools use `mulberry32` for reproducible puzzle selection
- **822-day horizon:** Banks cover Oct 2026 – Dec 2028 without repetition
- **Shared word bank:** `assets/words-en.js` (2230 common words, ~12KB) used by word games
- **Relative paths:** All scripts use relative paths from the project root
- **Solo/offline play:** Banks are embedded inline in `index.html` for zero-infrastructure play

```json
{
  "game": "bogus",
  "day": 42,
  "value": 2,
  "id": "client-unique-id"
}
```

### Response from /submit:

```json
{
  "game": "bogus",
  "day": 42,
  "n": 123,
  "sum": 247,
  "sumsq": 621,
  "min": 1,
  "max": 5,
  "histogram": [30, 45, 28, 15, 5],
  "today": "2026-10-28"
}
```

### GET /dist?game=X&day=N:

Returns the same snapshot data as POST /submit but without tallying — reloads get a personalized reply but do not retally.

### Design rules (from server.py docstring):

- **stdlib only**: no external dependencies
- **binds to 127.0.0.1**: not exposed to internet directly
- **zero disk writes**: only in-memory stats, pruned after 1 day
- **client IDs hashed to 8 bytes**: BLAKE2b, kept in transient dedupe set
- **Global scores lock after 1 day**: yesterday's curve are locked deliberately
- **input strictly validated* *: game in allowlist, day bounded, bodies capped at 2KB
- **no user text accepted or stored**: per design