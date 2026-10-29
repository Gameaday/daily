/* Server-gated delivery: with the puzzle banks stripped from the page
   (the online bundle), each game must still boot and play on the puzzle
   served by the scores service. Split from the old monolithic run.js. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h, ctx){
  const { readGame, readStore } = ctx;
    const GATED = {
      bogus: 'PUZZLES', 'well-actually': 'PUZZLES', rounds: 'EVENTS', fermi: 'QS',
      cipher: 'QUOTES', museum: 'MUSEUM', lightbox: 'DESIGNS', sift: 'BOARDS',
      timeline: 'EVENTS'
    };
    const strip = html => {
      let out = html;
      for (const v of Object.values(GATED))
        out = out.replace(new RegExp('const ' + v + ' = \\[([\\s\\S]*?)\\];'), 'const ' + v + ' = undefined;');
      return out;
    };
    const serve = (game, puzzle) => ({ game, day: 0, puzzle, today: 0 });

    /* rounds: slide to the served year */
    {
      const live = h.boot('rounds', ['S', 'EV'], { now: T0, store: {} });
      const served = serve('rounds', live.x.EV);
      const stripped = strip(readGame('rounds'));
      h.ok(!new RegExp('const EVENTS = \\[').test(stripped), 'gated: rounds bank stripped from the online page');
      const r = h.boot('rounds', ['S'], { now: T0, store: {}, servePuzzle: served, html: stripped });
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
      const stripped = strip(readGame('fermi'));
      h.ok(!new RegExp('const QS = \\[').test(stripped), 'gated: fermi bank stripped');
      const r = h.boot('fermi', ['S'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      r.env.els.guess.value = String(served.puzzle.a);
      r.env.els.btnGuess.click();
      h.ok(r.x.S.scored, 'gated: fermi scored on the served answer');
    }
    /* cipher: the served quote decodes clean */
    {
      const live = h.boot('cipher', ['Q'], { now: T0, store: {} });
      const served = serve('cipher', live.x.Q);
      const stripped = strip(readGame('cipher'));
      h.ok(!new RegExp('const QUOTES = \\[').test(stripped), 'gated: cipher bank stripped');
      const r = h.boot('cipher', ['S', 'SUB', 'assign'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      h.ok(r.env.els.author.textContent.indexOf(served.puzzle.a) >= 0, 'gated: cipher served author rendered');
      for (const c of Object.keys(r.x.SUB.dec)){
        if (r.x.S.status !== 'playing') break;
        r.x.S.sel = c;
        r.x.assign(r.x.SUB.dec[c]);
      }
      h.eq(r.x.S.status, 'won', 'gated: cipher auto-won on the served quote');
    }
    /* museum: the served exhibit matches its alias */
    {
      const live = h.boot('museum', ['EXHIBIT'], { now: T0, store: {} });
      const served = serve('museum', live.x.EXHIBIT);
      const stripped = strip(readGame('museum'));
      h.ok(!new RegExp('const MUSEUM = \\[').test(stripped), 'gated: museum bank stripped');
      const r = h.boot('museum', ['S', 'matches', 'submitGuess'], { now: T0, store: {}, servePuzzle: served, html: stripped });
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
      const stripped = strip(readGame('lightbox'));
      h.ok(!new RegExp('const DESIGNS = \\[').test(stripped), 'gated: lightbox bank stripped');
      const r = h.boot('lightbox', ['S'], { now: T0, store: {}, servePuzzle: served, html: stripped });
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
      const stripped = strip(readGame('sift'));
      h.ok(!new RegExp('const BOARDS = \\[').test(stripped), 'gated: sift bank stripped');
      const r = h.boot('sift', ['S', 'TILES', 'sel'], { now: T0, store: {}, servePuzzle: served, html: stripped });
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
      const stripped = strip(readGame('timeline'));
      h.ok(!new RegExp('const EVENTS = \\[').test(stripped), 'gated: timeline bank stripped');
      const r = h.boot('timeline', ['PICK'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      const needle = served.puzzle.events[0].q;
      const found = Object.keys(r.env.els).some(k =>
        String(r.env.els[k].innerHTML || '').indexOf(needle) >= 0 ||
        String(r.env.els[k].textContent || '').indexOf(needle) >= 0);
      h.ok(found, 'gated: timeline served events rendered');
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
        'gated: exported rounds bank matches the inline bank');
    }
}

module.exports = { name: 'server-gated', run };
