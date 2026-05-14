# Canonical-quest pipeline — how to add a HeroScribe XML quest

Reference notes so you / I don't have to re-discover the rotation,
anchor, and dimension rules every time. **Last verified: Quest 1
(`HQBase-01-TheTrial_US.xml`) sandbox layout matches canonical map.**

---

## TL;DR — adding a new quest

1. Drop the HeroScribe XML into `assets/maps/HQBase-NN-Whatever.xml`
2. Run `node scripts/build-quest1-from-xml.js HQBase-NN-Whatever.xml`
3. Boot the server. Lobby → quest dropdown → "Quest N Canonical: Whatever".
4. Tick **Reveal entire map** to verify layout against the canonical map.

The script auto-derives the output filename
(`data/quests/sandbox/sandbox-canonical-qNN-…`), the title, and pulls
all dark cells, monsters, furniture, doors, chests, rubble, and the
stairway from the XML at their canonical (col, row) positions.

---

## The pieces

### `data/pieces/canonical-pieces.yaml` — the single source of truth

Every furniture / tile type's footprint is in one YAML file used by:
- `scripts/build-quest1-from-xml.js` (XML → JSON converter)
- `scripts/validate-quests.js` (footprint validator)

Each piece declares:
```yaml
PieceName:
  natural: { w: <cells_wide>, h: <cells_tall> }    # in default rotation
  anchor: TL                                        # always TL — see below
```

**Confirmed footprints (canonical 2021 rules + Quest 1 visual verification):**

| Piece                 | W × H | Notes                          |
|-----------------------|-------|--------------------------------|
| Tomb                  | 2 × 3 | vertical sarcophagus           |
| Rack                  | 2 × 3 | skull/iron rack, vertical      |
| SorcerersTable        | 3 × 2 | horizontal                     |
| AlchemistsBench       | 3 × 2 | horizontal                     |
| Table                 | 3 × 2 | horizontal                     |
| Bookcase              | 3 × 1 | horizontal                     |
| Cupboard              | 3 × 1 | horizontal                     |
| Fireplace             | 3 × 1 | horizontal                     |
| WeaponsRack           | 3 × 1 | horizontal                     |
| DoubleBlockedSquare   | 2 × 1 | horizontal rubble pair         |
| Stairway              | 2 × 2 | fan tile                       |
| SingleBlockedSquare   | 1 × 1 | single rubble                  |
| Throne                | 1 × 1 |                                |
| Door                  | 1 × 1 |                                |
| TreasureChest         | 1 × 1 |                                |

If a future canonical map shows a piece with different dimensions, edit
the YAML and re-run the converter — every dependent quest regenerates
consistently.

---

## The anchor rule (PIECES)

**Universal: anchor at TL (top-left).**

The XML attribute `<object left="C" top="R" .../>` is the piece's
**top-left cell**. The piece extends `(w − 1)` cells to the **right**
and `(h − 1)` cells **down** from there.

```
XML: <object id="Tomb" left="11" top="2" rotation="downward" />
                             ↓
        anchor in 0-based   = (10, 1)
        Tomb is 2W × 3H     → cells extend from (10,1) to (11,3)
        Display labels:     L11T2 L12T2 / L11T3 L12T3 / L11T4 L12T4
```

### Rotation handling

XML `rotation="..."` value affects the **footprint** as follows:

| Rotation                  | Effect on (w, h)            |
|---------------------------|-----------------------------|
| `downward` / `upward`     | natural (no swap)           |
| `leftward` / `rightward`  | swap: w ↔ h (90° rotation)  |

Anchor is **always** TL of the (rotated) bounding box. Don't try to
infer per-rotation anchor offsets — TL works for every piece confirmed
in Quest 1.

---

## The anchor rule (DOORS)

XML `<object id="Door" left="C" top="R" rotation="..."/>` defines a door
between two cells. Convention:

| Rotation    | Anchor side | Connects                |
|-------------|-------------|-------------------------|
| `leftward`  | LEFT cell   | (c, r) ↔ (c+1, r)       |
| `rightward` | RIGHT cell  | (c, r) ↔ (c−1, r)       |
| `upward`    | TOP cell    | (c, r) ↔ (c, r+1)       |
| `downward`  | BOTTOM cell | (c, r) ↔ (c, r−1)       |

Sanity check: `Door left="1" top="12" rotation="leftward"` opens
**from the west perimeter corridor (col 1) into the room at col 2**.
With the wrong convention this would point off-board to col 0.

---

## Coordinate systems

