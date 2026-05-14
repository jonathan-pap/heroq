# `game/combat.js` — combat dice + damage resolution

> **Purpose:** Canonical combat die, dice-roll helpers,
> effective-dice resolvers (base + equipment + artifact + status),
> and the full damage-resolution pipeline (`resolveAttack`).
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/util.js`](util.js) (general dice / utilities),
> [`game/traps.js`](traps.js) (uses the combat dice),
> [`server.js`](../server.js) (wraps `resolveAttack` /
> `effectiveAttack` / `effectiveDefend` / `effectiveMoveDice` with
> the YAML data tables + log + end-condition helpers).

---

## Exports

| Export | Signature | What |
|---|---|---|
| `DICE_FACES` | `['skull', 'skull', 'skull', 'heroShield', 'heroShield', 'monsterShield']` | Canonical face distribution. |
| `rollCombatDie` | `() → faceString` | Single combat die. |
| `rollAttackDice` | `(n) → faceString[]` | Roll `n` combat dice. |
| `effectiveAttack` | `(hero, target, deps) → int` | Hero's attack dice count: base + weapon + artifact + status (incl. courage / one-shot / pit penalty). `target` is `null` for non-targeted contexts. |
| `effectiveDefend` | `(hero, deps) → int` | Hero's defend dice count: base + body armour + helmet + shield + utility + artifact + status (rockSkin / one-shot / pit). |
| `effectiveMoveDice` | `(hero, deps) → 1 \| 2` | How many d6 the hero rolls for movement (1 if wearing plate armour, otherwise 2). |
| `resolveAttack` | `(room, attacker, defender, deps)` | Full attack resolution — roll, count, damage, drink-to-save, artifact claim, status decay, log, end-conditions. |

---

## `deps` contract

All exports that take `deps` use the same shape:

| Dep | What | Why injected |
|---|---|---|
| `EQUIPMENT` | weapons / armour / shields / utility | YAML table; reassigned by `loadGameData()`. |
| `ARTIFACTS` | one-of-a-kind reward items | Same. |
| `MONSTER_TYPES` | monster name fallback for log lines | Same. |
| `logEvent` | `(room, text, cls?)` — narration | State-mutating (appends to `room.state.log`); lives in `server.js`. |
| `checkEndConditions` | `(room) → bool` — promote winner / defeat after an attack | Pulls in HEROES + SPELLS_BY_ELEMENT for between-quest restoration; stays in `server.js`. |

`effectiveMoveDice` only needs `EQUIPMENT`.
`effectiveAttack` / `effectiveDefend` need `EQUIPMENT` + `ARTIFACTS`.
`resolveAttack` needs everything.

---

## `resolveAttack` — what it does, in order

1. **Effective dice counts** for both sides (hero side uses
   `effectiveAttack` / `effectiveDefend`; monster side reads
   `attack` / `defend` directly).
2. **Roll** attacker + defender dice.
3. **Block face by side:** `heroShield` for hero defenders,
   `monsterShield` for monster defenders. A sleeping defender
   counts ZERO blocks (`d.status.sleeping`).
4. **Damage** = `max(0, skulls - blocks)`. Defender body clamped to 0.
5. **Drink-to-save** (hero, body == 0):
   - Exactly one healing-use potion → auto-drink, restore to
     `min(potion.amount || 4, bodyMax)`.
   - Multiple → set `state.pendingSaveRoll` for client modal; hero
     stays at body 0 until they pick.
6. **Death** (body == 0 and no save): `d.dead = true`.
7. **Lost artifacts** (hero death): each carried artifact pushed to
   `state.lostArtifacts`; equipment slots cleared. Logged as
   "Monsters claim the X! It will reappear in a future quest."
8. **Status decay:**
   - Sleeping defender → awake (`status.sleeping = false`).
   - Hero defender + damage > 0 + rockSkin → rockSkin broken.
   - Attacker one-shot bonus (`bonusAttackOnce`) → 0.
   - Defender one-shot bonus (`bonusDefendOnce`) → 0.
9. **Combat snapshot** `state.combat = { attacker, defender, attackDice,
   defendDice, skulls, blocks, damage, killed, sleeping, ts }`. The
   UI uses this to animate the swing.
10. **Log line** for the swing + kill notification if applicable.
11. **`checkEndConditions(room)`** — promote to winner / defeat /
    objectiveMet.

---

## Examples

```js
// server.js wrappers
const combat = require('./game/combat');

function effectiveAttack(hero, target) {
  return combat.effectiveAttack(hero, target, { EQUIPMENT, ARTIFACTS });
}
function effectiveDefend(hero) {
  return combat.effectiveDefend(hero, { EQUIPMENT, ARTIFACTS });
}
function effectiveMoveDice(hero) {
  return combat.effectiveMoveDice(hero, { EQUIPMENT });
}
function resolveAttack(room, attacker, defender) {
  return combat.resolveAttack(room, attacker, defender, {
    EQUIPMENT, ARTIFACTS, MONSTER_TYPES, logEvent, checkEndConditions,
  });
}
```

```js
// Hero attacks an orc
resolveAttack(
  room,
  { kind: 'hero',    ref: hero },
  { kind: 'monster', ref: orc }
);
```
