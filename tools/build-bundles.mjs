import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const OFFLINE = path.join(DIST, 'offline');
const ONLINE = path.join(DIST, 'online');

const SKIP = new Set(['.git', 'node_modules', 'dist', '__pycache__', 'scores/puzzles.json'.replace(/\//g, path.sep)]);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    const rel = path.relative(ROOT, s);
    if (SKIP.has(rel) || SKIP.has(entry.name)) continue;
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stripPuzzles(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/const PUZZLES = \[[\s\S]*?\];/, 'const PUZZLES = undefined;');
  fs.writeFileSync(file, out);
}

// fresh dist
fs.rmSync(DIST, { recursive: true, force: true });
copyDir(ROOT, OFFLINE);
copyDir(ROOT, ONLINE);

// online bundle must not ship puzzle data or the server-side puzzle store
for (const g of ['bogus', 'well-actually']) {
  stripPuzzles(path.join(ONLINE, g, 'index.html'));
}
const onlinePuzzles = path.join(ONLINE, 'scores', 'puzzles.json');
if (fs.existsSync(onlinePuzzles)) fs.rmSync(onlinePuzzles);

// offline bundle keeps (and may need) the generated puzzle store; generate if present
const offlineStore = path.join(OFFLINE, 'scores', 'puzzles.json');
if (!fs.existsSync(offlineStore)) {
  const srcStore = path.join(ROOT, 'scores', 'puzzles.json');
  if (fs.existsSync(srcStore)) fs.copyFileSync(srcStore, offlineStore);
}

console.log('built dist/offline and dist/online');