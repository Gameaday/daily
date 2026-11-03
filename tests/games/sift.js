/* sift - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
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
    h.ok((r.env.els.mistakes.innerHTML.match(/class="pip/g) || []).length === 3,
      'sift: the meter counts the three affordable mistakes');
    h.ok(r.env.els.mistakes.innerHTML.indexOf('2 left') >= 0,
      'sift: the meter counts what you can afford');
    h.eq(r.x.S.solvedCats.length, 0, 'sift: nothing solved');
    r.x.sel.clear();
    for (const c of [0, 1, 2, 3]){
      catIdx(c).forEach(i => r.x.sel.add(i));
      r.env.els.btnSubmit.click();
    }
    h.eq(r.x.S.status, 'won', 'sift: won with 1 mistake');
    await h.flush();
    h.eq(h.lastPost(r.env).body.status, 'won', 'sift: the win posts the won status');
    h.eq(h.lastPost(r.env).body.meta.mistakes, 1, 'sift: the evidence carries the mistake count');
    h.ok(h.lastPost(r.env).body.answer.length === 4
      && h.lastPost(r.env).body.answer.every(g => g.length === 3),
      'sift: the evidence carries the four solved groups');
    h.ok(!('value' in h.lastPost(r.env).body), 'sift: the client never names its own score');
    h.ok(r.x.shareText().indexOf('\u2605') === -1, 'sift: a miss costs the star');
    h.ok(r.x.shareText().indexOf('1 miss') >= 0, 'sift: share "1 miss"');
    /* Regression: the rollover guard used to check S.solvedAll, which is
       never set anywhere - so a winning streak reset every day. */
    r = h.boot('sift', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'sift: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'sift: streak preserved after win (regression)');

    /* --- dealt: the live day ships its tiles without the categories,
       so every trio travels to the session and the spent test hands
       over its own group --- */
    const sfLive = h.boot('sift', ['BOARD'], { now: T0, store: {} });
    const sfFull = sfLive.x.BOARD;
    h.ok(Array.isArray(sfFull.cats) && sfFull.cats.length === 4,
      'sift dealt: the banked day still carries its groups');
    const sfTiles = sfFull.cats.reduce((a, c) => a.concat(c.i), []);
    const sfServed = { game: 'sift', day: 0, today: 0, puzzle: { t: sfFull.t, tiles: sfTiles } };
    const sfOwner = {};
    sfFull.cats.forEach((c, ci) => c.i.forEach(tx => { sfOwner[tx] = ci; }));
    let sfMisses = 0;
    const sfSolved = [];
    const sfDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'sf1', today: 0, puzzle: sfServed.puzzle } };
      const ci = sfOwner[body.move.pick[0]];
      if (body.move.pick.every(tx => sfOwner[tx] === ci) && !sfSolved.includes(ci)){
        sfSolved.push(ci);
        return { status: 200, body: { verdict: 'hit', cat: ci, n: sfFull.cats[ci].n,
          i: sfFull.cats[ci].i, final: sfSolved.length === 4 } };
      }
      sfMisses++;
      if (sfMisses >= 4)
        return { status: 200, body: { verdict: 'lost',
          reveal: { t: sfFull.t, cats: sfFull.cats } } };
      return { status: 200, body: { verdict: 'miss', mistakes: sfMisses } };
    };
    const sfDst = {};
    const sfD = h.boot('sift', EXP,
      { now: T0, store: sfDst, servePuzzle: sfServed, stubBanks: true, serveDealt: sfDealer });
    await h.flush();
    h.ok(!('cats' in sfServed.puzzle), 'sift dealt: the served day never ships its groups');
    h.ok(String(sfD.env.els.tiles.innerHTML).indexOf(sfTiles[0]) >= 0,
      'sift dealt: the served tiles rendered');
    const sfIdx = ci => sfFull.cats[ci].i.map(tx => sfTiles.indexOf(tx));
    [sfIdx(1)[0], sfIdx(2)[0], sfIdx(3)[0]].forEach(i => sfD.x.sel.add(i));
    sfD.env.els.btnSubmit.click();
    await h.flush();
    h.eq(sfD.x.S.mistakes, 1, 'sift dealt: the session counted the miss');
    sfD.x.sel.clear();
    sfIdx(0).forEach(i => sfD.x.sel.add(i));
    sfD.env.els.btnSubmit.click();
    await h.flush();
    h.eq(sfD.x.S.solvedCats.length, 1, 'sift dealt: the first group locked');
    h.ok(String(sfD.env.els.found.innerHTML).indexOf(sfFull.cats[0].n) >= 0,
      'sift dealt: the spent test named its group');
    h.ok((sfD.env.els.tiles.innerHTML.match(/tile solved/g) || []).length === 3,
      'sift dealt: the locked tiles left the trio pool');
    for (const c of [1, 2, 3]){
      sfD.x.sel.clear();
      sfIdx(c).forEach(i => sfD.x.sel.add(i));
      sfD.env.els.btnSubmit.click();
      await h.flush();
    }
    h.eq(sfD.x.S.status, 'won', 'sift dealt: swept the dealt board');
    h.eq(sfD.x.S.nonce, 'sf1', 'sift dealt: the session is held');
    const sfPost = h.lastPost(sfD.env);
    h.eq(sfPost.body.status, 'won', 'sift dealt: the win posts the won status');
    h.eq(sfPost.body.nonce, 'sf1', 'sift dealt: the evidence names the session');
    h.eq(sfPost.body.meta.mistakes, 1, 'sift dealt: the evidence carries the session mistakes');
    h.ok(sfPost.body.answer.length === 4
      && sfPost.body.answer.every(g => g.length === 3),
      'sift dealt: the evidence carries the four groups');
    h.ok(String(sfD.env.els.verdict.textContent).indexOf(sfFull.t) >= 0,
      'sift dealt: the verdict tells the theme it never shipped');
    h.ok(sfD.x.shareText().indexOf('1 miss') >= 0, 'sift dealt: share counts the miss');
    /* a reload keeps the won day and retells the groups that never shipped */
    const sfR = h.boot('sift', EXP,
      { now: T0, store: sfDst, servePuzzle: sfServed, stubBanks: true });
    await h.flush();
    h.eq(sfR.x.S.status, 'won', 'sift dealt: a reload keeps the won day');
    h.ok(String(sfR.env.els.found.innerHTML).indexOf(sfFull.cats[3].n) >= 0,
      'sift dealt: the reload retells the groups that never shipped');
    /* the fourth miss spends the day: the reveal seats the cats the
       served day never carried */
    let sfMisses2 = 0;
    const sfDealer2 = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'sf2', today: 0, puzzle: sfServed.puzzle } };
      sfMisses2++;
      if (sfMisses2 >= 4)
        return { status: 200, body: { verdict: 'lost',
          reveal: { t: sfFull.t, cats: sfFull.cats } } };
      return { status: 200, body: { verdict: 'miss', mistakes: sfMisses2 } };
    };
    const sfLst = {};
    const sfL = h.boot('sift', EXP,
      { now: T0, store: sfLst, servePuzzle: sfServed, stubBanks: true, serveDealt: sfDealer2 });
    await h.flush();
    const sfWrong = [[0,0,0],[1,0,0],[0,1,0],[0,0,1]];
    for (let k = 0; k < 4; k++){
      sfL.x.sel.clear();
      sfWrong[k].forEach((t, ci) => sfL.x.sel.add(sfIdx(ci)[t])); /* a fresh trio each miss: the repeat guard wants four different picks */
      sfL.env.els.btnSubmit.click();
      await h.flush();
    }
    h.eq(sfL.x.S.status, 'lost', 'sift dealt: the fourth miss spent the day');
    h.ok((sfL.env.els.tiles.innerHTML.match(/tile dim/g) || []).length === 12,
      'sift dealt: the reveal dims the whole board');
    h.ok(String(sfL.env.els.verdict.textContent).indexOf('Sifted out') >= 0,
      'sift dealt: the loss tells its verdict');
    /* a reload of the lost day replays the reveal it never shipped */
    const sfLR = h.boot('sift', EXP,
      { now: T0, store: sfLst, servePuzzle: sfServed, stubBanks: true });
    await h.flush();
    h.eq(sfLR.x.S.status, 'lost', 'sift dealt: a reload keeps the lost day');
    h.ok((sfLR.env.els.tiles.innerHTML.match(/tile dim/g) || []).length === 12,
      'sift dealt: the reload replays the reveal dimming');
    /* an archive replay keeps the local path: the banked day still
       carries its groups and nothing posts */
    const sfRe = h.boot('sift', EXP, { now: T1, store: {}, search: '?d=0' });
    const sfReIdx = c => sfRe.x.TILES.map((t, i) => ({ t, i }))
      .filter(o => o.t.cat === c).map(o => o.i);
    for (const c of [0, 1, 2, 3]){
      sfReIdx(c).forEach(i => sfRe.x.sel.add(i));
      sfRe.env.els.btnSubmit.click();
    }
    h.eq(sfRe.x.S.status, 'won', 'sift dealt: the replay wins locally on the banked day');
    await h.flush();
    h.eq(sfRe.env.fetchLog.length, 0, 'sift dealt: a replay posts nothing');
}

module.exports = { name: 'sift', run };
