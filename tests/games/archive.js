/* Archive walking: ?d=N replays a finished day. The shell owns the whole
   mechanic, so this module pins the day math and the href builder at the
   shell level, then walks two real replays through brunch and superlative:
   the viewed day serves its own puzzle, the replay plays to the end, and
   it never persists anything, never submits anything, and never touches
   the live day's state. */
'use strict';
const { T1 } = require('./_lib');

async function run(h, ctx){
  const T2 = T1 + 86400000;   /* day 2: day 1 and day 0 are history */

  /* ---- the day math itself, on a live boot ---- */
  {
    const b = h.boot('brunch', ['SHELL'], { now: T2, store: {} });
    const S = b.x.SHELL;
    h.eq(S.todayIndex, 2, 'archive: a live boot knows the real day');
    h.eq(S.dayIndex, 2, 'archive: a live boot plays today');
    h.ok(!S.isArchive, 'archive: a live boot is not a replay');
    h.eq(S.parseViewDay('', 5), 5, 'archive: no param is today');
    h.eq(S.parseViewDay('?d=3', 5), 3, 'archive: ?d=3 views day 3');
    h.eq(S.parseViewDay('?d=0', 5), 0, 'archive: ?d=0 views the launch day');
    h.eq(S.parseViewDay('?d=5', 5), 5, 'archive: ?d=today stays live');
    h.eq(S.parseViewDay('?d=9', 5), 5, 'archive: a future day is refused');
    h.eq(S.parseViewDay('?d=abc', 5), 5, 'archive: garbage is refused');
    h.eq(S.parseViewDay('?solo=1', 5), 5, 'archive: solo alone stays live');
    h.eq(S.parseViewDay('?solo=1&d=2', 5), 2, 'archive: solo and a viewed day coexist');
    h.eq(S.archiveHref('?d=3', 2), '?d=2', 'archive: the href swaps the day');
    h.eq(S.archiveHref('?solo=1&d=3', 2), '?solo=1&d=2', 'archive: the href keeps solo');
    h.eq(S.archiveHref('?d=3', null), '?', 'archive: the live href drops the day');
    h.eq(S.archiveHref('?solo=1&d=3', null), '?solo=1', 'archive: the live href keeps solo');
    h.ok(S.pdateText().indexOf('Nov 4') >= 0, 'archive: a live boot keeps showing the current date');
  }

  /* ---- a full replay of day 1, quarantined from the live day ---- */
  {
    /* first play today live, so the store holds real day-2 state */
    const live = h.boot('brunch', ['S', 'EV'], { now: T2, store: {} });
    await h.flush();
    live.env.els['opt' + live.x.EV.a].click();
    await h.flush();
    h.eq(live.x.S.status, 'won', 'archive: the live day played first');
    const before = JSON.stringify(live.env.store);

    /* then walk back to day 1 in the same browser */
    const arc = h.boot('brunch', ['SHELL', 'S', 'EV', 'BRUNCH'], { now: T2, store: live.env.store, search: '?d=1' });
    await h.flush();
    h.ok(arc.x.SHELL.isArchive, 'archive: ?d=1 boots as a replay');
    h.eq(arc.x.SHELL.dayIndex, 1, 'archive: the page plays day 1');
    h.eq(arc.x.SHELL.num, 2, 'archive: the number follows the viewed day');
    h.ok(arc.x.SHELL.pdateText().indexOf('Nov 3') >= 0, 'archive: the date line follows the viewed day');
    h.eq(JSON.stringify(arc.x.EV), JSON.stringify(arc.x.BRUNCH[1]),
      'archive: day 1 serves its own table, not the live one');
    /* replay it wrong, to be sure a finished replay still counts for nothing */
    arc.env.els['opt' + ((arc.x.EV.a + 1) % arc.x.EV.opts.length)].click();
    await h.flush();
    h.eq(arc.x.S.status, 'lost', 'archive: the replay plays to its end');
    h.eq(arc.env.fetchLog.length, 0, 'archive: a replay never submits');
    h.ok(JSON.stringify(arc.env.store) === before,
      'archive: a finished replay never touches the live store');
    /* and the live day comes back untouched */
    const again = h.boot('brunch', ['S'], { now: T2, store: live.env.store });
    h.eq(again.x.S.status, 'won', 'archive: the live day answers from its own state');
  }

  /* ---- the superlative session replays the same way ---- */
  {
    const arc = h.boot('superlative', ['SHELL', 'S', 'EV', 'SUPERLATIVES'], { now: T1, store: {}, search: '?d=0' });
    await h.flush();
    h.ok(arc.x.SHELL.isArchive, 'archive: the superlative walk boots as a replay');
    h.eq(JSON.stringify(arc.x.EV), JSON.stringify(arc.x.SUPERLATIVES[0]),
      'archive: the opening table serves for day 0');
    for (let i = 0; i < arc.x.EV.q.length; i++){
      arc.env.els['opt' + arc.x.EV.q[i].a].click();
      if (i < arc.x.EV.q.length - 1) arc.env.els.btnNext.click();
    }
    arc.env.els.btnNext.click();
    await h.flush();
    h.eq(arc.x.S.status, 'won', 'archive: the replayed session plays to its tally');
    h.eq(arc.env.fetchLog.length, 0, 'archive: the session replay never submits');
    h.eq(Object.keys(arc.env.store).length, 0, 'archive: the session replay stays in memory');
  }

  /* ---- the frozen curve speaks archive ---- */
  {
    const b = h.boot('brunch', ['SHELL'], { now: T2, store: {} });
    b.x.SHELL.renderBoard({ count: 4, beat: null, mean: 2,
      bins: [{ lo: 0, hi: 1, count: 2, you: false }, { lo: 1, hi: 2, count: 2, you: false }],
      archived: true });
    const html = b.env.els.curve.innerHTML;
    h.ok(html.indexOf('this day') >= 0, 'archive: the curve head says this day');
    h.ok(html.indexOf('closed') >= 0, 'archive: the curve says the day is closed');
    h.ok(html.indexOf('today') === -1, 'archive: the frozen curve never says today');
    b.x.SHELL.renderBoard({ count: 3, beat: 1, mean: 2.5,
      bins: [{ lo: 0, hi: 1, count: 2, you: true }, { lo: 1, hi: 2, count: 1, you: false }] });
    h.ok(b.env.els.curve.innerHTML.indexOf('today') >= 0,
      'archive: the live curve copy is unchanged');
    b.x.SHELL.renderBoard({ count: 0, beat: null, mean: null,
      bins: [{ lo: 0, hi: 1, count: 0, you: false }, { lo: 1, hi: 2, count: 0, you: false }],
      archived: true });
    const empty = b.env.els.curve.innerHTML;
    h.ok(empty.indexOf('closed') >= 0, 'archive: an empty day still says closed');
    h.ok(empty.indexOf('today') === -1, 'archive: an empty day is never called today');
  }

  /* ---- the you-mark and the honest tail ---- */
  {
    const b = h.boot('brunch', ['SHELL'], { now: T2, store: {} });
    b.x.SHELL.renderBoard({ count: 3, beat: 1, mean: 2.5,
      bins: [{ lo: 0, hi: 1, count: 2, you: true }, { lo: 1, hi: 2, count: 1, you: false }] });
    const html = b.env.els.curve.innerHTML;
    h.ok(html.indexOf('you beat 1 of 3 players') >= 0,
      'curve: the tail names the size of the field');
    h.ok(html.indexOf('1 other on your mark') >= 0,
      'curve: the tail counts the company on your mark');
    h.ok(html.indexOf('<circle') >= 0, 'curve: the you-mark is a dot on the curve');
    h.ok(html.indexOf('role="img"') >= 0, 'curve: the chart speaks to screen readers');
    const lane = html.match(/<text class="cyou"[^>]*y="(\d+)"/);
    h.ok(!!lane && Number(lane[1]) >= 79,
      'curve: the you-label rides its own lane under the chart, never inside the line');
    b.x.SHELL.renderBoard({ count: 1, beat: 0, mean: null,
      bins: [{ lo: 0, hi: 1, count: 1, you: true }] });
    h.ok(b.env.els.curve.innerHTML.indexOf('your mark is the whole curve so far') >= 0,
      'curve: the day\u2019s first play owns the whole curve');
  }
}

module.exports = { name: 'archive', run };
