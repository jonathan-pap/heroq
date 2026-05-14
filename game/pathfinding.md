# `game/pathfinding.js` — BFS pathfinder

> **Purpose:** Find the shortest walkable path from a hero to a
> target cell, and count visible forward options at corridor
> intersections. Used by the click-to-walk handler.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/los.js`](los.js) (`tileAt`, `occupantAt`,
> `isMultiShareCell`), [`server.js`](../server.js) (`passable` lives
> there and is injected into `findPath`).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `findPath` | `(s, hero, target, maxLength, passable) → cells \| null` | 4-neighbour BFS. Returns `[hero.at, …, target]` (inclusive) or `null` when unreachable / too far. The caller supplies the `passable` predicate. |
| `countVisibleBranches` | `(s, here, prev) → int` | Number of cardinal neighbours of `here` (excluding `prev`) that heroes can currently SEE — used by the corridor intersection-stop rule. |

---

## Why `passable` is injected

`passable(s, from, to, mover)` carries the full HeroQuest movement
ruleset — walls, doors, occupants, furniture, plus spell statuses
like Pass Through Rock and Veil of Mist. Keeping it in `server.js`
where the spell engine + occupant logic already live avoids a
sprawling import graph here. `findPath` just calls back whenever it
needs to test a step.

The predicate returns `true`, `false`, or `{ needsOpenDoor: door }`.
`findPath` treats any truthy result as walkable; the click-to-walk
handler in `server.js` reacts to `needsOpenDoor` separately when
actually stepping the hero through the path.

---

## Examples

```js
const { findPath, countVisibleBranches } = require('./game/pathfinding');

// Click-to-walk: BFS from the hero to the clicked cell within
// the remaining movement budget.
const remaining = s.movementRoll - s.movementUsed;
const path = findPath(s, hero, target, remaining, passable);
if (!path) return;          // unreachable
console.log(`${path.length - 1} steps to target`);

// Intersection-stop: stop walking if the next corridor cell exposes
// two or more visible forward branches.
const branches = countVisibleBranches(s, next, prev);
if (branches >= 2) {
  logEvent(room, `${hero.name} pauses at the intersection.`);
}
```

---

## State-shape contract

| Field | Used by |
|---|---|
| `state.tileMeta[key]` (`.solidRock`, `.hiddenFor.heroes`, `.furnitureId`) | `findPath`, `countVisibleBranches` |
| `state.heroes` / `state.monsters` | via `occupantAt` |
| `state.stairCells` / `state.traps` | via `isMultiShareCell` |
| Walls + doors (resolved via `wallBetween` / `doorBetween`) | `countVisibleBranches` |

Read-only. No state mutation.

---

## Performance notes

`findPath` uses an Array as a FIFO queue (`shift` is O(n) in V8 for
large arrays). For typical hero movement (≤ 12 cells, board is 26×19)
this is fine. If pathfinding is ever called over much larger
distances — e.g. AI Zargon planning across the whole map — swap in a
proper deque or index-based queue.
