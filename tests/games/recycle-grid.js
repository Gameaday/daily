/* recycle-grid - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them.
   Rewritten for the free-shift rules: one shared budget, any row or column,
   any order - and the exact ceiling is the full reachable-set walk. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'PUZZLE', 'MODES', 'bestPossible', 'exactBest', 'doShift', 'undo', 'restart',
      'setMode', 'applyRows', 'applyCols', 'VEC_BY_COST', 'shareText', 'findWords',
      'getPuzzle', 'getPractice', 'getBudget', 'getMode', 'curBest', 'rotRow', 'rotCol', 'revertBest'];
    const store = {};
    let r = h.boot('recycle-grid', EXP, { now: T0, store });
    h.eq(r.x.MODES.practice, 4, 'grid: practice = 4 shifts');
    h.eq(r.x.MODES.normal, 5, 'grid: normal = 5 shifts');
    h.eq(r.x.MODES.hard, 6, 'grid: hard = 6 shifts');
    h.eq(r.x.getMode(), 'normal', 'grid: defaults to normal');
    h.eq(r.x.getBudget(), 5, 'grid: normal budget = 5');
    const P = r.x.getPuzzle();
    h.ok(!!P && P.start.length === 25, 'grid: puzzle generated');
    h.ok(P.best >= 8, 'grid: family best >= 8 (got ' + P.best + ')');
    const w0 = r.x.findWords(P.start).length;
    h.ok(w0 <= P.best - 2, 'grid: start is lean (' + w0 + ' words vs best ' + P.best + ')');
    h.eq(r.x.bestPossible(P.start.slice(), r.x.getBudget()), P.best, 'grid: the family search recomputes exactly');
    h.eq(r.x.curBest(), P.best, 'grid: the ceiling starts at the family bound');

    /* shift directions, pinned letter by letter: each arrow must move its
       line the way its glyph promises, and a shift never leaks across lines */
    const b = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
    r.x.rotRow(b, 0, -1);
    h.eq(b.slice(0, 5).join(''), 'BCDEA', 'grid: a row shift left moves the row left');
    r.x.rotRow(b, 0, 1);
    h.eq(b.slice(0, 5).join(''), 'ABCDE', 'grid: a row shift right moves the row right');
    r.x.rotCol(b, 0, 1);
    h.eq([b[0], b[5], b[10], b[15], b[20]].join(''), 'UAFKP', 'grid: a column shift down moves the column down');
    r.x.rotCol(b, 0, -1);
    h.eq(b.join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXY', 'grid: shifts touch their own line only');

    /* free play: rows and columns spend the same shared budget */
    const L0 = r.x.S.start.slice();
    r.x.doShift('row', 0, -1);
    h.eq(r.x.S.letters[1], L0[2], 'grid: the left arrow sends the row left');
    h.eq(r.x.S.letters[5], L0[5], 'grid: a row arrow leaves the other rows alone');
    r.x.doShift('col', 2, 1);
    h.eq(r.x.S.used, 2, 'grid: a column shift spends the same budget, no phases');
    r.x.undo();
    h.eq(r.x.S.used, 1, 'grid: undo refunds across axes');
    r.x.undo();
    h.eq(r.x.S.used, 0, 'grid: undo reaches back to the start');
    h.ok(r.x.S.start.every((c, i) => c === r.x.S.letters[i]), 'grid: undo restores the board');

    /* the ceiling: best possible hides while a counted game is live */
    h.eq(r.env.els.bestwrap.style.display, 'none', 'grid: the ceiling hides while the daily game is live');

    /* the auto-stash: the best board is never more than one click away */
    const peak = r.x.S.bestSnap.words;
    r.x.doShift('row', 4, 1);
    h.ok(r.x.S.bestSnap.words >= peak, 'grid: the stash never goes down');
    r.x.revertBest();
    h.eq(r.x.S.letters.join(''), r.x.S.bestSnap.letters.join(''), 'grid: revert lands on the stashed board');
    h.eq(r.x.S.moves.length, r.x.S.bestSnap.moves.length, 'grid: revert restores the move list');
    h.eq(r.x.S.used, r.x.S.moves.length, 'grid: used follows the restored moves');
    r.x.restart();

    /* budget guards: mixed shifts, hard stop at the budget, free restart */
    for (let k = 0; k < 5; k++) r.x.doShift(k % 2 ? 'row' : 'col', k, 1);
    h.eq(r.x.S.used, 5, 'grid: budget spent with mixed shifts');
    r.x.doShift('row', 0, 1);
    h.eq(r.x.S.used, 5, 'grid: no shifts past the budget');
    r.x.restart();
    h.eq(r.x.S.used, 0, 'grid: restart is free and full');

    /* the exact ceiling: free play reaches every product of budget
       single-line shifts, so the ceiling is the full reachable-set walk.
       Cross-check it against an independent dumb BFS at small budgets,
       then trust it at five. */
    h.eq(r.x.exactBest(P.start.slice(), 0).best, r.x.findWords(P.start).length,
      'grid: exact at budget 0 is the start board');
    const startStr = P.start.join('');
    const dumbBest = (budget) => {
      const seen = new Set([startStr]);
      let frontier = [startStr];
      let best = r.x.findWords(P.start).length;
      for (let d = 0; d < budget; d++){
        const next = [];
        for (const bk of frontier){
          const bd = bk.split('');
          for (let i = 0; i < 5; i++){
            for (const dir of [-1, 1]){
              const t1 = bd.slice();
              r.x.rotRow(t1, i, dir);
              const k1 = t1.join('');
              if (!seen.has(k1)){ seen.add(k1); next.push(k1); }
              const t2 = bd.slice();
              r.x.rotCol(t2, i, dir);
              const k2 = t2.join('');
              if (!seen.has(k2)){ seen.add(k2); next.push(k2); }
            }
          }
        }
        for (const k of next) best = Math.max(best, r.x.findWords(k.split('')).length);
        frontier = next;
      }
      return best;
    };
    h.eq(r.x.exactBest(P.start.slice(), 3).best, dumbBest(3), 'grid: the exact walk matches a dumb BFS at 3');
    h.eq(r.x.exactBest(P.start.slice(), 4).best, dumbBest(4), 'grid: the exact walk matches a dumb BFS at 4');
    const EX = r.x.exactBest(P.start.slice(), 5);
    h.ok(EX.best >= P.best, 'grid: free play reaches at least the family optimum');
    h.eq(r.x.findWords(EX.argmax).length, EX.best, 'grid: the argmax board truly reaches the exact ceiling');

    /* random legal play never beats the exact ceiling */
    for (let t = 0; t < 25; t++){
      let seed = 20261027 + t * 7919;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const rb = P.start.slice();
      const n = Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++){
        if (rnd() < 0.5) r.x.rotRow(rb, Math.floor(rnd() * 5), rnd() < 0.5 ? -1 : 1);
        else r.x.rotCol(rb, Math.floor(rnd() * 5), rnd() < 0.5 ? -1 : 1);
      }
      h.ok(r.x.findWords(rb).length <= EX.best, 'grid: random play ' + t + ' never beats the exact ceiling');
    }

    /* bank the exact argmax: perfect flag + share badge + curve */
    const r3 = h.boot('recycle-grid', EXP, { now: T0, store: {} });
    const P3 = r3.x.getPuzzle();
    h.eq(P3.start.join(''), P.start.join(''), 'grid: same day is deterministic');
    r3.x.S.bestExact = EX.best;   /* the background walk would land here; pin it */
    r3.x.S.letters = EX.argmax.slice();
    h.eq(r3.x.findWords(r3.x.S.letters).length, EX.best, 'grid: the argmax board is on the table');
    r3.env.els.btnBank.click();
    await h.flush();
    h.ok(r3.x.S.banked, 'grid: banked');
    h.eq(r3.env.els.bestwrap.style.display, '', 'grid: banking reveals the ceiling');
    h.ok(r3.env.els.verdict.textContent.indexOf('best possible was') < 0, 'grid: a perfect bank does not restate the ceiling');
    h.ok(r3.x.S.counted, 'grid: day stats counted once');
    h.eq(r3.x.S.stats.perfect, 1, 'grid: perfect bank counted');
    h.ok(r3.x.shareText().indexOf('perfect') >= 0, 'grid: share shows the perfect badge');
    h.eq(h.lastPost(r3.env).body.game, 'grid', 'grid: normal posts to the grid curve');
    h.eq(h.lastPost(r3.env).body.value, EX.best, 'grid: curve value = the exact ceiling');

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
    h.eq(rm.env.els.bestwrap.style.display, '', 'grid: practice shows the ceiling live');
    h.eq(String(rm.env.els.best.textContent), String(rm.x.curBest()), 'grid: the ceiling tracks the practice board');
    h.ok(rm.x.curBest() >= PR.best, 'grid: the exact practice ceiling covers the family bound');
    h.ok(rm.x.S.bestSnap && rm.x.S.bestSnap.letters.join('') === PR.start.join(''), 'grid: the stash resets with the practice board');
    for (let k = 0; k < 4; k++) rm.x.doShift(k % 2 ? 'row' : 'col', k % 5, 1);
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
    h.eq(rh.env.els.bestwrap.style.display, 'none', 'grid: hard hides the ceiling while it is live');
    h.eq(rh.x.S.letters.join(''), rh.x.getPuzzle().start.join(''), 'grid: hard plays the same daily board');
    h.ok(rh.x.curBest() >= rh.x.getPuzzle().best, 'grid: hard ceiling at least the normal optimum');
    for (let k = 0; k < 6; k++) rh.x.doShift(k % 2 ? 'row' : 'col', k % 5, 1);
    h.eq(rh.x.S.used, 6, 'grid: hard budget spent');
    rh.x.undo();
    h.eq(rh.x.S.used, 5, 'grid: undo works in hard mode');
    rh.env.els.btnBank.click();
    await h.flush();
    h.ok(rh.x.S.hardCounted, 'grid: hard bank counted for the bonus curve');
    h.eq(rh.x.S.stats.played, 0, 'grid: hard does not touch normal stats');
    h.eq(h.lastPost(rh.env).body.game, 'grid-hard', 'grid: hard posts to the bonus curve');
    h.ok(typeof rh.x.S.bestExactHard === 'number' && rh.x.S.bestExactHard >= rh.x.S.bestHard,
      'grid: the exact hard walk finished and covers the family bound');

    /* rollover keeps the streak; a missed day resets it */
    const store2 = {};
    let r4 = h.boot('recycle-grid', EXP, { now: T0, store: store2 });
    r4.env.els.btnBank.click();
    await h.flush();
    h.ok(r4.x.S.banked && r4.x.S.stats.streak === 1, 'grid: day 0 banked, streak 1');
    h.ok(r4.env.els.verdict.textContent.indexOf('best possible was') >= 0, 'grid: a non-perfect bank names the ceiling');
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
