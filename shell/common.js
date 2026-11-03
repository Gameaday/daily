/* common.js — the shared shell for every warmup game, loaded once per page
   via <script src="../shell/common.js"></script> and destructured at the top
   of each game's script:

     const { TZ, EPOCH_KEY, etKey, todayKey, dayIndex, num, $ } = SHELL;

   Everything that is not the puzzle lives here: day math (midnight ET
   rollover), archive walking (any past day replays forever, in memory
   only), localStorage persistence, toast, the countdown timer, the help
   modal, share-to-clipboard and the global-curve client. That is more
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
  const EPOCH_KEY = '2026-11-02'; // launch date — puzzle No. 1
  function etKey(ms){
    return new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ms));
  }
  const todayKey = etKey(Date.now());
  /* Days before the epoch (pre-launch) do not exist in the numbering:
     dayIndex clamps at 0, so the site reads No. 1 until the launch date
     arrives, then counts for real. */
  const todayIndex = Math.max(0, Math.round((Date.parse(todayKey) - Date.parse(EPOCH_KEY)) / 86400000));

  /* ---- archive walking: ?d=N replays a finished day ---- */
  /* Every past puzzle stays playable forever: the server serves old days
     and their frozen curves, and the client banks carry the schedule, so
     the date line doubles as the navigator (chevrons wired below). The
     view day is invisible to the games - dayIndex IS the day the page
     plays - and a replay is quarantined: it runs in memory only, never
     submits, and cannot touch the live day's state, streaks or sync
     flags. Anything but a finished day (a future number, garbage, or
     today itself) is simply today, so live play stays byte-identical. */
  let viewSearch = '';
  try { viewSearch = (typeof location !== 'undefined' && location && location.search) || ''; } catch(e){}
  function parseViewDay(search, today){
    const m = /[?&]d=(\d+)/.exec(search || '');
    if (!m) return today;
    const d = parseInt(m[1], 10);
    return (d >= 0 && d < today) ? d : today;
  }
  const viewDay = parseViewDay(viewSearch, todayIndex);
  const isArchive = viewDay < todayIndex;
  const dayIndex = viewDay;
  const num = dayIndex + 1;
  /* the chevron hrefs: d === null means the live day (the query drops d) */
  function archiveHref(search, d){
    const solo = /[?&]solo=/.test(search || '');
    if (d === null || d === undefined) return solo ? '?solo=1' : '?';
    return solo ? ('?solo=1&d=' + d) : ('?d=' + d);
  }

  const $ = id => document.getElementById(id);

  /* ---- persistence: one localStorage key per game, play-in-memory on error,
     and in the archive a replay never persists at all ---- */
  function makeStore(key){
    if (isArchive){
      let mem = null;
      return {
        load(){ return mem; },
        save(S){ mem = S; }
      };
    }
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
  /* every share carries the site along - one line appended on copy, so
     the share box on the page stays exactly as quiet as before */
  const SHARE_URL = 'https://daily.historylabs.dev';
  function wireShare(getText){
    $('btnShare').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getText() + '\n' + SHARE_URL);
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
     any file:// download, or ?solo=1) plays exactly the same game with
     the curve switched off - nothing is submitted, no stats are fetched, and
     the games keep working if the scores server is down. */
  function isSolo(){
    return location.protocol === 'file:' || String(location.search || '').indexOf('solo') >= 0;
  }
  function syncBoardFor(game){
    /* Callers may still pass their SYNC_BETTER hint as a second argument;
       it is deliberately ignored - the server owns the direction, and the
       submit payload carries no better field. */
    return function syncBoard(sub){
      const box = $('curve');
      if (!box) return;
      if (isSolo()){
        box.innerHTML = '<div class="curve-note">solo mode \u2014 the global curve is switched off</div>';
        return;
      }
      box.innerHTML = '<div class="curve-note">checking the global curve\u2026</div>';
      const bases = ['/api', 'http://localhost:8787', 'http://127.0.0.1:8787'];
      const tryBases = (makeReq) => {
        const attempt = (i) => (i >= bases.length ? Promise.reject(new Error('unreachable'))
          : makeReq(bases[i]).catch(() => attempt(i + 1)));
        return attempt(0);
      };
      /* a replay never mints a player id either: nothing below the archive
         branch may touch storage, so the walk stays perfectly read-only */
      if (isArchive){
        /* a finished day never takes new tallies: the curve reads the day's
           frozen snapshot, nothing is submitted and no sync flag is set */
        const get = (base) => fetch(base + '/dist?game=' + encodeURIComponent(game) + '&day=' + dayIndex)
          .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
        tryBases(get)
          .then(d => renderBoard(d))
          .catch(() => { box.innerHTML = ''; });
        return;
      }
      /* One tally per game-day: the first sync submits the result, a later
         visit of the same day reads the curve back with a GET, so a reload
         never moves the day count twice. The flag is written only after a
         live reply, so a play made offline still submits on a later visit. */
      let id = '';
      let stored = null;
      try {
        id = localStorage.getItem('warmup.id');
        if (!id){ id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('warmup.id', id); }
        stored = JSON.parse(localStorage.getItem('warmup.sync.' + game));
      } catch(e){ id = 'p' + Math.random().toString(36).slice(2, 10); }
      const synced = !!(stored && typeof stored === 'object' && stored.ok === 1
        && stored.d === dayIndex && typeof stored.v === 'number');
      if (synced){
        const get = (base) => fetch(base + '/dist?game=' + encodeURIComponent(game)
          + '&day=' + dayIndex + '&v=' + encodeURIComponent(stored.v))
          .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
        tryBases(get)
          .then(d => renderBoard(d))
          .catch(() => { box.innerHTML = ''; });
        return;
      }
      /* a gated game sends its evidence - the answer and the raw play facts -
         and the server derives the points; a generator game still sends its
         self-computed value. The local points ride along only to mark the
         you-dot on later reads: on the evidence path the server never
         reads a number from the client. */
      /* a dealt round names its session: a nonce-bearing evidence post
         reports the session's facts (the server counted them itself), and
         a dealt generator post is checked against the server-stamped
         window. Undealt games keep passing a bare number, as before. */
      const isObj = !!(sub && typeof sub === 'object');
      const evidence = isObj && !('value' in sub);
      const value = evidence ? sub.points : (isObj ? sub.value : sub);
      const payload = JSON.stringify(evidence
        ? { game: game, day: dayIndex, id: id, status: sub.status, answer: sub.answer, meta: sub.meta || {}, nonce: sub.nonce || undefined }
        : { game: game, day: dayIndex, value: value, id: id, nonce: (isObj && sub.nonce) || undefined });
      const post = (base) => fetch(base + '/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: payload })
        .then(r => {
          if (r.ok) return r.json();
          /* a rejected play is an answer, not an outage: the answer did not
             check out against the day's key, so nothing tallies and no
             base walk follows */
          if (r.status === 422) return { rejected: true };
          throw new Error('http ' + r.status);
        });
      tryBases(post)
        .then(d => {
          if (d && d.rejected){
            box.innerHTML = '<div class="curve-note">this result did not check out \u2014 it was not counted</div>';
            return;
          }
          if (!d || d.archived !== true){
            try { localStorage.setItem('warmup.sync.' + game, JSON.stringify({ d: dayIndex, ok: 1, v: value })); } catch(e){}
          }
          renderBoard(d);
        })
        .catch(() => { box.innerHTML = '<div class="curve-note">global curve offline \u2014 playing solo today</div>'; });
    };
  }
  function renderBoard(d){
    const box = $('curve');
    if (!box) return;
    if (!d || !d.count){
      box.innerHTML = '<div class="curve-note">' + ((d && d.archived === true)
        ? 'no recorded results \u00b7 this day is closed'
        : 'first result on the curve today') + '</div>';
      return;
    }
    /* the day's shape as one smoothed curve: every bin is a point at its
       midpoint, its height is its share of the busiest bin, and a spline
       through the points reads like the bell the day actually was. The
       you-mark rides its own point, and the bin edges label the floor. */
    const W = 320, L = 4, RGT = 316, BASE = 64, TOP = 8;
    const bins = d.bins, n = bins.length;
    const maxBar = Math.max(...bins.map(b => b.count), 1);
    const xs = bins.map((b, i) => L + (i + 0.5) * (RGT - L) / n);
    const ys = bins.map(b => BASE - Math.max(2, Math.round(b.count / maxBar * (BASE - TOP))));
    const fx = v => String(Math.round(v * 10) / 10);
    let curve = '';
    for (let i = 0; i < n - 1; i++){
      const p0 = i > 0 ? i - 1 : 0;
      const p3 = i < n - 2 ? i + 2 : n - 1;
      const c1x = xs[i] + (xs[i + 1] - xs[p0]) / 6, c1y = ys[i] + (ys[i + 1] - ys[p0]) / 6;
      const c2x = xs[i + 1] - (xs[p3] - xs[i]) / 6, c2y = ys[i + 1] - (ys[p3] - ys[i]) / 6;
      curve += ' C' + fx(c1x) + ',' + fx(c1y) + ' ' + fx(c2x) + ',' + fx(c2y) + ' ' + fx(xs[i + 1]) + ',' + fx(ys[i + 1]);
    }
    const line = 'M' + fx(xs[0]) + ',' + fx(ys[0]) + curve;
    const area = 'M' + L + ',' + BASE + ' L' + fx(xs[0]) + ',' + fx(ys[0]) + curve + ' L' + RGT + ',' + BASE + ' Z';
    const you = bins.findIndex(b => b.you);
    let mark = '';
    if (you >= 0){
      const mx = Math.min(RGT - 10, Math.max(L + 10, xs[you]));
      mark = '<line x1="' + fx(xs[you]) + '" y1="' + BASE + '" x2="' + fx(xs[you]) + '" y2="' + fx(ys[you]) + '" stroke="#b3541e" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.5"/>' +
        '<text class="cyou" x="' + fx(mx) + '" y="' + Math.max(11, ys[you] - 6) + '" font-size="10" font-weight="700" fill="#b3541e" text-anchor="middle">you</text>';
    }
    const labels = bins.map((b, i) =>
      '<text x="' + fx(xs[i]) + '" y="78" font-size="9" fill="#7a6f5d" text-anchor="middle">' + b.lo + '</text>').join('');
    const svg = '<svg viewBox="0 0 ' + W + ' 100" style="width:100%; max-width:340px; display:block; margin:2px auto 0;">' +
      '<path d="' + area + '" fill="#b3541e" opacity="0.12"/>' +
      '<path d="' + line + '" fill="none" stroke="#b3541e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      mark + labels + '</svg>';
    const closed = d.archived === true;
    const tail = (typeof d.beat === 'number')
      ? '<div class="curve-note">you beat ' + d.beat + (d.beat === 1 ? ' player' : ' players') +
        (typeof d.mean === 'number' ? ' \u00b7 avg ' + d.mean : '') + '</div>'
      : '';
    box.innerHTML =
      '<div class="curve-head">global curve \u00b7 ' + d.count + (d.count === 1 ? ' play' : ' plays') + (closed ? ' this day' : ' today') + '</div>' +
      svg +
      (closed ? '<div class="curve-note">this day is closed \u00b7 replays change nothing</div>' : '') + tail;
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

  /* ---- the "No. N · date" line: the day the page is playing ---- */
  /* Live, the line is today's date exactly as before (pre-launch weekends
     included); in the archive it is the viewed puzzle's own date, so a
     replayed day reads the date it actually happened. */
  function pdateText(){
    const ms = isArchive
      ? Date.parse(EPOCH_KEY) + dayIndex * 86400000 + 43200000
      : Date.parse(todayKey) + 43200000;
    return new Date(ms)
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
  /* ---- dealt play client: POST /deal, /guess, /reveal ---- */
  /* Same base walk as fetchPuzzle. Resolves {status, body} from the
     service's JSON answer, or null when the service is unreachable; the
     page owns what an error answer means for its round. Dealt rounds never
     run in solo mode or in an archive replay, so callers guard those. */
  function dealt(path, body){
    const bases = ['/api', 'http://localhost:8787', 'http://127.0.0.1:8787'];
    const payload = JSON.stringify(body);
    const attempt = (i) => {
      if (i >= bases.length) return Promise.resolve(null);
      return fetch(bases[i] + path, { method:'POST', headers:{'Content-Type':'application/json'}, body: payload })
        .then(r => r.json().then(j => ({ status: r.status, body: j }),
                                 () => ({ status: r.status, body: null })))
        .catch(() => attempt(i + 1));
    };
    return attempt(0);
  }
  /* ---- dealt sessions: the one dance every dealt page dances ---- */
  /* The live round is the same everywhere: open a session, post moves
     until a terminal verdict, keep the reveal with the day's state. The
     shell owns the dance (the deal, the busy guard, the triage, the
     nonce, the copy) and the page owns the game: which move a button
     builds, what a verdict means, and how the reveal folds back into
     its puzzle model.

       const session = SHELL.makeDealt({
         game: 'thread',          // the ledger name /deal speaks
         day: () => dayIndex,     // the live day the deal asks for
         state: () => S,          // the page state; the nonce lives there
         save: saveState,         // called after the shell moves the nonce
         toast: toastMsg,         // the page toast
         copy: {                  // the page's own words, kept as its own
           unavailable: 'the thread is not answering right now, try again',
           over: 'this round is already over',
           expired: 'this round expired, check again for a fresh one'
         }
       });
       await session.play({ chain: ids }, body => { ... });
       session.reset();           // drop a stale nonce

     play() is the whole /guess dance: it opens the session when none is
     open, posts the move with the nonce, and hands the verdict body to
     the page hook on a 200 that carries a verdict. The busy guard is
     per session, so a double click costs nothing. An optional onDeal hook sees
     the deal's answer before the nonce is saved, for the games whose
     deal itself carries the day's strip. Dealt rounds never
     run in solo mode or in an archive replay; callers guard those. */
  function makeDealt(cfg){
    let busy = false;
    async function session(){
      const S = cfg.state();
      if (S.nonce) return S.nonce;
      let d = null;
      try { d = await dealt('/deal', { game: cfg.game, day: cfg.day() }); } catch (e) {}
      if (d && d.status === 200 && d.body && typeof d.body.nonce === 'string'){
        S.nonce = d.body.nonce;
        if (cfg.onDeal) cfg.onDeal(d.body);
        cfg.save();
        return S.nonce;
      }
      return null;
    }
    async function play(move, onBody){
      if (busy) return;
      busy = true;
      try {
        const n = await session();
        if (!n){ cfg.toast(cfg.copy.unavailable); return; }
        let b = null;
        try { b = await dealt('/guess', Object.assign({ nonce: n }, move)); } catch (e) {}
        if (!b){ cfg.toast(cfg.copy.unavailable); return; }
        if (b.status === 409){ cfg.toast(cfg.copy.over); return; }
        if (b.status !== 200 || !b.body || !b.body.verdict){
          cfg.state().nonce = null;
          cfg.save();
          cfg.toast(cfg.copy.expired);
          return;
        }
        await onBody(b.body);
      } finally { busy = false; }
    }
    function reset(){
      cfg.state().nonce = null;
      cfg.save();
    }
    return { session, play, reset };
  }

  try {
    const icons = document.querySelector('.icons');
    if (icons && !icons.querySelector('.home-link')){
      const a = document.createElement('a');
      a.className = 'iconbtn home-link';
      /* name the file: a directory link is a server habit, and file://
         play (the offline bundle) shows a folder listing instead */
      a.href = '../index.html';
      a.textContent = '\u2302';
      a.setAttribute('aria-label', 'All games');
      a.style.textDecoration = 'none';
      icons.insertBefore(a, icons.firstChild);
    }
  } catch(e){}

  /* ---- archive walking: the chevrons around the date line ---- */
  /* The date span is inline inside its "No. N" line on every page, so the
     links flank it naturally: ‹ walks back one puzzle at a time, › walks
     forward, and each edge of history hides its own arrow (invisibly, so
     the date keeps its place). No page had to change for this. */
  try {
    const pd = document.getElementById('pdate');
    if (pd && pd.parentNode){
      const mk = (label, href, hidden, aria) => {
        const a = document.createElement('a');
        a.className = 'archbtn';
        a.href = href;
        a.textContent = label;
        a.setAttribute('aria-label', aria);
        if (hidden) a.style.visibility = 'hidden';
        return a;
      };
      const parent = pd.parentNode;
      parent.insertBefore(mk('\u2039',
        archiveHref(viewSearch, viewDay > 0 ? viewDay - 1 : null),
        viewDay === 0, 'previous puzzle'), pd);
      parent.insertBefore(mk('\u203a',
        archiveHref(viewSearch, viewDay < todayIndex
          ? (viewDay + 1 === todayIndex ? null : viewDay + 1) : null),
        viewDay === todayIndex, 'next puzzle'), pd.nextSibling);
    }
  } catch(e){}

  /* ---- graceful "service unreachable" note for the online bundle ---- */
  /* The online bundle ships without local puzzle banks, so if the puzzle
     service cannot be reached there is nothing to render. Online games
     call this from a boot guard instead of crashing on an empty puzzle. */
  function showUnavailable(){
    const w = document.querySelector('.wrap');
    const head = w ? w.querySelector('header') : null;
    if (w){
      w.innerHTML = '';
      if (head) w.appendChild(head);
      const note = document.createElement('p');
      note.className = 'lead';
      note.setAttribute('style', 'text-align:center; padding:80px 0; font-size:16px;');
      note.innerHTML = 'The puzzle service is unreachable right now.<br/>Check back in a minute; your streak and stats are safe.';
      w.appendChild(note);
    }
  }

  /* ---- bonus stars: local perfection milestones ---- */
  /* A star is a flourish the curve never sees: it lives in the browser
     next to the streaks, one record per day (the best stands), and an
     archive replay never records. Games earn them however they like;
     the shell only keeps the count. */
  function recordStars(game, earned){
    if (!earned || isArchive) return starTotal(game);
    let o = null;
    try { o = JSON.parse(localStorage.getItem('warmup.stars.' + game)) || null; } catch(e){}
    if (!o || typeof o !== 'object'){ o = { total: 0, days: {} }; }
    if (typeof o.days !== 'object' || !o.days) o.days = {};
    const k = String(dayIndex);
    const prev = typeof o.days[k] === 'number' ? o.days[k] : 0;
    if (earned > prev) o.days[k] = earned;
    let total = 0;
    for (const d of Object.keys(o.days)) total += o.days[d];
    o.total = total;
    try { localStorage.setItem('warmup.stars.' + game, JSON.stringify(o)); } catch(e){}
    return total;
  }
  function starTotal(game){
    try {
      const o = JSON.parse(localStorage.getItem('warmup.stars.' + game));
      return (o && typeof o.total === 'number') ? o.total : 0;
    } catch(e){ return 0; }
  }

  return { TZ, EPOCH_KEY, etKey, todayKey, todayIndex, dayIndex, num, $,
           isArchive, parseViewDay, archiveHref,
           makeStore, toast, nextETMidnight, startCountdown,
           wireHelp, wireShare, syncBoardFor, renderBoard, probeCurve, pdateText, isSolo, fetchPuzzle, dealt, showUnavailable, recordStars, starTotal, makeDealt };
})();
