"""The archive: each finished day's numbers collapse once into a
static snapshot on disk, read-only forever, and the warm start brings
today's partial board back after a restart. This module owns the
only disk writes anywhere in the service."""


import json

import config
import curve


def archive_path(game, day):
    return config.ARCHIVE_DIR / game / ("%d.json" % day)


def write_archive(game, day):
    """Collapse one finished day's live numbers into a static snapshot.

    Written once and then read-only: if a snapshot already exists (a mid-day
    restart archived a partial day), only a strictly larger tally replaces
    it. The day's dedupe set rides along with the numbers so a warm start
    can never re-open the day. A failed write must never take the service
    down.

    Returns True when a snapshot is on disk, False when there is nothing to
    write or an existing snapshot already covers the tally (either way the
    live board is safe to drop), and None only when the write itself
    failed: the caller must keep the live board so the next flush retries
    instead of silently losing the day.
    """
    st = curve.STATS.get((game, day))
    if not st or st["n"] == 0:
        return False
    p = archive_path(game, day)
    if p.exists():
        try:
            with p.open(encoding='utf-8') as f:
                old = json.load(f)
            if old.get("n", 0) >= st["n"]:
                return False
        except (OSError, ValueError):
            pass  # unreadable snapshot: the live board is the better truth
    payload = {
        "game": game, "day": day, "date": config.day_date(day),
        "n": st["n"], "sum": st["sum"], "sumsq": st["sumsq"],
        "min": st["min"], "max": st["max"], "bins": st["bins"],
        "seen": sorted(curve.SEEN.get((game, day), ())),
        "edges": config.SPECS[game]["edges"], "better": config.SPECS[game]["better"],
    }
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(payload, indent=2) + "\n", encoding='utf-8')
        return True
    except OSError:
        return None


def load_archive(game, day):
    p = archive_path(game, day)
    try:
        with p.open(encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def archived_stats(rec):
    """An archive record reshaped into the live board format."""
    if not rec:
        return None
    return {"n": rec["n"], "sum": rec["sum"], "sumsq": rec["sumsq"],
            "min": rec["min"], "max": rec["max"], "bins": rec["bins"]}


def archived_spec(rec, game):
    """The spec a snapshot was recorded under. A finished day is frozen
    truth: it keeps serving its own edges and direction even if the
    manifest moved on afterwards, so an edges change can never crash or
    silently re-label history."""
    if isinstance(rec, dict) and isinstance(rec.get("edges"), list) \
            and len(rec["edges"]) >= 2 and rec.get("better") in ("low", "high"):
        return {"edges": rec["edges"], "better": rec["better"]}
    return config.SPECS[game]


def flush_stale(force=False):
    """Hand finished days to the archive: snapshot once, then drop the board.

    Runs lazily on every request (so the first request after midnight ET
    settles yesterday cleanly), and forced on shutdown (so a restart does
    not silently drop the partial day). A board whose snapshot write
    failed stays in memory: the next flush retries it, so a full disk
    costs a delayed archive, not the day's numbers.
    """
    today = config.current_day_index()
    for key in list(curve.STATS.keys()):
        game, day = key
        if day == today and not force:
            continue
        ok = write_archive(game, day)
        if ok:
            print("archived %s day %d (%d plays)" % (game, day, curve.STATS[key]["n"]), flush=True)
        if ok is None:
            # the snapshot write failed (full disk, lost mount): keep the
            # live board and its dedupe set so the next flush retries and
            # stale submits still get answered, instead of losing the day
            continue
        del curve.STATS[key]
        curve.SEEN.pop(key, None)


def warm_start(today):
    """Bring today's archived partial boards back to the live curve.

    A board recorded under different edges or direction (the manifest
    changed and the deploy landed mid-day) restarts clean instead of
    loading: those bins are not comparable to new submissions, and a
    mixed-shape board would crash the next tally. The day's curve starts
    over for that game; every other game keeps its numbers.
    """
    for game in config.SPECS:
        rec = load_archive(game, today)
        if rec and (rec.get("edges") != config.SPECS[game]["edges"]
                    or rec.get("better") != config.SPECS[game]["better"]):
            print("warm start: %s day %d was recorded under other edges - "
                  "restarting the board" % (game, today), flush=True)
            continue
        st = archived_stats(rec)
        if st:
            curve.STATS[(game, today)] = st
            # the dedupe set rides along with the snapshot: without it
            # a restart would re-open the day and re-count every revisit
            seen = rec.get("seen") if isinstance(rec, dict) else None
            if isinstance(seen, list):
                curve.SEEN.setdefault((game, today), set()).update(
                    d for d in seen if isinstance(d, str) and len(d) <= 16)
