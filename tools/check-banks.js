const fs = require('fs');
const path = require('path');

// Check each game's index.html for fetchPuzzle usage (server-driven puzzle delivery)
const GAMES = [
  'trace',
  'recycle-grid',
  'recycle-rings',
  'sprint',
  'sift',
  'museum',
  'lightbox',
  'fermi',
  'cipher',
  'well-actually',
  'rounds',
  'timeline',
  'bogus'
];

function checkGame(game) {
  const htmlPath = path.join('.', game, 'index.html');
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const hasFetchPuzzle = html.indexOf('fetchPuzzle') !== -1;
    const hasBanks = html.indexOf('const BANKS') !== -1;
    const hasIsSolo = html.indexOf('isSolo') !== -1;
    console.log(game + ': fetchPuzzle=' + hasFetchPuzzle +
      ', BANKS=' + hasBanks +
      ', isSolo=' + hasIsSolo);
  } catch (e) {
    console.log(game + ': error - ' + e.message);
  }
}

for (const game of GAMES) {
  checkGame(game);
}
