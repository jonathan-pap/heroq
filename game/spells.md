# `game/spells.js` — spell-effect resolver

> **Purpose:** Apply the effect of a cast spell. Switches on the
> `spell.effect` string (the engine hook from
> `data/cards/spells.yaml`) and mutates state per the 2021 rules.
> Returns a boolean so the caller can spend the card only on success.
>
> **Related:** [`game/RULES.md`](RULES.md) (module index),
> [`game/los.js`](los.js) (line-of-sight gate),
> [`game/combat.js`](combat.js) (combat dice for damage spells),
> [`server.js`](../server.js) (wraps `applySpellEffect` and keeps
> `handleCastSpell` — the WebSocket entry with spell-hand / Wand of
> Recall / broadcast plumbing),
> [`data/cards/spells.yaml`](../data/cards/spells.yaml) (spell
> templates).

---

## Exports

| Function | Signature | What |
|---|---|---|
| `applySpellEffect` | `(room, caster, spell, target, deps) → bool` | Apply the spell. Returns `true` on success (caller spends the card), `false` when no valid target / out of LoS / wrong target kind. |
| `resolveTarget` | `(s, kind, t) → { kind, ref } \| null` | Look up the live hero / monster from the wire-format `{ kind, id }` payload. Filters dead pieces. |

---

## `deps` contract

| Dep | What | Notes |
|---|---|---|
| `logEvent` | `(room, text, cls?)` | Narration. State-mutating; lives in `server.js`. |
| `checkEndConditions` | `(room) → bool` | Run after damaging spells so a killed boss can promote `objectiveMet`. |

`lineOfSight` and `rollAttackDice` are imported directly from the
extracted modules — no need to inject.

---

## LoS gate

```js
if (tgt && spell.range !== 'anywhere' && spell.target !== 'self') {
  if (!lineOfSight(s, caster.at, tgt.ref.at)) {
    logEvent(room, '… no line of sight …');
    return false;
  }
}
```

`range: anywhere` (Genie summon, Fire of Wrath, etc.) is board-wide
and skips the LoS check. Self-target spells skip too.

---

## Effects covered

| `effect` | What | Notes |
|---|---|---|
| `healBody` | Restore Body, clamped to `bodyMax`. | Hero target only. |
| `doubleNextMovement` | Set `status.doubleNextMovement`. | Consumed by the next `rollHeroMovement`. |
| `passWalls` | Set `status.passWalls`. | Read by `passable` in `server.js` until end of movement. |
| `passOccupants` | Set `status.passOccupants`. | Same. |
| `bonusDefendUntilWounded` | Set `status.rockSkin`. | Broken by the first wound (in `resolveAttack`). |
| `bonusAttackUntilSafe` | Set `status.courage`. | +2 attack dice per `effectiveAttack`. |
| `skipNextTurn` | Set `status.skipNextTurn`. | Consumed at start-of-turn processing. |
| `directDamage` | Damage spell. Defender rolls `spell.defenceDice` to block; net damage applied. Writes `state.combat` so the UI shows the swing. Breaks rockSkin on hero defender wound. | Used by Fire of Wrath / Tempest / etc. |
| `sleep` | Defender rolls `mind` dice to resist. Any matching block face negates. | Cannot defend in subsequent combat until awakened. |
| `summonGenie` | 5-die Genie attack vs target. Same `state.combat` write-out as combat. | Range = anywhere. |

Unknown effects return `false` — the caller doesn't spend the card.

---

## State touched

`room.state.heroes / monsters` (body, dead, status flags),
`room.state.combat` (snapshot for the UI on damaging spells),
`room.state.log` (via `logEvent`), plus whatever
`checkEndConditions` mutates after a killing blow.

---

## Examples

```js
// server.js — handleCastSpell stays here, applies the effect via the
// extracted module:
const _spells = require('./game/spells');
function applySpellEffect(room, caster, spell, target) {
  return _spells.applySpellEffect(room, caster, spell, target, {
    logEvent, checkEndConditions,
  });
}
```

```js
// Direct call (no LoS gate needed for self-target):
applySpellEffect(room, wizard, SPELLS.tempest, { kind: 'monster', id: 'orc-3' });
// → rolls 1 damage vs orc, applies blocks from orc.defend, writes state.combat,
//   logs the swing, returns true.
```
