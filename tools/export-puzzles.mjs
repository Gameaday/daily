/* Verifies the committed per-game puzzle stores (scores/<game>/puzzles.json)
   against the banks in the client pages. Every direct game's store must
   deep-equal its inline bank, generator games ship empty stores by design,
   and the timeline store's {bank, picks} must match the page's bank plus a
   fresh offline pick for every day in its window (same seed, same shuffle,
   same distinct-years walk).

   The stores are committed - this script never writes anything. It exits 1
   on drift, so CI catches a bank edited without re-exporting its store.
   Run: node tools/export-puzzles.mjs   (exit 0 = verified, 1 = drift) */
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
const EMPTY = ['sprint', 'trace', 'recycle-grid', 'recycle-rings'];

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

function readStore(game){
  return JSON.parse(fs.readFileSync('scores/' + game + '/puzzles.json', 'utf8'));
}

let fails = 0;
const fail = msg => { console.error('FAIL ' + msg); fails++; };

/* direct games: committed store must equal the inline bank */
for (const [game, name] of Object.entries(DIRECT)) {
  const bank = readBank(game, name);
  const store = readStore(game);
  if (JSON.stringify(store) !== JSON.stringify(bank))
    fail(game + ': committed store does not match the inline bank');
  else console.log('ok  ' + game + ': store matches the client bank (' + bank.length + ' entries)');
}

/* generator games: empty stores by design */
for (const game of EMPTY) {
  const store = readStore(game);
  if (!Array.isArray(store) || store.length !== 0)
    fail(game + ': generator game store must be an empty array');
  else console.log('ok  ' + game + ': empty store (generator game)');
}

/* timeline: windowed store - the whole bank plus precomputed picks */
{
  const bank = readBank('timeline', 'EVENTS');
  const store = readStore('timeline');
  if (JSON.stringify(store.bank) !== JSON.stringify(bank))
    fail('timeline: committed bank does not match the inline bank');
  else console.log('ok  timeline: bank matches the client bank (' + bank.length + ' events)');
  if (!Array.isArray(store.picks) || store.picks.length === 0)
    fail('timeline: no precomputed picks');
  else {
    let bad = 0;
    for (let day = 0; day < store.picks.length; day++){
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
      if (JSON.stringify(picked) !== JSON.stringify(store.picks[day])){
        bad++;
        if (bad === 1) fail('timeline: picks drift from the offline walk (first bad day: ' + day + ')');
      }
    }
    if (!bad) console.log('ok  timeline: ' + store.picks.length + ' precomputed picks match the offline walk');
  }
}

if (fails){
  console.error('');
  console.error(fails + ' store(s) drifted from the client banks');
  process.exit(1);
}
console.log('');
console.log('all committed stores verified against the client banks');
