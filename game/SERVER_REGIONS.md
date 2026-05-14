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

`send`, `broadcastRoom`, `logEvent`, `seatsOf`, `isMyTurn`,
**`viewFor(room, token)`** — the giant projection that produces the
per-tab payload.

State touched: reads everything; emits log entries (`logEvent`).

`viewFor` is 200+ lines and PURE in shape (state → projection). High
extraction value as `game/view.js` — already on the backlog.

---

## QUEST → BOARD STATE (line ~605)

`buildBoardState`, `buildHeroes`, `buildMonsters`, `buildTreasure`,
`buildTraps`, `buildFurnitureTraps`, `buildSecretDoors`,
`freshGameState`. Together they convert a quest JSON + the master
board into the runtime `state` object.

State touched: returns a fresh state — pure modulo `shuffle`.

Extraction candidate: high value. Big module, no state mutation,
pulls in master board + tables — `game/quest-builder.js`. Backlog.

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

## COMBAT (line ~1392)

Damage resolution — applies attacker skulls vs defender shields,
calls `applyDamage`, checks for death + objective updates.

State touched: hero / monster body, log events, end conditions.

Extraction candidate: high value as `game/combat.js` (joins the
already-extracted dice helpers). Backlog.

---

## OBJECTIVES — extracted, see [`objectives.md`](objectives.md)

`_evalObjectiveOne`, `evaluateObjectives`, `requiredObjectivesMet`
now live in `game/objectives.js`. `checkEndConditions` (state-mutating
promotion to winner / hero restoration) remains in server.js
around line ~1492.

---

## EFFECTIVE COMBAT DICE (line ~1664)

`effectiveAttack(h)`, `effectiveDefend(h)`, `effectiveBody(m)` —
base stats + equipment bonus + spell-status modifiers.

State touched: hero / monster status, equipment bag.

Extraction candidate: medium. Pairs naturally with the combat module.

---

## SPELLS (line ~1714)

`resolveSpell(room, caster, spell, targetCell)` — the giant switch
over `effect:` strings from `data/cards/spells.yaml`. Genie,
Pass Through Rock, Veil of Mist, Heal Body, Tempest, etc.

State touched: heroes, monsters, spell hand, status flags, doors.

Extraction candidate: high value but risky — many spells touch
many state shapes. `game/spells.js`. Backlog.

---

## TREASURE DECK (line ~1883)

`drawTreasure(room, hero)` — searches a room, draws from the deck
template, applies the card effect (gold, item, wandering monster,
trap exposure).

State touched: heroes (gold, items), monsters (wandering spawn),
treasure deck, log.

Extraction candidate: medium. `game/treasure-deck.js`. Backlog.

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

## TRAPS (line ~2071)

`triggerTrapsForCell(room, hero, cell)` — spear (1 die — skull or
dodge), pit (-1 body + stuck), block (3 dice no defence + cell
becomes permanently rubble).

State touched: trap revealed/triggered/disarmed, hero body + status,
tile rubble flag, log, calls `checkEndConditions`.

Extraction candidate: medium. Self-contained, but needs
`logEvent` + `checkEndConditions` + `tileAt` + dice helpers
injected. `game/traps.js`. Backlog.

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

When the next refactor pass happens, this is the order I'd tackle in:

1. **`game/view.js`** — `viewFor`. Pure projection, biggest single
   block, immediately useful for testability.
2. **`game/quest-builder.js`** — the `build*` family. Pure modulo
   `shuffle`. Big block, no state mutation. Good for testability.
3. **`game/spells.js`** — `resolveSpell`. Biggest gameplay surface;
   high churn area. Move once the seams are obvious.
4. **`game/traps.js`** — `triggerTrapsForCell`. Self-contained,
   small.
5. **`game/treasure-deck.js`** — draw + effect resolver.
6. **`game/combat.js` (full)** — fold damage resolution + effective
   dice into the existing module.

These are tracked in [`../docs/BACKLOG.md`](../docs/BACKLOG.md).
