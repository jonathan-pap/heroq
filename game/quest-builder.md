# `game/quest-builder.js` — quest JSON → runtime state

> **Purpose:** Convert a quest JSON file (plus the master board) into
> the runtime `state` object the server holds for a live game. Pure
> modulo `shuffle` (treasure deck) and the injected
> `exploreFromHero` (initial fog-reveal flood-fill).
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/util.js`](util.js) (`shuffle`),
> [`game/view.js`](view.js) (consumer of the produced state),
> [`server.js`](../server.js) (wraps `freshGameState` with deps and
> handles `exploreFromHero`).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `freshGameState` | `(room, deps) → state \| null` | **Entry point.** Returns the runtime `state` for `room.config.questId`, or `null` if no quest matches. |
| `buildBoardState` | `(quest, deps) → { tileMeta, allTileKeys, roomState, doors, furniturePieces }` | Tiles, rooms (fog-flagged), doors, furniture pieces. Master-board path (default) or quest-supplied `rooms`/`corridors`. |
| `buildHeroes` | `(quest, seats, spellPick, heroVariants, deps) → heroes[]` | Per-claimed-seat hero records with stats, spell hand, equipment, inventory, status. |
| `buildMonsters` | `(quest, deps) → monsters[]` | Monster instances with stat overrides applied. |
| `buildTreasure` | `(quest) → treasure[]` | Pure. |
| `buildTraps` | `(quest) → traps[]` | Pure. |
| `buildFurnitureTraps` | `(quest) → furnitureTraps[]` | Pure. |
| `buildSecretDoors` | `(quest) → secretDoors[]` | Pure. |

---

## `deps` contract

`freshGameState` and its helpers read from the same `deps` object:

| Dep | What | Why injected |
|---|---|---|
| `MASTER_BOARD` | `{ boardSize, corridorCells, rooms[] }` | Loaded by server.js's `loadMasterBoard()`; reassigned on hot-reload. |
| `HEROES` | hero stats table (loaded from `data/heroes.yaml`) | Reassigned by `loadGameData()`. |
| `MONSTER_TYPES` | monster stats table (loaded from `data/monsters.yaml`) | Same. |
| `SPELLS` | spell card table | Same. |
| `SPELLS_BY_ELEMENT` | element → spell[] index | Same. |
| `TREASURE_DECK_TEMPLATE` | deck card list (loaded from `data/cards/treasure.yaml`) | Same. |
| `quests` | `Map<id, quest>` populated by `loadQuests()` | Server.js owns the registry. |
| `exploreFromHero` | `(room, hero) → void` — flood-fill fog-of-war reveal | Lives in server.js (reveals rooms + doors + monster activation); injecting it avoids dragging the reveal machinery here. |

The server.js wrapper passes all of these by reference each call so
hot-reloads (re-running `loadGameData()` / `loadMasterBoard()`)
remain live.

---

## State shape produced

`freshGameState(room, deps)` returns an object with these keys (used
throughout `server.js` and projected by `viewFor`):

```
state = {
  // Identity
  questId, questTitle, questIntro, objectiveText, objective, objectives,
  defeat, boardSize, wanderingMonster,

  // Board (spread from buildBoardState)
  tileMeta, allTileKeys, roomState, doors, furniturePieces,

  // Pieces
  heroes, monsters, treasure, traps, furnitureTraps, secretDoors,

  // Decks
  treasureDeck, treasureDiscard, revealedTreasureCard,
  searchedTreasure, pendingSaveRoll,

  // Turn machinery
  turnOrder, turnIdx, movementRoll, movementUsed, actionUsed,
  movementLocked, spellsCastThisTurn, combat,

  // Outcome
  log, winner, winReason, objectiveMet,

  // Stairs / start / debug overlays
  stairCells, _startCells, showCellCoords, showRoomIds,
}
```

---

## Master board vs. quest-supplied rooms

```
useMaster = MASTER_BOARD &&
            (quest.board === 'default' || (!quest.rooms && !quest.corridors))
```

- **Master path (default):** iterate `MASTER_BOARD.rooms` + corridor
  cells. Each quest may apply `roomOverrides` to rename / recolour /
  pre-reveal individual rooms by id.
- **Legacy / sandbox path:** quest carries its own `rooms[]` +
  `corridors[]`. Used by ad-hoc dungeons and the sandbox folder.

Both paths produce the same `{ tileMeta, allTileKeys, roomState, doors,
furniturePieces }` shape.

---

## Fog-of-war initial state

Every tile starts `hiddenFor.heroes = true`. After all pieces are
built, `freshGameState` calls the injected `exploreFromHero(room, h)`
for each hero, which floods open paths from their start cell and
flips the matching tiles + roomState entries to revealed.

Quest-level `_initialHidden: false` on a room (via `roomOverrides`)
force-reveals that whole room post-flood. Used for "the heroes start
in room X with the room already revealed" quests.

---

## Examples

```js
// server.js — single external call site
const { freshGameState: _freshGameState } = require('./game/quest-builder');

function freshGameState(room) {
  return _freshGameState(room, {
    MASTER_BOARD, HEROES, MONSTER_TYPES, SPELLS, SPELLS_BY_ELEMENT,
    TREASURE_DECK_TEMPLATE, quests, exploreFromHero,
  });
}
```

```js
// Unit test — build a state for a fixture quest
const builder = require('./game/quest-builder');
const state = builder.freshGameState(
  { config: { questId: 'quest1-trial' }, seats: { barbarian: 'tok1' },
    spellPick: null, heroVariants: { barbarian: 'female' } },
  testDeps  // mocked MASTER_BOARD + tables + exploreFromHero stub
);
```
