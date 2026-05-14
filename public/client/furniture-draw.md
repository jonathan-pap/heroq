# `public/client/furniture-draw.js` — pixel-art furniture primitives

> **Purpose:** Fallback canvas painters for 12 furniture pieces. Used
> when no PNG art is loaded for the piece (`HQFurnitureArt.getFurnImg`
> returned null or isn't `.ready` yet). Pure pixel-pushing — no game
> state, no facing transforms (callers wrap with `ctx.save / rotate /
> restore` for rotation).
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client/furniture-art.js`](furniture-art.js) (the PNG path
> this fallback complements), [`public/client.js`](client.js) (calls
> `HQFurnitureDraw.drawShape(...)` inside `drawFurniturePiece` /
> `drawFurniture` when the PNG isn't ready).

---

## Public surface — `window.HQFurnitureDraw`

| Export | Signature | What |
|---|---|---|
| `init({ ctx, CELL })` | once at boot | Stash drawing target. |
| `drawShape(kind, x, y, w?, h?)` | `(string, num, num, [num, num]) → void` | Single dispatcher across all 12 pieces. `w`/`h` default to `CELL`. |

---

## Pieces

| `kind` | Picture |
|---|---|
| `table` | Long wooden plank, leg dots at corners. |
| `chest` | Rounded-top box, brass band, gold lock. |
| `throne` | High arched back, red cushion, gold trim. |
| `tomb` / `sarcophagus` | Stone capsule + cross at head (long-axis aware). |
| `weapon-rack` | Bottom plank with vertical weapons of varying heights + axe head on rightmost. |
| `rack` (skull rack) | Two posts + multiple horizontal cross-bars + grid of skulls. |
| `bookcase` | 3 shelves of coloured book spines. |
| `alchemist-bench` / `alchemists-bench` | Long table with multiple coloured bottles. |
| `fireplace` | Grey stone surround, dark opening, orange + yellow flame. |
| `cupboard` | Two-door wardrobe with vertical seam + gold handles. |
| `sorcerer-table` / `sorcerers-table` | Dark purple table with arcane sigil. |
| _default_ (`block`, etc.) | Generic dark-brown rectangle (`drawGenericFurniture`). |

Legacy aliases route to the new names automatically.

---

## Wiring

```js
// public/client.js
HQFurnitureDraw.init({ ctx, CELL });
// inside drawFurniturePiece / drawFurniture:
HQFurnitureDraw.drawShape(type, px, py, pw, ph);
```
