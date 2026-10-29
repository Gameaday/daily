/* sprint - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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
    const s3 = {};
    r = h.boot('sprint', EXP, { now: T0, store: s3 });
    h.eq(r.env.els.btnShuffle.style.display, 'none', 'sprint: shuffle hidden before twenty seconds');
    const before = r.env.els.scramble.textContent;
    r.env.els.btnShuffle.click();
    h.ok(r.env.els.scramble.textContent !== before, 'sprint: shuffle re-scrambles the word');
    h.eq([...r.env.els.scramble.textContent].sort().join(''), [...before].sort().join(''), 'sprint: shuffle keeps the same letters');
}

module.exports = { name: 'sprint', run };
