/* Local wording check: one word is banned by convention here - it kept
   creeping into comments and copy where it reads wrong. It must not appear
   in any tracked text file outside the dictionaries that legitimately
   contain it as a playable word. Runs from checks/games.js as part of
   `npm test` / `make test` - the same rule the CI grep enforced, now
   local where it belongs (the CI copy matched its own workflow file).
   Run alone:
     node -e "console.log(require('./checks/wording').runWordingCheck())" */
'use strict';
const fs = require('fs');
const path = require('path');

const PATTERN = /\bteam\b/i;
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'dist', '__pycache__', 'deploy']);
const SKIP_FILES = new Set([
  'words-en.js', 'valid-en.js', 'wordlist-20210729.txt', 'wordlist-clean.txt',
  'puzzles.json', 'wording.js', 'sprint/index.html'
]);
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.md', '.yml', '.yaml',
  '.json', '.py', '.sh', '.service', '.timer', '.txt']);
const ALWAYS_TEXT = new Set(['Makefile', 'Caddyfile', 'Dockerfile',
  'Dockerfile.web', 'Dockerfile.scores', '.gitignore', '.dockerignore', '.env.example']);

function isTextFile(name){
  return ALWAYS_TEXT.has(name) || TEXT_EXT.has(path.extname(name));
}

function runWordingCheck(){
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })){
      if (entry.isDirectory()){
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (isTextFile(entry.name)){
        const rel = path.join(dir, entry.name);
        if (SKIP_FILES.has(rel) || SKIP_FILES.has(entry.name)) continue;
        const lines = fs.readFileSync(rel, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (PATTERN.test(line)) hits.push(rel + ':' + (i + 1));
        });
      }
    }
  };
  walk('.');
  return hits;
}

module.exports = { runWordingCheck };
