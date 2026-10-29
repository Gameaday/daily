/* rounds - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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

module.exports = { name: 'rounds', run };
