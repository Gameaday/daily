# daily · daily.historylabs.dev

Morning warmup games for the History Labs — one new puzzle per game per day,
self-hosted on a Raspberry Pi as dumb static files. No database, no accounts, no ads.

Everything is relative-pathed: the site works at warmup.historylabs.dev,
daily.historylabs.dev, an IP, or a LAN hostname — nothing is hardcoded.

Design notes and future ideas live in NOTES.md.

## Games

| Path | Game | Idea |
|---|---|---|
| / | Warmup | Landing page linking all games |
| /bogus/ | Bogus! | A history passage where one phrase is a lie — spot it in 3 picks |
| /well-actually/ | Well, Actually… | A statement with one wrong phrase — find it, then type the correction for a bonus point |
| /recycle-rings/ | Recycle: Rings | Four letter wheels, one target word, one exact par — spin and swap to spell it, every move counts against the par |
| /recycle-grid/ | Recycle: Grid | Three modes, three budgets — Practice (fresh random board, nothing counts), Normal (5, the daily game), Hard (same board, one more shift, online-only bonus): nudge rows then columns in two phases, undo is free until you Bank It, and the best possible board is exact |
| /fermi/ | Fermi | One order-of-magnitude estimation question per day, one guess, scored by how close you land |
| /sift/ | Sift | Twelve tiles, four hidden groups of three, four mistakes allowed |
| /rounds/ | Rounds | Slide toward the year of a hidden event — hot, warm, or cold, in six guesses |
| /trace/ | Trace | A daily word ladder — change one letter at a time from start to target, par five rungs |
| /lightbox/ | Lightbox | A 7×7 nonogram; reason from the clues and develop a picture from history — four bad developments fog the film |
| /sprint/ | Sprint | Five anagrams against one 90-second clock that starts on your first keystroke and never restarts |
| /cipher/ | Cipher | A daily substitution cipher hiding a line of history — decode it; hints count against you |
| /timeline/ | Timeline | Five events with no dates; each check locks correct placements in place |
| /museum/ | Museum | Name the day's artifact from five clues, obscure to obvious |


Each game is a single self-contained index.html — but the parts every game
shares (day math, palette, countdown, curve client, help, share) live in
`shell/common.js` and `shell/common.css`, so the game file is mostly puzzle.
The puzzle is derived from the date, not stored:

- puzzle number = days since the launch date, rolling over at midnight America/New_York
- puzzle content is picked from an in-file bank or generated from a seeded RNG — same for every player worldwide
- streaks and progress live in each player's localStorage (keys of the form warmup.GAME.v1; bogus and well-actually are on v2)
- change EPOCH_KEY in `shell/common.js` to reset the day numbering

