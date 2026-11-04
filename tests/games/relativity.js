/* relativity - three lives a day, one question each: which of two
   events happened nearer the life's birth or its death. Every round
   seats one dated life and two events strictly inside it, the years
   never more than forty apart and the distances never within three of
   each other, so the answer is a judgement the record settles. A life
   never serves twice in one day and never on consecutive days. The
   bank check replays the whole record: every round recomputed against
   the people and events layers, both event years strictly inside the
   life, the margin and spread held, the nearer event the answer, the
   fine print composed letter-exact. */
'use strict';
const { T0, T1 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'EV', 'shareText'];

    /* day 0: three rounds, a clean sweep wins */
    let r = h.boot('relativity', EXP, { now: T0, store: {} });
    await h.flush();
    h.eq(r.x.EV.r.length, 3, 'relativity: day 0 seats three rounds');
    h.ok(r.x.EV.r.every(rz => Array.isArray(rz.o) && rz.o.length === 2),
      'relativity: every round offers two events');
    h.ok(r.x.EV.r.every(rz => rz.a === 0 || rz.a === 1),
      'relativity: every round carries an answer index');
    for (let i = 0; i < r.x.EV.r.length; i++){
        r.env.els['opt' + r.x.EV.r[i].a].click();
        h.eq(r.env.els.verdict.textContent, 'Right.',
          'relativity: a right round says so');
        h.ok(r.env.els.why.textContent.indexOf(' years ') >= 0,
          'relativity: the fine print lays out the distances');
        if (i < r.x.EV.r.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'won', 'relativity: a clean sweep wins the day');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'relativity: the sweep posts the won status');
    h.ok(h.lastPost(r.env).body.answer.every((p, i) => p === r.x.EV.r[i].a),
      'relativity: the evidence carries every round of the sweep');
    h.ok(!('value' in h.lastPost(r.env).body), 'relativity: the client never names its own score');
    h.eq(r.env.els.sverdict.textContent, 'A clean sweep, 3 of 3.',
      'relativity: the tally reads the sweep');
    h.ok(r.x.shareText().indexOf('Relativity No. 1') === 0,
      'relativity: the share text names the day');
    h.ok(r.env.els.sreview.textContent.indexOf(': ') >= 0,
      'relativity: the review retells each round');

    /* day rollover: the streak survives, and the day keeps three fresh lives */
    r = h.boot('relativity', EXP, { now: T1, store: r.env.store });
    await h.flush();
    h.eq(r.x.S.day, 1, 'relativity: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'relativity: streak preserved');
    h.eq(new Set(r.x.EV.r.map(rz => rz.p)).size, 3,
      'relativity: a day never seats the same life twice');
    for (let i = 0; i < r.x.EV.r.length; i++){
        r.env.els['opt' + r.x.EV.r[i].a].click();
        if (i < r.x.EV.r.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'won', 'relativity: day 1 sweeps');
    h.eq(r.x.S.stats.streak, 2, 'relativity: the sweep streak counts');

    /* one wrong round: the day plays through, the miss carries into the tally */
    const s2 = {};
    r = h.boot('relativity', EXP, { now: T0, store: s2 });
    await h.flush();
    r.env.els['opt' + ((r.x.EV.r[0].a + 1) % 2)].click();
    h.eq(r.env.els.verdict.textContent, 'No.',
      'relativity: a wrong round says no');
    h.ok(r.env.els.why.textContent.indexOf('You picked') >= 0,
      'relativity: the fine print names the event you picked');
    for (let i = 1; i < r.x.EV.r.length; i++){
        r.env.els['opt' + r.x.EV.r[i].a].click();
        if (i < r.x.EV.r.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'lost', 'relativity: one miss loses the sweep');
    h.eq(r.x.S.stats.streak, 0, 'relativity: a miss resets the streak');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'lost', 'relativity: a miss posts lost');
    h.eq(h.lastPost(r.env).body.answer.filter((p, i) => p === r.x.EV.r[i].a).length, 2,
      'relativity: the evidence carries the two right rounds');

    /* --- dealt: the live day ships the rounds without their answers or
       their fine print, so every round travels to the session and the
       spent round hands over both --- */
    const relLive = h.boot('relativity', EXP, { now: T0, store: {} });
    await h.flush();
    const relFull = relLive.x.EV;
    const relServed = { game: 'relativity', day: 0, today: 0,
      puzzle: { r: relFull.r.map(rz => ({ p: rz.p, s: rz.s, q: rz.q, o: rz.o.slice() })) } };
    let relN = 0;
    const relDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'r1', today: 0, puzzle: relServed.puzzle } };
      const i = relN++;
      const last = i === relFull.r.length - 1;
      return { status: 200, body: { verdict: body.move.pick === relFull.r[i].a ? 'hit' : 'miss',
        a: relFull.r[i].a, w: relFull.r[i].w, final: last } };
    };
    const relDst = {};
    const relD = h.boot('relativity', EXP,
      { now: T0, store: relDst, servePuzzle: relServed, stubBanks: true, serveDealt: relDealer });
    await h.flush();
    h.ok(relServed.puzzle.r.every(rz => !('a' in rz) && !('w' in rz)),
      'relativity dealt: the served day never ships an answer or its fine print');
    h.ok(String(relD.env.els.qtag.textContent).indexOf('round 1') >= 0,
      'relativity dealt: the served session rendered');
    /* one wrong round first: the spent round hands over the answer and the why */
    relD.env.els['opt' + ((relFull.r[0].a + 1) % 2)].click();
    await h.flush();
    h.eq(relD.x.S.ans[0], relFull.r[0].a,
      'relativity dealt: the spent round handed over its own answer');
    h.eq(relD.x.S.rv[0], relFull.r[0].w,
      'relativity dealt: the spent round handed over its fine print');
    h.eq(relD.env.els.verdict.textContent, 'No.',
      'relativity dealt: a wrong round is graded by the session');
    relD.env.els.btnNext.click();
    for (let i = 1; i < relFull.r.length; i++){
        relD.env.els['opt' + relFull.r[i].a].click();
        await h.flush();
        if (i < relFull.r.length - 1) relD.env.els.btnNext.click();
    }
    relD.env.els.btnNext.click();
    await h.flush();
    h.eq(relD.x.S.status, 'lost', 'relativity dealt: one miss loses the sweep');
    h.eq(relD.x.S.nonce, 'r1', 'relativity dealt: the session is held');
    const relPost = h.lastPost(relD.env);
    h.eq(relPost.body.nonce, 'r1', 'relativity dealt: the evidence names the session');
    h.eq(relPost.body.answer.filter((p, i) => p === relFull.r[i].a).length,
      relFull.r.length - 1, 'relativity dealt: the evidence carries the session rounds');
    /* a reload keeps the lost day and retells the fine print that never shipped */
    const relR = h.boot('relativity', EXP,
      { now: T0, store: relDst, servePuzzle: relServed, stubBanks: true });
    await h.flush();
    h.eq(relR.x.S.status, 'lost', 'relativity dealt: a reload keeps the lost day');
    h.ok(relR.env.els.sreview.textContent.indexOf(relFull.r[0].w) >= 0,
      'relativity dealt: the reload retells the fine print it never shipped');
    /* a clean sweep on a fresh deal */
    let relN2 = 0;
    const relDealer2 = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'r2', today: 0, puzzle: relServed.puzzle } };
      const i = relN2++;
      return { status: 200, body: { verdict: 'hit', a: relFull.r[i].a, w: relFull.r[i].w,
        final: i === relFull.r.length - 1 } };
    };
    const relD2 = h.boot('relativity', EXP,
      { now: T0, store: {}, servePuzzle: relServed, stubBanks: true, serveDealt: relDealer2 });
    await h.flush();
    for (let i = 0; i < relFull.r.length; i++){
        relD2.env.els['opt' + relFull.r[i].a].click();
        await h.flush();
        if (i < relFull.r.length - 1) relD2.env.els.btnNext.click();
    }
    relD2.env.els.btnNext.click();
    await h.flush();
    h.eq(relD2.x.S.status, 'won', 'relativity dealt: the dealt sweep wins');
    h.eq(relD2.env.els.sverdict.textContent, 'A clean sweep, 3 of 3.',
      'relativity dealt: the tally reads the dealt sweep');
    /* --- an expired session no longer refunds the rounds: a mid-record
       expiry reseats the graded picks and the sweep still lands --- */
    let relXDeals = 0, relXN = 0;
    const relXDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        relXDeals++;
        relXN = 0;
        return { status: 200, body: { nonce: 'rx' + relXDeals, today: 0, puzzle: relServed.puzzle } };
      }
      const i = relXN++;
      if (relXDeals === 1 && i >= 1)
        return { status: 410, body: {} };
      const last = i === relFull.r.length - 1;
      return { status: 200, body: { verdict: body.move.pick === relFull.r[i].a ? 'hit' : 'miss',
        a: relFull.r[i].a, w: relFull.r[i].w, final: last } };
    };
    const relXDst = {};
    const relX = h.boot('relativity', EXP,
      { now: T0, store: relXDst, servePuzzle: relServed, stubBanks: true, serveDealt: relXDealer });
    await h.flush();
    relX.env.els['opt' + relFull.r[0].a].click();
    await h.flush();
    h.eq(relX.x.S.picks.length, 1, 'relativity reseat: one round graded');
    h.eq(relX.x.S.nonce, 'rx1', 'relativity reseat: the first session is held');
    relX.env.els.btnNext.click();
    relX.env.els['opt' + ((relFull.r[1].a + 1) % 2)].click();
    await h.flush(); await h.flush(); await h.flush();
                    /* expiry, then the reseat replays the graded round */
    h.eq(relX.x.S.picks.length, 1, 'relativity reseat: the graded round survives the expiry');
    h.eq(relX.x.S.picks[0], relFull.r[0].a, 'relativity reseat: the pick survives the expiry');
    h.eq(relX.x.S.nonce, 'rx2', 'relativity reseat: the record reseats onto a fresh session');
    h.eq(relXDeals, 2, 'relativity reseat: exactly one redeal');
    h.eq(relXN, 1, 'relativity reseat: the replay re-graded the round');
    h.ok(String(relX.env.els.qtag.textContent).indexOf('round 2') >= 0,
      'relativity reseat: the reseat seats the next round');
    for (let i = 1; i < relFull.r.length; i++){
        relX.env.els['opt' + relFull.r[i].a].click();
        await h.flush();
        if (i < relFull.r.length - 1) relX.env.els.btnNext.click();
    }
    relX.env.els.btnNext.click();
    await h.flush();
    h.eq(relX.x.S.status, 'won', 'relativity reseat: the sweep lands on the reseeded session');
    const relXPost = h.lastPost(relX.env);
    h.eq(relXPost.body.nonce, 'rx2', 'relativity reseat: the evidence names the reseeded session');
    h.ok(relXPost.body.answer.every((p, i) => p === relFull.r[i].a),
      'relativity reseat: the evidence carries the whole sweep');
    /* an archive replay keeps the local path: the bank still carries the answers */
    const relRe = h.boot('relativity', EXP, { now: T1, store: {}, search: '?d=0' });
    await h.flush();
    for (let i = 0; i < relRe.x.EV.r.length; i++){
        relRe.env.els['opt' + relRe.x.EV.r[i].a].click();
        if (i < relRe.x.EV.r.length - 1) relRe.env.els.btnNext.click();
    }
    relRe.env.els.btnNext.click();
    h.eq(relRe.x.S.status, 'won', 'relativity: the replay wins locally');
    await h.flush();
    h.eq(relRe.env.fetchLog.length, 0, 'relativity: a replay posts nothing');

    /* the bank: replay the whole record against the people and events layers */
    const boards = require('../../puzzles/relativity/puzzles.json');
    const recipe = require('../../puzzles/relativity/recipe.json');
    const people = require('../../knowledge/people.json');
    const events = require('../../knowledge/events.json');
    const evYear = {};
    for (const e of events){ if (Number.isInteger(e.y)) evYear[e.n] = e.y; }
    const lifeByName = {};
    for (const p of people){
      if (Number.isInteger(p.born) && Number.isInteger(p.died)) lifeByName[p.n] = p;
    }
    h.eq(boards.length, recipe.days, 'relativity: the bank holds the recipe\'s full season');
    h.eq(recipe.v, 1, 'relativity: the recipe speaks its version');
    let structural = true, settled = true, fresh = true;
    let prevLives = [];
    boards.forEach(b => {
      if (!Array.isArray(b.r) || b.r.length !== 3 ||
          new Set(b.r.map(rz => rz.p)).size !== 3) structural = false;
      if (prevLives.some(n => b.r.some(rz => rz.p === n))) fresh = false;
      b.r.forEach(rz => {
        if (!Array.isArray(rz.o) || rz.o.length !== 2 || rz.o[0] === rz.o[1]
            || (rz.a !== 0 && rz.a !== 1)) structural = false;
        const life = lifeByName[rz.p];
        if (!life || !(life.died - life.born >= 10)){ settled = false; return; }
        const anchor = rz.q.indexOf('birth') >= 0 ? 'birth' : 'death';
        if (rz.q !== 'Which happened nearer ' + rz.p + "'s " + anchor + '?') settled = false;
        if (rz.s !== life.born + '-' + life.died) settled = false;
        const yA = evYear[rz.o[0]], yB = evYear[rz.o[1]];
        if (!Number.isInteger(yA) || !Number.isInteger(yB)){ settled = false; return; }
        if (!(life.born < yA && yA < life.died) || !(life.born < yB && yB < life.died))
          settled = false;
        const dA = anchor === 'birth' ? yA - life.born : life.died - yA;
        const dB = anchor === 'birth' ? yB - life.born : life.died - yB;
        if (Math.abs(dA - dB) < recipe.margin) settled = false;
        if (Math.abs(yA - yB) > recipe.spread) settled = false;
        if (rz.a !== (dA <= dB ? 0 : 1)) settled = false;
        const yr = d => d === 1 ? '1 year' : d + ' years';
        const tail = anchor === 'birth' ? 'after the birth' : 'before the death';
        const w = rz.o[0] + ' was ' + yA + ', ' + yr(dA) + ' ' + tail + '. '
          + rz.o[1] + ' was ' + yB + ', ' + yr(dB) + ' ' + tail + '.';
        if (rz.w !== w) settled = false;
      });
      prevLives = b.r.map(rz => rz.p);
    });
    h.ok(structural, 'relativity: every day seats three distinct lives and three honest rounds');
    h.ok(settled, 'relativity: every round matches the record, margins, spread and fine print');
    h.ok(fresh, 'relativity: no life ever serves on consecutive days');
}

module.exports = { name: 'relativity', run };
