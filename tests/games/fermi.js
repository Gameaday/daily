/* fermi - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'parseNum', 'scoreFor', 'friendly', 'shareText', 'Q'];
    const store = {};
    let r = h.boot('fermi', EXP, { now: T0, store });
    h.eq(r.x.parseNum('2.5 billion'), 2.5e9, 'fermi: parses "2.5 billion"');
    h.eq(r.x.parseNum('3e8'), 3e8, 'fermi: parses 3e8');
    h.eq(r.x.parseNum('1,000,000'), 1e6, 'fermi: parses commas');
    h.eq(r.x.parseNum('2tn'), 2e12, 'fermi: parses tn suffix');
    h.eq(r.x.scoreFor(2.5e9, 2.5e9), 3, 'fermi: exact = 3 points');
    h.eq(r.x.friendly(10100), '10 thousand', 'fermi: friendly(10100)');
    h.eq(r.x.friendly(1.2e16), '1.2 \u00d7 10^16', 'fermi: friendly(1.2e16) exponent form');
    h.eq(r.x.friendly(2000), '2 thousand', 'fermi: friendly(2000)');
    h.ok(r.x.Q.a > 0, 'fermi: day 0 answer set');
    r.env.els.guess.value = String(r.x.Q.a);
    r.env.els.btnGuess.click();
    h.ok(r.x.S.scored, 'fermi: scored');
    h.eq(r.x.S.score, 3, 'fermi: exact guess scores 3');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'fermi: the estimate posts the won status');
    h.eq(h.lastPost(r.env).body.answer, r.x.Q.a, 'fermi: the evidence carries the estimate');
    h.ok(!('value' in h.lastPost(r.env).body), 'fermi: the client never names its own score');
    r = h.boot('fermi', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'fermi: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'fermi: streak preserved');

    /* --- the live day cuts over to dealt play: the question arrives
           without its cited value and the session scores the one guess --- */
    const live = h.boot('fermi', ['Q'], { now: T0, store: {} });
    const full = live.x.Q;
    const served = { t: full.t, q: full.q };
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'f1', today: 0, puzzle: served } };
      const ratio = Math.max(body.move.v / full.a, full.a / body.move.v);
      const score = ratio <= 3 ? 3 : ratio <= 10 ? 2 : ratio <= 100 ? 1 : 0;
      return { status: 200, body: { verdict: 'won', score,
        reveal: { a: full.a, w: full.w } } };
    };
    const fstore = {};
    const rd = h.boot('fermi', ['S', 'friendly'], { now: T0, store: fstore,
      servePuzzle: { game: 'fermi', day: 0, puzzle: served, today: 0 },
      stubBanks: true, serveDealt });
    await h.flush();
    h.ok(rd.env.els.qtext.textContent.indexOf(served.q) >= 0,
      'fermi: the dealt question renders');
    rd.env.els.guess.value = String(full.a * 2);
    rd.env.els.btnGuess.click();
    await h.flush();
    h.ok(rd.x.S.scored, 'fermi: the session scores the spent estimate');
    h.eq(rd.x.S.score, 3, 'fermi: a within-3x estimate scores 3 from the session');
    h.eq(rd.x.S.nonce, 'f1', 'fermi: the dealt session is held');
    h.ok(rd.env.els.vact.textContent.indexOf(rd.x.friendly(full.a)) >= 0,
      'fermi: the cited value retells from the session reveal');
    h.eq(h.lastPost(rd.env).body.nonce, 'f1', 'fermi: the evidence names the session');
    h.eq(h.lastPost(rd.env).body.answer, full.a * 2, 'fermi: the evidence carries the estimate');
    const again = h.boot('fermi', ['S', 'friendly'], { now: T0, store: fstore,
      servePuzzle: { game: 'fermi', day: 0, puzzle: served, today: 0 },
      stubBanks: true });
    await h.flush();
    h.ok(again.x.S.scored, 'fermi: a reload keeps the spent estimate');
    h.ok(again.env.els.vact.textContent.indexOf(again.x.friendly(full.a)) >= 0,
      'fermi: the reload retells the cited value though it never shipped');

    /* --- a replayed day is long over: the archive path grades locally and
           posts nothing --- */
    const rr = h.boot('fermi', ['S', 'Q'], { now: T1, store: {}, search: '?d=0' });
    await h.flush();
    h.ok(rr.x.Q.a > 0, 'fermi: the replayed question carries its key from the bank');
    rr.env.els.guess.value = String(rr.x.Q.a);
    rr.env.els.btnGuess.click();
    h.ok(rr.x.S.scored, 'fermi: a replayed day scores locally');
    h.eq(rr.x.S.score, 3, 'fermi: the replayed guess reads 3/3');
    await h.flush();
    h.eq(rr.env.fetchLog.length, 0, 'fermi: a replayed day posts nothing');
}

module.exports = { name: 'fermi', run };
