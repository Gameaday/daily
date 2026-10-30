# Notes for later

Design notes we are deliberately not building yet. Each is small once the
shell is extracted (see common.js below).

## Deploy state (2026-10)

The repo now ships a Docker compose stack (Caddy web + scores, hardened) and
pull-based, test-gated CD: the Pi itself polls GitHub for a green main and
fast-forwards (deploy/pull.py + a systemd timer; see README). There is no
inbound access to the Pi and no SSH key stored anywhere - deliberately.
Nothing in the notes below changes because of that - the scores service stays
in-memory and consolidated only, whether it runs under systemd or in a
container. When the archive idea below lands, note that the scores container
is read_only: frozen snapshots would need a small writable volume mounted at
scores/archive/ - the one deliberate disk write in the whole system, gated
behind count >= 3.

## Curve representation cleanup

Today every game renders the histogram plus a sentence: "you: better than N
of M" (the "by X" unit tail was dropped in the fix pass) and the global average.
Opportunity: drop the prose entirely and let the chart do the talking, the way
racing-style puzzle games do - the distribution itself with an unmistakable
you-marker (accent bar, tick, and a tiny "you" label under your bin). One
glance, zero words.

The server already returns everything needed (bins with a you-flag, mean,
count). It is a pure client-side change - and now that the shell extraction
is done, it is a single edit to renderBoard in shell/common.js.

## Archive mode (frozen distributions)

Once a day rolls over, its consolidated snapshot - count, sum, sum of
squares, min, max, bins, roughly 200 bytes - could be frozen by the service
itself to scores/archive/GAME-DAY.json at prune time. This is the server
archiving its own aggregate numbers; players still never write anything to
disk.

Then an archive page could let someone replay a past puzzle and see their
result against the frozen curve: submissions to archived days are read-only -
"you would have beaten 7 of 12" - and never change the archived totals.
Suggested guard: only archive days with count >= 3, so solo mornings do not
get memorialized.

Retention is now 1 day (PRUNE_DAYS in server.py). If operators want
"yesterday's curve" visible live, bump it to 2 - memory is not the
constraint, tidiness is.

## common.js shell extraction (done 2026-10)

Done - see README. The shared shell - palette CSS, EPOCH_KEY/etKey,
nextETMidnight/tick, toast, help modal, curve client, share-to-clipboard -
now lives in shell/common.js + shell/common.css, and the word banks of
Trace/Recycle Grid/Sprint were deduplicated into assets/words-en.js. Games
destructure what they need from SHELL, so the curve representation change
above is now a one-file edit in shell/common.js (renderBoard moved there).
Solo/offline mode came along for free: file:// or ?solo switches the curve
off and never posts, which is also the air-gapped bundle story - the repo
minus deploy/ is the bundle. Next: game 14 can be puzzle-only.

## Word bank expansion (done 2026-10-27)

assets/words-en.js grew 1353 -> 2230 words (378 three-, 1052 four-, 800
five-letter), still one 12KB file loaded once and cached. Curation rule:
common English words only - no proper nouns, no obscure Scrabble dumps.
Trace and Recycle Grid puzzles are derived from the bank, so the day's
puzzle changes when the bank does (streaks and stats are untouched - anyone
mid-streak just gets the new puzzle). Sprint's inline anagram banks got a
hygiene pass at the same time: non-words (BASON, YOUK, WRAY, GLANE, TICKY,
WRITH...), wrong-length strays and duplicates removed or relocated; the
real-but-obscure words stay (ROUE, WOLD, QUOD - they are the fun ones).
The per-game tests (tests/games/) and checks/games.js assert both banks'
shape (A-Z 3-5, sorted, no duplicates, known typos stay gone).

## Recycle redesign (done 2026-10-27)

