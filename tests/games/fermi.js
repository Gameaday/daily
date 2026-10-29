/* fermi - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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

module.exports = { name: 'fermi', run };
