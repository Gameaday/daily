/* common.js — the shared shell for every warmup game, loaded once per page
   via <script src="../shell/common.js"></script> and destructured at the top
   of each game's script:

     const { TZ, EPOCH_KEY, etKey, todayKey, dayIndex, num, $ } = SHELL;

   Everything that is not the puzzle lives here: day math (midnight ET
   rollover), localStorage persistence, toast, the countdown timer, the
   help modal, share-to-clipboard and the global-curve client. That is more
   than half of every game file, so a new game is now just its puzzle.

   A game keeps its own tiny adapters so call sites never change:

     const store = SHELL.makeStore(KEY);
     function loadState(){ return store.load(); }
     function saveState(){ store.save(S); }
     const toastMsg = SHELL.toast;                    // or toast
     function syncBoard(v){ return SHELL.syncBoardFor(SYNC_GAME, SYNC_BETTER)(v); }
     SHELL.wireHelp();  SHELL.wireShare(shareText);
     SHELL.startCountdown('countdown', 500);         // or with onTick extras
     $('pdate').textContent = SHELL.pdateText();     */
'use strict';
const SHELL = (() => {

  /* ---- the daily puzzle: days since launch, rolling at midnight ET ---- */
  const TZ = 'America/New_York';
  const EPOCH_KEY = '2026-10-27'; // launch date — puzzle No. 1
  function etKey(ms){
    return new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ms));
  }
  const todayKey = etKey(Date.now());
  const dayIndex = Math.round((Date.parse(todayKey) - Date.parse(EPOCH_KEY)) / 86400000);
  const num = dayIndex + 1;

  const $ = id => document.getElementById(id);

  /* ---- persistence: one localStorage key per game, play-in-memory on error ---- */
  function makeStore(key){
    return {
      load(){ try { return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } },
      save(S){ try { localStorage.setItem(key, JSON.stringify(S)); } catch(e){ /* private mode / sandbox: play in memory */ } }
    };
  }

  /* ---- toast (visible for ms, default 1800) ---- */
  function toast(msg, ms){
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), ms || 1800);
  }

  /* ---- midnight rollover: render the countdown, reload at midnight ---- */
  function nextETMidnight(){
    const tomorrowKey = etKey(Date.now() + 30 * 3600000);
    let target = Date.parse(tomorrowKey) - 5 * 3600000; // assume EST, then correct for DST
    while (etKey(target) !== tomorrowKey) target += 3600000;
    return target;
  }
  /* Renders "next puzzle in ..." into #countdown (pass 'count' for the games
     that use that id), reloads the page at rollover, and calls onTick for
     anything game-specific that ticks with the clock (rings clock, sprint
     bigclock...). Returns the tick function. */
  function startCountdown(elId, interval, onTick){
    function tick(){
      const left = nextETMidnight() - Date.now();
      if (left <= 0){ location.reload(); return; }
      const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
      const el = $(elId);
      if (el) el.textContent = h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
      if (onTick) onTick();
    }
    tick();
    setInterval(tick, interval || 500);
    return tick;
  }

  /* ---- help modal + share-to-clipboard ---- */
  function wireHelp(){
    $('btnHelp').addEventListener('click', () => $('helpOverlay').classList.add('show'));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $('helpOverlay').classList.remove('show')));
  }
  function wireShare(getText){
    $('btnShare').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getText());
        toast('Copied \u2014 paste it anywhere');
      } catch (e){
        const r = document.createRange();
        r.selectNode($('sharetext'));
        const sel = getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        toast('Copy blocked \u2014 the text is selected for you');
      }
    });
  }

  /* ---- global curve client: the server owns the metric direction ---- */
  /* Solo mode: the whole site is static files, so an air-gapped copy (or
     any file:// download, or ?solo=1) plays exactly the same game with the
     curve switched off - nothing is submitted, no stats are fetched, and
     the games keep working if the scores server is down. */
  function isSolo(){
    return location.protocol === 'file:' || String(location.search || '').indexOf('solo') >= 0;
  }
  function syncBoardFor(game, better){
    return function syncBoard(value){
      const box = $('curve');
      if (!box) return;
      if (isSolo()){
        box.innerHTML = '<div class="curve-note">solo mode \u2014 the global curve is switched off</div>';
        return;
      }
      box.innerHTML = '<div class="curve-note">checking the global curve\u2026</div>';
      let id = '';
      try {
        id = localStorage.getItem('warmup.id');
        if (!id){ id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('warmup.id', id); }
      } catch(e){ id = 'p' + Math.random().toString(36).slice(2, 10); }
      const payload = JSON.stringify({ game: game, day: dayIndex, value: value, better: better, id: id });
      const post = (base) => fetch(base + '/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: payload })
        .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
      post('/api')
        .catch(() => post('http://localhost:8787'))
        .catch(() => post('http://127.0.0.1:8787'))
        .then(d => renderBoard(d))
        .catch(() => { box.innerHTML = '<div class="curve-note">global curve offline \u2014 playing solo today</div>'; });
    };
  }
  function renderBoard(d){
    const box = $('curve');
    if (!box) return;
    if (!d || !d.count){ box.innerHTML = '<div class="curve-note">first result on the curve today</div>'; return; }
    const maxBar = Math.max(...d.bins.map(b => b.count), 1);
    const bars = d.bins.map(b =>
      '<div class="cbar' + (b.you ? ' you' : '') + '" style="height:' + Math.max(10, Math.round(b.count / maxBar * 60)) + 'px"></div>' +
      (b.you ? '<div class="you-mark">you</div>' : '')
    ).join('');
    box.innerHTML =
      '<div class="curve-head">global curve</div>' +
      '<div class="curve-bars">' + bars + '</div>';
  }

  /* ---- is the global curve service reachable? ---- */
  /* Used by games that gate a heavy or bonus mode on being online (grid
     hard mode). Any HTTP answer - even a 404 - proves the service is up;
     only a network error counts as offline. Solo mode is offline by design. */
  function probeCurve(){
    if (isSolo()) return Promise.resolve(false);
    const go = (base) => fetch(base + '/health', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
      .then(() => true, () => false);
    return go('/api')
      .then(ok => ok || go('http://localhost:8787'))
      .then(ok => ok || go('http://127.0.0.1:8787'));
  }

  /* ---- the "No. N · date" line ---- */
  function pdateText(){
    return new Date(Date.parse(todayKey) + 43200000)
      .toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric', timeZone:'UTC' });
  }

  /* ---- fetch today's (or an older) puzzle from the scores service ---- */
  /* Online mode only: the server refuses future days, so the client never
     receives puzzles it is not allowed to see. Solo mode callers should use
     their local PUZZLES array instead. */
  function fetchPuzzle(game, day){
    const qs = '?game=' + encodeURIComponent(game) + '&day=' + encodeURIComponent(day);
    const bases = ['/api', 'http://localhost:8787', 'http://127.0.0.1:8787'];
    const tryBase = (i) => {
      if (i >= bases.length) throw new Error('puzzle service unreachable');
      return fetch(bases[i] + '/puzzle' + qs)
        .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .catch(() => tryBase(i + 1));
    };
    return tryBase(0);
  }
  try {
    const icons = document.querySelector('.icons');
    if (icons && !icons.querySelector('.home-link')){
      const a = document.createElement('a');
      a.className = 'iconbtn home-link';
      a.href = '../';
      a.textContent = '\u2302';
      a.setAttribute('aria-label', 'All games');
      a.style.textDecoration = 'none';
      icons.insertBefore(a, icons.firstChild);
    }
  } catch(e){}

  return { TZ, EPOCH_KEY, etKey, todayKey, dayIndex, num, $,
           makeStore, toast, nextETMidnight, startCountdown,
           wireHelp, wireShare, syncBoardFor, renderBoard, probeCurve, pdateText, isSolo, fetchPuzzle };
})();
