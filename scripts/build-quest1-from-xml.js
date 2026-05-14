// =====================================================================
// build-quest1-from-xml.js
//
// One-shot builder: takes the user-supplied canonical Quest 1 XML
// (assets/quest1-canonical.xml) and emits a sandbox JSON quest at
// data/quests/sandbox/sandbox-i-quest1-canonical.json. Everything
// from the XML — dark cells, monsters, furniture, doors, treasure
// chests, stair tile, rubble — is transcribed at the EXACT cell
// positions (1-based XML → 0-based ours).
//
// Run:  node scripts/build-quest1-from-xml.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Canonical piece-footprint reference. Each entry has:
//   natural: { w, h }   default footprint with long axis horizontal
//   anchor: TL|TR|BL|BR|CT   where the XML (left, top) sits in the piece
// Pieces (furniture) + tile overlays (rubble / stairway / traps) are
// merged into one flat PIECES map so the rest of this file can index
// by XML piece-id regardless of which yaml it came from.
const PIECES_FROM_PIECES = yaml.load(fs.readFileSync(
  path.join(__dirname, '..', 'data', 'pieces', 'canonical-pieces.yaml'), 'utf8'
)).pieces || {};
const PIECES_FROM_TILES  = yaml.load(fs.readFileSync(
  path.join(__dirname, '..', 'data', 'tiles', 'canonical-tiles.yaml'), 'utf8'
)).tiles || {};
const PIECES = { ...PIECES_FROM_PIECES, ...PIECES_FROM_TILES };

// Compute the cell offsets relative to the anchor cell, for a piece
// of (w × h) extent and the named anchor position.
function offsetsForAnchor(anchorCode, w, h) {
  // Determine which dx range and dy range to iterate, based on anchor.
  // The anchor cell itself is always (0, 0); other cells are offsets.
  let dxMin, dxMax, dyMin, dyMax;
  switch (anchorCode || 'TL') {
    case 'TL': dxMin = 0;        dxMax = w - 1;  dyMin = 0;       dyMax = h - 1;  break;
    case 'TR': dxMin = -(w - 1); dxMax = 0;      dyMin = 0;       dyMax = h - 1;  break;
    case 'BL': dxMin = 0;        dxMax = w - 1;  dyMin = -(h - 1); dyMax = 0;     break;
    case 'BR': dxMin = -(w - 1); dxMax = 0;      dyMin = -(h - 1); dyMax = 0;     break;
    case 'CT': // centre-top: anchor in middle column of top row
      // For w=3: anchor at middle col (-1 .. +1). For w=2: anchor at left
      // of two (0 .. 1). For w=1: just (0). dxMin/dxMax bracket the row.
      dxMin = -Math.floor((w - 1) / 2);
      dxMax = Math.ceil((w - 1) / 2);
      dyMin = 0;
      dyMax = h - 1;
      break;
    default:
      dxMin = 0; dxMax = w - 1; dyMin = 0; dyMax = h - 1;
  }
  const offsets = [];
  for (let dy = dyMin; dy <= dyMax; dy++) {
    for (let dx = dxMin; dx <= dxMax; dx++) {
      offsets.push([dx, dy]);
    }
  }
  return offsets;
}

function cellsForPiece(id, c, r, rot) {
  const def = PIECES[id];
  if (!def || !def.natural) return [[c, r]];
  let { w, h } = def.natural;
  if (rot === 'leftward' || rot === 'rightward') { [w, h] = [h, w]; }
  const offsets = offsetsForAnchor(def.anchor, w, h);
  return offsets.map(([dx, dy]) => [c + dx, r + dy]);
}

// HeroScribe XML — official quest reference. Authority on coords,
// rotations, and dark cells. Public DTD: lightless.org/files/xml/quest-1.4.dtd
//
// Usage:
//   node scripts/build-quest1-from-xml.js              (defaults to Quest 1)
//   node scripts/build-quest1-from-xml.js HQBase-02-TheRescueOfSirRagnar.xml
//   node scripts/build-quest1-from-xml.js HQBase-02-TheRescueOfSirRagnar.xml sandbox-i02-canonical
const ARG_FILE = process.argv[2];
const ARG_ID   = process.argv[3];
const MAPS_DIR = path.join(__dirname, '..', 'assets', 'maps');
const CANDIDATES = ARG_FILE
  ? [path.join(MAPS_DIR, ARG_FILE)]
  : [
      path.join(MAPS_DIR, 'HQBase-01-TheTrial_US.xml'),
      path.join(MAPS_DIR, 'quest1-canonical.xml'),
    ];
