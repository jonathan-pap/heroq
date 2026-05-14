# `public/client/modals.js` — modal dialogs

> **Purpose:** Combat-result, treasure-card, end-of-quest, save-or-die,
> and restart dialogs. The renderer hands in a view-supplied
> combat / card object; this module paints + reveals; the dismiss
> button sends an action back to the server.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls `HQModals.showCombatModal(view.combat)`
> and `HQModals.showTreasureCardModal(view.revealedTreasureCard)` from
> the game-render pass).

---

## Public surface — `window.HQModals`

| Export | Signature | What |
|---|---|---|
| `init({ send, getLastView })` | once at boot | Wire all dismiss buttons. `getLastView()` is read by the end-modal restart (only the host restarts). |
| `showCombatModal(combat)` | `(snapshot) → void` | Paint attack + defend dice (`☠` / `❖` / `◆`), the summary line ("3 skulls − 2 blocks = 1 damage — Orc slain!"), and reveal. |
| `showTreasureCardModal(card)` | `(card) → void` | Paint card name + flavour, reveal. |

---

## Modals owned

| Modal id | Dismiss action sent |
|---|---|
| `combat-modal` | `{ type: 'action', action: 'dismissCombat' }` |
| `treasure-modal` | `{ type: 'action', action: 'dismissTreasureCard' }` |
| `end-modal` | host-only: `{ type: 'restart' }` |
| `save-decline` | `{ type: 'action', action: 'choosePotion', idx: -1 }` |
| `btn-restart` | `{ type: 'restart' }` |

---

## Dice glyph table

| `combat.attackDice[i]` / `combat.defendDice[i]` | Glyph |
|---|---|
| `skull` | `☠` |
| `heroShield` | `❖` |
| `monsterShield` | `◆` |

---

## Wiring

```js
// public/client.js
HQModals.init({ send, getLastView: () => lastView });
```
