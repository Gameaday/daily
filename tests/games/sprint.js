/* sprint - headless playthrough (win, loss, day rollover). Split from
   the old monolithic tests/run.js so each game's tests live (and fail)
   alone: dropping the game later means deleting this file with them. */
'use strict';
const { T0, T1, T10 } = require('./_lib');

async function run(h){
    const EXP = ['S', 'targets', 'ANA4', 'ANA5', 'shareText'];
    const store = {};
    let r = h.boot('sprint', EXP, { now: T0, store });
    h.eq(r.x.targets.length, 5, 'sprint: 5 targets');
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
    h.eq(h.lastPost(r.env).body.value, 5, 'sprint: curve value 5');
    h.eq((r.x.S.words || []).join(','), typed.join(','), 'sprint: solved-word list matches typed');
    h.ok(r.x.shareText().indexOf('5/5') >= 0, 'sprint: share 5/5');
    h.eq(r.x.S.stars, 3, 'sprint: a full-speed sweep earns all three clock stars');
    h.ok(r.x.shareText().indexOf('3\u2605') >= 0, 'sprint: the share text carries the stars');
    r = h.boot('sprint', EXP, { now: T1, store });
    h.eq(r.x.S.day, 1, 'sprint: day rolled');
    h.eq(r.x.S.stats.streak, 1, 'sprint: streak preserved');
    const s3 = {};
    r = h.boot('sprint', EXP, { now: T0, store: s3 });
    h.eq(r.env.els.btnShuffle.style.display, 'none', 'sprint: shuffle hidden before twenty seconds');
    const before = r.env.els.scramble.textContent;
    r.env.els.btnShuffle.click();
    h.ok(r.env.els.scramble.textContent !== before, 'sprint: shuffle re-scrambles the word');
    h.eq([...r.env.els.scramble.textContent].sort().join(''), [...before].sort().join(''), 'sprint: shuffle keeps the same letters');

    /* --- the online live day is dealt: the first keystroke deals a
       session, /reveal stamps the server clock once, and the finish
       names the session so the window is the server's --- */
    {
      let deals = 0, reveals = 0;
      const serveDealt = (url) => {
        if (/\/deal$/.test(url)){ deals++; return { status: 200, body: { nonce: 'sp1', today: 0 } }; }
        reveals++;
        return { status: 200, body: { ok: true, elapsed: 0, window: 90 } };
      };
      const r = h.boot('sprint', EXP, { now: T0, store: {}, serveDealt });
      const w0 = [...(r.x.targets[0].length === 4 ? r.x.ANA4 : r.x.ANA5).get(r.x.targets[0])][0];
      r.env.els.guess.value = w0;
      r.env.els.guess.dispatch('keydown', { key: 'Enter' });
      await h.flush();
      h.eq(r.x.S.nonce, 'sp1', 'dealt: the first keystroke deals the session');
      h.eq(r.x.S.gun, 1, 'dealt: the server stamps the starting gun');
      for (let k = 1; k < 5; k++){
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
      h.eq(p.value, 5, 'dealt: the sweep posts its count');
      h.eq(p.nonce, 'sp1', 'dealt: the finish names the session');
    }

    /* --- a replayed day never touches the wire --- */
    {
      const r = h.boot('sprint', EXP, { now: T1, store: {}, search: '?d=0' });
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
