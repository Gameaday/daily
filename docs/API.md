# The scores service API

The contract for scores/server.py, spoken by the pages through
shell/common.js. The service identifies itself as server_version
"warmup-curve/4.9" and api_version 2: server_version moves with the
code, api_version with the wire contract, and /health and /manifest
speak both. This document describes api_version 2 exactly as it is.

## Conventions

Base: every request walks the same bases in order: same-origin /api,
then http://localhost:8787, then http://127.0.0.1:8787. The first base
that answers wins.

- Request bodies are JSON, capped at 2048 bytes (413 above). Responses
  are JSON.
- game is a manifest ledger name: one of the thirteen gated page names
  (bogus, well-actually, rounds, fermi, cipher, museum, lightbox,
  sift, timeline, thread, brunch, superlative, relativity) or a generator name
  (sprint, rings, rings-bonus, trace, grid, grid-hard).
- day is the day index: days since the epoch 2026-11-02 in
  America/New_York, clamped at 0 before launch, bounded -1000..100000.
- Errors are {"error": message} with a meaningful status. A 422 is an
  answer, not an outage: the evidence did not check out.
- Nothing a client types is stored. Museum names and well-actually
  corrections cross the wire, are graded, and are discarded.

    status  meaning
    400     malformed request, a move that is not a move object, or a move the round state forbids (bad pick, repeat pick, hint with nothing left)
    403     a day the caller may not touch (future day, dealt play off the live day)
    404     nothing there (no session, no puzzles, no answer key)
    409     the round is over; a dealt session refuses further guesses
    413     request body above 2048 bytes
    422     evidence rejected: the answer failed the day's key
    429     per-IP daily cap exceeded

Per-IP caps (per ET day): 10000 GETs, 300 /submit posts, 400 dealt
actions (/deal, /guess, /reveal). /health is exempt, so a healthcheck
can never trip the caps.

    endpoint          cache policy
    /health /dist /submit and every live answer   no-store
    /puzzle           public, until the next ET midnight
    /manifest         public, 3600

## GET endpoints

### /health

    {"ok": true, "api_version": 2, "boards": 3, "day": 1, "num": 2}

boards is the number of live (game, day) curves in memory; day and num
echo the server's own day math; api_version is the wire contract
version the service speaks.

### /manifest

The scoring truth (the epoch, the timezone, and per ledger game the
better direction and the histogram edges) with the wire's api_version
added beside it.

    {"epoch": "2026-11-02", "tz": "America/New_York",
     "games": {"rounds": {"better": "high", "edges": [0, 1, 2, 3, 4]}, ...}}

### /puzzle?game=&day=

The day's puzzle as {game, day, today, puzzle}. On the live day every
gated game ships its strip (the per-game tables below); an archive day
ships the full puzzle, key included, because the round is long over
and the page grades locally. Future days are 403.

### /dist?game=&day=[&v=]

The day's curve snapshot: today from memory, past days from the
archive (those carry "archived": true and serve under their own
recorded edges and direction). v personalizes (marks your bin,
estimates beat and mean) without tallying.

    {"count": 12, "beat": 7, "mean": 2.4,
     "bins": [{"lo": 0, "hi": 1, "count": 4, "you": true}, ...],
     "better": "high"}

## POST /submit

One submission per client id per game-day: the first tallies, later
visits GET /dist with v instead. Two shapes.

Value post (generator games only; a gated game's value post is retired
and answered 400):

    {"game": "grid", "day": 1, "value": 12, "id": "p3x9k2ab"}

Evidence post (the thirteen gated games):

    {"game": "rounds", "day": 1, "id": "p3x9k2ab",
     "status": "won", "answer": 1865, "meta": {"guesses": 3},
     "nonce": "9f2c..."}

status is won, lost or gave. The answer and meta are graded against
the day's key (the meta caps below); the points are derived
server-side. A loss or a give-up is 0 no matter the meta (fermi,
superlative and relativity keep their partial scores). A nonce is the stronger claim:
the session's own verdict, answer and counters override the client's,
and the session is spent. An aged or unknown nonce simply falls back to
grading what was posted, so a mid-game session loss costs the session's
metering, never the play.

Sprint is the one generator with a clock: a value post with a nonce is
checked against the server-stamped window (see /reveal) and derives 0
outside it.

The success response is the personalized snapshot (the /dist shape).

## Dealt play

