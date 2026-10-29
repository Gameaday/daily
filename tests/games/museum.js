/* museum - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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

module.exports = { name: 'museum', run };
