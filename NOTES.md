# Notes for later

Design notes we are deliberately not building yet. Each is small once the
shell is extracted (see common.js below).

## Deploy state (2026-10)

The repo now ships a Docker compose stack (Caddy web + scores, hardened) and
test-gated CD via GitHub Actions (see README). Nothing in the notes below
changes because of that - the scores service stays in-memory and consolidated
only, whether it runs under systemd or in a container. When the archive idea
below lands, note that the scores container is read_only: frozen snapshots
would need a small writable volume mounted at scores/archive/ - the one
deliberate disk write in the whole system, gated behind count >= 3.

## Curve representation cleanup

Today every game renders the histogram plus a sentence: "you: better than N
of M" (the "by X" unit tail was dropped in the fix pass) and the team average.
Opportunity: drop the prose entirely and let the chart do the talking, the way
racing-style puzzle games do - the distribution itself with an unmistakable
you-marker (accent bar, tick, and a tiny "you" label under your bin). One
glance, zero words.

The server already returns everything needed (bins with a you-flag, mean,
count). It is a pure client-side change to the shared renderBoard block - do
all 13 games at once, ideally right after the common.js extraction.

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

Retention is now 1 day (PRUNE_DAYS in server.py). If the team wants
"yesterday's curve" visible live, bump it to 2 - memory is not the
constraint, tidiness is.

## common.js shell extraction

The shared shell - palette CSS, EPOCH_KEY/etKey, nextETMidnight/tick, toast,
help modal, curve client, share-to-clipboard - is more than half of every
game. Extracting it makes new games ~100-150 lines each and makes the curve
representation change above a one-file edit. Do this before adding game 14.

## Mobile UX pass

Cipher now types through a hidden off-screen input (tap a slot, the soft
keyboard opens; a sentinel space turns backspace into an input event) - copy
that trick into any future keyboard-driven game. The rest of the fleet is
still desktop-first in small ways: Sprint only accepts a word on Enter, which
costs an extra tap on a phone, and nothing has been trialed on a real small
screen. Worth one deliberate pass on a phone before the team finds what we
missed.

## Metrics ledger (single source of truth: SPECS in scores/server.py)

- bogus: points 0-3, high (0 on a miss)
- well-actually: points 0-4, high
- rings: seconds, low (120+ clamps into the last bin)
- grid: words banked, high (0-16 in twos)
- fermi: points 0-3, high
- sift: mistakes 0-4, low (4 on a loss)
- rounds: guesses 1-7, low (7 on a loss)
- trace: rungs, low (steps+10 on a give-up)
- lightbox: mistakes 0-4, low (4 on a fogged film)
- sprint: words 0-5, high
- cipher: hints 0-5, low (7 on a revealed codebook)
- timeline: checks 1+, low (9 on a reveal)
- museum: clues 1-5, low (6 on a stumped visit)

## Batch 4 candidates

- Dig: a daily excavation grid - probe cells, read stratigraphy, date the layer
- Almanac: today-in-history trivia with a twist (multiple choice, escalating)
- Follow: a daily six-degrees chain between two historical figures
