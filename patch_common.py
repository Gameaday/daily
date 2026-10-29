#!/usr/bin/env python3
import sys

with open(r"C:\Project\daily\shell\common.js", "r", encoding="utf8") as f:
    content = f.read()

old = """/* ---- fetch today's (or an older) puzzle from the scores service ---- */
/* Online mode only: the server refuses future days, so the client never
   receives puzzles it is not allowed to see. Solo mode callers should use
   their local PUZZLES array instead. */
function fetchPuzzle(game, day){
  const qs = '?game=' + encodeURIComponent(game) + '&day=' + encodeURIComponent(day);
  const bases = ['/api', 'http://localhost:8787', 'http://127.0.0.1:8787'];
  const tryBase = (i) => {
    if (i >= bases.length) throw new Error('puzzle service unreachable');
    return fetch(bases[i] + '/puzzle' + qs)
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }
      .catch(() => tryBase(i + 1));
  };
  return tryBase(0);
}"""

new = """/* Server-first architecture: always fetches from the configured base URL.
   In production: base = '/api'. In local testing: base = 'http://localhost:3000/api'.
   The solo mode check has been removed - all clients connect to the puzzle service. */
function fetchPuzzle(game, day, baseUrl = '/api'){
  const qs = '?game=' + encodeURIComponent(game) + '&day=' + encodeURIComponent(day);
  return fetch(baseUrl + '/puzzle' + qs)
    .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
    .catch(() => { throw new Error('puzzle service unreachable'); });
}"""

if old in content:
    content = content.replace(old, new)
    with open(r"C:\Project\daily\shell\common.js", "w", encoding="utf8") as f:
        f.write(content)
    print("Replaced successfully")
else:
    print("Old text not found")
    # Debug: print what we're looking for
    import re
    matches = re.findall(r'function fetchPuzzle', content)
    print(f"Found {len(matches)} fetchPuzzle declarations")
    sys.exit(1)