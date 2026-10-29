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
    h.eq(h.lastPost(r.env).body.value, 3, 'bogus: curve value 3');
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
    h.eq(h.lastPost(r.env).body.value, 0, 'bogus: curve value 0 on loss');
    h.eq(r.x.S.stats.dist[0], 1, 'bogus: dist[0] ticked');
}

module.exports = { name: 'bogus', run };