Grid is now two-phase with three modes instead of a free difficulty dial:
**Practice · 4** — a fresh random board generated on every entry (seeded by
Math.random, persisted in S.practice for reload continuity), nothing
recorded, no stats, no curve post; it's the "validate instantly, play
forever" sandbox. **Normal · 5** — the daily game: rows first, then
columns (one-way lock), undo/restart free, no clock, first bank counts for
streak + the 'grid' curve (S.counted). **Hard · 6** — the same daily board
with one more shift, unlocked only when the global curve service answers:
probeCurve() POSTs {} to /health with the same base fallback chain as the
submit path and treats ANY http answer as online (network error = offline,
solo = offline by design). Hard banks to its own 'grid-hard' bonus curve
once/day (S.hardCounted) and never touches normal stats — a hard-only day
does not preserve the streak (rollover checks !S.counted, not !S.banked).
The online gate exists because the six-shift exhaustive search is the heavy
one: interleaved row/column shifts at depth 6 explode past 5M states, but
every (row-offset, col-offset) pair with total cost <= 6 is only ~62k board
sims (<1s client-side, computed lazily at first hard entry and cached in
S.bestHard). Practice/normal are ~10k/25k sims. The two-phase structure is
what makes the "best possible board" exact rather than estimated. One daily
board is shared by normal+hard (scramble cost 4-5 sized by the normal
budget, seed does not include the budget) so both modes can always walk it
back. No server precalc - the scores service stays pure.

Generation lesson: the first cut filled the fat board with random letters
plus a hill climb, which topped out at ~7 words and failed the >= 8-9
acceptance floor on real days (day 0 and day 1 both generated NOTHING).
Fix: plant 7-10 real dictionary words into the random board before the
climb (monotone - the climb only accepts strict improvements), then scramble
by offsets costing budget-1 or budget so the rows-then-columns language can
always walk the fat board back. Accept when the exact optimum clears
max(fatMin, 8) and beats the start by >= 2-3 words.

Rings: four wheels (10/9/9/8 letters), a 4-letter target with distinct
letters from WORDS_EN, ops are per-position rotate +-1 plus adjacent-ring
swap. Metric is moves, low; par is an exact BFS over the full state space
(order x offsets, <= 155k states) to ANY state spelling the target, so par
is a true minimum. The clock is gone - being conservative is the game.
Note: the BFS is the one client-side cost that spikes memory (~155k-state
Map on first load); fine on desktop/CI, worth watching on old phones.

Ledger change: rings now counts moves, not seconds (SPECS edges
0/5/7/9/11/13/15/17/20, low; old seconds snapshots age out after a day).
Grid's ledger is unchanged (words, high) but adds a local "perfect" counter
when a bank matches the exact best possible, plus a new 'grid-hard' bonus
ledger (words, high, edges to 18 — one more shift can reach one more bin).
State keys bumped to
warmup.grid.v2 / warmup.rings.v2 with v1 stat migration. Only Sprint keeps a
clock now.

Natural next steps, in rough order: (1) land assets/valid-en.js via
tools/make-valid-en.mjs so guess-validating games get the wide bank;
(2) watch CI + real phone timing for the hard-mode lazy search — if any
device struggles, the precalc moves server-side (calculated once at
midnight, served with the puzzle) without touching the game logic;
(3) rings could get the same mode treatment (practice rerolls, hard =
larger wheels or two targets) once the grid modes have soaked;
(4) the curve-representation cleanup and archive mode already on the
roadmap.

## Valid-guesses bank (Wordnik, decided 2026-10-27)

Decision: future guess-validating games get a wider "we'll accept it" bank
built from the MIT-licensed Wordnik wordlist (wordnik/wordlist). Answers
always come from curated WORDS_EN; VALID_EN only widens what a player may
guess. The 2.3MB source file can't be fetched through the bot's tooling, so
tools/make-valid-en.mjs (zero-dep) ships instead: run `curl -O
https://raw.githubusercontent.com/wordnik/wordlist/main/wordlist-20210729.txt
&& node tools/make-valid-en.mjs` locally (or drop the txt into the chat) and
assets/valid-en.js lands with its MIT header; bank-shape guards follow in
the same commit as the asset.

