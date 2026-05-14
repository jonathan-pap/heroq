# `public/client/options.js` — UI chrome + Options ⚙ menu

> **Purpose:** Three closely-coupled UI-chrome concerns bundled
> together: per-panel collapse state, rails-hidden toggle, and the ⚙
> dropdown menu. Also owns three boolean preferences read by the
> canvas renderer (`floorTexturesOn`, `lightWallsOn`, `outerWallsOn`)
> with cross-tab live sync.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (`initGameUIChrome` calls
> `mountPanelCollapse` / `applyRailsHidden` / `mountOptionsMenu`;
> `drawWalls` reads `lightWallsOn / outerWallsOn`; `drawTile` reads
> `floorTexturesOn`).

---

## Public surface — `window.HQOptions`

| Export | Signature | What |
|---|---|---|
| `init({ send, getLastView, drawBoard })` | once at boot | Wire the cross-tab `storage` listener + the header rails-toggle button. |
| `floorTexturesOn() / lightWallsOn() / outerWallsOn()` | `() → bool` | Preference getters. Read by the renderer. |
| `mountPanelCollapse()` | `() → void` | Wire each `.panel > h3` for collapse/expand. Idempotent. |
| `applyRailsHidden(hidden)` | `bool → void` | Toggle the `.rails-hidden` class on `.game-layout` + flip the header button's label. |
| `mountOptionsMenu()` | `() → void` | Wire the ⚙ button + dropdown. Idempotent (uses `_wired` flag). Re-parents the menu under `<body>` to escape the parchment's mix-blend stacking context. |
| `syncFromView(view)` | `view → void` | Refresh option-toggle dots from current state. Call once per render. |
| `RAILS_STATE_KEY` | string | Exposed so `initGameUIChrome` can read it on first game-screen render (matches original behavior). |

---

## State owned

| State | Source | Notes |
|---|---|---|
| `FLOOR_TEXTURES_ON` | `localStorage.hq_floor_textures_v1` | Default ON. Mutated by ⚙ menu. |
| `LIGHT_WALLS_ON` | `localStorage.hq_light_walls_v1` | Default ON (cream stones). Mutated by ⚙ menu + cross-tab `storage` event from the map editor. |
| `OUTER_WALLS_ON` | `localStorage.hq_outer_walls_v1` | Default ON. Mutated by ⚙ menu + cross-tab `storage`. |
| `collapsedPanels` | `localStorage.hq_panel_collapsed_v1` | `Set<string>` of collapsed-panel ids. |

The rails-hidden state is NOT cached in JS — it lives entirely as the
`.rails-hidden` class on `.game-layout` and the `RAILS_STATE_KEY`
localStorage entry.

---

## ⚙ menu items

| `data-opt` | What it does |
|---|---|
| `hide-rails` | Same as the header "Hide rails" button. |
| `floor-textures` | Toggle the room-texture overlay. |
| `light-walls` | Cream filled walls vs legacy dark stroke. |
| `outer-walls` | Draw walls between revealed cells and the map edge / unrevealed neighbours. |
| `alt-furn` | Delegates to `HQFurnitureArt.setAltOn`. |
| `zargon-speed` | Cycle 1 → 2 → 3 → 4 → 1, sent via `{ type: 'setAiSpeed', value }`. |
| `leave-quest` | `confirm()` then `{ type: 'leaveQuest' }`. |

---

## Wiring

```js
// public/client.js
HQOptions.init({
  send,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
});
function initGameUIChrome() {
  HQOptions.mountPanelCollapse();
  HQOptions.applyRailsHidden(localStorage.getItem(HQOptions.RAILS_STATE_KEY) === '1');
  HQOverlays.mountHandOverlays();
  HQOptions.mountOptionsMenu();
}
// inside renderGame:
HQOptions.syncFromView(view);
// inside drawWalls / drawTile:
if (HQOptions.floorTexturesOn()) return;
const lightOn = HQOptions.lightWallsOn();
if (isOuter && !HQOptions.outerWallsOn()) continue;
```
