"""The dealt sessions: a random nonce over an in-memory map, no
identity, purged at the day rollover, on TTL and when the round
ends. The nonce map itself is the state; the caps that govern it
live in config."""


import time

import config


SESSIONS = {}        # nonce -> {"game", "day", "created", "ip", "guesses",
                    #            "done", "verdict", "t0", and the per-game
                    #            counters ("picks", "found", "clue")


def purge_sessions(now=None):
    """Reclaim dealt sessions. The caller holds the lock. A session dies when the
    day rolls over (dealt play is for the live day), when it ages past the
    TTL, when a sprint round is long over, or when a finished round has
    been submitted against. A purged sprint session is over for good: a
    later submit naming it derives 0, so the clock cannot be re-entered."""
    now = time.time() if now is None else now
    today = config.current_day_index()
    for nonce in list(SESSIONS):
        s = SESSIONS[nonce]
        if s["day"] != today:
            del SESSIONS[nonce]
        elif now - s["created"] > config.SESSION_TTL:
            del SESSIONS[nonce]
        elif (s["game"] == "sprint" and s["t0"] is not None
                and now - s["t0"] > config.SPRINT_PURGE):
            del SESSIONS[nonce]
        elif s["done"] and now - s.get("done_at", s["created"]) > 300:
            del SESSIONS[nonce]
