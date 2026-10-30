/* superlative - headless playthrough (win, loss, day rollover) plus
   the bonus match. The boards cut from the people layer: day 0 seats
   Ada Lovelace, John Adams, Akbar and Al-Idrisi, asks for the longest
   life, and its bonus seats all four. Every dim counts from both
   ends, and the dates calculate two more, the most average life and
   the middle birth: day 1 seats Al-Razi on hers, day 13 seats on the
   calculated middles, day 48 keeps the most-average chip, and the
   bank check pins full coverage. */
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
    h.ok(Array.isArray(r.x.EV.b) && r.x.EV.b.length === 4,
      'superlative: day 1 seats its bonus through the inversions');
    h.ok(r.x.EV.b.some(x => x.q === 'was born closest to the middle' &&
      r.x.EV.opts[x.a] === 'Al-Razi'),
      'superlative: the calculated middle birth is a chip in its own right');
    const T13 = T0 + 13 * 86400000;
    const nb = {};
    r = h.boot('superlative', EXP, { now: T13, store: nb });
    await h.flush();
    h.ok(r.x.EV.b.some(x => x.q === 'lived the most average life' &&
      r.x.EV.opts[x.a] === 'Richard Byrd'),
      'superlative: the calculated middles seat the group that once served no bonus');
    const T48 = T0 + 48 * 86400000;
    const fbs = {};
    r = h.boot('superlative', EXP, { now: T48, store: fbs });
    await h.flush();
    h.ok(r.x.EV.b.some(x => x.q === 'was the most average' && x.v === 'nothing special'),
      'superlative: the one life no dim tops still takes the most average');
    const bankBoards = require('../../puzzles/superlative/puzzles.json');
    h.ok(bankBoards.every(e => Array.isArray(e.b) && e.b.length === 4 &&
      new Set(e.b.map(x => x.a)).size === 4),
      'superlative: every board seats a bonus chip for every life');
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

    /* the bonus match: four superlatives, one per life */
    h.ok(Array.isArray(r.x.EV.b) && r.x.EV.b.length === 4,
      'superlative: day 0 carries a bonus chip for every life');
    h.eq(new Set(r.x.EV.b.map(x => x.a)).size, 4,
      'superlative: the bonus seats one superlative per life');
    const pairs = r.x.EV.b.map((x, i) => [i, x.a]).sort((x, y) => x[1] - y[1]);
    for (const pair of pairs){
      r.env.els['chip' + pair[0]].click();
      r.env.els['bname' + pair[1]].click();
    }
    h.eq(r.x.S.bonus.done, true, 'superlative: all four superlatives assigned');
    h.eq(r.x.S.bonus.wrong, 0, 'superlative: the bonus match played clean');

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
