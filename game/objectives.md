# `game/objectives.js` — quest-objective evaluation

> **Purpose:** Pure evaluation of a quest's objectives — what's done,
> what's optional, what's locked behind required prerequisites.
> Always auto-appends the "all living heroes return to a staircase"
> closing row.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`server.js`](../server.js) `checkEndConditions` is the
> state-mutating consumer (promotes objectives to winner / restores
> heroes between quests).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `_evalObjectiveOne` | `(s, o) → bool` | Internal predicate — is the single objective `o` satisfied? Supports `kill` / `kill-all` / `reach` / `gave-item` / `survive`. |
| `evaluateObjectives` | `(s) → row[]` | Full checklist for the UI. Each row: `{ id, text, done, optional, locked? }`. Auto-appends the stairs row. |
| `requiredObjectivesMet` | `(s) → bool` | True when every NON-optional objective is satisfied. Used by `checkEndConditions` to flip `s.objectiveMet`. |

---

## Objective kinds

| Kind | Fields | Done when |
|---|---|---|
| `kill` | `monsterId` | Monster with that id is dead. |
| `kill-all` | — | All monsters dead (and at least one existed). |
| `reach` | `cell` | Any living hero stands on `cell`. |
| `gave-item` | — | Any hero gave an item to another this quest (sets `s._gaveItem`). |
| `survive` | optional `monsterId` | At least one hero alive (and `monsterId` dead if given). |

Unknown kinds report incomplete unless the objective provides
`fallbackKind` (and optionally `fallbackCell`) — used to graceful-degrade
new kinds against older clients.

---

## State-shape contract

Read-only. No mutation.

| State field | Used by |
|---|---|
| `state.objectives` (array form) or `state.objective` (singleton) | `evaluateObjectives`, `requiredObjectivesMet` |
| `state.monsters` (`.id`, `.dead`) | `_evalObjectiveOne` (kill / kill-all / survive) |
| `state.heroes` (`.at`, `.dead`) | `_evalObjectiveOne` (reach), `evaluateObjectives` (stairs row) |
| `state._gaveItem` | `_evalObjectiveOne` (gave-item) |
| `state.stairCells` or `state._startCells` | `evaluateObjectives` (stairs row) |

---

## Examples

```js
const { evaluateObjectives, requiredObjectivesMet } = require('./game/objectives');

// UI checklist
const rows = evaluateObjectives(state);
//   [
//     { id: 'o0', text: 'Slay Verag', done: true,  optional: false },
//     { id: 'o1', text: 'Find the chest', done: false, optional: true },
//     { id: '_stairs', text: 'All living heroes return to a staircase (1/3)',
//       done: false, optional: false, locked: false },
//   ]

// Server-side end-condition check
if (!state.objectiveMet && requiredObjectivesMet(state)) {
  state.objectiveMet = true;
  // … promote to winner once heroes return to stairs …
}
```

---

## The auto-stairs row

Per the 2021 rulebook (F2847 p.21): *"you successfully complete a
quest only when you have achieved the quest goal and have returned
to the safety of the stairway"*. Every surviving hero must
individually be on a stair cell — not just one.

The stairs row is **always appended** to the checklist, **locked**
until every required earlier row is done, and shows progress
(`(2/4)`) so players can see who still needs to walk back.

---

## What's NOT here

`checkEndConditions` (the state-mutating consumer) still lives in
`server.js`. It:
- Promotes `s.objectiveMet` once `requiredObjectivesMet(s)` returns true.
- Promotes to `winner: 'heroes' / 'evil'` once heroes return to stairs / all heroes die.
- Restores hero body / mind / spell hand between quests.
- Emits `logEvent` lines.

Those concerns are too entangled with the room object / HEROES table /
SPELLS_BY_ELEMENT to move here cleanly. Leaving them in `server.js`
keeps this module pure.
