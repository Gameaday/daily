/* dawn.js - first light: the once-a-day sunrise greeting.

   The dawn is a garnish, never a gate. Any page can be the first page
   of the day (the landing, or a bookmark straight into a game), so the
   shell loads this module everywhere and hands it the day facts; the
   sunrise then plays at most once per ET day per browser, wherever you
   came in from. The choreography lives in dawn.css; the trigger, the
   once-per-day guard and the cleanup live here. The two files are the
   whole feature, so revising the look means revising one css file.

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

  function play(cfg){
    cfg = cfg || {};
    if (document.getElementById('dawn-overlay')) return false;
    var ov = build(cfg);
    var gone = false;
    var remove = function(){
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('pointerdown', dismiss, true);
    };
    var dismiss = function(){
      if (gone) return;
      gone = true;
      ov.classList.add('dawn-out');
      window.setTimeout(remove, 800);
    };
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('pointerdown', dismiss, true);
    window.setTimeout(dismiss, HOLD);
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
