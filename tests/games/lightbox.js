/* lightbox - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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

module.exports = { name: 'lightbox', run };
