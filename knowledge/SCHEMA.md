# The knowledge layer

One home for the facts the games share: entities (people, events,
places, artifacts, the wider world, the animals and quotes today),
the shared stories the year games tell, and their typed relations, compiled by tools/build-knowledge.mjs into
the per-game puzzle stores. The layer is the hand-maintained source;
the stores are generated artifacts, exactly like the bank files. CI
runs the compiler in verify mode, so hand edits to a compiled store
fail the build.

## Secrecy

Hidden by default: this directory, the stores, the banks, the pick
schedules and the recipes. Open by intent: the pages, the shared shell,
the scores service, the tests and the generic tooling. The repo goes
private when 1.0 ships, and nothing answer-bearing may wander into the
open half. Recorded with the decision: a pre-flip clone only knows a
schedule that the first post-flip bank change reshuffles.

## Entity files

- people.json - humans. Fields: id, n, d, plus born and died (the
  years the descriptor states, recorded only for CE ranges; a c. in d
  means the year is approximate).
- events.json - dated occurrences (battles, plots, fires, revolutions,
  congresses, councils). Fields: id, n, plus d (the terse descriptor
  the thread page shows), q (the canonical one-line description the
  year games prompt with), y (a positive integer) and month and day,
  recorded only when they are defensible.
- relations.json - each entry is { a, b, y, w, t }: a typed, dated
  relation between two entities. w is the reveal sentence. t is the
  relation type from the shared vocabulary (ally, colleague,
  correspondent, editor, family, friend, housed-at, influence,
  kindred, lover, member, opposed, participant, partnered, patron,
  physician, resident, rival, site-of, successor, teacher,
  translator), present when the telling knows it. The three location
  types (resident, site-of, housed-at) tie people, events,
  structures and kept things to the places they belong to. y is a positive integer year, and it is absent when no honest
  one exists (ancient relations carry no y at all).
- places.json - cities the presence spans anchor to and the
  location relations point at. Fields: id, n, d.
- world.json - the wider world the day tiles will point at: ships,
  deities, myths, works, buildings, instruments, geography,
  organizations, foods, words, money and games. Fields: id, n, d.
  Nothing compiles from it yet; the ids join the one namespace now,
  so a collision fails the build the moment it lands.
- animals.json - the creatures that flew and sailed before people
  did: the dogs, the apes, the fish and the squid. Fields: id, n, d.
  Same deal as the wider world: in the namespace now, compiled when
  a recipe needs them.
- presence.json - each entry is { p, place, from, to }: a person's
  documented span in one city. A person may hold several spans in the
  same city, and the brunch recipe queries the intersections.
- stories.json - the shared tellings the year games borrow: each
  entry is { id, t, w }, keyed by event id. The topic label t and
  the flavor line w live here once, so timeline and rounds never
  carry divergent copies.
- artifacts.json - the made things (objects, artworks, structures,
  documents, vessels). Fields: id, n, al (the accepted answers),
  c (five clue strings, cryptic to plain) and w (the story the
  reveal tells). museum compiles the whole file, in file order.
- quotes.json - the sayings cipher hides. Each entry is { id, by, q }:
  by keys to the speaker's person id, q is the line itself, y (the
  year it was said) and via (the work or the record that carries it)
  appear only when they are defensible, and a quote carries
  provenance when its dating was reviewed. Quote ids live outside
  the entity namespace. cipher compiles the whole file, in file
  order.
- bogus.json - the false tellings: a story with one lying
  segment. Each entry is { id, about, t, l, s, w }: t is the
  titled subject, s carries the segments, l marks the lying
  segment, w is the reveal, and about keys the telling to the
  entity it is about when the layer knows it. bogus compiles the
  whole file, in file order.
- well-actually.json - the correction tellings: a sentence
  whose wrong word the player replaces. Each entry is { id,
  about, t, l, c, a, s, w }: c is the answer, a its accepted
  spellings, l marks the lying segment, and about keys the
  telling to the entity it names when the layer knows it.
  well-actually compiles the whole file, in file order.