const IN = CANDIDATES.find(p => fs.existsSync(p));
if (!IN) throw new Error(`canonical XML not found in any of: ${CANDIDATES.join(', ')}`);
console.log(`source: ${path.basename(IN)}`);
// Derive output filename / id from the source XML or override.
// "HQBase-01-TheTrial_US.xml" → "sandbox-canonical-q01-the-trial"
function deriveSandboxId(xmlPath) {
  const base = path.basename(xmlPath, '.xml');
  const m = base.match(/HQBase-(\d+)-(.*?)(?:_[A-Z]{2})?$/i);
  if (m) {
    const num = m[1].padStart(2, '0');
    const slug = m[2].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    return `sandbox-canonical-q${num}-${slug}`;
  }
  return 'sandbox-canonical-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
const SANDBOX_ID = ARG_ID || deriveSandboxId(IN);
const OUT = path.join(__dirname, '..', 'data', 'quests', 'sandbox', SANDBOX_ID + '.json');

const xml = fs.readFileSync(IN, 'utf8');

// Tiny XML parsing — just regex extract <dark> and <object> elements.
// zorder can be negative (e.g. SecretDoorAlternate has zorder="-5.0"
// to draw under floor textures), so allow `-` in the zorder value.
const darkRE   = /<dark\s+left="(\d+)"\s+top="(\d+)"\s+width="(\d+)"\s+height="(\d+)"\s*\/>/g;
const objectRE = /<object\s+id="([^"]+)"\s+left="([\d.]+)"\s+top="([\d.]+)"(?:\s+rotation="([^"]+)")?(?:\s+zorder="-?[\d.]+")?\s*\/>/g;

const dark = [];
let m;
while ((m = darkRE.exec(xml))) {
  // 1-based → 0-based, expand width/height
  const left = parseInt(m[1], 10) - 1;
  const top  = parseInt(m[2], 10) - 1;
  const w = parseInt(m[3], 10);
  const h = parseInt(m[4], 10);
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      dark.push([left + dx, top + dy]);
}

const objects = [];
while ((m = objectRE.exec(xml))) {
  objects.push({
    id: m[1],
    left: parseFloat(m[2]) - 1,
    top:  parseFloat(m[3]) - 1,
    rot:  m[4] || 'downward',
  });
}

console.log(`parsed ${dark.length} dark cells, ${objects.length} objects`);

// 2-cell furniture pieces have a NATURAL footprint (horizontal 2x1 for
// most: tomb, table, bookcase, cupboard, fireplace, alchemist-bench,
// sorcerer-table, double-blocked-square; vertical 1x2 for rack). The
// XML `rotation` field is purely a facing/visual indicator — it does
// NOT change the footprint shape. So horizontal pieces always extend
// RIGHT from the anchor cell, vertical pieces always extend DOWN.
function pairCellsHorizontal(c, r) { return [[c, r], [c + 1, r]]; }
function pairCellsVertical(c, r)   { return [[c, r], [c, r + 1]]; }

// Door pair from anchor + rotation. Empirically the XML convention is:
// the rotation direction names the SIDE OF THE DOOR THE ANCHOR IS ON
// (NOT which side of the anchor the door is on). The smoking gun is
// `Door left=1 top=12 leftward` — leftmost playable column. With the
// old "anchor's left" reading the door points off-board to col -1.
// With the new "anchor IS the left side" reading it correctly opens
// from the west perimeter corridor (col 1, XML 1-based) into the room
// at col 2. So:
//   leftward  → anchor is LEFT  cell, partner is to the RIGHT  (c+1)
//   rightward → anchor is RIGHT cell, partner is to the LEFT   (c-1)
//   upward    → anchor is TOP   cell, partner is BELOW         (r+1)
//   downward  → anchor is BOTTOM cell, partner is ABOVE        (r-1)
function doorPair(c, r, rot) {
  switch (rot) {
    case 'leftward':  return [[c, r], [c + 1, r]];
    case 'rightward': return [[c, r], [c - 1, r]];
    case 'upward':    return [[c, r], [c, r + 1]];
    case 'downward':  return [[c, r], [c, r - 1]];
    default:          return [[c, r], [c, r + 1]];
  }
}

// Type maps from XML id → our internal monster/furniture/trap.
const MONSTER_TYPE = {
  Goblin: 'goblin', Orc: 'orc', Skeleton: 'skeleton', Zombie: 'zombie',
  Mummy: 'mummy', ChaosWarrior: 'chaos-warrior', Fimir: 'fimir',
  Gargoyle: 'verag', DreadWarrior: 'dread-warrior', Abomination: 'abomination',
};
const FURNITURE_TYPE = {
  Tomb: 'tomb', Table: 'table', SorcerersTable: 'sorcerer-table',
  Bookcase: 'bookcase', Cupboard: 'cupboard', Fireplace: 'fireplace',
  AlchemistsBench: 'alchemist-bench', WeaponsRack: 'weapon-rack',
  Rack: 'rack', Throne: 'throne',
};
// HeroScribe trap-tile XML ids → our internal trap types. Pit + spear
// + falling-block stay hidden until found by Search Traps; once
// triggered they fire per the 2021 rules already coded in server.js.
const TRAP_TYPE = {
  PitTrap: 'pit',
  FallingBlockTrap: 'block',
  SpearTrap: 'spear',
};

// All piece footprints + rotation cell offsets now live in
// data/pieces/canonical-pieces.yaml — see PIECES at top of file. The legacy
// horizontal/vertical sets below are kept only as docs.

const monsters = [];
const furniture = [];
const doors = [];
const secretDoors = [];
const treasure = [];
const blocked = [];   // SingleBlockedSquare = rubble
const traps = [];
const furnitureTraps = [];
const stairCells = [];
const usedNames = {};
function nextId(prefix) {
  usedNames[prefix] = (usedNames[prefix] || 0) + 1;
  return `${prefix}${usedNames[prefix]}`;
}

for (const o of objects) {
  const c = Math.round(o.left);
  const r = Math.round(o.top);

  // Visual labels — skip. Letters (LetterA..LetterZ) and Number markers
  // (Number1..Number12, Number2-12, etc.) are notation overlays in
  // HeroScribe quest maps; they don't have any in-engine effect.
  if (/^(Letter[A-Z]|Number\d+(-\d+)?)$/.test(o.id)) continue;

  // Stairway — pull cells from YAML (always 2x2 from top-left anchor).
  // 'Stairs' is HeroScribe's alternate id used in some quests
  // (e.g. Q10 Castle of Mystery); treat the same as 'Stairway'.
  if (o.id === 'Stairway' || o.id === 'Stairs') {
    for (const cell of cellsForPiece('Stairway', c, r, o.rot)) stairCells.push(cell);
    continue;
  }

  // Rubble — singles, doubles, and FallingRock (a permanent
  // floor-block obstruction placed by the quest author rather than
  // sprung by a falling-block trap).
  if (o.id === 'SingleBlockedSquare' || o.id === 'DoubleBlockedSquare') {
    for (const cell of cellsForPiece(o.id, c, r, o.rot)) blocked.push(cell);
    continue;
  }
  if (o.id === 'FallingRock') {
    blocked.push([c, r]);
    continue;
  }

  // Doors — anchor + rotation → cell pair
  if (o.id === 'Door') {
    const [a, b] = doorPair(c, r, o.rot);
    doors.push({ a, b, _rot: o.rot });
    continue;
  }

  // Secret doors — same cell-pair logic as regular doors but go into
  // the `secretDoors` array; in-game they stay hidden until a hero
  // succeeds at "Search for Secret Doors" while in the room.
  if (o.id === 'SecretDoor' || o.id === 'SecretDoorAlternate') {
    const [a, b] = doorPair(c, r, o.rot);
    secretDoors.push({ id: nextId('sd'), a, b, _rot: o.rot });
    continue;
  }

  // Treasure chest (1x1 furniture + treasure entry). The amount stays
  // a placeholder 50g; real per-quest values are applied by each
  // quest's install-canonical-qNN.js metadata script.
  if (o.id === 'TreasureChest') {
    const cells = cellsForPiece(o.id, c, r, o.rot);
    furniture.push({ id: nextId('f-chest'), type: 'chest', cells });
    treasure.push({ at: cells[0], kind: 'gold', amount: 50 });
    continue;
  }

  // Floor traps — pit, spear, falling-block. Single-cell, hidden until
  // Search Traps finds them; the existing trap engine handles firing.
  if (TRAP_TYPE[o.id]) {
    traps.push({ id: nextId('t'), type: TRAP_TYPE[o.id], at: [c, r] });
    continue;
  }

  // Treasure chest WITH a furniture trap (TreasureChestTrap). Adds
  // both the chest furniture AND a furniture-trap entry at the same
  // cell. Trap kind defaults to 'poison-needle' (canonical Q2/Q3
  // chest-A trap); install-canonical-qNN.js can override per quest.
  if (o.id === 'TreasureChestTrap') {
    const cells = cellsForPiece('TreasureChest', c, r, o.rot);
    const id = nextId('f-chest');
    furniture.push({ id, type: 'chest', cells, _trapped: true });
    treasure.push({ at: cells[0], kind: 'gold', amount: 0 });
    furnitureTraps.push({
      id: 'ft-' + id,
      kind: 'poison-needle',
      at: cells[0],
      damage: 1,
    });
    continue;
  }

  // Monsters
  if (MONSTER_TYPE[o.id]) {
    const t = MONSTER_TYPE[o.id];
    monsters.push({
      id: nextId(t === 'verag' ? 'verag' : t.charAt(0)),
      type: t,
      at: [c, r],
    });
    continue;
  }

  // All other furniture — YAML resolves cells. Pass the XML rotation
  // through as `facing` so the renderer can orient direction-sensitive
  // pieces (thrones, weapon-racks) toward the right side of the room.
  if (FURNITURE_TYPE[o.id]) {
    furniture.push({
      id: nextId('f-' + FURNITURE_TYPE[o.id]),
      type: FURNITURE_TYPE[o.id],
      cells: cellsForPiece(o.id, c, r, o.rot),
      facing: o.rot,
    });
    continue;
  }

  console.warn(`Unhandled XML object: ${o.id} at ${c},${r}`);
}

// Assemble the JSON
const startCells = stairCells.length === 4 ? stairCells.slice() : [[1, 14]];

// Try to extract the quest's friendly name from the XML <quest name="…">.
const nameMatch = xml.match(/<quest\s+name="([^"]+)"/);
const QUEST_NAME = nameMatch ? nameMatch[1] : 'Canonical';
const QUEST_NUM_MATCH = path.basename(IN).match(/HQBase-(\d+)/i);
const QUEST_NUM = QUEST_NUM_MATCH ? Number(QUEST_NUM_MATCH[1]) : null;

