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

function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

/* the offline thread walk: unique-shortest-path chains, then two decoys
   each, drawn so the offered set still admits exactly one solution */
function threadGraph(bank){
  const ids = bank.nodes.map(x => x.id);
  const pos = {};
  ids.forEach((id, i) => { pos[id] = i; });
  const n = ids.length;
  const adj = [];
  for (let i = 0; i < n; i++) adj.push([]);
  const pairSet = new Set();
  for (const e of bank.edges){
    const ia = pos[e.a], ib = pos[e.b];
    const key = ia < ib ? ia + ':' + ib : ib + ':' + ia;
    if (pairSet.has(key)) continue;
    pairSet.add(key);
    adj[ia].push(ib);
    adj[ib].push(ia);
  }
  const linked = (i, j) => pairSet.has(i < j ? i + ':' + j : j + ':' + i);
  return { ids, pos, n, adj, linked };
}

function threadCandidates(bank){
  const g = threadGraph(bank);
  const cands = [];
  for (let u = 0; u < g.n; u++){
    const dist = new Array(g.n).fill(-1);
    const cnt = new Array(g.n).fill(0);
    dist[u] = 0; cnt[u] = 1;
    const q = [u];
    for (let qi = 0; qi < q.length; qi++){
      const x = q[qi];
      for (const w of g.adj[x]){
        if (dist[w] === -1){ dist[w] = dist[x] + 1; q.push(w); }
        if (dist[w] === dist[x] + 1) cnt[w] += cnt[x];
      }
    }
    for (let v = u + 1; v < g.n; v++){
      if (dist[v] < 3 || dist[v] > 5 || cnt[v] !== 1) continue;
      const path = [v];
      let cur = v;
      while (cur !== u){
        for (const w of g.adj[cur]) if (dist[w] === dist[cur] - 1){ path.push(w); cur = w; break; }
      }
      path.reverse();
      cands.push({ s: u, e: v, m: path.slice(1, path.length - 1) });
    }
  }
  return { g, cands };
}

function threadCountSolutions(cand, extra, linked){
  const k = cand.m.length;
  const offered = cand.m.concat(extra);
  let count = 0;
  const used = new Array(offered.length).fill(false);
  (function rec(prev, depth){
    if (count > 1) return;
    if (depth === k){ if (linked(prev, cand.e)) count++; return; }
    for (let i = 0; i < offered.length; i++){
      if (used[i] || !linked(prev, offered[i])) continue;
      used[i] = true;
      rec(offered[i], depth + 1);
      used[i] = false;
      if (count > 1) return;
    }
  })(cand.s, 0);
  return count;
}

function threadWalk(bank, days){
  const gc = threadCandidates(bank);
  const ids = gc.g.ids;
  const linked = gc.g.linked;
  const cands = gc.cands;
  const used = new Set();
  const picks = [];
  for (let day = 0; day < days; day++){
    const rng = mulberry32(day * 4517 + 303);
    const i0 = Math.floor(rng() * cands.length);
    let pick = null;
    for (let t = 0; t < 100 && !pick; t++){
      const c = cands[(i0 + t) % cands.length];
      const key = ids[c.s] + ':' + ids[c.e];
      if (used.has(key)) continue;
      const mSet = new Set(c.m);
      const decoys = [];
      for (let tries = 0; tries < 30; tries++){
        const di = Math.floor(rng() * ids.length);
        if (di === c.s || di === c.e || mSet.has(di) || decoys.indexOf(di) !== -1) continue;
        if (threadCountSolutions(c, decoys.concat([di]), linked) === 1) decoys.push(di);
        if (decoys.length === 2) break;
      }
      if (decoys.length === 2)
        pick = { s: ids[c.s], e: ids[c.e], m: c.m.map(i => ids[i]), d: decoys.map(i => ids[i]) };
    }
    if (!pick) throw new Error('thread walk ran dry on day ' + day);
    used.add(pick.s + ':' + pick.e);
    picks.push(pick);
  }
  return picks;
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
