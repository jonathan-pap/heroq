# `public/client/furniture-art.js` — PNG-based furniture renderer

> **Purpose:** PNG-art path for furniture pieces (table / chest / throne
> / bookcase / etc.). Owns canonical-pieces hydration, furn-naturals
> overrides, the image caches, the shared alt-art toggle, and the
> per-art-set furniture inset tables. Sits in front of
> [`furniture-draw.js`](furniture-draw.md) — if a PNG is loaded, it
> wins; otherwise the pixel-art fallback runs.
>
> Overlay tiles (rubble / trap markers / stairway) live in the
> companion module [`tile-art.js`](tile-art.md). The `ALT_FURN_ON`
> preference is owned here; `HQTileArt` reads it via the `isAltOn`
> callback so the ⚙ menu's "Alt furniture art" toggle swaps both.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`data/pieces/canonical-pieces.yaml`](../../data/pieces/canonical-pieces.yaml) (source
> of truth fetched on boot),
> [`data/SCHEMAS.md`](../../data/SCHEMAS.md) (schema docs),
> [`public/map-editor.js`](../map-editor.js) (writes the
> furn-naturals + inset localStorage keys this module reads),
> [`public/client/tile-art.js`](tile-art.js) (sibling for overlay tiles).

---

## Public surface — `window.HQFurnitureArt`

| Export | Signature | What |
|---|---|---|
| `init({ ctx, CELL, getLastView, drawBoard })` | once at boot | Stash deps + kick off `/api/canonical-pieces` + `/api/furn-naturals` fetches. |
| `isAltOn()` / `setAltOn(b)` | `() → bool` / `bool → void` | Read / write the `ALT_FURN_ON` preference. `setAltOn` persists to `localStorage.hq_furn_alt_v1` and triggers a redraw. `HQTileArt` reads this getter at draw time so the toggle drives both art sets. |
| `getFurnImg(type)` | `→ { img, ready, natural } \| null` | Cache lookup. Null if `type` is unmapped. Async-loaded; check `.ready` before drawing. |
| `insetForBbox(cellsW, cellsH)` | `→ int (px)` | Furniture inset for a given footprint (small / linear / stair / block buckets). |

---

## State owned

| State | Source | Notes |
|---|---|---|
| `FURN_FILE`, `FURN_ALT_FILE` | `/api/canonical-pieces` (fetched on init) | Hardcoded fallback keeps things rendering until the fetch lands. |
| `FURN_IMG`, `FURN_IMG_ALT` | Async PNG loads | Independent caches per art set, wiped + re-resolved when `applyCanonicalPieces` lands. |
| `FURN_NATURAL_OVERRIDES` | `/api/furn-naturals` + `localStorage.hq_furn_natural_overrides_v1` | Per-art-set natural orientation (key = `type` for canonical, `${type}:alt` for alt). |
| `ALT_FURN_ON` | `localStorage.hq_furn_alt_v1` | Toggleable via Options menu. Read by `HQTileArt` too. |
| `FURN_INSETS_CANON`, `FURN_INSETS_ALT` | `localStorage.hq_furn_insets_v2`, `_alt_v1` | Per-bucket inset px (small / linear / stair / block). Editor sliders write these. |

All localStorage keys are watched via `window.addEventListener('storage')`
so the editor's playground panel live-updates the running game in another tab.

---

## Wiring

```js
// public/client.js — init order: HQFurnitureArt first, then HQTileArt
// which reads the alt-on getter.
HQFurnitureArt.init({
  ctx, CELL,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
});
const { getFurnImg, insetForBbox } = HQFurnitureArt;

// Options menu alt-art toggle:
HQFurnitureArt.setAltOn(!HQFurnitureArt.isAltOn());
```
