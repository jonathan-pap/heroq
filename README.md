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

- **`PROJECT_STRUCTURE.md`** — top-level project map + "I want to
  change X" cheat sheet.
- Each major folder has its own `README.md` with file-by-file detail:
  - [`public/`](public/README.md) — frontend code
  - [`data/`](data/README.md) — YAML + per-quest JSON
  - [`assets/`](assets/README.md) — PNG art
  - [`scripts/`](scripts/README.md) — offline tools
  - [`test/`](test/README.md) — unit tests
  - [`game/`](game/README.md) — shared rule modules
  - [`docs/`](docs/README.md) — design notes + backlog
