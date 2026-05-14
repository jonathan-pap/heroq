# `game/view.js` — per-tab view projection

> **Purpose:** Builds the JSON payload the server broadcasts to one
> player (`viewFor(room, token, deps)`). Pure projection — reads the
> room + state + deps, mutates nothing.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/objectives.js`](objectives.js) (`evaluateObjectives` is
> consumed here), [`server.js`](../server.js) (wraps `viewFor` with
> the deps it needs).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `viewFor` | `(room, token, deps) → view \| null` | The per-tab JSON. Returns `null` if `token` isn't in the room. |

---

## Why `deps` is injected

`viewFor` needs several module-level things that live in `server.js`:

| Dep | Provided by | Re-resolved live? |
|---|---|---|
| `HEROES`, `MONSTER_TYPES`, `SPELLS`, `SPELLS_BY_ELEMENT`, `SPELL_ELEMENTS` | YAML loaders (`loadGameData()` in `server.js`) | Yes — server.js looks them up on every call so a hot-reload picks up. |
| `seatsOf`, `currentTurn`, `isMyTurn` | `server.js` (turn / seat state) | Yes |
| `effectiveAttack`, `effectiveDefend` | `server.js` (combat dice + equipment + status) | Yes |
| `spellDraftStatus` | `server.js` (lobby spell-draft) | Yes |
| `questList` | `server.js` (quest registry) | Yes |

The wrapper in `server.js` is a thin closure that supplies all of
these on every call:

```js
const _view = require('./game/view');
function viewFor(room, token) {
  return _view.viewFor(room, token, {
    HEROES, MONSTER_TYPES, SPELLS, SPELLS_BY_ELEMENT, SPELL_ELEMENTS,
    seatsOf, currentTurn, isMyTurn,
    effectiveAttack, effectiveDefend,
    spellDraftStatus, questList,
  });
}
```

Because deps are read on every call, `loadGameData()` reloads stay
live without re-constructing the module.

---

## What the view contains

### Always present

`code`, `phase`, `isHost`, `youName`, `youPid`, `heroIds`, `isGM`,
`config`, `seats` (pid-mapped, never tokens), `players[]`, `quests`,
`spellDraft`, `heroVariants`.

### Lobby phase only

`spellsByElement` — map of `{element: [{id, name}…]}` for the
draft picker.

### Gameplay phase

Adds: `questId/Title/Intro`, `objectiveText`, `objectives` (full
checklist via `evaluateObjectives`), `stairCells`,
`showCellCoords` / `showRoomIds`, `furniture[]`, `boardSize`,
`log[]` (last 80 entries), `turnOrder/Idx`, `movementRoll/Used`,
`actionUsed`, `movementLocked`, `combat`, `winner/Reason`.

Plus fog-gated arrays:

| Field | Fog rule (heroes) |
|---|---|
| `tiles[]` | Hidden tiles render with `color: null` + `revealed: false`. Solid-rock tiles are never visible (not even GM). |
| `doors[]` | Always sent; `.revealed` flag gates display. |
| `heroes[]` | Always visible (heroes ARE the heroes). |
| `monsters[]` | Filtered out unless their room or corridor cell is revealed. |
| `treasure[]` | Filtered to revealed-room cells. |
| `traps[]` | Filtered out unless the trap has been `revealed: true` AND its tile is in a revealed room. |
| `secretDoors[]` | Filtered out until found. |
| `furniture[]` | Filtered to pieces with at least one revealed cell. |

GM view (`isGMView = seats.isGM || phase === 'lobby' || config.revealAll`)
sees everything.

---

## State-shape contract

Read-only. Touches a lot of state — the projection is the broadest
single function in `server.js`. State fields used:

- `room.code / phase / players / seats / hostToken / config / heroVariants`
- `room.state.{ questId, questTitle, questIntro, objectiveText, objectives, stairCells, _startCells, showCellCoords, showRoomIds, furniturePieces, tileMeta, allTileKeys, boardSize, log, turnOrder, turnIdx, movementRoll, movementUsed, actionUsed, movementLocked, combat, winner, winReason, doors, heroes, monsters, treasure, traps, secretDoors, treasureDeck, revealedTreasureCard, pendingSaveRoll, lostArtifacts, roomState }`

If you're adding a new game-state field that should be projected,
add it here and decide whether it's gated by `isGMView`.

---

## Security note

`view.seats` is always pid-mapped (`projectSeats`), never token-mapped.
**Tokens are auth secrets.** Any player who saw another's token
could impersonate them. The pid is the public id safe to expose to
peers.
