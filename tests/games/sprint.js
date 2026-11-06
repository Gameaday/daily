/* sprint - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');
/* the server's word list, pinned byte-identical to the page's CSVs
   below - the count the server derives is only honest if its dictionary
   accepts exactly what the player's page accepts */
const WORDS_JSON = require('../../scores/sprint_words.json');

async function run(h, ctx){
    const EXP = ['S', 'targets', 'ANA4', 'ANA5', 'shareText'];
    const store = {};
    let r = h.boot('sprint', EXP, { now: T0, store });
    h.eq(r.x.targets.length, 5, 'sprint: 5 targets');
    h.eq(r.x.targets.join(','), 'HIPS,ACENO,EORTU,ABDIR,ABDER',
         'sprint: day 0 letter sets are the pinned day (server ports the same pick)');
    /* the dictionaries ship as data: the page's CSVs and the server's
       word list must stay byte-identical, or the server's count drifts
       from the page's accept bar */
    {
      const page = ctx.readGame('sprint');
      h.ok(page.indexOf("const DICT_SRC = '" + WORDS_JSON.words4 + "'") >= 0,
           'sprint: the 4-letter CSV is byte-identical to the server word list');
      h.ok(page.indexOf("const DICT5_SRC = '" + WORDS_JSON.words5 + "'") >= 0,
           'sprint: the 5-letter CSV is byte-identical to the server word list');
    }
    /* the gate: the first anagram waits behind Start, and the clock, the
       letters and the server stamp all begin together */
    h.eq(r.env.els.wordbox.style.display, 'none', 'sprint: the gate hides the letters at boot');
    h.ok(!r.x.S.startAt, 'sprint: the clock holds before Start');
    r.env.els.btnStart.click();
    h.ok(r.x.S.startAt, 'sprint: Start begins the clock');
    h.eq(r.env.els.startgate.style.display, 'none', 'sprint: Start puts the gate away');
    h.ok(r.env.els.scramble.textContent.length >= 4, 'sprint: Start reveals the first anagram');
    const typed = [];
    for (let k = 0; k < 5; k++){
      const key = r.x.targets[k];
      const word = [...(key.length === 4 ? r.x.ANA4 : r.x.ANA5).get(key)][0];
      typed.push(word);
      r.env.els.guess.value = word;
      r.env.els.guess.dispatch('keydown', { key: 'Enter' });
    }
    h.eq(r.x.S.status, 'won', 'sprint: won all five');
    h.eq(r.x.S.solvedCount, 5, 'sprint: solvedCount 5');
    await h.flush();
    const post0 = h.lastPost(r.env).body;
    h.eq(post0.answer.join(','), typed.join(','),
         'sprint: the finish posts the solved words as evidence');
    h.ok(!('value' in post0), 'sprint: the client never names a number');
    h.eq((r.x.S.words || []).join(','), typed.join(','), 'sprint: solved-word list matches typed');
    h.ok(r.x.shareText().indexOf('5/5') >= 0, 'sprint: share 5/5');
    h.eq(r.x.S.stars, 3, 'sprint: a full-speed sweep earns all three clock stars');
    h.ok(r.x.shareText().indexOf('3\u2605') >= 0, 'sprint: the share text carries the stars');
    r = h.boot('sprint', EXP, { now: T1, store });
    h.ok(!r.x.S.startAt, 'sprint: a new day waits behind the gate again');
    r.env.els.btnStart.click();
    h.eq(r.x.S.day, 1, 'sprint: day rolled');
    h.eq(r.x.targets.join(','), 'ENST,BELOW,AEHST,AGMNO,EEGNR',
         'sprint: day 1 letter sets are the pinned day');
    h.eq(r.x.S.stats.streak, 1, 'sprint: streak preserved');
    const s3 = {};
    r = h.boot('sprint', EXP, { now: T0, store: s3 });
    r.env.els.btnStart.click();
    h.eq(r.env.els.btnShuffle.style.display, 'none', 'sprint: shuffle hidden before twenty seconds');
    const before = r.env.els.scramble.textContent;
    r.env.els.btnShuffle.click();
    h.ok(r.env.els.scramble.textContent !== before, 'sprint: shuffle re-scrambles the word');
    h.eq([...r.env.els.scramble.textContent].sort().join(''), [...before].sort().join(''), 'sprint: shuffle keeps the same letters');

    /* --- the online live day is dealt: Start deals a session, /reveal
       stamps the server clock once, and the finish names the session so
       the window is the server's --- */
    {
      let deals = 0, reveals = 0;
      const serveDealt = (url) => {
        if (/\/deal$/.test(url)){ deals++; return { status: 200, body: { nonce: 'sp1', today: 0 } }; }
        reveals++;
        return { status: 200, body: { ok: true, elapsed: 0, window: 90 } };
      };
      const r = h.boot('sprint', EXP, { now: T0, store: {}, serveDealt });
      r.env.els.btnStart.click();
      await h.flush();
      h.eq(r.x.S.nonce, 'sp1', 'dealt: Start deals the session');
      h.eq(r.x.S.stamped, 1, 'dealt: the server stamps the starting gun');
      for (let k = 0; k < 5; k++){
        const key = r.x.targets[k];
        const word = [...(key.length === 4 ? r.x.ANA4 : r.x.ANA5).get(key)][0];
        r.env.els.guess.value = word;
        r.env.els.guess.dispatch('keydown', { key: 'Enter' });
        await h.flush();
      }
      h.eq(r.x.S.status, 'won', 'dealt: the sweep still wins');
      h.eq(deals, 1, 'dealt: exactly one deal');
      h.eq(reveals, 1, 'dealt: exactly one reveal - the stamp never re-fires');
      const p = h.lastPost(r.env).body;
      h.eq(p.answer.length, 5, 'dealt: the finish posts its five words');
      h.ok(!('value' in p), 'dealt: the dealt finish never names a number');
      h.eq(p.nonce, 'sp1', 'dealt: the finish names the session');
    }

    /* --- a replayed day never touches the wire --- */
    {
      const r = h.boot('sprint', EXP, { now: T1, store: {}, search: '?d=0' });
      r.env.els.btnStart.click();
      const key = r.x.targets[0];
      const word = [...(key.length === 4 ? r.x.ANA4 : r.x.ANA5).get(key)][0];
      r.env.els.guess.value = word;
      r.env.els.guess.dispatch('keydown', { key: 'Enter' });
      await h.flush();
      h.eq(r.x.S.solvedCount, 1, 'replay: the replayed word still scores');
      h.eq(r.env.fetchLog.length, 0, 'replay: a replay never posts');
    }
}

module.exports = { name: 'sprint', run };
