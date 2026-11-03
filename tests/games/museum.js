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
    const p = h.lastPost(r.env).body;
    h.eq(p.status, 'won', 'museum: the won status rides the wire');
    h.eq(p.answer, 'rosetta', 'museum: the typed name rides the wire');
    h.eq(p.meta.clues, 1, 'museum: one clue rides the wire');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'museum: the named-cold star rides the share');
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
    const q = h.lastPost(r.env).body;
    h.eq(q.status, 'lost', 'museum: a loss posts the lost status');
    h.eq(q.answer, '', 'museum: a loss posts no name');
    /* day 10: accent transliteration */
    r = h.boot('museum', EXP, { now: T10, store: {} });
    h.ok(String(r.x.EXHIBIT.a).indexOf('tzi') >= 0, 'museum: day 10 = \u00d6tzi');
    h.ok(r.x.matches('\u00f6tzi'), 'museum: "\u00f6tzi" matches');
    h.ok(r.x.matches('iceman'), 'museum: "iceman" alias matches');

    /* --- dealt: the live day ships the clues without the name, so the
       guess travels to the session and the session meters the clues --- */
    const muLive = h.boot('museum', EXP, { now: T0, store: {} });
    const muFull = muLive.x.EXHIBIT;
    h.eq(muFull.a, 'The Rosetta Stone', 'museum dealt: the banked day still carries its name');
    const muServed = { game: 'museum', day: 0, today: 0, puzzle: { c: muFull.c } };
    let muClueN = 0;
    const muDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'm1', today: 0, puzzle: muServed.puzzle } };
      if (body.move.clue){
        if (muClueN >= 4) return { status: 400, body: { error: 'no more clues' } };
        muClueN++;
        return { status: 200, body: { verdict: 'clue', clueIdx: muClueN } };
      }
      const muNorm = s => String(s || '').toLowerCase().replace(/^the /, '').trim();
      if ([muFull.a].concat(muFull.al).some(x => muNorm(body.move.name) === muNorm(x)))
        return { status: 200, body: { verdict: 'won',
          reveal: { a: muFull.a, w: muFull.w } } };
      if (muClueN < 4){
        muClueN++;
        return { status: 200, body: { verdict: 'miss', clueIdx: muClueN } };
      }
      return { status: 200, body: { verdict: 'lost',
        reveal: { a: muFull.a, w: muFull.w } } };
    };
    const muDst = {};
    const muD = h.boot('museum', EXP,
      { now: T0, store: muDst, servePuzzle: muServed, stubBanks: true, serveDealt: muDealer });
    await h.flush();
    h.ok(String(muD.env.els.plaque.innerHTML).indexOf(muFull.c[0]) >= 0,
      'museum dealt: the served clues rendered');
    h.ok(!('a' in muServed.puzzle) && !('al' in muServed.puzzle),
      'museum dealt: the served day never ships its name');
    muD.env.els.guess.value = 'notit';
    muD.x.submitGuess();
    await h.flush();
    h.eq(muD.x.S.clueIdx, 1, 'museum dealt: a wrong name buys the next clue from the session');
    muD.env.els.btnClue.click();
    await h.flush();
    h.eq(muD.x.S.clueIdx, 2, 'museum dealt: a clue request meters itself on the session');
    muD.env.els.guess.value = muFull.al[0];
    muD.x.submitGuess();
    await h.flush();
    h.eq(muD.x.S.status, 'won', 'museum dealt: won on the session');
    h.eq(muD.x.S.nonce, 'm1', 'museum dealt: the session is held');
    const muPost = h.lastPost(muD.env);
    h.eq(muPost.body.nonce, 'm1', 'museum dealt: the evidence names the session');
    h.eq(muPost.body.meta.clues, 3, 'museum dealt: the evidence carries the session meter');
    /* a reload keeps the won day and retells the name that never shipped */
    const muR = h.boot('museum', EXP,
      { now: T0, store: muDst, servePuzzle: muServed, stubBanks: true });
    await h.flush();
    h.eq(muR.x.S.status, 'won', 'museum dealt: a reload keeps the won day');
    h.eq(muR.env.els.answer.textContent, muFull.a,
      'museum dealt: the reload retells the name it never shipped');
    /* an archive replay keeps the local path: the bank still carries the name */
    const muRe = h.boot('museum', EXP, { now: T1, store: {}, search: '?d=0' });
    muRe.env.els.guess.value = muRe.x.EXHIBIT.al[0];
    muRe.x.submitGuess();
    h.eq(muRe.x.S.status, 'won', 'museum dealt: the replay wins locally');
    await h.flush();
    h.eq(muRe.env.fetchLog.length, 0, 'museum dealt: a replay posts nothing');
}

module.exports = { name: 'museum', run };
