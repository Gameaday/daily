#!/usr/bin/env python3
import re

with open(r'C:\Project\daily\museum\index.html', 'r', encoding='utf8') as f:
    content = f.read()

# Replace the boot section
old_boot = """/* ---------------- boot ---------------- */
loadPuzzle().then(() => {
  $('pno').textContent = num;
  $('pdate').textContent = SHELL.pdateText();
  render();
  if (S.status !== 'playing') showReveal();
  SHELL.startCountdown('countdown', 500);
});"""

new_boot = """/* ---------------- boot ---------------- */
// Server-first: always fetch puzzle from server
SHELL.fetchPuzzle('museum', SHELL.dayIndex).then(puzzle => {
  $('pno').textContent = num;
  $('pdate').textContent = SHELL.pdateText();
  render();
  if (S.status !== 'playing') showReveal();
  SHELL.startCountdown('countdown', 500);
}).catch(err => {
  console.error('Failed to fetch puzzle:', err);
});"""

if old_boot in content:
    content = content.replace(old_boot, new_boot)
    with open(r'C:\Project\daily\museum\index.html', 'w', encoding='utf8') as f:
        f.write(content)
    print('museum/index.html fixed successfully')
else:
    print('Old boot text not found')