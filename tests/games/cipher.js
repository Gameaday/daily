/* cipher - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'SUB', 'Q', 'assign', 'solvedP', 'shareText', 'FREQ_ORDER'];
    const store = {};
    let r = h.boot('cipher', EXP, { now: T0, store });
    h.eq(r.x.Q.a, 'Franklin D. Roosevelt', 'cipher: day 0 author');
    for (const c of Object.keys(r.x.SUB.dec)){
      r.x.S.sel = c;
      r.x.assign(r.x.SUB.dec[c]);
    }
    h.eq(r.x.S.status, 'playing', 'cipher: nothing auto-wins while typing');
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'cipher: wins on Check with a complete decode');
    h.eq(r.x.S.hints, 0, 'cipher: no hints used');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 0, 'cipher: curve value 0');
    h.ok(r.x.shareText().indexOf('no hints') >= 0, 'cipher: share "no hints"');
    r.env.els.btnCodebook.click();
    h.ok(r.env.els.codebook.style.display !== 'none', 'cipher: codebook opens after the win');
    h.ok(r.env.els.codebook.textContent.indexOf('\u2192') >= 0, 'cipher: codebook lists the substitutions');
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

module.exports = { name: 'cipher', run };
