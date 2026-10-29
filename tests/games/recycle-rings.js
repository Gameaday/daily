/* recycle-rings - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'PUZZLE', 'spin', 'swap', 'topLetter', 'shareText'];
    const store = {};
    let r = h.boot('recycle-rings', EXP, { now: T0, store });
    h.ok(!!r.x.PUZZLE && /^[A-Z]{4}$/.test(r.x.PUZZLE.word), 'rings: puzzle generated, 4-letter target');
    h.eq(new Set(r.x.PUZZLE.word).size, 4, 'rings: target has four distinct letters');
    h.ok(r.x.PUZZLE.par >= 5 && r.x.PUZZLE.par <= 13,
      'rings: par in [5,13] (got ' + r.x.PUZZLE.par + ')');
    h.ok(r.x.PUZZLE.order.some((q, p) => q !== p), 'rings: ring order starts scrambled');
    /* replay the solver's own par line — it must win in exactly par moves */
    for (const mv of r.x.PUZZLE.sol) mv.t === 'r' ? r.x.spin(mv.p, mv.d) : r.x.swap(mv.p);
    h.ok(r.x.S.won, 'rings: won by replaying the par line');
    h.eq(r.x.S.moves, r.x.PUZZLE.par, 'rings: replay costs exactly par moves');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, r.x.PUZZLE.par, 'rings: curve value = move count');
    h.ok(r.x.shareText().indexOf('moves') >= 0, 'rings: share text mentions moves');
    r = h.boot('recycle-rings', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'rings: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'rings: streak preserved');
    /* conservatism is the game: spinning back is not free */
    const s2 = {};
    r = h.boot('recycle-rings', EXP, { now: T0, store: s2 });
    r.x.spin(0, 1); r.x.spin(0, -1);
    h.eq(r.x.S.moves, 2, 'rings: reversing still costs moves');
    h.ok(!r.x.S.won, 'rings: aimless spinning does not win');
}

module.exports = { name: 'recycle-rings', run };