Every entity may also carry (nothing requires them yet):

- sameAs - the Wikidata Q-id (Q42), for dedupe and cross-checks
- provenance - where the fact came from, and when it was reviewed;
  facts added since the layer audit carry a reviewed date
- born / died (people), month / day (events) and from / to (presence
  spans) - structured dates, only when defensible

## Rules

- One id namespace across every type. Kebab-case slugs. The near miss
  that turned a planned John Franklin id into john-franklin is why.
- Honest dates or none. A year is a positive integer, so the
  ancients carry their BCE ranges in d alone; month-day and presence
  spans are recorded only when they are defensible. A presence
  span stays inside its person's life dates, a dated relation touches
  at least one living endpoint, and a relation never precedes the
  event it names.
- Original prose only. Never paste text from Wikipedia or any other
  share-alike source; contamination forecloses every future option.
- Facts about the world live here. Facts about how a puzzle plays
  (mechanics, puzzle copy, answer acceptance, pick schedules) live in
  the game's own files.

## Recipes

- thread: nodes are people plus the curated event list in
  puzzles/thread/recipe.json, in canonical id order; edges are the
  relations whose endpoints the thread knows, sorted by (a, b);
  picks are regenerated by the shared
  offline walk (tools/thread-walk.mjs). Output:
  puzzles/thread/puzzles.json and its bank file.
- timeline and rounds: puzzles/<game>/recipe.json is the ordered list
  of event ids the game plays; the topic label t and the flavor line
  w come from the shared stories, and q and y come from the layer, so
  one event serves both games from one telling. timeline's picks are regenerated by the shared
  offline walk. Output: puzzles/<game>/puzzles.json and its bank
  file.
- brunch: puzzles/brunch/recipe.json curates { id, y } moments (a
  city, a year); the compiler seats three people whose presence spans
  cover that city-year plus one impostor, alive that year but
  documented elsewhere, and scatters the four names with the seat
  index a. The seating rotates with the year, so a crowded table does
  not serve the same faces twice. Output: puzzles/brunch/puzzles.json and its bank file.
- museum: no recipe file; the whole artifacts file is the bank, and
  the file order is the day rotation, so no id sort ever moves an
  exhibit. Output: puzzles/museum/puzzles.json and its bank file.
- cipher: no recipe file; the whole quotes file is the bank, in
  file order, and the answers are the speakers the quotes name.
  Output: puzzles/cipher/puzzles.json and its bank file.
- bogus and well-actually: no recipe file; the whole twist file
  is the bank, in file order, and the file order is the day
  rotation, so no id sort ever moves a lie. Only the twist
  fields compile; the ids and the about keys stay in the layer.
  Output: puzzles/<game>/puzzles.json and its bank file.
- sift: no recipe file of its own; knowledge/sift.json is the
  board list, in file order, and the file order is the day
  rotation. Each board is { id, t, cats }: t is the title, cats
  holds four categories of three tiles, and each tile is an
  entity id, or { id, as } when the tile spells its own display.
  The store keeps the titles, the category names and the resolved
  tile strings; the ids stay in the layer. Output:
  puzzles/sift/puzzles.json and its bank file.

Canonical order is id sort everywhere, so any edit to the layer can
reshuffle the whole pick schedule. Before launch that is free; after
launch the freeze-tail policy applies (audit item 20). A canonical
sort can also flip a chain's orientation (the walk stores candidates
directionally), which changes nothing about validity: either end can
serve as the start.

## Workflow

  edit knowledge/*.json and the recipes (puzzles/<game>/recipe.json)
  node tools/build-knowledge.mjs --write    (recompile the stores)
  node tools/export-puzzles.mjs --write     (re-emit the banks)
  commit both

New games arrive as recipes over the layer. When a recipe needs scoped
relations (one only that game may see), the relation grows a scope
field and the compiler filters by it.
