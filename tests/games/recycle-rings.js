/* recycle-rings - headless playthrough (win, day rollover, move costs).
   Split from the old monolithic tests/run.js so each game's tests live (and
   fail) alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'PUZZLE', 'loopRing', 'shiftRay', 'commitDrag', 'topLetter', 'shareText'];
    const store = {};
    let r = h.boot('recycle-rings', EXP, { now: T0, store });
    const P = r.x.PUZZLE;
    h.ok(!!P && /^[A-Z]{4}$/.test(P.word), 'rings: puzzle generated, 4-letter target');
    h.eq(new Set(P.word).size, 4, 'rings: target has four distinct letters');
    h.eq(P.start.length, 32, 'rings: four rings of eight aligned letters');
    h.ok(P.par >= 3 && P.par <= 10,
      'rings: par in [3,10], winnable in a reasonable line (got ' + P.par + ')');
    h.eq(P.sol.length, P.par, 'rings: the par line has exactly par moves');
    let hits = 0;
    for (const ch of P.start.split('')) if (P.word.indexOf(ch) >= 0) hits++;
    h.eq(hits, 4, 'rings: every word letter sits on the board exactly once');
    h.eq(r.x.S.grid, P.start, 'rings: the day starts at the scrambled board');
    h.ok(![0,1,2,3].every(p => r.x.topLetter(p) === P.word[p]), 'rings: the day does not start solved');
    /* replay the solver's own par line: it must win in exactly par moves */
    for (const mv of P.sol){
      if (mv.t === 'l') r.x.loopRing(mv.r, mv.d);
      else r.x.shiftRay(mv.c, mv.d);
    }
    h.ok(r.x.S.won, 'rings: won by replaying the par line');
    h.eq(r.x.S.moves, P.par, 'rings: replay costs exactly par moves');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 3, 'rings: on par posts full points');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'rings: the on-par star rides the share');
    h.ok(r.x.shareText().indexOf('moves') >= 0, 'rings: share text mentions moves');
    r = h.boot('recycle-rings', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'rings: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'rings: streak preserved');
    /* move semantics: a loop turns one ring alone, a shift slides one ray */
    const s2 = {};
    r = h.boot('recycle-rings', EXP, { now: T0, store: s2 });
    const g0 = r.x.S.grid;
    for (let p = 0; p < 4; p++) h.eq(r.x.topLetter(p), g0[p * 8], 'rings: the ray reads the top column');
    r.x.loopRing(0, 1);
    h.eq(r.x.S.moves, 1, 'rings: a loop costs one move');
    h.ok(r.x.S.grid.slice(8) === g0.slice(8), 'rings: a loop turns only its own ring');
    let slid = true;
    for (let c = 0; c < 8; c++) if (r.x.S.grid[(c + 1) % 8] !== g0[c]) slid = false;
    h.ok(slid, 'rings: the loop slides every seat by one');
    r.x.loopRing(0, -1);
    h.eq(r.x.S.grid, g0, 'rings: looping back restores the ring');
    h.eq(r.x.S.moves, 2, 'rings: reversing still costs moves');
    const g1 = r.x.S.grid;
    r.x.shiftRay(3, 1);
    h.eq(r.x.S.moves, 3, 'rings: a ray shift costs one move');
    let rayOnly = true, rayMoved = true;
    for (let rr = 0; rr < 4; rr++){
      for (let c = 0; c < 8; c++){
        if (c === 3) continue;
        if (r.x.S.grid[rr * 8 + c] !== g1[rr * 8 + c]) rayOnly = false;
      }
      if (r.x.S.grid[((rr + 1) % 4) * 8 + 3] !== g1[rr * 8 + 3]) rayMoved = false;
    }
    h.ok(rayOnly, 'rings: a shift moves only its own ray');
    h.ok(rayMoved, 'rings: the shift slides the ray one ring, wrapping');
    r.x.shiftRay(3, -1);
    h.eq(r.x.S.grid, g1, 'rings: shifting back restores the ray');
    for (let i = 0; i < 4; i++) r.x.shiftRay(3, 1);
    h.eq(r.x.S.grid, g1, 'rings: four inward shifts wrap the ray home');
    h.eq(r.x.S.moves, 8, 'rings: every shift costs, wraps included');
    h.ok(!r.x.S.won, 'rings: aimless moves do not win');
    /* drag commits: one gesture can cover several seats, one move a seat */
    const g2 = r.x.S.grid;
    r.x.commitDrag('ring', 1, 2);
    h.eq(r.x.S.moves, 10, 'rings: a two-seat ring drag costs two moves');
    let ringOnly = true, ringTurned = true;
    for (let rr = 0; rr < 4; rr++){
      for (let c = 0; c < 8; c++){
        if (rr !== 1 && r.x.S.grid[rr * 8 + c] !== g2[rr * 8 + c]) ringOnly = false;
        if (r.x.S.grid[8 + ((c + 2) % 8)] !== g2[8 + c]) ringTurned = false;
      }
    }
    h.ok(ringOnly, 'rings: a drag turns only its own ring');
    h.ok(ringTurned, 'rings: the drag turns the ring two seats');
    const g3 = r.x.S.grid;
    r.x.commitDrag('ray', 5, 3);
    h.eq(r.x.S.moves, 13, 'rings: a three-seat ray drag costs three moves');
    let rayOnly2 = true, rayMoved2 = true;
    for (let rr = 0; rr < 4; rr++){
      for (let c = 0; c < 8; c++){
        if (c !== 5 && r.x.S.grid[rr * 8 + c] !== g3[rr * 8 + c]) rayOnly2 = false;
      }
      if (r.x.S.grid[((rr + 3) % 4) * 8 + 5] !== g3[rr * 8 + 5]) rayMoved2 = false;
    }
    h.ok(rayOnly2, 'rings: a drag shifts only its own ray');
    h.ok(rayMoved2, 'rings: the drag slides the ray three seats, wrapping');
    const g4 = r.x.S.grid;
    r.x.commitDrag('ray', 5, -4);
    h.eq(r.x.S.grid, g4, 'rings: a full wrap of the ray lands on the same seats');
    h.eq(r.x.S.moves, 17, 'rings: wrapping seats still cost one move a seat');
    r.x.commitDrag('ring', 0, 0);
    h.eq(r.x.S.moves, 17, 'rings: a drag that covers no seat costs nothing');
    h.ok(!r.x.S.won, 'rings: drag commits do not win on their own');
}

module.exports = { name: 'recycle-rings', run };
