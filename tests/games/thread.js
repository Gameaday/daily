/* thread - headless playthrough (win, give-up, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1 } = require('./_lib');

async function run(h){
    const EXP = ['PZ', 'S', 'shareText'];
    const store = {};
    let r = h.boot('thread', EXP, { now: T0, store });
    h.ok(!!r.x.PZ.s && !!r.x.PZ.e, 'thread: day-0 puzzle boots');
    const k = r.x.PZ.m.length;
    h.ok(k >= 2 && k <= 4, 'thread: 2-4 middles');
    h.eq(r.x.PZ.d.length, 2, 'thread: two decoys');
    const ids = [r.x.PZ.s.id, r.x.PZ.e.id]
      .concat(r.x.PZ.m.map(x => x.id), r.x.PZ.d.map(x => x.id));
    h.eq(new Set(ids).size, ids.length, 'thread: offered ids are distinct');
    r.x.S.slots = r.x.PZ.m.map(x => x.id);
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'thread: won in one check');
    h.eq(r.x.S.checks, 1, 'thread: checks = 1');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'thread: curve value 1');
    h.ok(r.x.shareText().indexOf('1 check') >= 0, 'thread: share "1 check"');
    r = h.boot('thread', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'thread: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'thread: streak preserved');
    const s2 = {};
    r = h.boot('thread', EXP, { now: T0, store: s2 });
    r.env.els.btnGiveUp.click();
    h.eq(r.x.S.status, 'gaveup', 'thread: gaveup status');
    h.eq(r.x.S.slots.join(','), r.x.PZ.m.map(x => x.id).join(','),
      'thread: give-up lays out the true chain');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 9, 'thread: curve value 9 on give-up');
    h.ok(String(r.env.els.chainbox.innerHTML).length > 0, 'thread: reveal renders the chain');
}

module.exports = { name: 'thread', run };
