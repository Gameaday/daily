/* bogus - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'puzzle', 'pick', 'shareText', 'baseScore'];
    const store = {};
    let r = h.boot('bogus', EXP, { now: T0, store });
    h.eq(r.x.puzzle.l, 5, 'bogus: day 0 lie is statement 5');
    r.x.pick(r.x.puzzle.l);
    h.eq(r.x.S.status, 'won', 'bogus: won');
    h.eq(r.x.baseScore(), 3, 'bogus: 3/3');
    h.ok(r.x.shareText().indexOf('3/3') >= 0, 'bogus: share 3/3');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'bogus: the win posts the won status');
    h.eq(h.lastPost(r.env).body.answer.join(), '5', 'bogus: the evidence carries the winning pick');
    h.ok(!('value' in h.lastPost(r.env).body), 'bogus: the client never names its own score');
    h.eq(r.x.S.stats.streak, 1, 'bogus: streak 1');
    r = h.boot('bogus', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'bogus: day rolled to 1');
    h.eq(r.x.S.stats.streak, 1, 'bogus: streak preserved after win');
    h.eq(r.x.S.status, 'playing', 'bogus: new day is playable');
    const s2 = {};
    r = h.boot('bogus', EXP, { now: T0, store: s2 });
    r.x.pick(0); r.x.pick(1); r.x.pick(2);
    h.eq(r.x.S.status, 'lost', 'bogus: lost after 3 wrong');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'lost', 'bogus: the loss posts lost, the server owns the 0');
    h.eq(r.x.S.stats.dist[0], 1, 'bogus: dist[0] ticked');

    /* --- dealt: the live day ships the passage without the lie, so every
       pick travels to the session and the reveal rides the spent round --- */
    const bgLive = h.boot('bogus', EXP, { now: T0, store: {} });
    const bgFull = bgLive.x.puzzle;
    h.eq(bgFull.l, 5, 'bogus dealt: the banked day still carries its lie');
    const bgServed = { game: 'bogus', day: 0, today: 0,
      puzzle: { t: bgFull.t, s: bgFull.s } };
    const bgDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'b1', today: 0, puzzle: bgServed.puzzle } };
      if (body.move.pick === bgFull.l)
        return { status: 200, body: { verdict: 'won',
          reveal: { l: bgFull.l, w: bgFull.w } } };
      return { status: 200, body: { verdict: 'miss', left: 2 } };
    };
    const bgDst = {};
    const bgD = h.boot('bogus', EXP,
      { now: T0, store: bgDst, servePuzzle: bgServed, stubBanks: true, serveDealt: bgDealer });
    await h.flush();
    h.ok(String(bgD.env.els.passage.innerHTML).indexOf(bgFull.s[1]) >= 0,
      'bogus dealt: the served passage rendered');
    h.ok(!('l' in bgServed.puzzle) && !('w' in bgServed.puzzle),
      'bogus dealt: the served day never ships its lie');
    bgD.x.pick(0);
    await h.flush();
    h.eq(bgD.x.S.picked.join(), '0', 'bogus dealt: a wrong pick is metered on the session');
    bgD.x.pick(bgFull.l);
    await h.flush();
    h.eq(bgD.x.S.status, 'won', 'bogus dealt: the find wins on the session');
    h.eq(bgD.x.S.lie, 5, 'bogus dealt: the lie arrived only with the spent round');
    const bgPost = h.lastPost(bgD.env);
    h.eq(bgPost.body.nonce, 'b1', 'bogus dealt: the evidence names the session');
    h.eq(bgPost.body.answer.join(), '0,5', 'bogus dealt: the evidence carries the session picks');
    /* a reload keeps the won day and retells the why that never shipped */
    const bgR = h.boot('bogus', EXP,
      { now: T0, store: bgDst, servePuzzle: bgServed, stubBanks: true });
    await h.flush();
    h.eq(bgR.x.S.status, 'won', 'bogus dealt: a reload keeps the won day');
    h.eq(bgR.env.els.why.textContent, bgFull.w,
      'bogus dealt: the reload retells the why it never shipped');
    /* --- an expired session no longer spends the hunt: a mid-hunt
       expiry reseats the graded picks and the find still wins --- */
    let bgXDeals = 0, bgXPicks = [];
    const bgXDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        bgXDeals++;
        bgXPicks = [];
        return { status: 200, body: { nonce: 'bx' + bgXDeals, today: 0, puzzle: bgServed.puzzle } };
      }
      if (body.move.pick !== undefined){
        bgXPicks.push(body.move.pick);
        if (bgXDeals === 1 && bgXPicks.length >= 2)
          return { status: 410, body: {} };
        if (body.move.pick === bgFull.l) return { status: 200, body: { verdict: 'won',
          reveal: { l: bgFull.l, w: bgFull.w } } };
        return { status: 200, body: { verdict: 'miss', left: 3 - bgXPicks.length } };
      }
    };
    const bgXD = h.boot('bogus', EXP,
      { now: T0, store: {}, servePuzzle: bgServed, stubBanks: true, serveDealt: bgXDealer });
    await h.flush();
    bgXD.x.pick(0);
    await h.flush();
    h.eq(bgXD.x.S.picked.join(), '0', 'bogus reseat: one pick graded');
    h.eq(bgXD.x.S.nonce, 'bx1', 'bogus reseat: the first session is held');
    bgXD.x.pick(1);                     /* the session dies on the second pick */
    await h.flush(); await h.flush(); await h.flush();
                    /* expiry -> the reseat replays the graded pick */
    h.eq(bgXD.x.S.picked.join(), '0',
      'bogus reseat: the graded pick survives the expiry');
    h.eq(bgXD.x.S.nonce, 'bx2', 'bogus reseat: the hunt reseats onto a fresh session');
    h.eq(bgXDeals, 2, 'bogus reseat: exactly one redeal');
    bgXD.x.pick(bgFull.l);              /* the lie, on the fresh session */
    await h.flush(); await h.flush();
    h.eq(bgXD.x.S.status, 'won', 'bogus reseat: the find wins on the reseeded session');
    const bgXPost = h.lastPost(bgXD.env);
    h.eq(bgXPost.body.nonce, 'bx2', 'bogus reseat: the evidence names the reseeded session');
    h.eq(bgXPost.body.answer.join(), '0,5',
      'bogus reseat: the evidence carries the whole hunt');

    /* an archive replay keeps the local path: the bank still carries the lie */
    const bgRe = h.boot('bogus', EXP, { now: T1, store: {}, search: '?d=0' });
    bgRe.x.pick(bgRe.x.puzzle.l);
    h.eq(bgRe.x.S.status, 'won', 'bogus dealt: the replay wins locally');
    await h.flush();
    h.eq(bgRe.env.fetchLog.length, 0, 'bogus dealt: a replay posts nothing');
}

module.exports = { name: 'bogus', run };