## Mobile UX pass

Cipher now types through a hidden off-screen input (tap a slot, the soft
keyboard opens; a sentinel space turns backspace into an input event) - copy
that trick into any future keyboard-driven game. The rest of the fleet is
still desktop-first in small ways: Sprint only accepts a word on Enter, which
costs an extra tap on a phone, and nothing has been trialed on a real small
screen. Worth one deliberate pass on a phone before players find what we
missed.

## Metrics ledger (single source of truth: scores/manifest.json)

- bogus: points 0-3, high (0 on a miss)
- well-actually: points 0-4, high
- rings: moves, low (exact BFS par; edges 0/5/7/9/11/13/15/17/20)
- grid: words banked, high (0-16 in twos)
- grid-hard: words banked, high (bonus curve, online-only mode)
- fermi: points 0-3, high
- sift: mistakes 0-4, low (4 on a loss)
- rounds: guesses 1-7, low (7 on a loss)
- trace: rungs, low (steps+10 on a give-up)
- lightbox: mistakes 0-4, low (4 on a fogged film)
- sprint: words 0-5, high
- cipher: hints 0-5, low (7 on a revealed codebook)
- timeline: checks 1+, low (9 on a reveal)
- museum: clues 1-5, low (6 on a stumped visit)

Since 2026-10-29 the single source is `scores/manifest.json` (epoch, tz,
per-game better + histogram edges). scores/server.py loads it at boot, the
client pages carry the same constants inline for offline play, and
tests/games/cross-checks.js fails CI if the shell, the landing page or the
server disagree with the manifest. SPECS in server.py is gone; the list above
is documentation only.

## Batch 4 candidates

- Dig: a daily excavation grid - probe cells, read stratigraphy, date the layer
- Almanac: today-in-history trivia with a twist (multiple choice, escalating)
- Follow: a daily six-degrees chain between two historical figures


## Server-gated puzzle delivery (2026-10-28)

Every bank-driven game now ships its bank inline AND defers to the scores
service: over file:// or ?solo the inline bank plays (offline stays
self-contained); online the page asks GET /api/puzzle?game=...&day=... and
the served puzzle replaces the inline pick, so the shipped site no longer
contains tomorrow's answers. bogus + well-actually piloted the pattern;
this batch converts rounds, fermi, cipher, museum, lightbox, sift,
timeline.

Boundary: sprint, trace, recycle-grid and recycle-rings stay client-only -
their banks are generators the game needs at play time (word validation,
board checking), not answer keys, so serving them buys nothing.

Timeline is the one windowed game: the whole bank is too big to ship
wholesale in a daily answer, so the store carries {bank, picks} with 1000
precomputed days (same seed, same shuffle, same distinct-years walk as
the page). Direct games ship their bank whole; the server serves
bank[day % len]. One cosmetic difference online: the served path
reshuffles the display lane with a fresh rng, so the lane order can
differ from the offline pick for the same day - the events and the
answer are identical.

The stores are committed per game (scores/<game>/puzzles.json) and
verified against the client banks by tools/export-puzzles.mjs: CI, make
test and npm test all run the verifier first, so a bank edited without
re-exporting its store fails the build. scores/server.py loads each
store from next to itself, so the scores container just COPYs scores/
in. tests/games/timeline.js deep-checks the committed timeline picks
against the page's own offline day-0 pick, and server_test.py does the
same against the served JSON.

## Docker refine (2026-10-28)

The web image no longer bind-mounts the repo: it bakes in the ONLINE
bundle (banks stripped) built by a throwaway node stage, so a rebuild is
what ships site content - the pull-based timer already runs compose up
--build. Plain HTTP on host port 8080, auto_https off, no domain config:
TLS/domains belong to the edge proxy in front of it (the standalone
Traefik on the other Pi). This keeps the repo self-contained - no edge
config lives here on purpose.

