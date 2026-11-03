/* Server-gated delivery: with the generated bank files stubbed (the
   online bundle ships assets/banks/<game>.js as `const NAME = undefined;`),
   each game must still boot and play on the puzzle served by the scores
   service. Split from the old monolithic run.js. */
'use strict';
const { T0 } = require('./_lib');

async function run(h, ctx){
  const { readStore } = ctx;
  const serve = (game, puzzle) => ({ game, day: 0, puzzle, today: 0 });

  /* rounds: the live day is dealt - the served puzzle carries no key, so
     the round runs on a session and the server counts and grades */
  {
    const live = h.boot('rounds', ['S', 'EV'], { now: T0, store: {} });
    const full = live.x.EV;
    const served = serve('rounds', { t: full.t, q: full.q });
    const seen = [];
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'g1', today: 0, puzzle: served.puzzle } };
      seen.push(body);
      if (body.y === full.y)
        return { status: 200, body: { verdict: 'won', guesses: seen.length,
          reveal: { y: full.y, w: full.w } } };
      return { status: 200, body: { verdict: 'miss', guesses: seen.length,
        heat: 'scalding', sq: '\uD83D\uDFE9', hint: 'go later \u00b7 right decade' } };
    };
    const r = h.boot('rounds', ['S', 'EV', 'EVENTS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true, serveDealt });
    h.ok(r.x.EVENTS === undefined, 'gated: rounds online boot has no bank');
    await h.flush();
    h.ok(r.env.els.qtext.textContent.indexOf(served.puzzle.q) >= 0, 'gated: rounds served question rendered');
    r.env.els.slider.value = String(full.y);
    r.env.els.btnLock.click();
    await h.flush();
    h.eq(r.x.S.status, 'won', 'gated: rounds won on the dealt session');
    h.eq(r.x.S.nonce, 'g1', 'gated: the dealt session is held');
  }
  /* fermi: the served question is dealt - the cited value never ships and
     the session scores the one estimate */
  {
    const live = h.boot('fermi', ['Q'], { now: T0, store: {} });
    const full = live.x.Q;
    const served = serve('fermi', { t: full.t, q: full.q });
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'gf1', today: 0, puzzle: served.puzzle } };
      const ratio = Math.max(body.v / full.a, full.a / body.v);
      const score = ratio <= 3 ? 3 : ratio <= 10 ? 2 : ratio <= 100 ? 1 : 0;
      return { status: 200, body: { verdict: 'won', score,
        reveal: { a: full.a, w: full.w } } };
    };
    const r = h.boot('fermi', ['S', 'QS'], { now: T0, store: {}, servePuzzle: served, stubBanks: true, serveDealt });
    h.ok(r.x.QS === undefined, 'gated: fermi online boot has no bank');
    await h.flush();
    r.env.els.guess.value = String(full.a);
    r.env.els.btnGuess.click();
    await h.flush();
    h.ok(r.x.S.scored, 'gated: fermi scored on the dealt question');
    h.eq(r.x.S.nonce, 'gf1', 'gated: the fermi session is held');
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
  /* museum: the served exhibit is dealt - the name never ships and the
     session meters the clues and grades the one guess */
  {
    const live = h.boot('museum', ['EXHIBIT'], { now: T0, store: {} });
    const full = live.x.EXHIBIT;
    const served = serve('museum', { c: full.c });
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'gm1', today: 0, puzzle: served.puzzle } };
      const mm = s => String(s || '').toLowerCase().replace(/^the /, '').trim();
      if ([full.a].concat(full.al).some(x => mm(body.name) === mm(x)))
        return { status: 200, body: { verdict: 'won',
          reveal: { a: full.a, w: full.w } } };
      return { status: 200, body: { verdict: 'miss', clueIdx: 1 } };
    };
    const r = h.boot('museum', ['S', 'submitGuess', 'MUSEUM'], { now: T0, store: {}, servePuzzle: served, stubBanks: true, serveDealt });
    h.ok(r.x.MUSEUM === undefined, 'gated: museum online boot has no bank');
    await h.flush();
    h.ok(String(r.env.els.plaque.innerHTML).indexOf(full.c[0]) >= 0,
      'gated: museum served clues rendered');
    h.ok(!('a' in served.puzzle) && !('al' in served.puzzle),
      'gated: the museum day never ships its name');
    r.env.els.guess.value = full.al[0];
    r.x.submitGuess();
    await h.flush();
    h.eq(r.x.S.status, 'won', 'gated: museum won on the dealt exhibit');
    h.eq(r.x.S.nonce, 'gm1', 'gated: the museum session is held');
    h.ok(String(r.env.els.answer.textContent).indexOf(full.a) >= 0,
      'gated: the answer arrived only with the reveal');
  }
  /* well-actually: the served statement is dealt - the lie never ships
     and the session grades every pick and the one correction */
  {
    const live = h.boot('well-actually', ['puzzle'], { now: T0, store: {} });
    const full = live.x.puzzle;
    const served = serve('well-actually', { t: full.t, s: full.s });
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'gwa1', today: 0, puzzle: served.puzzle } };
      if (body.pick !== undefined){
        if (body.pick === full.l) return { status: 200, body: { verdict: 'found' } };
        return { status: 200, body: { verdict: 'miss', left: 2 } };
      }
      return { status: 200, body: { verdict: 'won', bonus: 'correct',
        reveal: { c: full.c, w: full.w } } };
    };
    const r = h.boot('well-actually', ['S', 'pick', 'submitBonus'],
      { now: T0, store: {}, servePuzzle: served, stubBanks: true, serveDealt });
    await h.flush();
    h.ok(String(r.env.els.statement.innerHTML).indexOf(full.s[1]) >= 0,
      'gated: well-actually served statement rendered');
    h.ok(!('l' in served.puzzle), 'gated: the well-actually day never ships its lie');
    r.x.pick(full.l);
    await h.flush();
    h.eq(r.x.S.status, 'found', 'gated: well-actually found on the dealt session');
    r.env.els.binput.value = full.a[0];
    r.x.submitBonus();
    await h.flush();
    h.eq(r.x.S.status, 'won', 'gated: well-actually won on the dealt statement');
    h.eq(r.x.S.nonce, 'gwa1', 'gated: the well-actually session is held');
  }
  /* bogus: the served passage is dealt - the lie never ships and the
     session grades every pick */
  {
    const live = h.boot('bogus', ['puzzle'], { now: T0, store: {} });
    const full = live.x.puzzle;
    const served = serve('bogus', { t: full.t, s: full.s });
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'gbg1', today: 0, puzzle: served.puzzle } };
      if (body.pick === full.l)
        return { status: 200, body: { verdict: 'won',
          reveal: { l: full.l, w: full.w } } };
      return { status: 200, body: { verdict: 'miss', left: 2 } };
    };
    const r = h.boot('bogus', ['S', 'puzzle', 'pick', 'PUZZLES'],
      { now: T0, store: {}, servePuzzle: served, stubBanks: true, serveDealt });
    h.ok(r.x.PUZZLES === undefined, 'gated: bogus online boot has no bank');
    await h.flush();
    h.ok(String(r.env.els.passage.innerHTML).indexOf(full.s[1]) >= 0,
      'gated: bogus served passage rendered');
    h.ok(!('l' in served.puzzle) && !('w' in served.puzzle),
      'gated: the bogus day never ships its lie');
    r.x.pick(full.l);
    await h.flush();
    h.eq(r.x.S.status, 'won', 'gated: bogus won on the dealt passage');
    h.eq(r.x.S.nonce, 'gbg1', 'gated: the bogus session is held');
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
  /* brunch: the served table is dealt - the impostor never ships and the
     session grades the pick */
  {
    const live = h.boot('brunch', ['S', 'EV'], { now: T0, store: {} });
    const full = live.x.EV;
    const served = serve('brunch', { t: full.t, q: full.q, y: full.y, opts: full.opts });
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'gb1', today: 0, puzzle: served.puzzle } };
      return { status: 200, body: { verdict: body.pick === full.a ? 'won' : 'lost',
        reveal: { a: full.a, w: full.w } } };
    };
    const r = h.boot('brunch', ['S', 'EV', 'BRUNCH'], { now: T0, store: {}, servePuzzle: served, stubBanks: true, serveDealt });
    h.ok(r.x.BRUNCH === undefined, 'gated: brunch online boot has no bank');
    await h.flush();
    r.env.els['opt' + full.a].click();
    await h.flush();
    h.eq(r.x.S.status, 'won', 'gated: brunch won on the dealt table');
    h.eq(r.x.S.nonce, 'gb1', 'gated: the brunch session is held');
  }
  /* superlative: the served session plays through */
  {
    const live = h.boot('superlative', ['S', 'EV'], { now: T0, store: {} });
    const served = serve('superlative', live.x.EV);
    const r = h.boot('superlative', ['S', 'EV', 'SUPERLATIVES'], { now: T0, store: {}, servePuzzle: served, stubBanks: true });
    h.ok(r.x.SUPERLATIVES === undefined, 'gated: superlative online boot has no bank');
    await h.flush();
    h.ok(Array.isArray(served.puzzle.m) && served.puzzle.m.length >= 4 &&
      Array.isArray(served.puzzle.q) && served.puzzle.q.length >= 4,
      'gated: the served session carries a cohort and its rounds');
    for (let i = 0; i < served.puzzle.q.length; i++){
      r.env.els['opt' + served.puzzle.q[i].a].click();
      if (i < served.puzzle.q.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'won', 'gated: superlative won on the served session');
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
    const bl = h.boot('brunch', ['EV'], { now: T0, store: {} });
    h.ok(JSON.stringify(bl.x.EV) === JSON.stringify(store.brunch[0]),
      'gated: exported brunch bank matches the generated bank');
    const sup = h.boot('superlative', ['EV'], { now: T0, store: {} });
    h.ok(JSON.stringify(sup.x.EV) === JSON.stringify(store.superlative[0]),
      'gated: exported superlative bank matches the generated bank');
  }
}

module.exports = { name: 'server-gated', run };
