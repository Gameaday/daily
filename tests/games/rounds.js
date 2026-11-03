/* rounds - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'EV', 'shareText'];
    const store = {};
    let r = h.boot('rounds', EXP, { now: T0, store });
    h.eq(r.x.EV.y, 1215, 'rounds: day 0 = Magna Carta 1215');
    r.env.els.slider.value = '1215';
    r.env.els.btnLock.click();
    h.eq(r.x.S.status, 'won', 'rounds: won first try');
    await h.flush();
    const p = h.lastPost(r.env).body;
    h.eq(p.status, 'won', 'rounds: the won status rides the wire');
    h.eq(p.answer, 1215, 'rounds: the winning year rides the wire');
    h.eq(p.meta.guesses, 1, 'rounds: one guess rides the wire');
    h.ok(r.x.shareText().indexOf('1\u2605') >= 0, 'rounds: the first-try star rides the share');
    r = h.boot('rounds', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'rounds: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'rounds: streak preserved');
    const s2 = {};
    r = h.boot('rounds', EXP, { now: T0, store: s2 });
    r.env.els.slider.value = '1750';
    r.env.els.btnUp.click();
    h.eq(+r.env.els.slider.value, 1751, 'rounds: the + stepper moves one year');
    r.env.els.btnDown.click();
    r.env.els.btnDown.click();
    h.eq(+r.env.els.slider.value, 1749, 'rounds: the - stepper moves one year');
    r.env.els.slider.value = '2020';
    for (let i = 0; i < 6; i++) r.env.els.btnLock.click();
    h.eq(r.x.S.status, 'lost', 'rounds: lost after 6 wrong');
    h.eq(r.env.els.guesses.innerHTML.indexOf('years off') === -1, true, 'rounds: no years-off leak');
    h.eq(r.env.els.guesses.innerHTML.indexOf('go earlier') !== -1, true, 'rounds: direction still shown');
    h.eq(r.env.els.guesses.innerHTML.indexOf('wrong century') !== -1, true, 'rounds: century nudge shown');
    await h.flush();
    const q = h.lastPost(r.env).body;
    h.eq(q.status, 'lost', 'rounds: a loss posts the lost status');
    h.eq(q.meta.guesses, 6, 'rounds: six guesses ride the wire');

    /* --- the online live day is dealt: the served puzzle carries no key,
       so the round runs on a session and the server counts and grades --- */
    {
      const seen = [];
      const serveDealt = (url, body) => {
        if (/\/deal$/.test(url))
          return { status: 200, body: { nonce: 'rn0', today: 0,
            puzzle: { t: 'England', q: 'King John seals the Magna Carta at Runnymede.' } } };
        seen.push(body);
        if (body.move.y === 1215)
          return { status: 200, body: { verdict: 'won', guesses: seen.length,
            reveal: { y: 1215, w: 'Runnymede, June 1215 - the king first put his seal under the law.' } } };
        return { status: 200, body: { verdict: 'miss', guesses: seen.length,
          heat: 'cold', sq: '\uD83D\uDFE5', hint: 'go earlier \u00b7 wrong century' } };
      };
      const served = { game: 'rounds', day: 0, today: 0,
        puzzle: { t: 'England', q: 'King John seals the Magna Carta at Runnymede.' } };
      const r = h.boot('rounds', ['S', 'EV'], { now: T0, store: {}, stubBanks: true,
        servePuzzle: served, serveDealt });
      await h.flush();
      /* the harness snapshots exposed values at script end, while the
     served puzzle is still in flight - so the key-less arrival is pinned
     by what renders, and by the dealt flow the page takes below because
     it holds no key */
  h.ok(r.env.els.qtag.textContent === 'England', 'dealt: the served question renders');
      r.env.els.slider.value = '1900';
      r.env.els.btnLock.click();
      await h.flush();
      h.eq(r.x.S.guesses.length, 1, 'dealt: the server counts the first guess');
      h.ok(r.env.els.guesses.innerHTML.indexOf('go earlier') >= 0, 'dealt: the server hint renders');
      r.env.els.slider.value = '1215';
      r.env.els.btnLock.click();
      await h.flush();
      h.eq(r.x.S.status, 'won', 'dealt: the server verdict wins the round');
      h.eq(seen.length, 2, 'dealt: two guesses crossed the wire');
      h.eq(seen[0].nonce, 'rn0', 'dealt: a guess names its session');
      const p = h.lastPost(r.env).body;
      h.eq(p.nonce, 'rn0', 'dealt: the submit names the session');
      h.eq(p.answer, 1215, 'dealt: the revealed year is the answer');
      const again = h.boot('rounds', ['S', 'EV'], { now: T0, store: r.env.store,
        stubBanks: true, servePuzzle: served });
      await h.flush();
      h.eq(again.x.S.status, 'won', 'dealt: the finished round survives the reload');
      h.ok(again.env.els.why.textContent.indexOf('Runnymede') >= 0,
        'dealt: the reveal retells without the key shipping again');
    }

    /* --- a replayed day still grades locally and never touches the wire --- */
    {
      const r = h.boot('rounds', ['S', 'EV'], { now: T1, store: {}, search: '?d=0' });
      await h.flush();
      h.ok(r.x.EV.y === 1215, 'replay: a past day keeps its key');
      r.env.els.slider.value = '1215';
      r.env.els.btnLock.click();
      h.eq(r.x.S.status, 'won', 'replay: the replayed round grades locally');
      await h.flush();
      h.eq(r.env.fetchLog.length, 0, 'replay: a replay never posts');
    }
}

module.exports = { name: 'rounds', run };
