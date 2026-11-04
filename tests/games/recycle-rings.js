/* recycle-rings - headless playthrough (win, bonus round, day rollover,
   the resource economy). Split from the old monolithic tests/run.js so each
   game's tests live (and fail) alone: dropping the game later means
   deleting this file with them. */
'use strict';
const { T0, T1 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'PUZZLE', 'loopRing', 'shiftLine', 'commitDrag', 'topLetter', 'shareText', 'openBonus'];
    const store = {};
    let r = h.boot('recycle-rings', EXP, { now: T0, store });
    const P = r.x.PUZZLE;
    h.ok(!!P && /^[A-Z]{4}$/.test(P.word), 'rings: puzzle generated, 4-letter target');
    h.eq(new Set(P.word).size, 4, 'rings: target has four distinct letters');
    h.eq(P.start.length, 32, 'rings: four rings of eight aligned letters');
    /* the weekday ladder: the epoch is a Monday, so day 0 asks four resources */
    h.eq(P.par, 4, 'rings: Monday asks four resources');
    h.eq(P.sol.length, P.par, 'rings: the par line has exactly par engagements');
    let hits = 0;
    for (const ch of P.start.split('')) if (P.word.indexOf(ch) >= 0) hits++;
    h.eq(hits, 4, 'rings: every word letter sits on the board exactly once');
    /* no pure rotation can solve it: some word letter sits outside its home ring */
    h.ok([0,1,2,3].some(p => (P.start.indexOf(P.word[p]) >> 3) !== p),
      'rings: a shift is required, rotations alone cannot spell the word');
    /* the par line never rides the same seat twice in a row */
    let seatOk = true;
    for (let i = 1; i < P.sol.length; i++){
      const a = P.sol[i - 1], b = P.sol[i];
      if (a.t === b.t && (a.t === 'l' ? a.r === b.r : a.c === b.c)) seatOk = false;
    }
    h.ok(seatOk, 'rings: the par line switches seats at every engagement');
    h.eq(r.x.S.grid, P.start, 'rings: the day starts at the scrambled board');
    h.ok(![0,1,2,3].every(p => r.x.topLetter(p) === P.word[p]), 'rings: the day does not start solved');
    h.eq(r.x.S.res, 0, 'rings: the day starts with nothing spent');

    /* the colored answer: a wrong letter sitting in the ray turns red,
       the word's letters waiting in the wrong place turn gold, and only
       fillers stay unmarked - so even a board where nothing fits yet
       reads at a glance */
    const clsAt = (env, ring, col) => {
      const m = env.els.wheel.innerHTML.match(
        new RegExp('class="(lt[^"]*)" data-r="' + ring + '" data-c="' + col + '"'));
      return m ? m[1] : null;
    };
    let okSeats = 0, redSeats = 0, golds = 0, wantRed = 0, wantGold = 0;
    for (let p = 0; p < 4; p++){
      const cls = clsAt(r.env, p, 0);
      if (cls === 'lt ok') okSeats++;
      if (cls === 'lt bad') redSeats++;
      if (P.start[p * 8] !== P.word[p]) wantRed++;
      h.ok(cls === 'lt ok' || cls === 'lt bad',
        'rings: every ray seat answers in color (' + cls + ' at seat ' + p + ')');
    }
    h.eq(redSeats, wantRed, 'rings: red marks exactly the misspelled ray seats');
    for (let p = 0; p < 4; p++){
      for (let c = 1; c < 8; c++){
        const ch = P.start[p * 8 + c];
        const cls = clsAt(r.env, p, c);
        if (P.word.indexOf(ch) >= 0){
          h.eq(cls, 'lt need', 'rings: a word letter in the wrong place turns gold');
          golds++; wantGold++;
        } else {
          h.eq(cls, 'lt', 'rings: a filler stays unmarked');
        }
      }
    }
    h.eq(golds, wantGold, 'rings: gold counts exactly the word letters outside the ray');
    h.ok((r.env.els.slots.innerHTML.match(/class="slot ok"/g) || []).length === okSeats,
      'rings: the readout mirrors the green seats');
    h.ok((r.env.els.slots.innerHTML.match(/class="slot bad"/g) || []).length === redSeats,
      'rings: the readout mirrors the red seats');

    /* the resource economy and the move semantics, on a fresh day */
    const s2 = {};
    r = h.boot('recycle-rings', EXP, { now: T0, store: s2 });
    const g0 = r.x.S.grid;
    for (let p = 0; p < 4; p++) h.eq(r.x.topLetter(p), g0[p * 8], 'rings: the ray reads the top column');
    r.x.loopRing(0, 1);
    h.eq(r.x.S.res, 1, 'rings: taking up a seat costs one resource');
    h.ok(r.x.S.grid.slice(8) === g0.slice(8), 'rings: a loop turns only its own ring');
    let slid = true;
    for (let c = 0; c < 8; c++) if (r.x.S.grid[(c + 1) % 8] !== g0[c]) slid = false;
    h.ok(slid, 'rings: the loop slides every seat by one');
    for (let p = 0; p < 4; p++){
      const cls = clsAt(r.env, p, 0);
      h.ok(cls === 'lt ok' || cls === 'lt bad',
        'rings: a moved board still answers in color at every seat');
    }
    r.x.loopRing(0, -1);
    h.eq(r.x.S.grid, g0, 'rings: looping back restores the ring');
    h.eq(r.x.S.res, 1, 'rings: reversing on the same seat costs nothing');
    r.x.loopRing(1, 1);
    h.eq(r.x.S.res, 2, 'rings: switching rings costs a resource');
    r.x.loopRing(1, -2);
    h.eq(r.x.S.res, 2, 'rings: running the same ring the other way is still free');
    let ring1Only = true;
    for (let rr = 0; rr < 4; rr++){
      if (rr === 1) continue;
      if (r.x.S.grid.slice(rr * 8, rr * 8 + 8) !== g0.slice(rr * 8, rr * 8 + 8)) ring1Only = false;
    }
    h.ok(ring1Only, 'rings: the free run turns only its own ring');
    r.x.loopRing(0, 1);
    h.eq(r.x.S.res, 3, 'rings: coming back to a seat costs again');
    const g1 = r.x.S.grid;
    r.x.shiftLine(3, 1);
    h.eq(r.x.S.res, 4, 'rings: taking up a line costs a resource');
    let lineOnly = true, lineMoved = true, farMoved = true;
    for (let rr = 0; rr < 4; rr++){
      for (let c = 0; c < 8; c++){
        if (c !== 3 && c !== 7 && r.x.S.grid[rr * 8 + c] !== g1[rr * 8 + c]) lineOnly = false;
      }
      if (rr < 3 && r.x.S.grid[rr * 8 + 3] !== g1[(rr + 1) * 8 + 3]) lineMoved = false;
      if (rr > 0 && r.x.S.grid[rr * 8 + 7] !== g1[(rr - 1) * 8 + 7]) farMoved = false;
    }
    h.ok(lineOnly, 'rings: a slide moves only its own line');
    h.ok(lineMoved, 'rings: the pushed ray slides outward one ring');
    h.ok(farMoved, 'rings: the opposite ray slides inward to meet it');
    h.eq(r.x.S.grid[3 * 8 + 3], g1[3 * 8 + 7], 'rings: the far ray hands its inner letter through the center');
    h.eq(r.x.S.grid[7], g1[3], 'rings: the pushed-off letter wraps to the opposite end');
    r.x.shiftLine(3, -1);
    h.eq(r.x.S.grid, g1, 'rings: pushing the same line from the other end restores it');
    h.eq(r.x.S.res, 4, 'rings: the other end of the line is the same seat');
    for (let i = 0; i < 8; i++) r.x.shiftLine(3, 1);
    h.eq(r.x.S.grid, g1, 'rings: eight pushes wrap the line home');
    h.eq(r.x.S.res, 4, 'rings: the whole wrap rides the one seat, no charge');
    h.ok(!r.x.S.won, 'rings: aimless engagements do not win');

    /* drags: one gesture on one seat, however far it runs */
    const g2 = r.x.S.grid;
    r.x.commitDrag('ring', 1, 2);
    h.eq(r.x.S.res, 5, 'rings: a two-seat drag on a fresh seat costs one resource');
    let ringOnly = true, ringTurned = true;
    for (let rr = 0; rr < 4; rr++){
      for (let c = 0; c < 8; c++){
        if (rr !== 1 && r.x.S.grid[rr * 8 + c] !== g2[rr * 8 + c]) ringOnly = false;
        if (r.x.S.grid[8 + ((c + 2) % 8)] !== g2[8 + c]) ringTurned = false;
      }
    }
    h.ok(ringOnly, 'rings: a drag turns only its own ring');
    h.ok(ringTurned, 'rings: the drag turns the ring two seats');
    r.x.commitDrag('ring', 1, 3);
    h.eq(r.x.S.res, 5, 'rings: a long drag on the seat just held is free');
    const g3 = r.x.S.grid;
    r.x.commitDrag('line', 1, 3);
    h.eq(r.x.S.res, 6, 'rings: a line drag costs its one resource');
    let lineOnly2 = true;
    for (let rr = 0; rr < 4; rr++){
      for (let c = 0; c < 8; c++){
        if (c !== 1 && c !== 5 && r.x.S.grid[rr * 8 + c] !== g3[rr * 8 + c]) lineOnly2 = false;
      }
    }
    h.ok(lineOnly2, 'rings: a drag slides only its own line');
    h.eq(r.x.S.grid[0 * 8 + 1], g3[3 * 8 + 1], 'rings: the grabbed ray hands its letters outward');
    h.eq(r.x.S.grid[3 * 8 + 1], g3[1 * 8 + 5], 'rings: and takes a far-ray letter through the center');
    h.eq(r.x.S.grid[3 * 8 + 5], g3[0 * 8 + 5], 'rings: the far ray slides inward to meet it');
    h.eq(r.x.S.grid[0 * 8 + 5], g3[2 * 8 + 1], 'rings: the pushed-off letter wraps to the far end');
    const g4 = r.x.S.grid;
    r.x.commitDrag('line', 1, -8);
    h.eq(r.x.S.grid, g4, 'rings: a full wrap of the line lands on the same seats');
    h.eq(r.x.S.res, 6, 'rings: a full wrap on the seat just held is free');
    r.x.commitDrag('ring', 0, 0);
    h.eq(r.x.S.res, 6, 'rings: a drag that covers no seat costs nothing');
    h.ok(!r.x.S.won, 'rings: drag commits do not win on their own');

    /* replay the solver's own par line: it must win in exactly par resources */
    const s3 = {};
    r = h.boot('recycle-rings', EXP, { now: T0, store: s3 });
    const startWheel = r.env.els.wheel.innerHTML;
    for (const mv of P.sol){
      if (mv.t === 'l') r.x.loopRing(mv.r, mv.d);
      else r.x.shiftLine(mv.c, mv.d);
    }
    h.ok(r.x.S.won, 'rings: won by replaying the par line');
    h.eq(r.x.S.res, P.par, 'rings: replay costs exactly par resources');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 3, 'rings: on par posts full points');
    h.eq(h.lastPost(r.env).body.game, 'rings', 'rings: the day posts to the rings curve');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'rings: the on-par star rides the share');
    h.ok(r.x.shareText().indexOf('resources') >= 0, 'rings: the share speaks in resources');

    /* the won board answers in one color: green at every seat, no red,
       no gold, and the readout green too */
    for (let p = 0; p < 4; p++){
      h.eq(clsAt(r.env, p, 0), 'lt ok', 'rings: a won board reads green at every seat');
    }
    h.ok(r.env.els.wheel.innerHTML.indexOf('lt bad') === -1, 'rings: a won board shows no red');
    h.ok(r.env.els.wheel.innerHTML.indexOf('lt need') === -1, 'rings: a won board shows no gold');
    h.ok(r.env.els.slots.innerHTML.indexOf('slot bad') === -1, 'rings: a won readout shows no red');

    /* the bonus round: unlocked by the win, played under the step economy */
    r.x.openBonus();
    h.ok(!!r.x.S.bonus && r.x.S.bonus.on, 'rings: the win opens the bonus round');
    h.eq(r.x.S.bonus.grid, P.start, 'rings: the bonus replays the day\u2019s own board');
    h.eq(r.env.els.wheel.innerHTML, startWheel,
      'rings: the bonus board answers in the same colors as the day start');
    h.ok(r.x.S.bonus.par >= 1 && r.x.S.bonus.par <= 14,
      'rings: the bonus par is a step count (got ' + r.x.S.bonus.par + ')');
    h.ok(r.x.S.bonus.par >= P.par, 'rings: the step line is never shorter than the resource line');
    h.eq(r.x.S.bonus.steps, 0, 'rings: the bonus starts unplayed');
    /* the step economy charges every seat-step, same seat included */
    r.x.loopRing(0, 1);
    r.x.loopRing(0, 1);
    h.eq(r.x.S.bonus.steps, 2, 'rings: the bonus charges every seat-step');
    h.ok(!r.x.S.bonus.won, 'rings: two steps do not win the bonus on their own');
    /* walk the ring back home - the detour costs its steps too - then
       replaying the par line as engagements wins the bonus, at step cost */
    r.x.loopRing(0, -2);
    h.eq(r.x.S.bonus.grid, P.start, 'rings: the bonus board walks back to its start');
    h.eq(r.x.S.bonus.steps, 4, 'rings: walking back costs its steps as well');
    for (const mv of P.sol){
      if (mv.t === 'l') r.x.loopRing(mv.r, mv.d);
      else r.x.shiftLine(mv.c, mv.d);
    }
    h.ok(r.x.S.bonus.won, 'rings: the bonus is won by replaying the line');
    const bsteps = P.sol.reduce((n, mv) => n + Math.abs(mv.d), 0) + 4;
    h.eq(r.x.S.bonus.steps, bsteps, 'rings: every step of the line was charged');
    const bpts = Math.max(0, 3 - (r.x.S.bonus.steps - r.x.S.bonus.par));
    await h.flush();
    h.eq(h.lastPost(r.env).body.game, 'rings-bonus', 'rings: the bonus posts to its own curve');
    h.eq(h.lastPost(r.env).body.value, bpts, 'rings: the bonus posts its own points');
    h.eq(r.x.S.stats.streak, 1, 'rings: the bonus touches no streak');
    h.eq(r.x.S.stats.played, 1, 'rings: the bonus counts no extra play');
    h.ok(r.x.shareText().indexOf('bonus') >= 0, 'rings: the bonus share says so');

    /* reload mid-bonus: the state keeps the board, the steps and the win */
    r = h.boot('recycle-rings', EXP, { now: T0, store: s3 });
    h.ok(!!r.x.S.bonus && r.x.S.bonus.on, 'rings: the bonus survives a reload');
    h.eq(r.x.S.bonus.steps, bsteps, 'rings: the bonus keeps its step count');
    h.ok(r.x.S.bonus.won, 'rings: the bonus win survives the reload');
    h.ok(r.x.shareText().indexOf('bonus') >= 0, 'rings: a reloaded bonus still shares as the bonus');

    /* day rollover: the streak rides the main round, the ladder rolls on */
    r = h.boot('recycle-rings', EXP, { now: T1, store: s3 });
    h.eq(r.x.S.day, 1, 'rings: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'rings: streak preserved');
    h.eq(r.x.PUZZLE.par, 5, 'rings: Tuesday asks five resources');
    /* the rest of the ladder: Friday is the peak, the weekend draws inside it */
    r = h.boot('recycle-rings', EXP, { now: T0 + 4 * 86400000, store: {} });
    h.eq(r.x.PUZZLE.par, 7, 'rings: Friday asks seven resources');
    const we = h.boot('recycle-rings', EXP, { now: T0 + 5 * 86400000, store: {} });
    h.ok(we.x.PUZZLE.par >= 4 && we.x.PUZZLE.par <= 7,
      'rings: the weekend draws within the ladder (got ' + we.x.PUZZLE.par + ')');
}

module.exports = { name: 'recycle-rings', run };
