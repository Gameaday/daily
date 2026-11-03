/* brunch - headless playthrough (win, loss, day rollover, dealt live day,
   archive replay). The table seats itself from the presence layer: day 0 is
   Florence 1469. */
'use strict';
const { T0, T1 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'EV', 'shareText'];
    const store = {};
    let r = h.boot('brunch', EXP, { now: T0, store });
    await h.flush();
    h.eq(r.x.EV.y, 1469, 'brunch: day 0 = Florence 1469');
    h.eq(r.x.EV.opts.length, 4, 'brunch: four names at the table');
    h.ok(r.x.EV.opts.indexOf(undefined) === -1, 'brunch: every seat is named');
    r.env.els['opt' + r.x.EV.a].click();
    h.eq(r.x.S.status, 'won', 'brunch: picked the impostor first try');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'brunch: the win posts the won status');
    h.eq(h.lastPost(r.env).body.answer, r.x.EV.a, 'brunch: the evidence carries the seat');
    h.ok(!('value' in h.lastPost(r.env).body), 'brunch: the client never names its own score');
    r = h.boot('brunch', EXP, { now: T1, store });
    await h.flush();
    h.eq(r.x.S.day, 1, 'brunch: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'brunch: streak preserved');
    const s2 = {};
    r = h.boot('brunch', EXP, { now: T0, store: s2 });
    await h.flush();
    const wrong = (r.x.EV.a + 1) % 4;
    r.env.els['opt' + wrong].click();
    h.eq(r.x.S.status, 'lost', 'brunch: a wrong name loses the seat');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'lost', 'brunch: the loss posts lost, the server owns the 0');
    h.ok(r.env.els.why.textContent.indexOf(r.x.EV.opts[r.x.EV.a]) >= 0,
      'brunch: the reveal names the impostor');

    /* --- the live day cuts over to dealt play: the table arrives without
           its impostor and the pick is graded by the session --- */
    const live = h.boot('brunch', ['S', 'EV'], { now: T0, store: {} });
    await h.flush();
    const full = live.x.EV;
    const served = { t: full.t, q: full.q, y: full.y, opts: full.opts };
    let deals = 0;
    const serveDealt = (url, body) => {
      if (/\/deal$/.test(url)){
        deals++;
        return { status: 200, body: { nonce: 'b1', today: 0, puzzle: served } };
      }
      return { status: 200, body: { verdict: body.move.pick === full.a ? 'won' : 'lost',
        reveal: { a: full.a, w: full.w } } };
    };
    const dstore = {};
    const rd = h.boot('brunch', ['S', 'EV'], { now: T0, store: dstore,
      servePuzzle: { game: 'brunch', day: 0, puzzle: served, today: 0 },
      stubBanks: true, serveDealt });
    await h.flush();
    h.ok(rd.env.els.qtext.textContent.indexOf(served.q) >= 0,
      'brunch: the dealt table renders its question');
    const off = (full.a + 1) % 4;
    rd.env.els['opt' + off].click();
    await h.flush();
    h.eq(rd.x.S.status, 'lost', 'brunch: the session grades the wrong pick lost');
    h.eq(rd.x.S.nonce, 'b1', 'brunch: the dealt session is held');
    h.eq(rd.env.els.why.textContent, full.w, 'brunch: the reveal rides the spent pick');
    h.eq(h.lastPost(rd.env).body.nonce, 'b1', 'brunch: the evidence names the session');
    h.eq(h.lastPost(rd.env).body.status, 'lost', 'brunch: the lost pick posts lost');
    h.eq(deals, 1, 'brunch: one deal carries the live round');
    const again = h.boot('brunch', ['S', 'EV'], { now: T0, store: dstore,
      servePuzzle: { game: 'brunch', day: 0, puzzle: served, today: 0 },
      stubBanks: true });
    await h.flush();
    h.eq(again.x.S.status, 'lost', 'brunch: a reload keeps the spent round');
    h.eq(again.env.els.why.textContent, full.w,
      'brunch: the reload retells the reveal though the key never shipped');
    h.ok(again.env.els['opt' + full.a].classList.contains('seat'),
      'brunch: the reload still marks the true seat');
    const wstore = {};
    const r2 = h.boot('brunch', ['S', 'EV'], { now: T0, store: wstore,
      servePuzzle: { game: 'brunch', day: 0, puzzle: served, today: 0 },
      stubBanks: true, serveDealt });
    await h.flush();
    r2.env.els['opt' + full.a].click();
    await h.flush();
    h.eq(r2.x.S.status, 'won', 'brunch: the right seat wins the dealt table');
    h.ok(r2.env.els['opt' + full.a].classList.contains('seat'),
      'brunch: the winning seat is marked from the session verdict');
    h.eq(h.lastPost(r2.env).body.answer, full.a, 'brunch: the evidence carries the seat');

    /* --- a replayed day is long over: the archive path grades locally and
           posts nothing --- */
    const rr = h.boot('brunch', ['S', 'EV'], { now: T1, store: {}, search: '?d=0' });
    await h.flush();
    rr.env.els['opt' + rr.x.EV.a].click();
    h.eq(rr.x.S.status, 'won', 'brunch: a replayed day wins locally');
    await h.flush();
    h.eq(rr.env.fetchLog.length, 0, 'brunch: a replayed day posts nothing');
}

module.exports = { name: 'brunch', run };
