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
    r.env.els.slider.value = '1750';
    r.env.els.btnUp.click();
    h.eq(+r.env.els.slider.value, 1751, 'rounds: the + stepper moves one year');
    r.env.els.btnDown.click();
    r.env.els.btnDown.click();
    h.eq(+r.env.els.slider.value, 1749, 'rounds: the - stepper moves one year');
    r.env.els.slider.value = '2020';
    for (let i = 0; i < 6; i++) r.env.els.btnLock.click();
    h.eq(r.x.S.status, 'lost', 'rounds: lost after 6 wrong');
    h.eq(r.env.els.guesses.innerHTML.indexOf('years off') === -1, true, 'rounds: no years-off leak');
    h.eq(r.env.els.guesses.innerHTML.indexOf('go earlier') !== -1, true, 'rounds: direction still shown');
    h.eq(r.env.els.guesses.innerHTML.indexOf('wrong century') !== -1, true, 'rounds: century nudge shown');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 7, 'rounds: curve value 7 on loss');
}

module.exports = { name: 'rounds', run };