The wording guard moved local: checks/wording.js runs as part of
checks/games.js (same rule, same exemptions); the old CI grep matched its
own workflow file and kept main red, so the CI copy is gone - too specific
for CI, right at home in make test.

## Test split + manifest single source (done 2026-10-29)

tests/run.js is now a thin orchestrator over per-game modules in tests/games/
(each game's playthrough, server-gated.js for online delivery,
cross-checks.js for the shell/manifest/landing agreement, _lib.js for the
shared game list). Dropping a game later means deleting its module and its
entry in the MODULES list, nothing else. A suite-guard group fails the run
if the orchestrator ever loads no modules or runs zero assertions (an empty
file exits 0 in Node, so a silent pass must be impossible).

## Batch 5 candidates: recipes over the layer (2026-10-30)

The idea list below is recorded as the recipe each game would arrive
as, so the layer grows toward them and the games land thin.
Superlative below has since landed; the rest do not build yet; the
ko-fi card on the landing page covers the support
idea and is already live.

- Who Said It: the quote game. quotes.json already keys each line to
  its speaker; the enrichment it wants is more y and via on the quotes,
  and a country hint after a miss wants country fields or resident
  relations to read.
- Relativity: which of two events a figure stood closer to. The layer
  already carries born and died, event years, and dated participant
  relations; the recipe draws a person, two events inside the life,
  and asks which year sits nearer. Richer with every dated relation.
- Fibbs: one truth among authored fibs. The facts file feeds the
  truth, the fibs stay authored beside it twist-style, and both key
  by about.
- Archived: where an artifact is kept. The housed-at relations already
  answer it; the recipe offers place options and grows with every new
  housed-at edge. It wants more places than the eighteen cities to
  shine.
- Refactored: when people believed the false thing. Needs dated
  misconception entries, a claim, a believed window, the correction;
  a natural new file keyed like the twists.
- Odd Fame: who did the odd accomplishment. Facts and twist entries
  with about keys feed it; deep person profiles make it rich.
- Superlative: group-relative superlatives. The pool wants a few
  numeric person fields (height, works, reign length); the recipe
  draws a group and asks the superlative the group itself decides.
  Depth first.
- Topical: this day in history. A pure recipe: events with month and
  day against the day of the year, plus same-day impostors from the
  same era.

The cut line for the next testing round: finish the enrichment the
recipes above point at (world entities for the fermi subjects, quote
years and sources, person numbers, more housed-at and participant
edges), then freeze layer growth, then one full round: every CI
layer, store byte-identity, a spot-review of the newest entries, and
per-game plays for any recipe game that has landed. After that round,
1.0 and the privacy flip come into view.

The first enrichment pass landed the same day: the fermi subjects joined
the wider world (the Moon, the Sun, the Earth, the Eiffel Tower, the
Louvre, the International Space Station, the Great Pyramid, the Roman
Empire, Lake Superior, Tokyo, the Library of Congress, the Milky Way,
the Challenger Deep), twenty more facts keyed to them, the reviewed
quotes carried their sources and three more their years, and the kept
things found their cities: ten new housed-at edges beside the two
Paris residents and the three Everest and Moon participants. Person
numbers wait for the Superlative recipe that defines them.

Superlative landed the same day as its v1 recipe, and it doubles as
the web test the layer wanted: a game whose whole content is the
people file. Every life the layer dates at both ends joins the pool
in canonical id order (450 of the 512), the pool cuts into groups of
four, and each group serves the question its own numbers settle
alone, the longest life or the first or last birth, rotating by
group (day 0: Ada Lovelace, John Adams, Akbar and Al-Idrisi, the
longest life, John Adams). The store carries 112 boards on the same
store-and-bank pipeline, checked by the same cross-checks, with its
own headless playthrough and server-gated block. Person numbers
still wait; when they land the recipe grows richer questions
without a new store shape.

