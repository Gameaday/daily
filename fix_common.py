#!/usr/bin/env python3
import re

with open(r'C:\Project\daily\shell\common.js', 'r', encoding='utf8') as f:
    content = f.read()

# Replace the fetchPuzzle function - remove old bases/tryBase legacy code
old_func = '''  function fetchPuzzle(game, day, baseUrl = '/api'){\n    const qs = '?game=' + encodeURIComponent(game) + '&day=' + encodeURIComponent(day);\n    const bases = ['/api', 'http://localhost:8787', 'http://127.0.0.1:8787']; // removed solo check\n    const tryBase = (i) => {\n      if (i >= bases.length) throw new Error('puzzle service unreachable');\n      return fetch(bases[i] + '/puzzle' + qs)\n        .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })\n        return fetch('/puzzle' + qs)\n    .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })\n    .catch(() => { throw new Error('puzzle service unreachable'); });\n  };\n    return fetch('/puzzle' + qs)\n    .catch(() => { throw new Error('puzzle service unreachable'); });\n  }'''

new_func = '''  function fetchPuzzle(game, day, baseUrl = '/api'){\n    const qs = '?game=' + encodeURIComponent(game) + '&day=' + encodeURIComponent(day);\n    return fetch(baseUrl + '/puzzle' + qs)\n      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })\n      .catch(() => { throw new Error('puzzle service unreachable'); });\n  }'''

if old_func in content:
    content = content.replace(old_func, new_func)
    with open(r'C:\Project\daily\shell\common.js', 'w', encoding='utf8') as f:
        f.write(content)
    print('common.js fixed successfully')
else:
    print('Old fetchPuzzle not found - checking what\\'s there...')
    # Try to find the function
    import re
    m = re.search(r'function fetchPuzzle.*?}\);', content, re.DOTALL)
    if m:
        print(f'Found fetchPuzzle at: {m.start()}')
        print(m.group()[:200])
    else:
        print('fetchPuzzle function not found')