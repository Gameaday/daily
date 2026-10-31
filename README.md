# daily · daily.historylabs.dev

Morning warmup games for the History Labs: one new puzzle per game per day,
self-hosted on a Raspberry Pi as dumb static files plus a tiny Python scores
service. No database, no accounts, no ads.

Everything is relative-pathed, so the site works at daily.historylabs.dev,
warmup.historylabs.dev, an IP, or a LAN hostname. Nothing is hardcoded.
Design notes live in NOTES.md; the contributor orientation is in DEVELOPER.md.

## Games

| Path | Game | Idea |
|---|---|---|
| / | Warmup | Landing page linking all games |
| /bogus/ | Bogus! | A history passage where one phrase is a lie: spot it in 3 picks |
| /well-actually/ | Well, Actually... | A statement with one wrong phrase: find it, then type the correction for a bonus point |
| /recycle-rings/ | Recycle: Rings | Four letter wheels, one target word, one exact par; every move counts |
| /recycle-grid/ | Recycle: Grid | Three modes, three budgets; nudge rows then columns, bank the best board |
| /fermi/ | Fermi | One estimation question per day, one guess, scored by closeness |
| /sift/ | Sift | Twelve tiles, four hidden groups of three, four mistakes allowed |
| /rounds/ | Rounds | Slide toward the year of a hidden event in six guesses |
| /trace/ | Trace | A daily word ladder, one letter at a time, par five rungs |
| /lightbox/ | Lightbox | A 7x7 nonogram; four bad developments fog the film |
| /sprint/ | Sprint | Five anagrams against one 90-second clock that never restarts |
| /cipher/ | Cipher | A substitution cipher hiding a line of history; hints cost |
| /timeline/ | Timeline | Five events, no dates; each check locks correct placements |
| /museum/ | Museum | Name the artifact from five clues, obscure to obvious |
| /thread/ | Thread | Two figures at the ends; build the one chain of connection, set the decoys aside |
| /brunch/ | Brunch | One city, one year, four names; spot the one who was somewhere else |
| /superlative/ | Superlative | Four lives from the record; pick the one 
the question asks for, one guess, then assign the bonus match |

Each game is one self-contained index.html. The parts every game shares
(day math, palette, countdown, curve client, help, share) live in
`shell/common.js` and `shell/common.css`, so the game file is mostly puzzle.
The puzzle is derived from the date, not stored per player:

- puzzle number = days since the launch date, rolling over at midnight America/New_York
- puzzle content comes from an in-file bank or a seeded RNG: same for every player
- streaks and progress live in each player's localStorage
- the day-numbering epoch lives in `scores/manifest.json` and, inline for
  offline play, in `shell/common.js`; CI cross-checks the two, so change
  both together to reset the numbering

## Puzzle delivery (server-side banks)

The bank games (bogus, well-actually, rounds, fermi, cipher, museum,
lightbox, sift, timeline, thread, brunch, superlative) keep their bank inline in the
page, so solo and offline play work with zero infrastructure. When online, each page
also asks the scores service for the day's puzzle:

    GET /api/puzzle?game=rounds&day=12   ->   { game, day, puzzle, today }

The served puzzle replaces the inline pick, so the published site never
carries tomorrow's answers: the online bundle ships with every bank stripped
(`tools/build-bundles.mjs`), and the answers live only in the scores
container, read from the committed per-game stores
(`puzzles/<game>/puzzles.json`).

- over `file://` or `?solo`, or whenever the service is unreachable, the
  inline bank plays and nothing is asked of anyone
- windowed games: timeline's and thread's picks are precomputed for 1000
  days in their stores, so the server just indexes `{bank, picks}`;
  every other game serves `bank[day % len]`
- sprint, trace, recycle-grid and recycle-rings stay client-generated on
  purpose: their banks are generators the game needs during play, not
  answer keys
- `node tools/build-knowledge.mjs` verifies the knowledge layer com
piles
  to the committed stores, and `node tools/export-puzzles.mjs` verifies
  every store against its client bank; to change a history game's
  content, edit the layer, run `node tools/build-knowledge.mjs --write`
  then `node tools/export-puzzles.mjs --write`, and commit layer, stores
  and banks together (see the knowledge layer section below)

## The knowledge layer

The history the games share is stored once, in `knowledge/`: people,
events, places, artifacts, the wider world, animals and quotes, their
typed relations, the twist tellings behind bogus and well-actually, the commonly
cited figures behind fermi, the stories the year games tell, and each game's recipe of what it draws.
`tools/build-knowledge.mjs` compiles the layer into the per-game stores
and `tools/export-puzzles.mjs` emits the client banks from them: truth
lives in one place, every game reads the same facts, and CI fails if a
store or bank drifts from the layer. `knowledge/SCHEMA.md` documents
every file, lint and recipe. lightbox stays hand-banked by
design: picture clues are not shared entities, so its page remains its
own source. fermi's questions live in the layer as facts, keyed to the
graph when the layer knows the subject. superlative's boards are the
people layer itself, cut by the compiler into groups of four, and the
person numbers (heights, catalogue counts, reign years) feed its bonus
match.

