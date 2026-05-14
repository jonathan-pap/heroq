# `game/util.js` — utility helpers

> **Purpose:** Pure helpers used everywhere in `server.js` — random
> IDs, dice, geometry, array shuffle. Zero state, zero deps on other
> game modules.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/combat.js`](combat.js) (combat-specific dice).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `uid` | `() → string` | 32-char hex session token. Use for per-tab identity. |
| `pid` | `() → string` | 12-char hex public id (safe to send to peers). |
| `code` | `() → string` | 4-char alphanumeric lobby code (skips I/L/O for clarity). |
| `rollD6` | `() → 1..6` | Single standard d6. Used for hero movement and misc rolls. Combat dice live in `game/combat.js`. |
| `bresenham` | `(from, to) → [[x,y], …]` | List of cells from `from` → `to` inclusive (Bresenham line). Used by line-of-sight. |
| `shuffle` | `(arr) → arr` | Fisher-Yates in place; returns the same array. |

---

## Examples

```js
const { uid, rollD6, bresenham, shuffle } = require('./game/util');

const token = uid();                           // → 'a1b2…' (32 hex)
const movement = rollD6() + rollD6();          // hero movement total
const trace = bresenham([3, 5], [7, 9]);       // LoS cell trace
shuffle(deck);                                  // deck is now shuffled
```

---

## Constraints

- **No state.** Every export is a pure function (modulo `Math.random()`
  / `crypto.randomBytes`).
- **No requires of other game modules.** Util sits at the bottom of
  the dependency graph.

If you find yourself wanting to add a stateful helper here, it
belongs in a more specific module (`game/combat.js`, `game/spells.js`,
etc.) instead.
