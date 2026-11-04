/* Validates every game's index.html without a browser:
   - compiles each game's script (catches fatal syntax errors, like the stray
     emoji escape that once took down Sprint for every player)
   - compiles the shared shell, the word bank and the dawn garnish,
     holding the garnish's js and css classes in agreement
   - checks the shell is wired in (script + css tags, SHELL destructure) and
     that the extracted shell pieces did not sneak back into a game
   - checks every element id the script references exists in the HTML
   - checks the landing page links every game
   Run: node checks/games.js   (exit code 1 on any failure) */
'use strict';
const fs = require('fs');
const path = require('path');

/* the game list has one source of truth: games.json at the repo root
   (export-puzzles cross-checks it against scores/manifest.json in CI).
   Output order here is alphabetical; the play order lives in games.json. */
const LIST = require('../games.json');
const games = [...LIST.order].sort();
const wordBankGames = LIST.wordBank;
const rungBankGames = LIST.rungBank || {};
const SHELL = ['SHELL', 'EPOCH_KEY', 'syncBoard'];
const NOT_IN_GAMES = ['America/New_York', 'function renderBoard', 'function nextETMidnight',
  'const $ = id =>', 'JSON.parse(localStorage.getItem(KEY))',
  'localStorage.setItem(KEY, JSON.stringify(S))'];

let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

/* the shared files themselves */
for (const f of ['shell/common.js', 'shell/common.css', 'shell/dawn.js', 'shell/dawn.css', 'assets/words-en.js', 'assets/words-l4.js']) {
  if (!fs.existsSync(f)) { fail('missing shared file ' + f); continue; }
  console.log('ok  ' + f);
}
if (fs.existsSync('shell/common.js')) {
  try { new Function(fs.readFileSync('shell/common.js', 'utf8')); }
  catch (e) { fail('shell/common.js does not compile: ' + e.message); }
}
/* the dawn garnish is shell surface too: it compiles like any other
   shell piece, and the js and the css must agree on every class the
   show's code names, so a rename on one side cannot slip a silent
   break into the sunrise */
if (fs.existsSync('shell/dawn.js') && fs.existsSync('shell/dawn.css')) {
  const dawnJs = fs.readFileSync('shell/dawn.js', 'utf8');
  try { new Function(dawnJs); }
  catch (e) { fail('shell/dawn.js does not compile: ' + e.message); }
  /* prose comments may name classes that do not exist; only the
     code's own class names must be styled */
  const dawnCode = dawnJs.replace(/\/[\s\S]*?\*\//g, '');
  const dawnCss = fs.readFileSync('shell/dawn.css', 'utf8');
  for (const c of new Set(dawnCode.match(/dawn-[\w-]+/g) || [])) {
    if (dawnCss.indexOf('.' + c) === -1)
      fail('shell/dawn.js names .' + c + ' but dawn.css never styles it');
  }
}
if (fs.existsSync('assets/words-en.js')) {
  try { new Function(fs.readFileSync('assets/words-en.js', 'utf8')); }
  catch (e) { fail('assets/words-en.js does not compile: ' + e.message); }
  const m = fs.readFileSync('assets/words-en.js', 'utf8').match(/const WORDS_EN = "([^"]*)"/);
  if (!m) fail('assets/words-en.js: WORDS_EN string not found');
  else {
    const list = m[1].split(',');
    if (list.some(w => !/^[A-Z]{3,5}$/.test(w))) fail('words-en.js: entries must be uppercase A-Z, 3-5 letters');
    if (new Set(list).size !== list.length) fail('words-en.js: duplicate entries');
  }
}
if (fs.existsSync('assets/words-l4.js')) {
  try { new Function(fs.readFileSync('assets/words-l4.js', 'utf8')); }
  catch (e) { fail('assets/words-l4.js does not compile: ' + e.message); }
  const lm = fs.readFileSync('assets/words-l4.js', 'utf8').match(/const WORDS_L4 = "([^"]*)"/);
  if (!lm) fail('assets/words-l4.js: WORDS_L4 string not found');
  else {
    const list = lm[1].split(',');
    if (list.some(w => !/^[A-Z]{4}$/.test(w))) fail('words-l4.js: entries must be uppercase A-Z, exactly 4 letters');
    if (new Set(list).size !== list.length) fail('words-l4.js: duplicate entries');
    if (list.some((w, i) => i > 0 && list[i - 1] > w)) fail('words-l4.js: entries must be alphabetical');
    /* a rung may be an answer: every curated 4-letter word stays typeable */
    const wm = fs.readFileSync('assets/words-en.js', 'utf8').match(/const WORDS_EN = "([^"]*)"/);
    if (wm) {
      const wide = new Set(list);
      const gone = wm[1].split(',').filter(w => w.length === 4 && !wide.has(w));
      if (gone.length) fail('words-l4.js: lost curated 4-letter words (e.g. ' + gone[0] + ')');
    }
  }
}

