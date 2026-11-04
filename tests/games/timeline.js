/* timeline - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'PICK', 'SORTED', 'shareText'];
    const store = {};
    let r = h.boot('timeline', EXP, { now: T0, store });
    h.eq(r.x.PICK.length, 5, 'timeline: 5 events picked');
    r.x.S.order = r.x.SORTED.map(idx => r.x.PICK.indexOf(idx));
    r.env.els.btnCheck.click();
    h.eq(r.x.S.status, 'won', 'timeline: won in one check');
    h.eq(r.x.S.checks, 1, 'timeline: checks = 1');
    await h.flush();
    const p = h.lastPost(r.env).body;
    h.eq(p.status, 'won', 'timeline: the won status rides the wire');
    h.eq(p.answer.length, 5, 'timeline: five years ride the wire');
    h.ok(p.answer.every((v, i) => i === 0 || p.answer[i - 1] < v),
      'timeline: the years ride up the wire');
    h.eq(p.meta.checks, 1, 'timeline: one check rides the wire');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'timeline: the first-check star rides the share');
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
    const q = h.lastPost(r.env).body;
    h.eq(q.status, 'gave', 'timeline: a give-up posts the gave status');
    h.eq(q.meta.checks, 0, 'timeline: zero checks ride the wire');

    /* the checks budget: one more check than cards. Six deranged
       orders, no card ever right, and the sixth miss spends the day */
    const s2c = {};
    r = h.boot('timeline', EXP, { now: T0, store: s2c });
    const win0 = r.x.SORTED.map(i => r.x.PICK.indexOf(i));
    const ders = [[1,2,3,4,0],[2,3,4,0,1],[3,4,0,1,2],[4,0,1,2,3],[1,0,3,4,2],[2,3,0,4,1]];
    for (const d of ders){
      r.x.S.order = d.map(i => win0[i]);
      r.env.els.btnCheck.click();
    }
    h.eq(r.x.S.status, 'lost', 'timeline: the local sixth miss spends the day');
    h.eq(r.x.S.checks, 6, 'timeline: the local budget was six checks');
    h.eq(r.x.S.order.join(','), win0.join(','),
      'timeline: the lost day lays the order out');
    await h.flush();
    const lp = h.lastPost(r.env).body;
    h.eq(lp.status, 'lost', 'timeline: the local lost status rides the wire');
    h.eq(lp.meta.checks, 6, 'timeline: the spent budget rides the wire');
    h.ok(String(r.env.els.lane.innerHTML).indexOf('????') < 0,
      'timeline: the lost day reveals its years');

    /* drag-to-reorder: the move the pointer handlers drive */
    const s3 = {};
    r = h.boot('timeline', ['S', 'PICK', 'SORTED', 'moveCard'], { now: T0, store: s3 });
    const a = r.x.S.order.slice();
    h.ok(r.x.moveCard(0, 2), 'timeline: drag drops a card into a new slot');
    h.eq(r.x.S.order[2], a[0], 'timeline: the dragged card lands at its slot');
    h.eq(r.x.S.order[0], a[1], 'timeline: the run between shifts down');
    h.eq(r.x.S.order[1], a[2], 'timeline: the run between shifts down');
    h.eq(r.x.S.order[3], a[3], 'timeline: the tail stays put');
    h.eq(r.x.S.order[4], a[4], 'timeline: the tail stays put');
    h.ok(!r.x.moveCard(1, 1), 'timeline: a drop back in its own slot is a no-op');
    r.x.S.locked[1] = true;
    h.ok(!r.x.moveCard(0, 2), 'timeline: a locked card blocks the drag across it');
    h.eq(r.x.S.order[2], a[0], 'timeline: a blocked drag changes nothing');
    h.ok(r.x.moveCard(2, 4), 'timeline: a drag past the lock still works');
    h.ok(r.x.S.started, 'timeline: a drag marks the day started');
    r.env.els.btnGiveUp.click();
    h.ok(!r.x.moveCard(0, 2), 'timeline: no dragging after the day is done');

    /* --- dealt play: the live day ships its events without their years,
           so the order grades at the session and the reveal rides the
           spent round --- */
    const tlFull = h.boot('timeline', ['EVO'], { now: T0, store: {} });
    const tlEvents = tlFull.x.EVO;
    /* every dealt boot serves its own fresh strip: the reveal folds the
       won years into the served events, so a shared fixture would carry
       the years into the next boot and read as undealt */
    const tlServed = () => ({ day: 0, today: 0,
      puzzle: { events: tlEvents.map(e => ({ t: e.t, q: e.q })) } });
    const tlWant = tlEvents.map((e, i) => i)
      .sort((a, b) => tlEvents[a].y - tlEvents[b].y);
    let tlChecks = 0;
    const tlDealer = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'tl1', today: 0, puzzle: tlServed().puzzle } };
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave', reveal: { events: tlEvents } } };
      tlChecks++;
      const lock = body.move.order.map((v, i) => v === tlWant[i]);
      if (lock.every(Boolean))
        return { status: 200, body: { verdict: 'won', checks: tlChecks,
          reveal: { events: tlEvents } } };
      return { status: 200, body: { verdict: 'miss',
        right: lock.filter(Boolean).length, lock, checks: tlChecks } };
    };
    const tlStore = {};
    const r2 = h.boot('timeline', ['S', 'EVENTS'],
      { now: T0, store: tlStore, servePuzzle: tlServed(), stubBanks: true, serveDealt: tlDealer });
    h.ok(r2.x.EVENTS === undefined, 'timeline: dealt online boot has no bank');
    await h.flush();
    h.ok(String(r2.env.els.lane.innerHTML).indexOf('????') >= 0,
      'timeline: the dealt lane never shows a year');
    const tlWrong = tlWant.slice();
    [tlWrong[0], tlWrong[1]] = [tlWrong[1], tlWrong[0]];
    r2.x.S.order = tlWrong.slice();
    r2.env.els.btnCheck.click();
    await h.flush();
    h.eq(r2.x.S.status, 'playing', 'timeline: a wrong order keeps the day open');
    h.eq(r2.x.S.checks, 1, 'timeline: the session metered one check');
    h.eq(r2.x.S.locked.join(','), [false, false, true, true, true].join(','),
      'timeline: the session locked the cards that stand');
    h.eq(r2.env.els.toast.textContent, '3 cards are in the right place',
      'timeline: the session told how many cards stand');
    h.ok(String(r2.env.els.lane.innerHTML).indexOf('????') >= 0,
      'timeline: a locked card still never leaks its year');
    r2.x.S.order = tlWant.slice();
    r2.env.els.btnCheck.click();
    await h.flush();
    h.eq(r2.x.S.status, 'won', 'timeline: won on the dealt events');
    h.eq(r2.x.S.nonce, 'tl1', 'timeline: the dealt session is held');
    h.eq(r2.x.S.checks, 2, 'timeline: the session metered both checks');
    h.ok(String(r2.env.els.lane.innerHTML).indexOf('????') < 0,
      'timeline: the years arrived only with the reveal');
    const tlp = h.lastPost(r2.env).body;
    h.eq(tlp.nonce, 'tl1', 'timeline: the evidence names its session');
    h.eq(tlp.meta.checks, 2, 'timeline: the session check meter rides the wire');
    h.ok(tlp.answer.every((v, i) => i === 0 || tlp.answer[i - 1] <= v),
      'timeline: the years ride up the wire');
    const r3 = h.boot('timeline', ['S'], { now: T0, store: tlStore,
      servePuzzle: tlServed(), stubBanks: true, serveDealt: tlDealer });
    await h.flush();
    h.eq(r3.x.S.status, 'won', 'timeline: the won dealt day survives the reload');
    h.ok(String(r3.env.els.lane.innerHTML).indexOf('????') < 0,
      'timeline: the kept reveal retells the years on reload');
    const tlStore2 = {};
    const r4 = h.boot('timeline', ['S'], { now: T0, store: tlStore2,
      servePuzzle: tlServed(), stubBanks: true, serveDealt: tlDealer });
    await h.flush();
    r4.env.els.btnGiveUp.click();
    await h.flush();
    h.eq(r4.x.S.status, 'gaveup', 'timeline: gave up on the dealt day');
    h.eq(r4.x.S.order.join(','), tlWant.join(','),
      'timeline: the give-up lays the years out in order');
    h.ok(String(r4.env.els.lane.innerHTML).indexOf('????') < 0,
      'timeline: the give-up reveals the years');
    const tlq = h.lastPost(r4.env).body;
    h.eq(tlq.status, 'gave', 'timeline: the give-up posts the gave status');
    h.eq(tlq.nonce, 'tl1', 'timeline: the give-up names its session');
    /* the dealt budget: the sixth miss spends the day at the session
       and the years ride the lost round */
    let tlChecks2 = 0;
    const tlDealer2 = (url, body) => {
      if (/\/deal$/.test(url))
        return { status: 200, body: { nonce: 'tl2', today: 0, puzzle: tlServed().puzzle } };
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave', reveal: { events: tlEvents } } };
      tlChecks2++;
      const lock = body.move.order.map((v, i) => v === tlWant[i]);
      if (lock.every(Boolean))
        return { status: 200, body: { verdict: 'won', checks: tlChecks2,
          reveal: { events: tlEvents } } };
      if (tlChecks2 >= 6)
        return { status: 200, body: { verdict: 'lost', checks: tlChecks2,
          reveal: { events: tlEvents } } };
      return { status: 200, body: { verdict: 'miss',
        right: lock.filter(Boolean).length, lock, checks: tlChecks2 } };
    };
    const tlStore3 = {};
    const r6 = h.boot('timeline', ['S'],
      { now: T0, store: tlStore3, servePuzzle: tlServed(), stubBanks: true, serveDealt: tlDealer2 });
    await h.flush();
    const tlWin = tlWant.slice();
    const tlDers = [[1,2,3,4,0],[2,3,4,0,1],[3,4,0,1,2],[4,0,1,2,3],[1,0,3,4,2],[2,3,0,4,1]];
    for (const d of tlDers){
      r6.x.S.order = d.map(i => tlWin[i]);
      r6.env.els.btnCheck.click();
      await h.flush();
    }
    h.eq(r6.x.S.status, 'lost', 'timeline: the dealt sixth miss spends the day');
    h.eq(r6.x.S.checks, 6, 'timeline: the dealt budget was six checks');
    h.eq(r6.x.S.order.join(','), tlWant.join(','),
      'timeline: the lost dealt day lays the order out');
    h.ok(String(r6.env.els.lane.innerHTML).indexOf('????') < 0,
      'timeline: the years arrived only with the lost reveal');
    const tlp6 = h.lastPost(r6.env).body;
    h.eq(tlp6.status, 'lost', 'timeline: the lost status rides the wire');
    h.eq(tlp6.meta.checks, 6, 'timeline: the session check meter rides the wire');
    h.eq(tlp6.nonce, 'tl2', 'timeline: the lost evidence names its session');
    /* --- an expired session no longer refunds the checks: a mid-lane
       expiry reseats the spent check and the order still wins --- */
    let tlXDeals = 0, tlXChecks = 0;
    const tlXDealer = (url, body) => {
      if (/\/deal$/.test(url)){
        tlXDeals++;
        tlXChecks = 0;
        return { status: 200, body: { nonce: 'tlx' + tlXDeals, today: 0, puzzle: tlServed().puzzle } };
      }
      if (body.move.give !== undefined)
        return { status: 200, body: { verdict: 'gave', reveal: { events: tlEvents } } };
      if (tlXDeals === 1 && tlXChecks >= 1)
        return { status: 410, body: {} };  /* the session dies on the second check */
      tlXChecks++;
      const lock = body.move.order.map((v, i) => v === tlWant[i]);
      if (lock.every(Boolean))
        return { status: 200, body: { verdict: 'won', checks: tlXChecks,
          reveal: { events: tlEvents } } };
      return { status: 200, body: { verdict: 'miss',
        right: lock.filter(Boolean).length, lock, checks: tlXChecks } };
    };
    const tlXStore = {};
    const tlX = h.boot('timeline', ['S'],
      { now: T0, store: tlXStore, servePuzzle: tlServed(), stubBanks: true, serveDealt: tlXDealer });
    await h.flush();
    const tlXWrong = tlWant.slice();
    [tlXWrong[0], tlXWrong[1]] = [tlXWrong[1], tlXWrong[0]];
    tlX.x.S.order = tlXWrong.slice();
    tlX.env.els.btnCheck.click();
    await h.flush();
    h.eq(tlX.x.S.checks, 1, 'timeline reseat: one check spent');
    h.eq(tlX.x.S.nonce, 'tlx1', 'timeline reseat: the first session is held');
    tlX.x.S.order = tlWant.slice();       /* the right order, but the session dies */
    tlX.env.els.btnCheck.click();
    await h.flush(); await h.flush(); await h.flush();
                    /* expiry -> the reseat replays the spent check */
    h.eq(tlX.x.S.checks, 1, 'timeline reseat: the spent check survives the expiry');
    h.eq(tlX.x.S.nonce, 'tlx2', 'timeline reseat: the lane reseats onto a fresh session');
    h.eq(tlXDeals, 2, 'timeline reseat: exactly one redeal');
    h.eq(tlXChecks, 1, 'timeline reseat: the replay re-metered the check');
    tlX.env.els.btnCheck.click();
    await h.flush(); await h.flush();
    h.eq(tlX.x.S.status, 'won', 'timeline reseat: the order wins on the reseeded session');
    const tlXp = h.lastPost(tlX.env).body;
    h.eq(tlXp.nonce, 'tlx2', 'timeline reseat: the evidence names the reseeded session');
    h.eq(tlXp.meta.checks, 2, 'timeline reseat: the evidence carries the re-metered checks');

    /* an archive replay carries the years again and never touches the
       dealt endpoints */
    const tlArc = { day: 0, today: 1, puzzle: { events: tlEvents } };
    const r5 = h.boot('timeline', ['S'],
      { now: T1, store: {}, servePuzzle: tlArc, search: '?d=0', stubBanks: true });
    await h.flush();
    h.eq(r5.x.S.day, 0, 'timeline: the archive view plays day 0');
    r5.x.S.order = tlWant.slice();
    r5.env.els.btnCheck.click();
    await h.flush();
    h.eq(r5.x.S.status, 'won', 'timeline: the archive replay wins locally');
    h.eq(r5.env.fetchLog.length, 0,
      'timeline: a replay never touches the dealt endpoints');
}

module.exports = { name: 'timeline', run };
