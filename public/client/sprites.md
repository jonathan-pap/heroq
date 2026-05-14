# `public/client/sprites.js` — monster + hero PNG loader

> **Purpose:** Per-type filename tables and the two mutable name → `Image()` caches
> the renderer reads to paint hero / monster tokens. PNG loads happen
> asynchronously; the renderer prefers the loaded sprite, with a glyph
> fallback for unmapped types.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client/entity-draw.js`](entity-draw.js) (reads the maps to
> paint hero / monster tokens),
> [`assets/heros/`](../../assets/heros/) + [`assets/monsters/`](../../assets/monsters/) (PNG sources).

---

## Public surface — `window.HQSprites`

| Export | Signature | What |
|---|---|---|
| `monsterSprites` | `{ [type]: HTMLImageElement }` | Mutable cache populated as `/assets/monsters/<Type>-Token.png` finish loading. |
| `heroSprites` | `{ [id\|variantKey]: HTMLImageElement }` | Hero default + per-variant. |
| `HERO_NAMES` | `{ barbarian: 'Barbarian', ... }` | Title-case names used in URLs + alt text. |
| `HERO_VARIANTS` | `['male', 'female']` | Variant suffix order. |
| `variantKey(id, variant)` | `→ 'barbarian:male'` etc. | Cache key for the per-variant slot. |
| `variantTokenURL(id, variant)` | `→ '/assets/heros/Barbarian-Male-Token.png'` | Lobby seat tokens. |
| `variantCardURL(id, variant)` | `→ '/assets/heros/Barbarian-Male-Card.png'` | Hover preview card. |
| `load({ onLoaded })` | once at boot | Kicks off all PNG fetches. `onLoaded` fires after each successful load so the renderer can redraw. |

---

## Alias handling

`MONSTER_TYPE_FILE` (internal) maps old-edition names to the 2021-renamed
tokens — `chaos-warrior` → `Dread-Warrior-Token.png`, `fimir` →
`Abomination-Token.png` — and named bosses (`verag`, `ulag`, `grak`,
`balur`, `witch-lord`) to their underlying creature art. The renderer
only sees one cache; quest JSON can use either edition's names.

---

## Wiring

```js
// public/client.js
const {
  monsterSprites, heroSprites,
  HERO_NAMES, HERO_VARIANTS,
  variantKey, variantTokenURL, variantCardURL,
} = window.HQSprites;
window.HQSprites.load({
  onLoaded: () => { if (lastView) drawBoard(lastView); },
});
```
