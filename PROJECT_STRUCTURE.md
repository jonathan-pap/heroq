# Project structure

> **Purpose:** Top-level map of the HeroQuest 1989/2021 web
> recreation. First stop when looking for where a piece of logic
> lives or where a feature is implemented.
>
> **Related:** Each major folder has its own dedicated reference
> doc — [`public/FRONTEND.md`](public/FRONTEND.md),
> [`data/SCHEMAS.md`](data/SCHEMAS.md),
> [`assets/ART_INDEX.md`](assets/ART_INDEX.md),
> [`scripts/TOOLS.md`](scripts/TOOLS.md),
> [`test/TESTS.md`](test/TESTS.md),
> [`game/RULES.md`](game/RULES.md),
> [`docs/INDEX.md`](docs/INDEX.md).

---

## Tech stack (one paragraph)

Vanilla Node.js + `ws` on the server, vanilla JS in the browser, no
build step. YAML files in `data/` are the source of truth for static
content; per-quest state lives in `data/quests/*.json`. The browser
renders to a `<canvas>` with raster sprites under `assets/`.

```
HTTP / WebSocket
   ↑
   ├─ server.js (state authority, game loop, AI, fog of war)
   │   └─ game/*.js (rules modules: combat, los, pathfinding,
   │                 objectives, view, spells, traps, treasure-deck,
   │                 quest-builder, util)
   ├─ bots.js   (Zargon AI helpers consumed by server.js)
   ↓
   ├─ public/client.js      (live game UI on /index.html)
   │   └─ public/client/*.js (subsystems: sprites, audio, modals,
   │                          textures, furniture-draw, furniture-art,
   │                          card-preview, overlays, lobby)
   ├─ public/map-editor.js  (quest authoring on /map-editor.html)
   └─ public/builder.js     (layered-render playground on /builder.html)
```

---

## Top-level files

| File | Purpose |
|---|---|
| [`server.js`](server.js) | HTTP + WebSocket server, game state, rules engine, REST endpoints (`/api/board`, `/api/quests`, `/api/canonical-pieces`, `/api/furn-naturals`). Single file — search by region comment. |
| [`bots.js`](bots.js) | Zargon AI move/attack pickers. Imported by `server.js`. |
| [`package.json`](package.json) | One runtime dep (`ws`), one dev dep (`js-yaml`). Scripts: `start`, `test`. |
| [`start.bat`](start.bat) | Windows launcher. |
| [`render.yaml`](render.yaml) | Render.com deploy config. |
| [`README.md`](README.md) | Repo front page → points at this file. |
| [`UPGRADE_NODE.md`](UPGRADE_NODE.md) | Node-version migration notes. |

---

## Major folders (each has its own README.md)

| Folder | Reference doc | What's in it | Quick "where to look" |
|---|---|---|---|
| `public/` | [`public/FRONTEND.md`](public/FRONTEND.md) | Browser code: live game, map editor, builder, shared utilities | Game UI/render → [`public/client.js`](public/client.js). Editor → [`public/map-editor.js`](public/map-editor.js). |
| `data/` | [`data/SCHEMAS.md`](data/SCHEMAS.md) | YAML source of truth + per-quest JSON, grouped under `board/`, `units/`, `pieces/`, `cards/`, `quests/` | Add monster stats → [`data/units/monsters.yaml`](data/units/monsters.yaml). New piece → [`data/pieces/canonical-pieces.yaml`](data/pieces/canonical-pieces.yaml). Quest data → `data/quests/*.json`. |
| `assets/` | [`assets/ART_INDEX.md`](assets/ART_INDEX.md) | All PNG art (board scans, monsters, heroes, furniture, tiles, cards, textures) | New token → `assets/monsters/`. New furniture art → `assets/furniture/`. |
| `scripts/` | [`scripts/TOOLS.md`](scripts/TOOLS.md) | Offline tools (build, extract, validate, render) | Regenerate floor textures → `node scripts/extract-room-floors.js`. Validate quest JSON → [`scripts/validate-quests.js`](scripts/validate-quests.js). |
| `test/` | [`test/TESTS.md`](test/TESTS.md) | Unit tests (rules, LoS, fog, AI, schema) | `npm test`. |
| `game/` | [`game/RULES.md`](game/RULES.md) | Shared game-rule modules used server-side | [`game/fog.js`](game/fog.js) — fog-of-war logic. |
| `docs/` | [`docs/INDEX.md`](docs/INDEX.md) | Project documentation | [`docs/BACKLOG.md`](docs/BACKLOG.md) — deferred work. [`docs/canonical-quests.md`](docs/canonical-quests.md) — quest-design reference. |
| `_reference/` | — | Local scratch / archive (git-ignored) | Not in version control. |

