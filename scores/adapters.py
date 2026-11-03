"""The dealt adapter registry: one row per dealt game declaring how
the session grades a move, how a gated submission's answer is
graded, which play facts a nonce-bearing submit reports, the caps
those facts must obey and the strip side of the deal. The endpoints
never change; the rows carry the game."""


import math

from helpers import (_cipher_sub, _meta_int, _mulberry32, _name_norm, _runs,
                     _text_norm, _alnum_norm, round_feedback)
from puzzles import PUZZLES, _list_entry, _window_entry


# ---------------------------------------------------------------------------
# Evidence-based validation (1.1): the server already holds the day's
# answer key - the committed puzzle stores the /puzzle endpoint serves
# from - so a gated game's submission can carry the proposed answer and
# the raw play facts instead of a self-reported score. The server checks
# the answer, enforces the per-game meta caps, derives the points itself,
# and holds the loss rule (a loss or a give-up is 0 no matter the meta).
# Self-reported "value" posts are generator-only: the gated games refuse
# them outright. The generator games (rings, trace, grid) have no answer
# key by design - their puzzles are derived at play time, not curated -
# and sprint, the fourth generator, now rides a dealt clock instead.
# ---------------------------------------------------------------------------

# the gated-games list and the per-game meta caps live in the dealt
# adapter registry below: EVIDENCE_GAMES derives from the rows and each
# row carries its own caps, so a game and its grading rules can no
# longer drift apart


# ---------------------------------------------------------------------------
# Dealt play (1.2): the server deals the round and keeps the truth. A dealt
# session is a random nonce over an in-memory map - no identity, no disk, no
# player records - purged at the day rollover, on TTL, and when the round
# ends. Dealt traffic is per-action (a session can need a dozen calls), so it
# rides its own tighter per-IP daily cap, separate from /submit's.
# brunch and fermi deal per solve: their one guess ends the round, so the
# reveal can only ever arrive attached to a spent guess. well-actually
# deals the same way per pick: the lie never ships, so every pick and the
# one correction attempt travel to the session. museum deals per guess
# and meters the clues itself, so the name never ships either. bogus
# deals per pick the same way, and superlative deals per round: the
# per-question answers never ship and the session owns the sweep. The
# check games deal their own way: sift ships its tiles but never their
# categories, lightbox ships the clues its grid implies but never the
# grid or its name, and cipher ships a ciphertext under a server-side
# substitution, so the session grades every trio, development and
# decode, and meters the mistakes and hints itself. The windowed check
# games deal too: timeline ships its events without their years and
# thread ships its offered figures as one shuffled tray without the
# chain, the decoy split or the links, so both sessions grade every
# check and meter the checks themselves; timeline's budget is its
# day's own size (the miss that spends it ends the day) while thread's
# checks stay generous. The
# residual honesty note that stays open: a rounds loss reveal hands over
# the key a second session could mine, and sprint's solved count is
# still the client's word inside the server-stamped window.
# ---------------------------------------------------------------------------

DEALT_GAMES = ("rounds", "sprint", "brunch", "fermi", "well-actually", "museum",
               "bogus", "superlative", "sift", "lightbox", "cipher",
               "timeline", "thread")
# the per-game strip declarations live in the dealt adapter registry
# below: each row carries the keys its live day must never ship (the
# nested ones included), so a game and its strip can no longer drift
# apart


def dealt_puzzle(game, pz, day=0):
    """The day's puzzle as a dealt game may ship it. The transform games
    ship a derived puzzle instead of the stored one: lightbox ships the
    clues its grid implies, cipher ships the ciphertext (the substitution
    lives server-side), sift ships the tiles without their categories,
    timeline ships its events without their years, and thread ships its
    offered figures as one shuffled tray (the chain, the decoy split and
    the links stay server-side). Every other dealt game ships the stored
    puzzle minus the keys its registry row strips, so the live day's
    truth never crosses the wire."""
    adapter = DEALT_ADAPTERS.get(game) or {}
    transform = adapter.get("transform")
    if transform is not None:
        out = transform(pz, day)
        if out is not None:
            return out
    out = {k: v for k, v in pz.items()
           if k not in adapter.get("strip", ())}
    for path, keys in adapter.get("deep", {}).items():
        src = out.get(path)
        if isinstance(src, list):
            out[path] = [{k: v for k, v in it.items() if k not in keys}
                         if isinstance(it, dict) else it for it in src]
    return out


