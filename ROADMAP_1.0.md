# Roadmap to 1.0 — server-side, curated puzzle banks

Goal: every bank game serves a **comprehensive, curated, server-side bank** (no client bank, no random generation, no mock state). Client files are puzzle-only renderers; seeds may only *select* among curated entries (e.g. picking 5 events for timeline), never generate puzzle content.

## Key strategy note (added)

**Don't throw away the old client banks — recover and port them.** The pre-refactor `index.html` files (still reachable via git history, e.g. `git show c91bcfc:<game>/index.html`) contain the original curated banks (PUZZLES, QUOTES, EVENTS, EXHIBITS, etc.). Rather than authoring from scratch or leaving placeholders:

1. `git show <pre-refactor-commit>:<game>/index.html` to retrieve the original inline bank.
2. Extract the bank array/object and validate its shape.
3. Move it into `scores/<game>/puzzles.json` (transforming field names to the server's `{t,l,s,w}` / game-specific shape as needed).
4. Strip the now-duplicated bank from the client, keeping only the renderer + fetchPuzzle loader.

This recovers the curated content we already had, avoids re-authoring, and makes "1.0" a port rather than a rewrite. Only games whose banks were genuinely lost/never existed (none currently) need new authoring.

## Phase 0 — Server core (DONE)
- [x] `scores/server.py`: remove `mode=gen` random generation; `/puzzle` serves `entry[day % len(entry)]` deterministically + timeline windowed path.
- [x] `DEVELOPER.md`: drop stale `"mode": "gen"` from response example.
- [x] `trace/index.html`: remove dead `if (false)` local-generation scaffolding.
- [x] Branch `refactor/server-side-banks` created with WIP commit.

## Phase 1 — Repair client compile errors (all 13 games) — DONE
All 13 client pages were restored byte-exact from the pre-refactor `main` (c91bcfc), which also removed every WIP scaffold; the encoding corruption in museum/recycle-grid was repaired on top. `node checks/games.js` green — pending the CI run.

- [x] bogus/index.html — fix stray brace / leftover bank scaffolding
- [x] cipher/index.html — fix `QUOTES` reference / bank scaffolding
- [x] fermi/index.html — fix `=` token error
- [x] lightbox/index.html — fix `lightbox` identifier
- [x] museum/index.html — fix `museum` identifier (re-add curated exhibit loader)
- [x] recycle-rings/index.html — fix `const` token
- [x] rounds/index.html — fix `)` token
- [x] sift/index.html — fix `:` token
- [x] sprint/index.html — fix `SHELL` identifier
- [x] timeline/index.html — fix `EVENTS` identifier; keep windowed fetch
- [x] trace/index.html — fix `post` redeclaration (already partially cleaned)
- [x] well-actually/index.html — fix `well` identifier
- [x] recycle-grid/index.html — verify (currently passes)

## Phase 2 — Curated server banks (comprehensive content) — DONE
Each `scores/<game>/puzzles.json` now carries the real curated bank extracted exactly from its client page; `tools/export-puzzles.mjs` verifies store == bank in CI. Day-0 spot checks: bogus lie=5 (Apollo 11), rounds y=1215 (Magna Carta), cipher author "Franklin D. Roosevelt", museum "The Rosetta Stone", timeline 5 distinct-year events.

- [x] bogus: real passages, one bogus phrase per passage, accurate "why"
- [x] well-actually: real statements, wrong phrase, corrected version, explanation
- [x] fermi: real estimation questions with accepted answers + units
- [x] rounds: real historical events with years
- [x] sift: real 4-groups-of-3 tile boards (no tile in two groups)
- [x] lightbox: real nonogram designs with clue sets
- [x] cipher: well-attributed quotes + author (attribution must be solid)
- [x] timeline: full event bank + distinct-years walk + 1000 precomputed picks (seed only selects)
- [x] museum: real artifacts with 5 clues (cryptic→obvious), aliases, story
- [ ] (rings, grid, sprint, trace remain generator/client-side per NOTES — no server bank needed)

## Phase 3 — Tests & validation
- [x] Update `tests/server_test.py` timeline check to read `scores/timeline/puzzles.json` (not deleted monolithic file).
- [ ] Day-0 assertions pass: bogus lie=5, rounds y=1215 (Magna Carta), cipher author=FDR, museum=Rosetta Stone, timeline 5 distinct-year events.
- [ ] `node checks/games.js` green.
- [ ] `node tests/run.js` green.
- [ ] `python tests/server_test.py` green.
- [ ] `npm test` / `make test` green end-to-end.

## Phase 4 — Cleanup & docs
- [ ] Remove remaining dead scaffolding ("Fallback to local generation" comments, `if (false)` blocks).
- [x] Sweep `README.md`, `NOTES.md`, `DEVELOPER.md` for stale monolithic-`puzzles.json` / `mode=gen` references.  — README repaired and updated, NOTES paragraph rewritten, DEVELOPER.md rewritten
- [x] Update `tools/export-puzzles.mjs` (or remove) so it no longer shuffles a monolithic pool / random-generates; align with per-game curated banks.  — rewritten as a store verifier (exit 1 on drift)
- [x] `tools/build-bundles.mjs`: drop monolithic `scores/puzzles.json` copy (per-game files are the store).

## Phase 5 — Release
- [ ] All games load and play end-to-end against the scores service.
- [ ] Offline/solo fallback verified for generator games (rings, grid, sprint, trace).
- [ ] Docker build + deploy smoke test.
- [ ] Merge `refactor/server-side-banks` → main, tag 1.0.