for (const g of games) {
  const file = path.join(g, 'index.html');
  if (!fs.existsSync(file)) { fail(g + ': missing ' + file); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) { fail(g + ': no <script> block'); continue; }
  const js = m[1];

  try { new Function(js); } /* compile only, never run */
  catch (e) { fail(g + ': script does not compile: ' + e.message); continue; }

  for (const need of SHELL) {
    if (js.indexOf(need) === -1) fail(g + ': missing shell piece ' + need);
  }
  if (html.indexOf('<script src="../shell/common.js"></script>') === -1)
    fail(g + ': does not load shell/common.js');
  if (html.indexOf('href="../shell/common.css"') === -1)
    fail(g + ': does not link shell/common.css');
  for (const gone of NOT_IN_GAMES) {
    if (js.indexOf(gone) !== -1) fail(g + ': shell code should live in common.js, found ' + gone);
  }
  if (wordBankGames.includes(g)) {
    if (html.indexOf('<script src="../assets/words-en.js"></script>') === -1)
      fail(g + ': does not load the shared word bank');
    if (js.indexOf('WORDS_EN') === -1) fail(g + ': does not reference WORDS_EN');
  }
  const rungFile = rungBankGames[g];
  if (rungFile){
    const rungVar = rungFile.toUpperCase().replace(/-/g, '_');
    if (html.indexOf('<script src="../assets/' + rungFile + '.js"></script>') === -1)
      fail(g + ': does not load assets/' + rungFile + '.js');
    if (js.indexOf(rungVar) === -1) fail(g + ': does not reference ' + rungVar);
  }

  const ids = new Set();
  for (const x of html.matchAll(/\bid="([\w-]+)"/g)) ids.add(x[1]);
  for (const x of js.matchAll(/\$\(\s*'([\w-]+)'\s*\)/g)) {
    if (!ids.has(x[1])) fail(g + ': script references missing element id ' + x[1]);
  }

  console.log('ok  ' + g);
}

const landing = fs.readFileSync('index.html', 'utf8');
for (const g of games) {
  if (landing.indexOf(g + '/') === -1) fail('landing: no card for ' + g);
}

/* server-gated delivery: every gated game loads its generated bank file for
   solo/offline play AND defers to the scores service when online */
const GATED = LIST.gated;
for (const g of Object.keys(GATED)) {
  const bank = GATED[g];
  const file = path.join(g, 'index.html');
  if (!fs.existsSync(file)) { fail(g + ': missing ' + file); continue; }
  const html = fs.readFileSync(file, 'utf8');
  if (html.indexOf('<script src="../assets/banks/' + g + '.js"></script>') === -1)
    fail(g + ': does not load assets/banks/' + g + '.js');
  const bankFile = path.join('assets', 'banks', g + '.js');
  if (!fs.existsSync(bankFile)) { fail(g + ': missing ' + bankFile); }
  else {
    const bsrc = fs.readFileSync(bankFile, 'utf8');
    if (bsrc.indexOf('const ' + bank + ' = [') !== 0 &&
        bsrc.indexOf('const ' + bank + ' = {') !== 0)
      fail(g + ': generated bank must start with const ' + bank + ' = [ or {');
    try { new Function(bsrc); } catch (e) { fail(g + ': bank file does not compile: ' + e.message); }
  }
  const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  if (js.indexOf('fetchPuzzle') === -1) fail(g + ': does not fetch its puzzle from the scores service');
  if (js.indexOf('isSolo()') === -1) fail(g + ': does not keep the solo/offline path');
}
for (const g of Object.keys(GATED))
  if (!LIST.order.includes(g)) fail('games.json: gated game ' + g + ' missing from order');

if (failures) {
  console.error('');
  console.error(failures + ' failure(s)');
  process.exit(1);
}
console.log('all ' + games.length + ' games + landing validated');
