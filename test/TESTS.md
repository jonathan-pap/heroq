# Tests (`test/`)

> **Purpose:** Quick reference for every test file — what it covers,
> how to run a single test, conventions for new tests.
>
> **Related:**
> [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) (top-level map),
> [`game/RULES.md`](../game/RULES.md) (the rule modules these tests
> exercise),
> [`scripts/TOOLS.md`](../scripts/TOOLS.md) (`validate-quests.js` is
> exercised by `quest-schema.test.js`).

Node.js built-in test runner (`node --test`). Run via `npm test`.

---

## Files

| Test file | Covers |
|---|---|
| `rules.test.js` | Combat dice rules, adjacency, line-of-sight, wall logic. |
| `line-of-sight.test.js` | LoS edge cases (corner peeks, blocked-by-furniture, fog-revealing). |
| `fog.test.js` | Fog-of-war reveal rules (room reveal on entry, corridor look-ahead, monster-activation triggers). |
| `activation.test.js` | Monster activation rules — when monsters wake on hero entry. |
| `bot-decisions.test.js` | Zargon AI: target prioritisation, movement choice, attack pick. |
| `quest-schema.test.js` | Per-quest JSON validation: required fields, type coverage, in-bounds cells, footprint match against `canonical-pieces.yaml`. |
| `combat.test.js` | [`game/combat.js`](../game/combat.js) — dice distribution, effective attack/defend/move modifiers, full `resolveAttack` pipeline (drink-to-save, lost artifacts, status decay, snapshot). |
| `spells.test.js` | [`game/spells.js`](../game/spells.js) — `resolveTarget` lookup, every `applySpellEffect` branch (healBody / buff statuses / directDamage / sleep / summonGenie), LoS gate behaviour. |
| `traps.test.js` | [`game/traps.js`](../game/traps.js) — spear (skull / shield), pit, block trap branches with side effects (`status.inPit`, permanent rubble cell, halt / endsTurn flags). |
| `treasure-deck.test.js` | [`game/treasure-deck.js`](../game/treasure-deck.js) — deck reshuffle on empty, every card effect (gold / dice×10 / keep / nothing / arrow / pit / wandering), `adjacentFreeCells` rules. |

---

## How to run

```
npm test
```

Single file:
```
node --test test/rules.test.js
```

---

## Conventions

- Tests import directly from `server.js`, `bots.js`, `game/*.js`, and
  `scripts/validate-quests.js`. No mocking framework.
- Each test file is independent — no shared setup.
- New tests follow the same `describe` / `test` shape Node's built-in
  runner uses.

---

## Adding a test

1. Drop a new file under `test/` named `<thing>.test.js`.
2. `npm test` picks it up automatically.
3. If your test needs quest-shape data, lift a small fixture inline —
   don't depend on real `data/quests/*.json` files (they evolve).
