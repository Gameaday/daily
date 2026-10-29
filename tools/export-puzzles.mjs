/* Verifies - and with --write, regenerates - the committed per-game puzzle
   stores (scores/<game>/puzzles.json) against the banks in the client pages.
   Every direct game's store must deep-equal its inline bank, generator games
   ship empty stores by design, and the timeline store's {bank, picks} must
   match the page's bank plus a fresh offline pick for every day in its window
   (same seed, same shuffle, same distinct-years walk).

   Default mode (what CI runs) never writes anything and exits 1 on drift.
   Run `node tools/export-puzzles.mjs --write` after editing a bank to
   regenerate the drifted stores, then commit both files together.

   Run: node tools/export-puzzles.mjs          (verify; exit 0 = verified)
        node tools/export-puzzles.mjs --write   (regenerate drifted stores) */
import fs from 'node:fs';

const WRITE = process.argv.includes('--write');
/* the game list, bank floors, and window size have one source of truth:
   games.json at the repo root */
const LIST = JSON.parse(fs.readFileSync('games.json', 'utf8'));
const DIRECT = Object.fromEntries(
  Object.entries(LIST.gated).filter(([g]) => g !== 'timeline'));
const EMPTY = LIST.generator;
const TIMELINE_DAYS = LIST.timelineDays;
/* minimum bank sizes: CI fails if a bank ever drops below this floor.
   Growing the banks is 1.0.x work; this lint only keeps the floor from
   quietly eroding under an edit. */
const MIN_BANK = LIST.minBank;
const MIN_TIMELINE_BANK = LIST.minTimelineBank;

function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function readBank(game, name){
  const src = fs.readFileSync(game + '/index.html', 'utf8');
  const m = src.match(new RegExp('const ' + name + ' = (\\[([\\s\\S]*?)\\]);'));
  if (!m) throw new Error(name + ' bank not found in ' + game + '/index.html');
  const bank = eval(m[1]);   // eslint-disable-line no-eval
  if (!Array.isArray(bank) || bank.length === 0) throw new Error(game + ': ' + name + ' is empty');
  return bank;
}

function readStore(game){
  return JSON.parse(fs.readFileSync('scores/' + game + '/puzzles.json', 'utf8'));
}

function storePath(game){
  return 'scores/' + game + '/puzzles.json';
}

/* the offline timeline walk: seeded shuffle, then first five distinct years */
function pickForDay(bank, day){
  const rng = mulberry32(day * 2357 + 71);
  const idxs = [];
  for (let i = 0; i < bank.length; i++) idxs.push(i);
  for (let i = idxs.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const picked = [];
  const seenYears = new Set();
  for (const i of idxs){
    if (!seenYears.has(bank[i].y)){ picked.push(i); seenYears.add(bank[i].y); }
    if (picked.length === 5) break;
  }
  return picked;
}

let fails = 0;
const fail = msg => { console.error('FAIL ' + msg); fails++; };

/* games.json and the manifest must agree on which games exist */
{
  const manifest = JSON.parse(fs.readFileSync('scores/manifest.json', 'utf8'));
  const a = Object.keys(manifest.games).sort();
  const b = [...LIST.order].sort();
  if (JSON.stringify(a) !== JSON.stringify(b))
    fail('games.json order does not match the manifest games ledger');
}

/* direct games: committed store must equal the inline bank */
for (const [game, name] of Object.entries(DIRECT)){
  const bank = readBank(game, name);
  if (bank.length < MIN_BANK)
    fail(game + ': bank below the minimum (' + bank.length + ' < ' + MIN_BANK + ' entries)');
  const store = readStore(game);
  if (JSON.stringify(store) === JSON.stringify(bank)){
    console.log('ok  ' + game + ': store matches the client bank (' + bank.length + ' entries)');
  } else if (WRITE){
    fs.writeFileSync(storePath(game), JSON.stringify(bank, null, 2) + '\n');
    console.log('wrote ' + storePath(game) + ' (' + bank.length + ' entries)');
  } else {
    fail(game + ': committed store does not match the inline bank');
  }
}

/* generator games: empty stores by design */
for (const game of EMPTY){
  const store = readStore(game);
  if (Array.isArray(store) && store.length === 0){
    console.log('ok  ' + game + ': empty store (generator game)');
  } else if (WRITE){
    fs.writeFileSync(storePath(game), '[]\n');
    console.log('wrote ' + storePath(game) + ' (empty store)');
  } else {
    fail(game + ': generator game store must be an empty array');
  }
}

/* timeline: windowed store - the whole bank plus precomputed picks */
{
  const bank = readBank('timeline', 'EVENTS');
  if (bank.length < MIN_TIMELINE_BANK)
    fail('timeline: bank below the minimum (' + bank.length + ' < ' + MIN_TIMELINE_BANK + ' events)');
  const store = readStore('timeline');
  const bankOk = JSON.stringify(store.bank) === JSON.stringify(bank);
  const picksOk = Array.isArray(store.picks) && store.picks.length > 0 &&
    store.picks.every((p, day) => JSON.stringify(p) === JSON.stringify(pickForDay(bank, day)));
  if (bankOk && picksOk){
    console.log('ok  timeline: bank matches (' + bank.length + ' events), ' + store.picks.length + ' precomputed picks match the offline walk');
  } else if (WRITE){
    const days = Array.isArray(store.picks) && store.picks.length ? store.picks.length : TIMELINE_DAYS;
    const picks = [];
    for (let day = 0; day < days; day++) picks.push(pickForDay(bank, day));
    fs.writeFileSync(storePath('timeline'), JSON.stringify({ bank, picks }, null, 2) + '\n');
    console.log('wrote ' + storePath('timeline') + ' (bank + ' + days + ' picks)');
  } else {
    if (!bankOk) fail('timeline: committed bank does not match the inline bank');
    if (bankOk && !picksOk) fail('timeline: picks drift from the offline walk');
  }
}

if (fails){
  console.error('');
  console.error(fails + ' store(s) drifted from the client banks' +
    (WRITE ? '' : ' (run: node tools/export-puzzles.mjs --write)'));
  process.exit(1);
}
console.log('');
console.log(WRITE ? 'stores regenerated from the client banks'
                 : 'all committed stores verified against the client banks');
