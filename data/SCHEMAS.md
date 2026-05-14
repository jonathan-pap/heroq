# Data schemas (`data/`)

> **Purpose:** Documents every YAML / JSON file that holds static
> game content — what each file carries, how the
> [`pieces/canonical-pieces.yaml`](pieces/canonical-pieces.yaml)
> schema works, and the per-quest JSON shape (cells / facing / flip
> / dark / blocked / etc.).
>
> **Related:**
> [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) (top-level map),
> [`public/FRONTEND.md`](../public/FRONTEND.md) (the three surfaces
> that consume this data),
> [`scripts/TOOLS.md`](../scripts/TOOLS.md) (extraction +
> validation scripts that write / read these files).

All static game content lives here. [`server.js`](../server.js)
reads YAML at boot and serves it through REST endpoints; quest JSON
is editable through the map editor and hot-reloaded on save.

---

## Layout

```
data/
├── SCHEMAS.md                  this file
├── board/
│   └── board.yaml              master board geometry
├── units/
│   ├── heroes.yaml             hero cards
│   └── monsters.yaml           monster stats
├── pieces/
│   ├── canonical-pieces.yaml   furniture metadata (single SoT)
│   └── furniture-naturals.json editor-tuned natural-orientation overrides
├── tiles/
│   └── canonical-tiles.yaml    overlay-tile metadata (rubble / traps / stairway / future overlays)
├── cards/
│   ├── spells.yaml             hero spell deck (12 cards, 4 elements)
│   ├── dread-spells.yaml       Zargon's spells
│   ├── equipment.yaml          weapons + armour
│   ├── treasure.yaml           treasure deck
│   └── artifacts.yaml          one-of-a-kind rewards
├── quests/
│   ├── _meta.yaml              per-quest title / subtitle / boss / objectives
│   ├── <questN>.json           per-quest content (board overlays)
│   └── sandbox/                test quests, separated from the book
├── generated/                  gitignored — script outputs
│   └── board.generated.yaml    extract-board-from-jpg output
└── runtime/                    gitignored — server-written state
    └── rooms.json              multi-room session persistence
```

---

## Files

| File | What it carries | Consumed by |
|---|---|---|
| `board/board.yaml` | Master board: 22 room cell-lists + corridor cells. The "geometry" every quest sits on top of. | `server.js` → `/api/board`. Editor, builder, render scripts. |
| `pieces/canonical-pieces.yaml` | **Furniture metadata** (single source of truth): footprint, anchor, canonical PNG filename, alt-art PNG filename, natural orientation, alias list, asset folder. | `server.js` → `/api/canonical-pieces`. All three frontends. The XML converter + quest validator read footprints from here. |
| `pieces/furniture-naturals.json` | Per-type natural-orientation overrides written by the editor's playground panel. Keyed by `type` (canonical art) or `type:alt` (alt art). | `server.js` GET/PUT `/api/furn-naturals`. |
| `tiles/canonical-tiles.yaml` | **Overlay tile metadata** — rubble (SingleBlockedSquare, DoubleBlockedSquare), falling-rock, pit / spear / chest-trap markers, stairway, and future overlay tokens. Same shape as `canonical-pieces.yaml`. | `server.js` → `/api/canonical-tiles`. `HQFurnitureArt` (game) + `map-editor.js` hydrate their alias → PNG tables from this. The XML converter + quest validator merge tile footprints with piece footprints. |
| `units/heroes.yaml` | Hero cards: body, mind, attack, defend, glyph, colour, starting equipment, spell-element counts, bans. | `server.js` (hero creation), `client.js` (card render). |
| `units/monsters.yaml` | Monster stats: move, attack, defend, body, mind, glyph, colour. Boss aliases (Verag, Ulag, Witch Lord) override the base type. | `server.js` (combat + AI), `client.js` (token render). |
| `cards/spells.yaml` | 12 hero spells (3 per element: Air, Earth, Fire, Water). Each has `effect` (engine hook), `target`, `range`. | `server.js` (spell resolver). |
| `cards/dread-spells.yaml` | Zargon's spell deck. | `server.js`. |
| `cards/equipment.yaml` | Weapons + armour for the shop. | `server.js` + `client.js`. |
| `cards/treasure.yaml` | Treasure-deck cards (gold, wandering monsters, items). | `server.js` (treasure deck), `client.js`. |
| `cards/artifacts.yaml` | One-of-a-kind artifact rewards. | `server.js`. |
| `quests/_meta.yaml` | Per-quest title / subtitle / category metadata. | Quest installer scripts. |
| `quests/<id>.json` | Per-quest content: rooms revealed, dark cells, furniture placements, monsters, treasure, traps, doors, secret doors, start cells, objectives. | `server.js` (live game), editor (load/save). |
| `quests/sandbox/*.json` | Sandbox quests for testing (separated from the main quest book). | Same as above. |
| `generated/board.generated.yaml` | Output of `scripts/extract-board-from-jpg.js`. Gitignored. Drop-in replacement candidate for `board/board.yaml`. | Scripts only. |
| `runtime/rooms.json` | Persisted multi-room game state (hostToken, players, view snapshot, etc.). Gitignored. | `server.js` reads on boot, debounced atomic-writes on state change. |

---

## `pieces/canonical-pieces.yaml` — full schema

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

Footprint-only entries (`Door`) carry just `natural` + `anchor` —
they're used by the quest validator but aren't drawn through the
furniture render path. Rubble + stairway moved to
[`tiles/canonical-tiles.yaml`](tiles/canonical-tiles.yaml) (see
below).

**Adding a new piece:** drop one block in this file → reload the
server (or POST `/api/canonical-pieces/reload`) → every surface picks
it up.

---

## `tiles/canonical-tiles.yaml` — full schema

Companion to `canonical-pieces.yaml` for **overlay tiles** — anything
that sits on a single (or small) cell rect: rubble, trap markers,
stairways, future quest tokens. Same shape, same hot-reload, separate
file so the two concerns don't collide.

```yaml
tiles:
  PitTrap:
    natural: { w: 1, h: 1 }              # footprint in cells
    anchor:  TL                          # XML anchor
    file:    PitTrap.png                 # PNG under /assets/tiles/
    aliases: [pit, pit-trap]             # kebab-case kinds in quest JSON

  Stairway:
    natural:    { w: 2, h: 2 }
    anchor:     TL
    file:       Stairway.png
    naturalDir: downward                 # optional; matters for the
                                         # stairway's directional fan
    aliases:    [stairway]
```

All files live under `/assets/tiles/` — no `dir` override needed.
The frontends resolve `view.traps[i].type` / `tile.kind` through the
alias map; the renderer falls back to a hardcoded baseline table
while the `/api/canonical-tiles` fetch is in flight.

**Adding a new tile:** drop one block in this file → reload the
server (or POST `/api/canonical-tiles/reload`) → every surface picks
it up. The XML converter + quest validator pull from BOTH yamls and
merge them into one flat footprint table, so an XML PieceID is
resolved regardless of which file it came from.

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
