const fs = require('fs');
const https = require('https');

https.get('https://raw.githubusercontent.com/wordnik/wordlist/main/wordlist-20210729.txt', (r) => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    const lines = d.split('\n').map(l => l.trim().replace(/"/g, '')).filter(l => /^[a-z]{3,8}$/.test(l));
    console.log('Total 3-8 letter words:', lines.length);
    fs.writeFileSync('c:/Project/daily/wordlist-clean.txt', lines.join('\n'));
    console.log('Saved clean wordlist');
  });
});