const fs = require('fs');
const p = fs.readFileSync('scores/puzzles.json', 'utf8');
const obj = JSON.parse(p);

function walk(entries) {
  if (!entries) return;
  console.log('walk called with type:', Array.isArray(entries) ? 'array' : typeof entries, entries ? entries.constructor.name : 'null');
  if (Array.isArray(entries)) {
    console.log('  array length:', entries.length);
    if (entries.length > 0) {
      console.log('  first element:', entries[0] ? entries[0].constructor.name : 'empty');
      if (entries[0] && entries[0].t) {
        console.log('  -> Found puzzle array! Adding', entries.length, 'puzzles');
        entries.forEach(p => console.log('   -', p.t));
      }
    }
    entries.forEach(e => walk(e));
    return;
  }
  if (typeof entries === 'object') {
    for (const val of Object.values(entries)) {
      walk(val);
    }
  }
}

walk(obj);
console.log('\nTotal puzzles found: need to count allPuzzles');