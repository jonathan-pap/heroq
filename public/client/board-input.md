# `public/client/board-input.js` — canvas hover/click + tooltip

> **Purpose:** Wires `mousemove` / `mouseleave` / `click` on the board
> canvas, picks a CSS cursor based on what's under the pointer,
> surfaces a floating `.hover-tip` tooltip with monster / hero stats
> or move cost, and dispatches the right server action on click.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls `HQBoardInput.init` once at
> boot; the canvas renderer reads the same `hoverCell` /
> `lastReachable` / `selectedGMMonsterId` state via the accessors
> passed to `init`).

---

## Public surface — `window.HQBoardInput`

| Export | Signature | What |
|---|---|---|
| `init(deps)` | once at boot | Wire canvas listeners + stash all the cross-module accessors (see below). |
| `statLine(o)` | `entity → string` | Formats a stat line like `Body 4/6 · Mind 2/2 · A2 D1 · Mv8`. Exposed for callers that want the same format. |
| `showTooltip(e, text)` / `moveTooltip(e)` / `hideTooltip()` | DOM helpers | Manual control over the floating tooltip. |

---

## `init` deps

| Dep | What | Why |
|---|---|---|
| `canvas` | the `<canvas>` element | Listener target. |
| `screenToCell` | `(MouseEvent) → [x, y]` | Maps mouse coords to grid cells (handles the camera transform). |
| `drawBoard` | `view → void` | Redraw on hover / cancel / mouseleave. |
| `getLastView` | `() → view` | Read the current view in handlers. |
| `getLastReachable` | `() → { dist, prev } \| null` | Reachable-cells map (for "Move (N sq)" tooltip + cursor choice). |
| `getPendingSpell` | `() → spell \| null` | If set, board clicks become spell-target picks. |
| `setPendingSpell` | `spell \| null → void` | Click-elsewhere cancels the picker. |
| `getHoverCell` | `() → [x, y] \| null` | Read by the canvas renderer (drawHoverPath). |
| `setHoverCell` | `[x, y] \| null → void` | Updated on mousemove / mouseleave. |
| `getSelectedGMMonsterId` | `() → id \| null` | GM-human-mode click dispatches. |
| `sendCast` | `(spellId, target) → void` | Spell cast action sender. |
| `action` | `(name, extra)` | Generic action sender (attack / moveTo). |
| `send` | `(obj)` | Raw WS send (used for `disarmTrap` / `gmAttack` / `gmMove`). |

---

## Hover cursor / tooltip table

When `view.myTurn && currentTurn.kind === 'hero'`:

| Cell under pointer | Cursor | Tooltip |
|---|---|---|
| Adjacent monster | `crosshair` | "Attack X — Body Y/Z · …" |
| Non-adjacent monster | `help` | "X — Body Y/Z · …" |
| Other hero on cell | `help` | "X — Body Y/Z · …" |
| Adjacent revealed trap | `help` | "Disarm <type> trap" |
| Reachable cell (`d>0`) | `pointer` | "Move (N sq)" |
| Reachable cell (`d=0`) | `default` | _hidden_ |
| Unreachable | `not-allowed` | _hidden_ |

When it's not your turn (or you're the GM), hovering a monster or
hero still surfaces their stats card (no cursor change).

---

## Click dispatch order (your turn, kind === 'hero')

1. If `pendingSpell` is set → resolve target, send `cast`. Clicking
   off-target cancels the picker.
2. Click an adjacent revealed trap → `confirm()` → `disarmTrap`.
3. Click a monster → `attack` (server validates range / LOS).
4. Otherwise → `moveTo` (server walks BFS path, halts on traps /
   encounters / out-of-MP).

GM-human mode: click a monster glyph in the GM pane to select, then
click a cell — adjacent hero → `gmAttack`, else `gmMove`.
