"""The derivation helpers, split from server.py: the pages' tiny PRNG
and the cipher substitution built on it, the text, name and answer
normalizers, the lightbox clue builder and the rounds heat feedback.
Each is a faithful port of the client code so a served layout, a
served cipher or a served heat stays deterministic per day without
shipping anything else. Pure functions only: no state, no globals and
nothing imported from the service's other modules."""

import re


_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _mulberry32(seed):
    """The pages' tiny PRNG, ported so a served layout or a served cipher
    stays deterministic per day without shipping anything else."""
    state = [seed & 0xFFFFFFFF]

    def rnd():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        a = state[0]
        t = ((a ^ (a >> 15)) * (a | 1)) & 0xFFFFFFFF
        w = ((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF
        t = ((t + w) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


def _build_sub(rnd):
    """The cipher page's substitution builder, ported: a seeded shuffle
    of the alphabet with no letter standing for itself."""
    while True:
        perm = list(_ALPHA)
        for i in range(len(perm) - 1, 0, -1):
            j = int(rnd() * (i + 1))
            perm[i], perm[j] = perm[j], perm[i]
        if all(perm[i] != _ALPHA[i] for i in range(len(perm))):
            enc = {_ALPHA[i]: perm[i] for i in range(len(perm))}
            dec = {perm[i]: _ALPHA[i] for i in range(len(perm))}
            return enc, dec


def _cipher_sub(day):
    """The day's substitution, seeded server-side: the live ciphertext is
    stable across requests and restarts, but its key never ships."""
    return _build_sub(_mulberry32((day * 668265261 + 8191) & 0xFFFFFFFF))


def _runs(line):
    """The lightbox page's clue builder: the runs of consecutive filled
    cells in one line, in order ([0] for an empty line)."""
    out, c = [], 0
    for v in line:
        if v:
            c += 1
        elif c:
            out.append(c)
            c = 0
    if c:
        out.append(c)
    return out or [0]


def round_feedback(y, key):
    """Rounds hotter/colder, server-side: the distance in years never
    crosses the wire - only the heat bucket and the direction hint the
    page has always shown. A port of the client's heatOf/hintOf; the solo
    offline path keeps its own copy."""
    off = abs(y - key)
    if off <= 2:
        heat, sq = "scalding", "\U0001F7E9"
    elif off <= 5:
        heat, sq = "hot", "\U0001F7E8"
    elif off <= 15:
        heat, sq = "warm", "\U0001F7E7"
    else:
        heat, sq = "cold", "\U0001F7E5"
    parts = ["go earlier" if y > key else "go later"]
    if y // 100 != key // 100:
        parts.append("wrong century")
    elif y // 10 == key // 10:
        parts.append("right decade")
    return {"heat": heat, "sq": sq, "hint": " \u00b7 ".join(parts)}


def _text_norm(s):
    """The well-actually page's normalization of a typed correction:
    lowercase, punctuation to spaces, collapsed, leading 'the ' dropped."""
    s = re.sub(r"[.,!?;:'\u2019\u201c\u201d\"]", " ", str(s).lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[4:] if s.startswith("the ") else s


def _name_norm(s):
    """Museum-grade name matching: lowercase, punctuation dropped (an
    apostrophe vanishes instead of spacing), collapsed, leading 'the ' off."""
    s = re.sub(r"[^\w\s]", "", str(s).lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[4:] if s.startswith("the ") else s


def _alnum_norm(s):
    """Cipher-grade comparison: uppercase alphanumerics only."""
    return "".join(ch for ch in str(s).upper() if ch.isalnum())


def _meta_int(meta, key, lo, hi):
    v = meta.get(key)
    if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi):
        return None
    return v