const quest = {
  id: SANDBOX_ID,
  title: `Quest ${QUEST_NUM ? QUEST_NUM : '?'} Canonical: ${QUEST_NAME}`,
  subtitle: `Sandbox — auto-generated from ${path.basename(IN)}`,
  intro: `AUTO-GENERATED from canonical HeroScribe XML at assets/maps/${path.basename(IN)}. ` +
         `Every dark cell, monster, furniture piece, door, chest and rubble block placed at ` +
         `the EXACT (col, row) the XML specifies (1-based → 0-based). Heroes start on the ` +
         `staircase tile at the canonical position. ` +
         `Solid-rock cells (${dark.length} total) render as void — never revealed even with ` +
         `the debug "Reveal entire map" toggle. Re-run \`node scripts/build-quest1-from-xml.js [filename]\` to regenerate.`,
  category: 'sandbox',
  board: 'default',

  roomOverrides: {},  // we override nothing — quest objects override individual cells

  dark,
  blocked,

  doors,
  furniture,
  monsters,
  treasure,
  traps,
  secretDoors,
  furnitureTraps,

  startCells,
  stairCells,

  wanderingMonster: 'orc',
  objective: { kind: 'kill', monsterId: monsters.find(m => m.type === 'verag')?.id || 'verag1', text: 'Slay the gargoyle.' },
  defeat: { kind: 'all-dead', text: 'Tested to death.' },
};

// Pretty-print
fs.writeFileSync(OUT, JSON.stringify(quest, null, 2) + '\n');
console.log(`wrote ${OUT}`);
console.log(`  ${dark.length} dark cells, ${blocked.length} rubble cells`);
console.log(`  ${monsters.length} monsters, ${furniture.length} furniture pieces`);
console.log(`  ${doors.length} doors, ${secretDoors.length} secret door(s), ${treasure.length} treasures, ${traps.length} floor trap(s), ${furnitureTraps.length} chest/furniture trap(s)`);
console.log(`  ${stairCells.length / 4} staircase(s) at: ${JSON.stringify(stairCells.slice(0, 4))}`);
