# `public/client/overlays.js` — hand overlays + mobile tabs

> **Purpose:** Two small UI subsystems bundled together because both
> are pure DOM event plumbing with no game-state interaction:
>
> 1. **Hand overlays** — Inventory and Spellbook open as a full-screen
>    modal-style overlay on click. Dismiss via `data-dismiss="<id>"`,
>    backdrop click, or Escape.
> 2. **Mobile tabs** — At ≤768px the right sidebar collapses into a
>    bottom drawer; each tab button sets `body[data-mtab]` which CSS
>    reads to reveal exactly one panel.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls `HQOverlays.mountHandOverlays()`
> on first game-screen render and `HQOverlays.mountMobileTabs()` once
> at boot).

---

## Public surface — `window.HQOverlays`

| Export | Signature | What |
|---|---|---|
| `mountHandOverlays()` | `() → void` | Wire `#btn-open-items` / `#btn-open-spells` + the document-level dismiss listeners. Idempotent — uses `_wired` flags. |
| `mountMobileTabs()` | `() → void` | Set initial `body[data-mtab='board']` + wire each `#mobile-tabs button`. Once at boot. |
| `setMobileTab(name)` | `string → void` | Programmatic tab switch. |

---

## Dismiss rules (hand overlays)

The document-level click listener resolves the target in priority order:

1. **`data-dismiss="<overlay-id>"`** on the clicked element (or any
   ancestor) → close that overlay by id.
2. **Click on the modal backdrop** itself (an element with class
   `.modal[data-dismissable]` where `event.target === overlayRoot`)
   → close that overlay.

Escape closes both `items-overlay` and `spells-overlay`.

---

## Wiring

```js
// public/client.js
HQOverlays.mountHandOverlays();   // first game render
HQOverlays.mountMobileTabs();     // boot
```
