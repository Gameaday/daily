/* recycle-grid - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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

module.exports = { name: 'recycle-grid', run };
