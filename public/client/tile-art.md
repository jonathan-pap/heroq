# `public/client/tile-art.js` — overlay tile rendering

> **Purpose:** PNG-based rendering for overlay tiles — rubble, falling-
> block, trap markers (pit / spear / chest-trap), stairway, and any
> future overlay tokens. Companion to
> [`furniture-art.js`](furniture-art.md); they share only the
> `ALT_FURN_ON` preference (owned by `HQFurnitureArt`).
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`data/tiles/canonical-tiles.yaml`](../../data/tiles/canonical-tiles.yaml) (single source of truth for tile metadata),
> [`public/client/furniture-art.js`](furniture-art.js) (sibling, owns the shared alt-art toggle),
> [`public/client/entity-draw.js`](entity-draw.js) (calls `drawTileIcon` from inside `drawTrap`).

---

## Public surface — `window.HQTileArt`

| Export | Signature | What |
|---|---|---|
| `init({ ctx, CELL, getLastView, drawBoard, isAltOn })` | once at boot | Stash deps + kick off `/api/canonical-tiles` fetch. `isAltOn` is a callback that reads `HQFurnitureArt.isAltOn()` so the alt toggle stays shared. |
| `drawTileIcon(kind, px, py, pw, ph)` | `→ bool` | Paint a tile PNG. Returns `false` if no image (caller falls back to a glyph). |
| `tileInsetForBbox(cellsW, cellsH)` | `→ int (px)` | Inset in px for a given footprint (small / linear / block buckets). |

---

## State owned

| State | Source | Notes |
|---|---|---|
| `TILE_FILE`, `TILE_FILE_ALT` | `/api/canonical-tiles` (fetched on init) | Alias → PNG filename. Hardcoded fallback keeps things rendering until the fetch lands. |
| `TILE_IMG`, `TILE_IMG_ALT` | Async PNG loads | Independent caches per art set so toggling alt vs canonical doesn't blow away images already loaded on either side. |
| `TILE_INSETS` | `localStorage.hq_tile_insets_v1` | Per-bucket inset px (small / linear / block). Editor sliders write this key. Cross-tab synced via the `storage` event. |

---

## Alt art

When `isAltOn()` returns true **and** the tile has an `altFile` declared
in `canonical-tiles.yaml`, the alt PNG is used. Tiles without an alt
(falling-rock, pit, spear, chest-trap) keep their canonical art in
both modes. The currently-supported alt set:

| Tile | Canonical | Alt |
|---|---|---|
| `SingleBlockedSquare` (`rubble`) | `SingleBlockedSquare.png` | `Block-Square-Single.png` |
| `DoubleBlockedSquare` (`rubble-double`) | `DoubleBlockedSquare.png` | `Double-Block-Tile.png` |
| `Stairway` (`stairway`) | `Stairway.png` | `Stair-way.png` |

The toggle lives in `HQFurnitureArt` because the same preference flips
the furniture art set too — flipping the ⚙ menu's "Alt furniture art"
swaps both subsystems at once.

---

## Wiring

```js
// public/client.js — order matters: HQFurnitureArt must register first
// because HQTileArt reads its isAltOn at draw time.
HQFurnitureArt.init({ ctx, CELL, getLastView: () => lastView,
                      drawBoard: (v) => drawBoard(v) });
HQTileArt.init({
  ctx, CELL,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
  isAltOn:     () => HQFurnitureArt.isAltOn(),
});
const { drawTileIcon } = HQTileArt;

// public/client/entity-draw.js receives drawTileIcon at init time:
HQEntityDraw.init({
  ctx, CELL,
  sprites: { monsterSprites, heroSprites, variantKey },
  drawTileIcon: HQTileArt.drawTileIcon,
});
```
