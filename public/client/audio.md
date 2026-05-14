# `public/client/audio.js` — Web Audio SFX synth

> **Purpose:** All sound effects are oscillator-synthesized at call time —
> no MP3 / WAV assets to ship. Diffs each view's log + combat fields and
> plays exactly one SFX per new event.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client.js`](client.js) (calls `HQAudio.fireSfxFromView(view)`
> once per render and `HQAudio.reset()` on transition to lobby).

---

## Public surface — `window.HQAudio`

| Export | Signature | What |
|---|---|---|
| `sfx(name)` | `string → void` | Play a named effect. No-op if muted. |
| `fireSfxFromView(view)` | `view → void` | Walk new `view.log` entries (since high-watermark) + diff `view.combat.ts`, play one SFX per. |
| `reset()` | `() → void` | Clear the log-tracking watermark. Call when leaving the game screen. |
| `mount()` | `() → void` | Install the floating 🔊 / 🔇 corner toggle button. |

---

## SFX names

`roll`, `doorOpen`, `combatHit`, `combatMiss`, `kill`, `heroFall`,
`victory`, `defeat`, `spellCast`, `reveal`, `treasure`, `bossReveal`.

Each name is a short oscillator sequence (frequency, duration, type,
volume, delay) — see the `sfx` switch for the exact note table.

---

## State

| State | What |
|---|---|
| `audioEnabled` | Persists in `localStorage.hq_audio` (`'1'` / `'0'`). Defaults on. |
| `audioCtx` | Single `AudioContext`, lazily created on first use, auto-resumed on each call (browsers suspend until user-gesture). |
| `_audioLastLogLen` | High-watermark on `view.log.length` for diff-firing. |
| `_audioLastCombatTs` | Last seen `view.combat.ts` for combat-modal SFX. |

---

## Log → SFX mapping

`fireSfxFromView` reads each new `view.log[i].cls`:

| Log class | SFX |
|---|---|
| `spell` | `spellCast` |
| `reveal` | `reveal` |
| `treasure` | `treasure` |
| `death` | `heroFall` |
| `victory` | `victory` |
| `defeat` | `defeat` |
| (text match `Door opened`) | `doorOpen` |
| (text match `rolls movement`) | `roll` |

Plus combat-modal: `kill` if `view.combat.killed`, else `combatHit` if
`damage > 0`, else `combatMiss`.
