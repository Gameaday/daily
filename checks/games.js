/* Validates every game's index.html without a browser:
   - compiles each game's script (catches fatal syntax errors, like the stray
     emoji escape that once took down Sprint for every player)
   - checks the shared shell pieces are present
   - checks every element id the script references exists in the HTML
   - checks the landing page links every game
   Run: node checks/games.js   (exit code 1 on any failure) */
'use strict';
const fs = require('fs');
const path = require('path');

const games = ['bogus', 'cipher', 'fermi', 'lightbox', 'museum', 'recycle-grid',
  'recycle-rings', 'rounds', 'sift', 'sprint', 'timeline', 'trace', 'well-actually'];
const SHELL = ['EPOCH_KEY', 'syncBoard', 'renderBoard', 'America/New_York'];

let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

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
