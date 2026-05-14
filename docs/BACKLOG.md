# Backlog

Captured improvements that aren't urgent but worth doing.
Newest items at the top.

When an item ships, remove it from this file (or fold the rationale
into the relevant folder's README as historical context).

---

## Quest edits don't propagate into running rooms

**Why:** When a quest starts, the server bakes the quest JSON into the
room's runtime state (`data/runtime/rooms.json`). Subsequent edits to
the quest file via the map editor (flip, rotate, move furniture,
relocate a stair, etc.) update the disk file and the in-memory
`quests` Map, but the running room's snapshot is unchanged. The
editor's author has to leave the quest from the lobby and re-enter
for a fresh quest start to see their edits in-game.

**Three paths, pick when prioritised:**

1. **Auto-rebake** — on `PUT /api/quests/<file>`, find any running
   rooms tied to that quest and re-bake their snapshot from disk.
   Riskiest option: mid-quest reveals / picked-up items / killed
   monsters can collide with the new layout. Would need to selectively
   preserve player-progress fields (hero positions, fog, killed
   monsters, picked treasure) while replacing layout fields
   (furniture, doors, stairs, traps).

2. **Manual rebake button** — add a "Refresh from disk" action in the
   ⚙ menu. Opt-in, so authoring is one click but normal play sessions
   are unaffected. Lowest blast radius; matches the existing
   "POST /api/canonical-pieces/reload" hot-reload pattern.

3. **Status nudge** — when a saved quest no longer matches its
   in-room snapshot, the lobby (or the in-game header) surfaces a
   "this quest has been edited since you started — restart to apply"
   message. Doesn't change behavior, just removes the surprise.

Option 2 is probably the right starting point — it's the smallest
diff and the manual gate keeps players safe from mid-session layout
swaps. Option 3 layers on top of either path as the visible signal.

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
pattern wasn't applied to monsters or hero variant tokens; those are
still hardcoded in two frontend files each (`client.js` +
`map-editor.js`).

Status: **`TILE_FILE` consolidation DONE** — rubble + trap markers +
stairway now live in [`../data/tiles/canonical-tiles.yaml`](../data/tiles/canonical-tiles.yaml)
served via `/api/canonical-tiles`. Both `HQFurnitureArt` and
`map-editor.js` hydrate from it at boot. The two remaining
hardcoded tables:

| Table | Files | What it carries |
|---|---|---|
| `MONSTER_TYPE_FILE` | `public/client/sprites.js`, `map-editor.js` | type → token PNG (incl. boss aliases) |
| `HERO_FILE` / `HERO_NAMES` / variant tokens | `public/client/sprites.js`, `map-editor.js` | hero id → token PNG (Male / Female variants) |

**Proposed schema** — extend or add YAML alongside existing files:

```yaml
# data/units/canonical-monsters.yaml  (or extend data/units/monsters.yaml)
monsters:
  goblin:
    tokenFile: Goblin-Token.png
    cardFile:  Goblin-Card.png
    aliases:   [grak]            # boss aliases that share this art
```

**Implementation sketch:**

1. Land the schema in one or two new YAML files (or extend existing).
2. Server exposes `/api/canonical-monsters` the same way
   `/api/canonical-pieces` / `/api/canonical-tiles` works today (see
   `server.js` for the pattern).
3. Each frontend fetches at boot, replaces the hardcoded table with
   a live one. Keep a fallback so offline / pre-fetch rendering
   still works.

Not urgent — none of these tables changes very often. Re-visit when
adding a new expansion pack or a fresh monster set.

---