A dealt session is the round: a random nonce over an in-memory map
holding the game, the day and the counters. It is purged when the day
rolls over, after 30 idle minutes, or once a finished round is
submitted; a finished round answers 409 to further guesses. The
lifecycle is one shape for every dealt game:

    POST /deal    {"game", "day"}        -> {nonce, today, puzzle}   (sprint: no puzzle)
    POST /guess   {"nonce", "move": {...}}  -> verdict, feedback, [reveal]
    POST /submit  {...evidence, "nonce"} -> the curve

Verdict vocabulary: won, lost and gave are terminal; miss, found,
clue, hit and hint are in play. The reveal rides only a terminal
verdict.

### /deal

    {"game": "thread", "day": 1}
    -> {"nonce": "9f2c...", "today": 1,
        "puzzle": {"s": {...}, "e": {...}, "k": 3, "tray": [...]}}

Dealt play is for the live day only (403 otherwise) and only for the
dealt games (400 otherwise). The puzzle is the strip: the question
without the key. Sprint deals a clock and no puzzle.

### /guess

One move per call: the nonce plus one move object under "move", so
the envelope is one schema for every dealt game. A guess whose move
is missing or not an object is answered 400 "bad move". The move's
fields, per game:

    rounds         {"y": 1865}
    brunch         {"pick": 1}
    fermi          {"v": 240000}
    well-actually  {"pick": 2} or {"correction": "typed text"}
    museum         {"name": "the rosetta stone"} or {"clue": 1}
    bogus          {"pick": 0}
    superlative    {"pick": 2}
    relativity     {"pick": 0}
    sift           {"pick": ["one", "two", "three"]}
    lightbox       {"grid": ["0110", ...]}
    cipher         {"check": {"Q": "e", ...}} or {"hint": 1, "have": {...}} or {"give": 1}
    timeline       {"order": [2, 0, 3, 1]} or {"give": 1}
    thread         {"chain": ["id1", "id2", ...]} or {"give": 1}

### /reveal (sprint only)

The starting gun: t0 is stamped once and never reset, the window is
90 seconds with a 10 second network grace, and an unsubmitted round is
reaped 150 seconds after the gun.

    {"nonce": "9f2c..."} -> {"ok": true, "elapsed": 0.0, "window": 90}

## The per-game contract

### rounds (find the year)

- Strip: the stored clue minus the year and the why.
- Move: {"y": int, 1000..2200}.
- Feedback: miss carries heat (scalding within 2, hot within 5, warm
  within 15, cold beyond) and a direction hint (go earlier or go
  later, wrong century or right decade); the exact year wins; the
  sixth miss loses. Won and lost carry reveal {y, w}.
- Evidence: answer the year; meta guesses 1..6; points 4 minus
  guesses, floored at 0.

### brunch (odd one out)

- Strip: the options table minus the answer index and the why.
- Move: {"pick": index into opts}, one guess.
- Verdict: won or lost, with reveal {a, w}.
- Evidence: answer the picked index; points 1.

### fermi (estimate)

- Strip: the question minus the cited value and the why.
- Move: {"v": positive number}, one guess that always settles the
  round: {verdict: "won", score, reveal {a, w}}.
- Score: 3 within 3x, 2 within 10x, 1 within 100x, else 0.
- Evidence: answer the estimate; the same ratio buckets.

### well-actually (find the lie, name the fix)

- Strip: the statement minus the lie, the corrections, the canonical
  and the why.
- Move: {"pick": index}, unique; the lie gives verdict found (no
  reveal yet), three wrong picks lose with reveal {l, c, w}, otherwise
  miss with left. After found: {"correction": text} settles won with
  bonus correct or wrong, and reveal {c, w}.
- Evidence: answer {picks, typed}; points 3 minus wrong picks, plus 1
  for a correction that matches the accepted list.

### museum (name the exhibit)

- Strip: the clues minus the name, the accepted aliases and the story.
- Move: {"clue": 1} gives verdict clue and clueIdx (the session meters
  the clues, 4 max); {"name": up to 40 chars} wins with reveal {a, w},
  misses with clueIdx, or loses after the meter is spent.
- Evidence: answer the name (graded against the accepted list); meta
  clues 1..5; points 4 minus clues, floored at 0.

### bogus (spot the lie)

- Strip: the passage minus the lie and the why.
- Move: {"pick": index}, unique; the lie wins with reveal {l, w}, three
  strikes lose with the same reveal, otherwise miss with left.
