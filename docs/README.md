# `docs/` — Project documentation

Markdown reference for the project. Use this folder for **content**
docs (process, planning, design notes). Per-folder structure /
code-location docs live in each folder's own `README.md` (see
`PROJECT_STRUCTURE.md` at the repo root).

---

## Files

| File | What it carries |
|---|---|
| `BACKLOG.md` | Captured improvements that aren't urgent. Newest items at the top. The single place to write down "we should come back to this." |
| `canonical-quests.md` | Quest-design reference — canonical board layout, room IDs, official quest book mappings. Used while authoring / converting quests. |

---

## When to add a file here

- **Design notes** that aren't about *where* something lives (which
  belong in the relevant folder's README) but about *why* it works
  the way it does.
- **Process docs** — release flow, conventions, agreed practices.
- **Long-form references** — rulebook clarifications, canonical-art
  notes, lore.

If it's a *navigation* doc (where do I look to change X?), it goes in
`PROJECT_STRUCTURE.md` or the folder's `README.md` instead.

---

## Editing the backlog

Add new entries at the top. Each entry has:

```markdown
## <Short title>

**Why:** one paragraph on the cost of not doing it.

**Proposed:** what we'd change.

**Implementation sketch:** numbered steps.

**Scope:** what's NOT in this first pass.
```

When an entry ships, move it out of `BACKLOG.md` and either delete it
or fold the rationale into the relevant folder README as historical
context.