## The global curve

Every game can show how you fared relative to everyone else: a distribution
of results with your bar highlighted, roughly how many you beat, and the
global average. No names, no high-score tables, just the shape of the day.

The scoring model, on purpose:

- fresh-day only: a submission counts toward the live curve only when it is
  for the current day's puzzle. The client always plays today's puzzle, so
  this is what a normal morning looks like; nothing from the archive can
  ever churn today's numbers
- the live day is held in memory only, as consolidated numbers per
  (
game, day): count, sum, sum of squares, min, max, and a small fixed
  histogram. No per-player records, no names, no text
- client ids are hashed to 8 bytes and kept only in a transient dedupe set:
  the first submission of the day stands, reloads get a personalized reply
  but do not retally
- the day rolls over, the data settles: on the first request after midnight
  (and on shutdown), the finished day's numbers collapse into one small
  static snapshot per (game, day) under the archive dir
  (`scores/archive/<game>/<day>.json`): plays, score distribution, and the
  aggregates needed to rebuild the weights later. The file is written once,
  then read-only forever
- replaying an old puzzle never touches the live curve and never rewrites
  an archive: stale submissions get the frozen snapshot back, nothing more
- the archives are kept for knowledge (how many played, what the spread
  looked like) and for rendering fun score graphics when old puzzles are
  played from the archive, later
- if the service is off, each game quietly notes the curve is offline and
  everything else works

Hardening, same as ever: stdlib-only Python on 127.0.0.1:8787 (or inside
the compose network), strict input validation, 2 KB body cap, no user text
accepted anywhere, metric direction owned server-side per game. The only
disk writes are the end-of-day archive snapshots, and the only writable
path is the archive volume.

## Deploy with Docker (recommended)

The whole stack, online site + Caddy + the scores service, runs as two
containers from one compose file. The images live on GHCR and the release
workflow builds and pushes them on every green v* tag, so the compose file
and its .env are the entire deployment: copy both to any machine with
Docker (the Pi, another PC, anywhere) and start it there. No repo
checkout, no cloning, no tokens; the images are public packages and stay
pullable even after the repo goes private.

    docker compose up -d
    docker compose ps                 # web
 + scores should be Up

Then point your edge proxy (Traefik, nginx, Caddy) at the web port
(WEB_PORT in .env, default 8081) and terminate TLS there. The repo ships
no domain or TLS config on purpose. Persistent state is the end-of-day
score archive, kept under DATA_DIR (default /opt/data/daily): everything
else lives inside the images, so the stack survives host rebuilds, and
moving it to another machine is copying the compose file, .env, and that
one directory.

- `web`: Caddy serving the online bundle baked into the image (no puzzle
  banks inside), proxying `/api/*` to the scores container; read-only
  filesystem (tmpfs for /config and /data), no capabilities beyond
  binding :80, a 128 MB memory cap, and rotated logs
- `scores`: the stdlib Python service (curve + puzzle delivery),
  read-only filesystem, no capabilities, no-new-privileges, a 64 MB memory
  cap, a process cap, rotated logs, internal network only. The puzzle
  stores are baked into the image
  from the committed `puzzles/` at build time, so the container is
  self-contained

## Releases and updates

Pushing a tag is the release act:

    git tag v1.0.0 && git push --tags

validate runs on the tag push; the release workflow waits for that run to
finish green on the tag's exact commit, attaches the offline and online
bundle zips to the GitHub release, and pushes the web + scores images to
GHCR, tagged with the release tag and with latest. Prerelease tags
(v1.0.0-rc.1: anything with a hyphen) publish images under their own tag
but never move latest. A red validate run publishes nothing, and the
stack keeps serving what it already has.

On the host, updating is two commands:

    docker compose pull && docker compose up -d

`pull` grabs latest; to pin one release, or roll back to the previous one,
set TAG=v1.0.0 in .env first. Every update is a whole-image swap, so a
failed release simply never arrives.

Non-Docker alternative: `scores/warmup-scores.service` runs the service
under systemd with DynamicUser and a hardened sandbox. Give it one
writable directory for the archive (ReadWritePaths=) and pass
`--archive-dir` in ExecStart.

The loop is: push to GitHub,
 Actions validates the push, the tag's
release workflow publishes the images only once its validate run is
green, and the host picks them up with one compose pull. If tests fail,
nothing publishes and the site never moves.

