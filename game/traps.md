# `game/traps.js` — trap-trigger resolution

> **Purpose:** When a hero steps onto a cell, fire any matching trap
> per the 2021 rulebook (spear / pit / block) and return whether the
> click-to-walk loop should halt and whether the trap ends the turn.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/combat.js`](combat.js) (combat dice),
> [`game/los.js`](los.js) (`tileAt`),
> [`server.js`](../server.js) (`logEvent` + `checkEndConditions` are
> injected; click-to-walk reacts to the `halt` / `endsTurn` flags).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `triggerTrapsForCell` | `(room, hero, cell, deps) → { fired, halt, endsTurn }` | Apply any matching trap at `cell`. Mutates hero / trap / tile. |

---

## `deps` contract

| Dep | What | Why injected |
|---|---|---|
| `logEvent` | `(room, text, cls?)` — narration line | Mutates `room.state.log`; lives in server.js. |
| `checkEndConditions` | `(room) → bool` — promote winner / defeat | State-mutating end checker; pulls in HEROES + SPELLS_BY_ELEMENT for the between-quest restoration. Keeps that machinery in server.js. |

---

## Return shape

```js
{
  fired,    // true if any trap matched the cell
  halt,     // true if the multi-step walk must stop on this cell
  endsTurn  // true if the trap also ends the hero's turn (spear + skull)
}
```

The click-to-walk handler in `server.js` reads these:

- `endsTurn` → drain remaining movement, lock action, break walk loop.
- `halt` → break the walk loop but keep the turn alive (hero may
  still take an action).
- Spear-dodge (`fired: true, halt: false`) → keep walking.

---

## Per-type rules (2021 rulebook)

| Type | Effect |
|---|---|
| `spear` | Roll 1 combat die. Skull → -1 Body + turn ends. Shield → trap dodged AND gone forever; walk continues. |
| `pit` | -1 Body. Hero stays in pit (`status.inPit=true`) — combat with -1 die until they climb out. Halts the walk; action still allowed. |
| `block` | Roll 3 combat dice, each skull = -1 Body (no defence). Cell becomes a PERMANENT falling-block tile (`blocked: true`, `blockedKind: 'falling-block'`) — no one passes through it for the rest of the quest. |

---

## State touched

- `room.state.traps[i]` — `revealed`, `triggered`, `disarmed` flags
- `hero.body` (clamped to ≥ 0)
- `hero.status.inPit` (pit only)
- `room.state.tileMeta[...]` — `blocked`, `blockedKind` (block only)
- `room.state.log` (via `logEvent`)
- Whatever `checkEndConditions` mutates (winner / objectiveMet /
  hero restoration on victory).

---

## Examples

```js
// server.js wrapper
const { triggerTrapsForCell: _triggerTrapsForCell } = require('./game/traps');
function triggerTrapsForCell(room, hero, cell) {
  return _triggerTrapsForCell(room, hero, cell, {
    logEvent, checkEndConditions,
  });
}

// In handleMoveTo's walk loop:
const trap = triggerTrapsForCell(room, h, next);
if (h.dead)       { stopReason = 'died';            break; }
if (trap.endsTurn) { /* drain movement, lock action */ break; }
if (trap.halt)    { stopReason = 'trap';            break; }
// trap.fired but !trap.halt → spear-dodge; keep walking.
```
