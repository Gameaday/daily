"""The evidence validator: a gated submission's answer and raw play
facts come in, the points come out. The client never names a
number; the rows in the registry say how each answer is graded."""


from adapters import DEALT_ADAPTERS
from helpers import _meta_int


def validate_evidence(game, day, body):
    """Check a gated game's evidence against the day's answer key and derive
    the points. Returns (points, None) on success, (None, reason) otherwise.
    The client never names a number: every point is computed here."""
    adapter = DEALT_ADAPTERS.get(game)
    if adapter is None or "evidence" not in adapter:
        return None, "no evidence path"
    status = body.get("status")
    if status not in ("won", "lost", "gave"):
        return None, "bad status"
    if status != "won" and not adapter.get("grades_loss"):
        # a loss or a give-up is 0 points no matter what the meta says,
        # and it never needs meta at all - a real loss (lightbox's
        # fogged grid) must never trip a cap and go uncounted
        return 0, None
    meta = body.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    for key, lo, hi in adapter.get("caps", ()):
        if _meta_int(meta, key, lo, hi) is None:
            return None, "bad meta"
    # the game's own validator grades the answer against the day's key
    return adapter["evidence"](day, body.get("answer"), meta)
