/* trace - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'LADDER', 'climb', 'steps', 'shareText'];
    const store = {};
    let r = h.boot('trace', EXP, { now: T0, store });
    r.x.S.startAt = 1; /* a first climb happened long ago */
    h.ok(r.x.LADDER.path.length >= 5, 'trace: ladder generated');
    for (const w of r.x.LADDER.path.slice(1)){
      r.env.els.next.value = w;
      r.x.climb();
    }
    h.eq(r.x.S.status, 'won', 'trace: won walking the optimal path');
    h.eq(r.x.steps(), r.x.LADDER.par, 'trace: steps = par');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 3, 'trace: on par posts full points');
    h.ok(r.env.els.timenote.textContent.indexOf('your time') === 0, 'trace: the result carries the time');
    /* Regression: over <= 0 made "on par" unreachable; at exactly par the
       share text bragged "under par!". */
    h.ok(r.x.shareText().indexOf('on par') >= 0, 'trace: share "on par" (regression)');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'trace: the on-par star rides the share');
    r = h.boot('trace', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'trace: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'trace: streak preserved');
    const s2 = {};
    r = h.boot('trace', EXP, { now: T0, store: s2 });
    r.env.els.next.value = r.x.LADDER.path[1];
    r.x.climb();
    h.eq(r.x.S.chain.length, 2, 'trace: climbed to the first rung');
    r.env.els.next.value = r.x.LADDER.start;
    r.x.climb();
    h.eq(r.x.S.chain.length, 1, 'trace: typing a ladder word climbs back down');
    h.eq(r.x.S.chain[r.x.S.chain.length - 1], r.x.LADDER.start, 'trace: back at the start word');
    r.env.els.next.value = r.x.LADDER.path[1];
    r.x.climb();
    h.eq(r.x.S.chain.length, 2, 'trace: the dropped rung is climbable again');
    r.env.els.btnGive.click();
    h.eq(r.x.S.status, 'lost', 'trace: give-up loses');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'trace: give-up posts 0 points');

    /* the wide rung bank: a common word outside the curated list is
       accepted as a rung, and a non-word still bounces (regression:
       the day-0 ladder starts at MUCH, and OUCH used to be rejected) */
    const s3 = {};
    r = h.boot('trace', EXP, { now: T0, store: s3 });
    h.eq(r.x.LADDER.start, 'MUCH', 'trace: the pinned day-0 start');
    r.env.els.next.value = 'OUCH';
    r.x.climb();
    h.eq(r.x.S.chain.length, 2, 'trace: a wide-bank rung is accepted');
    h.eq(r.x.S.chain[1], 'OUCH', 'trace: the rung rides the ladder');
    r.env.els.next.value = 'QXYZ';
    r.x.climb();
    h.eq(r.x.S.chain.length, 2, 'trace: a non-word rung still bounces');
}

module.exports = { name: 'trace', run };
