/* Exports every server-gated game's puzzle bank to scores/puzzles.json -
   the store the scores service serves /puzzle from. The file is generated
   (and gitignored): CI, the Docker builds, and make test all regenerate
   it, so the banks live in exactly one place - the game files.
   Direct games ship their whole bank; timeline ships precomputed picks
   (the same five events the offline page picks for each day), so the
   server never re-implements the game's shuffle. Picks cover HORIZON
   days; grow the constant and re-export to extend the window. */
import fs from 'node:fs';

const DIRECT = {
  bogus: 'PUZZLES',
  'well-actually': 'PUZZLES',
  rounds: 'EVENTS',
  fermi: 'QS',
  cipher: 'QUOTES',
  museum: 'MUSEUM',
  lightbox: 'DESIGNS',
  sift: 'BOARDS'
};
const HORIZON = 1000;

function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function readBank(game, name){
  const src = fs.readFileSync(game + '/index.html', 'utf8');
  const m = src.match(new RegExp('const ' + name + ' = (\\[([\\s\\S]*?)\\]);'));
  if (!m) throw new Error(name + ' bank not found in ' + game + '/index.html');
  const bank = eval(m[1]);   // eslint-disable-line no-eval
  if (!Array.isArray(bank) || bank.length === 0) throw new Error(game + ': ' + name + ' is empty');
  return bank;
}

const out = {};
for (const [game, name] of Object.entries(DIRECT)) out[game] = readBank(game, name);

/* timeline: five events with distinct years per day - identical to the
   page's own offline pick (same seed, same shuffle, same walk) */
{
  const bank = readBank('timeline', 'EVENTS');
  const picks = [];
  for (let day = 0; day < HORIZON; day++){
    const rng = mulberry32(day * 2357 + 71);
    const idxs = [];
    for (let i = 0; i < bank.length; i++) idxs.push(i);
    for (let i = idxs.length - 1; i > 0; i--){
      const j = Math.floor(rng() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const picked = [];
    const seenYears = new Set();
    for (const i of idxs){
      if (!seenYears.has(bank[i].y)){ picked.push(i); seenYears.add(bank[i].y); }
      if (picked.length === 5) break;
    }
    if (picked.length !== 5) throw new Error('timeline: day ' + day + ' picked ' + picked.length);
    picks.push(picked);
  }
  out.timeline = { bank: bank, picks: picks };
}

fs.writeFileSync('scores/puzzles.json', JSON.stringify(out, null, 2) + '\n');
console.log('exported ' + Object.keys(out).join(', ') + ' -> scores/puzzles.json');
