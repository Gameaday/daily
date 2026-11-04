"""Sprint's word grade: the day's letter sets derive here, so a claimed
count is scored from the solved words themselves - the client never
names a number. The two CSVs live in sprint_words.json and must stay
byte-identical to the page's DICT_SRC / DICT5_SRC (tests/games/
sprint.js pins that), because the count is only honest if the server's
dictionary accepts exactly what the player's page accepts."""


import json
from pathlib import Path

from helpers import _mulberry32

_DATA = json.loads((Path(__file__).resolve().parent / "sprint_words.json")
                  .read_text(encoding="utf-8"))


def _parse_words(src):
    """The page's parseWords: trim, uppercase, keep A-Z only, first
    occurrence wins - a set in insertion order, which the target pick
    below inherits (the page's Set iterates the same way)."""
    out = {}
    for w in src.split(","):
        t = "".join(c for c in w.strip().upper() if "A" <= c <= "Z")
        if t:
            out.setdefault(t, None)
    return out


WORDS4 = _parse_words(_DATA["words4"])
WORDS5 = _parse_words(_DATA["words5"])


def _anagrams(words):
    """The page's buildAnagramMap: sorted letters -> the real words, in
    the dictionary's own order."""
    m = {}
    for w in words:
        m.setdefault("".join(sorted(w)), []).append(w)
    return m


ANA4 = _anagrams(WORDS4)
ANA5 = _anagrams(WORDS5)

# the target pools: only letter sets with at least two real words, so
# acceptance (any word of the letters counts) is never a lone spelling
R4 = [k for k, v in ANA4.items() if len(v) >= 2 and len(k) == 4]
R5 = [k for k, v in ANA5.items() if len(v) >= 2 and len(k) == 5]


def sprint_targets(day):
    """The day's five letter sets - one 4-letter, then four 5-letter -
    exactly the page's seeded pick (mulberry32 over the pools, duplicate
    5-letter draws retried)."""
    rnd = _mulberry32((day * 2654435761) % 4294967296 + 17)
    targets = [R4[int(rnd() * len(R4))]]
    used = set(targets)
    while len(targets) < 5:
        k = R5[int(rnd() * len(R5))]
        if k not in used:
            targets.append(k)
            used.add(k)
    return targets


def sprint_words_for(key):
    """Every dictionary word the given letter set accepts, 4- and
    5-letter both, in book order (the tests pick real words from
    here, never a key by hand)."""
    return ANA4.get(key, []) + ANA5.get(key, [])


def _norm(w):
    if not isinstance(w, str):
        return None
    t = w.strip().upper()
    if len(t) not in (4, 5) or not all("A" <= c <= "Z" for c in t):
        return None
    return t


def sprint_count(words, day):
    """How many of the day's letter sets the solved words cover. A word
    covers its set exactly the way the page accepts it: a real word of
    those letters - so a spelled-out non-word never scores, and neither
    does a word from a day the submission is not for."""
    sets = set(sprint_targets(day))
    covered = set()
    for w in words:
        t = _norm(w)
        if t is None:
            continue
        if (len(t) == 4 and t in WORDS4) or (len(t) == 5 and t in WORDS5):
            k = "".join(sorted(t))
            if k in sets:
                covered.add(k)
    return len(covered)
