// Validates quest footprints against the canonical 2021 (F2847) sizes.
// Used both as a one-shot CLI ("npm-style" report) and as a library
// loaded by the server at boot to warn on bad data.
//
// Canonical footprints (from F2847 + 2021 Quest Book legend):
//   stairway  : 2x2  (always — exactly 4 cells in a 2x2 block)
//   chest     : 1x1
//   throne    : 1x1
//   table     : 2x1 or 1x2
//   tomb      : 2x1 or 1x2  (sarcophagus same)
//   bookcase  : 2x1 or 1x2
//   fireplace : 2x1 or 1x2
//   weapon-rack       : 1x1, 2x1, or 1x2
//   cupboard          : 1x1, 2x1, or 1x2
//   alchemist-bench   : 2x1, 3x1, or 1x2 (also sorcerer's-table 3x1)
//   rack (skull/iron) : 1x2
//
// 1x1 means a single cell. NxM means contiguous, axis-aligned rectangle.
// Anything outside these tolerances → WARN. Unknown types → INFO only.

const fs = require('fs');
const path = require('path');

// Canonical footprint table — sourced from data/pieces/canonical-pieces.yaml
// (single source of truth shared with the XML→JSON converter and the
// renderer). For each type we accept its declared (w, h) AND the
// rotated equivalent (h, w) since rotation is permitted.
let FOOTPRINTS;
try {
  const yaml = require('js-yaml');
  const raw = yaml.load(require('fs').readFileSync(
    require('path').join(__dirname, '..', 'data', 'pieces', 'canonical-pieces.yaml'), 'utf8'
  )).pieces || {};
  FOOTPRINTS = {};
  // Map XML piece names → our internal type names.
  const XML_TO_TYPE = {
    Tomb: ['tomb', 'sarcophagus'],
    SorcerersTable: ['sorcerer-table', 'sorcerers-table'],
    AlchemistsBench: ['alchemist-bench', 'alchemists-bench'],
    Bookcase: ['bookcase'],
    Cupboard: ['cupboard'],
    Fireplace: ['fireplace'],
    WeaponsRack: ['weapon-rack'],
    Rack: ['rack'],
    Table: ['table'],
    Throne: ['throne'],
    Stairway: ['stairway'],
    TreasureChest: ['chest'],
    SingleBlockedSquare: [],   // not validated as furniture
    DoubleBlockedSquare: [],
    Door: [],
  };
  for (const [xmlName, def] of Object.entries(raw)) {
    const types = XML_TO_TYPE[xmlName] || [];
    if (!def.natural || !types.length) continue;
    const { w, h } = def.natural;
    for (const t of types) {
      // Both natural and 90° rotated dims accepted.
      FOOTPRINTS[t] = [{ w, h }, { w: h, h: w }];
    }
  }
} catch (e) {
  console.warn('[validator] failed to load canonical-pieces.yaml; using fallback', e.message);
  FOOTPRINTS = { 'chest': [{ w: 1, h: 1 }], 'throne': [{ w: 1, h: 1 }] };
}

function describeFootprint(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const set = new Set();
  for (const c of cells) {
    if (!Array.isArray(c) || c.length !== 2) return { error: 'bad-cell' };
    set.add(`${c[0]},${c[1]}`);
    if (c[0] < minX) minX = c[0]; if (c[1] < minY) minY = c[1];
    if (c[0] > maxX) maxX = c[0]; if (c[1] > maxY) maxY = c[1];
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  // Verify it's a complete axis-aligned rectangle (no holes, no extras)
  const isRect = (cells.length === w * h) &&
    (() => {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (!set.has(`${x},${y}`)) return false;
        }
      }
      return true;
    })();
  return { w, h, count: cells.length, isRect };
}

function checkStair(cells) {
  const fp = describeFootprint(cells);
  if (!fp) return { level: 'WARN', msg: 'stair: missing or empty' };
  if (fp.error) return { level: 'WARN', msg: 'stair: malformed cell entry' };
  if (!fp.isRect) {
    return { level: 'WARN',
      msg: `stair: ${fp.count} cells form a non-rectangular shape (${fp.w}x${fp.h} bbox); canonical is 2x2 contiguous` };
  }
  if (fp.w !== 2 || fp.h !== 2) {
    return { level: 'WARN', msg: `stair: footprint is ${fp.w}x${fp.h}; canonical 2021 spec is 2x2` };
  }
  return null;
}

