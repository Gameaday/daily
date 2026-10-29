const fs = require('fs');
const p = fs.readFileSync('C:/Project/daily/scores/puzzles.json','utf8');
// Count total puzzles
const total = (p.match(/"t":/g) || []).length;
console.log('Total puzzles with "t":', total);

// Count per known game category
const games = ['bogus','well-actually','rings','grid','grid-hard','fermi','cipher','museum','timeline','lightbox','sift','rounds','trace'];
for (const g of games) {
  // Count occurrences of "t": followed by game name
  const regex = new RegExp('"t":\\s*"' + g + ' [\\s\\S]*?"', 'g');
  const matches = p.match(regex);
  console.log(g + ':', matches ? matches.length : 0, 'puzzles');
}

// Count total entries in the JSON
const obj = JSON.parse(p);
console.log('Top-level keys:', Object.keys(obj));
for (const [key, val] of Object.entries(obj)) {
  console.log(key + ':', Array.isArray(val) ? val.length : 'not array', 'items');
}