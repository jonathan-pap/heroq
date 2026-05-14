# Backlog

Captured improvements that aren't urgent but worth doing.
Newest items at the top.

---

## YAML consolidation for furniture (and eventually monsters / tiles)

**Why:** Adding a new furniture piece (or a new alt art variant) currently
requires editing five hardcoded tables across three frontend files:

| Table | Files | What it carries |
|---|---|---|
| `FURN_FILE` / `FURN_FILE_BUILTIN` | `public/client.js`, `public/map-editor.js`, `public/builder.js` | aliases → PNG filename + natural orientation |
| `FURN_ALT_FILE` | same three files | aliases → alt-art PNG filename |
| `FURN_NATURAL` (rotation footprints) | `public/client.js` | type → w × h (overlaps with `data/canonical-pieces.yaml`) |

Drift is inevitable. The existing `data/canonical-pieces.yaml` already
defines piece footprints + anchors and is consumed by the XML→JSON
converter and the quest validator — but NOT by the runtime.

**Proposed schema** — extend `canonical-pieces.yaml`:

```yaml
pieces:
  AlchemistsBench:
    natural: { w: 3, h: 2 }
    anchor: TL
    file: AlchemistsBench.png
    altFile: Alchemist Bench-2x3.png
    naturalDir: upward
    aliases: [alchemist-table, alchemist-bench, alchemists-bench]
```

**Implementation sketch:**

1. Extend the YAML with `file` / `altFile` / `naturalDir` / `aliases`
   (preserve current XML/validator consumers).
2. Server exposes `/api/canonical-pieces` (reads the YAML at boot,
   hot-reloads on `loadQuests()` style file watch — quests already do
   this so the pattern is established).
3. Each frontend (`client.js`, `map-editor.js`, `builder.js`) fetches
   the data at boot, replaces its hardcoded tables. Falls back to
   shipped defaults if the fetch fails (so the editor still works
   offline against a static copy).
4. Update `scripts/validate-quests.js` to validate against the new
   richer schema.
5. **Adding a new piece** afterwards is a single YAML entry — all
   three surfaces pick it up on reload.

**Scope held back from the first pass:**
- `MONSTER_TYPE_FILE` (sprite mapping) — small, stable. Same pattern
  applies later if it starts drifting.
- `HERO_FILE` / hero variant tokens — same.
- `TILE_FILE` (rubble / trap PNGs) — same.

Roughly a couple hours of careful refactoring + manual test pass over
all three surfaces. Land as a single commit so the diff is reviewable.

---
