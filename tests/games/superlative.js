/* superlative v2 - one session a day: a cohort of lives and a run of
   questions the record settles one at a time. The same life may answer
   at most two questions, and a new cohort may never seat a majority
   that served together before (two shared with any earlier cohort for
   five lives, one for four). Day 0 seats the opening table, Ada
   Lovelace, John Adams, Akbar and Al-Idrisi: its five rounds ask the
   shortest life (Ada, 37 years, her Note G in the fine print), the
   first birth (Al-Idrisi, 1100), the longest reign (Akbar, 49 years),
   the longest life (John Adams, 91 years) and the middle birth (Akbar,
   born 1542). Day 1 draws the Renaissance bucket; day 5 lands the
   first weekend theme. The bank check replays the whole record: every
   session's questions recomputed against the people layer, no tie
   ever serving, the majority-fresh rule over all 364 sessions, the
   answer and family caps, and the era and theme titles. */
'use strict';
const { T0, T1, TPRE } = require('./_lib');

async function run(h){
    const EXP = ['S', 'EV', 'shareText'];
    const store = {};
    let r = h.boot('superlative', EXP, { now: T0, store });
    await h.flush();
    h.eq(r.x.EV.t, 'The Opening Table', 'superlative: day 0 seats the opening table');
    h.eq(r.x.EV.m.length, 4, 'superlative: the opening table seats four lives');
    h.eq(r.x.EV.m[1].n, 'John Adams', 'superlative: John Adams keeps his seat');
    h.eq(r.x.EV.q.length, 5, 'superlative: day 0 runs five rounds');
    const lon0 = r.x.EV.q.find(q => q.c === 'lon');
    h.ok(lon0 && lon0.a === 1, 'superlative: day 0 asks for the longest life with John Adams as the answer');
    /* play the opening table clean, one round at a time */
    for (let i = 0; i < r.x.EV.q.length; i++){
        r.env.els['opt' + r.x.EV.q[i].a].click();
        if (r.x.EV.q[i].a === 0)
            h.ok(r.env.els.why.textContent.indexOf('Note G') >= 0,
              'superlative: the round Ada answers carries her Note G in the fine print');
        if (i < r.x.EV.q.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'won', 'superlative: a clean sweep wins the session');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'superlative: the sweep posts the won status');
    h.ok(h.lastPost(r.env).body.answer.every((p, i) => p === r.x.EV.q[i].a),
      'superlative: the evidence carries every round of the sweep');
    h.ok(!('value' in h.lastPost(r.env).body), 'superlative: the client never names its own score');
    h.eq(r.env.els.sverdict.textContent, 'A clean sweep, 5 of 5.',
      'superlative: the tally reads the sweep');
    h.ok(r.x.shareText().indexOf('The Opening Table') >= 0,
      'superlative: the share text carries the session title');
    h.ok(r.env.els.sreview.textContent.indexOf('longest life: John Adams') >= 0,
      'superlative: the review names John Adams for the longest life');

    /* day rollover: the streak survives into the Renaissance bucket */
    r = h.boot('superlative', EXP, { now: T1, store });
    await h.flush();
    h.eq(r.x.S.day, 1, 'superlative: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'superlative: streak preserved');
    h.eq(r.x.EV.t, 'The Renaissance', 'superlative: day 1 draws the Renaissance era bucket');
    h.eq(r.x.EV.m.length, 5, 'superlative: weekdays seat five lives');
    for (let i = 0; i < r.x.EV.q.length; i++){
        r.env.els['opt' + r.x.EV.q[i].a].click();
        if (i < r.x.EV.q.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'won', 'superlative: day 1 sweeps');
    h.eq(r.x.S.stats.streak, 2, 'superlative: the sweep streak counts');
    await h.flush();
    h.ok(h.lastPost(r.env).body.answer.every((p, i) => p === r.x.EV.q[i].a),
      'superlative: the day 1 sweep posts a perfect run');

    /* one wrong round: the session plays through, the value carries the miss */
    const s2 = {};
    r = h.boot('superlative', EXP, { now: T0, store: s2 });
    await h.flush();
    const missed = r.x.EV.q[0];
    r.env.els['opt' + ((missed.a + 1) % r.x.EV.m.length)].click();
    h.ok(r.env.els.verdict.textContent.indexOf('No. The record says') === 0,
      'superlative: a wrong round says what the record says');
    h.ok(r.env.els.why.textContent.indexOf('You picked') >= 0,
      'superlative: the fine print names the life you picked');
    for (let i = 1; i < r.x.EV.q.length; i++){
        r.env.els['opt' + r.x.EV.q[i].a].click();
        if (i < r.x.EV.q.length - 1) r.env.els.btnNext.click();
    }
    r.env.els.btnNext.click();
    h.eq(r.x.S.status, 'lost', 'superlative: one miss loses the sweep');
    h.eq(r.x.S.stats.streak, 0, 'superlative: a miss resets the streak');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'lost', 'superlative: a miss posts lost');
    h.eq(h.lastPost(r.env).body.answer.filter((p, i) => p === r.x.EV.q[i].a).length, 4,
      'superlative: the evidence carries the four right rounds');

    /* weekends land a theme the recipe curates */
    const recipe = require('../../puzzles/superlative/recipe.json');
    const themeNames = recipe.themes.map(t => t.n);
    const eraNames = ['The Ancient World', 'The Middle Ages', 'The Renaissance', 'The Early Modern',
      'The 18th Century', 'The 19th Century', 'The 20th Century'];
    const wk = {};
    r = h.boot('superlative', EXP, { now: T0 + 5 * 86400000, store: wk });
    await h.flush();
    h.ok(themeNames.indexOf(r.x.EV.t) >= 0,
      'superlative: day 5, a weekend, lands a themed session');
    h.eq(r.x.EV.m.length, 4, 'superlative: a small theme pool seats four lives');

    /* the bank: replay the whole record against the people layer */
    const sessions = require('../../puzzles/superlative/puzzles.json');
    const people = require('../../knowledge/people.json').filter(p =>
      Number.isInteger(p.born) && Number.isInteger(p.died));
    const byLife = {};
    for (const p of people){ (byLife[p.n + '|' + p.born] = byLife[p.n + '|' + p.born] || []).push(p); }
    const FAM = { lon: 'span', sht: 'span', avg: 'span', bfr: 'born', bla: 'born', bmid: 'born',
      tall: 'size', tiny: 'size', wrk: 'works', wls: 'works', reg: 'reg', rsh: 'reg', voy: 'voy' };
    const uniq = (vals, best) => {
        const top = best === 'max' ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
        return vals.filter(x => x === top).length === 1 ? vals.indexOf(top) : -1;
    };
    const measured = (vals, best) => {
        const pairs = [];
        vals.forEach((x, i) => { if (x !== undefined) pairs.push([x, i]); });
        if (pairs.length < 2) return -1;
        const top = best === 'max' ? Math.max.apply(null, pairs.map(o => o[0]))
                                  : Math.min.apply(null, pairs.map(o => o[0]));
        return pairs.filter(o => o[0] === top).length === 1 ? pairs.find(o => o[0] === top)[1] : -1;
    };
    const near = vals => {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return uniq(vals.map(x => Math.abs(x - avg)), 'min');
    };
    const DIM = {
        lon: g => uniq(g.map(p => p.died - p.born), 'max'),
        sht: g => uniq(g.map(p => p.died - p.born), 'min'),
        bfr: g => uniq(g.map(p => p.born), 'min'),
        bla: g => uniq(g.map(p => p.born), 'max'),
        avg: g => near(g.map(p => p.died - p.born)),
        bmid: g => near(g.map(p => p.born)),
        tall: g => g.every(p => p.h !== undefined) ? uniq(g.map(p => p.h), 'max') : -1,
        tiny: g => g.every(p => p.h !== undefined) ? uniq(g.map(p => p.h), 'min') : -1,
        wrk: g => uniq(g.map(p => p.works || 0), 'max'),
        wls: g => measured(g.map(p => p.works), 'min'),
        reg: g => uniq(g.map(p => p.reign || 0), 'max'),
        rsh: g => measured(g.map(p => p.reign), 'min'),
        voy: g => measured(g.map(p => p.voy), 'max')
    };
    const VAL = {
        lon: p => (p.died - p.born) + ' years', sht: p => (p.died - p.born) + ' years',
        avg: p => (p.died - p.born) + ' years',
        bfr: p => 'born ' + p.born, bla: p => 'born ' + p.born, bmid: p => 'born ' + p.born,
        tall: p => p.h + ' cm', tiny: p => p.h + ' cm',
        wrk: p => p.works + ' works', wls: p => p.works + ' works',
        reg: p => p.reign + ' years', rsh: p => p.reign + ' years',
        voy: p => p.voy + ' voyages'
    };
    h.eq(sessions.length, 364, 'superlative: the bank holds a full year of sessions');
    let structural = true, recomputed = true, fresh = true, caps = true;
    const priors = [];
    sessions.forEach((s, i) => {
        if (!Array.isArray(s.m) || s.m.length < 4 || s.m.length > 5 ||
            new Set(s.m.map(m => m.n)).size !== s.m.length ||
            !Array.isArray(s.q) || s.q.length < 4 || s.q.length > 6) structural = false;
        const weekend = i % 7 === 5 || i % 7 === 6;
        if (i > 0 && (weekend ? themeNames.indexOf(s.t) < 0
                              : eraNames.indexOf(s.t) < 0)) structural = false;
        const group = s.m.map(m => (byLife[m.n + '|' + m.b] || [])[0]);
        if (group.some(p => !p)) recomputed = false;
        else {
            const famCount = {}, ansCount = {};
            s.q.forEach(q => {
                if (!DIM[q.c]) recomputed = false;
                else {
                    const a = DIM[q.c](group);
                    if (a !== q.a || VAL[q.c](group[q.a]) !== q.v) recomputed = false;
                }
                famCount[FAM[q.c]] = (famCount[FAM[q.c]] || 0) + 1;
                ansCount[q.a] = (ansCount[q.a] || 0) + 1;
                if (q.a < 0 || q.a >= s.m.length) caps = false;
            });
            if (Object.keys(famCount).some(f => famCount[f] > 2) ||
                Object.keys(ansCount).some(a => ansCount[a] > 2)) caps = false;
        }
        const allow = s.m.length - (Math.floor(s.m.length / 2) + 1);
        const keys = new Set(s.m.map(m => m.n + '|' + m.b));
        priors.forEach(pr => {
            let shared = 0;
            pr.forEach(k => { if (keys.has(k)) shared++; });
            if (shared > allow) fresh = false;
        });
        priors.push(s.m.map(m => m.n + '|' + m.b));
    });
    h.ok(structural, 'superlative: every session seats a cohort the recipe rules allow');
    h.ok(recomputed, 'superlative: every question matches the record, and no tie ever serves');
    h.ok(fresh, 'superlative: no cohort ever seats a majority that served together before');
    h.ok(caps, 'superlative: no family or life answers more than two rounds');

    /* the pre-launch clamp: before the epoch the shell reads No. 1, and a
       weekend win carries into the real Monday session */
    const pre = {};
    r = h.boot('superlative', EXP, { now: TPRE, store: pre });
    await h.flush();
    h.eq(r.x.S.day, 0, 'superlative: pre-launch boots clamp to day 0');
    h.eq(r.x.EV.m[1].n, 'John Adams', 'superlative: pre-launch reads the opening table');
    r.env.els['opt' + r.x.EV.q[0].a].click();
    for (let i = 1; i < r.x.EV.q.length; i++){
        r.env.els.btnNext.click();
        r.env.els['opt' + r.x.EV.q[i].a].click();
    }
    r.env.els.btnNext.click();
    r = h.boot('superlative', EXP, { now: T0, store: pre });
    await h.flush();
    h.eq(r.x.S.day, 0, 'superlative: launch day keeps the pre-launch play');
    h.eq(r.x.S.status, 'won', 'superlative: weekend sweep carries into No. 1');
    h.eq(r.x.S.stats.streak, 1, 'superlative: pre-launch streak survives');

    /* --- dealt: the live day ships the questions without their answers,
       so every round travels to the session and the spent round hands
       over its own answer --- */
    const supLive = h.boot('superlative', EXP, { now: T0, store: {} });
    await h.flush();
    const supFull = supLive.x.EV;
    const supServed = { game: 'superlative', day: 0, today: 0,
      puzzle: { t: supFull.t, m: supFull.m,
        q: supFull.q.map(q => ({ c: q.c, v: q.v })) } };
    let supN = 0;
    const supDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 's1', today: 0, puzzle: supServed.puzzle } };
      const i = supN++;
      const last = i === supFull.q.length - 1;
      return { status: 200, body: { verdict: body.pick === supFull.q[i].a ? 'hit' : 'miss',
        a: supFull.q[i].a, final: last } };
    };
    const supDst = {};
    const supD = h.boot('superlative', EXP,
      { now: T0, store: supDst, servePuzzle: supServed, stubBanks: true, serveDealt: supDealer });
    await h.flush();
    h.ok(supServed.puzzle.q.every(q => !('a' in q)),
      'superlative dealt: the served day never ships an answer');
    h.ok(String(supD.env.els.qtag.textContent).indexOf('round 1') >= 0,
      'superlative dealt: the served session rendered');
    /* one wrong round first: the spent round hands over the answer */
    supD.env.els['opt' + ((supFull.q[0].a + 1) % supFull.m.length)].click();
    await h.flush();
    h.eq(supD.x.S.ans[0], supFull.q[0].a,
      'superlative dealt: the spent round handed over its own answer');
    h.ok(String(supD.env.els.verdict.textContent).indexOf('No. The record says') === 0,
      'superlative dealt: a wrong round is graded by the session');
    supD.env.els.btnNext.click();
    for (let i = 1; i < supFull.q.length; i++){
      supD.env.els['opt' + supFull.q[i].a].click();
      await h.flush();
      if (i < supFull.q.length - 1) supD.env.els.btnNext.click();
    }
    supD.env.els.btnNext.click();
    await h.flush();
    h.eq(supD.x.S.status, 'lost', 'superlative dealt: one miss loses the sweep');
    h.eq(supD.x.S.nonce, 's1', 'superlative dealt: the session is held');
    const supPost = h.lastPost(supD.env);
    h.eq(supPost.body.nonce, 's1', 'superlative dealt: the evidence names the session');
    h.eq(supPost.body.answer.filter((p, i) => p === supFull.q[i].a).length,
      supFull.q.length - 1, 'superlative dealt: the evidence carries the session rounds');
    /* a reload keeps the lost day and retells the review that never shipped */
    const supR = h.boot('superlative', EXP,
      { now: T0, store: supDst, servePuzzle: supServed, stubBanks: true });
    await h.flush();
    h.eq(supR.x.S.status, 'lost', 'superlative dealt: a reload keeps the lost day');
    h.ok(supR.env.els.sreview.textContent.indexOf('longest life: John Adams') >= 0,
      'superlative dealt: the reload retells the review it never shipped');
    /* an archive replay keeps the local path: the bank still carries the answers */
    const supRe = h.boot('superlative', EXP, { now: T1, store: {}, search: '?d=0' });
    await h.flush();
    for (let i = 0; i < supRe.x.EV.q.length; i++){
      supRe.env.els['opt' + supRe.x.EV.q[i].a].click();
      if (i < supRe.x.EV.q.length - 1) supRe.env.els.btnNext.click();
    }
    supRe.env.els.btnNext.click();
    h.eq(supRe.x.S.status, 'won', 'superlative dealt: the replay wins locally');
    await h.flush();
    h.eq(supRe.env.fetchLog.length, 0, 'superlative dealt: a replay posts nothing');
}

module.exports = { name: 'superlative', run };
