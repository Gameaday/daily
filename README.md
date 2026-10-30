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
lightbox, sift, timeline, thread, brunch) keep their bank inline in the
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
- `node tools/build-knowledge.mjs` verifies the knowledge layer compiles
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
graph when the layer knows the subject.

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
  (game, day): count, sum, sum of squares, min, max, and a small fixed
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

## Deploy on the Pi with Docker (recommended)

The whole stack, online site + Caddy + the scores service, runs as two
containers with `docker compose`. The site is baked into the web image at
build time (banks stripped, puzzles served at runtime), so a rebuild is
what ships new site content.

One-time setup:

    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER     # log out/in after this
    git clone https://github.com/Gameaday/daily.git ~/daily
    cd ~/daily
    docker compose up -d --build
    docker compose ps                 # web + scores should be Up

Then point your edge proxy (Traefik, nginx, Caddy) at host port 8080 and
terminate TLS there. The repo ships no domain or TLS config on purpose.

- `web`: Caddy serving the online bundle (no puzzle banks inside),
  proxying `/api/*` to the scores container
- `scores`: the stdlib Python service (curve + puzzle delivery),
  read-only filesystem, no capabilities, no-new-privileges, a 64 MB memory
  cap, internal network only. The puzzle stores are committed under
  `puzzles/`, so the container is self-contained. One named volume
  (`scores-archive`) is mounted at /app/archive for the end-of-day
  snapshots: the only writable path in the container

Updating after pushing to GitHub:

    make deploy      # = python3 deploy/pull.py (fetch, CI-green check, ff-only pull, rebuild)

Better: install the update timer and the Pi does this itself every five
minutes, only for commits whose CI run passed. A red or running CI run
means the site keeps serving the last known-good version and tries again
next cycle; a failed rebuild leaves the old containers running.

    sudo cp deploy/daily-update.service deploy/daily-update.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now daily-update.timer

Non-Docker alternative: `scores/warmup-scores.service` runs the service
under systemd with DynamicUser and a hardened sandbox. Give it one
writable directory for the archive (ReadWritePaths=) and pass
`--archive-dir` in ExecStart.

The loop is: push to GitHub, Actions runs the layers below, the Pi notices
the green commit within about five minutes and rebuilds. If tests fail, the
site never moves.

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
   bank stripped to prove the served puzzle drives it
4. `python3 tests/server_test.py` spawns the real scores service and
   exercises health, submit/dedupe, dist, puzzle delivery, validation,
   fresh-day counting and the archive handoff
5. `node tools/build-bundles.mjs` builds and verifies the offline and
   online bundles

Local pre-push: `npm test` (or `make test`) runs the same layers in seconds.

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
nothing is submitted and the curve area says so. The build verifies every
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