function checkFurniture(piece) {
  const type = piece.type;
  const fp = describeFootprint(piece.cells);
  if (!fp) return { level: 'WARN', msg: `${piece.id || '?'}: empty cells` };
  if (fp.error) return { level: 'WARN', msg: `${piece.id || '?'}: malformed cells` };
  if (!fp.isRect) {
    return { level: 'WARN',
      msg: `${piece.id} (${type}): cells not a contiguous rectangle (got ${fp.count} cells in ${fp.w}x${fp.h} bbox)` };
  }
  const allowed = FOOTPRINTS[type];
  if (!allowed) {
    return { level: 'INFO', msg: `${piece.id} (${type}): unknown type — no canonical footprint to check (${fp.w}x${fp.h})` };
  }
  const ok = allowed.some(a => a.w === fp.w && a.h === fp.h);
  if (!ok) {
    const want = allowed.map(a => `${a.w}x${a.h}`).join(' or ');
    return { level: 'WARN', msg: `${piece.id} (${type}): footprint ${fp.w}x${fp.h} — canonical is ${want}` };
  }
  // ID/type drift heuristic: id starts with f-chest but type is throne, etc.
  const id = (piece.id || '').toLowerCase();
  // Aliases — types that render identically and are interchangeable.
  const ALIASES = {
    'tomb': ['tomb', 'sarcophagus'],
    'sarcophagus': ['tomb', 'sarcophagus'],
    'alchemist-bench': ['alchemist-bench', 'alchemists-bench'],
    'alchemists-bench': ['alchemist-bench', 'alchemists-bench'],
  };
  const allowedTypeAliases = ALIASES[type] || [type];
  const heuristics = [
    { idHas: 'chest',     wantType: 'chest' },
    { idHas: 'throne',    wantType: 'throne' },
    { idHas: 'shelf',     wantType: 'bookcase' },
    { idHas: 'shelves',   wantType: 'bookcase' },
    { idHas: 'bookcase',  wantType: 'bookcase' },
    { idHas: 'tomb',      wantType: 'tomb' },
    { idHas: 'sarcoph',   wantType: 'tomb' },
    { idHas: 'altar',     wantType: 'throne' }, // altars often modeled as throne
    { idHas: 'fire',      wantType: 'fireplace' },
    { idHas: 'cupboard',  wantType: 'cupboard' },
    { idHas: 'cabinet',   wantType: 'cupboard' },
  ];
  for (const h of heuristics) {
    if (id.includes(h.idHas) && !allowedTypeAliases.includes(h.wantType)) {
      return { level: 'INFO',
        msg: `${piece.id} (type=${type}): id suggests "${h.wantType}" — possible type drift?` };
    }
  }
  return null;
}

function validateQuest(quest, file) {
  const issues = [];
  // 1. Stair tile dimensions
  const stairCells = (quest.stairCells && quest.stairCells.length) ? quest.stairCells : quest.startCells;
  const stairIssue = checkStair(stairCells);
  if (stairIssue) issues.push({ file, ...stairIssue });
  // 2. Each furniture piece
  for (const f of (quest.furniture || [])) {
    const issue = checkFurniture(f);
    if (issue) issues.push({ file, ...issue });
  }
  return issues;
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}

function main() {
  const QUESTS_DIR = path.join(__dirname, '..', 'data', 'quests');
  const files = walk(QUESTS_DIR);
  const all = [];
  for (const f of files) {
    let q;
    try { q = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { console.warn(`PARSE  ${f}: ${e.message}`); continue; }
    all.push(...validateQuest(q, path.relative(QUESTS_DIR, f)));
  }
  // Group by level
  const warns = all.filter(i => i.level === 'WARN');
  const infos = all.filter(i => i.level === 'INFO');
  for (const i of warns) console.log(`WARN   ${i.file}: ${i.msg}`);
  for (const i of infos) console.log(`INFO   ${i.file}: ${i.msg}`);
  console.log(`\n${warns.length} warning(s), ${infos.length} info-level note(s) across ${files.length} quest(s).`);
}

if (require.main === module) main();

module.exports = { validateQuest, checkStair, checkFurniture, describeFootprint, FOOTPRINTS };
