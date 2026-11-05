/* canard - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'puzzle', 'pick', 'submitBonus', 'score', 'shareText'];
    const store = {};
    let r = h.boot('canard', EXP, { now: T0, store });
    h.eq(r.x.puzzle.l, 1, 'canard: day 0 lie is statement 1');
    r.x.pick(1);
    h.eq(r.x.S.status, 'found', 'canard: lie found');
    r.env.els.binput.value = 'Leonardo';
    r.x.submitBonus();
    h.eq(r.x.S.status, 'won', 'canard: won');
    h.eq(r.x.score(), 4, 'canard: 4 pts (3 + bonus)');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'canard: the win posts the won status');
    h.eq(h.lastPost(r.env).body.answer.picks.join(), '1', 'canard: the evidence carries the picks');
    h.eq(h.lastPost(r.env).body.answer.typed, 'Leonardo', 'canard: the evidence carries the typed correction');
    h.ok(!('value' in h.lastPost(r.env).body), 'canard: the client never names its own score');
    /* Regression: a reload used to lose the curve because syncBoard only
       fired from finish(), which does not run again for a finished day.
       Now the reload reads the curve back with a GET instead of posting,
       so the count for the day never moves twice. */
    r = h.boot('canard', EXP, { now: T0, store });
    await h.flush();
    h.ok(r.env.fetchLog.length === 0,
      'canard: a reload re-tallies nothing (regression)');
    h.ok(String(r.env.els.curve.innerHTML).indexOf('cyou') >= 0,
      'canard: the reload still renders the curve');
    r = h.boot('canard', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'canard: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'canard: streak preserved');

    /* --- dealt: the live day ships the statement without the lie, so
       every pick and the correction travel to the session --- */
    const waLive = h.boot('canard', EXP, { now: T0, store: {} });
    const waFull = waLive.x.puzzle;
    h.eq(waFull.l, 1, 'canard dealt: the banked day still carries its lie');
    const waServed = { game: 'canard', day: 0, today: 0,
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
    const waD = h.boot('canard', EXP,
      { now: T0, store: waDst, servePuzzle: waServed, stubBanks: true, serveDealt: waDealer });
    await h.flush();
    h.ok(String(waD.env.els.statement.innerHTML).indexOf(waFull.s[0]) >= 0,
      'canard dealt: the served statement rendered');
    h.ok(!('l' in waServed.puzzle), 'canard dealt: the served day never ships the lie');
    waD.x.pick(0);
    await h.flush();
    h.eq(waD.x.S.status, 'playing', 'canard dealt: a wrong pick misses without ending the round');
    h.eq(waD.x.S.nonce, 'wa1', 'canard dealt: the session is held');
    waD.x.pick(1);
    await h.flush();
    h.eq(waD.x.S.status, 'found', 'canard dealt: the lie found on the session');
    h.ok(waD.env.els.bonus.classList.contains('show'), 'canard dealt: the bonus round opens');
    waD.env.els.binput.value = 'Leonardo';
    waD.x.submitBonus();
    await h.flush();
    h.eq(waD.x.S.status, 'won', 'canard dealt: won on the session');
    h.eq(waD.x.S.bonus, 'correct', 'canard dealt: the session graded the correction');
    h.eq(waD.x.S.reveal.c, waFull.c, 'canard dealt: the reveal rode the spent attempt');
    const waPost = h.lastPost(waD.env);
    h.eq(waPost.body.nonce, 'wa1', 'canard dealt: the evidence names the session');
    h.eq(waPost.body.status, 'won', 'canard dealt: the evidence posts the session verdict');
    h.eq(waPost.body.answer.picks.join(), '0,1', 'canard dealt: the evidence carries the session picks');
    h.eq(waPost.body.answer.typed, 'Leonardo', 'canard dealt: the evidence carries the typed correction');
    h.eq(waD.env.fetchLog.filter(p => /\/deal$/.test(p.url)).length, 1,
      'canard dealt: exactly one deal for the day');
    /* a reload keeps the won day and retells the correction that never shipped */
    const waR = h.boot('canard', EXP,
      { now: T0, store: waDst, servePuzzle: waServed, stubBanks: true });
    await h.flush();
    h.eq(waR.x.S.status, 'won', 'canard dealt: a reload keeps the won day');
    h.ok(String(waR.env.els.why.innerHTML).indexOf(waFull.c) >= 0,
      'canard dealt: the reload retells the correction it never shipped');
    /* --- an expired session no longer spends the argument: a picks-phase
       expiry reseats the graded picks and the hunt continues --- */
    let waXDeals = 0, waXPicks = [];
    const waXDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        waXDeals++;
        waXPicks = [];
        return { status: 200, body: { nonce: 'wx' + waXDeals, today: 0, puzzle: waServed.puzzle } };
      }
      if (body.move.pick !== undefined){
        waXPicks.push(body.move.pick);
        if (waXDeals === 1 && waXPicks.length >= 2)
          return { status: 410, body: {} };
        if (body.move.pick === waFull.l) return { status: 200, body: { verdict: 'found' } };
        if (waXPicks.length >= 3)
          return { status: 200, body: { verdict: 'lost',
            reveal: { l: waFull.l, c: waFull.c, w: waFull.w } } };
        return { status: 200, body: { verdict: 'miss', left: 3 - waXPicks.length } };
      }
      const waXTyped = String(body.move.correction || '').toLowerCase().trim();
      const waXHit = waFull.a.some(x => x.toLowerCase() === waXTyped);
      return { status: 200, body: { verdict: 'won', bonus: waXHit ? 'correct' : 'wrong',
        reveal: { c: waFull.c, w: waFull.w } } };
    };
    const waXD = h.boot('canard', EXP,
      { now: T0, store: {}, servePuzzle: waServed, stubBanks: true, serveDealt: waXDealer });
    await h.flush();
    waXD.x.pick(0);
    await h.flush();
    h.eq(waXD.x.S.picked.length, 1, 'canard reseat: one pick graded');
    waXD.x.pick(1);                     /* the lie, but the session dies on it */
    await h.flush(); await h.flush(); await h.flush();
                    /* expiry -> the reseat replays the graded pick */
    h.eq(waXD.x.S.picked.join(), '0',
      'canard reseat: the graded pick survives the expiry');
    h.eq(waXD.x.S.nonce, 'wx2', 'canard reseat: the hunt reseats onto a fresh session');
    h.eq(waXDeals, 2, 'canard reseat: exactly one redeal');
    waXD.x.pick(1);                     /* the lie again, on the fresh session */
    await h.flush(); await h.flush();
    h.eq(waXD.x.S.status, 'found', 'canard reseat: the lie found on the reseeded session');
    waXD.env.els.binput.value = 'Leonardo';
    waXD.x.submitBonus();
    await h.flush();
    h.eq(waXD.x.S.status, 'won', 'canard reseat: the day wins on the reseeded session');
    h.eq(h.lastPost(waXD.env).body.nonce, 'wx2',
      'canard reseat: the evidence names the reseeded session');

    /* --- bonus-phase expiry: the found lie and its correction survive a
       dead session too --- */
    let waYDeals = 0, waYPicks = [];
    const waYDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        waYDeals++;
        waYPicks = [];
        return { status: 200, body: { nonce: 'wy' + waYDeals, today: 0, puzzle: waServed.puzzle } };
      }
      if (body.move.pick !== undefined){
        waYPicks.push(body.move.pick);
        if (body.move.pick === waFull.l) return { status: 200, body: { verdict: 'found' } };
        return { status: 200, body: { verdict: 'miss', left: 3 - waYPicks.length } };
      }
      if (waYDeals === 1)
        return { status: 410, body: {} };  /* the session dies with the bonus open */
      const waYTyped = String(body.move.correction || '').toLowerCase().trim();
      const waYHit = waFull.a.some(x => x.toLowerCase() === waYTyped);
      return { status: 200, body: { verdict: 'won', bonus: waYHit ? 'correct' : 'wrong',
        reveal: { c: waFull.c, w: waFull.w } } };
    };
    const waYB = h.boot('canard', EXP,
      { now: T0, store: {}, servePuzzle: waServed, stubBanks: true, serveDealt: waYDealer });
    await h.flush();
    waYB.x.pick(1);
    await h.flush();
    h.eq(waYB.x.S.status, 'found', 'canard bonus reseat: the lie found');
    waYB.env.els.binput.value = 'Leonardo';
    waYB.x.submitBonus();              /* the correction trips the dead session */
    await h.flush(); await h.flush(); await h.flush();
                   /* expiry -> the reseat replays the found pick */
    h.eq(waYB.x.S.status, 'found',
      'canard bonus reseat: the found lie survives the expiry');
    h.eq(waYB.x.S.nonce, 'wy2',
      'canard bonus reseat: the correction reseats onto a fresh session');
    h.eq(waYDeals, 2, 'canard bonus reseat: exactly one redeal');
    waYB.x.submitBonus();              /* the correction again, on the fresh session */
    await h.flush(); await h.flush();
    h.eq(waYB.x.S.status, 'won', 'canard bonus reseat: the day wins on the reseeded session');
    h.eq(h.lastPost(waYB.env).body.nonce, 'wy2',
      'canard bonus reseat: the evidence names the reseeded session');

    /* an archive replay keeps the local path: the bank still carries the lie */
    const waRe = h.boot('canard', EXP, { now: T1, store: {}, search: '?d=0' });
    h.eq(waRe.x.puzzle.l, 1, 'canard dealt: the replayed day still carries its lie');
    waRe.x.pick(1);
    h.eq(waRe.x.S.status, 'found', 'canard dealt: the replay plays the local path');
    waRe.env.els.binput.value = 'Leonardo';
    waRe.x.submitBonus();
    h.eq(waRe.x.S.status, 'won', 'canard dealt: the replay wins locally');
    await h.flush();
    h.eq(waRe.env.fetchLog.length, 0, 'canard dealt: a replay posts nothing');
}

module.exports = { name: 'canard', run };