## Go-live checklist

One-time on the host: install Docker, copy docker-compose.yml and .env
(there is .env.example to start from) to the host, and point the edge
proxy for daily.historylabs.dev at the web port (WEB_PORT in .env,
default 8081; TLS terminates at the edge; the repo ships no domain config
on purpose). Then:

1. push the first stable tag (git tag v1.0.0 && git push --tags); the
   release workflow publishes the images once the tag's validate run is
   green, usually within a few minutes
2. on the host: docker compose pull && docker compose up -d; open the
   site: the landing page and one game should load, and /api/health
   should answer ok
3. play one puzzle online: the served puzzle replaces the inline pick, so
   a win proves delivery end to end
4. after ET midnight, confirm the first archive snapshot landed under
   DATA_DIR (default /opt/data/daily/archive)

Day numbering comes from the epoch in scores/manifest.json (CI
cross-checks it against shell/common.js), so nothing on the server decides
which puzzle serves on which day.


## CI and validation

Layers run on every push and pull request (`.github/workflows/validate.yml`),
all dependency-free (Node 20+ and Python 3):

0. `node tools/build-knowledge.mjs` verifies the knowledge layer compiles
   to the committed stores
1. `node tools/export-puzzles.mjs` verifies the committed stores against
   the client banks
2. `node checks/games.js` compiles every game script, checks shell wiring,
   element ids, landing links and server-gating wiring
3. `node tests/run.js` boots each game headless in a stubbed DOM, plays it
   to a win/loss, verifies the value posted to the curve, rolls the clock
   forward to prove streaks survive, then re-boots every bank game with the
   bank stripped 
to prove the served puzzle drives it
4. `python3 tests/server_test.py` spawns the real scores service and
   exercises health, submit/dedupe, dist, puzzle delivery, validation,
   fresh-day counting and the archive handoff
5. `node tools/build-bundles.mjs` builds and verifies the offline and
   online bundles

Local pre-push: `npm test` (or `make test`) runs the test layers CI runs, in
seconds; only the bundle builds stay CI-side.

## The recycle rule

Sprint is the only game on the clock: it starts on your first move and
never restarts. Rings and Grid traded the clock for a budget of moves:
Rings counts every spin and swap against an exact par, Grid banks a board
after two phases of shifts (Practice generates fresh boards and records
nothing; Normal is the daily game; Hard replays the daily board with one
more shift, online-only, on its own bonus curve). Pressure comes from
scarcity of moves, not time.

## Adding a game

1. Copy an existing game folder; include `../shell/common.css` and
   `../shell/common.js`, then destructure what you need from `SHELL`.
2. Swap in the puzzle: a recipe over the knowledge layer for a history
   game, an inline bank (lightbox) or a seeded generator. Word
   games can share `assets/words-en.js`.
3. Add a card to the landing page and a row in the games table above.
4. If it has a score: call `syncBoard(value)` on reveal, add the game to
   `scores/manifest.json`, and for a layer game run
   `node tools/build-knowledge.mjs --write` then
   `node tools/export-puzzles.mjs --write`; for a hand-banked game just
   re-export its store. Commit the stores either way.
5. Run `node checks/games.js` before you push.

## Offline / air-gapped play

    make build    # -> dist/offline (banks intact) + dist/online (banks stripped)

`dist/offline` is the whole site and nothing else, with every inline bank
intact. Open it over `file://` (or copy it to an air-gapped machine) and
everything works: daily puzzle, state, streaks. Games run in solo mode:
no
thing is submitted and the curve area says so. The build verifies every
relative reference resolves inside the bundle.

## Content rules (worth keeping)

- Exactly one wrong element per Bogus! / Well, Actually puzzle, and
  everything else must stay true after the correction is applied.
- Well, Actually statements get at least four clickable phrases: three
  picks must never be able to brute-force the find.
- Vary the lie position across puzzles; do not park it in the last phrase.
- Fermi: use commonly cited figures and present them as commonly cited;
  the generous ratio buckets absorb honest disagreement.
- Sift: four groups of exactly three per board, no tile in two groups on
  the same board, and at least one tile that plausibly belongs elsewhere.
- Cipher: only well-attributed quotes; the attribution must be solid.
  Verify facts before committing; readers will fact-check you every morning.
- Punctuation: new copy avoids em dashes. They have repeatedly survived
  careless re-encoding as mojibake, so prefer commas, periods, semicolons,
  or parentheses. In client pages, keep bank literals ASCII-safe with
  \uXXXX escapes; keep the committed stores as plain UTF-8.
- Word games: `assets/words-en.js` is the shared bank; common English
  words only, no proper nouns. Sprint keeps its own anagram banks.
