/* End-to-end behavioral tests for all 13 warmup games, plus cross-checks
   between the games' curve clients and scores/server.py.

   Every scenario boots the real game script (no browser), plays it to a
   win or loss, checks the value posted to the global curve, then "reboots"
   the next day with the same localStorage to prove streaks survive
   rollover. Regression tests for the fixed bugs are marked inline.

   Zero dependencies: node tests/run.js (exit 1 on any failure). */
'use strict';

const GAMES = ['bogus', 'well-actually', 'recycle-rings', 'recycle-grid', 'fermi',
  'sift', 'rounds', 'trace', 'lightbox', 'sprint', 'cipher', 'timeline', 'museum'];

/* Fixed days: EPOCH_KEY is 2026-10-27, so noon UTC on that date is day 0
   no matter the runner's real clock (the harness Date is pinned per boot). */
const T0 = Date.parse('2026-10-27T12:00:00Z');
const T1 = T0 + 86400000;
const T10 = T0 + 10 * 86400000;

async function main(createHarness, readGame, readServer, readLanding, readShared, readStore){
  const h = createHarness(readGame, readShared);
  const serverPy = readServer();
  const landing = readLanding();

  async function bogusTests(){
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

  async function wellActuallyTests(){
    const EXP = ['S', 'puzzle', 'pick', 'submitBonus', 'score', 'shareText'];
    const store = {};
    let r = h.boot('well-actually', EXP, { now: T0, store });
    h.eq(r.x.puzzle.l, 1, 'well-actually: day 0 lie is statement 1');
    r.x.pick(1);
    h.eq(r.x.S.status, 'found', 'well-actually: lie found');
    r.env.els.binput.value = 'Leonardo';
    r.x.submitBonus();
    h.eq(r.x.S.status, 'won', 'well-actually: won');
    h.eq(r.x.score(), 4, 'well-actually: 4 pts (3 + bonus)');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 4, 'well-actually: curve value 4');
    /* Regression: a reload used to lose the curve because syncBoard only
       fired from finish(), which does not run again for a finished day. */
    r = h.boot('well-actually', EXP, { now: T0, store });
    await h.flush();
    h.ok(r.env.fetchLog.length >= 1 && h.lastPost(r.env).body.value === 4,
      'well-actually: curve re-fires on reload (regression)');
    r = h.boot('well-actually', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'well-actually: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'well-actually: streak preserved');
  }

  async function ringsTests(){
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

  async function gridTests(){
    const EXP = ['S', 'PUZZLE', 'MODES', 'bestPossible', 'doShift', 'undo', 'restart',
      'lockRows', 'setMode', 'applyRows', 'applyCols', 'VEC_BY_COST', 'shareText', 'findWords',
      'getPuzzle', 'getPractice', 'getBudget', 'getMode', 'curBest'];
    const store = {};
    let r = h.boot('recycle-grid', EXP, { now: T0, store });
    h.eq(r.x.MODES.practice, 4, 'grid: practice = 4 shifts');
    h.eq(r.x.MODES.normal, 5, 'grid: normal = 5 shifts');
    h.eq(r.x.MODES.hard, 6, 'grid: hard = 6 shifts');
    h.eq(r.x.getMode(), 'normal', 'grid: defaults to normal');
    h.eq(r.x.getBudget(), 5, 'grid: normal budget = 5');
    const P = r.x.getPuzzle();
    h.ok(!!P && P.start.length === 25, 'grid: puzzle generated');
    h.ok(P.best >= 8, 'grid: best possible >= 8 (got ' + P.best + ')');
    const w0 = r.x.findWords(P.start).length;
    h.ok(w0 <= P.best - 2, 'grid: start is lean (' + w0 + ' words vs best ' + P.best + ')');
    h.eq(r.x.bestPossible(P.start.slice(), r.x.getBudget()), P.best, 'grid: best possible recomputes exactly');
    h.eq(r.x.curBest(), P.best, 'grid: normal shows the daily optimum');
    h.eq(r.x.S.phase, 'rows', 'grid: starts in the rows phase');

    /* phase + budget guards */
    r.x.doShift('col', 0, 1);
    h.eq(r.x.S.used, 0, 'grid: column shift rejected in the rows phase');
    r.x.doShift('row', 0, 1);
    h.eq(r.x.S.used, 1, 'grid: row shift spends the budget');
    r.x.undo();
    h.eq(r.x.S.used, 0, 'grid: undo refunds the budget');
    h.ok(r.x.S.start.every((c, i) => c === r.x.S.letters[i]), 'grid: undo restores the board');
    for (let k = 0; k < 5; k++) r.x.doShift('row', k % 5, 1);
    h.eq(r.x.S.used, 5, 'grid: budget spent');
    r.x.doShift('row', 0, 1);
    h.eq(r.x.S.used, 5, 'grid: no shifts past the budget');
    r.x.restart();
    h.eq(r.x.S.used, 0, 'grid: restart is free and full');
    r.x.doShift('row', 0, 1);
    r.x.lockRows();
    h.eq(r.x.S.phase, 'cols', 'grid: rows locked');
    r.x.doShift('row', 1, 1);
    h.eq(r.x.S.moves.length, 1, 'grid: no row shifts after the lock');
    r.x.doShift('col', 2, 1);
    h.eq(r.x.S.moves.length, 2, 'grid: column shifts work in phase 2');
    r.x.undo(); r.x.undo();
    h.eq(r.x.S.moves.length, 0, 'grid: undo reaches back across the lock');
    r.x.doShift('row', 3, 1);
    h.eq(r.x.S.moves.length, 0, 'grid: undoing a row move does not reopen rows');

    /* random legal play never beats the exact optimum */
    for (let t = 0; t < 25; t++){
      let seed = 20261027 + t * 7919;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const rt = h.boot('recycle-grid', EXP, { now: T0, store: {} });
      while (rt.x.S.used < rt.x.getBudget()){
        if (rt.x.S.phase === 'rows' && rnd() < 0.3){ rt.x.lockRows(); continue; }
        rt.x.doShift(rt.x.S.phase === 'rows' ? 'row' : 'col',
          Math.floor(rnd() * 5), rnd() < 0.5 ? -1 : 1);
      }
      h.ok(rt.x.findWords(rt.x.S.letters).length <= rt.x.getPuzzle().best,
        'grid: random play ' + t + ' never beats best possible');
    }

    /* brute-force the true optimum, bank it: perfect flag + share badge + curve */
    const r3 = h.boot('recycle-grid', EXP, { now: T0, store: {} });
    const P3 = r3.x.getPuzzle(), B3 = r3.x.getBudget();
    let bw = -1, bvec = null;
    for (let ca = 0; ca <= B3; ca++){
      for (const ra of r3.x.VEC_BY_COST[ca]){
        for (let cb = 0; cb + ca <= B3; cb++){
          for (const rc of r3.x.VEC_BY_COST[cb]){
            const b = P3.start.slice();
            r3.x.applyRows(b, ra);
            r3.x.applyCols(b, rc);
            const w = r3.x.findWords(b).length;
            if (w > bw){ bw = w; bvec = [ra, rc]; }
          }
        }
      }
    }
    h.eq(bw, P3.best, 'grid: brute force matches the declared best possible');
    const argmax = P3.start.slice();
    r3.x.applyRows(argmax, bvec[0]);
    r3.x.applyCols(argmax, bvec[1]);
    r3.x.S.letters = argmax;
    h.eq(r3.x.findWords(argmax).length, P3.best, 'grid: argmax board reaches the optimum');
    r3.env.els.btnBank.click();
    await h.flush();
    h.ok(r3.x.S.banked, 'grid: banked');
    h.ok(r3.x.S.counted, 'grid: day stats counted once');
    h.eq(r3.x.S.stats.perfect, 1, 'grid: perfect bank counted');
    h.ok(r3.x.shareText().indexOf('perfect') >= 0, 'grid: share shows the perfect badge');
    h.eq(h.lastPost(r3.env).body.game, 'grid', 'grid: normal posts to the grid curve');
    h.eq(h.lastPost(r3.env).body.value, P3.best, 'grid: curve value = optimum words');

    /* same day is deterministic */
    const ra2 = h.boot('recycle-grid', EXP, { now: T0, store: {} });
    h.eq(ra2.x.getPuzzle().start.join(''), P.start.join(''), 'grid: same day is deterministic');

    /* practice: 4 shifts, a fresh random board, nothing recorded */
    const storeM = {};
    let rm = h.boot('recycle-grid', EXP, { now: T0, store: storeM });
    const daily = rm.x.getPuzzle().start.join('');
    rm.x.setMode('practice');
    h.eq(rm.x.getMode(), 'practice', 'grid: practice mode on');
    h.eq(rm.x.getBudget(), 4, 'grid: practice = 4 shifts');
    const PR = rm.x.getPractice();
    h.ok(!!PR && PR.start.length === 25, 'grid: practice board generated');
    h.ok(PR.best >= 8, 'grid: practice optimum is fat (got ' + PR.best + ')');
    h.ok(PR.start.join('') !== daily, 'grid: practice board is its own random board');
    h.eq(rm.x.S.letters.join(''), PR.start.join(''), 'grid: practice plays the practice board');
    for (let k = 0; k < 4; k++) rm.x.doShift('row', k % 5, 1);
    h.eq(rm.x.S.used, 4, 'grid: practice budget spent');
    rm.x.doShift('row', 0, 1);
    h.eq(rm.x.S.used, 4, 'grid: practice budget hard-stops at 4');
    const postsBefore = rm.env.fetchLog.length;
    rm.env.els.btnBank.click();
    await h.flush();
    h.ok(rm.x.S.banked, 'grid: practice can bank');
    h.eq(rm.x.S.stats.played, 0, 'grid: practice never touches stats');
    h.eq(rm.env.fetchLog.length, postsBefore, 'grid: practice posts nothing to the curve');
    h.ok(rm.x.shareText().indexOf('practice') >= 0, 'grid: share text says practice');
    rm.x.setMode('normal');
    h.eq(rm.x.S.letters.join(''), daily, 'grid: normal returns to the daily board');
    h.eq(rm.x.S.banked, false, 'grid: normal starts fresh after practice');
    rm.x.setMode('practice');
    h.ok(rm.x.getPractice().start.join('') !== PR.start.join(''),
      'grid: re-entering practice rerolls the board');

    /* hard: same daily board, budget 6, gated on the global curve being online */
    const rh = h.boot('recycle-grid', EXP, { now: T0, store: {} });
    rh.x.setMode('hard');
    h.eq(rh.x.getMode(), 'normal', 'grid: hard waits for the probe');
    await h.flush();
    h.eq(rh.x.getMode(), 'hard', 'grid: hard unlocked when the curve answers');
    h.eq(rh.x.getBudget(), 6, 'grid: hard = 6 shifts');
    h.eq(rh.x.S.letters.join(''), rh.x.getPuzzle().start.join(''), 'grid: hard plays the same daily board');
    h.ok(rh.x.curBest() >= rh.x.getPuzzle().best, 'grid: hard optimum at least the normal optimum');
    for (let k = 0; k < 6; k++) rh.x.doShift('row', k % 5, 1);
    h.eq(rh.x.S.used, 6, 'grid: hard budget spent');
    rh.x.undo();
    h.eq(rh.x.S.used, 5, 'grid: undo works in hard mode');
    rh.env.els.btnBank.click();
    await h.flush();
    h.ok(rh.x.S.hardCounted, 'grid: hard bank counted for the bonus curve');
    h.eq(rh.x.S.stats.played, 0, 'grid: hard does not touch normal stats');
    h.eq(h.lastPost(rh.env).body.game, 'grid-hard', 'grid: hard posts to the bonus curve');

    /* rollover keeps the streak; a missed day resets it */
    const store2 = {};
    let r4 = h.boot('recycle-grid', EXP, { now: T0, store: store2 });
    r4.env.els.btnBank.click();
    await h.flush();
    h.ok(r4.x.S.banked && r4.x.S.stats.streak === 1, 'grid: day 0 banked, streak 1');
    r4 = h.boot('recycle-grid', EXP, { now: T1, store: store2 });
    h.eq(r4.x.S.day, 1, 'grid: day rolled');
    h.eq(r4.x.S.stats.streak, 1, 'grid: streak preserved after a bank');
    h.ok(r4.x.getPuzzle().best >= 8, 'grid: day 1 also generates a fat optimum');
    const store3 = {};
    let r5 = h.boot('recycle-grid', EXP, { now: T0, store: store3 });
    r5.env.els.btnBank.click();
    await h.flush();
    r5 = h.boot('recycle-grid', EXP, { now: T10, store: store3 });
    h.eq(r5.x.S.stats.streak, 0, 'grid: missed days reset the streak');

    /* a hard-only day does not keep the normal streak alive */
    const storeHO = {};
    let rho = h.boot('recycle-grid', EXP, { now: T0, store: storeHO });
    rho.x.setMode('hard');
    await h.flush();
    h.eq(rho.x.getMode(), 'hard', 'grid: hard-only day starts in hard');
    rho.env.els.btnBank.click();
    await h.flush();
    h.ok(rho.x.S.hardCounted && !rho.x.S.counted, 'grid: hard-only day counted nowhere normal');
    rho = h.boot('recycle-grid', EXP, { now: T1, store: storeHO });
    h.eq(rho.x.S.stats.streak, 0, 'grid: hard-only play does not preserve the streak');
    h.eq(rho.x.getMode(), 'normal', 'grid: a new day always boots into normal');
  }


  async function fermiTests(){
    const EXP = ['S', 'parseNum', 'scoreFor', 'friendly', 'shareText', 'Q'];
    const store = {};
    let r = h.boot('fermi', EXP, { now: T0, store });
    h.eq(r.x.parseNum('2.5 billion'), 2.5e9, 'fermi: parses "2.5 billion"');
    h.eq(r.x.parseNum('3e8'), 3e8, 'fermi: parses 3e8');
    h.eq(r.x.parseNum('1,000,000'), 1e6, 'fermi: parses commas');
    h.eq(r.x.parseNum('2tn'), 2e12, 'fermi: parses tn suffix');
    h.eq(r.x.scoreFor(2.5e9, 2.5e9), 3, 'fermi: exact = 3 points');
    h.eq(r.x.friendly(10100), '10 thousand', 'fermi: friendly(10100)');
    h.eq(r.x.friendly(1.2e16), '1.2 \u00d7 10^16', 'fermi: friendly(1.2e16) exponent form');
    h.eq(r.x.friendly(2000), '2 thousand', 'fermi: friendly(2000)');
    h.ok(r.x.Q.a > 0, 'fermi: day 0 answer set');
    r.env.els.guess.value = String(r.x.Q.a);
    r.env.els.btnGuess.click();
    h.ok(r.x.S.scored, 'fermi: scored');
    h.eq(r.x.S.score, 3, 'fermi: exact guess scores 3');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 3, 'fermi: curve value 3');
    r = h.boot('fermi', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'fermi: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'fermi: streak preserved');
  }

  async function siftTests(){
    const EXP = ['S', 'TILES', 'sel', 'shareText'];
    const store = {};
    let r = h.boot('sift', EXP, { now: T0, store });
    const catIdx = c => r.x.TILES.map((t, i) => ({ t, i }))
      .filter(o => o.t.cat === c).map(o => o.i);
    h.eq(catIdx(0).length, 3, 'sift: cat 0 has 3 tiles');
    /* one tile each from three different cats = a wrong trio */
    [catIdx(1)[0], catIdx(2)[0], catIdx(3)[0]].forEach(i => r.x.sel.add(i));
    r.env.els.btnSubmit.click();
    h.eq(r.x.S.mistakes, 1, 'sift: 1 mistake');
    h.eq(r.x.S.solvedCats.length, 0, 'sift: nothing solved');
    r.x.sel.clear();
    for (const c of [0, 1, 2, 3]){
      catIdx(c).forEach(i => r.x.sel.add(i));
      r.env.els.btnSubmit.click();
    }
    h.eq(r.x.S.status, 'won', 'sift: won with 1 mistake');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'sift: curve value 1');
    h.ok(r.x.shareText().indexOf('1 miss') >= 0, 'sift: share "1 miss"');
    /* Regression: the rollover guard used to check S.solvedAll, which is
       never set anywhere - so a winning streak reset every day. */
    r = h.boot('sift', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'sift: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'sift: streak preserved after win (regression)');
  }

  async function roundsTests(){
    const EXP = ['S', 'EV', 'shareText'];
    const store = {};
    let r = h.boot('rounds', EXP, { now: T0, store });
    h.eq(r.x.EV.y, 1215, 'rounds: day 0 = Magna Carta 1215');
    r.env.els.slider.value = '1215';
    r.env.els.btnLock.click();
    h.eq(r.x.S.status, 'won', 'rounds: won first try');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'rounds: curve value 1');
    r = h.boot('rounds', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'rounds: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'rounds: streak preserved');
    const s2 = {};
    r = h.boot('rounds', EXP, { now: T0, store: s2 });
    r.env.els.slider.value = '2020';
    for (let i = 0; i < 6; i++) r.env.els.btnLock.click();
    h.eq(r.x.S.status, 'lost', 'rounds: lost after 6 wrong');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 7, 'rounds: curve value 7 on loss');
  }

  async function traceTests(){
    const EXP = ['S', 'LADDER', 'climb', 'steps', 'shareText'];
    const store = {};
    let r = h.boot('trace', EXP, { now: T0, store });
    h.ok(r.x.LADDER.path.length >= 5, 'trace: ladder generated');
    for (const w of r.x.LADDER.path.slice(1)){
      r.env.els.next.value = w;
      r.x.climb();
    }
    h.eq(r.x.S.status, 'won', 'trace: won walking the optimal path');
    h.eq(r.x.steps(), r.x.LADDER.par, 'trace: steps = par');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, r.x.LADDER.par, 'trace: curve value = par');
    /* Regression: over <= 0 made "on par" unreachable; at exactly par the
       share text bragged "under par!". */
    h.ok(r.x.shareText().indexOf('on par') >= 0, 'trace: share "on par" (regression)');
    r = h.boot('trace', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'trace: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'trace: streak preserved');
    const s2 = {};
    r = h.boot('trace', EXP, { now: T0, store: s2 });
    r.env.els.btnGive.click();
    h.eq(r.x.S.status, 'lost', 'trace: give-up loses');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, r.x.steps() + 10, 'trace: give-up value = steps + 10');
  }

  async function lightboxTests(){
    const EXP = ['S', 'SOL', 'shareText'];
    const store = {};
    let r = h.boot('lightbox', EXP, { now: T0, store });
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) r.x.S.marks[i][j] = r.x.SOL[i][j] ? 1 : 0;
    r.env.els.btnDevelop.click();
    h.eq(r.x.S.status, 'won', 'lightbox: won clean');
    h.eq(r.x.S.mistakes, 0, 'lightbox: 0 mistakes');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'lightbox: curve value 0');
    const s2 = {};
    r = h.boot('lightbox', EXP, { now: T0, store: s2 });
    for (let i = 0; i < 4; i++){
      r.x.S.marks[0][0] = r.x.SOL[0][0] ? 0 : 1; /* force a contradiction */
      r.env.els.btnDevelop.click();
    }
    h.eq(r.x.S.status, 'lost', 'lightbox: lost after 4 wrong developments');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 4, 'lightbox: curve value 4 on loss');
    r = h.boot('lightbox', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'lightbox: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'lightbox: streak preserved');
  }

  async function sprintTests(){
    const EXP = ['S', 'targets', 'ANA4', 'ANA5', 'shareText'];
    const store = {};
    let r = h.boot('sprint', EXP, { now: T0, store });
    h.eq(r.x.targets.length, 5, 'sprint: 5 targets');
    const typed = [];
    for (let k = 0; k < 5; k++){
      const key = r.x.targets[k];
      const word = [...(key.length === 4 ? r.x.ANA4 : r.x.ANA5).get(key)][0];
      typed.push(word);
      r.env.els.guess.value = word;
      r.env.els.guess.dispatch('keydown', { key: 'Enter' });
    }
    h.eq(r.x.S.status, 'won', 'sprint: won all five');
    h.eq(r.x.S.solvedCount, 5, 'sprint: solvedCount 5');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 5, 'sprint: curve value 5');
    h.eq((r.x.S.words || []).join(','), typed.join(','), 'sprint: solved-word list matches typed');
    h.ok(r.x.shareText().indexOf('5/5') >= 0, 'sprint: share 5/5');
    r = h.boot('sprint', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'sprint: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'sprint: streak preserved');
  }

  async function cipherTests(){
    const EXP = ['S', 'SUB', 'Q', 'assign', 'solvedP', 'shareText', 'FREQ_ORDER'];
    const store = {};
    let r = h.boot('cipher', EXP, { now: T0, store });
    h.eq(r.x.Q.a, 'Franklin D. Roosevelt', 'cipher: day 0 author');
    for (const c of Object.keys(r.x.SUB.dec)){
      if (r.x.S.status !== 'playing') break; /* stop the moment it auto-wins */
      r.x.S.sel = c;
      r.x.assign(r.x.SUB.dec[c]);
    }
    h.eq(r.x.S.status, 'won', 'cipher: auto-won on complete decode');
    h.eq(r.x.S.hints, 0, 'cipher: no hints used');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'cipher: curve value 0');
    h.ok(r.x.shareText().indexOf('no hints') >= 0, 'cipher: share "no hints"');
    r = h.boot('cipher', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'cipher: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'cipher: streak preserved');
    /* hint button fills the most useful missing/wrong letter */
    const s2 = {};
    r = h.boot('cipher', EXP, { now: T0, store: s2 });
    r.env.els.btnHint.click();
    h.eq(r.x.S.hints, 1, 'cipher: hint used');
    const filled = Object.keys(r.x.S.map);
    h.ok(filled.length === 1 && r.x.S.map[filled[0]] === r.x.SUB.dec[filled[0]],
      'cipher: hint fills a correct letter');
    /* hidden-input path for mobile soft keyboards */
    const s3 = {};
    r = h.boot('cipher', EXP, { now: T0, store: s3 });
    const sl0 = r.x.FREQ_ORDER[0];
    r.x.S.sel = sl0;
    r.env.els.kbd.value = ' ' + r.x.SUB.dec[sl0];
    r.env.els.kbd.dispatch('input', {});
    h.eq(r.x.S.map[sl0], r.x.SUB.dec[sl0], 'cipher: soft keyboard assigns');
    r.x.S.sel = sl0;
    r.env.els.kbd.value = '';
    r.env.els.kbd.dispatch('input', {});
    h.ok(r.x.S.map[sl0] === undefined, 'cipher: empty input unassigns');
  }

  async function timelineTests(){
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
  }

  async function museumTests(){
    const EXP = ['S', 'EXHIBIT', 'matches', 'submitGuess', 'shareText'];
    const store = {};
    let r = h.boot('museum', EXP, { now: T0, store });
    h.eq(r.x.EXHIBIT.a, 'The Rosetta Stone', 'museum: day 0 = Rosetta');
    h.ok(r.x.matches('rosetta'), 'museum: alias "rosetta" matches');
    h.ok(r.x.matches('the rosetta stone'), 'museum: full name matches');
    h.ok(!r.x.matches('stone'), 'museum: "stone" alone does not match');
    h.ok(!r.x.matches('x'), 'museum: short junk rejected');
    r.env.els.guess.value = 'rosetta';
    r.x.submitGuess();
    h.eq(r.x.S.status, 'won', 'museum: won on clue 1');
    h.eq(r.x.S.resultClues, 1, 'museum: resultClues = 1');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'museum: curve value 1');
    h.ok(r.x.shareText().indexOf('clue 1') >= 0, 'museum: share "clue 1"');
    r = h.boot('museum', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'museum: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'museum: streak preserved');
    const s2 = {};
    r = h.boot('museum', EXP, { now: T0, store: s2 });
    for (let i = 0; i < 5; i++){
      r.env.els.guess.value = 'notit';
      r.x.submitGuess();
    }
    h.eq(r.x.S.status, 'lost', 'museum: lost after 5 wrong guesses');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 6, 'museum: curve value 6 on loss');
    /* day 10: accent transliteration */
    r = h.boot('museum', EXP, { now: T10, store: {} });
    h.ok(String(r.x.EXHIBIT.a).indexOf('tzi') >= 0, 'museum: day 10 = \u00d6tzi');
    h.ok(r.x.matches('\u00f6tzi'), 'museum: "\u00f6tzi" matches');
    h.ok(r.x.matches('iceman'), 'museum: "iceman" alias matches');
  }

  /* Cross-checks: every game's curve client must agree with the server's
     SPECS (which owns the better-direction and histogram edges), the shell
     pieces must all be present, and the landing page must link every game. */
  function crossChecks(){
    h.group('shell <-> server cross-check');
    const specRe = /"([\w-]+)":\s*\{"better":\s*"(high|low)",\s*"edges":\s*\[([^\]]+)\]/g;
    const specs = {};
    let m;
    while ((m = specRe.exec(serverPy)) !== null) specs[m[1]] = { better: m[2] };
    const serverKey = g => (g === 'recycle-rings' ? 'rings' : (g === 'recycle-grid' ? 'grid' : g));
    for (const g of GAMES){
      const html = readGame(g);
      const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
      const gName = (js.match(/const SYNC_GAME = '([^']+)'/) || [])[1];
      const gBetter = (js.match(/const SYNC_BETTER = '([^']+)'/) || [])[1];
      h.ok(!!gName && gName === serverKey(g), g + ': SYNC_GAME matches server key');
      h.ok(!!specs[gName], g + ': server has a SPECS entry');
      if (specs[gName]) h.ok(specs[gName].better === gBetter, g + ': client better direction matches server');
      /* shell wiring: every page loads the shell before its inline script */
      h.ok(html.indexOf('<script src="../shell/common.js"></script>') >= 0,
        g + ': loads shell/common.js');
      h.ok(html.indexOf('href="../shell/common.css"') >= 0, g + ': links shell/common.css');
      /* extraction completeness: the shared pieces must live in the shell now */
      h.ok(js.indexOf('America/New_York') === -1, g + ': day math extracted to shell');
      h.ok(js.indexOf('function renderBoard') === -1, g + ': renderBoard extracted to shell');
      h.ok(js.indexOf('JSON.parse(localStorage.getItem(KEY))') === -1, g + ': loadState extracted to shell');
      h.ok(js.indexOf('function toastMsg(') === -1 && js.indexOf('function toast(') === -1,
        g + ': toast extracted to shell');
      h.ok(js.indexOf('function syncBoard(value)') === -1, g + ': curve client extracted to shell');
      h.ok(js.indexOf('nextETMidnight() - Date.now()') === -1, g + ': countdown extracted to shell');
    }
    h.ok(Object.keys(specs).length >= GAMES.length,
      'server: SPECS parsed for all games (got ' + Object.keys(specs).length + ')');
    for (const g of GAMES) h.ok(landing.indexOf(g + '/') >= 0, 'landing: links to ' + g);

    /* the shell itself: the curve strings moved here from every game */
    const shell = readShared('bogus');
    h.ok(shell.indexOf('SYNC_UNIT') === -1, 'shell: no leftover SYNC_UNIT');
    h.ok(shell.indexOf('you-mark') >= 0, 'shell: curve you-mark present');
    h.ok(shell.indexOf('curve offline') >= 0, 'shell: offline grace present');
    h.ok(shell.indexOf('const SHELL') >= 0, 'shell: defines the SHELL module');
    h.ok(shell.indexOf('solo mode') >= 0, 'shell: air-gapped solo mode present');
    try { new Function(shell); h.ok(true, 'shell: compiles standalone'); }
    catch (e){ h.ok(false, 'shell: compiles standalone: ' + e.message); }

    /* the shared word bank: one copy on disk, referenced not inlined */
    const words = readShared('trace');
    h.ok(words.indexOf('const WORDS_EN = ') >= 0, 'words: bank defines WORDS_EN');
    h.ok(words.indexOf('ABOUT') >= 0 && words.indexOf('YOUTH') >= 0, 'words: bank populated');
    for (const g of ['trace', 'recycle-grid', 'recycle-rings']){
      const html = readGame(g);
      const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
      h.ok(html.indexOf('<script src="../assets/words-en.js"></script>') >= 0,
        g + ': loads the shared word bank');
      h.ok(js.indexOf('WORDS_EN') >= 0, g + ': references WORDS_EN');
      h.ok(js.indexOf('const DICT_SRC = "') === -1, g + ': word list no longer inlined');
    }
    h.ok(readGame('sprint').indexOf('DICT5_SRC') >= 0,
      'sprint: keeps its own anagram lists (different bank, by design)');

    /* the shared bank stays clean: uppercase 3-5 letter words, no dups */
    {
      const wm = words.match(/const WORDS_EN = "([^"]*)"/);
      h.ok(!!wm, 'words: bank string parses');
      if (wm){
        const list = wm[1].split(',');
        const bad = list.filter(w => !/^[A-Z]{3,5}$/.test(w));
        h.eq(bad.length, 0, 'words: every entry is A-Z, 3-5 letters' +
          (bad.length ? ' (e.g. ' + bad[0] + ')' : ''));
        h.eq(new Set(list).size, list.length, 'words: no duplicate entries');
      }
    }

    /* sprint's inline anagram banks stay clean: no typos, no wrong-length
       strays — junk entries could accept non-words as valid answers */
    {
      const html = readGame('sprint');
      const d4 = html.match(/const DICT_SRC = '([^']*)'/);
      const d5 = html.match(/const DICT5_SRC = '([^']*)'/);
      h.ok(!!d4 && !!d5, 'sprint: anagram banks parse');
      if (d4 && d5){
        const bad4 = d4[1].split(',').filter(w => !/^[A-Z]{4}$/.test(w));
        h.eq(bad4.length, 0, 'sprint: 4-letter bank is clean A-Z' +
          (bad4.length ? ' (e.g. ' + bad4[0] + ')' : ''));
        const bad5 = d5[1].split(',').filter(w => !/^[A-Z]{5}$/.test(w));
        h.eq(bad5.length, 0, 'sprint: 5-letter bank is clean A-Z' +
          (bad5.length ? ' (e.g. ' + bad5[0] + ')' : ''));
        const junk = ['BASON', 'YOUK', 'WRAY', 'TASS', 'GLANE', 'TICKY', 'WRITH', 'FATCH'];
        h.ok(junk.every(w => d4[1].indexOf(w) === -1 && d5[1].indexOf(w) === -1),
          'sprint: known typos stay gone (regression)');
      }
    }
  }

  /* Server-gated delivery: with the puzzle banks stripped from the page
     (the online bundle), each game must still boot and play on the puzzle
     served by the scores service. */
  async function serverGatedTests(){
    const GATED = {
      bogus: 'PUZZLES', 'well-actually': 'PUZZLES', rounds: 'EVENTS', fermi: 'QS',
      cipher: 'QUOTES', museum: 'MUSEUM', lightbox: 'DESIGNS', sift: 'BOARDS',
      timeline: 'EVENTS'
    };
    const strip = html => {
      let out = html;
      for (const v of Object.values(GATED))
        out = out.replace(new RegExp('const ' + v + ' = \\[([\\s\\S]*?)\\];'), 'const ' + v + ' = undefined;');
      return out;
    };
    const serve = (game, puzzle) => ({ game, day: 0, puzzle, today: 0 });

    /* rounds: slide to the served year */
    {
      const live = h.boot('rounds', ['S', 'EV'], { now: T0, store: {} });
      const served = serve('rounds', live.x.EV);
      const stripped = strip(readGame('rounds'));
      h.ok(!new RegExp('const EVENTS = \\[').test(stripped), 'gated: rounds bank stripped from the online page');
      const r = h.boot('rounds', ['S'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      h.ok(r.env.els.qtext.textContent.indexOf(served.puzzle.q) >= 0, 'gated: rounds served question rendered');
      r.env.els.slider.value = String(served.puzzle.y);
      r.env.els.btnLock.click();
      h.eq(r.x.S.status, 'won', 'gated: rounds won on the served year');
    }
    /* fermi: guess the served answer */
    {
      const live = h.boot('fermi', ['Q'], { now: T0, store: {} });
      const served = serve('fermi', live.x.Q);
      const stripped = strip(readGame('fermi'));
      h.ok(!new RegExp('const QS = \\[').test(stripped), 'gated: fermi bank stripped');
      const r = h.boot('fermi', ['S'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      r.env.els.guess.value = String(served.puzzle.a);
      r.env.els.btnGuess.click();
      h.ok(r.x.S.scored, 'gated: fermi scored on the served answer');
    }
    /* cipher: the served quote decodes clean */
    {
      const live = h.boot('cipher', ['Q'], { now: T0, store: {} });
      const served = serve('cipher', live.x.Q);
      const stripped = strip(readGame('cipher'));
      h.ok(!new RegExp('const QUOTES = \\[').test(stripped), 'gated: cipher bank stripped');
      const r = h.boot('cipher', ['S', 'SUB', 'assign'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      h.ok(r.env.els.author.textContent.indexOf(served.puzzle.a) >= 0, 'gated: cipher served author rendered');
      for (const c of Object.keys(r.x.SUB.dec)){
        if (r.x.S.status !== 'playing') break;
        r.x.S.sel = c;
        r.x.assign(r.x.SUB.dec[c]);
      }
      h.eq(r.x.S.status, 'won', 'gated: cipher auto-won on the served quote');
    }
    /* museum: the served exhibit matches its alias */
    {
      const live = h.boot('museum', ['EXHIBIT'], { now: T0, store: {} });
      const served = serve('museum', live.x.EXHIBIT);
      const stripped = strip(readGame('museum'));
      h.ok(!new RegExp('const MUSEUM = \\[').test(stripped), 'gated: museum bank stripped');
      const r = h.boot('museum', ['S', 'matches', 'submitGuess'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      const alias = served.puzzle.al[0];
      h.ok(r.x.matches(alias), 'gated: museum served alias matches');
      r.env.els.guess.value = alias;
      r.x.submitGuess();
      h.eq(r.x.S.status, 'won', 'gated: museum won on the served exhibit');
    }
    /* lightbox: develop the served design clean */
    {
      const live = h.boot('lightbox', ['DESIGN', 'SOL'], { now: T0, store: {} });
      const sol = live.x.SOL;
      const served = serve('lightbox', live.x.DESIGN);
      const stripped = strip(readGame('lightbox'));
      h.ok(!new RegExp('const DESIGNS = \\[').test(stripped), 'gated: lightbox bank stripped');
      const r = h.boot('lightbox', ['S'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) r.x.S.marks[i][j] = sol[i][j] ? 1 : 0;
      r.env.els.btnDevelop.click();
      h.eq(r.x.S.status, 'won', 'gated: lightbox won on the served design');
      h.eq(r.x.S.mistakes, 0, 'gated: lightbox clean film');
    }
    /* sift: solve the served board */
    {
      const live = h.boot('sift', ['BOARD', 'TILES'], { now: T0, store: {} });
      const served = serve('sift', live.x.BOARD);
      const stripped = strip(readGame('sift'));
      h.ok(!new RegExp('const BOARDS = \\[').test(stripped), 'gated: sift bank stripped');
      const r = h.boot('sift', ['S', 'TILES', 'sel'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      const catIdx = c => r.x.TILES.map((t, i) => ({ t, i }))
        .filter(o => o.t.cat === c).map(o => o.i);
      h.eq(catIdx(0).length, 3, 'gated: sift served board has groups of 3');
      for (const c of [0, 1, 2, 3]){
        catIdx(c).forEach(i => r.x.sel.add(i));
        r.env.els.btnSubmit.click();
      }
      h.eq(r.x.S.status, 'won', 'gated: sift won on the served board');
    }
    /* timeline: the served events render in the lane */
    {
      const live = h.boot('timeline', ['EVO'], { now: T0, store: {} });
      const served = serve('timeline', { events: live.x.EVO });
      const stripped = strip(readGame('timeline'));
      h.ok(!new RegExp('const EVENTS = \\[').test(stripped), 'gated: timeline bank stripped');
      const r = h.boot('timeline', ['PICK'], { now: T0, store: {}, servePuzzle: served, html: stripped });
      await h.flush();
      const needle = served.puzzle.events[0].q;
      const found = Object.keys(r.env.els).some(k =>
        String(r.env.els[k].innerHTML || '').indexOf(needle) >= 0 ||
        String(r.env.els[k].textContent || '').indexOf(needle) >= 0);
      h.ok(found, 'gated: timeline served events rendered');
    }
    /* the exported store must agree with each game's own offline pick */
    if (readStore){
      const store = JSON.parse(readStore());
      const live = h.boot('timeline', ['EVO'], { now: T0, store: {} });
      const ev0 = store.timeline.picks[0].map(i => store.timeline.bank[i]);
      h.ok(JSON.stringify(live.x.EVO) === JSON.stringify(ev0),
        'gated: exported timeline picks[0] match the offline day-0 events');
      const rEv = h.boot('rounds', ['EV'], { now: T0, store: {} });
      h.ok(JSON.stringify(rEv.x.EV) === JSON.stringify(store.rounds[0]),
        'gated: exported rounds bank matches the inline bank');
    }
  }

  const scenarios = [
    ['bogus', bogusTests],
    ['well-actually', wellActuallyTests],
    ['recycle-rings', ringsTests],
    ['recycle-grid', gridTests],
    ['fermi', fermiTests],
    ['sift', siftTests],
    ['rounds', roundsTests],
    ['trace', traceTests],
    ['lightbox', lightboxTests],
    ['sprint', sprintTests],
    ['cipher', cipherTests],
    ['timeline', timelineTests],
    ['museum', museumTests],
    ['server-gated', serverGatedTests]
  ];
  for (const [name, fn] of scenarios){
    h.group(name);
    try { await fn(); }
    catch (e){
      const c = h.results[h.results.length - 1];
      c.fail++;
      c.failures.push('EXCEPTION: ' + (e && e.message ? e.message : String(e)));
    }
  }
  crossChecks();

  const s = h.summary();
  return { summary: s.lines, pass: s.pass, fail: s.fail };
}

module.exports = { main, GAMES };

/* CLI entry: read the repo files with fs, run, exit nonzero on failure. */
if (typeof require === 'function' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { createHarness } = require('./harness');
  const ROOT = path.join(__dirname, '..');
  const SHELL_JS = fs.readFileSync(path.join(ROOT, 'shell', 'common.js'), 'utf8');
  const WORDS_JS = fs.readFileSync(path.join(ROOT, 'assets', 'words-en.js'), 'utf8');
  main(
    createHarness,
    g => fs.readFileSync(path.join(ROOT, g, 'index.html'), 'utf8'),
    () => fs.readFileSync(path.join(ROOT, 'scores', 'server.py'), 'utf8'),
    () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    g => SHELL_JS + (g === 'trace' || g === 'recycle-grid' || g === 'recycle-rings' ? '\n' + WORDS_JS : ''),
    () => {
      try {
        const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scores', 'timeline', 'puzzles.json'), 'utf8'));
        const rounds = JSON.parse(fs.readFileSync(path.join(ROOT, 'scores', 'rounds', 'puzzles.json'), 'utf8'));
        return JSON.stringify({ timeline, rounds });
      } catch (e){ return null; }
    }
  ).then(out => {
    console.log(out.summary);
    process.exit(out.fail ? 1 : 0);
  }).catch(e => { console.error(e); process.exit(1); });
}

