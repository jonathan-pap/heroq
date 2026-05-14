# `public/client/furniture-art.js` — PNG-based furniture + tile renderer

> **Purpose:** PNG-art path for furniture pieces and tile icons.
> Owns canonical-pieces hydration, furn-naturals overrides, the
> image caches, the alt-art toggle, and the per-art-set inset
> tables. Sits in front of [`furniture-draw.js`](furniture-draw.md) —
> if a PNG is loaded, it wins; otherwise the pixel-art fallback runs.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`data/pieces/canonical-pieces.yaml`](../../data/pieces/canonical-pieces.yaml) (source
> of truth fetched on boot),
> [`data/SCHEMAS.md`](../../data/SCHEMAS.md) (schema docs),
> [`public/map-editor.js`](../map-editor.js) (writes the
> furn-naturals + inset localStorage keys this module reads).

---

## Public surface — `window.HQFurnitureArt`

| Export | Signature | What |
|---|---|---|
| `init({ ctx, CELL, getLastView, drawBoard })` | once at boot | Stash deps + kick off `/api/canonical-pieces` + `/api/furn-naturals` fetches. |
| `isAltOn()` / `setAltOn(b)` | `() → bool` / `bool → void` | Read / write the `ALT_FURN_ON` preference. `setAltOn` persists to `localStorage.hq_furn_alt_v1` and triggers a redraw. |
| `getFurnImg(type)` | `→ { img, ready, natural } \| null` | Cache lookup. Null if `type` is unmapped. Async-loaded; check `.ready` before drawing. |
| `drawTileIcon(kind, px, py, pw, ph)` | `→ bool` | Paint a tile PNG (rubble / pit / spear / etc.). Returns `false` if no image (caller falls back). |
| `insetForBbox(cellsW, cellsH)` | `→ int (px)` | Furniture inset for a given footprint (small / linear / stair / block buckets). |
| `tileInsetForBbox(cellsW, cellsH)` | `→ int (px)` | Same as above but for tile icons (no `stair` bucket). |

---

## State owned

| State | Source | Notes |
|---|---|---|
| `FURN_FILE`, `FURN_ALT_FILE` | `/api/canonical-pieces` (fetched on init) | Hardcoded fallback keeps things rendering until the fetch lands. |
| `FURN_IMG`, `FURN_IMG_ALT` | Async PNG loads | Independent caches per art set, wiped + re-resolved when `applyCanonicalPieces` lands. |
| `TILE_IMG` | Async PNG loads | Maps `kind → { img, ready }`. |
| `FURN_NATURAL_OVERRIDES` | `/api/furn-naturals` + `localStorage.hq_furn_natural_overrides_v1` | Per-art-set natural orientation (key = `type` for canonical, `${type}:alt` for alt). |
| `ALT_FURN_ON` | `localStorage.hq_furn_alt_v1` | Toggleable via Options menu. |
| `FURN_INSETS_CANON`, `FURN_INSETS_ALT` | `localStorage.hq_furn_insets_v2`, `_alt_v1` | Per-bucket inset px (small / linear / stair / block). Editor sliders write these. |
| `TILE_INSETS` | `localStorage.hq_tile_insets_v1` | Tile-icon insets (small / linear / block). |

All localStorage keys are watched via `window.addEventListener('storage')`
so the editor's playground panel live-updates the running game in another tab.

---

## Wiring

```js
// public/client.js
HQFurnitureArt.init({
  ctx, CELL,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
});
const { getFurnImg, drawTileIcon, insetForBbox } = HQFurnitureArt;
// Options menu alt-art toggle:
HQFurnitureArt.setAltOn(!HQFurnitureArt.isAltOn());
```
