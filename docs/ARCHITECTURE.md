# Architecture

daily is 17 morning warmup games: static pages, a stdlib-only scores
service, and a compiled knowledge layer underneath. This is the map of
the whole: what each part is, what it owns, why the seams sit where
they do, and where growth is meant to happen. DEVELOPER.md stays the
short orientation for contributors; docs/API.md is the wire contract
the scores service speaks.

## The system in one picture

    knowledge/                        the authored layer, the single source of truth
      |
      | tools/build-knowledge.mjs     deterministic compile
      v
    puzzles/<game>/puzzles.json       committed stores, the server's key rings
      |
      | tools/export-puzzles.mjs      re-emit for the client
      v
    assets/banks/<game>.js            client banks, the offline schedule
      |
      v
    <game>/index.html + shell/        the games, experience only
                   |
                   | /puzzle /deal /guess /submit /dist
                   v
    scores/server.py (package) + manifest.json  the scores service, grading and the curve

Content only flows downward, requests only flow upward, and no layer
reaches back up to rewrite the one above it.

## The planes

### The knowledge plane: knowledge/

History content is authored once, here: entities in one id namespace
(people, events, places, artifacts, the wider world, animals), typed
relations between them, quotes with sources, cited facts, the twist
tellings for bogus and well-actually, the shared stories, and each
game's recipe. knowledge/SCHEMA.md is the format reference. Authoring
happens here and nowhere else.

### The build plane: tools/

Deterministic compilers with no runtime and no state:
build-knowledge.mjs compiles the layer into the committed stores,
export-puzzles.mjs re-emits the client banks from the stores,
thread-walk.mjs regenerates the thread store, build-bundles.mjs builds
the offline and online bundles, make-valid-en.mjs curates the shared
word list. Their contract is byte identity: CI recompiles on every
push and fails the build if any committed store or bank drifts, so a
hand edit cannot survive.

### The delivery plane: the pages and the shell

Each game is one self-contained index.html: its puzzle, its rules, its
layout. Everything that is not the puzzle lives in shell/common.js:
day math (midnight ET rollover, dayIndex clamped at 0 before launch),
archive walking (?d=N replays a finished day, quarantined in memory),
localStorage persistence, toast, countdown, help, share, the global
curve client, the puzzle fetcher, the dealt session client and its
local repeat guard (a move that already got its verdict is answered
in the page, so a retread costs no round trip). A game
page builds moves and renders reveals; the shell carries them. The
seam is enforced: checks/games.js fails any page that lets shell code
creep back in.

### The scores plane: scores/

server.py and its sibling modules (stdlib only) plus manifest.json.
This is where every truth lives: the day's answer keys (read from the same committed stores the
client banks compile from), the dealt sessions and their counters,
grading and point derivation, the metric direction and histogram
edges, the live curve, the frozen archive, and the day clock. It keeps
consolidated numbers only: no per-player records, no names, no free
text, no logs.

manifest.json is the one shared truth of scoring: epoch, timezone, and
one ledger entry per game (the better direction and the histogram
edges). The server loads it at boot, the shell carries the same
constants inline for offline play, and CI cross-checks all three sides
against it so none can drift.

### The proof plane: checks/ and tests/

Five dependency-free CI layers: build-knowledge verify (the layer
compiles to the committed stores), export-puzzles verify (stores equal
client banks), checks/games.js (every page compiles, the shell is wired
and never duplicated, every element id exists, the landing links every
game), tests/run.js (headless playthroughs per game, the archive walk,
server-gated delivery, cross-checks, and a suite guard that fails if
the suite silently stops asserting), and tests/server_test.py (real
booted instances with scratch directories and pinned epochs: fresh-day
counting, the archive handoff, warm start, dealt play, the pre-launch
clamp and the per-IP caps).

## Principles

1. Truth never ships. The live day's answer never crosses the wire in
   the puzzle. A dealt game serves a strip (or a derived puzzle), and
   the key arrives only attached to a spent round: the reveal follows a
   won, lost or given verdict, never an open one.
2. The server owns the metric. Better and the histogram edges live in
   the manifest; points are derived server-side from evidence. On the
   evidence path the client never names a number: it sends the answer
   and the raw play facts, and the server computes the score.
3. The client owns the experience. The same page plays solo (file:// or
   ?solo=1) with local banks, replays any finished day (?d=N) in a
   quarantined memory sandbox, and falls back to local play whenever
   the service is unreachable. The server being down costs the curve,
   never the game.
4. Generated artifacts are never hand-edited. Stores and banks are
   compiled from the layer; CI recompiles and byte-compares on every
   push. A hand edit is not forbidden, it is useless.
5. Sessions have no identity. Dealt play is per-session, not
   per-player: a random nonce in memory with counters, purged at the
   day rollover, on TTL and when the round ends. The privacy stance is
   a property of the data shape, not of a policy statement.
6. Boring infrastructure. One stdlib Python file, static files, two
   containers, tag-gated deploys. Everything is auditable in an
   afternoon.

## Play modes

    mode            where              puzzle source                    curve            persistence
    live online     the served site    /puzzle strip or /deal          submits 1x/day   localStorage
    solo            file:// or ?solo=1 the inline bank                 off              localStorage
    archive replay  ?d=N, N < today    /puzzle full, key included       read-only        memory only

A replay is quarantined by construction: it never submits, never mints
a player id, and cannot touch the live day's state or sync flags.

## The life of a live round

