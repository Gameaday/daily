# Notes for later

Design notes and future ideas we are deliberately not building yet. Work
that has landed is documented where it lives: README.md for the site and
its games, DEVELOPER.md for contributor orientation, scores/server.py for
the scores service and its design rules, knowledge/SCHEMA.md for the
layer format. This file keeps only what is still ahead.

## Deploy state

The release workflow builds the web + scores images and pushes them to GHCR
(ghcr.io/gameaday/daily-web and daily-scores, amd64 and arm64) on every v*
tag, but only once the tag commit's validate run is green. The running stack
is one compose file plus .env that pulls those images: copy both to any
Docker machine and docker compose up -d. No repo checkout on the host, no
tokens (the packages are public, and package visibility is separate from
repo visibility, so they stay pullable after the privacy flip). Persistent
state is the end-of-day archive under DATA_DIR (default /opt/data/daily).
A red validate publishes nothing, and a rollback is setting the previous tag
in .env. The scores service stays in-memory and consolidated only.

## Valid-guesses bank (Wordnik, decided 2026-10-27)

Future guess-validating games get a wider "we'll accept it" bank built from
the MIT-licensed Wordnik wordlist (wordnik/wordlist). Answers always come
from curated WORDS_EN; VALID_EN only widens what a player may guess.
tools/make-valid-en.mjs (zero-dep) builds it: run curl -O
https://raw.githubusercontent.com/wordnik/wordlist/main/wordlist-20210729.txt
&& node tools/make-valid-en.mjs locally, and assets/valid-en.js lands with
its MIT header; bank-shape guards follow in the same commit as the asset.

## Mobile UX pass

Cipher types through a hidden off-screen input (tap a slot, the soft
keyboard opens; a sentinel space turns backspace into an input event) - copy
that trick into any future keyboard-driven game. The rest of the fleet is
still desktop-first in small ways: Sprint only accepts a word on Enter,
which costs an extra tap on a phone, and nothing has been trialed on a real
small screen. Worth one deliberate pass on a phone before players find what
we missed.

## Watch items

- Grid hard mode runs the exact six-shift search client-side on first entry
  (roughly 62k board sims, under a second on desktop and CI). If any real
  phone struggles, the precalc moves server-side, calculated once at
  midnight and served with the puzzle, without touching the game logic.
- Rings' bonus round replays the day's board under the step economy on
  its own curve; practice rerolls and a hard mode (larger wheels or two
  targets) could still follow once the grid modes have soaked.

## Future game ideas

Recipes the knowledge layer can grow toward; none of these build yet.

- Dig: a daily excavation grid - probe cells, read stratigraphy, date the
  layer
- Almanac: today-in-history trivia with a twist (multiple choice,
  escalating)
- Follow: a daily six-degrees chain between two historical figures
- Who Said It: the quote game. quotes.json already keys each line to its
  speaker; it wants more y and via on the quotes, and a country hint after
  a miss wants country fields or resident relations to read.
- Relativity: which of two events a figure stood closer to. The layer
  already carries born and died, event years, and dated participant
  relations; the recipe draws a person, two events inside the life, and
  asks which year sits nearer.
- Fibbs: one truth among authored fibs. The facts file feeds the truth,
  the fibs stay authored beside it twist-style, and both key by about.
- Archived: where an artifact is kept. The housed-at relations already
  answer it; the recipe offers place options and grows with every new
  housed-at edge.
- Refactored: when people believed the false thing. Needs dated
  misconception entries, a claim, a believed window, the correction; a
  natural new file keyed like the twists.
- Odd Fame: who did the odd accomplishment. Facts and twist entries with
  about keys feed it; deep person profiles make it rich.
- Topical: this day in history. A pure recipe: events with month and day
  against the day of the year, plus same-day impostors from the same era.

## Deferred on purpose

- wiki/sameAs alias matching for entities
- a sift board auto-generator (the boards are authored for now)
- lifting Superlative past its people-derived bank: the people layer
  grows deliberately, and the bank follows it