| System                  | Origin   | Range     | Used by                         |
|-------------------------|----------|-----------|---------------------------------|
| HeroScribe XML          | 1-based  | 1..26 / 1..19 | `assets/maps/*.xml`         |
| Internal storage        | 0-based  | 0..25 / 0..18 | server, JSON quest data     |
| Display labels (`L#T#`) | 1-based  | L1T1 .. L26T19 | rendered map debug overlay |

XML and display labels match directly: XML `(11, 2)` ↔ display `L11T2`.
The `−1`/`+1` conversion is handled internally for array indexing.

To turn debug labels on for any quest, set in the JSON:
```json
"showCellCoords": true,
"showRoomIds": true
```

The "Sandbox J — Coordinate Map" quest is permanently labelled — use it
to read off cells when transcribing.

---

## Dark cells (solid rock) and rubble

Two distinct mechanics, both impassable, both rendered differently:

### Solid rock — `quest.dark: [[x, y], ...]`
- Permanently invisible. **Never** revealed even with the GM / reveal-all toggle.
- Never explored through (walls off `exploreFromHero` flood fill).
- Renders as black void.
- Source: every `<dark left= top= />` cell in the XML.
- Use case: cells that are not part of the playable area for that quest.

### Rubble — `quest.blocked: [[x, y], ...]`
- Visible once revealed by adjacent line-of-sight (normal fog rules).
- Impassable.
- Renders as a stone-brick tile.
- Source: `<object id="SingleBlockedSquare">` and `<object id="DoubleBlockedSquare">`.
- Use case: blocked-square cardboard tiles placed by Zargon mid-quest.

Falling-block trap aftermath uses the **same `t.blocked` flag** but with
`blockedKind: 'falling-block'` so it renders as the canonical red square
instead of stone-brick. The converter does not produce these — they're
created at runtime when a falling-block trap fires.

---

## Master board mismatch — when the canonical doesn't fit our rooms

Our master board (`data/board/board.yaml`) was auto-extracted from
`assets/board/board3.png` and has 22 rooms approximately matching the
canonical 1989 layout but **not cell-perfectly**. When transcribing a
canonical XML:

- Pieces placed at canonical coordinates may span our master board's
  rooms / corridors in slightly different patterns than the canonical map shows.
- This is harmless for sandbox-canonical-qNN quests — the dark cells +
  blocked cells in the XML override the master board geometry where it
  matters.
- It only becomes an issue if a piece's cells overlap an unintended
  room boundary; tweak the YAML if so.

---

## Validator

`scripts/validate-quests.js` runs at server boot and warns about
footprint mismatches across all 25 quests. The output is purely
informational — boot continues even with warnings.

Currently, **legacy hand-built quests** (Q2-Q9) trigger warnings because
they were written before the canonical-pieces.yaml dimensions were
locked in. They'll go silent as each quest is replaced by its
HeroScribe-XML-derived sandbox-canonical version.

---

## File map

```
assets/maps/HQBase-NN-….xml          HeroScribe canonical XML (input)
data/pieces/canonical-pieces.yaml    Footprint reference (truth)
data/quests/sandbox/
    sandbox-canonical-qNN-….json     Auto-generated quest data (output)
scripts/build-quest1-from-xml.js     Converter (despite the name, takes any quest)
scripts/dump-q1-pieces.js            Dumps all pieces in human-readable form
scripts/validate-quests.js           Footprint validator
public/client.js  drawSkullRack      Renderer for multi-cell rack
public/client.js  drawTomb,
                  drawTable,
                  drawBookcase, …    Other piece renderers
```

---

## Rules learned the hard way (don't re-discover these)

1. **HeroScribe XML rotation `leftward` ≠ "door is on the left of the
   anchor cell."** It's "anchor IS the left cell." The smoking gun is
   `Door left="1" top="12" leftward` — must be on-board.

2. **HeroScribe pieces don't all share the same natural orientation.**
   Tomb is vertical (2W × 3H) while Tables / Benches / Bookcases are
   horizontal. The natural orientation matches the canonical icon's
   long axis. Get it right in the YAML once; converter handles
   rotations from there.

3. **TL anchor for everything works.** TR, CT, BL, BR were all tried
   and broke at least one piece. TL + correct natural footprint + correct
   rotation handling = correct cells for every Quest 1 piece.

4. **Renderers must scale with `(w, h)` parameters.** A multi-cell
   piece with a renderer that paints only at one cell's worth of pixels
   shows up as a sad icon in the corner of its bbox. Every furniture
   `drawXxx(x, y, w = CELL, h = CELL)` should fill its given footprint.

5. **`dark` and `blocked` are different.** Don't conflate them. Solid
   rock cells get `dark`, in-play rubble gets `blocked`.

6. **Validator warnings on legacy quests are not bugs.** They're a TODO
   list. Replace each old quest with its canonical-XML version when
   you've got the HeroScribe file.
