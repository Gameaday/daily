/* well-actually - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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
    h.eq(h.lastPost(r.env).body.status, 'won', 'well-actually: the win posts the won status');
    h.eq(h.lastPost(r.env).body.answer.picks.join(), '1', 'well-actually: the evidence carries the picks');
    h.eq(h.lastPost(r.env).body.answer.typed, 'Leonardo', 'well-actually: the evidence carries the typed correction');
    h.ok(!('value' in h.lastPost(r.env).body), 'well-actually: the client never names its own score');
    /* Regression: a reload used to lose the curve because syncBoard only
       fired from finish(), which does not run again for a finished day.
       Now the reload reads the curve back with a GET instead of posting,
       so the count for the day never moves twice. */
    r = h.boot('well-actually', EXP, { now: T0, store });
    await h.flush();
    h.ok(r.env.fetchLog.length === 0,
      'well-actually: a reload re-tallies nothing (regression)');
    h.ok(String(r.env.els.curve.innerHTML).indexOf('cyou') >= 0,
      'well-actually: the reload still renders the curve');
    r = h.boot('well-actually', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'well-actually: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'well-actually: streak preserved');
}

module.exports = { name: 'well-actually', run };