# ---------------------------------------------------------------------------
# The dealt adapter registry: each dealt game declares how its session
# grades a move and builds its verdict, so the /guess dispatcher is one
# lookup. The bodies are the graders exactly as they lived inline in the
# dispatcher - the session state, the answer key and every payload shape
# are untouched - and a refused move raises _Reject so the endpoint
# answers with the same status and message the inline branches always
# sent. Each row also declares the evidence validator that grades a
# gated submission against the day's key, the meta meter a nonce-bearing
# submit reports and the caps those facts must obey. The strip side lives in the rows too: the keys a live dealt day must never
# ship, the transform that ships a derived puzzle instead of the stored
# one, and the window flag that says the day's puzzle is a pick into a
# bank. The endpoints themselves never change.
# ---------------------------------------------------------------------------

class _Reject(Exception):
    """A dealt move the session refuses: (status, message) ride out."""
    def __init__(self, status, msg):
        Exception.__init__(self, msg)
        self.status, self.msg = status, msg


def _guess_brunch(sess, move, now):
    """brunch: one pick spends the round - the verdict and the reveal ride the spent pick."""
    i = move.get("pick")
    if isinstance(i, bool) or not isinstance(i, int):
        raise _Reject(400, "bad pick")
    e = _list_entry("brunch", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    if not 0 <= i < len(e["opts"]):
        raise _Reject(400, "bad pick")
    sess["done"] = True
    sess["verdict"] = "won" if i == e["a"] else "lost"
    sess["ans"] = i
    sess["done_at"] = now
    # one seat, one guess: the verdict and the reveal arrive
    # together, so the key crosses only once the pick is spent
    return {"verdict": sess["verdict"],
               "reveal": {"a": e["a"], "w": e.get("w")}}

def _guess_fermi(sess, move, now):
    """fermi: one estimate spends the round - the cited value and the ratio buckets ride the spent guess."""
    v = move.get("v")
    if isinstance(v, bool) or not isinstance(v, (int, float)) \
            or not math.isfinite(v) or v <= 0:
        raise _Reject(400, "bad estimate")
    e = _list_entry("fermi", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    ratio = max(v / e["a"], e["a"] / v)
    score = (3 if ratio <= 3 else 2 if ratio <= 10
             else 1 if ratio <= 100 else 0)
    sess["done"] = True
    sess["verdict"] = "won"
    sess["ans"] = v
    sess["done_at"] = now
    # the cited value and the ratio buckets stay server-side
    # until the one guess is spent
    return {"verdict": "won", "score": score,
               "reveal": {"a": e["a"], "w": e.get("w")}}

def _guess_well_actually(sess, move, now):
    """well-actually: the picks hunt the lie and the one correction ends the round."""
    e = _list_entry("well-actually", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    if sess["found"]:
        # phase two: the one shot at naming the correction
        corr = move.get("correction")
        if not isinstance(corr, str) or len(corr) > 200:
            raise _Reject(400, "bad correction")
        bonus = "correct" if _text_norm(corr) in (
            _text_norm(x) for x in e["a"]) else "wrong"
        sess["done"] = True
        sess["verdict"] = "won"
        sess["ans"] = {"picks": list(sess["picks"]),
                       "typed": corr}
        sess["done_at"] = now
        # the canonical correction and the explanation stay
        # server-side until the one attempt is spent
        return {"verdict": "won", "bonus": bonus,
                   "reveal": {"c": e["c"],
                              "w": e.get("w")}}
    elif isinstance(move.get("correction"), str):
        raise _Reject(400, "the lie is not found yet")
    else:
        i = move.get("pick")
        if isinstance(i, bool) or not isinstance(i, int) \
                or not (0 <= i < len(e["s"])):
            raise _Reject(400, "bad pick")
        if i in sess["picks"]:
            raise _Reject(400, "phrase already picked")
        sess["picks"].append(i)
        if i == e["l"]:
            sess["found"] = True
            # the pick was the lie: found, but no reveal
            # yet - the correction question is still to come
            return {"verdict": "found"}
        elif len(sess["picks"]) >= 3:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["ans"] = {"picks": list(sess["picks"]),
                           "typed": ""}
            sess["done_at"] = now
            # three strikes: the lie, the canonical
            # correction and the why ride the spent round
            return {"verdict": "lost",
                       "reveal": {"l": e["l"], "c": e["c"],
                                  "w": e.get("w")}}
        else:
            return {"verdict": "miss",
                       "left": 3 - len(sess["picks"])}

def _guess_museum(sess, move, now):
    """museum: the names guess and the clues meter at the session - the name rides the spent round."""
    e = _list_entry("museum", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    if move.get("clue"):
        if sess["clue"] >= 4:
            raise _Reject(400, "no more clues")
        sess["clue"] += 1
        # the session meters the clues itself, so a
        # nonce-bearing claim cannot under-report them
        return {"verdict": "clue", "clueIdx": sess["clue"]}
    else:
        name = move.get("name")
        if not isinstance(name, str) or not name \
                or len(name) > 40:
            raise _Reject(400, "bad name")
        names = [_name_norm(x) for x in
                 [e["a"]] + list(e.get("al") or ())]
        if _name_norm(name) in names:
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = name
            sess["result"] = sess["clue"] + 1
            sess["done_at"] = now
            # the name and the story stay server-side
            # until the guess is spent
            return {"verdict": "won",
                       "reveal": {"a": e["a"],
                                  "w": e.get("w")}}
        elif sess["clue"] < 4:
            sess["clue"] += 1
            return {"verdict": "miss",
                       "clueIdx": sess["clue"]}
        else:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["ans"] = ""
            sess["result"] = 6
            sess["done_at"] = now
            return {"verdict": "lost",
                       "reveal": {"a": e["a"],
                                  "w": e.get("w")}}

def _guess_bogus(sess, move, now):
    """bogus: three picks hunt the lie - the find or the third strike ends the round."""
    e = _list_entry("bogus", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    i = move.get("pick")
    if isinstance(i, bool) or not isinstance(i, int) \
            or not (0 <= i < len(e["s"])):
        raise _Reject(400, "bad pick")
    if i in sess["picks"]:
        raise _Reject(400, "phrase already picked")
    sess["picks"].append(i)
    if i == e["l"]:
        sess["done"] = True
        sess["verdict"] = "won"
        sess["ans"] = list(sess["picks"])
        sess["done_at"] = now
        # the lie and the why cross only once the find is
        # spent
        return {"verdict": "won",
                   "reveal": {"l": e["l"], "w": e.get("w")}}
    elif len(sess["picks"]) >= 3:
        sess["done"] = True
        sess["verdict"] = "lost"
        sess["ans"] = list(sess["picks"])
        sess["done_at"] = now
        # three strikes: the lie and the why ride the spent
        # round
        return {"verdict": "lost",
                   "reveal": {"l": e["l"], "w": e.get("w")}}
    else:
        return {"verdict": "miss",
                   "left": 3 - len(sess["picks"])}

def _guess_superlative(sess, move, now):
    """superlative: the rounds grade one at a time and the sweep verdict is the server's."""
    e = _list_entry("superlative", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    q = e["q"]
    r = len(sess["picks"])
    i = move.get("pick")
    if isinstance(i, bool) or not isinstance(i, int) \
            or not (0 <= i < len(e["m"])) or r >= len(q):
        raise _Reject(400, "bad pick")
    sess["picks"].append(i)
    right = i == q[r]["a"]
    if r + 1 >= len(q):
        # the last round ends the session: the sweep verdict
        # and the picks are the server's, never the word
        sess["done"] = True
        sess["verdict"] = "won" if all(
            p == qq["a"] for p, qq in zip(sess["picks"], q)) \
            else "lost"
        sess["ans"] = list(sess["picks"])
        sess["done_at"] = now
        return {"verdict": "hit" if right else "miss",
                   "a": q[r]["a"], "final": True}
    else:
        # the spent round hands over its own answer: the
        # questions ship without their key, so the record
        # settles each round at the session
        return {"verdict": "hit" if right else "miss",
                   "a": q[r]["a"]}

def _guess_sift(sess, move, now):
    """sift: each trio tests one group - the fourth miss spends the day and the board rides it."""
    e = _list_entry("sift", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    pick = move.get("pick")
    if not isinstance(pick, list) or len(pick) != 3 \
            or not all(isinstance(x, str) and x
                       and len(x) <= 60 for x in pick) \
            or len(set(pick)) != 3:
        raise _Reject(400, "bad pick")
    got = frozenset(pick)
    solved = [frozenset(e["cats"][ci]["i"])
              for ci in sess["solved"]]
    if got in solved:
        raise _Reject(400, "group already found")
    hit = next((ci for ci, c in enumerate(e["cats"])
                if frozenset(c["i"]) == got), None)
    if hit is not None:
        sess["solved"].append(hit)
        if len(sess["solved"]) >= len(e["cats"]):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = [list(c["i"]) for c in e["cats"]]
            sess["done_at"] = now
            return {"verdict": "hit", "cat": hit,
                       "n": e["cats"][hit]["n"],
                       "i": list(e["cats"][hit]["i"]),
                       "final": True}
        else:
            # the spent test hands over its group: the
            # name and the trio ride the find, never
            # the served board
            return {"verdict": "hit", "cat": hit,
                       "n": e["cats"][hit]["n"],
                       "i": list(e["cats"][hit]["i"])}
    else:
        sess["mistakes"] += 1
        if sess["mistakes"] >= 4:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["ans"] = [list(c["i"]) for c in e["cats"]]
            sess["done_at"] = now
            # the fourth miss spends the day: the whole
            # board rides the spent round
            return {"verdict": "lost",
                       "reveal": {"t": e.get("t"),
                                  "cats": e["cats"]}}
        else:
            return {"verdict": "miss",
                       "mistakes": sess["mistakes"]}

def _guess_lightbox(sess, move, now):
    """lightbox: each development spends a mistake - the fourth fog spends the film."""
    e = _list_entry("lightbox", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    grid = move.get("grid")
    if not isinstance(grid, list) or len(grid) != len(e["g"]) \
            or not all(isinstance(r, str)
                       and len(r) == len(e["g"][0])
                       and all(ch in "012" for ch in r)
                       for r in grid):
        raise _Reject(400, "bad grid")
    rows = [[1 if ch == "1" else 0 for ch in r] for r in grid]
    want = [[1 if ch == "#" else 0 for ch in r]
            for r in e["g"]]
    if rows == want:
        sess["done"] = True
        sess["verdict"] = "won"
        sess["ans"] = list(e["g"])
        sess["done_at"] = now
        # the picture and its name ride the spent
        # development
        return {"verdict": "won",
                   "reveal": {"n": e.get("n"),
                              "g": list(e["g"])}}
    else:
        bad = [[r, c] for r in range(len(rows))
               for c in range(len(rows[0]))
               if rows[r][c] == 1 and want[r][c] == 0]
        need = [[r, c] for r in range(len(rows))
                for c in range(len(rows[0]))
                if rows[r][c] == 0 and want[r][c] == 1]
        sess["mistakes"] += 1
        if sess["mistakes"] >= 4:
            sess["done"] = True
            sess["verdict"] = "lost"
            sess["done_at"] = now
            # the fourth fog spends the film: the picture
            # rides the spent round
            return {"verdict": "lost",
                       "reveal": {"n": e.get("n"),
                                  "g": list(e["g"])}}
        else:
            # the contradictions cross (the page has
            # always flashed them), the grid never does
            return {"verdict": "miss", "bad": bad,
                       "need": need,
                       "mistakes": sess["mistakes"]}

def _guess_cipher(sess, move, now):
    """cipher: the checks and hints grade against the day's substitution - the codebook opens only on the give-up."""
    e = _list_entry("cipher", sess["day"])
    if e is None:
        raise _Reject(404, "no answer key")
    enc, dec = _cipher_sub(sess["day"])
    freq = {}
    for ch in e["q"]:
        if "A" <= ch <= "Z":
            freq[enc[ch]] = freq.get(enc[ch], 0) + 1
    order = sorted(freq, key=lambda c: (-freq[c], c))
    sub = {enc[ch]: ch for ch in e["q"] if "A" <= ch <= "Z"}
    if move.get("give") is not None:
        sess["done"] = True
        sess["verdict"] = "gave"
        sess["done_at"] = now
        # the codebook opens only on the give-up: the
        # quote and the substitution ride the spent round
        return {"verdict": "gave",
                   "reveal": {"q": e["q"], "a": e.get("a"),
                              "sub": sub}}
    elif move.get("hint"):
        have = move.get("have")
        if not isinstance(have, dict):
            have = {}
        if sess["hints"] >= 5:
            raise _Reject(400, "no more hints")
        cand = next((c for c in order
                     if have.get(c) != dec[c]), None)
        if cand is None:
            raise _Reject(400, "nothing left to hint")
        sess["hints"] += 1
        # the session meters the hints itself, so a
        # nonce-bearing claim cannot under-report them
        return {"verdict": "hint", "cipher": cand,
                   "plain": dec[cand],
                   "hints": sess["hints"]}
    else:
        m = move.get("check")
        if not isinstance(m, dict) or not all(
                isinstance(k, str) and len(k) == 1
                and "A" <= k <= "Z"
                and isinstance(v, str) and len(v) == 1
                and "A" <= v <= "Z"
                for k, v in m.items()):
            raise _Reject(400, "bad decode")
        right = sum(1 for c in order if m.get(c) == dec[c])
        if right == len(order):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = e["q"]
            sess["done_at"] = now
            # the full decode spends the round: the quote
            # rides it, letter-true
            return {"verdict": "won",
                       "reveal": {"q": e["q"],
                                  "a": e.get("a"),
                                  "sub": sub}}
        else:
            # honest but unfarmable: how many letters are
            # right, never which ones
            return {"verdict": "miss", "right": right,
                       "total": len(order)}

def _guess_timeline(sess, move, now):
    """timeline: each order checks at the session - the budget is the day's own size and the years ride the spent round."""
    pz = _window_entry("timeline", sess["day"])
    if pz is None:
        raise _Reject(404, "no answer key")
    evs = pz["events"]
    if move.get("give") is not None:
        sess["done"] = True
        sess["verdict"] = "gave"
        sess["ans"] = sorted(ev["y"] for ev in evs)
        sess["done_at"] = now
        # the give-up lays the years out: the events ride
        # the spent visit
        return {"verdict": "gave",
                   "reveal": {"events": evs}}
    else:
        order = move.get("order")
        if not isinstance(order, list) \
                or len(order) != len(evs) \
                or not all(isinstance(i, int)
                           and not isinstance(i, bool)
                           and 0 <= i < len(evs)
                           for i in order) \
                or len(set(order)) != len(order):
            raise _Reject(400, "bad order")
        sess["guesses"] += 1
        want = sorted(range(len(evs)),
                      key=lambda i: evs[i]["y"])
        lock = [order[i] == want[i]
                for i in range(len(evs))]
        right = sum(lock)
        if right == len(evs):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = [evs[i]["y"] for i in want]
            sess["done_at"] = now
            # the spent round hands over the years
            return {"verdict": "won",
                       "checks": sess["guesses"],
                       "reveal": {"events": evs}}
        else:
            if sess["guesses"] >= len(evs) + 1:
                # the budget is the day's own size: one opening miss,
                # one lock per further miss, the last pair's wrong
                # guess, then the win - the (n+1)-th miss spends the
                # day and the years ride it
                sess["done"] = True
                sess["verdict"] = "lost"
                sess["ans"] = sorted(ev["y"] for ev in evs)
                sess["done_at"] = now
                return {"verdict": "lost",
                           "checks": sess["guesses"],
                           "reveal": {"events": evs}}
            # honest feedback: which positions stand,
            # never a year
            return {"verdict": "miss", "right": right,
                       "lock": lock,
                       "checks": sess["guesses"]}

def _guess_thread(sess, move, now):
    """thread: each chain checks at the session - the middles, the decoys and the links ride the spent round."""
    pz = _window_entry("thread", sess["day"])
    if pz is None:
        raise _Reject(404, "no answer key")
    mids = [nd["id"] for nd in pz["m"]]
    dids = [nd["id"] for nd in pz["d"]]
    if move.get("give") is not None:
        sess["done"] = True
        sess["verdict"] = "gave"
        sess["ans"] = [pz["s"]["id"]] + mids + \
                [pz["e"]["id"]]
        sess["done_at"] = now
        # the give-up lays the chain out: the middles, the
        # decoys and the links ride the spent visit
        return {"verdict": "gave",
                   "reveal": {"m": mids, "d": dids,
                              "links": pz["links"]}}
    else:
        chain = move.get("chain")
        if not isinstance(chain, list) \
                or len(chain) != len(mids) \
                or not all(isinstance(x, str) and x
                           for x in chain) \
                or len(set(chain)) != len(chain) \
                or not set(chain) <= (set(mids) | set(dids)):
            raise _Reject(400, "bad chain")
        sess["guesses"] += 1
        lock = [chain[i] == mids[i]
                for i in range(len(mids))]
        right = sum(lock)
        if right == len(mids):
            sess["done"] = True
            sess["verdict"] = "won"
            sess["ans"] = [pz["s"]["id"]] + mids + \
                [pz["e"]["id"]]
            sess["done_at"] = now
            # the spent round hands over the chain
            return {"verdict": "won",
                       "checks": sess["guesses"],
                       "reveal": {"m": mids, "d": dids,
                                  "links": pz["links"]}}
        else:
            return {"verdict": "miss", "right": right,
                       "lock": lock,
                       "checks": sess["guesses"]}

def _guess_rounds(sess, move, now):
    """rounds: the heat and the direction grade server-side - the year never crosses until the round is spent."""
    y = move.get("y")
    if isinstance(y, bool) or not isinstance(y, int) \
            or not (1000 <= y <= 2200):
        raise _Reject(400, "bad year")
    entry = PUZZLES.get("rounds") or []
    pz = entry[sess["day"] % len(entry)]
    key = pz["y"]
    sess["guesses"] += 1
    if y == key:
        sess["done"] = True
        sess["verdict"] = "won"
        sess["done_at"] = now
        return {"verdict": "won", "guesses": sess["guesses"],
                   "reveal": {"y": key, "w": pz.get("w")}}
    elif sess["guesses"] >= 6:
        sess["done"] = True
        sess["verdict"] = "lost"
        sess["done_at"] = now
        # the reveal hands over the key anyway, so the sixth
        # row still reads like the five before it: heat and
        # direction
        return dict({"verdict": "lost",
                        "guesses": sess["guesses"],
                        "reveal": {"y": key, "w": pz.get("w")}},
                       **round_feedback(y, key))
    else:
        return dict({"verdict": "miss",
                        "guesses": sess["guesses"]},
                       **round_feedback(y, key))



def _evidence_bogus(day, ans, meta):
    """bogus: the picks must include the lie; each wrong pick costs a point."""
    e = _list_entry("bogus", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, list) or not ans or len(ans) > 3 \
            or not all(isinstance(p, int) and not isinstance(p, bool)
                       and 0 <= p < len(e["s"]) for p in ans):
        return None, "bad answer"
    if e["l"] not in ans:
        return None, "wrong answer"
    return max(0, 3 - sum(1 for p in ans if p != e["l"])), None


def _evidence_well_actually(day, ans, meta):
    """well-actually: the picks must name the lie, and the typed correction can earn the bonus point."""
    e = _list_entry("well-actually", day)
    if e is None:
        return None, "no answer key"
    picks = ans.get("picks") if isinstance(ans, dict) else None
    typed = ans.get("typed") if isinstance(ans, dict) else None
    if not isinstance(picks, list) or not picks or len(picks) > 3 \
            or not all(isinstance(p, int) and not isinstance(p, bool)
                      and 0 <= p < len(e["s"]) for p in picks):
        return None, "bad answer"
    if e["l"] not in picks:
        return None, "wrong answer"
    pts = max(0, 3 - sum(1 for p in picks if p != e["l"]))
    if isinstance(typed, str) and len(typed) <= 200 \
            and _text_norm(typed) in (_text_norm(x) for x in e["a"]):
        pts += 1
    return pts, None


def _evidence_fermi(day, ans, meta):
    """fermi: the estimate grades by ratio bucket, won or lost."""
    e = _list_entry("fermi", day)
    if e is None:
        return None, "no answer key"
    if isinstance(ans, bool) or not isinstance(ans, (int, float)) \
            or not math.isfinite(ans) or ans <= 0:
        return None, "bad answer"
    ratio = max(ans / e["a"], e["a"] / ans)
    return (3 if ratio <= 3 else 2 if ratio <= 10
            else 1 if ratio <= 100 else 0), None


def _evidence_brunch(day, ans, meta):
    """brunch: the pick must be the impostor seat."""
    e = _list_entry("brunch", day)
    if e is None:
        return None, "no answer key"
    if isinstance(ans, bool) or not isinstance(ans, int) \
            or not (0 <= ans < len(e["opts"])):
        return None, "bad answer"
    if ans != e["a"]:
        return None, "wrong answer"
    return 1, None


def _evidence_superlative(day, ans, meta):
    """superlative: one point per round the pick matched."""
    e = _list_entry("superlative", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, list) or len(ans) != len(e["q"]) \
            or not all(isinstance(p, int) and not isinstance(p, bool)
                       and 0 <= p < len(e["m"]) for p in ans):
        return None, "bad answer"
    return sum(1 for p, q in zip(ans, e["q"]) if p == q["a"]), None


def _evidence_rounds(day, ans, meta):
    """rounds: the year must be exact; the guesses meter the points."""
    e = _list_entry("rounds", day)
    if e is None:
        return None, "no answer key"
    if isinstance(ans, bool) or not isinstance(ans, int) or ans != e["y"]:
        return None, "wrong answer"
    return max(0, 4 - meta["guesses"]), None


def _evidence_museum(day, ans, meta):
    """museum: the name must match the answer or an alias; the clues meter the points."""
    e = _list_entry("museum", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, str) or not ans or len(ans) > 200:
        return None, "bad answer"
    names = [_name_norm(x) for x in [e["a"]] + list(e.get("al") or ())]
    if _name_norm(ans) not in names:
        return None, "wrong answer"
    return max(0, 4 - meta["clues"]), None


def _evidence_sift(day, ans, meta):
    """sift: the groups must all be found; the mistakes meter the points."""
    e = _list_entry("sift", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, list) or len(ans) != len(e["cats"]) \
            or not all(isinstance(g, list) and g
                       and all(isinstance(x, str) for x in g) for g in ans):
        return None, "bad answer"
    want = [frozenset(c["i"]) for c in e["cats"]]
    got = [frozenset(g) for g in ans]
    if frozenset(want) != frozenset(got):
        return None, "wrong answer"
    return max(0, 3 - meta["mistakes"]), None


def _evidence_lightbox(day, ans, meta):
    """lightbox: the grid must match; the mistakes meter the points."""
    e = _list_entry("lightbox", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, list) or len(ans) != len(e["g"]) \
            or not all(isinstance(r, str) and r for r in ans):
        return None, "bad answer"
    norm = lambda rows: ["".join(ch for ch in row.upper() if ch in "#.")
                         for row in rows]
    if norm(ans) != norm(e["g"]):
        return None, "wrong answer"
    return max(0, 3 - meta["mistakes"]), None


def _evidence_cipher(day, ans, meta):
    """cipher: the decode must match the quote; the hints meter the points."""
    e = _list_entry("cipher", day)
    if e is None:
        return None, "no answer key"
    if not isinstance(ans, str) or not ans or len(ans) > 500:
        return None, "bad answer"
    if _alnum_norm(ans) != _alnum_norm(e["q"]):
        return None, "wrong answer"
    return max(0, 3 - meta["hints"]), None


def _evidence_timeline(day, ans, meta):
    """timeline: the years must be the bank's, in order; the checks meter the points."""
    store = PUZZLES.get("timeline")
    picks = store.get("picks") if isinstance(store, dict) else None
    if not isinstance(picks, list) or not (0 <= day < len(picks)):
        return None, "no answer key"
    years = sorted(store["bank"][i]["y"] for i in picks[day])
    if not isinstance(ans, list) or len(ans) != len(years) \
            or not all(isinstance(y, int) and not isinstance(y, bool)
                       for y in ans) or ans != years:
        return None, "wrong answer"
    # the checks bound is the day's own size, not a hand number: n
    # events need at most n+1 checks (one opening miss, one lock per
    # further miss, the last pair's wrong guess, then the win), so a
    # wider day widens the budget on its own
    checks = _meta_int(meta, "checks", 1, len(years) + 1)
    if checks is None:
        return None, "bad meta"
    return max(0, 4 - checks), None


def _evidence_thread(day, ans, meta):
    """thread: the chain must be the pick's own middles; the checks meter the points."""
    store = PUZZLES.get("thread")
    picks = store.get("picks") if isinstance(store, dict) else None
    if not isinstance(picks, list) or not (0 <= day < len(picks)):
        return None, "no answer key"
    pk = picks[day]
    chain = [pk["s"]] + list(pk["m"]) + [pk["e"]]
    if ans != chain:
        return None, "wrong answer"
    return max(0, 4 - meta["checks"]), None


def _meta_rounds(sess):
    """rounds: the session counted the guesses itself."""
    return {"guesses": sess["guesses"]}


def _meta_clues(sess):
    """museum: the session metered the clues itself, so a nonce-bearing
    claim cannot under-report them."""
    return {"clues": sess.get("result", 1)}


def _meta_hints(sess):
    """cipher: the session metered the hints itself, so a nonce-bearing
    claim cannot under-report them."""
    return {"hints": sess.get("hints", 0)}


def _meta_mistakes(sess):
    """sift and lightbox: the session metered the mistakes itself, so a
    nonce-bearing claim cannot under-report them."""
    return {"mistakes": sess.get("mistakes", 0)}


def _meta_checks(sess):
    """timeline and thread: the session metered the checks itself, so a
    nonce-bearing claim cannot under-report them."""
    return {"checks": sess.get("guesses", 0)}


def _transform_lightbox(pz, day):
    """lightbox: the clues the grid implies ship instead of the grid."""
    if not isinstance(pz.get("g"), list):
        return None
    cells = [[1 if ch == "#" else 0 for ch in row] for row in pz["g"]]
    return {"rc": [_runs(row) for row in cells],
            "cc": [_runs([row[c] for row in cells])
                   for c in range(len(cells[0]))]}


def _transform_cipher(pz, day):
    """cipher: the ciphertext ships and the author stays; the quote and
    the substitution never do."""
    if not isinstance(pz.get("q"), str):
        return None
    enc, _dec = _cipher_sub(day)
    return {"a": pz.get("a"),
            "c": "".join(enc[ch] if ch in enc else ch for ch in pz["q"])}


def _transform_sift(pz, day):
    """sift: the tiles ship shuffled; their categories never do."""
    if not isinstance(pz.get("cats"), list):
        return None
    tiles = [txt for cat in pz["cats"] for txt in cat["i"]]
    rnd = _mulberry32(day * 6151 + 42)
    for i in range(len(tiles) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        tiles[i], tiles[j] = tiles[j], tiles[i]
    return {"t": pz.get("t"), "tiles": tiles}


def _transform_timeline(pz, day):
    """timeline: the events ship without their years."""
    if not isinstance(pz.get("events"), list):
        return None
    return {"events": [{k: v for k, v in ev.items() if k != "y"}
                       for ev in pz["events"]]}


def _transform_thread(pz, day):
    """thread: the offered figures ship as one shuffled tray; the chain,
    the decoy split and the links never do."""
    if not isinstance(pz.get("m"), list):
        return None
    tray = list(pz["m"]) + list(pz["d"])
    rnd = _mulberry32(day * 7919 + 17)
    for i in range(len(tray) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        tray[i], tray[j] = tray[j], tray[i]
    return {"s": pz.get("s"), "e": pz.get("e"), "k": len(pz["m"]),
            "tray": tray}


# One row per dealt game (sprint deals too, but its session is only the
# starting gun, so it keeps no row here). Each row declares how the
# session grades a move ("guess"), how a gated submission's answer is
# graded against the day's key ("evidence"), which play facts a
# nonce-bearing submit reports ("meta") and the caps those facts must
# obey ("caps"); timeline declares no caps because its checks bound is
# its day's own size (n+1 for n events), so the bound lives in its
# evidence validator and widens with the day; fermi and superlative
# grade even a loss, so they say so
# ("grades_loss"). The strip side rides along: the keys a live dealt day
# must never ship ("strip", and the nested ones under "deep"), the
# transform that ships a derived puzzle instead of the stored one
# ("transform"), and a game whose day picks into a bank window says so
# ("windowed"); superlative's strip is empty because its questions lose
# their answer index in the nested pass instead.
DEALT_ADAPTERS = {
    "rounds":        {"guess": _guess_rounds, "evidence": _evidence_rounds,
                      "meta": _meta_rounds, "caps": (("guesses", 1, 6),),
                      "strip": ("y", "w")},
    "brunch":        {"guess": _guess_brunch, "evidence": _evidence_brunch,
                      "strip": ("a", "w")},
    "fermi":         {"guess": _guess_fermi, "evidence": _evidence_fermi,
                      "grades_loss": True, "strip": ("a", "w")},
    "well-actually": {"guess": _guess_well_actually,
                      "evidence": _evidence_well_actually,
                      "strip": ("l", "a", "c", "w")},
    "museum":        {"guess": _guess_museum, "evidence": _evidence_museum,
                      "meta": _meta_clues, "caps": (("clues", 1, 5),),
                      "strip": ("a", "al", "w")},
    "bogus":         {"guess": _guess_bogus, "evidence": _evidence_bogus,
                      "strip": ("l", "w")},
    "superlative":   {"guess": _guess_superlative,
                      "evidence": _evidence_superlative,
                      "grades_loss": True, "strip": (),
                      "deep": {"q": ("a",)}},
    "sift":          {"guess": _guess_sift, "evidence": _evidence_sift,
                      "meta": _meta_mistakes,
                      "caps": (("mistakes", 0, 4),),
                      "strip": ("cats",), "transform": _transform_sift},
    "lightbox":      {"guess": _guess_lightbox,
                      "evidence": _evidence_lightbox,
                      "meta": _meta_mistakes,
                      "caps": (("mistakes", 0, 4),),
                      "strip": ("g", "n"), "transform": _transform_lightbox},
    "cipher":        {"guess": _guess_cipher, "evidence": _evidence_cipher,
                      "meta": _meta_hints, "caps": (("hints", 0, 5),),
                      "strip": ("q",), "transform": _transform_cipher},
    "timeline":      {"guess": _guess_timeline,
                      "evidence": _evidence_timeline,
                      "meta": _meta_checks,
                      "strip": ("y",), "transform": _transform_timeline,
                      "windowed": True},
    "thread":        {"guess": _guess_thread, "evidence": _evidence_thread,
                      "meta": _meta_checks, "caps": (("checks", 1, 999),),
                      "strip": ("m", "d", "links"),
                      "transform": _transform_thread, "windowed": True},
}

# the gated-games list derives from the rows: a game is evidence-gated
# exactly when its row declares how to grade the answer server-side, so
# the list and the graders can no longer drift apart
EVIDENCE_GAMES = tuple(g for g in DEALT_GAMES
                       if "evidence" in DEALT_ADAPTERS.get(g, {}))
