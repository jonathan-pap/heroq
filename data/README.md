# `data/` — YAML source of truth + per-quest JSON

All static game content lives here. The server reads YAML at boot and
serves it through REST endpoints; quest JSON is editable through the
map editor and hot-reloaded on save.

---

## Files

| File | What it carries | Consumed by |
|---|---|---|
| `board.yaml` | Master board: 22 room cell-lists + corridor cells. The "geometry" every quest sits on top of. | `server.js` → `/api/board`. Editor, builder, render scripts. |
| `canonical-pieces.yaml` | **Furniture metadata** (single source of truth): footprint, anchor, canonical PNG filename, alt-art PNG filename, natural orientation, alias list, asset folder. | `server.js` → `/api/canonical-pieces`. All three frontends. The XML converter + quest validator read footprints from here. |
| `canonical-quests-meta.yaml` | Per-quest title / subtitle / category metadata. | Quest installer scripts. |
| `heroes.yaml` | Hero cards: body, mind, attack, defend, glyph, colour, starting equipment, spell-element counts, bans. | `server.js` (hero creation), `client.js` (card render). |
| `monsters.yaml` | Monster stats: move, attack, defend, body, mind, glyph, colour. Boss aliases (Verag, Ulag, Witch Lord) override the base type. | `server.js` (combat + AI), `client.js` (token render). |
| `cards/spells.yaml` | 12 hero spells (3 per element: Air, Earth, Fire, Water). Each has `effect` (engine hook), `target`, `range`. | `server.js` (spell resolver). |
| `cards/dread-spells.yaml` | Zargon's spell deck. | `server.js`. |
| `cards/equipment.yaml` | Weapons + armour for the shop. | `server.js` + `client.js`. |
| `cards/treasure.yaml` | Treasure-deck cards (gold, wandering monsters, items). | `server.js` (treasure deck), `client.js`. |
| `cards/artifacts.yaml` | One-of-a-kind artifact rewards. | `server.js`. |
| `furniture-naturals.json` | Per-type natural-orientation overrides written by the editor's playground panel. Keyed by `type` (canonical art) or `type:alt` (alt art). | `server.js` GET/PUT `/api/furn-naturals`. |
| `quests/*.json` | Per-quest content: rooms revealed, dark cells, furniture placements, monsters, treasure, traps, doors, secret doors, start cells, objectives. | `server.js` (live game), editor (load/save). |
| `quests/sandbox/*.json` | Sandbox quests for testing (separated from the main quest book). | Same as above. |
| `rooms.json` | Legacy room reference. | (Likely unused by the runtime — kept for now.) |
| `board.generated.yaml` | Output of an extraction script. Gitignored. | Scripts only. |
| `board.legacy.yaml.bak` | Pre-2026 board layout backup. | Reference only. |

---

## `canonical-pieces.yaml` — full schema

Single entry per heroscribe PascalCase piece id. The frontends use
the `aliases` list to map kebab-case quest-JSON type strings to the
correct piece.

```yaml
pieces:
  AlchemistsBench:
    natural:    { w: 3, h: 2 }              # footprint in cells (NATURAL orientation)
    anchor:     TL                          # XML anchor cell
    file:       AlchemistsBench.png         # canonical heroscribe PNG (under /assets/<dir>/)
    altFile:    Alchemist Bench-2x3.png     # optional "alt art" variant
    naturalDir: upward                      # direction the bench FACES in the natural PNG
    aliases:    [alchemist-table, alchemist-bench, alchemists-bench]
    dir:        furniture                   # optional asset folder (default 'furniture')
```

Footprint-only entries (`Door`, `SingleBlockedSquare`,
`DoubleBlockedSquare`) carry just `natural` + `anchor` — they're used
by the quest validator but aren't drawn through the furniture render
path.

**Adding a new piece:** drop one block in this file → reload the
server (or POST `/api/canonical-pieces/reload`) → every surface picks
it up.

---

## Per-quest JSON shape

Each quest is an object stored at `data/quests/<id>.json`. Shape:

```jsonc
{
  "id": "quest1-trial",
  "title": "The Trial",
  "subtitle": "Slay Verag, the gargoyle of Fellmarg's tomb.",
  "category": "main",
  "board": "main",          // master board id (currently always "main")
  "dark": [[c, r], ...],    // out-of-play cells for this quest
  "blocked": [[c, r], ...], // rubble tiles
  "doors": [{ a: [c,r], b: [c,r], state: "open" | "closed", ... }],
  "secretDoors": [...],
  "furniture": [{
    "id": "f-...",
    "type": "alchemist-bench",
    "cells": [[c, r], ...],
    "facing": "rightward",
    "_flipH": true,    // canonical-art flip
    "_altFlipH": true  // alt-art flip (independent)
  }],
  "monsters": [{ "id": "m-...", "type": "orc", "at": [c, r], ... }],
  "traps": [...],
  "treasure": [...],
  "startCells": [[c, r], ...],
  "stairCells": [[c, r], ...],
  "objective": "...",
  "defeat":   "..."
}
```

Coordinates are 0-based throughout. The editor displays 1-based
labels (L`col+1`T`row+1`).

---

## Editing flow

- **YAML files** (heroes, monsters, cards, board, canonical-pieces):
  edit on disk → server restart (or specific reload endpoint).
- **Per-quest JSON**: open in the map editor → drag / rotate / flip →
  `Ctrl+S` → server hot-reloads via the `PUT` route. Live game
  sessions snapshot quest data at start, so changes apply on next
  fresh quest.
- **Natural overrides** (`furniture-naturals.json`): editor's Natural
  orientations panel. Auto-saves through the API.
