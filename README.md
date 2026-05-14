# heroq

HeroQuest 1989 / 2021 web recreation. Multiplayer WebSocket game,
authoring tools, and content pipeline — no build step, vanilla
Node.js + browser JS.

```
npm install
npm start         # → http://localhost:3000
```

| Surface | URL |
|---|---|
| Live game | `/` (or `/index.html`) |
| Map editor (quest authoring) | `/map-editor.html` |
| Builder (render playground) | `/builder.html` |

---

## Find things fast

- **[`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md)** — top-level
  project map + "I want to change X" cheat sheet.
- Each major folder has a dedicated reference doc (descriptive
  filenames, not `README.md`, so they can be cited by name):
  - [`public/FRONTEND.md`](public/FRONTEND.md) — three browser
    surfaces (game / map editor / builder), region maps per JS file
  - [`data/SCHEMAS.md`](data/SCHEMAS.md) — every YAML, the
    `canonical-pieces.yaml` schema, per-quest JSON shape
  - [`assets/ART_INDEX.md`](assets/ART_INDEX.md) — PNG art layout,
    naming conventions, "how to add a new piece / token / tile"
  - [`scripts/TOOLS.md`](scripts/TOOLS.md) — offline build / extract
    / validate / render scripts
  - [`test/TESTS.md`](test/TESTS.md) — what each test file covers
  - [`game/RULES.md`](game/RULES.md) — shared rule modules
  - [`docs/INDEX.md`](docs/INDEX.md) — design notes + backlog index
