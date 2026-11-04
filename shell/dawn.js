/* dawn.js - first light: the once-a-day sunrise greeting.

   The dawn is a garnish, never a gate. Any page can be the first page
   of the day (the landing, or a bookmark straight into a game), so the
   shell loads this module everywhere and hands it the day facts; the
   sunrise then plays at most once per ET day per browser, wherever you
   came in from. The choreography lives in dawn.css; the trigger, the
   once-per-day guard and the cleanup live here.

   The ending: the sun settles into the logo. Every page's own heading
   ends in a colored mark (the period of "Warmup." on the landing, the
   dot of a game's name on its page), and the sunrise's last second
   flies the disc out of the sky and into that very mark, shrinking as
   it travels, then vanishing onto it so the logo's own dot carries
   the morning. A page with no such mark, a visitor who prefers
   stillness, or a browser without the web animations api gets the
   plain dissolve instead.

   Contract with the shell (common.js passes these in):
     key      the ET date key for today, as YYYY-MM-DD
     num      the puzzle number of the day
     dayIndex the day index, the greeting line rotates on it
     dateText the date line, e.g. Wed, Nov 4 2026

   Surface (for previews and QA):
     DAWN.init(cfg)   auto: plays only if this day has not been greeted
     DAWN.play(cfg)   force: plays now regardless of the marker
     DAWN.reset()    clears the marker, so a later init() plays again
*/
(function(){
  'use strict';
  var MARK = 'warmup.dawn';
  var HOLD = 4600;   /* the sunrise holds this long; keep in step with
                        the keyframes in dawn.css */
  var FLIGHT = 1100; /* the settle: the sun's trip from the sky into the
                        logo's mark */
  var GREETINGS = [
    'Good morning.',
    'First light. Fresh warm-ups.',
    'A new day warms up.',
    'Rise and shine.',
    'Up with the sun.',
    'Hello, early bird.',
    'The day begins.'
  ];

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

  function build(cfg){
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
    hello.textContent = GREETINGS[Math.abs(cfg.dayIndex | 0) % GREETINGS.length];
    sub.textContent = cfg.num ? ('warmup no. ' + cfg.num + (cfg.dateText ? ' \u00b7 ' + cfg.dateText : '')) : '';
    text.appendChild(hello); text.appendChild(sub);
    ov.appendChild(sky); ov.appendChild(day); ov.appendChild(sun);
    ov.appendChild(haze); ov.appendChild(text);
    return ov;
  }

  /* the settle: free the sun from the overlay, pin it exactly where
     the rise left it, then fly it into the logo's mark. The disc
     shrinks to the mark's own size as its glow burns off, and the
     page's dot (already the accent color) receives it. Returns the
     flight animation, or null if the sun could not be freed. */
  function settle(sun, mark){
    var sr = sun.getBoundingClientRect();
    var tr = mark.getBoundingClientRect();
    var fs = parseFloat(getComputedStyle(mark).fontSize) || 32;
    if (!sr.width || !tr.width || !document.body) return null;
    var fromX = sr.left + sr.width / 2;
    var fromY = sr.top + sr.height / 2;
    var toX = tr.left + tr.width / 2;
    var toY = tr.bottom - 0.27 * fs; /* a period sits just above the
                                        baseline, at the box's bottom */
    var dia = Math.max(8, Math.min(26, fs * 0.24));
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
    if (document.getElementById('dawn-overlay')) return false;
    var ov = build(cfg);
    var sun = ov.querySelector('.dawn-sun');
    var gone = false, freeSun = null, flight = null;
    var unlisten = function(){
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('pointerdown', dismiss, true);
    };
    var removeOverlay = function(){
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    };
    var removeSun = function(){
      if (freeSun && freeSun.parentNode) freeSun.parentNode.removeChild(freeSun);
    };
    var popMark = function(mark){
      try {
        mark.classList.remove('dawn-landed');
        void mark.offsetWidth;
        mark.classList.add('dawn-landed');
      } catch (e){}
    };
    var dismiss = function(){
      if (gone) return;
      gone = true;
      unlisten();
      if (flight){ try { flight.cancel(); } catch (e){} }
      ov.classList.add('dawn-out');
      window.setTimeout(function(){ removeOverlay(); removeSun(); }, 800);
    };
    var end = function(){
      if (gone) return;
      gone = true;
      unlisten();
      var mark = null;
      if (sun && sun.animate && !reducedMotion()){
        try { mark = logoMark(); } catch (e){ mark = null; }
      }
      if (mark && sun){
        flight = settle(sun, mark);
        if (flight){
          freeSun = sun;
          flight.onfinish = function(){
            try { sun.parentNode && sun.parentNode.removeChild(sun); } catch (e){}
            popMark(mark);
          };
          flight.oncancel = function(){
            try { sun.parentNode && sun.parentNode.removeChild(sun); } catch (e){}
          };
          ov.classList.add('dawn-out');
          window.setTimeout(removeOverlay, 800);
          return;
        }
      }
      ov.classList.add('dawn-out');
      window.setTimeout(function(){ removeOverlay(); removeSun(); }, 800);
    };
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('pointerdown', dismiss, true);
    window.setTimeout(end, HOLD);
    (document.body || document.documentElement).appendChild(ov);
    return true;
  }

  function init(cfg){
    if (!cfg || !cfg.key) return false;
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
    play: function(cfg){ cfg = cfg || {}; return play({ dayIndex: cfg.dayIndex || 0, num: cfg.num || 0, dateText: cfg.dateText || '' }); },
    reset: function(){ try { localStorage.removeItem(MARK); } catch (e){} }
  };
})();
