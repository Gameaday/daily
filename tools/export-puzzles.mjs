import fs from 'node:fs';

const games = ['bogus', 'well-actually'];
const out = {};
for (const g of games) {
  const src = fs.readFileSync(`${g}/index.html`, 'utf8');
  const m = src.match(/const PUZZLES = (\[[\s\S]*?\]);/);
  if (!m) throw new Error(`PUZZLES not found in ${g}`);
  // eslint-disable-next-line no-eval
  out[g] = eval(m[1]);
}
fs.writeFileSync('scores/puzzles.json', JSON.stringify(out, null, 2));
console.log('exported', games.join(', '));