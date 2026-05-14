# `public/client/entity-draw.js` — entity canvas painters

> **Purpose:** One pure canvas helper per entity kind — treasure
> markers, secret doors, traps, heroes, monsters. Sprite-preferred
> with pixel-art fallbacks; nothing mutates outside the canvas
> context.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client/sprites.js`](sprites.js) (the mutable sprite caches
> this module reads), [`public/client/furniture-art.js`](furniture-art.js)
> (`drawTileIcon` for trap PNGs).

---

## Public surface — `window.HQEntityDraw`

| Export | Signature | What |
|---|---|---|
| `init({ ctx, CELL, sprites, drawTileIcon })` | once at boot | Stash deps (see below). |
| `drawTreasure(t)` | `treasure → void` | Small gold dot + ★ glyph at the cell centre. |
| `drawSecretDoor(d)` | `door → void` | Dashed purple line across the edge between `d.a` and `d.b`. |
| `drawTrap(tr)` | `trap → void` | PNG icon (preferred) or pit-circle / X-cross fallback. `gmOnly` traps render at 0.45 alpha. |
| `drawHero(h, isCurrent)` | `(hero, bool) → void` | Variant token (preferred) or coloured circle + glyph. Yellow ring when current. Skips dead heroes. |
| `drawMonster(m, isSelected)` | `(monster, bool) → void` | Token (preferred) or coloured diamond + glyph. Red ring when selected. Wounded monsters get a body HP bar. |

---

## `init` deps

| Dep | What |
|---|---|
| `ctx` | 2D canvas context. |
| `CELL` | Px per cell. |
| `sprites` | `{ monsterSprites, heroSprites, variantKey }` — captured by reference so async PNG loads keep updating the same maps. |
| `drawTileIcon` | `(kind, px, py, pw, ph) → bool` (forwarded to `HQFurnitureArt.drawTileIcon`). |

---

## Wiring

```js
// public/client.js
HQEntityDraw.init({
  ctx, CELL,
  sprites: { monsterSprites, heroSprites, variantKey },
  drawTileIcon: HQFurnitureArt.drawTileIcon,
});
// inside drawBoard:
for (const t of view.treasures) HQEntityDraw.drawTreasure(t);
for (const d of view.secretDoors) HQEntityDraw.drawSecretDoor(d);
for (const tr of view.traps) HQEntityDraw.drawTrap(tr);
for (const h of view.heroes) HQEntityDraw.drawHero(h, ...);
for (const m of view.monsters) HQEntityDraw.drawMonster(m, ...);
```
