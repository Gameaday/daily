"""The live curve: consolidated per-(game, day) numbers and the tally,
snapshot and beat math that read them. No per-player records, no
names, no text - just the counts, the sums and the fixed histogram."""


import config


STATS = {}   # (game, day) -> {"n", "sum", "sumsq", "min", "max", "bins": [ints]}
SEEN = {}    # (game, day) -> set of 8-byte id digests (transient dedupe only)


def bin_index(value, edges):
    n = len(edges) - 1
    if value < edges[0]:
        return 0
    for i in range(n):
        if value < edges[i + 1]:
            return i
    return n - 1


def fit_bins(bins, edges):
    """Counts fitted to a spec's bins: truncated or zero-padded, never an
    index error, whatever shape the board was recorded in."""
    n = len(edges) - 1
    out = list(bins)[:n]
    out.extend([0] * (n - len(out)))
    return out


def tally(game, day, value, digest):
    """Add one result unless this id already submitted today. Returns counted."""
    key = (game, day)
    st = STATS.get(key)
    if st is None:
        edges = config.SPECS[game]["edges"]
        st = {"n": 0, "sum": 0.0, "sumsq": 0.0, "min": value, "max": value,
              "bins": [0] * (len(edges) - 1)}
        STATS[key] = st
    seen = SEEN.get(key)
    if seen is None:
        seen = set()
        SEEN[key] = seen
    counted = digest not in seen
    if counted:
        seen.add(digest)
        st["n"] += 1
        st["sum"] += value
        st["sumsq"] += value * value
        st["min"] = min(st["min"], value)
        st["max"] = max(st["max"], value)
        if len(st["bins"]) != len(config.SPECS[game]["edges"]) - 1:
            # a board inherited in another shape (a manifest change): the
            # recorded bins are not comparable, so the histogram restarts
            st["bins"] = [0] * (len(config.SPECS[game]["edges"]) - 1)
        st["bins"][bin_index(value, config.SPECS[game]["edges"])] += 1
    return counted


def beat_estimate(value, st, spec):
    """Roughly how many counted entries this value ranks strictly better than.

    Outside my own bin this is exact. Inside my bin we assume a uniform
    spread - except for width <= 1 bins, which hold a single integer score,
    so everyone in them ties and none of them count as beaten.
    """
    edges = spec["edges"]
    i = bin_index(value, edges)
    own = max(0, st["bins"][i] - 1)
    width = edges[i + 1] - edges[i]
    if spec["better"] == "high":
        outside = sum(st["bins"][:i])
        frac = (value - edges[i]) / width if width > 1 else 0.0
        return int(outside + max(0.0, min(1.0, frac)) * own)
    outside = sum(st["bins"][i + 1:])
    frac = (edges[i + 1] - value) / width if width > 1 else 0.0
    return int(outside + max(0.0, min(1.0, frac)) * own)


def snapshot(game, day, value=None, st=None, spec=None):
    spec = spec if spec is not None else config.SPECS[game]
    edges = spec["edges"]
    nbins = len(edges) - 1
    if st is None:
        st = STATS.get((game, day))
    you_bin = bin_index(value, edges) if value is not None else None
    bins = [{"lo": edges[i], "hi": edges[i + 1], "count": 0, "you": False}
            for i in range(nbins)]
    if not st or st["n"] == 0:
        return {"count": 0, "beat": None, "mean": None, "bins": bins,
                "better": spec["better"]}
    # whatever shape the board was recorded in, the response can never
    # crash: counts are fitted to the bins being served
    counts = fit_bins(st["bins"], edges)
    for i in range(nbins):
        bins[i]["count"] = counts[i]
        bins[i]["you"] = (i == you_bin)
    mean = st["sum"] / st["n"]
    beat = beat_estimate(value, dict(st, bins=counts), spec) if value is not None else None
    return {"count": st["n"], "beat": beat, "mean": round(mean, 2),
            "bins": bins, "better": spec["better"]}
