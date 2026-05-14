# `game/combat.js` — combat dice

> **Purpose:** Canonical combat die (3 skulls / 2 hero shields / 1
> monster shield) + helpers to roll N dice. First step of the combat
> extraction — damage resolution + equipment / status modifiers
> still live in `server.js` and may move here later.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/util.js`](util.js) (general dice / utilities),
> [`server.js`](../server.js) (combat resolution still lives there).

---

## Exports

| Export | Signature | What |
|---|---|---|
| `DICE_FACES` | `['skull', 'skull', 'skull', 'heroShield', 'heroShield', 'monsterShield']` | Canonical face distribution. 3/2/1 per the 2021 rulebook. |
| `rollCombatDie` | `() → faceString` | Single combat die — returns one of the strings above. |
| `rollAttackDice` | `(n) → faceString[]` | Roll `n` combat dice. Used for both attack rolls (caller counts skulls) and defence rolls (caller counts the appropriate shield kind). |

---

## Examples

```js
const { rollAttackDice } = require('./game/combat');

// Attacker rolls 3 dice, defender rolls 2.
const atk = rollAttackDice(3);   // → ['skull', 'heroShield', 'skull']
const def = rollAttackDice(2);   // → ['monsterShield', 'skull']

// Count hits — skulls for the attacker, shields for the defender.
const hits   = atk.filter(f => f === 'skull').length;
const blocks = def.filter(f => f === 'heroShield' || f === 'monsterShield')
                  .length;
```

The dice are physically the same; the caller decides which faces
matter. A hero rolling defence counts `heroShield` faces; a monster
rolling defence counts `monsterShield` faces.

---

## What's NOT here (yet)

- **Effective combat dice** — base attack + equipment bonus + spell
  status modifiers. Currently in `server.js` (`EFFECTIVE COMBAT DICE`
  region around line 1762). Will move here on a future pass.
- **Damage resolution** — applying hits to body / mind, choosing
  shield kind, death checks. Currently in `server.js` (`COMBAT`
  region around line 1490).

Folding those in later turns this into a self-contained combat
module that the AI and the spell engine can both call.
