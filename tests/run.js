/* Layer 2 orchestrator. Each game's tests live in their own module:

     tests/games/<game>.js        the game's headless playthrough (win,
                                  loss, day rollover; regression notes
                                  inline, unchanged from the old
                                  monolithic tests/run.js)
     tests/games/server-gated.js  online delivery with the banks stripped
     tests/games/cross-checks.js  shell <-> manifest <-> landing agreement
     tests/games/_lib.js          the shared game list + pinned days

   This file only wires them together, so dropping a game later means
   deleting its folder and its module - nothing here changes. Same CLI
   as ever: node tests/run.js (exit 1 on any failure). */
'use strict';

const { GAMES } = require('./games/_lib');

const MODULES = [
  'bogus', 'well-actually', 'recycle-rings', 'recycle-grid', 'fermi',
  'sift', 'rounds', 'trace', 'lightbox', 'sprint', 'cipher', 'timeline',
  'museum', 'server-gated'
].map(file => require('./games/' + file + '.js'));

async function main(h, ctx){
  for (const mod of MODULES){
    h.group(mod.name);
    try { await mod.run(h, ctx); }
    catch (e){
      const c = h.results[h.results.length - 1];
      c.fail++;
      c.failures.push('EXCEPTION: ' + (e && e.message ? e.message : String(e)));
    }
  }
  require('./games/cross-checks').run(h, ctx);

  /* Suite-guard: Node exits 0 on an empty file, so a wiring bug must not be
     able to pass silently. Fail unless modules are wired in AND the suite
     actually ran at least one assertion. */
  h.group('suite-guard');
  const ran = h.results.slice(0, -1).reduce((n, r) => n + r.pass + r.fail, 0);
  h.ok(MODULES.length > 0, 'test modules are wired in (MODULES is not empty)');
  h.ok(ran > 0, 'the suite ran assertions (' + MODULES.length + ' modules loaded)');

  const s = h.summary();
  return { summary: s.lines, pass: s.pass, fail: s.fail };
}

module.exports = { main, GAMES, MODULES };

/* CLI entry: read the repo files with fs, run, exit nonzero on failure. */
if (typeof require === 'function' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { createHarness } = require('./harness');
  const ROOT = path.join(__dirname, '..');
  const SHELL_JS = fs.readFileSync(path.join(ROOT, 'shell', 'common.js'), 'utf8');
  const WORDS_JS = fs.readFileSync(path.join(ROOT, 'assets', 'words-en.js'), 'utf8');
  const BANKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8')).gated;
  const readBank = g => fs.readFileSync(path.join(ROOT, 'assets', 'banks', g + '.js'), 'utf8');
  const ctx = {
    GAMES,
    readGame: g => fs.readFileSync(path.join(ROOT, g, 'index.html'), 'utf8'),
    serverPy: fs.readFileSync(path.join(ROOT, 'scores', 'server.py'), 'utf8'),
    landing: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    readShared: (g, stubBanks) => SHELL_JS +
      (g === 'trace' || g === 'recycle-grid' || g === 'recycle-rings' ? '\n' + WORDS_JS : '') +
      (BANKS[g] ? '\n' + (stubBanks ? 'const ' + BANKS[g] + ' = undefined;' : readBank(g)) : ''),
    manifest: JSON.parse(fs.readFileSync(path.join(ROOT, 'scores', 'manifest.json'), 'utf8')),
    readStore: () => {
      try {
        const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'puzzles', 'timeline', 'puzzles.json'), 'utf8'));
        const rounds = JSON.parse(fs.readFileSync(path.join(ROOT, 'puzzles', 'rounds', 'puzzles.json'), 'utf8'));
        return JSON.stringify({ timeline, rounds });
      } catch (e){ return null; }
    }
  };
  main(createHarness(ctx.readGame, ctx.readShared), ctx)
    .then(out => {
      console.log(out.summary);
      process.exit(out.fail ? 1 : 0);
    })
    .catch(e => { console.error(e); process.exit(1); });
}
