# `public/client/textures.js` — floor-texture overlay

> **Purpose:** Room + corridor PNG textures from
> `/assets/room_textures/` painted on top of the base canvas floor.
> Only revealed (fog-cleared) cells get painted — each room is one
> `drawImage` + `ctx.clip` across the union of its currently-visible
> cells; the corridor is one stretched blit clipped to revealed
> corridor cells.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls
> `HQTextures.drawFloorTextures(view, tm)` after the base tile pass in
> `drawBoard`), [`assets/room_textures/`](../../assets/room_textures/) (PNG sources).

---

## Public surface — `window.HQTextures`

| Export | Signature | What |
|---|---|---|
| `init(deps)` | once at boot | Stash deps (see below). |
| `drawFloorTextures(view, tm)` | `(view, tileMap) → void` | Paint over revealed cells. No-op if `isEnabled()` is false. Triggers a lazy `/api/board` fetch on first call to build the bbox cache. |

`tm` is the cached `tileMap(view)` from the renderer; currently unused
inside this module (kept in the signature for future per-tile lookups).

---

## `deps` contract

| Dep | What | Why |
|---|---|---|
| `ctx` | 2D canvas context | Drawing surface. |
| `CELL` | px per cell | Geometry. |
| `getLastView` | `() → view` | Async PNG loaders use this to trigger a redraw when an image finishes loading. |
| `drawBoard` | `view → void` | Same — called from the async callback. |
| `isEnabled` | `() → bool` | Gate the render on the `FLOOR_TEXTURES_ON` preference. |

---

## State (internal)

| Cache | Shape |
|---|---|
| `ROOM_TEX` | `{ [roomId]: { img, ready, error? } }` |
| `CORRIDOR_TEX` | `{ [file]: { img, ready, error? } }` |
| `ROOM_BBOX` | `{ [roomId]: { mc, mr, spanC, spanR } }` — fetched once from `/api/board` (lazy on first `drawFloorTextures` call). |

`FLOORS_VER = 3` is appended as `?v=3` to PNG URLs for cache-busting
when the texture set changes.

---

## Wiring

```js
// public/client.js
HQTextures.init({
  ctx, CELL,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
  isEnabled:   () => FLOOR_TEXTURES_ON,
});
// inside drawBoard:
HQTextures.drawFloorTextures(view, tm);
```
