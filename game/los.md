# `game/los.js` — line-of-sight + occupant queries

> **Purpose:** Pure functions over the server's `state` shape that
> answer "can A see B?" and "who's standing on this cell?". Walls,
> closed doors, rubble cells, and intermediate creatures all block
> line-of-sight per the 2021 rulebook.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/util.js`](util.js) (`bresenham` line trace),
> [`game/pathfinding.js`](pathfinding.js) (uses `tileAt` / `occupantAt`),
> [`public/shared/rules.js`](../public/shared/rules.js) (shared wall /
> door predicates).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `tileAt` | `(s, x, y) → tile \| null` | Fetches tile-meta at `(x, y)`. Returns `null` off-board. |
| `occupantAt` | `(s, cell) → { kind, id, ref } \| null` | First non-dead hero or monster at `cell`. |
| `isMonsterVisibleToHeroes` | `(s, m) → bool` | True if the monster's room (or corridor cell) is revealed for heroes. Used by the move loop to detect reveal-stops. |
| `losEdgeBlocked` | `(s, a, b) → bool` | Edge between two ortho-adjacent cells blocks LoS (wall or CLOSED door). |
| `lineOfSight` | `(s, from, to) → bool` | Full 2021-rulebook LoS check. Handles diagonal-step corner traversal with the "single clear side wins" rule. |

---

## State-shape contract

Every function takes the server's `state` as its first arg. The
fields actually read:

| State field | Used by |
|---|---|
| `state.tileMeta[key(x,y)]` (`.blocked`, `.hiddenFor.heroes`, `.roomId`) | `tileAt`, `lineOfSight`, `isMonsterVisibleToHeroes` |
| `state.heroes[]` (`.at`, `.dead`, `.id`) | `occupantAt` |
| `state.monsters[]` (`.at`, `.dead`, `.id`, `.roomId`) | `occupantAt`, `isMonsterVisibleToHeroes` |
| `state.roomState[roomId].hiddenFor.heroes` | `isMonsterVisibleToHeroes` |
| Walls + doors (resolved via `wallBetween` / `doorBetween` from `public/shared/rules.js`) | `losEdgeBlocked` |

No mutation. Safe to call from anywhere.

---

## Examples

```js
const { lineOfSight, occupantAt, isMonsterVisibleToHeroes } = require('./game/los');

// Can the wizard cast Genie at this orc?
if (lineOfSight(s, wizard.at, orc.at)) {
  // proceed with spell …
}

// Hero ends-of-turn check: any orc visible now that wasn't before?
const seen = state.monsters
  .filter(m => isMonsterVisibleToHeroes(state, m))
  .map(m => m.id);

// Who is standing on cell (5, 7)?
const occ = occupantAt(state, [5, 7]);
if (occ && occ.kind === 'monster') {
  console.log('blocked by', occ.ref.type);
}
```

---

## Diagonal LoS — the corner-traversal rule

When the Bresenham line crosses the corner where four cells meet,
the trace is "diagonal" at that step. The 2021 rulebook says the
line is visible if either L-path around the corner is clear — only
when BOTH paths are walled shut does the line break. `lineOfSight`
implements this directly:

```
   . . .
   . a c1
   . c2 b
   . . .
```

`a → c1 → b` OR `a → c2 → b` clear → LoS holds.
Both walled → blocked.