So the Pi only ever serves bytes (and, for the bank games, the day's
puzzle). Plain HTTP on the published port - TLS belongs to the edge proxy
in front of it:

    :80 {
        handle_path /api/* {
            reverse_proxy scores:8787
        }
        handle {
            root * /srv/daily
            file_server
        }
    }


`docker compose` maps it to host port 8080 - and let it terminate TLS.
Nothing in this repo needs to know the domain.



The bank games (bogus, well-actually, rounds, fermi, cipher, museum,
lightbox, sift, timeline) ship their puzzle bank inline in the page - so
solo/offline play works with zero infrastructure - and, when online, each
page asks the scores service for the day's puzzle:

    GET /api/puzzle?game=rounds&day=12   ->   { game, day, puzzle, today }

The served puzzle replaces the inline pick, so the published site no
longer contains tomorrow's answers: the online bundle ships with every
bank stripped (`tools/build-bundles.mjs`), and the answers live only in
the scores container, read from the committed per-game stores
(`scores/<game>/puzzles.json`, kept in sync with the client banks by
`tools/export-puzzles.mjs`).

- over `file://` or `?solo`, or whenever the service is unreachable, the
  inline bank plays and nothing is asked of anyone - offline stays
  self-contained
- windowed game: timeline's pick (five events, distinct years, the same
  seeded shuffle the page would run) is precomputed for 1000 days, so the
  server just indexes `{bank, picks}`; every other game ships its bank
  whole and the server serves `bank[day % len]`
- sprint, trace, recycle-grid and recycle-rings stay client-generated on
  purpose: their banks are generators the game needs during play (word
  validation, board checking), not answer keys
- `tools/export-puzzles.mjs` verifies every committed store against
  its client bank, so committed and served puzzles cannot drift

## The global curve (optional, ~200 lines of stdlib Python)

Every game can show how you fared relative to everyone today: a distribution of
results with your bar highlighted, roughly how many you beat, and the global
average. No names, no high-score table — just the shape of the day.

Design constraints, on purpose:

- scores/server.py is stdlib-only Python (http.server) on 127.0.0.1:8787
- nothing is ever written to disk — no score logs, no database, no files; a
  restart forgets everything, and boards are pruned after 1 day (see NOTES.md
  for the archive idea)
- the server keeps ONLY consolidated numbers per (game, day): count, sum,
  sum of squares, min, max, and a small fixed histogram. There are no
  per-player records at all
- the client id is hashed to 8 bytes and kept only in a transient dedupe set:
  the first submission of the day stands, and reloads get a personalized reply
  without retallying. The raw id never leaves the digest set
- no user text is accepted or stored anywhere: the only inputs are the game
  slug (checked against a fixed allowlist), a bounded day number, a bounded
  numeric score, and the hashed id. Request bodies are capped at 2 KB
- which direction is "better" is defined server-side per game (rings: fewer
  moves; sprint: more words; cipher: fewer hints) — the client never decides it
- total RAM for ~40 players across thirteen games is a few dozen kilobytes
- if the service is off, each game quietly notes "global curve offline —
  playing solo today" and everything else works

Install on the Pi without Docker (systemd alternative — the Docker route
above is now the recommended one):

    sudo cp -r scores /srv/daily/scores
    sudo cp scores/warmup-scores.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now warmup-scores

The service uses DynamicUser (no persistent system user), binds to localhost
only, and runs with a hardened systemd sandbox (no capabilities, no writes
anywhere, memory cannot become executable). The games also try localhost
directly as a fallback, so a browser on the Pi itself still gets the curve
even without the Caddy proxy.

## Deploy on the Pi with Docker (recommended)

The whole stack - online site + Caddy + the scores/puzzle service - runs
as two containers with `docker compose`. The site is baked into the web
image at build time (banks stripped, puzzles served at runtime), so a
rebuild is what ships new site content; the pull-based updater (next
section) already does `docker compose up -d --build`.

One-time setup on the Pi:

    # 1. Docker + compose (Raspberry Pi OS / Debian)
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER   # log out/in after this

    # 2. Clone the repo where it will live, e.g. /home/pi/daily
    git clone https://github.com/Gameaday/daily.git ~/daily
    cd ~/daily

    # 3. Build and start
    docker compose up -d --build
    docker compose ps              # web + scores should be Up

    # 4. Point your edge proxy at the published port
    #    e.g. Traefik: a router for your domain -> http://<pi-host>:8080

What you get:

- `web` - Caddy 2.8 serving the online bundle (no puzzle banks inside)
  from `/srv/daily`, proxying `/api/*` to the scores container. Plain
  HTTP on host port **8080** - the repo deliberately ships no domain or
  TLS config. Terminate TLS at your edge proxy (the Traefik/nginx/caddy
  box in front) and forward to `8080`; nothing here needs the domain.
- `scores` - the stdlib Python service (curve + puzzle delivery),
  hardened: `read_only` filesystem, `cap_drop: ALL`,
  `no-new-privileges`, a 64 MB memory cap, and **no volumes**. It is
  reachable only on the internal compose network - the port is never
  published to the host. The puzzle stores are committed under
  `scores/`, so the container is self-contained. A
  restart forgets all scores by design (only consolidated per-day
  numbers are kept, pruned after 1 day).

Updating after pushing to GitHub:

    make deploy        # = python3 deploy/pull.py (fetch, CI-green check, ff-only pull, rebuild)

Better: install the update timer (next section) and the Pi does this
itself every five minutes, only for commits whose CI run passed. The
rebuild is how new site content ships now that the site is baked into the
image - and a failed rebuild can't take the site down: the old containers
keep running.

## CI and self-updating deploys

Four layers run on every push and pull request (`.github/workflows/validate.yml`):

0. `node tools/export-puzzles.mjs` - verifies the committed per-game puzzle
   stores against the client banks (the same thing the Docker build ships)
1. `node checks/games.js` - compiles every game script, checks shell
   pieces, element ids, landing links, server-gating wiring (inline bank +
   fetch fallback) and the local wording rule
2. `node tests/run.js` - boots each game headless in a stubbed DOM with a
   pinned clock, plays it to a win/loss, verifies the value posted to the
   global curve, rolls the clock a day forward to prove streaks survive,
   then re-boots every bank game with its bank stripped to prove the
   scores-served puzzle drives it
3. `python3 tests/server_test.py` - spawns the real scores service on a
   scratch port and exercises health, submit/dedupe, dist, puzzle
   delivery, validation, and pruning

Keeping the Pi in sync is **pull-based**: nothing can reach into the Pi —
no SSH keys stored in GitHub, no inbound deploy access of any kind. The Pi
only ever makes outbound `git fetch` plus one GitHub API read.

`deploy/pull.py` (run by hand, or by the timer below) fetches `main` and only
updates when GitHub Actions finished **green on that exact commit**: ff-only
pull, `docker compose up -d --build`, image prune. A red or still-running CI
run means the site keeps serving the last known-good version and tries again
next cycle. A failed rebuild also can't take the site down — the old
containers keep running.

Install the timer on the Pi (one time):

    sudo cp deploy/daily-update.service deploy/daily-update.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now daily-update.timer
    journalctl -u daily-update.service -f        # watch it work

The service file assumes the clone lives at /home/pi/daily — edit its two
paths if not. If the repo is private, add `Environment=GITHUB_TOKEN=...`
(a read-only token) to the service file; a public repo needs no token.

So the full loop is: push to GitHub → Actions runs all three test layers →
the Pi notices the green commit within ~5 minutes and rebuilds. If tests fail,
the site never moves.

Local pre-push: `npm test` (or `make test`) runs all three layers in seconds —
Node 20+ and Python 3 are the only requirements, and neither needs any
installed packages.

## The recycle rule

Sprint is the only game still on the clock: it starts on your first move and
never restarts — not for retries, not for reloading the page. Words saved are
what you bank, so dithering is not free.

Rings and Grid traded the clock for a budget. Grid has three modes:
**Practice · 4** generates a fresh random board every time — small enough
to validate instantly in the browser, and nothing it does is recorded.
**Normal · 5** is the daily game: two phases (rows first, then columns,
one-way lock), undo and restart free, each shift spending the budget, and
the first bank of the day counts for your streak and the global curve.
**Hard · 6** replays the same daily board with one more shift — the
six-shift exhaustive search is the heavy one, so hard is unlocked only
when the global curve service answers (solo/offline play can't reach it)
and banks to its own `grid-hard` bonus curve without touching streaks.
The best possible board is computed exactly for each mode and shown
upfront, so a "perfect" bank is a real achievement.
Rings counts every spin and swap against an exact par (BFS over the full
state space), so the game is about being conservative, not fast. Neither
game has a timer anymore: pressure comes from scarcity of moves.

## Adding a game

1. Copy an existing game folder — the shared shell lives in `shell/common.js`
   and `shell/common.css`: include both with a `<script>`/`<link>` tag, then
   destructure what the game needs from `SHELL` (day math, store, countdown,
   help, share, curve client). What's left in the game folder is the puzzle:
   bank or seeded generator, round logic, and a few lines of game CSS.
2. Swap in your puzzle bank or seeded generator and the round logic. Word
   puzzles can share `assets/words-en.js` (load it before the game script and
   use `WORDS_EN`) instead of inlining a list.
3. Add a card to the landing page index.html and a row in this table.
4. If the game has a score, call syncBoard(value) on reveal — the value is the
   metric — and add the game to SPECS in scores/server.py with its "better"
   direction and histogram edges. The curve appears for free.
5. Run node checks/games.js before you push — it compiles the new game and
   checks the shell script/link tags are present and the shared blocks aren't
   accidentally re-inlined.

## Offline / air-gapped play

    make build         # -> dist/offline (banks intact) + dist/online (banks stripped)

`dist/offline` is the whole site - and nothing else: no tooling, tests or
deploy files - with every inline bank intact, so it plays straight off
the filesystem. Open `dist/offline/index.html` over `file://` (or copy
the folder to an air-gapped machine) and everything works: the daily
puzzle, state, streaks. Games run in solo mode (`file://` or any URL with
`?solo`): nothing is submitted, no stats are fetched, and the curve area
reads "solo mode - the global curve is switched off". The build verifies
every relative reference resolves inside the bundle, so the shell wiring
can't silently rot. If the scores service is merely unreachable, online
games have always fallen back to playing solo - the site keeps playing
through server downtime either way.

## Validation

Four layers, all dependency-free:

- `checks/games.js` compiles every game's script with new Function - the
  fastest way to catch the fatal kind of typo (a single stray emoji escape
  once made Sprint a dead page for everyone) - and verifies the shared
  shell pieces, every element id the script touches, the landing links,
  the server-gating wiring on every bank game, and the local wording rule
  (one convention-banned word that kept creeping into copy; the
  dictionaries that legitimately contain it are exempt).
- `tests/run.js` goes further: it boots each game's real script in a
  stubbed DOM with an injectable clock, plays every game to a win and a
  loss, checks the exact value posted to the global curve, rolls to the
  next day to prove streaks survive (this is how the Sift streak-reset
  and Trace "on par" bugs were caught), re-boots every bank game with
  the bank stripped to prove the scores-served puzzle drives it, and
  cross-checks every game's curve client against SPECS in
  scores/server.py - the server owns the metric direction.
- `tests/server_test.py` spawns the real scores service and tests the
  API: health, submit + dedupe, snapshots, puzzle delivery (direct and
  windowed games), strict input validation, and the 1-day pruning
  horizon.
- `tools/export-puzzles.mjs` verifies the committed per-game stores;
  `tools/build-bundles.mjs` builds the offline/online bundles and verifies
  its own output (every relative reference resolves, banks present
  offline / stripped online).

Run everything: `npm test` or `make test`. GitHub Actions runs all three
layers on every push and pull request, and the Pi only ever updates itself
to commits where they passed.

## Content rules (worth keeping)

- Exactly one bogus element per Bogus!/Well, Actually puzzle.
- Everything else must remain true after the correction is applied — watch trailing
  clauses that would contradict the corrected statement.
- Vary the lie position across puzzles; do not always put it in the last phrase.
- Fermi: use commonly cited figures, present them as "commonly cited," and let the
  generous ratio buckets (3x / 10x / 100x) absorb honest disagreement.
- Sift: four groups of exactly three per board, no tile in two groups on the same
  board, and at least one tile that plausibly belongs elsewhere — that is the fun.
- Cipher: only well-attributed quotes; the author is the crib, so the attribution
  must be solid. Verify facts before committing — readers will fact-check
  you every morning.
- Word games: `assets/words-en.js` is the shared bank — common English words
  only, no proper nouns, no obscure Scrabble dumps. It is one ~12KB file
  (2230 words: 378 three-, 1052 four-, 800 five-letter), loaded once and
  cached across games. Sprint's anagram banks stay separate (they are
  per-length and typo-cleaned); the test suite asserts the shape of both so
  they cannot rot silently.
- Valid guesses: future guess-validating games can also load a wider
  `assets/valid-en.js` "we'll accept it" bank built from the MIT-licensed
  Wordnik wordlist by `tools/make-valid-en.mjs` (zero-dep; the answers still
  come only from the curated `words-en.js`). Not shipped yet — run the script
  once (see its header) to generate the asset; guards land with it.
