/* timeline - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'PICK', 'SORTED', 'shareText'];
    const store = {};
    let r = h.boot('timeline', EXP, { now: T0, store });
    h.eq(r.x.PICK.length, 5, 'timeline: 5 events picked');
    r.x.S.order = r.x.SORTED.map(idx => r.x.PICK.indexOf(idx));
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'timeline: won in one check');
    h.eq(r.x.S.checks, 1, 'timeline: checks = 1');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'timeline: curve value 1');
    h.ok(r.x.shareText().indexOf('1 check') >= 0, 'timeline: share "1 check"');
    r = h.boot('timeline', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'timeline: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'timeline: streak preserved');
    const s2 = {};
    r = h.boot('timeline', EXP, { now: T0, store: s2 });
    r.env.els.btnGiveUp.click();
    h.eq(r.x.S.status, 'gaveup', 'timeline: gaveup status');
    h.eq(r.x.S.order.join(','), r.x.SORTED.map(i => r.x.PICK.indexOf(i)).join(','),
      'timeline: give-up sorts the lane');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 9, 'timeline: curve value 9 on give-up');

    /* drag-to-reorder: the move the pointer handlers drive */
    const s3 = {};
    r = h.boot('timeline', ['S', 'PICK', 'SORTED', 'moveCard'], { now: T0, store: s3 });
    const a = r.x.S.order.slice();
    h.ok(r.x.moveCard(0, 2), 'timeline: drag drops a card into a new slot');
    h.eq(r.x.S.order[2], a[0], 'timeline: the dragged card lands at its slot');
    h.eq(r.x.S.order[0], a[1], 'timeline: the run between shifts down');
    h.eq(r.x.S.order[1], a[2], 'timeline: the run between shifts down');
    h.eq(r.x.S.order[3], a[3], 'timeline: the tail stays put');
    h.eq(r.x.S.order[4], a[4], 'timeline: the tail stays put');
    h.ok(!r.x.moveCard(1, 1), 'timeline: a drop back in its own slot is a no-op');
    r.x.S.locked[1] = true;
    h.ok(!r.x.moveCard(0, 2), 'timeline: a locked card blocks the drag across it');
    h.eq(r.x.S.order[2], a[0], 'timeline: a blocked drag changes nothing');
    h.ok(r.x.moveCard(2, 4), 'timeline: a drag past the lock still works');
    h.ok(r.x.S.started, 'timeline: a drag marks the day started');
    r.env.els.btnGiveUp.click();
    h.ok(!r.x.moveCard(0, 2), 'timeline: no dragging after the day is done');
}

module.exports = { name: 'timeline', run };
