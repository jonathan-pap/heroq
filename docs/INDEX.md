# Documentation index (`docs/`)

> **Purpose:** Indexes the project's content docs (process, planning,
> long-form references). Folder-structure / "where does code live"
> docs are NOT here — they sit alongside the code they describe (see
> the per-folder reference docs below).
>
> **Related:**
> [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) (top-level map),
> [`docs/BACKLOG.md`](BACKLOG.md) (deferred work),
> [`docs/canonical-quests.md`](canonical-quests.md) (quest-design
> reference).

Use this folder for **content** docs (process, planning, design
notes). Per-folder structure / code-location docs live in each
folder's own descriptive doc:
[`public/FRONTEND.md`](../public/FRONTEND.md),
[`data/SCHEMAS.md`](../data/SCHEMAS.md),
[`assets/ART_INDEX.md`](../assets/ART_INDEX.md),
[`scripts/TOOLS.md`](../scripts/TOOLS.md),
[`test/TESTS.md`](../test/TESTS.md),
[`game/RULES.md`](../game/RULES.md).

---

## Files

| File | What it carries |
|---|---|
| `BACKLOG.md` | Captured improvements that aren't urgent. Newest items at the top. The single place to write down "we should come back to this." |
| `canonical-quests.md` | Quest-design reference — canonical board layout, room IDs, official quest book mappings. Used while authoring / converting quests. |

---

## When to add a file here

- **Design notes** that aren't about *where* something lives (which
  belong in the relevant folder's reference doc — `FRONTEND.md`,
  `SCHEMAS.md`, etc.) but about *why* it works the way it does.
- **Process docs** — release flow, conventions, agreed practices.
- **Long-form references** — rulebook clarifications, canonical-art
  notes, lore.

If it's a *navigation* doc (where do I look to change X?), it goes in
[`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) or the folder's
own reference doc instead — e.g.
[`public/FRONTEND.md`](../public/FRONTEND.md),
[`data/SCHEMAS.md`](../data/SCHEMAS.md).

---

## Editing the backlog

Add new entries at the top of [`BACKLOG.md`](BACKLOG.md). Each entry
has:

```markdown
## <Short title>

**Why:** one paragraph on the cost of not doing it.

**Proposed:** what we'd change.

**Implementation sketch:** numbered steps.

**Scope:** what's NOT in this first pass.
```

When an entry ships, move it out of [`BACKLOG.md`](BACKLOG.md) and
either delete it or fold the rationale into the relevant folder's
reference doc as historical context.
