/* Validates every game's index.html without a browser:
   - compiles each game's script (catches fatal syntax errors, like the stray
     emoji escape that once took down Sprint for every player)
   - compiles the shared shell and the word bank
   - checks the shell is wired in (script + css tags, SHELL destructure) and
     that the extracted shell pieces did not sneak back into a game
   - checks every element id the script references exists in the HTML
   - checks the landing page links every game
   Run: node checks/games.js   (exit code 1 on any failure) */
'use strict';
const fs = require('fs');
const path = require('path');

const games = ['bogus', 'cipher', 'fermi', 'lightbox', 'museum', 'recycle-grid',
  'recycle-rings', 'rounds', 'sift', 'sprint', 'timeline', 'trace', 'well-actually'];
const wordBankGames = ['recycle-grid', 'trace'];
const SHELL = ['SHELL', 'EPOCH_KEY', 'syncBoard'];
const NOT_IN_GAMES = ['America/New_York', 'function renderBoard', 'function nextETMidnight',
  'const $ = id =>', 'JSON.parse(localStorage.getItem(KEY))',
  'localStorage.setItem(KEY, JSON.stringify(S))'];

let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

/* the shared files themselves */
for (const f of ['shell/common.js', 'shell/common.css', 'assets/words-en.js']) {
  if (!fs.existsSync(f)) { fail('missing shared file ' + f); continue; }
  console.log('ok  ' + f);
}
if (fs.existsSync('shell/common.js')) {
  try { new Function(fs.readFileSync('shell/common.js', 'utf8')); }
  catch (e) { fail('shell/common.js does not compile: ' + e.message); }
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

if (failures) {
  console.error('');
  console.error(failures + ' failure(s)');
  process.exit(1);
}
console.log('all ' + games.length + ' games + landing validated');

