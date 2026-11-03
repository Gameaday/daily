"""The manifest, the caps and the day clock: everything the service
treats as loaded truth rather than computed state lives here. The
manifest (epoch, timezone, one ledger spec per game) is read once at
import; the argparse overrides rebind these module globals in place,
so every other module reads them at call time and a restarted
process can never serve a stale cap."""


import json
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None


MAX_BODY = 2048
MAX_ABS_VALUE = 1e6
DAY_MIN, DAY_MAX = -1000, 100000
ARCHIVE_DIR = Path(__file__).parent / 'archive'

# Per-IP daily caps (DoS damping). Human play is a few dozen requests a
# day even across every game; these sit far above that and exist only to
# stop scripted flooding. Counts reset with the ET day and the map is
# pruned if it ever grows past a fixed bound.
MAX_GETS_PER_IP = 10000
MAX_POSTS_PER_IP = 300
IP_HITS = {}   # ip -> [day, gets, posts, dealt]


# Per-game truth: which direction is better, and the fixed histogram edges.
# Bin i covers [edges[i], edges[i+1]); values beyond the last edge clamp into
# the final bin, values below the first edge clamp into bin 0.
# "better" lives here, server-side - the client never decides it.
# The truth itself lives in manifest.json (timezone, epoch, and one spec per
# game). config.py loads it at boot, the client pages carry the same
# timezone/epoch inline for offline play, and CI cross-checks both sides
# against the manifest so neither can drift.
with open(Path(__file__).parent / 'manifest.json', encoding='utf-8') as _mf:
    _MANIFEST = json.load(_mf)
TZ_NAME = _MANIFEST['tz']
EPOCH_KEY = _MANIFEST['epoch']
SPECS = _MANIFEST['games']


LOCK = threading.Lock()


MAX_DEALT_PER_IP = 400    # per-IP daily cap across /deal, /guess, /reveal
SPRINT_WINDOW = 90.0      # the sprint round is this many seconds, server clock
SPRINT_GRACE = 10.0       # network lag allowance on the window check
SPRINT_PURGE = 150.0      # t0 + this is when an unsubmitted round is reaped
SESSION_TTL = 1800.0      # housekeeping horizon for any dealt session


def current_day_index():
    """Days since the epoch, clamped at 0: before launch the index never goes
    negative, matching shell/common.js, so the pre-launch weekend serves
    No. 1 and those plays tally into the launch day's board."""
    try:
        tz = ZoneInfo(TZ_NAME) if ZoneInfo else None
    except Exception:
        tz = None
    today = datetime.now(tz).date() if tz else date.today()
    epoch = date.fromisoformat(EPOCH_KEY)
    return max(0, (today - epoch).days)


def seconds_to_midnight():
    """Seconds until the next ET midnight - the puzzle cache horizon: the
    day's puzzle is immutable, so it can be cached right up to rollover."""
    try:
        tz = ZoneInfo(TZ_NAME) if ZoneInfo else None
    except Exception:
        tz = None
    now = datetime.now(tz)
    nxt = datetime.combine(now.date() + timedelta(days=1), datetime.min.time())
    if tz:
        nxt = nxt.replace(tzinfo=tz)
    return int(max(60, min((nxt - now).total_seconds(), 86400)))


def day_date(day):
    """The ET date a day index refers to (for the archive labels)."""
    return (date.fromisoformat(EPOCH_KEY) + timedelta(days=day)).isoformat()
