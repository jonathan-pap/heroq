# `public/` — Browser code

All frontend code is here. Served as-is by `server.js` (no build
step). Each top-level HTML page is a self-contained surface with its
own CSS + JS.

---

## Surfaces

| HTML | JS | CSS | Purpose |
|---|---|---|---|
| `index.html` | `client.js` | `styles.css` | **Live game** — multiplayer game UI, the thing players see. |
| `map-editor.html` | `map-editor.js` | `map-editor.css` | **Map editor / tool** — quest authoring: place / drag / flip pieces, tune naturals & insets, save back to quest JSON. |
| `builder.html` | `builder.js` | `builder.css` | **Builder** — layered-render playground: textures, walls, edge logic. Used to prototype the rendering system before changes land in the game. |
| `lobby-mockup.html` | (inline) | `styles.css` | Static lobby mockup — no logic. |
| `gui-mockup.html` | (inline) | `styles.css` | Static UI mockup. |
| `wireframes.html` | (inline) | `styles.css` | Layout sketches. |

Cache busters at the bottom of each HTML page (`<script src="X.js?v=N">`)
— bump `N` whenever you change the JS so browsers don't serve stale.

---

## Subfolders

| Path | Content |
|---|---|
| `shared/` | Modules loaded by multiple surfaces. `rules.js` is the canonical adjacency + wall logic used by both the editor's hover-path preview and the game's reachability. |
| `mocks/` | Static HTML mockups used during UI design phases. Not interactive. |

---

## Client-side architecture (`client.js`)

Single-file vanilla JS. Loaded once on `index.html`, opens a WebSocket
back to `server.js`, receives `view` snapshots, renders to
`<canvas id="board">`.

### Region map (grep for the comment headers)

| Region | Roughly what's there |
|---|---|
| Top constants | `CELL`, sprite caches, monster / hero PNG mappings, `FURN_FILE` (now sourced from `/api/canonical-pieces`). |
| `loadAllSprites()` | One-shot async load of monsters / heroes at boot. |
| WebSocket bootstrap | `wsURL()` / connect / message handler. |
| `renderLobby` / `renderGame` | DOM-side rendering of the room + game screens. |
| `wireOptionsMenu` | The ⚙ dropdown — Hide rails / Floor textures / Light walls / Outer walls / Alt furniture art / Zargon speed / Leave Quest. |
| `drawBoard` | Canvas render entry point. Calls `drawTile`, `drawFloorTextures`, `drawWalls`, `drawDoor`, `drawFurniturePiece`, `drawHero`, `drawMonster`, … |
| `getFurnImg` / `applyCanonicalPieces` | Furniture image cache + alias resolution. Two parallel caches (canonical / alt) so the toggle is instant after first load. |
| `drawFurniturePiece` | Per-piece bbox + flip + facing. Reads `_altFlipH/V` when `ALT_FURN_ON`. |
| `drawWalls` | Cream-filled rectangles (light) or dark strokes (legacy). Gates `!n` board-edge walls behind `OUTER_WALLS_ON`. |

### Preferences (localStorage)

All persisted as `'1'` / `'0'` strings. Listed in
`PROJECT_STRUCTURE.md`. Cross-tab live sync via the `storage` event.

---

## Editor architecture (`map-editor.js`)

Loads `/api/board`, `/api/quests`, `/api/canonical-pieces`, plus the
`/api/furn-naturals` overrides. State lives in a single `state`
object. Mouse / keyboard interactions live in the
`onCanvasMouseDown` / `onKeyDown` block.

### Region map

| Region | Roughly what's there |
|---|---|
| Constants + palette | `C` colour table, `CELL`, `COLS`, `ROWS`, `PAD_L/T`. |
| `FURN_FILE_BUILTIN` / `FURN_ALT_FILE` | Now populated by `applyCanonicalPieces(yaml)` from the server. `FURN_FILE_FALLBACK` keeps things rendering before the fetch lands. |
| `FURN_INSETS_CANON` / `_ALT` + `activeInsets()` | Two parallel inset sets keyed by art mode. Sliders write to the active set. |
| `getFurnImg` / `drawFurnIcon` | Same alias/file/natural pattern as the game. |
| `loadBoard()` | Fetches the master board and pre-computes `state.roomBbox`. |
| `loadList()` / `loadQuest()` | Quest index + opening a specific quest JSON. |
| `pickAt(c, r)` | Hit-test order: monster → treasure → trap → door → secretDoor → furniture → blocked. |
| `moveEntityTo()` | Drag handler. Special-cases blocked (tuple ref) BEFORE the `ref.at` branch because arrays have `.at`. |
| `rotateFurniture` | Updates `f.facing` AND swaps `f.cells` for transverse rotations. |
| `flipSelection` | Per-art-set flip: writes to `_altFlipH/V` when `ALT_FURN_ON`. |
| `renderNaturalList` | Dedupes aliases by file so changing `alchemist-bench` propagates to `alchemist-table` + `alchemists-bench`. |
| `drawBoard()` | Render pipeline: floor textures → blocked → walls + outer frame → furniture → monsters / treasure / traps → coords → start cells → hero tokens → grid. |

---

## Builder architecture (`builder.js`)

Layered-render playground. Pulls the same `/api/canonical-pieces` so
furniture renders consistently with the editor and game. Doesn't save
anything — purely a visual sandbox for rendering experiments.

---

## Adding a new top-level surface

1. New `<name>.html` with the standard `<canvas id="board">` shape.
2. New `<name>.js`, mirror the boot pattern from `builder.js`.
3. Add cache buster `<script src="<name>.js?v=1">`.
4. Optionally fetch `/api/canonical-pieces` for furniture parity.
