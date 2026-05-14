# `public/client/lobby.js` — lobby + spell-draft picker

> **Purpose:** Everything visible before "Start quest". The lobby
> phase renders the quest picker, hero seats, GM-mode controls, the
> players list, and the spell-draft picker (wizard + elf pick 3 / 1
> elemental groups). All form-control listeners are wired once at
> boot; render is called from `applyState` on every `'lobby'` phase
> view.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls `HQLobby.render(view)`),
> [`public/client/sprites.js`](sprites.js) (variant token / card URLs
> + `HERO_NAMES` / `HERO_VARIANTS`),
> [`public/client/card-preview.js`](card-preview.js) (hover preview
> for each seat's variant card).

---

## Public surface — `window.HQLobby`

| Export | Signature | What |
|---|---|---|
| `init({ send, getLastView })` | once at boot | Wire all the form-control + button listeners (`gmMode` radios, `lobby-quest`, `opt-reveal-all`, `opt-autoroll`, `lobby-claim-gm`, `.seat-btn`, `btn-spell-suggested`, `btn-spell-reset`, `btn-start`). |
| `render(view)` | `view → void` | Re-paint everything from a view. |

---

## What `render(view)` paints

1. **Lobby code** — the room code at the top.
2. **Quest picker** — optgroup-split into "Quest Book" (main) vs
   "Sandbox / Tests" (`category === 'sandbox'`). Host-only.
3. **Quest intro + board label** — "Uses the default master board"
   or "Uses a custom board layout".
4. **Auto-roll** + **Reveal-all** options — host-only.
5. **GM mode** radios + **Take/Release GM seat** button + "Someone
   must take the GM seat" / "X will run the dungeon" copy.
6. **Hero seats** — four `.seat-btn` tiles. Each shows the printed-art
   badge + the chosen variant card; the seat-holder gets a Male /
   Female toggle (other players see the chosen art but can't change
   it).
7. **Players list** — host / GM / hero / offline tags via `makeTag`.
8. **Spell draft** — wizard picks 3 elemental groups, elf picks 1
   from the remaining (see below).
9. **Start button** — enabled when `host && heroesClaimed && gmOK
   && draftReady`. Hidden for non-hosts.
10. **`#lobby-msg`** — "Spell draft not finished — pick element
    groups or use the suggested split." (host-only, when draft
    isn't ready).

---

## Spell-draft phases

`view.spellDraft.phase` drives the status line + which tiles are
claimable:

| `phase` | Status line |
|---|---|
| `wizardFirst` | "— wizard picks first" |
| `elf` | "— elf picks" |
| `wizardOnly` | "— wizard picks N more" |
| `elfOnly` | "— elf picks one" |
| `done` (boolean) | "— draft complete" |
| `na` | hidden (no draft for this quest) |

Tiles are `.claimable` if it's the player's turn (`currentSeat`
matches their seat + the element isn't already taken). Click sends
`{ type: 'pickSpellElement', seat, element }`.

---

## Wiring

```js
// public/client.js
HQLobby.init({ send, getLastView: () => lastView });
// inside applyState, when view.phase === 'lobby':
HQLobby.render(view);
```
