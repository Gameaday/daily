/* Cross-checks: every game's curve client must agree with the shared
   manifest (which owns the better-directions, the histogram edges, the
   epoch, and the timezone), the shell pieces must all be present, and
   the landing page must link every game. */
'use strict';

function run(h, ctx){
    const { GAMES, serverPy, landing, readGame, readShared, manifest } = ctx;
    h.group('shell <-> server cross-check');
    const specs = manifest.games;
    h.ok(serverPy.indexOf('manifest.json') >= 0, 'server: SPECS loaded from manifest.json');
    const serverKey = g => (g === 'recycle-rings' ? 'rings' : (g === 'recycle-grid' ? 'grid' : g));
    for (const g of GAMES){
      const html = readGame(g);
      const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
      const gName = (js.match(/const SYNC_GAME = '([^']+)'/) || [])[1];
      const gBetter = (js.match(/const SYNC_BETTER = '([^']+)'/) || [])[1];
      h.ok(!!gName && gName === serverKey(g), g + ': SYNC_GAME matches server key');
      h.ok(!!specs[gName], g + ': server has a SPECS entry');
      if (specs[gName]) h.ok(specs[gName].better === gBetter, g + ': client better direction matches server');
      /* shell wiring: every page loads the shell before its inline script */
      h.ok(html.indexOf('<script src="../shell/common.js"></script>') >= 0,
        g + ': loads shell/common.js');
      h.ok(html.indexOf('href="../shell/common.css"') >= 0, g + ': links shell/common.css');
      /* extraction completeness: the shared pieces must live in the shell now */
      h.ok(js.indexOf('America/New_York') === -1, g + ': day math extracted to shell');
      h.ok(js.indexOf('function renderBoard') === -1, g + ': renderBoard extracted to shell');
      h.ok(js.indexOf('JSON.parse(localStorage.getItem(KEY))') === -1, g + ': loadState extracted to shell');
      h.ok(js.indexOf('function toastMsg(') === -1 && js.indexOf('function toast(') === -1,
        g + ': toast extracted to shell');
      h.ok(js.indexOf('function syncBoard(value)') === -1, g + ': curve client extracted to shell');
      h.ok(js.indexOf('nextETMidnight() - Date.now()') === -1, g + ': countdown extracted to shell');
    }
    h.ok(GAMES.every(g => !!specs[serverKey(g)]), 'manifest: has a spec for every game');
    for (const g of GAMES) h.ok(landing.indexOf(g + '/') >= 0, 'landing: links to ' + g);

    /* the shell itself: the curve strings moved here from every game */
    const shell = readShared('bogus');
    h.ok(shell.indexOf('SYNC_UNIT') === -1, 'shell: no leftover SYNC_UNIT');
    h.ok(shell.indexOf('you-mark') >= 0, 'shell: curve you-mark present');
    h.ok(shell.indexOf('curve offline') >= 0, 'shell: offline grace present');
    h.ok(shell.indexOf('const SHELL') >= 0, 'shell: defines the SHELL module');
    h.ok(shell.indexOf('solo mode') >= 0, 'shell: air-gapped solo mode present');
    h.ok(shell.indexOf("const TZ = '" + manifest.tz + "'") >= 0,
      'shell: TZ matches the manifest timezone');
    h.ok(shell.indexOf("const EPOCH_KEY = '" + manifest.epoch + "'") >= 0,
      'shell: EPOCH_KEY matches the manifest epoch');
    try { new Function(shell); h.ok(true, 'shell: compiles standalone'); }
    catch (e){ h.ok(false, 'shell: compiles standalone: ' + e.message); }

    /* the shared word bank: one copy on disk, referenced not inlined */
    const words = readShared('trace');
    h.ok(words.indexOf('const WORDS_EN = ') >= 0, 'words: bank defines WORDS_EN');
    h.ok(words.indexOf('ABOUT') >= 0 && words.indexOf('YOUTH') >= 0, 'words: bank populated');
    for (const g of ['trace', 'recycle-grid', 'recycle-rings']){
      const html = readGame(g);
      const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
      h.ok(html.indexOf('<script src="../assets/words-en.js"></script>') >= 0,
        g + ': loads the shared word bank');
      h.ok(js.indexOf('WORDS_EN') >= 0, g + ': references WORDS_EN');
      h.ok(js.indexOf('const DICT_SRC = "') === -1, g + ': word list no longer inlined');
    }
    h.ok(readGame('sprint').indexOf('DICT5_SRC') >= 0,
      'sprint: keeps its own anagram lists (different bank, by design)');

    /* the shared bank stays clean: uppercase 3-5 letter words, no dups */
    {
      const wm = words.match(/const WORDS_EN = "([^"]*)"/);
      h.ok(!!wm, 'words: bank string parses');
      if (wm){
        const list = wm[1].split(',');
        const bad = list.filter(w => !/^[A-Z]{3,5}$/.test(w));
        h.eq(bad.length, 0, 'words: every entry is A-Z, 3-5 letters' +
          (bad.length ? ' (e.g. ' + bad[0] + ')' : ''));
        h.eq(new Set(list).size, list.length, 'words: no duplicate entries');
      }
    }

    /* sprint's inline anagram banks stay clean: no typos, no wrong-length
       strays — junk entries could accept non-words as valid answers */
    {
      const html = readGame('sprint');
      const d4 = html.match(/const DICT_SRC = '([^']*)'/);
      const d5 = html.match(/const DICT5_SRC = '([^']*)'/);
      h.ok(!!d4 && !!d5, 'sprint: anagram banks parse');
      if (d4 && d5){
        const bad4 = d4[1].split(',').filter(w => !/^[A-Z]{4}$/.test(w));
        h.eq(bad4.length, 0, 'sprint: 4-letter bank is clean A-Z' +
          (bad4.length ? ' (e.g. ' + bad4[0] + ')' : ''));
        const bad5 = d5[1].split(',').filter(w => !/^[A-Z]{5}$/.test(w));
        h.eq(bad5.length, 0, 'sprint: 5-letter bank is clean A-Z' +
          (bad5.length ? ' (e.g. ' + bad5[0] + ')' : ''));
        const junk = ['BASON', 'YOUK', 'WRAY', 'TASS', 'GLANE', 'TICKY', 'WRITH', 'FATCH'];
        h.ok(junk.every(w => d4[1].indexOf(w) === -1 && d5[1].indexOf(w) === -1),
          'sprint: known typos stay gone (regression)');
      }
    }
}

module.exports = { name: 'cross-checks', run };
