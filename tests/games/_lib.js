/* Shared test constants: the game list (its order is both the run order
   and the cross-check order) and the pinned days every module boots at.

   EPOCH_KEY is 2026-10-27, so noon UTC on that date is day 0 no matter
   the runner's real clock (the harness Date is pinned per boot). If the
   epoch ever moves, change scores/manifest.json and shell/common.js
   together (CI cross-checks them) and the days here with it. */
'use strict';

const GAMES = ['bogus', 'well-actually', 'recycle-rings', 'recycle-grid', 'fermi',
  'sift', 'rounds', 'trace', 'lightbox', 'sprint', 'cipher', 'timeline', 'museum'];

const T0 = Date.parse('2026-10-27T12:00:00Z');
const T1 = T0 + 86400000;
const T10 = T0 + 10 * 86400000;

module.exports = { GAMES, T0, T1, T10 };
