/* brunch - headless playthrough (win, loss, day rollover). The table
   seats itself from the presence layer: day 0 is Florence 1469. */
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
}

module.exports = { name: 'brunch', run };