The bonus round landed with the first person numbers. A board now
carries a bonus match whenever the numbers seat every life one
superlative it tops: the three the dates always settle (the longest
life, the first birth, the last birth) plus the measured and counted
dims, height only when all four lives are measured, works and reign
reading a missing number as zero. Batch one records fifty reign
years (sovereigns only, from bedrock accession dates), five heights
(Lincoln, Washington, Napoleon, Victoria, Ali) and two catalogue
counts (Bach at 1080 by BWV, Mozart at 626 by K), and the epoch
moved to Monday 2026-11-02 with pre-launch days clamped to No. 1 so
weekend visitors play the board Monday re-serves. 3 boards
carry the bonus so far, and every batch of numbers seats more.

Batch two seats six more: Handel at 612 by HWV, Haydn at 750 by
Hoboken, Wagner at 113 by WWV, and three more crowns, Genghis Khan
at 21, Napoleon III at 18, Nader Shah at 11. 3 boards carry
the bonus now; the composers without a crisp catalogue count stay
honest at zero until a reputable source settles them.

Batch three goes targeted: the blocker map says 51 boards sit one
number away, and the batch seats what a reputable source settles,
Corelli at 72 (six published sets of twelve, the authenticated
works), plus three crowns the first pass missed, Mehmed II at 30,
Julius II at 10, Cromwell at 5. 4 boards carry the bonus
now (0, 6, 21, 44). Vivaldi stays honest at zero: the RV
catalogue is open-ended past 740, so no standard total exists.

The inversions land on Carl's read that with enough metrics
everyone tops something: every dim counts from both ends now,
so a middle life can top the shortest life or the shortest
reign the way an extreme one tops the longest, and the bottom
ends of the counting dims compare only the lives a source
actually measured (a life that never reigned stays out of the
shortest-reign contest). The one life a group cannot seat takes
the most-average chip, so a board carries its bonus whenever a
single life is all that stays untopped: 95 of the 112 boards
carry the bonus now, 26 seated outright and 69 through the most
average, and 17 groups still wait on numbers for their middles.
The average lives are the honest zeros by another name, mostly
novelists and composers without catalogues; the hunt continues
against the middle lives of those 17. Day 1 (al-Khwarizmi,
al-Kindi, al-Razi, Aldus Manutius) seats through the fallback
with al-Razi the most average, so the no-bonus test pin moves
to day 13 (Butch Cassidy, Richard Byrd, Byron, James Cagney).

## Knowledge layer (done 2026-10-30)

Every bank game now compiles from one knowledge layer in knowledge/:
people, events, places, artifacts, the wider world, animals and quotes
as entities in one id namespace, relations typed twenty-two ways, the
twist tellings for bogus and well-actually, the commonly cited figures
fermi asks about, the stories the year games
share, and each game's recipe over the whole. build-knowledge compiles
the layer to the committed stores byte-exact (CI verifies), and
export-puzzles re-emits the client banks from the stores: truth stored
once, every manipulation a marked derivation. Timeline and rounds read
events, thread walks the people graph (one connected component, no
orphans, edges filtered to the nodes it knows), brunch seats the
presence layer, museum shows artifacts, cipher encrypts quotes, sift
sorts boards authored over the layer, fermi asks the commonly cited
figures keyed by about ids, and the twist tellings key
themselves to the graph. lightbox stays hand-banked on purpose:
picture clues are not shared entities. The wording guard retired with the rework it watched
over (the module is gone); the em dash rule covers new copy only.
SCHEMA.md in knowledge/ is the format reference.

Deferred on purpose: wiki/sameAs alias matching, a sift board
auto-generator (the boards are authored for now), and the Batch 4 games
(Dig, Almanac, Follow) - all natural future recipes over the layer.
