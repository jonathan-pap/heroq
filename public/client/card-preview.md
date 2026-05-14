# `public/client/card-preview.js` — hover-preview popover

> **Purpose:** Single body-level `<img>` that pops up next to a
> thumbnail on hover and hides on mouseleave. Pinned to `<body>` so
> no ancestor's overflow can swallow it.
>
> **Related:** [`public/FRONTEND.md`](../FRONTEND.md) (module index),
> [`public/client/lobby.js`](lobby.js) (calls `HQCardPreview.attach`
> for each hero-variant card in the lobby seat tiles).

---

## Public surface — `window.HQCardPreview`

| Export | Signature | What |
|---|---|---|
| `attach(thumb, url)` | `(HTMLElement, string) → void` | Wire mouseenter / mouseleave on a thumbnail. On enter: sets the popover src + reveals; on leave: hides. |

---

## Positioning

Computed inside `mouseenter` (one frame after reveal, so the popover
has natural dimensions):

1. Prefer to the right of the thumbnail (`rect.right + 10`).
2. If that would clip the right viewport edge → flip to the left
   (`rect.left - 10 - popoverWidth`).
3. Clamp to `x >= 4`.
4. Vertically: align centre to thumbnail, clamp to `[4, viewportHeight - popoverHeight - 4]`.

The popover element uses class `.card-preview-popover` (styled in
`styles.css`).

---

## Wiring

```js
// public/client/lobby.js — inside renderSeatVariant
HQCardPreview.attach(img, cardUrl);
```
