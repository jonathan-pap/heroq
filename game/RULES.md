# Rule modules (`game/`)

> **Purpose:** Lists the shared rule modules consumed by
> [`server.js`](../server.js). Pure logic, no transport / state.
> Easy to unit-test.
>
> **Related:**
> [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) (top-level map),
> [`test/TESTS.md`](../test/TESTS.md) (per-module test coverage),
> [`server.js`](../server.js) (the only consumer today).

Server-side game-rule modules. Imported by [`server.js`](../server.js).
Kept separate from the monolithic `server.js` for testability and to
leave room for more rule modules as the codebase grows.

---

## Modules

Each module has a sibling `.md` skill doc — read that first when
working on it.

| Module | Skill doc | Purpose |
|---|---|---|
| [`util.js`](util.js) | [`util.md`](util.md) | Pure helpers — IDs, dice, geometry, array shuffle. Zero state. |
| [`combat.js`](combat.js) | [`combat.md`](combat.md) | Combat dice + effective-dice (attack / defend / move) + `resolveAttack` damage pipeline (drink-to-save, lost artifacts, status decay, `state.combat` snapshot). |
| [`los.js`](los.js) | [`los.md`](los.md) | Line-of-sight + occupant queries (`tileAt`, `occupantAt`, `lineOfSight`, `isMultiShareCell`, `isMonsterVisibleToHeroes`). |
| [`pathfinding.js`](pathfinding.js) | [`pathfinding.md`](pathfinding.md) | BFS pathfinder + corridor branch counter. `passable` is injected by the caller. |
| [`objectives.js`](objectives.js) | [`objectives.md`](objectives.md) | Quest-objective evaluation — `_evalObjectiveOne`, `evaluateObjectives`, `requiredObjectivesMet`. Pure; the state-mutating `checkEndConditions` stays in `server.js`. |
| [`view.js`](view.js) | [`view.md`](view.md) | Per-tab view projection (`viewFor`). Pure read of room + state. Server.js wraps it with deps (HEROES / MONSTER_TYPES / seatsOf / currentTurn / …) supplied fresh per call. |
| [`quest-builder.js`](quest-builder.js) | [`quest-builder.md`](quest-builder.md) | Quest JSON → runtime state (`freshGameState` + `build*` family). Pure modulo `shuffle` + injected `exploreFromHero` fog-reveal. |
| [`spells.js`](spells.js) | [`spells.md`](spells.md) | `applySpellEffect` — heal / move buffs / pass walls / sleep / direct damage / Genie summon, with LoS gate. `handleCastSpell` (hand + Wand + broadcast) stays in `server.js`. |
| [`traps.js`](traps.js) | [`traps.md`](traps.md) | `triggerTrapsForCell` — spear (1 die dodge), pit (-1 body, inPit), block (3 dice no defence, permanent rubble). |
| [`treasure-deck.js`](treasure-deck.js) | [`treasure-deck.md`](treasure-deck.md) | `drawTreasureCard` + `applyTreasureCard` (gold / potion / trap / wandering monster). |
| [`fog.js`](fog.js) | — | Fog-of-war logic — which cells are revealed for each hero given the current movement / LoS / open-door / blocked state. Tested in [`../test/fog.test.js`](../test/fog.test.js). |

---

## Index of regions still in `server.js`

See [`SERVER_REGIONS.md`](SERVER_REGIONS.md) — line-range map of
every region in `server.js`, what state each touches, and which
ones are extraction candidates for a future pass.

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
