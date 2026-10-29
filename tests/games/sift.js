/* sift - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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

module.exports = { name: 'sift', run };