- Evidence: answer the picks list; points 3 minus wrong picks.

### superlative (four lives, eight questions)

- Strip: the cohort and the questions minus each question's answer
  index.
- Move: {"pick": index}, one per round in order; each spent round
  returns hit or miss with a (that round's answer index); the last
  carries final: true.
- Evidence: answer the picks list; points are the correct rounds; won
  only on a clean sweep.

### relativity (three lives, one question each)

- Strip: the rounds minus each round's answer index and fine print.
- Move: {"pick": index}, one per round in order; each spent round
  returns hit or miss with a (that round's answer index) and w (the
  fine print that settles it); the last carries final: true.
- Evidence: answer the picks list; points are the correct rounds; won
  only on a clean sweep.

### sift (sort into threes)

- Strip: derived {t, tiles}: the tiles of every group, shuffled by the
  day seed; the categories never ship.
- Move: {"pick": [3 distinct texts]}; a real group gives hit with cat,
  n, i and final on the last group (a re-found group 400s); a miss
  counts; the fourth miss loses with reveal {t, cats}.
- Evidence: answer the groups; meta mistakes 0..4; points 3 minus
  mistakes.

### lightbox (develop the picture)

- Strip: derived {rc, cc}: the runs of filled cells per row and
  column; the grid and its name never ship.
- Move: {"grid": [rows of "0"|"1"|"2"]} (empty, filled, marked); the
  exact grid wins with reveal {n, g}; a miss returns bad (wrongly
  filled) and need (wrongly empty) plus the mistake count; the fourth
  miss loses with the reveal.
- Evidence: answer the grid rows; meta mistakes 0..4; points 3 minus
  mistakes.

### cipher (decode the quote)

- Strip: derived {a, c}: the quote encrypted under the day's
  server-side substitution; the plaintext never ships.
- Move: {"check": {cipher letter: plain letter}} wins with reveal {q,
  a, sub} or misses with right and total (a count, never which
  letters); {"hint": 1, "have": {...}} returns hint with cipher, plain
  and hints, 5 max; {"give": 1} gives with the full reveal.
- Evidence: answer the quote text (compared alphanumeric-normalized);
  meta hints 0..5; points 3 minus hints.

### timeline (order the events)

- Strip: the events minus their years.
- Move: {"order": [event indexes]}, the player's arrangement; a miss
  returns right (how many stand), lock (which positions stand) and
  checks, never a year; the exact order wins with reveal (the events
  with their years); the miss that spends the budget loses with the
  same reveal; {"give": 1} gives with it.
- Evidence: answer the years in chronological order; meta checks
  1..n+1, one more than the day's event count (the budget a real
  player could ever need); points 4 minus checks, floored at 0.

### thread (connect start to end)

- Strip: derived {s, e, k, tray}: the start, the end, the chain length
  and the offered figures (middles and decoys) shuffled into one tray;
  the chain, the decoy split and the links never ship.
- Move: {"chain": [k distinct ids from the tray]}; a miss returns
  right, lock and checks; the exact chain wins with reveal {m, d,
  links}; {"give": 1} gives with the same reveal.
- Evidence: answer the full chain (start, middles, end); meta checks
  1..999; points 4 minus checks, floored at 0.

### sprint (the dealt generator)

- Deal: a nonce and no puzzle; the page builds its board locally.
- /reveal: the starting gun; /submit: the value checked against the
  window. The session's clock is the only clock that counts.

## Example: one thread round

    POST /deal   {"game": "thread", "day": 1}
      -> {"nonce": "ab12", "today": 1,
          "puzzle": {"s": {...}, "e": {...}, "k": 3, "tray": [9 figures]}}

    POST /guess  {"nonce": "ab12", "move": {"chain": ["id-d1", "id-m1", "id-d2"]}}
      -> {"verdict": "miss", "right": 1, "lock": [false, true, false],
          "checks": 1}

    POST /guess  {"nonce": "ab12", "move": {"chain": ["id-m2", "id-m1", "id-m3"]}}
      -> {"verdict": "won", "checks": 2,
          "reveal": {"m": ["id-m2", "id-m1", "id-m3"], "d": [...],
                     "links": [...]}}

    POST /submit {"game": "thread", "day": 1, "id": "p3x...",
                  "status": "won", "answer": ["id-s", "id-m2", "id-m1",
                  "id-m3", "id-e"], "meta": {"checks": 2},
                  "nonce": "ab12"}
      -> the personalized snapshot
