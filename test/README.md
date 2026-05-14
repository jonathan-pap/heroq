# `test/` — Unit tests

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
