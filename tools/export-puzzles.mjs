/* Verifies - and with --write, regenerates - the generated bank files
   (assets/banks/<game>.js) against the committed puzzle stores
   (puzzles/<game>/puzzles.json).

   The stores are the single source of truth: banks are edited as data in
   the stores, each page loads its generated bank file, and the scores
   service serves the same store. This tool re-emits the tiny JS file, so
   the bank never exists in two hand-maintained places.

   - every direct game's bank file must equal its store (the same JSON)
   - timeline's bank file must equal its store's bank, and the store's
     precomputed picks must match a fresh offline walk (same seed, same
     shuffle, same distinct-years walk)
   - thread's bank file must equal its store's bank, and the store's picks
     must match the offline chain walk (same seed, same decoy draws)
   - generator games ship empty stores by design

   Default mode (what CI runs) never writes anything and exits 1 on drift.
   Run: node tools/export-puzzles.mjs          (verify; exit 0 = verified)
        node tools/export-puzzles.mjs --write   (regenerate drifted banks) */
import fs from 'node:fs';
import { threadWalk, pickForDay } from './thread-walk.mjs';

const WRITE = process.argv.includes('--write');
/* the game list, bank floors, and the dir -> ledger mapping have one
   source of truth: games.json at the repo root */
const LIST = JSON.parse(fs.readFileSync('games.json', 'utf8'));
const DIRECT = Object.fromEntries(
  Object.entries(LIST.gated).filter(([g]) => g !== 'timeline' && g !== 'thread'));
const EMPTY = LIST.generator;
/* minimum bank sizes: CI fails if a bank ever drops below this floor.
   Growing the banks is 1.0.x work; this lint only keeps the floor from
   quietly eroding under an edit. */
const MIN_BANK = LIST.minBank;
const MIN_TIMELINE_BANK = LIST.minTimelineBank;

function readStore(game){
  return JSON.parse(fs.readFileSync('puzzles/' + game + '/puzzles.json', 'utf8'));
}

function bankPath(game){
  return 'assets/banks/' + game + '.js';
}

function emitBank(name, data){
  return 'const ' + name + ' = ' + JSON.stringify(data) + ';\n';
}

/* check one generated bank file against its store; --write re-emits it */
function checkBank(game, name, data){
  const expected = emitBank(name, data);
  let actual = null;
  try { actual = fs.readFileSync(bankPath(game), 'utf8'); }
  catch (e) { /* missing file */ }
  if (actual === expected){
    console.log('ok  ' + game + ': generated bank matches the store');
    return;
  }
  if (WRITE){
    fs.writeFileSync(bankPath(game), expected);
    console.log('wrote ' + bankPath(game));
    return;
  }
  fail(game + ': ' + bankPath(game) + ' drifted from the store (run: node tools/export-puzzles.mjs --write)');
}

let fails = 0;
const fail = msg => { console.error('FAIL ' + msg); fails++; };

/* games.json and the manifest must agree on which scoring ledgers
   exist. Directory names and ledger keys differ on purpose (recycle-grid
   plays two ledgers, grid and grid-hard), so the mapping is explicit. */
{
  const manifest = JSON.parse(fs.readFileSync('scores/manifest.json', 'utf8'));
  const a = Object.keys(manifest.games).sort();
  const b = Object.values(LIST.ledger).flat().sort();
  if (JSON.stringify(a) !== JSON.stringify(b))
    fail('games.json ledger does not match the manifest games ledger');
  for (const g of LIST.order)
    if (!LIST.ledger[g]) fail('games.json: no manifest ledger for ' + g);
}

/* direct games: the store is the source; the bank file must match it */
for (const [game, name] of Object.entries(DIRECT)){
  const store = readStore(game);
  if (!Array.isArray(store) || store.length < MIN_BANK)
    fail(game + ': store below the minimum (' +
      (Array.isArray(store) ? store.length + ' < ' + MIN_BANK + ' entries' : 'not an array') + ')');
  checkBank(game, name, store);
}

/* generator games: empty stores by design */
for (const game of EMPTY){
  const store = readStore(game);
  if (Array.isArray(store) && store.length === 0){
    console.log('ok  ' + game + ': empty store (generator game)');
  } else {
    fail(game + ': generator game store must be an empty array');
  }
}

/* timeline: the store's bank feeds the page; its picks must match the walk */
{
  const store = readStore('timeline');
  const bank = store.bank;
  if (!Array.isArray(bank) || bank.length < MIN_TIMELINE_BANK)
    fail('timeline: bank below the minimum (' +
      (Array.isArray(bank) ? bank.length + ' < ' + MIN_TIMELINE_BANK + ' events' : 'not an array') + ')');
  const picksOk = Array.isArray(store.picks) && store.picks.length > 0 &&
    store.picks.every((p, day) => JSON.stringify(p) === JSON.stringify(pickForDay(bank, day)));
  if (picksOk){
    console.log('ok  timeline: ' + store.picks.length + ' precomputed picks match the offline walk');
  } else {
    fail('timeline: picks drift from the offline walk');
  }
  checkBank('timeline', LIST.gated.timeline, bank);
}

/* thread: the store's graph feeds the page; its picks must match the walk */
if (LIST.gated.thread){
  const store = readStore('thread');
  const bank = store.bank;
  if (!bank || !Array.isArray(bank.nodes) || !Array.isArray(bank.edges)){
    fail('thread: store.bank must hold a nodes array and an edges array');
  } else {
    const ids = new Set(bank.nodes.map(x => x.id));
    if (ids.size !== bank.nodes.length) fail('thread: duplicate node ids');
    const pos = {};
    bank.nodes.forEach((x, i) => { pos[x.id] = i; });
    const pairs = new Set();
    for (const e of bank.edges){
      if (!ids.has(e.a) || !ids.has(e.b)) fail('thread: edge references an unknown node');
      else if (e.a === e.b) fail('thread: edge connects a node to itself');
      else {
        const key = pos[e.a] < pos[e.b] ? pos[e.a] + ':' + pos[e.b] : pos[e.b] + ':' + pos[e.a];
        if (pairs.has(key)) fail('thread: duplicate edge pair');
        pairs.add(key);
      }
    }
    if (bank.nodes.length < LIST.minThreadNodes)
      fail('thread: bank below the minimum (' + bank.nodes.length + ' < ' + LIST.minThreadNodes + ' nodes)');
    const picks = threadWalk(bank, LIST.threadDays);
    if (JSON.stringify(store.picks) !== JSON.stringify(picks))
      fail('thread: picks drift from the offline walk');
    else console.log('ok  thread: ' + picks.length + ' precomputed picks match the offline walk');
    checkBank('thread', LIST.gated.thread, bank);
  }
}

if (fails){
  console.error('');
  console.error(fails + ' check(s) failed' + (WRITE ? '' : ' (run: node tools/export-puzzles.mjs --write)'));
  process.exit(1);
}
console.log('');
console.log(WRITE ? 'generated banks re-emitted from the stores'
                 : 'all generated banks verified against the committed stores');
