/* dawn.js - first light: the once-a-day sunrise greeting, and
   the day and night of the whole site.

   The dawn is a garnish, never a gate. Any page can be the first page
   of the day (the landing, or a bookmark straight into a game), so the
   shell loads this module everywhere and hands it the day facts; the
   sunrise then plays at most once per ET day per browser, wherever you
   came in from. The choreography lives in dawn.css; the trigger, the
   once-per-day guard and the cleanup live here.

   The ending: the sun deposits the mark. Every page's own heading
   ends in a colored mark (the period of "Warmup." on the landing, the
   dot of a game's name on its page), and dawn.css draws that mark
   itself: a disc in the accent, the same shape in every font. For
   punctuation the mark is held back for the whole show, hidden from
   the first paint behind the sky; the sunrise's last second flies the
   disc out of the sky and into that empty spot, landing centered on
   the drawn one, at its own size, and the instant it lands the bright
   disc vanishes and the drawn one is what remains: delivered, fresh
   each day. A heading that ends in a colored word (the recycle pair)
   keeps its word and sits the show out. A skip, a stillness
   preference, a page with no such mark, or a browser without the web
   animations api reveals the mark plainly instead, so no page is ever
   left without its dot.

   The dot keeps the whole day in it afterwards. A tap of the mark
   glows and walks the site's theme through its day: day, then night,
   then auto (the device's own preference), then day again. The choice
   is remembered across pages and days; a first visit always starts in
   day, so nothing is ever jarring; and every swap crossfades, so the
   page feels like the sky turning rather than a light switching. In
   day the mark is the deposited sun itself, a solid terracotta disc.
   In night the same disc hollows into its own outline, a thin gold
   ring: the sun has set, its shape remains. In auto it carries
   both hours: the day fills the disc's lower left, climbing toward
   the night's gold ring. Pressing and holding the
   mark still replays the whole morning.

   The whole tab performs it. The favicon carries the motif at rest
   (the tile's period restyled as a small gold sun, or its outline at
   night), and during the show the tab title greets while the favicon
   and the mobile browser chrome ride the sky from night to morning,
   handing both back the moment the disc lands; while it plays the
   tab belongs to the show, so a theme tapped mid-sunrise waits its
   turn. The page's own icon
   and title in the html stay untouched, so a no-script visit keeps
   what it has always had.

   Contract with the shell (common.js passes these in):
     key      the ET date key for today, as YYYY-MM-DD
     num      the puzzle number of the day
     dayIndex the day index, the greeting line rotates on it
     dateText the date line, e.g. Wed, Nov 4 2026

   Surface (for previews and QA):
     DAWN.init(cfg)   auto: plays only if this day has not been greeted
     DAWN.play(cfg)   force: plays now regardless of the marker
     DAWN.reset()    clears the marker, so a later init() plays again
     DAWN.mode()     the stored theme: day, night, or auto
*/
(function(){
  'use strict';
  var MARK = 'warmup.dawn';
  var MODE = 'warmup.mode';   /* day | night | auto */
  var FIRST = 'warmup.first'; /* the very first visit, greeted once */

  var HOLD = 4600;   /* the sunrise holds this long; keep in step with
                        the keyframes in dawn.css */
  var FLIGHT = 1100; /* the settle: the sun's trip from the sky into the
                        logo's mark */
  var DISC_EM = 0.34;  /* the drawn mark's diameter, in em of the mark's
                          own font: the width dawn.css gives the disc,
                          kept in step and pinned by checks/games.js */
  var LIFT_EM = 0.41;  /* the drawn mark's center, this far above the
                          mark box's bottom: the css bottom (.24em)
                          plus half the diameter. Same step, same pin */
  var PRESS = 600;   /* the dot: press and hold this long to replay the
                        morning */
  var GREETINGS = [
    'Good morning.',
    'First light. Fresh warm-ups.',
    'A new day warms up.',
    'Rise and shine.',
    'Up with the sun.',
    'Hello, early bird.',
    'The day begins.'
  ];
  var lastCfg = null;
  var dot = null;      /* the logo's mark, once armed */
  var darkSys = null;  /* the device's own preference, for auto */
  var showing = false; /* the show owns the tab while it plays: a theme
                         swap waits its turn, and no second show starts
                         until the sky has faded out */
  var themingT = null; /* the one timer behind the crossfade window,
                         kept by handle so a second swap restarts the
                         window instead of racing it */

  function storageWritable(){
    try { localStorage.setItem(MARK + '.t', '1'); localStorage.removeItem(MARK + '.t'); return true; }
    catch (e){ return false; }
  }
  function seenToday(key){
    try { return localStorage.getItem(MARK) === key; } catch (e){ return true; }
  }
  function markToday(key){
    try { localStorage.setItem(MARK, key); } catch (e){}
  }
  function reducedMotion(){
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e){ return false; }
  }

  /* the logo's mark: the colored period (or bang) that ends the page's
     own heading, e.g. the span in Warmup<span>.</span> */
  function logoMark(){
    var h1 = document.querySelector('h1');
    if (!h1) return null;
    var spans = h1.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++){
      var t = (spans[i].textContent || '').trim();
      if ((spans[i].className + '').indexOf('dot') !== -1 || /^[.!?]$/.test(t)) return spans[i];
    }
    return null;
  }

  /* the mark is punctuation on most pages, but the two recycle games
     color a whole word instead. Only punctuation is a dot: a word
     keeps its text, takes no deposit, and never hides */
  function isPunct(m){ return /^[.!?]$/.test((m.textContent || '').trim()); }

  /* ---------------- the theme: day, night, auto ----------------
     The night palette is the sunrise's own sky (deep indigo paper,
     plum cards, dawn-cream ink, sun-gold accent); dawn.css carries the
     variable overrides. A first visit is day, always; the choice is
     remembered; auto follows the device and keeps following it. */
  function storedMode(){
    try {
      var m = localStorage.getItem(MODE);
      return (m === 'night' || m === 'auto') ? m : 'day';
    } catch (e){ return 'day'; }
  }
  function saveMode(m){
    try { localStorage.setItem(MODE, m); } catch (e){}
  }
  function isNight(){
    var m = storedMode();
    if (m === 'night') return true;
    if (m !== 'auto') return false;
    try { return !!(darkSys && darkSys.matches); } catch (e){ return false; }
  }

  function dotLabel(m, night){
    if (m === 'day') return 'day \u00b7 tap the dot for night';
    if (m === 'night') return 'night \u00b7 tap the dot for auto';
    return (night ? 'auto, night like your device' : 'auto, day like your device') + ' \u00b7 tap the dot for day';
  }
  function updateDot(){
    if (!dot) return;
    try {
      var m = storedMode();
      var night = isNight();
      dot.classList.toggle('dawn-mode-night', m === 'night');
      dot.classList.toggle('dawn-mode-auto', m === 'auto');
      var lbl = dotLabel(m, night);
      dot.setAttribute('title', lbl);
      dot.setAttribute('aria-label', lbl);
    } catch (e){}
  }

  function applyMode(animate){
    var night = isNight();
    var root = document.documentElement;
    try {
      if (animate) root.classList.add('dawn-theming');
      root.classList.toggle('night', night);
      updateDot();
      /* a swap mid-show must not touch the tab: the sunrise is still
         performing on it and hands it back itself */
      if (!showing) restTab();
      /* the crossfade window is one tracked timer: a rapid second tap
         restarts it, so a fade in flight is never cut down mid turn */
      if (themingT) window.clearTimeout(themingT);
      themingT = null;
      if (animate) themingT = window.setTimeout(function(){
        themingT = null;
        root.classList.remove('dawn-theming');
      }, 500);
    } catch (e){}
  }
  function cycleMode(){
    var m = storedMode();
    m = (m === 'day') ? 'night' : (m === 'night' ? 'auto' : 'day');
    saveMode(m);
    applyMode(true);
  }

  /* ---------------- the tab: favicon and chrome tint ----------------
     All of it is wrapped soft: a browser that minds none of this
     keeps its own icon, tint and title, no harm done. */
  var FAV = { link: null, meta: null, timers: [] };
  var TITLE = { saved: null };

  function sunTile(night){
    return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
      (night
        ? "<rect width='100' height='100' rx='22' fill='#17162e'/>" +
          "<circle cx='50' cy='50' r='43' fill='#251f3d' stroke='#3b3552' stroke-width='3'/>" +
          "<text x='43' y='71' font-size='58' font-family='Georgia,serif' font-weight='bold'" +
          " text-anchor='middle' fill='#f6dfbe'>W</text>" +
          "<circle cx='79' cy='65' r='7' fill='none' stroke='#f5c46b' stroke-width='1.7'/>"
        : "<defs><radialGradient id='d' cx='.4' cy='.35' r='.8'>" +
          "<stop offset='0' stop-color='#fff6e3'/>" +
          "<stop offset='.55' stop-color='#f5c46b'/>" +
          "<stop offset='1' stop-color='#e8974c'/></radialGradient></defs>" +
          "<rect width='100' height='100' rx='22' fill='#f7f1e5'/>" +
          "<circle cx='50' cy='50' r='43' fill='#fffdf7' stroke='#e5dbc8' stroke-width='3'/>" +
          "<text x='43' y='71' font-size='58' font-family='Georgia,serif' font-weight='bold'" +
          " text-anchor='middle' fill='#b3541e'>W</text>" +
          "<circle cx='79' cy='65' r='11' fill='#f4b769' opacity='.3'/>" +
          "<circle cx='79' cy='65' r='7' fill='url(#d)'/>") +
      "</svg>";
  }

  function dawnFrame(top, bot, cy, glow){
    return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
      "<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>" +
      "<stop offset='0' stop-color='" + top + "'/>" +
      "<stop offset='1' stop-color='" + bot + "'/></linearGradient></defs>" +
      "<rect width='100' height='100' rx='22' fill='url(#s)'/>" +
      (glow ? "<circle cx='50' cy='" + (cy + 4) + "' r='26' fill='#f4b769' opacity='" + glow + "'/>" : "") +
      (cy < 100 ?
        "<circle cx='50' cy='" + cy + "' r='15' fill='#e8974c'/>" +
        "<circle cx='50' cy='" + (cy - 2) + "' r='12' fill='#f5c46b'/>" +
        "<circle cx='50' cy='" + (cy - 4) + "' r='7' fill='#fff6e3'/>" : "") +
      "</svg>";
  }

  function setFav(svg){
    try {
      if (FAV.link) FAV.link.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
    } catch (e){}
  }
  function setTheme(color){
    try {
      if (FAV.meta) FAV.meta.setAttribute('content', color);
    } catch (e){}
  }
  function saveTitle(greet){
    try {
      TITLE.saved = document.title;
      document.title = greet;
    } catch (e){ TITLE.saved = null; }
  }
  function restoreTitle(){
    if (TITLE.saved == null) return;
    try { document.title = TITLE.saved; } catch (e){}
    TITLE.saved = null;
  }
  function clearFavTimers(){
    for (var i = 0; i < FAV.timers.length; i++) window.clearTimeout(FAV.timers[i]);
    FAV.timers = [];
  }

  function findTabBits(){
    try {
      var l = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel~="icon"]');
      if (!l){
        l = document.createElement('link');
        l.setAttribute('rel', 'icon');
        (document.head || document.documentElement).appendChild(l);
      }
      FAV.link = l;
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m){
        m = document.createElement('meta');
        m.setAttribute('name', 'theme-color');
        (document.head || document.documentElement).appendChild(m);
      }
      FAV.meta = m;
    } catch (e){ FAV.link = null; FAV.meta = null; }
  }

  /* the tab's miniature sunrise, in step with the sky on the page:
     the favicon and the mobile chrome tint move frame by frame, and
     the title greets until the disc lands */
  function playTab(greet){
    clearFavTimers();
    saveTitle(greet);
    /* at night the miniature keeps to the sky's dark edge, like the
       page's own dawn does, so neither favicon nor chrome ever flashes
       bright over a dark page */
    var night = isNight();
    var frames = [
      { t: 0,    top: '#17162e', bot: '#2e2242', cy: 100, glow: '.2' },
      { t: 1500, top: '#2e2242', bot: '#4a2c48', cy: 95,  glow: '.3' },
      { t: 3000, top: '#4a2c48', bot: '#9c5a50', cy: 68,  glow: '.35' },
      { t: 4200, top: '#f2b98c', bot: '#f7f1e5', cy: 36,  glow: '.4',
        ntop: '#4a2c48', nbot: '#17162e' }
    ];
    for (var i = 0; i < frames.length; i++){
      (function(f){
        var top = night && f.ntop ? f.ntop : f.top;
        FAV.timers.push(window.setTimeout(function(){
          setFav(dawnFrame(top, night && f.nbot ? f.nbot : f.bot, f.cy, f.glow));
          setTheme(top);
        }, f.t));
      })(frames[i]);
    }
  }

  /* everything the tab hands back when the show is over: the resting
     tile and tint of whichever theme the site is in */
  function restTab(){
    var night = isNight();
    setFav(sunTile(night));
    setTheme(night ? '#17162e' : '#f7f1e5');
    restoreTitle();
  }

  /* ---------------- the dot: the kiss, the hold, the theme ----------------
     Armed on every page load, show or no show. A tap glows and walks
     the theme to its next hour; pressing and holding builds the glow
     until the whole morning replays. */
  function armKiss(){
    try {
      var m = logoMark();
      if (!m) return;
      dot = m;
      m.classList.add('dawn-kiss');
      if (isPunct(m)) m.classList.add('dawn-punct');
      if ((m.textContent || '').trim() === '.') m.classList.add('dawn-period');
      m.setAttribute('role', 'button');
      m.setAttribute('tabindex', '0');
      var holdT = null, held = false;
      var offHold = function(){
        window.clearTimeout(holdT);
        holdT = null;
        try { m.classList.remove('dawn-hold'); } catch (e){}
      };
      var glow = function(){
        m.classList.remove('dawn-glow');
        void m.offsetWidth;
        m.classList.add('dawn-glow');
      };
      m.addEventListener('pointerdown', function(e){
        if (e.button !== 0) return;
        held = false;
        try { m.classList.add('dawn-hold'); } catch (e2){}
        holdT = window.setTimeout(function(){
          held = true;
          offHold();
          try { if (!showing) play(lastCfg || {}); } catch (e2){}
        }, PRESS);
      });
      m.addEventListener('pointerup', offHold);
      m.addEventListener('pointercancel', offHold);
      m.addEventListener('pointerleave', offHold);
      m.addEventListener('click', function(){
        if (held){ held = false; return; }
        cycleMode();
        glow();
      });
      m.addEventListener('keydown', function(e){
        if (e.repeat) return; /* a held key must not machine gun the theme */
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); cycleMode(); glow(); }
      });
    } catch (e){}
  }

  function build(cfg, greet){
    var ov = document.createElement('div');
    ov.id = 'dawn-overlay';
    ov.className = 'dawn-overlay' + (reducedMotion() ? ' dawn-still' : '');
    ov.setAttribute('aria-hidden', 'true');
    var sky = document.createElement('div');  sky.className = 'dawn-sky';
    var day = document.createElement('div'); day.className = 'dawn-day';
    var sun = document.createElement('div'); sun.className = 'dawn-sun';
    var haze = document.createElement('div'); haze.className = 'dawn-haze';
    var text = document.createElement('div'); text.className = 'dawn-text';
    var hello = document.createElement('div'); hello.className = 'dawn-hello';
    var sub = document.createElement('div'); sub.className = 'dawn-sub';
    hello.textContent = greet;
    sub.textContent = cfg.num ? ('warmup no. ' + cfg.num + (cfg.dateText ? ' \u00b7 ' + cfg.dateText : '')) : '';
    text.appendChild(hello); text.appendChild(sub);
    ov.appendChild(sky); ov.appendChild(day); ov.appendChild(sun);
    ov.appendChild(haze); ov.appendChild(text);
    return ov;
  }

  /* the settle: free the sun from the overlay, pin it exactly where
     the rise left it, then fly it into the logo's empty mark spot, on
     to the disc dawn.css draws there. The disc shrinks to the drawn
     mark's own size as its glow burns off, and vanishes onto its own
     resting shape the moment it lands. Returns the flight animation,
     or null if the sun could not be freed. */
  function settle(sun, mark){
    var sr = sun.getBoundingClientRect();
    var tr = mark.getBoundingClientRect();
    var fs = parseFloat(getComputedStyle(mark).fontSize) || 32;
    if (!sr.width || !tr.width || !document.body) return null;
    var fromX = sr.left + sr.width / 2;
    var fromY = sr.top + sr.height / 2;
    var toX = tr.left + DISC_EM / 2 * fs;
    /* the landing is derived, not tuned: the flight ends centered on
       the disc dawn.css draws (its left edge on the period's own
       advance, its foot on the baseline, .34em wide), at exactly its
       diameter, so the bright disc vanishes onto its own resting
       shape. Every font lands the same */
    var toY = tr.bottom - LIFT_EM * fs;
    var dia = DISC_EM * fs;
    var dx = toX - fromX;
    var dy = toY - fromY;
    var scale = dia / sr.width;
    try {
      sun.style.left = sr.left + 'px';
      sun.style.top = sr.top + 'px';
      sun.style.width = sr.width + 'px';
      sun.style.height = sr.height + 'px';
      sun.classList.add('dawn-sun-free');
      document.body.appendChild(sun);
      return sun.animate([
        { transform: 'translate(0,0) scale(1)',
          boxShadow: '0 0 60px 22px rgba(244,183,105,.55), 0 0 150px 70px rgba(244,183,105,.25)' },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')',
          boxShadow: '0 0 12px 4px rgba(244,183,105,0)' }
      ], { duration: FLIGHT, easing: 'cubic-bezier(.42,.05,.3,1)', fill: 'forwards' });
    } catch (e){
      try { sun.parentNode && sun.parentNode.removeChild(sun); } catch (e2){}
      return null;
    }
  }

  function play(cfg){
    cfg = cfg || {};
    if (showing) return false;   /* one show at a time, fade included */
    showing = true;
    var greet = GREETINGS[Math.abs(cfg.dayIndex | 0) % GREETINGS.length];
    /* the first visit ever gets its own line, whatever the day: the
       sunrise is a welcome before it is a habit */
    try {
      if (!localStorage.getItem(FIRST)){
        localStorage.setItem(FIRST, '1');
        greet = 'First light. Welcome.';
      }
    } catch (e){}
    var ov = build(cfg, greet);
    var sun = ov.querySelector('.dawn-sun');
    var gone = false, freeSun = null, flight = null;

    /* the deposit plan: if this show can end in a settle, hold the
       logo's mark back from the first paint, so the sun has an empty
       spot to fill. Every exit path either deposits the mark (the
       flight lands) or reveals it plainly (a skip, a fallback), so the
       page is never left without its dot. */
    var mark = null;
    if (sun && sun.animate && !reducedMotion()){
      try { mark = logoMark(); } catch (e){ mark = null; }
      /* a word is never held back: the deposit is a dot's business */
      if (mark && !isPunct(mark)) mark = null;
    }
    if (mark){
      try {
        mark.classList.add('dawn-awaiting');
        /* and out of the way of the keyboard: an invisible button
           must not catch a tab */
        mark.setAttribute('aria-hidden', 'true');
        mark.setAttribute('tabindex', '-1');
      }
      catch (e){ mark = null; }
    }
    var unhideMark = function(){
      if (!mark) return;
      try {
        mark.classList.remove('dawn-awaiting');
        mark.removeAttribute('aria-hidden');
        mark.setAttribute('tabindex', '0');
      } catch (e){}
    };
    var revealMark = unhideMark;
    var depositMark = function(){
      if (!mark) return;
      unhideMark();
      try {
        mark.classList.remove('dawn-landed');
        void mark.offsetWidth;
        mark.classList.add('dawn-landed');
      } catch (e){}
    };

    var unlisten = function(){
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('pointerdown', dismiss, true);
    };
    var removeOverlay = function(){
      showing = false;
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    };
    var removeSun = function(){
      if (freeSun && freeSun.parentNode) freeSun.parentNode.removeChild(freeSun);
    };
    var dismiss = function(e){
      /* a right click is a menu call, not a skip: only the primary
         button ends the show */
      if (e && e.type === 'pointerdown' && e.button !== 0) return;
      if (gone) return;
      gone = true;
      unlisten();
      if (flight){ try { flight.cancel(); } catch (e){} }
      clearFavTimers();
      restTab();
      revealMark();
      ov.classList.add('dawn-out');
      window.setTimeout(function(){ removeOverlay(); removeSun(); }, 800);
    };
    var end = function(){
      if (gone) return;
      gone = true;
      unlisten();
      if (mark && sun){
        flight = settle(sun, mark);
        if (flight){
          freeSun = sun;
          flight.onfinish = function(){
            try { sun.parentNode && sun.parentNode.removeChild(sun); } catch (e){}
            depositMark();
            restTab();
          };
          flight.oncancel = function(){
            try { sun.parentNode && sun.parentNode.removeChild(sun); } catch (e){}
          };
          ov.classList.add('dawn-out');
          window.setTimeout(removeOverlay, 800);
          return;
        }
      }
      revealMark();
      restTab();
      ov.classList.add('dawn-out');
      window.setTimeout(function(){ removeOverlay(); removeSun(); }, 800);
    };
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('pointerdown', dismiss, true);
    window.setTimeout(end, HOLD);
    if (!reducedMotion()) playTab(greet);
    (document.body || document.documentElement).appendChild(ov);
    return true;
  }

  function init(cfg){
    if (!cfg || !cfg.key) return false;
    lastCfg = cfg;   /* the hold-to-replay uses the day facts too */
    if (!storageWritable() || seenToday(cfg.key)) return false;
    markToday(cfg.key);   /* marked at the start: a greeting cut short by
                             navigation never replays on the next page */
    if (document.hidden){
      var onceVisible = function(){
        document.removeEventListener('visibilitychange', onceVisible);
        play(cfg);
      };
      document.addEventListener('visibilitychange', onceVisible);
      return true;
    }
    return play(cfg);
  }

  window.DAWN = {
    init: init,
    play: function(cfg){
      /* the day facts ride along on a forced play too, so the replay
         a hold triggers greets with the right number and date */
      cfg = cfg || {};
      lastCfg = { dayIndex: cfg.dayIndex || 0, num: cfg.num || 0, dateText: cfg.dateText || '' };
      return play(lastCfg);
    },
    reset: function(){ try { localStorage.removeItem(MARK); } catch (e){} },
    mode: function(){ return storedMode(); }
  };

  /* ---------------- the last minute: the countdown warms ----------------
     The shell ticks the day away into the countdown element; dawn
     watches from the side and warms it when less than a minute
     remains. A garnish, never a gate: no countdown, no observer,
     no harm done */
  function watchCountdown(){
    try {
      var el = document.getElementById('countdown') ||
               document.getElementById('count');
      if (!el || !window.MutationObserver) return;
      var soon = function(){
        var m = /(\d+)h\s+(\d+)m\s+(\d+)s/.exec(el.textContent || '');
        el.classList.toggle('dawn-soon',
          !!m && parseInt(m[1], 10) === 0 && parseInt(m[2], 10) === 0);
      };
      new MutationObserver(soon).observe(el,
        { childList: true, characterData: true, subtree: true });
    } catch (e){}
  }

  /* module boot: restyle the favicon's period as a small sun, tint the
     chrome to the paper of whichever theme is in play, and arm the kiss
     on the logo's mark. All of it is garnish: each piece is wrapped
     soft and the page is unaffected if any of it comes to nothing. */
  findTabBits();
  try {
    darkSys = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (darkSys){
      var follow = function(){ if (storedMode() === 'auto') applyMode(true); };
      if (darkSys.addEventListener) darkSys.addEventListener('change', follow);
      else if (darkSys.addListener) darkSys.addListener(follow);
    }
  } catch (e){}
  armKiss();
  watchCountdown();
  applyMode(false);
})();
