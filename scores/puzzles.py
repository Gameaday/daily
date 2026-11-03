"""The puzzle stores: puzzles/<game>/puzzles.json loaded once at
import, plus the day's answer-key entries. The container copies the
stores to ./puzzles next to the modules; a local run finds them at
../puzzles - the first existing one wins."""


import json
from pathlib import Path

import config


# Per-game puzzle stores: puzzles/<game>/puzzles.json at the repo root,
# committed and verified against the client banks by tools/export-puzzles.mjs
# in CI. Generator games keep an empty store (their puzzles are derived,
# not curated). The container copies them to ./puzzles next to the modules;
# a local run finds them at ../puzzles - the first existing one wins.
PUZZLES = {}
PUZZLES_DIR = next((p for p in (
    Path(__file__).parent / 'puzzles',
    Path(__file__).parent.parent / 'puzzles') if p.is_dir()),
    Path(__file__).parent / 'puzzles')
for game in config.SPECS.keys():
    game_file = PUZZLES_DIR / game / 'puzzles.json'
    try:
        with game_file.open(encoding='utf-8') as f:
            PUZZLES[game] = json.load(f)
    except FileNotFoundError:
        PUZZLES[game] = []


def _list_entry(game, day):
    """The day's answer-key entry for a list-store game (the same entry the
    /puzzle endpoint serves)."""
    store = PUZZLES.get(game)
    if isinstance(store, list) and store:
        return store[day % len(store)]
    return None


def _window_entry(game, day):
    """The day's full puzzle for a windowed dict-store game (timeline,
    thread): the same entry the /puzzle endpoint serves, before any dealt
    strip. None when the day falls outside the precomputed window."""
    store = PUZZLES.get(game)
    picks = store.get("picks") if isinstance(store, dict) else None
    if not isinstance(picks, list) or not (0 <= day < len(picks)):
        return None
    if game == "thread":
        bank = store["bank"]
        nodes = {nd["id"]: nd for nd in bank["nodes"]}
        emap = {}
        for ed in bank["edges"]:
            emap.setdefault(ed["a"], {})[ed["b"]] = ed
            emap.setdefault(ed["b"], {})[ed["a"]] = ed
        pk = picks[day]
        seq = [pk["s"]] + list(pk["m"]) + [pk["e"]]
        links = [emap[a][b] for a, b in zip(seq, seq[1:])]
        return {"s": nodes[pk["s"]], "e": nodes[pk["e"]],
                "m": [nodes[i] for i in pk["m"]],
                "d": [nodes[i] for i in pk["d"]], "links": links}
    if game == "timeline":
        bank = store["bank"]
        return {"events": [bank[i] for i in picks[day]]}
    return None
