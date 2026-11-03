/* well-actually - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'puzzle', 'pick', 'submitBonus', 'score', 'shareText'];
    const store = {};
    let r = h.boot('well-actually', EXP, { now: T0, store });
    h.eq(r.x.puzzle.l, 1, 'well-actually: day 0 lie is statement 1');
    r.x.pick(1);
    h.eq(r.x.S.status, 'found', 'well-actually: lie found');
    r.env.els.binput.value = 'Leonardo';
    r.x.submitBonus();
    h.eq(r.x.S.status, 'won', 'well-actually: won');
    h.eq(r.x.score(), 4, 'well-actually: 4 pts (3 + bonus)');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'well-actually: the win posts the won status');
    h.eq(h.lastPost(r.env).body.answer.picks.join(), '1', 'well-actually: the evidence carries the picks');
    h.eq(h.lastPost(r.env).body.answer.typed, 'Leonardo', 'well-actually: the evidence carries the typed correction');
    h.ok(!('value' in h.lastPost(r.env).body), 'well-actually: the client never names its own score');
    /* Regression: a reload used to lose the curve because syncBoard only
       fired from finish(), which does not run again for a finished day.
       Now the reload reads the curve back with a GET instead of posting,
       so the count for the day never moves twice. */
    r = h.boot('well-actually', EXP, { now: T0, store });
    await h.flush();
    h.ok(r.env.fetchLog.length === 0,
      'well-actually: a reload re-tallies nothing (regression)');
    h.ok(String(r.env.els.curve.innerHTML).indexOf('cyou') >= 0,
      'well-actually: the reload still renders the curve');
    r = h.boot('well-actually', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'well-actually: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'well-actually: streak preserved');

    /* --- dealt: the live day ships the statement without the lie, so
       every pick and the correction travel to the session --- */
    const waLive = h.boot('well-actually', EXP, { now: T0, store: {} });
    const waFull = waLive.x.puzzle;
    h.eq(waFull.l, 1, 'well-actually dealt: the banked day still carries its lie');
    const waServed = { game: 'well-actually', day: 0, today: 0,
                       puzzle: { t: waFull.t, s: waFull.s } };
    const waPicks = [];
    const waDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'wa1', today: 0, puzzle: waServed.puzzle } };
      if (body.move.pick !== undefined){
        waPicks.push(body.move.pick);
        if (body.move.pick === waFull.l) return { status: 200, body: { verdict: 'found' } };
        if (waPicks.length >= 3)
          return { status: 200, body: { verdict: 'lost',
            reveal: { l: waFull.l, c: waFull.c, w: waFull.w } } };
        return { status: 200, body: { verdict: 'miss', left: 3 - waPicks.length } };
      }
      const waTyped = String(body.move.correction || '').toLowerCase().trim();
      const waHit = waFull.a.some(x => x.toLowerCase() === waTyped);
      return { status: 200, body: { verdict: 'won', bonus: waHit ? 'correct' : 'wrong',
        reveal: { c: waFull.c, w: waFull.w } } };
    };
    const waDst = {};
    const waD = h.boot('well-actually', EXP,
      { now: T0, store: waDst, servePuzzle: waServed, stubBanks: true, serveDealt: waDealer });
    await h.flush();
    h.ok(String(waD.env.els.statement.innerHTML).indexOf(waFull.s[0]) >= 0,
      'well-actually dealt: the served statement rendered');
    h.ok(!('l' in waServed.puzzle), 'well-actually dealt: the served day never ships the lie');
    waD.x.pick(0);
    await h.flush();
    h.eq(waD.x.S.status, 'playing', 'well-actually dealt: a wrong pick misses without ending the round');
    h.eq(waD.x.S.nonce, 'wa1', 'well-actually dealt: the session is held');
    waD.x.pick(1);
    await h.flush();
    h.eq(waD.x.S.status, 'found', 'well-actually dealt: the lie found on the session');
    h.ok(waD.env.els.bonus.classList.contains('show'), 'well-actually dealt: the bonus round opens');
    waD.env.els.binput.value = 'Leonardo';
    waD.x.submitBonus();
    await h.flush();
    h.eq(waD.x.S.status, 'won', 'well-actually dealt: won on the session');
    h.eq(waD.x.S.bonus, 'correct', 'well-actually dealt: the session graded the correction');
    h.eq(waD.x.S.reveal.c, waFull.c, 'well-actually dealt: the reveal rode the spent attempt');
    const waPost = h.lastPost(waD.env);
    h.eq(waPost.body.nonce, 'wa1', 'well-actually dealt: the evidence names the session');
    h.eq(waPost.body.status, 'won', 'well-actually dealt: the evidence posts the session verdict');
    h.eq(waPost.body.answer.picks.join(), '0,1', 'well-actually dealt: the evidence carries the session picks');
    h.eq(waPost.body.answer.typed, 'Leonardo', 'well-actually dealt: the evidence carries the typed correction');
    h.eq(waD.env.fetchLog.filter(p => /\/deal$/.test(p.url)).length, 1,
      'well-actually dealt: exactly one deal for the day');
    /* a reload keeps the won day and retells the correction that never shipped */
    const waR = h.boot('well-actually', EXP,
      { now: T0, store: waDst, servePuzzle: waServed, stubBanks: true });
    await h.flush();
    h.eq(waR.x.S.status, 'won', 'well-actually dealt: a reload keeps the won day');
    h.ok(String(waR.env.els.why.innerHTML).indexOf(waFull.c) >= 0,
      'well-actually dealt: the reload retells the correction it never shipped');
    /* an archive replay keeps the local path: the bank still carries the lie */
    const waRe = h.boot('well-actually', EXP, { now: T1, store: {}, search: '?d=0' });
    h.eq(waRe.x.puzzle.l, 1, 'well-actually dealt: the replayed day still carries its lie');
    waRe.x.pick(1);
    h.eq(waRe.x.S.status, 'found', 'well-actually dealt: the replay plays the local path');
    waRe.env.els.binput.value = 'Leonardo';
    waRe.x.submitBonus();
    h.eq(waRe.x.S.status, 'won', 'well-actually dealt: the replay wins locally');
    await h.flush();
    h.eq(waRe.env.fetchLog.length, 0, 'well-actually dealt: a replay posts nothing');
}

module.exports = { name: 'well-actually', run };
