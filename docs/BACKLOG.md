# Backlog

Captured improvements that aren't urgent but worth doing.
Newest items at the top.

When an item ships, remove it from this file (or fold the rationale
into the relevant folder's README as historical context).

---

## ~~Client.js Phase B — modularize the browser client~~ DONE

`public/client.js` shrunk from 3,563 → 2,202 lines (-38%) across
nine splits. Same convention as `public/shared/rules.js` —
classic-script IIFE on a `window.HQ<Name>` namespace, no
`<script type="module">` switch, no build step.

Modules extracted (all under [`../public/client/`](../public/client/)):

| Module | Public on `window` | What it owns |
|---|---|---|
| `sprites.js` | `HQSprites` | monster/hero PNG tables + variant token URLs |
| `audio.js` | `HQAudio` | Web Audio SFX synth + 🔊 / 🔇 toggle |
| `modals.js` | `HQModals` | combat / treasure / end / save / restart dialogs |
| `textures.js` | `HQTextures` | room + corridor floor-texture overlay |
| `furniture-draw.js` | `HQFurnitureDraw` | 12 pixel-art furniture primitives + drawShape dispatcher |
| `card-preview.js` | `HQCardPreview` | hover-preview popover for spell / equipment thumbs |
| `overlays.js` | `HQOverlays` | hand overlays + mobile bottom-tab switcher |
| `furniture-art.js` | `HQFurnitureArt` | canonical-pieces hydration + FURN_IMG / TILE_IMG / inset tables / ALT_FURN_ON pref |
| `lobby.js` | `HQLobby` | lobby render + spell-draft picker + form-control wiring |

See [`../public/FRONTEND.md`](../public/FRONTEND.md) (`Client splits`
table) for the per-module deps contract.

What remains in `client.js`: WebSocket plumbing, screens / state
apply, game render pipeline (`drawBoard` + `drawTile` + `drawWalls`
+ `drawDoor` + hero / monster / treasure / secretDoor / trap
painters + reachable / hover-path), turn controls, hero strip,
header buttons, log, sidebar tabs, click handling + tooltip, panel
collapse, options menu, boot.

---

## ~~Test coverage for extracted game/ modules (Phase A)~~ DONE

`28dff9f` added 62 new tests across four files for the modules that
were extracted in Phase B+C but didn't have direct unit coverage:

- [`test/combat.test.js`](../test/combat.test.js) — 21 tests
- [`test/spells.test.js`](../test/spells.test.js) — 16 tests
- [`test/traps.test.js`](../test/traps.test.js) — 11 tests
- [`test/treasure-deck.test.js`](../test/treasure-deck.test.js) — 14 tests

Total suite: 147 → 210 passing. Uses a `stubRandom(seq)` helper to
make dice-roll branches deterministic.

---

## ~~Server.js module extraction (Phases B + C)~~ DONE

All six planned extractions landed. `server.js` shrunk from 3,625 →
2,441 lines (-33%). See [`../game/RULES.md`](../game/RULES.md) for
the full module index and
[`../game/SERVER_REGIONS.md`](../game/SERVER_REGIONS.md) for what
remains in `server.js` (intentionally transport / state-plumbing).

Modules extracted:
[`../game/util.js`](../game/util.js),
[`../game/combat.js`](../game/combat.js) (dice + effective + damage),
[`../game/los.js`](../game/los.js),
[`../game/pathfinding.js`](../game/pathfinding.js),
[`../game/objectives.js`](../game/objectives.js),
[`../game/view.js`](../game/view.js),
[`../game/quest-builder.js`](../game/quest-builder.js),
[`../game/spells.js`](../game/spells.js),
[`../game/traps.js`](../game/traps.js),
[`../game/treasure-deck.js`](../game/treasure-deck.js).

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
