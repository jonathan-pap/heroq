# `server.js` regions — skill index

> **Purpose:** Line-range map of the regions still living in
> [`server.js`](../server.js), with the key functions, state touched,
> and extraction-candidate notes. Use this to scope reads instead of
> grepping the 3,500-line file end to end.
>
> **Related:** [`RULES.md`](RULES.md) (already-extracted modules),
> [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md).

Already extracted to `game/`:
[`util.js`](util.js), [`combat.js`](combat.js),
[`los.js`](los.js), [`pathfinding.js`](pathfinding.js),
[`objectives.js`](objectives.js), [`fog.js`](fog.js).

Everything below remains in `server.js` for now. Line ranges are
approximate — bump them on the next pass when they drift.

---

## GAME RULES TABLES (line ~49)

`HEROES`, `MONSTER_TYPES`, `SPELLS`, `SPELLS_BY_ELEMENT`,
`DREAD_SPELLS`, `EQUIPMENT`, `ARTIFACTS`, `TREASURE_DECK_TEMPLATE` —
all loaded from `data/*.yaml`. `loadMasterBoard()`, `loadGameData()`.

State touched: module-level constants set on boot. Re-call
`loadGameData()` to hot-reload.

Extraction candidate: low priority. Already small + central to boot.

---

## QUEST LOADING (line ~133)

`loadCanonicalPieces()`, `loadQuests()`, `questList()`,
`validateQuestFn`. The in-memory `quests` Map is the canonical store.

State touched: `quests`, `CANONICAL_PIECES`.

Extraction candidate: low priority. Already cohesive.

---

## ROOMS (line ~239)

`rooms` Map (lobby code → Room object). `newRoomCode()`,
`makeRoom(hostToken)`.

State touched: `rooms`.

Extraction candidate: low priority. Tight to WebSocket state.

---

## PERSISTENCE (line ~288)

`scheduleSave()`, `saveState()`, `loadRooms()`. Debounced JSON
snapshot to `data/rooms.json`.

State touched: `rooms` (reads), `STATE_FILE` (writes).

Extraction candidate: low priority.

---

## MESSAGING / VIEW FILTERING (line ~366)

`send`, `broadcastRoom`, `logEvent`, `seatsOf`, `isMyTurn`.

**`viewFor` is extracted — see [`view.md`](view.md).** The local
`viewFor` here is a thin wrapper that supplies the YAML data tables
+ turn helpers + effective-dice resolvers fresh on every call.

State touched (by what remains in this region): reads everything;
`logEvent` mutates `room.state.log`.

---

## QUEST → BOARD STATE (line ~426)

**Extracted — see [`quest-builder.md`](quest-builder.md).** What
remains in `server.js` is a single thin wrapper:

```js
function freshGameState(room) {
  return _freshGameState(room, {
    MASTER_BOARD, HEROES, MONSTER_TYPES, SPELLS, SPELLS_BY_ELEMENT,
    TREASURE_DECK_TEMPLATE, quests, exploreFromHero,
  });
}
```

All eight `build*` helpers + the orchestrator now live in
`game/quest-builder.js`.

---

## TURN HELPERS (line ~990)

`currentTurn(room)`, `currentHero(room)`, `advanceTurn(room)`.

State touched: heavy — turn pointer, monsters list, movement
cleanup, spell-status decay on advance.

Extraction candidate: low priority. Tightly coupled to state mutation.

---

## MOVEMENT / WALL DERIVATION (line ~1042)

`passable(s, fromCell, toCell, mover)` — the predicate
[`pathfinding.js`](pathfinding.js) calls back into. Plus
`revealRoom`, `exploreFromHero`, `exploreFromAllHeroes`, `openDoor`,
`handleOpenDoor`.

State touched: room reveal + door state + monster activation.

Extraction candidate: medium. `passable` could move to
`game/movement.js` once the spell-status flags it reads are exposed
clean. Backlog.

---

## TURN ACTIONS — HEROES (line ~1174)

`rollHeroMovement`, `lockMovementOnAction`, `handleAttack`,
`handleDodge`, `handleRoll`, `handleEndTurn`, …

State touched: heavy.

Extraction candidate: low priority. Hand-of-the-game; would need
many injected callbacks.

---

## COMBAT — extracted, see [`combat.md`](combat.md)

`resolveAttack`, `effectiveAttack`, `effectiveDefend`,
`effectiveMoveDice` all live in `game/combat.js`. Thin wrappers in
`server.js` thread the YAML data tables + log + end-condition
helpers.

---

## OBJECTIVES — extracted, see [`objectives.md`](objectives.md)

`_evalObjectiveOne`, `evaluateObjectives`, `requiredObjectivesMet`
now live in `game/objectives.js`. `checkEndConditions` (state-mutating
promotion to winner / hero restoration) remains in server.js
around line ~1492.

