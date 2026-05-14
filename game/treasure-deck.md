# `game/treasure-deck.js` — treasure-deck draw + card resolution

> **Purpose:** Draw the next treasure-deck card for a searching hero
> and apply its effect (gold / potion / trap / wandering monster /
> nothing).
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/util.js`](util.js) (`shuffle` + `rollD6`),
> [`game/los.js`](los.js) (`tileAt` + `occupantAt`),
> [`server.js`](../server.js) (`logEvent`, `MONSTER_TYPES`,
> `resolveAttack`, `checkEndConditions` are injected),
> [`data/cards/treasure.yaml`](../data/cards/treasure.yaml) (card
> templates).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `drawTreasureCard` | `(room, hero, deps) → card \| null` | Pop the next card off the deck (re-shuffle discard if empty), record + apply the effect. |
| `applyTreasureCard` | `(room, hero, card, deps) → void` | Per-effect mutation. Exported for tests / replays. |
| `adjacentFreeCells` | `(s, at) → cell[]` | Same-room/corridor empty neighbours of `at`. Used by the wandering-monster effect. |

---

## `deps` contract

| Dep | What | Notes |
|---|---|---|
| `logEvent` | `(room, text, cls?)` | Narration line. |
| `MONSTER_TYPES` | stats table from `data/units/monsters.yaml` | Reassigned by `loadGameData()`; must be live. |
| `resolveAttack` | `(room, attacker, defender)` — single attack resolution | Stays in `server.js` because it touches the full combat / status / death chain. |
| `checkEndConditions` | `(room) → bool` | Promote winner / defeat after the card resolves. |

---

## Effect handlers

| `effect` | Mutates | Notes |
|---|---|---|
| `gold` | `hero.gold` | Adds `card.amount`. |
| `goldDiceTimesTen` | `hero.gold`, optional `hero.status.skipNextTurn` | Rolls 1 d6, adds 10× the roll. May "miss next turn" via `sideEffect`. |
| `keepPotion` / `keepConsumable` | `hero.inventory` | Pushes `{ id, name, use, amount, bonus }`. |
| `nothing` | — | Just logs. |
| `trapArrow` | `hero.body` | `-card.damage` (defaults to 1). |
| `trapPit` | `hero.body`, `hero.status.skipNextTurn` | `-card.damage` AND miss next turn. |
| `wanderingMonster` | `state.monsters[]`, calls `resolveAttack` | Spawns the quest's `wanderingMonster` on a free cell adjacent to the hero, then resolves a single attack immediately ("attacks immediately" per the card). |

`card.returnToDeck` (or default discard unless `card.keep`) pushes the
card onto `state.treasureDiscard`. When the deck empties, the next
draw reshuffles the discard pile back in.

---

## Examples

```js
// server.js wrapper
const td = require('./game/treasure-deck');
function drawTreasureCard(room, hero) {
  return td.drawTreasureCard(room, hero, {
    logEvent, MONSTER_TYPES, resolveAttack, checkEndConditions,
  });
}
```

```js
// Hero search action — server.js
function handleSearchForTreasure(room, hero) {
  if (s.searchedTreasure[hero.id]?.[hero.roomId]) return; // one per room
  const card = drawTreasureCard(room, hero);
  if (card) markRoomSearched(s, hero);
}
```

---

## What's NOT here

- **The search action wrapper** (which room are we in, has this hero
  already searched this room, is the room clear of monsters) stays
  in `server.js` — see the `SEARCH` region.
- **`resolveAttack`** stays in `server.js`. It's the entry point to
  the full combat / damage / death chain; folding it in here would
  pull half the combat surface into a treasure module.
