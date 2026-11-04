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
    /* typing flows to the next unfilled space to the right, not to the
       most frequent letter elsewhere in the quote */
    const q = r.x.Q.q;
    const enc2 = ch => (/[A-Z]/.test(ch) ? r.x.SUB.enc[ch] : null);
    const firstC = enc2(q[0]);
    r.x.S.sel = firstC;
    r.x.assign(r.x.SUB.dec[firstC]);
    let wantNext = null;
    for (let i = 1; i < q.length; i++){
      const c2 = enc2(q[i]);
      if (c2 && !r.x.S.map[c2]){ wantNext = c2; break; }
    }
    h.eq(r.x.S.sel, wantNext, 'cipher: typing advances to the next unfilled space to the right');
    for (const c of Object.keys(r.x.SUB.dec)){
      r.x.S.sel = c;
      r.x.assign(r.x.SUB.dec[c]);
    }
    h.eq(r.x.S.status, 'playing', 'cipher: nothing auto-wins while typing');
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'cipher: wins on Check with a complete decode');
    h.eq(r.x.S.hints, 0, 'cipher: no hints used');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'cipher: the decode posts the won status');
    h.eq(h.lastPost(r.env).body.meta.hints, 0, 'cipher: the evidence carries a cold decode');
    h.ok(!('value' in h.lastPost(r.env).body), 'cipher: the client never names its own score');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'cipher: the cold-decode star rides the share');
    h.ok(r.x.shareText().indexOf('no hints') >= 0, 'cipher: share "no hints"');
    r.env.els.btnCodebook.click();
    h.ok(r.env.els.codebook.style.display !== 'none', 'cipher: codebook opens after the win');
    h.ok(r.env.els.codebook.innerHTML.indexOf('\u2192') >= 0, 'cipher: codebook lists the substitutions');
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

    /* --- dealt: the live day ships the ciphertext without the quote, so
       the check travels to the session and the session meters the
       hints and holds the codebook --- */
    const cpLive = h.boot('cipher', EXP, { now: T0, store: {} });
    const cpFull = cpLive.x.Q;
    const cpSub = cpLive.x.SUB;
    const cpCipher = [...cpFull.q].map(ch => /[A-Z]/.test(ch) ? cpSub.enc[ch] : ch).join('');
    const cpServed = { game: 'cipher', day: 0, today: 0, puzzle: { a: cpFull.a, c: cpCipher } };
    const cpFreq = {};
    [...cpFull.q].forEach(ch => { if (/[A-Z]/.test(ch)){ const cc = cpSub.enc[ch]; cpFreq[cc] = (cpFreq[cc] || 0) + 1; } });
    const cpOrder = Object.keys(cpFreq).sort((a, b) => cpFreq[b] - cpFreq[a] || (a < b ? -1 : 1));
    let cpHints = 0;
    const cpDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'c1', today: 0, puzzle: cpServed.puzzle } };
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave',
          reveal: { q: cpFull.q, a: cpFull.a, sub: cpSub.dec } } };
      if (body.move.hint){
        const cand = cpOrder.find(c => body.move.have[c] !== cpSub.dec[c]);
        if (!cand) return { status: 400, body: { error: 'nothing left to hint' } };
        cpHints++;
        return { status: 200, body: { verdict: 'hint', cipher: cand,
          plain: cpSub.dec[cand], hints: cpHints } };
      }
      const right = cpOrder.filter(c => body.move.check[c] === cpSub.dec[c]).length;
      if (right === cpOrder.length)
        return { status: 200, body: { verdict: 'won',
          reveal: { q: cpFull.q, a: cpFull.a, sub: cpSub.dec } } };
      return { status: 200, body: { verdict: 'miss', right, total: cpOrder.length } };
    };
    const cpDst = {};
    const cpD = h.boot('cipher', ['S', 'assign', 'shareText'],
      { now: T0, store: cpDst, servePuzzle: cpServed, stubBanks: true, serveDealt: cpDealer });
    await h.flush();
    h.ok(!('q' in cpServed.puzzle), 'cipher dealt: the served day never ships its quote');
    h.ok(String(cpD.env.els.author.textContent).indexOf(cpFull.a) >= 0,
      'cipher dealt: the served author rendered');
    h.ok(String(cpD.env.els.quote.innerHTML).indexOf(cpCipher[0]) >= 0,
      'cipher dealt: the served ciphertext rendered');
    h.eq(cpD.x.S.status, 'playing', 'cipher dealt: nothing auto-wins while typing');
    /* a partial decode checks at the session and does not win */
    cpD.x.S.sel = cpOrder[0];
    cpD.x.assign(cpSub.dec[cpOrder[0]]);
    cpD.env.els.btnCheck.click();
    await h.flush();
    h.eq(cpD.x.S.status, 'playing', 'cipher dealt: a partial decode does not win');
    for (const c of Object.keys(cpSub.dec)){
      cpD.x.S.sel = c;
      cpD.x.assign(cpSub.dec[c]);
    }
    cpD.env.els.btnCheck.click();
    await h.flush();
    h.eq(cpD.x.S.status, 'won', 'cipher dealt: won on the session');
    h.eq(cpD.x.S.nonce, 'c1', 'cipher dealt: the session is held');
    const cpPost = h.lastPost(cpD.env);
    h.eq(cpPost.body.status, 'won', 'cipher dealt: the decode posts the won status');
    h.eq(cpPost.body.nonce, 'c1', 'cipher dealt: the evidence names the session');
    h.eq(cpPost.body.meta.hints, 0, 'cipher dealt: the evidence carries a cold decode');
    h.ok(String(cpD.env.els.plainq.innerHTML).indexOf(cpFull.q) >= 0,
      'cipher dealt: the quote arrived only with the reveal');
    cpD.env.els.btnCodebook.click();
    h.ok(cpD.env.els.codebook.innerHTML.indexOf('\u2192') >= 0,
      'cipher dealt: the codebook lists the session substitutions');
    /* a hint meters itself on the session and fills a correct letter */
    const cpHst = {};
    const cpH = h.boot('cipher', ['S'],
      { now: T0, store: cpHst, servePuzzle: cpServed, stubBanks: true, serveDealt: cpDealer });
    await h.flush();
    cpH.env.els.btnHint.click();
    await h.flush();
    h.eq(cpH.x.S.hints, 1, 'cipher dealt: a hint meters itself on the session');
    const cpFilled = Object.keys(cpH.x.S.map);
    h.ok(cpFilled.length === 1 && cpH.x.S.map[cpFilled[0]] === cpSub.dec[cpFilled[0]],
      'cipher dealt: the session hint fills a correct letter');
    /* the codebook reveal ends the day: the quote rides the spent round */
    const cpGst = {};
    const cpG = h.boot('cipher', ['S'],
      { now: T0, store: cpGst, servePuzzle: cpServed, stubBanks: true, serveDealt: cpDealer });
    await h.flush();
    cpG.env.els.btnGiveUp.click();
    await h.flush();
    h.eq(cpG.x.S.status, 'gaveup', 'cipher dealt: the codebook reveal ends the day');
    h.ok(String(cpG.env.els.plainq.innerHTML).indexOf(cpFull.q) >= 0,
      'cipher dealt: the give-up retells the quote it never shipped');
    /* a reload keeps the won day and retells the quote it never shipped */
    const cpR = h.boot('cipher', ['S'],
      { now: T0, store: cpDst, servePuzzle: cpServed, stubBanks: true });
    await h.flush();
    h.eq(cpR.x.S.status, 'won', 'cipher dealt: a reload keeps the won day');
    h.ok(String(cpR.env.els.plainq.innerHTML).indexOf(cpFull.q) >= 0,
      'cipher dealt: the reload retells the quote it never shipped');
    /* --- an expired session no longer spends the decode: a hint expiry
       reseats the hint meter and the crack still wins --- */
    let cpXDeals = 0, cpXHints = 0;
    const cpXDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        cpXDeals++;
        cpXHints = 0;
        return { status: 200, body: { nonce: 'cx' + cpXDeals, today: 0, puzzle: cpServed.puzzle } };
      }
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave',
          reveal: { q: cpFull.q, a: cpFull.a, sub: cpSub.dec } } };
      if (body.move.hint){
        if (cpXDeals === 1 && cpXHints >= 1)
          return { status: 410, body: {} };  /* the session dies on the second hint */
        const cand = cpOrder.find(c => body.move.have[c] !== cpSub.dec[c]);
        if (!cand) return { status: 400, body: { error: 'nothing left to hint' } };
        cpXHints++;
        return { status: 200, body: { verdict: 'hint', cipher: cand,
          plain: cpSub.dec[cand], hints: cpXHints } };
      }
      const right = cpOrder.filter(c => body.move.check[c] === cpSub.dec[c]).length;
      if (right === cpOrder.length)
        return { status: 200, body: { verdict: 'won',
          reveal: { q: cpFull.q, a: cpFull.a, sub: cpSub.dec } } };
      return { status: 200, body: { verdict: 'miss', right, total: cpOrder.length } };
    };
    const cpXDst = {};
    const cpXD = h.boot('cipher', ['S', 'assign'],
      { now: T0, store: cpXDst, servePuzzle: cpServed, stubBanks: true, serveDealt: cpXDealer });
    await h.flush();
    cpXD.env.els.btnHint.click();
    await h.flush();
    h.eq(cpXD.x.S.hints, 1, 'cipher reseat: one hint metered');
    h.eq(cpXD.x.S.nonce, 'cx1', 'cipher reseat: the first session is held');
    cpXD.env.els.btnHint.click();          /* the session dies on the second hint */
    await h.flush(); await h.flush(); await h.flush();
                    /* expiry -> the reseat replays the spent hint */
    h.eq(cpXD.x.S.hints, 1, 'cipher reseat: the spent hint survives the expiry');
    h.eq(cpXD.x.S.nonce, 'cx2', 'cipher reseat: the decode reseats onto a fresh session');
    h.eq(cpXDeals, 2, 'cipher reseat: exactly one redeal');
    h.eq(cpXHints, 1, 'cipher reseat: the replay re-metered the hint');
    for (const c of Object.keys(cpSub.dec)){
      cpXD.x.S.sel = c;
      cpXD.x.assign(cpSub.dec[c]);
    }
    cpXD.env.els.btnCheck.click();
    await h.flush(); await h.flush();
    h.eq(cpXD.x.S.status, 'won', 'cipher reseat: the crack wins on the reseeded session');
    const cpXPost = h.lastPost(cpXD.env);
    h.eq(cpXPost.body.nonce, 'cx2', 'cipher reseat: the evidence names the reseeded session');
    h.eq(cpXPost.body.meta.hints, 1, 'cipher reseat: the evidence carries the re-metered hint');

    /* an archive replay keeps the local path: the banked quote still
       carries its text and nothing posts */
    const cpRe = h.boot('cipher', EXP, { now: T1, store: {}, search: '?d=0' });
    for (const c of Object.keys(cpRe.x.SUB.dec)){
      cpRe.x.S.sel = c;
      cpRe.x.assign(cpRe.x.SUB.dec[c]);
    }
    cpRe.env.els.btnCheck.click();
    h.eq(cpRe.x.S.status, 'won', 'cipher dealt: the replay wins locally on the banked quote');
    await h.flush();
    h.eq(cpRe.env.fetchLog.length, 0, 'cipher dealt: a replay posts nothing');
}

module.exports = { name: 'cipher', run };
