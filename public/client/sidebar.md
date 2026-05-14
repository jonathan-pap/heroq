# `public/client/sidebar.js` — right-rail tab panes

> **Purpose:** Spells / Items / Log panes for the right sidebar plus
> the Actions / Spells / Items / Log tab switcher. Counts on the tab
> buttons + the action-panel open buttons. Log auto-scrolls to the
> bottom on each repaint.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls `HQSidebar.renderSpells /
> renderItems / updateTabCounts / renderLog` from the game-render
> pass).

---

## Public surface — `window.HQSidebar`

| Export | Signature | What |
|---|---|---|
| `init({ getPendingSpell, onSpellClick, action })` | once at boot | Stash callbacks + wire the tab switcher. |
| `renderSpells(view)` | paint `#spells-body` | Cards for each spell in the current hero's `spellHand`, with `.active` on the armed one. Disabled when the action's already been used (unless the hero has `wand-of-recall`). |
| `renderItems(view)` | paint `#items-body` | Click → `action('useItem', { itemIndex: it.idx })`. |
| `renderLog(view)` | paint `#log` | One `.entry` per `view.log` item, classed by `e.cls`. Auto-scrolls. |
| `updateTabCounts(view)` | badges | Updates `#spells-count` / `#items-count` (parenthesized count) + the open-button counters + `.empty` styling when 0. |
| `setSidebarTab(name)` | string → void | Programmatic switch — toggles `.active` on `#sidebar-tabs button` + `.hidden` on `[data-stab-content]`. |

---

## `init` deps

| Dep | Why |
|---|---|
| `getPendingSpell` | `renderSpells` highlights the currently-armed spell. |
| `onSpellClick` | `(spell, hero, view) → void` when a hand card is clicked. Owned by `client.js` because the target-pick flow walks the canvas. |
| `action` | `(name, extra)` server-action sender used by the Items pane. |

---

## When panes show empty copy

| Pane | "No X available right now." |
|---|---|
| Spells | Not your turn, current turn isn't a hero, or hero has no `spellHand`. |
| Items | Same conditions; or "Inventory is empty." if `inventory` is `[]`. |

---

## Wiring

```js
// public/client.js
HQSidebar.init({
  getPendingSpell: () => pendingSpell,
  onSpellClick:    (sp, h, view) => onSpellClick(sp, h, view),
  action,
});
// inside renderGame:
HQSidebar.renderSpells(view);
HQSidebar.renderItems(view);
HQSidebar.updateTabCounts(view);
// once per render at the end:
HQSidebar.renderLog(view);
```
