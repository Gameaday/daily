/* End-to-end behavioral tests for all 13 warmup games, plus cross-checks
   between the games' curve clients and scores/server.py.

   Every scenario boots the real game script (no browser), plays it to a
   win or loss, checks the value posted to the team curve, then "reboots"
   the next day with the same localStorage to prove streaks survive
   rollover. Regression tests for the fixed bugs are marked inline.

   Zero dependencies: node tests/run.js (exit 1 on any failure). */
'use strict';

const GAMES = ['bogus', 'well-actually', 'recycle-rings', 'recycle-grid', 'fermi',
  'sift', 'rounds', 'trace', 'lightbox', 'sprint', 'cipher', 'timeline', 'museum'];

/* Fixed days: EPOCH_KEY is 2026-10-27, so noon UTC on that date is day 0
   no matter the runner's real clock (the harness Date is pinned per boot). */
const T0 = Date.parse('2026-10-27T12:00:00Z');
const T1 = T0 + 86400000;
const T10 = T0 + 10 * 86400000;

async function main(createHarness, readGame, readServer, readLanding){
  const h = createHarness(readGame);
  const serverPy = readServer();
  const landing = readLanding();

  async function bogusTests(){
    const EXP = ['S', 'puzzle', 'pick', 'shareText', 'baseScore'];
    const store = {};
    let r = h.boot('bogus', EXP, { now: T0, store });
    h.eq(r.x.puzzle.l, 5, 'bogus: day 0 lie is statement 5');
    r.x.pick(r.x.puzzle.l);
    h.eq(r.x.S.status, 'won', 'bogus: won');
    h.eq(r.x.baseScore(), 3, 'bogus: 3/3');
    h.ok(r.x.shareText().indexOf('3/3') >= 0, 'bogus: share 3/3');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 3, 'bogus: curve value 3');
    h.eq(r.x.S.stats.streak, 1, 'bogus: streak 1');
    r = h.boot('bogus', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'bogus: day rolled to 1');
    h.eq(r.x.S.stats.streak, 1, 'bogus: streak preserved after win');
    h.eq(r.x.S.status, 'playing', 'bogus: new day is playable');
    const s2 = {};
    r = h.boot('bogus', EXP, { now: T0, store: s2 });
    r.x.pick(0); r.x.pick(1); r.x.pick(2);
    h.eq(r.x.S.status, 'lost', 'bogus: lost after 3 wrong');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'bogus: curve value 0 on loss');
    h.eq(r.x.S.stats.dist[0], 1, 'bogus: dist[0] ticked');
  }

  async function wellActuallyTests(){
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
    h.eq(h.lastPost(r.env).body.value, 4, 'well-actually: curve value 4');
    /* Regression: a reload used to lose the curve because syncBoard only
       fired from finish(), which does not run again for a finished day. */
    r = h.boot('well-actually', EXP, { now: T0, store });
    await h.flush();
    h.ok(r.env.fetchLog.length >= 1 && h.lastPost(r.env).body.value === 4,
      'well-actually: curve re-fires on reload (regression)');
    r = h.boot('well-actually', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'well-actually: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'well-actually: streak preserved');
  }

  async function ringsTests(){
    const EXP = ['S', 'PUZZLE', 'spin', 'topLetter', 'shareText'];
    const store = {};
    let r = h.boot('recycle-rings', EXP, { now: T0, store });
    h.ok(!!r.x.PUZZLE && /^[A-Z]{3}$/.test(r.x.PUZZLE.word), 'rings: puzzle generated');
    for (let i = 0; i < 3; i++){
      let guard = 0;
      while (r.x.topLetter(i) !== r.x.PUZZLE.word[i] && guard++ < 30) r.x.spin(i, 1);
      h.eq(r.x.topLetter(i), r.x.PUZZLE.word[i], 'rings: ring ' + i + ' aligned');
    }
    h.ok(r.x.S.won, 'rings: won after aligning');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'rings: value 0s (instant clock)');
    h.ok(r.x.shareText().indexOf('spins') >= 0, 'rings: share text mentions spins');
    r = h.boot('recycle-rings', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'rings: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'rings: streak preserved');
  }

  async function gridTests(){
    const EXP = ['S', 'shiftRow', 'findWords', 'shareText'];
    const store = {};
    let r = h.boot('recycle-grid', EXP, { now: T0, store });
    const count0 = r.x.findWords(r.x.S.letters).length;
    h.ok(count0 >= 3, 'grid: genBoard guarantees >= 3 words (got ' + count0 + ')');
    r.env.els.btnBank.click();
    await h.flush();
    h.ok(r.x.S.banked, 'grid: banked');
    h.eq(h.lastPost(r.env).body.value, count0, 'grid: curve value = word count');
    r = h.boot('recycle-grid', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'grid: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'grid: streak preserved');
    const s2 = {};
    r = h.boot('recycle-grid', EXP, { now: T0, store: s2 });
    const before = r.x.S.letters.slice(0, 5).join('');
    r.x.shiftRow(0, -1);
    h.eq(r.x.S.letters.slice(0, 5).join(''), before.slice(1) + before[0],
      'grid: shiftRow wraps around the row');
  }

  async function fermiTests(){
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

  async function siftTests(){
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

  async function roundsTests(){
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

  async function traceTests(){
    const EXP = ['S', 'LADDER', 'climb', 'steps', 'shareText'];
    const store = {};
    let r = h.boot('trace', EXP, { now: T0, store });
    h.ok(r.x.LADDER.path.length >= 5, 'trace: ladder generated');
    for (const w of r.x.LADDER.path.slice(1)){
      r.env.els.next.value = w;
      r.x.climb();
    }
    h.eq(r.x.S.status, 'won', 'trace: won walking the optimal path');
    h.eq(r.x.steps(), r.x.LADDER.par, 'trace: steps = par');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, r.x.LADDER.par, 'trace: curve value = par');
    /* Regression: over <= 0 made "on par" unreachable; at exactly par the
       share text bragged "under par!". */
    h.ok(r.x.shareText().indexOf('on par') >= 0, 'trace: share "on par" (regression)');
    r = h.boot('trace', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'trace: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'trace: streak preserved');
    const s2 = {};
    r = h.boot('trace', EXP, { now: T0, store: s2 });
    r.env.els.btnGive.click();
    h.eq(r.x.S.status, 'lost', 'trace: give-up loses');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, r.x.steps() + 10, 'trace: give-up value = steps + 10');
  }

  async function lightboxTests(){
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

  async function sprintTests(){
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
  }

  async function cipherTests(){
    const EXP = ['S', 'SUB', 'Q', 'assign', 'solvedP', 'shareText', 'FREQ_ORDER'];
    const store = {};
    let r = h.boot('cipher', EXP, { now: T0, store });
    h.eq(r.x.Q.a, 'Franklin D. Roosevelt', 'cipher: day 0 author');
    for (const c of Object.keys(r.x.SUB.dec)){
      if (r.x.S.status !== 'playing') break; /* stop the moment it auto-wins */
      r.x.S.sel = c;
      r.x.assign(r.x.SUB.dec[c]);
    }
    h.eq(r.x.S.status, 'won', 'cipher: auto-won on complete decode');
    h.eq(r.x.S.hints, 0, 'cipher: no hints used');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'cipher: curve value 0');
    h.ok(r.x.shareText().indexOf('no hints') >= 0, 'cipher: share "no hints"');
    r = h.boot('cipher', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'cipher: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'cipher: streak preserved');
    /* hint button fills the most useful missing/wrong letter */
    const s2 = {};
    r = h.boot('cipher', EXP, { now: T0, store: s2 });
    r.env.els.btnHint.click();
    h.eq(r.x.S.hints, 1, 'cipher: hint used');
    const filled = Object.keys(r.x.S.map);
    h.ok(filled.length === 1 && r.x.S.map[filled[0]] === r.x.SUB.dec[filled[0]],
      'cipher: hint fills a correct letter');
    /* hidden-input path for mobile soft keyboards */
    const s3 = {};
    r = h.boot('cipher', EXP, { now: T0, store: s3 });
    const sl0 = r.x.FREQ_ORDER[0];
    r.x.S.sel = sl0;
    r.env.els.kbd.value = ' ' + r.x.SUB.dec[sl0];
    r.env.els.kbd.dispatch('input', {});
    h.eq(r.x.S.map[sl0], r.x.SUB.dec[sl0], 'cipher: soft keyboard assigns');
    r.x.S.sel = sl0;
    r.env.els.kbd.value = '';
    r.env.els.kbd.dispatch('input', {});
    h.ok(r.x.S.map[sl0] === undefined, 'cipher: empty input unassigns');
  }

  async function timelineTests(){
    const EXP = ['S', 'PICK', 'SORTED', 'shareText'];
    const store = {};
    let r = h.boot('timeline', EXP, { now: T0, store });
    h.eq(r.x.PICK.length, 5, 'timeline: 5 events picked');
    r.x.S.order = r.x.SORTED.map(idx => r.x.PICK.indexOf(idx));
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'timeline: won in one check');
    h.eq(r.x.S.checks, 1, 'timeline: checks = 1');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'timeline: curve value 1');
    h.ok(r.x.shareText().indexOf('1 check') >= 0, 'timeline: share "1 check"');
    r = h.boot('timeline', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'timeline: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'timeline: streak preserved');
    const s2 = {};
    r = h.boot('timeline', EXP, { now: T0, store: s2 });
    r.env.els.btnGiveUp.click();
    h.eq(r.x.S.status, 'gaveup', 'timeline: gaveup status');
    h.eq(r.x.S.order.join(','), r.x.SORTED.map(i => r.x.PICK.indexOf(i)).join(','),
      'timeline: give-up sorts the lane');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 9, 'timeline: curve value 9 on give-up');
  }

  async function museumTests(){
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

  /* Cross-checks: every game's curve client must agree with the server's
     SPECS (which owns the better-direction and histogram edges), the shell
     pieces must all be present, and the landing page must link every game. */
  function crossChecks(){
    h.group('shell <-> server cross-check');
    const specRe = /"([\w-]+)":\s*\{"better":\s*"(high|low)",\s*"edges":\s*\[([^\]]+)\]/g;
    const specs = {};
    let m;
    while ((m = specRe.exec(serverPy)) !== null) specs[m[1]] = { better: m[2] };
    const serverKey = g => (g === 'recycle-rings' ? 'rings' : (g === 'recycle-grid' ? 'grid' : g));
    for (const g of GAMES){
      const js = readGame(g);
      const gName = (js.match(/const SYNC_GAME = '([^']+)'/) || [])[1];
      const gBetter = (js.match(/const SYNC_BETTER = '([^']+)'/) || [])[1];
      h.ok(!!gName && gName === serverKey(g), g + ': SYNC_GAME matches server key');
      h.ok(!!specs[gName], g + ': server has a SPECS entry');
      if (specs[gName]) h.ok(specs[gName].better === gBetter, g + ': client better direction matches server');
      h.ok(js.indexOf('SYNC_UNIT') === -1, g + ': no leftover SYNC_UNIT');
      h.ok(js.indexOf('team avg') >= 0, g + ': curve note shows team avg');
      h.ok(js.indexOf('curve offline') >= 0, g + ': offline grace present');
    }
    h.ok(Object.keys(specs).length >= GAMES.length,
      'server: SPECS parsed for all games (got ' + Object.keys(specs).length + ')');
    for (const g of GAMES) h.ok(landing.indexOf(g + '/') >= 0, 'landing: links to ' + g);
  }

  const scenarios = [
    ['bogus', bogusTests],
    ['well-actually', wellActuallyTests],
    ['recycle-rings', ringsTests],
    ['recycle-grid', gridTests],
    ['fermi', fermiTests],
    ['sift', siftTests],
    ['rounds', roundsTests],
    ['trace', traceTests],
    ['lightbox', lightboxTests],
    ['sprint', sprintTests],
    ['cipher', cipherTests],
    ['timeline', timelineTests],
    ['museum', museumTests]
  ];
  for (const [name, fn] of scenarios){
    h.group(name);
    try { await fn(); }
    catch (e){
      const c = h.results[h.results.length - 1];
      c.fail++;
      c.failures.push('EXCEPTION: ' + (e && e.message ? e.message : String(e)));
    }
  }
  crossChecks();

  const s = h.summary();
  return { summary: s.lines, pass: s.pass, fail: s.fail };
}

module.exports = { main, GAMES };

/* CLI entry: read the repo files with fs, run, exit nonzero on failure. */
if (typeof require === 'function' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { createHarness } = require('./harness');
  const ROOT = path.join(__dirname, '..');
  main(
    createHarness,
    g => fs.readFileSync(path.join(ROOT, g, 'index.html'), 'utf8'),
    () => fs.readFileSync(path.join(ROOT, 'scores', 'server.py'), 'utf8'),
    () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  ).then(out => {
    console.log(out.summary);
    process.exit(out.fail ? 1 : 0);
  }).catch(e => { console.error(e); process.exit(1); });
}
