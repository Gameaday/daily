/* The offline thread walk, shared by the store verifier
   (tools/export-puzzles.mjs) and the knowledge compiler
   (tools/build-knowledge.mjs). Compiled picks must be byte-identical
   wherever they are computed, so this module is the one copy the tools
   share; the thread page keeps its own embedded copy (a page cannot
   import), and when this walk changes, the page copy changes with it.

   - mulberry32: the seeded PRNG, also used by the timeline walk
   - threadWalk: unique-shortest-path chains, then two decoys each, drawn
     so the offered set still admits exactly one solution */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

export { mulberry32, threadGraph, threadCandidates, threadCountSolutions, threadWalk };
