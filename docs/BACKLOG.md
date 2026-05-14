# Backlog

Captured improvements that aren't urgent but worth doing.
Newest items at the top.

When an item ships, remove it from this file (or fold the rationale
into the relevant folder's README as historical context).

---

## Continue server.js module extraction (Phases B + C)

**Why:** Phases A landed (util / combat-dice / los / pathfinding /
objectives) and shaved ~150 lines off `server.js`. The big wins for
the next pass are documented in
[`../game/SERVER_REGIONS.md`](../game/SERVER_REGIONS.md). Until
extracted they live in `server.js` but the SKILL doc gives Claude
a focused pointer when working on each region.

**Extraction order** (highest value first):

1. ~~`game/view.js` — `viewFor`.~~ **DONE** — see
   [`../game/view.md`](../game/view.md).
2. ~~`game/quest-builder.js` — `buildBoardState` + the `build*`
   family.~~ **DONE** — see
   [`../game/quest-builder.md`](../game/quest-builder.md).
3. `game/spells.js` — `resolveSpell` (~170 lines). High churn area;
   move once seams are obvious.
4. `game/traps.js` — `triggerTrapsForCell` (~70 lines). Self-contained,
   small.
5. `game/treasure-deck.js` — draw + effect resolver.
6. `game/combat.js` (full) — fold damage resolution + effective dice
   into the existing combat module.

Each extraction:
- Targets one well-bounded region.
- Uses **dependency injection** for `logEvent` / `checkEndConditions` /
  rules-tables — never hard-imports them.
- Adds a sibling `<module>.md` skill doc with purpose / exports /
  state-shape contract.
- Verifies `npm test` still passes.

---

## YAML consolidation for monsters / hero tokens / tile icons

**Why:** The furniture tables collapsed into `canonical-pieces.yaml`
in one pass — adding a new piece is now a single YAML edit. The same
pattern hasn't been applied to monsters, hero variant tokens, or
tile/trap icons; those are still hardcoded in two frontend files
each (`client.js` + `map-editor.js`).

| Table | Files | What it carries |
|---|---|---|
| `MONSTER_TYPE_FILE` | `client.js`, `map-editor.js` | type → token PNG (incl. boss aliases) |
| `HERO_FILE` / `HERO_NAMES` / variant tokens | `client.js`, `map-editor.js` | hero id → token PNG (Male / Female variants) |
| `TILE_FILE` | `client.js` | rubble / trap / stair kind → tile PNG |

**Proposed schema** — extend or add YAML alongside existing files:

```yaml
# data/canonical-monsters.yaml  (or extend data/monsters.yaml)
monsters:
  goblin:
    tokenFile: Goblin-Token.png
    cardFile:  Goblin-Card.png
    aliases:   [grak]            # boss aliases that share this art
```

```yaml
# data/canonical-tiles.yaml
tiles:
  rubble:        { file: SingleBlockedSquare.png }
  rubble-double: { file: DoubleBlockedSquare.png }
  pit:           { file: PitTrap.png }
  spear:         { file: SpearTrap.png }
  stairway:      { file: Stairway.png }
```

**Implementation sketch:**

1. Land the schema in one or two new YAML files (or extend existing).
2. Server exposes `/api/canonical-monsters` + `/api/canonical-tiles`
   the same way `/api/canonical-pieces` works today (see
   `server.js` for the pattern).
3. Each frontend fetches at boot, replaces the hardcoded table with
   a live one. Keep a fallback so offline / pre-fetch rendering
   still works.

Not urgent — none of these tables changes very often. Re-visit when
adding a new expansion pack or a fresh monster set.

---