---

## EFFECTIVE COMBAT DICE — extracted, see [`combat.md`](combat.md)

Folded into `game/combat.js`.

---

## SPELLS — extracted, see [`spells.md`](spells.md)

`applySpellEffect` + `resolveTarget` live in `game/spells.js`.
`handleCastSpell` (WebSocket entry — hand check, Wand of Recall
counter, broadcast) stays in `server.js`.

---

## TREASURE DECK — extracted, see [`treasure-deck.md`](treasure-deck.md)

`drawTreasureCard`, `applyTreasureCard`, and `adjacentFreeCells`
live in `game/treasure-deck.js`. Thin wrappers in `server.js` thread
the YAML tables + `resolveAttack` + log + end-conditions.

---

## USE INVENTORY ITEM (line ~1990)

`handleUseItem(room, token, itemId, targetCell)` — heal potions,
talisman, etc.

State touched: heroes (body / mind / inventory).

Extraction candidate: low priority.

---

## EQUIPMENT SHOP (line ~2036)

Between-quest buying.

State touched: hero gold + items.

Extraction candidate: low priority.

---

## TRAPS — extracted, see [`traps.md`](traps.md)

`triggerTrapsForCell` lives in `game/traps.js`. Thin wrapper in
`server.js` injects `logEvent` + `checkEndConditions`.

---

## PATHFINDING — extracted, see [`pathfinding.md`](pathfinding.md)

Local `findPath` wrapper around the extracted BFS.
`countVisibleBranches` lives in the module too.

---

## SEARCH (line ~2263)

`handleSearch(room, token)` — search current room for traps + secret
doors. Reveals matching pieces, can trigger surprise spawns.

State touched: traps (revealed), secret doors (revealed), monsters
(possibly added).

Extraction candidate: low priority.

---

## START-OF-TURN STATUS PROCESSING (line ~2502)

Spell-status decay at the start of each turn (`skipNextTurn`,
`doubleNextMovement`, sleep timers, etc).

Extraction candidate: low priority. Pairs with `advanceTurn`.

---

## GM TURN (line ~2537)

`runGMTurn(room)` — human GM or AI-driven monster activation.

State touched: monster movement + attacks, log events, end
conditions.

Extraction candidate: low priority — already calls into `bots.js`.

---

## AI GM SCHEDULER (line ~2608)

Tick scheduler that calls `decideMonsterTurn` (from `bots.js`) one
monster at a time with a pause between actions.

Extraction candidate: low priority. Already lightweight.

---

## LOBBY ACTIONS (line ~2719)

Joining rooms, picking hero seats, kicking, ready-state, etc.

Extraction candidate: low priority.

---

## HERO SPELL-ELEMENT DRAFT (line ~2820)

Pre-quest spell-element draft (Wizard picks 3 elements, Elf picks 1).

Extraction candidate: low priority.

---

## CONNECTION HANDLERS (line ~3042)

WebSocket message dispatcher — the giant switch over `msg.type`.

Extraction candidate: low priority (transport).

---

## HTTP STATIC SERVER (line ~3142)

Serves `public/` + `assets/` + `data/`.

Extraction candidate: low priority.

---

## MAP-EDITOR API (line ~3195)

REST routes used by `public/map-editor.js`:
`GET/PUT /api/quests/<file>`, `GET /api/board`,
`GET /api/canonical-pieces`, `POST /api/canonical-pieces/reload`,
`GET/PUT /api/furn-naturals`, `POST /api/render-png/<file>`.

Extraction candidate: low priority (transport).

---

## BOOT (line ~3425)

`loadGameData()`, `loadRooms()`, server.listen — boot sequence.

Extraction candidate: low priority.

---

## Extraction priority summary

**All six originally-planned extractions are DONE.**

1. ~~`game/view.js` — `viewFor`.~~ DONE
2. ~~`game/quest-builder.js` — `build*` family.~~ DONE
3. ~~`game/spells.js` — `applySpellEffect`.~~ DONE
4. ~~`game/traps.js` — `triggerTrapsForCell`.~~ DONE
5. ~~`game/treasure-deck.js` — `drawTreasureCard` + effect resolver.~~ DONE
6. ~~`game/combat.js` (full) — fold in damage resolution + effective
   dice.~~ DONE

`server.js` shrunk from **3,625 → 2,441 lines** (-33%).

What remains in `server.js` is intentionally transport / state-plumbing:
WebSocket protocol, room lifecycle, persistence, lobby actions,
hero spell-element draft, AI scheduler, HTTP static server, map-editor
REST routes. Those are coupled to room state mutation + WebSocket and
don't benefit from extraction.
