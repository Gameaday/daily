/* Builds two site-only bundles into dist/:
   - dist/offline : everything a browser needs to play over file:// - the
     site files with inline banks intact.
     Open dist/offline/index.html straight off the filesystem.
   - dist/online  : the site with every gated bank stripped to `undefined`
     - the puzzles come from the scores service's /puzzle route. This is
     what the web container bakes in.
   Both bundles are site-only: no tooling, tests, or deploy files, and a
   verification pass fails the build if any relative src/href does not
   resolve inside the bundle or a game's shell wiring went missing. */
import fs from 'node:fs';
import path from 'node:path';

/* the gated-game map has one source of truth: games.json at the repo root */
const GATED = JSON.parse(fs.readFileSync('games.json', 'utf8')).gated;
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'dist', '__pycache__',
  'deploy', 'tests', 'tools', 'checks', 'scores']);
const SKIP_FILES = new Set(['.gitignore', '.dockerignore', '.env', '.env.example',
  'Makefile', 'NOTES.md', 'README.md', 'DEVELOPER.md', 'ROADMAP_1.0.md',
  'package.json', 'package-lock.json', 'docker-compose.yml',
  'Dockerfile.web', 'Dockerfile.scores', 'Caddyfile', 'games.json']);

function copyDir(src, dest){
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })){
    if (entry.isDirectory()){
      if (SKIP_DIRS.has(entry.name)) continue;
      copyDir(path.join(src, entry.name), path.join(dest, entry.name));
    } else if (!SKIP_FILES.has(entry.name)){
      fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    }
  }
}

function stripBanks(html){
  let out = html;
  for (const v of Object.values(GATED)){
    out = out.replace(new RegExp('const ' + v + ' = \\[([\\s\\S]*?)\\];'),
      'const ' + v + ' = undefined;');
  }
  return out;
}

/* verification: every game keeps its shell wiring, every relative
   reference resolves, banks present offline / stripped online */
function checkHtml(file, rootDir, online){
  const problems = [];
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(rootDir, file);
  const isGame = rel.split(path.sep).length === 2 && rel.indexOf(path.sep) >= 0;
  if (isGame){
    if (html.indexOf('<script src="../shell/common.js"></script>') === -1)
      problems.push(file + ': missing ../shell/common.js tag');
    if (html.indexOf('href="../shell/common.css"') === -1)
      problems.push(file + ': missing ../shell/common.css link');
    const game = path.dirname(rel);
    if (GATED[game]){
      const has = new RegExp('const ' + GATED[game] + ' = \\[').test(html);
      if (online && has) problems.push(file + ': bank ' + GATED[game] + ' not stripped');
      if (!online && !has) problems.push(file + ': inline bank ' + GATED[game] + ' missing');
    }
  }
  const dir = path.dirname(file);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('#')) continue;
    const target = path.resolve(dir, ref.split('#')[0]);
    if (!fs.existsSync(target)) problems.push(file + ': broken reference ' + ref);
  }
  return problems;
}

fs.rmSync('dist', { recursive: true, force: true });
copyDir('.', 'dist/offline');
copyDir('.', 'dist/online');
for (const g of Object.keys(GATED)){
  const p = path.join('dist/online', g, 'index.html');
  if (fs.existsSync(p)) fs.writeFileSync(p, stripBanks(fs.readFileSync(p, 'utf8')));
}

const problems = [];
for (const bundle of ['offline', 'online']){
  const rootDir = path.join('dist', bundle);
  for (const f of ['shell/common.js', 'shell/common.css', 'assets/words-en.js'])
    if (!fs.existsSync(path.join(rootDir, f))) problems.push(bundle + ': missing ' + f);
  const stack = [rootDir];
  while (stack.length){
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })){
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.name === 'index.html') problems.push(...checkHtml(p, rootDir, bundle === 'online'));
    }
  }
}
if (problems.length){
  for (const p of problems) console.error('FAIL ' + p);
  process.exit(1);
}
console.log('bundles built: dist/offline (banks intact, plays over file://) + dist/online (banks stripped, puzzles served)');
