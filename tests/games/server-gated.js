/* Server-gated delivery: with the generated bank files stubbed (the
   online bundle ships assets/banks/<game>.js as `const NAME = undefined;`),
   each game must still boot and play on the puzzle served by the scores
   service. Split from the old monolithic run.js. */
'use strict';
const { T0 } = require('./_lib');

async function run(h, ctx){
  const { readStore } = ctx;
  const serve = (game, puzzle) => ({ game, day: 0, puzzle, today: 0 });

  /* rounds: slide to the served year */
  {
    const live = h.boot('rounds', ['S', 'EV'], { now: T0, store: {} });
    const served = serve('rounds', live.x.EV);
    const r = h.boot('rounds', ['S', 'EV', 'EVENTS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.EVENTS === undefined, 'gated: rounds online boot has no bank');
    await h.flush();
    h.ok(r.env.els.qtext.textContent.indexOf(served.puzzle.q) >= 0, 'gated: rounds served question rendered');
    r.env.els.slider.value = String(served.puzzle.y);
    r.env.els.btnLock.click();
    h.eq(r.x.S.status, 'won', 'gated: rounds won on the served year');
  }
  /* fermi: guess the served answer */
  {
    const live = h.boot('fermi', ['Q'], { now: T0, store: {} });
    const served = serve('fermi', live.x.Q);
    const r = h.boot('fermi', ['S', 'QS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.QS === undefined, 'gated: fermi online boot has no bank');
    await h.flush();
    r.env.els.guess.value = String(served.puzzle.a);
    r.env.els.btnGuess.click();
    h.ok(r.x.S.scored, 'gated: fermi scored on the served answer');
  }
  /* cipher: the served quote decodes clean */
  {
    const live = h.boot('cipher', ['Q'], { now: T0, store: {} });
    const served = serve('cipher', live.x.Q);
    const r = h.boot('cipher', ['S', 'SUB', 'assign', 'QUOTES'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.QUOTES === undefined, 'gated: cipher online boot has no bank');
    await h.flush();
    h.ok(r.env.els.author.textContent.indexOf(served.puzzle.a) >= 0, 'gated: cipher served author rendered');
    for (const c of Object.keys(r.x.SUB.dec)){
      r.x.S.sel = c;
      r.x.assign(r.x.SUB.dec[c]);
    }
    h.eq(r.x.S.status, 'playing', 'gated: cipher does not auto-win while typing');
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'gated: cipher won on Check over the served quote');
  }
  /* museum: the served exhibit matches its alias */
  {
    const live = h.boot('museum', ['EXHIBIT'], { now: T0, store: {} });
    const served = serve('museum', live.x.EXHIBIT);
    const r = h.boot('museum', ['S', 'matches', 'submitGuess', 'MUSEUM'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.MUSEUM === undefined, 'gated: museum online boot has no bank');
    await h.flush();
    const alias = served.puzzle.al[0];
    h.ok(r.x.matches(alias), 'gated: museum served alias matches');
    r.env.els.guess.value = alias;
    r.x.submitGuess();
    h.eq(r.x.S.status, 'won', 'gated: museum won on the served exhibit');
  }
  /* lightbox: develop the served design clean */
  {
    const live = h.boot('lightbox', ['DESIGN', 'SOL'], { now: T0, store: {} });
    const sol = live.x.SOL;
    const served = serve('lightbox', live.x.DESIGN);
    const r = h.boot('lightbox', ['S', 'DESIGNS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.DESIGNS === undefined, 'gated: lightbox online boot has no bank');
    await h.flush();
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) r.x.S.marks[i][j] = sol[i][j] ? 1 : 0;
    r.env.els.btnDevelop.click();
    h.eq(r.x.S.status, 'won', 'gated: lightbox won on the served design');
    h.eq(r.x.S.mistakes, 0, 'gated: lightbox clean film');
  }
  /* sift: solve the served board */
  {
    const live = h.boot('sift', ['BOARD', 'TILES'], { now: T0, store: {} });
    const served = serve('sift', live.x.BOARD);
    const r = h.boot('sift', ['S', 'TILES', 'sel', 'BOARDS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.BOARDS === undefined, 'gated: sift online boot has no bank');
    await h.flush();
    const catIdx = c => r.x.TILES.map((t, i) => ({ t, i }))
      .filter(o => o.t.cat === c).map(o => o.i);
    h.eq(catIdx(0).length, 3, 'gated: sift served board has groups of 3');
    for (const c of [0, 1, 2, 3]){
      catIdx(c).forEach(i => r.x.sel.add(i));
      r.env.els.btnSubmit.click();
    }
    h.eq(r.x.S.status, 'won', 'gated: sift won on the served board');
  }
  /* timeline: the served events render in the lane */
  {
    const live = h.boot('timeline', ['EVO'], { now: T0, store: {} });
    const served = serve('timeline', { events: live.x.EVO });
    const r = h.boot('timeline', ['PICK', 'EVENTS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.EVENTS === undefined, 'gated: timeline online boot has no bank');
    await h.flush();
    const needle = served.puzzle.events[0].q;
    const found = Object.keys(r.env.els).some(k =>
      String(r.env.els[k].innerHTML || '').indexOf(needle) >= 0 ||
      String(r.env.els[k].textContent || '').indexOf(needle) >= 0);
    h.ok(found, 'gated: timeline served events rendered');
  }
  /* thread: the served chain plays through */
  {
    const live = h.boot('thread', ['PZ'], { now: T0, store: {} });
    const served = serve('thread', live.x.PZ);
    const r = h.boot('thread', ['S', 'PZ', 'THREAD'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.THREAD === undefined, 'gated: thread online boot has no bank');
    await h.flush();
    h.ok(JSON.stringify(r.x.PZ) === JSON.stringify(live.x.PZ),
      'gated: thread served puzzle matches the offline one');
    r.x.S.slots = r.x.PZ.m.map(x => x.id);
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'gated: thread won on the served chain');
  }
  /* the exported store must agree with each game's own offline pick */
  if (readStore){
    const store = JSON.parse(readStore());
    const live = h.boot('timeline', ['EVO'], { now: T0, store: {} });
    const ev0 = store.timeline.picks[0].map(i => store.timeline.bank[i]);
    h.ok(JSON.stringify(live.x.EVO) === JSON.stringify(ev0),
      'gated: exported timeline picks[0] match the offline day-0 events');
    const rEv = h.boot('rounds', ['EV'], { now: T0, store: {} });
    h.ok(JSON.stringify(rEv.x.EV) === JSON.stringify(store.rounds[0]),
      'gated: exported rounds bank matches the generated bank');
    const th = store.thread;
    const tlive = h.boot('thread', ['PZ'], { now: T0, store: {} });
    const tp = th.picks[0];
    h.ok(tlive.x.PZ.s.id === tp.s && tlive.x.PZ.e.id === tp.e &&
      JSON.stringify(tlive.x.PZ.m.map(x => x.id)) === JSON.stringify(tp.m) &&
      JSON.stringify(tlive.x.PZ.d.map(x => x.id)) === JSON.stringify(tp.d),
      'gated: exported thread picks[0] match the offline day-0 chain');
  }
}

module.exports = { name: 'server-gated', run };
