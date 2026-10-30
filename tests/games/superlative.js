/* superlative - headless playthrough (win, loss, day rollover). The
   boards cut from the people layer: day 0 seats Ada Lovelace, John
   Adams, Akbar and Al-Idrisi and asks for the longest life. */
'use strict';
const { T0, T1, TPRE } = require('./_lib');

async function run(h){
    const EXP = ['S', 'EV', 'shareText'];
    const store = {};
    let r = h.boot('superlative', EXP, { now: T0, store });
    await h.flush();
    h.eq(r.x.EV.t, 'Longevity', 'superlative: day 0 asks for the longest life');
    h.eq(r.x.EV.opts[r.x.EV.a], 'John Adams', 'superlative: day 0 longest life is John Adams');
    h.eq(r.x.EV.opts.length, 4, 'superlative: four lives on the board');
    h.ok(r.x.EV.opts.indexOf(undefined) === -1, 'superlative: every life is named');
    r.env.els['opt' + r.x.EV.a].click();
    h.eq(r.x.S.status, 'won', 'superlative: picked the longest life first try');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 1, 'superlative: curve value 1');
    r = h.boot('superlative', EXP, { now: T1, store });
    await h.flush();
    h.eq(r.x.S.day, 1, 'superlative: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'superlative: streak preserved');
    const s2 = {};
    r = h.boot('superlative', EXP, { now: T0, store: s2 });
    await h.flush();
    const wrong = (r.x.EV.a + 1) % 4;
    r.env.els['opt' + wrong].click();
    h.eq(r.x.S.status, 'lost', 'superlative: a wrong life loses the board');
    await h.flush();
    h.eq(h.lastPost(r.env).body.value, 2, 'superlative: curve value 2 on loss');
    h.ok(r.env.els.why.textContent.indexOf(r.x.EV.opts[r.x.EV.a]) >= 0,
      'superlative: the reveal names the one who stood alone');

    /* the pre-launch clamp: before the epoch the shell reads No. 1, and a
       weekend win carries into the real Monday board */
    const pre = {};
    r = h.boot('superlative', EXP, { now: TPRE, store: pre });
    await h.flush();
    h.eq(r.x.S.day, 0, 'superlative: pre-launch boots clamp to day 0');
    h.eq(r.x.EV.opts[r.x.EV.a], 'John Adams', 'superlative: pre-launch reads the No. 1 board');
    r.env.els['opt' + r.x.EV.a].click();
    await h.flush();
    r = h.boot('superlative', EXP, { now: T0, store: pre });
    await h.flush();
    h.eq(r.x.S.day, 0, 'superlative: launch day keeps the pre-launch play');
    h.eq(r.x.S.status, 'won', 'superlative: weekend win carries into No. 1');
    h.eq(r.x.S.stats.streak, 1, 'superlative: pre-launch streak survives');
}

module.exports = { name: 'superlative', run };
