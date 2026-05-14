# `game/` — Shared game-rule modules

Server-side game-rule modules. Imported by `server.js`. Kept separate
from the monolithic `server.js` for testability and to leave room for
more rule modules as the codebase grows.

---

## Files

| File | Purpose |
|---|---|
| `fog.js` | Fog-of-war logic — which cells are revealed for each hero given the current movement / line-of-sight / open-door / blocked-cell state. Pure functions; takes state, returns reveal updates. Easy to unit-test in `test/fog.test.js`. |

---

## Why this folder exists

`server.js` is large (~150 KB) and combines the WebSocket protocol,
game state, rules, AI dispatch, and HTTP routing. Pulling pure
rule-modules into `game/` lets us:

- Unit-test each rule in isolation without spinning up the server.
- Share the same logic with future surfaces (a CLI replay tool, a
  rules-only static-analysis pass, a possible browser-side
  prediction layer).
- Keep `server.js` focused on transport + state plumbing.

---

## Adding a new module

1. Drop `game/<topic>.js` exporting pure functions where possible.
2. `require()` it from `server.js` where it's consumed.
3. Add `test/<topic>.test.js` covering the rule.

Candidates for future extraction:
- Combat resolution (currently inline in `server.js`).
- Spell-effect dispatcher.
- Treasure-deck draw rules.

These aren't urgent — extract when the inline code in `server.js`
becomes hard to follow or duplicates effort.
