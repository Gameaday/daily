/* thread - headless playthrough (win, give-up, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1 } = require('./_lib');

async function run(h){
    const EXP = ['PZ', 'S', 'shareText'];
    const store = {};
    let r = h.boot('thread', EXP, { now: T0, store });
    h.ok(!!r.x.PZ.s && !!r.x.PZ.e, 'thread: day-0 puzzle boots');
    const k = r.x.PZ.m.length;
    h.ok(k >= 2 && k <= 4, 'thread: 2-4 middles');
    h.eq(r.x.PZ.d.length, 2, 'thread: two decoys');
    const ids = [r.x.PZ.s.id, r.x.PZ.e.id]
      .concat(r.x.PZ.m.map(x => x.id), r.x.PZ.d.map(x => x.id));
    h.eq(new Set(ids).size, ids.length, 'thread: offered ids are distinct');
    const day0 = JSON.stringify(r.x.PZ);
    r.x.S.slots = r.x.PZ.m.map(x => x.id);
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'thread: won in one check');
    h.eq(r.x.S.checks, 1, 'thread: checks = 1');
    await h.flush();
    const p = h.lastPost(r.env).body;
    h.eq(p.status, 'won', 'thread: the won status rides the wire');
    h.eq(p.answer.join(','), [r.x.PZ.s.id].concat(r.x.PZ.m.map(x => x.id), [r.x.PZ.e.id]).join(','),
      'thread: the chain ids ride the wire');
    h.eq(p.meta.checks, 1, 'thread: one check rides the wire');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'thread: the first-check star rides the share');
    h.ok(r.x.shareText().indexOf('1 check') >= 0, 'thread: share "1 check"');
    r = h.boot('thread', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'thread: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'thread: streak preserved');
    const s2 = {};
    r = h.boot('thread', EXP, { now: T0, store: s2 });
    r.env.els.btnGiveUp.click();
    h.eq(r.x.S.status, 'gaveup', 'thread: gaveup status');
    h.eq(r.x.S.slots.join(','), r.x.PZ.m.map(x => x.id).join(','),
      'thread: give-up lays out the true chain');
    await h.flush();
    const q = h.lastPost(r.env).body;
    h.eq(q.status, 'gave', 'thread: a give-up posts the gave status');
    h.eq(q.meta.checks, 0, 'thread: zero checks ride the wire');
    h.ok(String(r.env.els.chainbox.innerHTML).length > 0, 'thread: reveal renders the chain');
    const TPRE = T0 - 3 * 86400000;
    r = h.boot('thread', EXP, { now: TPRE, store: {} });
    h.ok(!!r.x.PZ.s, 'thread: pre-launch day boots a chain');
    h.eq(r.x.S.day, 0, 'thread: pre-launch day clamps to day 0');
    h.eq(JSON.stringify(r.x.PZ), day0, 'thread: pre-launch plays the No. 1 chain');

    /* --- dealt play: the live day ships its figures as one shuffled tray
           without the chain, the decoy split or the links, so the chain
           grades at the session and the reveal rides the spent round --- */
    const thFull = h.boot('thread', ['PZ'], { now: T0, store: {} });
    const thPz = thFull.x.PZ;
    const thMids = thPz.m.map(x => x.id);
    const thDids = thPz.d.map(x => x.id);
    const thById = {};
    [thPz.s, thPz.e].concat(thPz.m, thPz.d).forEach(nd => { thById[nd.id] = nd; });
    /* every dealt boot serves its own fresh strip: the reveal folds the
       chain back into the page, so no fixture is shared across boots */
    const thServed = () => ({ day: 0, today: 0,
      puzzle: { s: thPz.s, e: thPz.e, k: thMids.length,
        tray: thMids.concat(thDids).map(id => thById[id]) } });
    let thChecks = 0;
    const thDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'gth1', today: 0, puzzle: thServed().puzzle } };
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave',
          reveal: { m: thMids, d: thDids, links: thPz.links } } };
      thChecks++;
      const lock = body.move.chain.map((v, i) => v === thMids[i]);
      if (lock.every(Boolean))
        return { status: 200, body: { verdict: 'won', checks: thChecks,
          reveal: { m: thMids, d: thDids, links: thPz.links } } };
      return { status: 200, body: { verdict: 'miss',
        right: lock.filter(Boolean).length, lock, checks: thChecks } };
    };
    const thStore = {};
    const r2 = h.boot('thread', ['S', 'PZ', 'THREAD'],
      { now: T0, store: thStore, servePuzzle: thServed(), stubBanks: true, serveDealt: thDealer });
    h.ok(r2.x.THREAD === undefined, 'thread: dealt online boot has no bank');
    await h.flush();
    h.ok(r2.x.PZ.m === undefined && r2.x.PZ.links === undefined,
      'thread: the dealt day never ships its chain');
    h.eq(r2.x.PZ.k, thMids.length, 'thread: the dealt strip counts its slots');
    h.eq(r2.x.S.tray.length, thMids.length + thDids.length,
      'thread: the tray holds the offered set');
    h.ok(String(r2.env.els.lane.innerHTML).indexOf(thPz.s.n) >= 0,
      'thread: the dealt ends render');
    r2.x.S.slots = [thDids[0]].concat(thMids.slice(1));
    r2.env.els.btnCheck.click();
    await h.flush();
    h.eq(r2.x.S.status, 'playing', 'thread: a wrong chain keeps the day open');
    h.eq(r2.x.S.checks, 1, 'thread: the session metered one check');
    h.eq(r2.x.S.locked.join(','),
      [false].concat(thMids.slice(1).map(() => true)).join(','),
      'thread: the session locked the figures that stand');
    h.eq(r2.env.els.toast.textContent,
      (thMids.length - 1) + ' of ' + thMids.length + ' in place',
      'thread: the session told how many figures stand');
    r2.x.S.slots = thMids.slice();
    r2.env.els.btnCheck.click();
    await h.flush();
    h.eq(r2.x.S.status, 'won', 'thread: won on the dealt tray');
    h.eq(r2.x.S.nonce, 'gth1', 'thread: the dealt session is held');
    h.eq(r2.x.S.checks, 2, 'thread: the session metered both checks');
    h.eq(r2.x.PZ.m.map(x => x.id).join(','), thMids.join(','),
      'thread: the chain arrived only with the reveal');
    h.ok(String(r2.env.els.chainbox.innerHTML).indexOf(thPz.links[0].w) >= 0,
      'thread: the links arrived only with the reveal');
    const thp = h.lastPost(r2.env).body;
    h.eq(thp.nonce, 'gth1', 'thread: the evidence names its session');
    h.eq(thp.status, 'won', 'thread: the won status rides the wire');
    h.eq(thp.answer.join(','), [thPz.s.id].concat(thMids, [thPz.e.id]).join(','),
      'thread: the chain ids ride the wire');
    h.eq(thp.meta.checks, 2, 'thread: the session check meter rides the wire');
    const r3 = h.boot('thread', ['S', 'PZ'], { now: T0, store: thStore,
      servePuzzle: thServed(), stubBanks: true, serveDealt: thDealer });
    await h.flush();
    h.eq(r3.x.S.status, 'won', 'thread: the won dealt day survives the reload');
    h.eq(r3.x.PZ.m.map(x => x.id).join(','), thMids.join(','),
      'thread: the kept reveal retells the chain on reload');
    h.ok(String(r3.env.els.chainbox.innerHTML).indexOf(thPz.links[0].w) >= 0,
      'thread: the kept reveal renders the chain on reload');
    const thStore2 = {};
    const r4 = h.boot('thread', ['S'], { now: T0, store: thStore2,
      servePuzzle: thServed(), stubBanks: true, serveDealt: thDealer });
    await h.flush();
    r4.env.els.btnGiveUp.click();
    await h.flush();
    h.eq(r4.x.S.status, 'gaveup', 'thread: gave up on the dealt day');
    h.eq(r4.x.S.slots.join(','), thMids.join(','),
      'thread: the give-up lays the chain out in order');
    const thq = h.lastPost(r4.env).body;
    h.eq(thq.status, 'gave', 'thread: the give-up posts the gave status');
    h.eq(thq.nonce, 'gth1', 'thread: the give-up names its session');
    /* --- an expired session no longer refunds the checks: a mid-thread
       expiry reseats the spent check and the chain still wins --- */
    let thXDeals = 0, thXChecks = 0;
    const thXDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        thXDeals++;
        thXChecks = 0;
        return { status: 200, body: { nonce: 'gthx' + thXDeals, today: 0, puzzle: thServed().puzzle } };
      }
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave',
          reveal: { m: thMids, d: thDids, links: thPz.links } } };
      if (thXDeals === 1 && thXChecks >= 1)
        return { status: 410, body: {} };
      thXChecks++;
      const lock = body.move.chain.map((v, i) => v === thMids[i]);
      if (lock.every(Boolean))
        return { status: 200, body: { verdict: 'won', checks: thXChecks,
          reveal: { m: thMids, d: thDids, links: thPz.links } } };
      return { status: 200, body: { verdict: 'miss',
        right: lock.filter(Boolean).length, lock, checks: thXChecks } };
    };
    const thXStore = {};
    const thX = h.boot('thread', ['S', 'PZ'],
      { now: T0, store: thXStore, servePuzzle: thServed(), stubBanks: true, serveDealt: thXDealer });
    await h.flush();
    thX.x.S.slots = [thDids[0]].concat(thMids.slice(1));
    thX.env.els.btnCheck.click();
    await h.flush();
    h.eq(thX.x.S.checks, 1, 'thread reseat: one check spent');
    h.eq(thX.x.S.nonce, 'gthx1', 'thread reseat: the first session is held');
    thX.x.S.slots = thMids.slice();
    thX.env.els.btnCheck.click();
    await h.flush(); await h.flush(); await h.flush();
                    /* expiry, then the reseat replays the spent check */
    h.eq(thX.x.S.checks, 1, 'thread reseat: the spent check survives the expiry');
    h.eq(thX.x.S.nonce, 'gthx2', 'thread reseat: the thread reseats onto a fresh session');
    h.eq(thXDeals, 2, 'thread reseat: exactly one redeal');
    h.eq(thXChecks, 1, 'thread reseat: the replay re-metered the check');
    thX.env.els.btnCheck.click();
    await h.flush(); await h.flush();
    h.eq(thX.x.S.status, 'won', 'thread reseat: the chain wins on the reseeded session');
    const thXp = h.lastPost(thX.env).body;
    h.eq(thXp.nonce, 'gthx2', 'thread reseat: the evidence names the reseeded session');
    h.eq(thXp.meta.checks, 2, 'thread reseat: the evidence carries the re-metered checks');
    /* an archive replay carries the full chain again and never touches the
       dealt endpoints */
    const r5 = h.boot('thread', ['S'], { now: T1, store: {},
      servePuzzle: { day: 0, today: 1, puzzle: thPz }, search: '?d=0', stubBanks: true });
    await h.flush();
    h.eq(r5.x.S.day, 0, 'thread: the archive view plays day 0');
    r5.x.S.slots = thMids.slice();
    r5.env.els.btnCheck.click();
    await h.flush();
    h.eq(r5.x.S.status, 'won', 'thread: the archive replay wins locally');
    h.eq(r5.env.fetchLog.length, 0,
      'thread: a replay never touches the dealt endpoints');
}

module.exports = { name: 'thread', run };
