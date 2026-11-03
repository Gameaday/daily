/* lightbox - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'SOL', 'shareText'];
    const store = {};
    let r = h.boot('lightbox', EXP, { now: T0, store });
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) r.x.S.marks[i][j] = r.x.SOL[i][j] ? 1 : 0;
    r.x.S.startAt = 1; /* a first tap happened long ago */
    r.env.els.btnDevelop.click();
    h.eq(r.x.S.status, 'won', 'lightbox: won clean');
    h.ok(r.env.els.timenote.textContent.indexOf('your time') === 0, 'lightbox: the result carries the time');
    h.eq(r.x.S.mistakes, 0, 'lightbox: 0 mistakes');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'lightbox: the win posts the won status');
    h.eq(h.lastPost(r.env).body.meta.mistakes, 0, 'lightbox: the evidence carries a clean board');
    h.ok(!('value' in h.lastPost(r.env).body), 'lightbox: the client never names its own score');
    h.ok(r.x.shareText().indexOf('\u2B50') >= 0, 'lightbox: the flawless star rides the share');
    const s2 = {};
    r = h.boot('lightbox', EXP, { now: T0, store: s2 });
    for (let i = 0; i < 4; i++){
      r.x.S.marks[0][0] = r.x.SOL[0][0] ? 0 : 1; /* force a contradiction */
      r.env.els.btnDevelop.click();
    }
    h.eq(r.x.S.status, 'lost', 'lightbox: lost after 4 wrong developments');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'lost', 'lightbox: the loss posts lost, the server owns the 0');
    r = h.boot('lightbox', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'lightbox: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'lightbox: streak preserved');

    /* --- dealt: the live day ships the clues without the picture, so
       the development travels to the session and the spent film hands
       over the design --- */
    const lbLive = h.boot('lightbox', ['DESIGN'], { now: T0, store: {} });
    const lbFull = lbLive.x.DESIGN;
    const lbSol = lbFull.g.map(row => [...row].map(ch => ch === '#' ? 1 : 0));
    const lbRuns = line => { const out = []; let c = 0;
      for (const v of line){ if (v) c++; else if (c){ out.push(c); c = 0; } }
      if (c) out.push(c); return out.length ? out : [0]; };
    const lbServed = { game: 'lightbox', day: 0, today: 0,
      puzzle: { rc: lbSol.map(lbRuns),
        cc: [0, 1, 2, 3, 4, 5, 6].map(c => lbRuns(lbSol.map(r => r[c]))) } };
    let lbMisses = 0;
    const lbDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'lb1', today: 0, puzzle: lbServed.puzzle } };
      const rows = body.move.grid.map(rw => [...rw].map(ch => ch === '1' ? 1 : 0));
      if (JSON.stringify(rows) === JSON.stringify(lbSol))
        return { status: 200, body: { verdict: 'won',
          reveal: { n: lbFull.n, g: lbFull.g } } };
      lbMisses++;
      if (lbMisses >= 4)
        return { status: 200, body: { verdict: 'lost',
          reveal: { n: lbFull.n, g: lbFull.g } } };
      const bad = [], need = [];
      for (let r2 = 0; r2 < 7; r2++) for (let c2 = 0; c2 < 7; c2++){
        if (rows[r2][c2] === 1 && !lbSol[r2][c2]) bad.push([r2, c2]);
        if (rows[r2][c2] !== 1 && lbSol[r2][c2]) need.push([r2, c2]);
      }
      return { status: 200, body: { verdict: 'miss', bad, need, mistakes: lbMisses } };
    };
    const lbDst = {};
    const lbD = h.boot('lightbox', ['S', 'DESIGN', 'shareText'],
      { now: T0, store: lbDst, servePuzzle: lbServed, stubBanks: true, serveDealt: lbDealer });
    await h.flush();
    h.ok(!('g' in lbServed.puzzle) && !('n' in lbServed.puzzle),
      'lightbox dealt: the served day never ships its picture');
    h.ok((String(lbD.env.els.grid.innerHTML).match(/class="cell"/g) || []).length === 49,
      'lightbox dealt: the served clues rendered an empty board');
    /* one bad exposure: the session counts it and names the contradictions */
    lbD.x.S.marks[0][0] = lbSol[0][0] ? 0 : 1;
    lbD.env.els.btnDevelop.click();
    await h.flush();
    h.eq(lbD.x.S.mistakes, 1, 'lightbox dealt: the session counted the bad exposure');
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) lbD.x.S.marks[i][j] = lbSol[i][j] ? 1 : 0;
    lbD.env.els.btnDevelop.click();
    await h.flush();
    h.eq(lbD.x.S.status, 'won', 'lightbox dealt: developed on the session');
    h.eq(lbD.x.S.nonce, 'lb1', 'lightbox dealt: the session is held');
    const lbPost = h.lastPost(lbD.env);
    h.eq(lbPost.body.status, 'won', 'lightbox dealt: the win posts the won status');
    h.eq(lbPost.body.nonce, 'lb1', 'lightbox dealt: the evidence names the session');
    h.eq(lbPost.body.meta.mistakes, 1, 'lightbox dealt: the evidence carries the session meter');
    h.ok(String(lbD.env.els.verdict.textContent).indexOf(lbFull.n) >= 0,
      'lightbox dealt: the verdict names the picture it never shipped');
    /* a reload keeps the won day and retells the picture it never shipped */
    const lbR = h.boot('lightbox', ['S', 'DESIGN'],
      { now: T0, store: lbDst, servePuzzle: lbServed, stubBanks: true });
    await h.flush();
    h.eq(lbR.x.S.status, 'won', 'lightbox dealt: a reload keeps the won day');
    h.ok((String(lbR.env.els.solvedpix.innerHTML).match(/px f/g) || []).length > 0,
      'lightbox dealt: the reload retells the picture that never shipped');
    /* the fourth bad exposure fogs the film: the reveal rides the spent round */
    let lbMisses2 = 0;
    const lbDealer2 = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'lb2', today: 0, puzzle: lbServed.puzzle } };
      lbMisses2++;
      if (lbMisses2 >= 4)
        return { status: 200, body: { verdict: 'lost',
          reveal: { n: lbFull.n, g: lbFull.g } } };
      return { status: 200, body: { verdict: 'miss', bad: [[0, 0]], need: [],
        mistakes: lbMisses2 } };
    };
    const lbLst = {};
    const lbL = h.boot('lightbox', ['S'],
      { now: T0, store: lbLst, servePuzzle: lbServed, stubBanks: true, serveDealt: lbDealer2 });
    await h.flush();
    for (let k = 0; k < 4; k++){
      lbL.x.S.marks[0][0] = lbSol[0][0] ? 0 : 1;
      lbL.env.els.btnDevelop.click();
      await h.flush();
    }
    h.eq(lbL.x.S.status, 'lost', 'lightbox dealt: the fourth bad exposure fogs the film');
    h.ok(String(lbL.env.els.verdict.textContent).indexOf(lbFull.n) >= 0,
      'lightbox dealt: the fog names the picture it never shipped');
    /* a reload of the fogged film replays the reveal it never shipped */
    const lbLR = h.boot('lightbox', ['S'],
      { now: T0, store: lbLst, servePuzzle: lbServed, stubBanks: true });
    await h.flush();
    h.eq(lbLR.x.S.status, 'lost', 'lightbox dealt: a reload keeps the fogged day');
    h.ok((String(lbLR.env.els.solvedpix.innerHTML).match(/px f/g) || []).length > 0,
      'lightbox dealt: the reload replays the picture that never shipped');
    /* an archive replay keeps the local path: the banked day still
       carries its picture and nothing posts */
    const lbRe = h.boot('lightbox', EXP, { now: T1, store: {}, search: '?d=0' });
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) lbRe.x.S.marks[i][j] = lbRe.x.SOL[i][j] ? 1 : 0;
    lbRe.env.els.btnDevelop.click();
    h.eq(lbRe.x.S.status, 'won', 'lightbox dealt: the replay wins locally on the banked day');
    await h.flush();
    h.eq(lbRe.env.fetchLog.length, 0, 'lightbox dealt: a replay posts nothing');
}

module.exports = { name: 'lightbox', run };
