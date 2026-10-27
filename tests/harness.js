/* Headless test harness for the warmup games.

   Boots each game's <script> with new Function inside a stubbed DOM and an
   injectable clock, so every game is playable end-to-end with no browser and
   no dependencies. The exact same file runs in CI (Node 20) and locally.

   Deliberately no I/O here: the caller passes each game in as a string, so
   this module is trivially portable and side-effect free.

   The games are unmodified - their real code runs against the stubs:
   - every element is an El with listener maps, classList backed by a Set,
     value/textContent/innerHTML/style/dataset fields and a fixed offsetWidth
     (the games call it to restart CSS animations)
   - document.querySelectorAll returns [] (the games null-guard the few
     querySelector results they use)
   - fetch logs every POST and resolves a canned team-curve snapshot
   - localStorage is a plain object, so a "reload" is just booting again
     with the same store - which is exactly how day-rollover gets tested
   - Date is a subclass whose now() returns the harness clock, so tests are
     pinned to fixed days no matter when they run
   - setTimeout is queued and drained by flush() so toast timers etc. fire
     deterministically without waiting real milliseconds
*/
'use strict';

/* Canned snapshot the scores service would return. Shape matches
   scores/server.py snapshot(): count, beat, mean, bins[{lo,hi,count,you}]. */
const SNAPSHOT = { count: 3, beat: 1, mean: 2.5, bins: [
  { lo: 0, hi: 1, count: 2, you: true }, { lo: 1, hi: 2, count: 1, you: false },
  { lo: 2, hi: 3, count: 0, you: false }, { lo: 3, hi: 4, count: 0, you: false }
]};

class El {
  constructor(id){
    this.id = id;
    this.tagName = 'DIV';
    this.listeners = {};
    this._cls = new Set();
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    const self = this;
    this.classList = {
      add: function(){ for (let i = 0; i < arguments.length; i++) self._cls.add(arguments[i]); },
      remove: function(){ for (let i = 0; i < arguments.length; i++) self._cls.delete(arguments[i]); },
      toggle: function(c, f){
        const on = f === undefined ? !self._cls.has(c) : f;
        if (on) self._cls.add(c); else self._cls.delete(c);
        return on;
      },
      contains: function(c){ return self._cls.has(c); }
    };
  }
  addEventListener(t, fn){ (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(){}
  dispatch(t, ev){
    const e = Object.assign({ target: this }, ev || {});
    (this.listeners[t] || []).forEach(fn => fn(e));
  }
  click(){ this.dispatch('click', {}); }
  focus(){}
  blur(){}
  get offsetWidth(){ return 10; }
  querySelector(){ return null; }
  closest(){ return null; }
}

function createHarness(readGame, readShared){
  let activeNow = Date.now();
  const timers = [];

  /* The games call Date.now(), new Date(ms) and new Date(); a subclass with
     a defaulted constructor keeps all three on the harness clock. */
  class FakeDate extends Date {
    constructor(...a){
      if (a.length === 0) a = [activeNow];
      super(...a);
    }
    static now(){ return activeNow; }
  }

  function makeEnv(store){
    const els = {};
    const fetchLog = [];
    const el = id => els[id] || (els[id] = new El(id));
    return {
      els, fetchLog, store,
      document: {
        getElementById: el,
        createElement: t => { const e = new El(t); e.tagName = String(t).toUpperCase(); return e; },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener(){},
        createRange: () => ({ selectNode(){} }),
        body: new El('body')
      },
      localStorage: {
        getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
      },
      navigator: { clipboard: { writeText: () => Promise.resolve() } },
      getSelection: () => ({ removeAllRanges(){}, addRange(){} }),
      fetch: (url, opts) => {
        fetchLog.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true, json: async () => SNAPSHOT });
      },
      location: { reload(){} },
      setInterval: () => 0,
      setTimeout: fn => { timers.push(fn); return 0; }
    };
  }

  /* Boot a game as if a fresh page had loaded at time opts.now with the
     given localStorage store (a plain object). expose is a list of top-level
     names from the game's script to hand back for driving and asserting.
     A missing name throws a ReferenceError - loud by design. */
  function boot(game, expose, opts){
    activeNow = opts.now;
    const env = makeEnv(opts.store);
    const html = readGame(game);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) throw new Error(game + ': no script block found');
    /* Since the shell extraction a game runs on top of shell/common.js
       (plus assets/words-en.js for the word-bank games) - prepended here
       the same way the page loads its <script src> tags. */
    const prelude = readShared ? readShared(game) : '';
    const src = (prelude ? prelude + '\n;\n' : '') + m[1] + '\n;__export({' + expose.join(',') + '});';
    const fn = new Function(
      'document', 'localStorage', 'navigator', 'getSelection', 'fetch',
      'location', 'setInterval', 'setTimeout', 'Date', '__export', src);
    const x = {};
    fn(env.document, env.localStorage, env.navigator, env.getSelection,
       env.fetch, env.location, env.setInterval, env.setTimeout, FakeDate,
       o => Object.assign(x, o));
    return { env, x };
  }

  const sleep = () => new Promise(r => setTimeout(r, 0));
  /* Let pending fetch chains settle, then drain queued setTimeout callbacks
     (nested timers queue more; loop until both queues are quiet). */
  async function flush(){
    for (let i = 0; i < 5; i++){
      await sleep();
      while (timers.length) timers.shift()();
    }
    await sleep();
  }

  /* Tiny runner - no assert library needed. */
  const results = [];
  let current = null;
  function group(name){
    current = { name, pass: 0, fail: 0, failures: [] };
    results.push(current);
  }
  function ok(cond, msg){
    if (cond) current.pass++;
    else { current.fail++; current.failures.push(msg); }
  }
  function eq(a, b, msg){
    if (Object.is(a, b)) current.pass++;
    else {
      current.fail++;
      current.failures.push(msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
    }
  }
  function summary(){
    let pass = 0, fail = 0;
    const lines = [];
    for (const r of results){
      pass += r.pass; fail += r.fail;
      lines.push(r.name + ': ' + r.pass + ' passed, ' + r.fail + ' failed');
      for (const f of r.failures) lines.push('   FAIL: ' + f);
    }
    lines.push('TOTAL: ' + pass + ' passed, ' + fail + ' failed');
    return { lines: lines.join('\n'), pass, fail };
  }
  const lastPost = env => env.fetchLog[env.fetchLog.length - 1];

  return { boot, flush, group, ok, eq, summary, lastPost, results };
}

module.exports = { createHarness };