---

## "I want to change …" cheat sheet

### Game mechanics / rules
- **Combat dice** → `server.js` (search `attack` / `defend`)
- **Movement** → `server.js` (`moveHero`) + `game/fog.js`
- **Spell effects** → `server.js` (`resolveSpell`)
- **Monster AI** → `bots.js`

### Visuals
- **Live game render** → `public/client.js` (search `drawBoard`)
- **Floor textures** → `assets/room_textures/` + `public/client/textures.js`
- **Walls/doors** → `public/client.js` `drawWalls` / `drawDoor`
- **Furniture PNG layer** → `public/client/furniture-art.js` (image cache, alt-art toggle, naturals/inset overrides)
- **Furniture pixel-art fallback** → `public/client/furniture-draw.js` (12 piece primitives)
- **Sprites (monsters / heroes)** → `public/client/sprites.js` (`HQSprites`)
- **Furniture metadata** → `data/pieces/canonical-pieces.yaml` (file/altFile/aliases)
- **Sound effects (synth)** → `public/client/audio.js` (`HQAudio`)
- **Modal dialogs** → `public/client/modals.js`

### Authoring tools
- **Map editor (place pieces)** → `public/map-editor.js`
- **Builder (texture playground)** → `public/builder.js`
- **Natural-orientation overrides** → editor's "Natural orientations" panel; persists to `data/pieces/furniture-naturals.json` via PUT.

### Static content
- **Hero stats** → `data/units/heroes.yaml`
- **Monster stats** → `data/units/monsters.yaml`
- **Spells / equipment / treasure / artifacts** → `data/cards/*.yaml`
- **Master board (rooms / corridors)** → `data/board/board.yaml`
- **Furniture metadata (file, altFile, natural, aliases, footprint)** → `data/pieces/canonical-pieces.yaml`
- **Quest content (per-quest)** → `data/quests/*.json` (per-quest meta: `data/quests/_meta.yaml`)

### Settings & preferences (localStorage)
| Key | What | Surfaces |
|---|---|---|
| `hq_rails_hidden_v1` | Side rails collapsed | Game |
| `hq_floor_textures_v1` | Floor texture overlay on/off | Game |
| `hq_light_walls_v1` | Cream vs dark walls | Game + Editor |
| `hq_outer_walls_v1` | Draw the 4 board-edge walls | Game + Editor |
| `hq_furn_alt_v1` | Alt furniture art on/off | Game + Editor + Builder |
| `hq_furn_insets_v2` / `_alt_v1` | Per-bucket inset px (canonical / alt) | All three |
| `hq_furn_natural_overrides_v1` | Per-type natural orientation (cache; server is source of truth) | All three |
| `hq_panel_collapsed_v1` | Right-panel collapse state | Game |

---

## REST endpoints (server.js)

| Method | Path | What |
|---|---|---|
| `GET` | `/api/board` | Master board (rooms + corridor cells) |
| `GET` | `/api/quests` | Quest list |
| `GET` | `/api/quests/:file` | Raw quest JSON |
| `PUT` | `/api/quests/:file` | Save quest JSON, hot-reload |
| `GET` | `/api/canonical-pieces` | Furniture metadata YAML |
| `POST` | `/api/canonical-pieces/reload` | Re-read YAML without restart |
| `GET` / `PUT` | `/api/furn-naturals` | Per-type natural-orientation overrides |
| `POST` | `/api/render-png/:file` | Re-render the QA preview PNG |

---

## Development cadence

- Run `npm start` (or `start.bat`) for a local server on `:3000`.
- Edit YAML / quest JSON — server hot-reloads quests on save through
  the editor PUT, and re-reads canonical-pieces.yaml on
  `POST /api/canonical-pieces/reload`. Direct file edits to other
  YAMLs require a server restart.
- Frontend changes: hard-refresh the browser (`Ctrl+Shift+R`) or
  bump the cache buster (`?v=N`) at the bottom of the HTML.
- Tests: `npm test` (Node test runner under `test/`).