1. Boot: the page asks /puzzle for its day (the shell's fetchPuzzle).
   A live dealt day answers with the strip; an archive day answers
   with the full puzzle and the page grades locally.
2. Deal: when the page is ready to accept moves it posts /deal and
   receives a nonce plus the strip. The page keeps the nonce with its
   state, and a reload resumes a finished round from the kept reveal.
3. Guess: every move posts /guess with the nonce and the move nested
   under one "move" field; a move that already got its verdict is
   answered in the page, no round trip.
   The session grades it, meters its own counters (checks, mistakes,
   hints, clues, picks) and answers with a verdict, honest feedback
   and, on a terminal verdict, the reveal.
4. Submit: the finish posts /submit once with the nonce. The session's
   own verdict, answer and counters override the client's claims, the
   evidence validates against the day's key, the points derive
   server-side and tally into the curve (first submission per hashed
   id).
5. Rollover: the first request after midnight ET flushes finished days
   into the archive and drops stale sessions; a shutdown flush does the
   same, and a warm start brings today's partial board back after a
   restart.

## Scoring

Points are the server's word. Each gated game declares an evidence
validator (an answer shape plus per-game meta caps) and a derivation
from the ledger: rounds 4 minus guesses, museum 4 minus clues, cipher 3
minus hints, sift and lightbox 3 minus mistakes, timeline and thread 4
minus checks, brunch 1 for the right pick, bogus 3 minus wrong picks,
well-actually the same plus a correction bonus, fermi by ratio bucket,
superlative and relativity by correct rounds. A loss or a give-up is 0 no matter the
meta (fermi, superlative and relativity keep their partial scores). docs/API.md
carries the full per-game tables.

The curve is consolidated per (game, day): n, sum, sumsq, min, max and
a fixed histogram. The first submission per hashed client id counts; a
revisit reads its personalized snapshot back without tallying. A
finished day collapses once into a static snapshot that keeps serving
under its own recorded edges and direction even if the manifest moves
on afterwards.

## The honest map: how the code sits today

The growth plan below has landed its first five steps: every dealt
page's dance lives once in the shell (makeDealt), the server is a
package split along its seams (server.py the entry point plus config,
puzzles, sessions, curve, archive, adapters, evidence, app and
helpers), and the wire speaks api_version 2, every dealt game's move
nested under one "move" field. What remains is step 6, naming: names
still carry their history, and the sweep is opportunistic, file by
file, never a mechanical pass.

## Growth: the target architecture

Contracts in the middle, adapters at the edges, in CI-green steps:

1. docs (landed): the map and the wire contract, fixed in writing
   before any code moves.
2. client (landed): one dealt-session module in the shell (makeDealt)
   with three per-game hooks: isDealt (recognize the served strip),
   buildMove (turn the page's play into the /guess payload) and
   applyReveal (merge the reveal into the page's model). The pages shed
   their duplicated dealt blocks.
3. server (landed): an adapter registry. Each game declares its strip schema,
   move shape, grader, reveal builder and evidence validator in one
   object; the endpoints stay byte-compatible and the existing suites
   prove parity.
4. server (landed): the package split along the seams above (app, adapters,
   sessions, evidence, curve, puzzles). stdlib-only and the deploy
   shape stay exactly as they are.
5. API (landed): the unified dealt cutover, with api_version 2 beside
   server_version. Server and pages deploy as one tag, so the bump is a
   coordinated act, not a migration.
6. naming: an opportunistic sweep, file by file as it is touched,
   guided by the glossary below. No mechanical find-and-replace pass.

## Naming glossary

    term             meaning
    epoch            2026-11-02, the first puzzle day; the manifest owns it
    day index / num  days since the epoch, clamped at 0 before launch / index + 1, shown as "No. N"
    store            puzzles/<game>/puzzles.json, the committed compiled truth a game serves from
    bank             assets/banks/<game>.js, the client schedule compiled from the store
    windowed store   a store shaped {bank, picks}: precomputed day windows into one bank (timeline, thread)
    picks            the day's indices into a bank or list; picks[day] is the day's puzzle
    gated game       a game with an answer key in the store (the thirteen history games)
    generator game   a game that derives its board at play time from a seeded RNG (sprint, trace, recycle-grid, recycle-rings)
    ledger           the manifest names the curve counts; recycle-grid tallies as grid and grid-hard
    dealt play       server-dealt rounds: the answer never ships while the round is open
    repeat guard     the dealt client answers a move whose key already got a verdict, no round trip; the default key is the move's content, pages shape or waive it
    deal / guess / reveal   open a session / play a move / the sprint starting gun
    strip            the deal's version of the puzzle, keys removed (DEALT_STRIP, DEALT_DEEP) or derived (sift tiles, lightbox clues, cipher text, thread tray)
    tray             thread's deal shape: the offered figures shuffled, with the chain length k but no chain
    session / nonce  an in-memory round keyed by a random token; counters live with it, never with a player
    verdict          the session's answer to a move: won, lost, gave, found, miss, clue, hit, hint
    reveal           the truth attached to a terminal verdict (a spent round)
    evidence         the /submit payload for a gated game: status, answer, meta; the server derives the points
    meta caps        per-game bounds on claimed play facts (guesses, clues, hints, mistakes, checks)
    curve            the live per-(game, day) consolidated numbers and histogram
    snapshot         the /dist response shape: count, beat, mean, bins, better
    archive          the frozen per-day snapshots, written once, read-only forever
    warm start       boot restores today's archived partial board after a restart
    solo mode        file:// or ?solo=1: local banks, no submissions, curve off
    server_version   the service's self-declared version, currently warmup-curve/4.9
    api_version     the wire contract version, currently 2, spoken by /health and /manifest

## Deploy shape

Two images from one repo: web (the static site behind Caddy) and
scores (the stdlib service, read-only root, bind-mounted archive
directory). Deploys are tag-gated: pushing a v* tag is the release
act, the release workflow publishes both images to GHCR only after
that exact commit's validate run is green, and the host moves with a
compose pull and up. Nothing on main ever deploys by itself.
