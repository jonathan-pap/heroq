# `scripts/` — Offline tools

CLI utilities for building, extracting, validating, and rendering.
None of these are required at runtime — `server.js` boots without
running any of them. They exist to bootstrap data and check
consistency.

Run any with `node scripts/<name>.js` from the repo root.

---

## Build / install

| Script | What it does | Inputs / outputs |
|---|---|---|
| `build-quest1-from-xml.js` | Convert a heroscribe XML quest into our JSON shape (canonical-pieces footprints applied, monsters & traps mapped, naturals resolved). | In: `assets/maps/HQBase-NN-*.xml`. Out: `data/quests/<id>.json`. |
| `install-canonical-batch.js` | Run the XML→JSON converter across a list of quests in one go. | Reads `data/canonical-quests-meta.yaml`. |
| `install-canonical-q01.js` / `q02` / `q03` | One-off install scripts retained for reference. | Per-quest fixups. |
| `dump-q1-pieces.js` | Print the pieces of Quest 1 grouped by type — used while debugging XML conversion. | Stdout only. |
| `fetch-heroscribe-icons.js` | Pull canonical heroscribe PNGs from their public CDN. | Writes into `assets/furniture/`, `assets/tiles/`, `assets/monsters/`. |

---

## Board / texture extraction

| Script | What it does | Inputs / outputs |
|---|---|---|
| `extract-board-from-mask.js` | Walks `assets/board/board3.png` (red-mask reference) and emits `data/board.yaml` with room cell-lists + corridor cells. Primary path. | In: `board3.png`. Out: `data/board.yaml`. |
| `extract-board-from-jpg.js` | Older path — detects rooms from a photo `assets/board/board.jpg`. Less reliable, kept as fallback. | In: `board.jpg` or `board2.png`. Out: `data/board.yaml`. |
| `extract-board.js` | Wrapper script that picks between the two extractors. | Calls one of the above. |
| `extract-floor-tiles.js` | Crops small floor-texture samples from `board2.png` for use in the texture pipeline. | In: `board2.png`. Out: PNGs under `assets/floors/`. |
| `extract-room-floors.js` | Cell-aligned crop of each room from `board_v2.png` → per-room PNGs + a manifest (`_index.json`). Used by the builder + originally by the game. | In: `board_v2.png`. Out: `assets/floors/r<NN>.png`, `assets/floors/playable.png`, `assets/floors/_index.json`. |

---

## Validation & rendering

| Script | What it does |
|---|---|
| `validate-quests.js` | Walks `data/quests/*.json` and checks: piece footprints match `canonical-pieces.yaml`, all cells are in-bounds, no overlapping furniture, monster types are known, etc. Called automatically at server boot — warnings only, never throws. |
| `render-quest-maps.js` | Renders a QA preview PNG of each quest using `canvas` (Node) — same colour palette as the editor. Output is `assets/map_qa/quest<N>-<slug>.png`. Re-run after edits via the editor's "Re-render PNG" button (which POSTs `/api/render-png/<file>`). |
| `fix-stair-cells.js` | One-off data migration script — fixes legacy `stairCells` fields. Kept for reference; safe to delete once no quest still needs it. |

---

## Misc / Windows

| File | Purpose |
|---|---|
| `audit-projects.ps1` | PowerShell — local audit script. Not used by the runtime. |
| `upgrade-node.ps1` | PowerShell — Node-version bootstrap. See `UPGRADE_NODE.md`. |

---

## Common workflows

**Re-extract the board from the canonical red-mask reference:**
```
node scripts/extract-board-from-mask.js
```

**Regenerate floor textures after replacing `board_v2.png`:**
```
node scripts/extract-room-floors.js
```

**Validate all quests:**
```
node scripts/validate-quests.js
```
(Or just start the server — validator runs at boot.)

**Re-render a single quest's QA PNG:**
Open the editor → load the quest → click "Re-render PNG". Or POST
`/api/render-png/<file>` directly.

---

## Adding a new script

Keep it self-contained — no shared utility module yet. The
`extract-*` scripts already follow a similar shape:
1. Load the source asset (YAML or PNG).
2. Process.
3. Write the output explicitly.
4. Log a summary line.
