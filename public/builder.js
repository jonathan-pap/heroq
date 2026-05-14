// =====================================================================
// HeroQuest board builder v2 — layered render
//
// Architecture (matches the analysis in /board-builder discussion):
//   • Cell layer       — (col, row) → roomId, blocked, dark, furniture
//   • Edge layer       — walls + doors live on the boundary BETWEEN two
//                        adjacent cells, not on the cells themselves
//   • Decoration layer — furniture / monsters / traps / heroes / treasure
//
// Walls follow this rule in order:
//   1. quest.openings has an entry → no wall, no door (open passage)
//   2. quest.doors has an entry    → door (rendered with door art)
//   3. quest.walls has an entry    → explicit wall
//   4. fallback                    → wall iff the two cells have
//                                    different roomId (legacy data)
//
// Floor is always a flat stone tile. Rooms are visually separated by
// the walls drawn on top, not by per-cell colouring (room tint is an
// optional layer for at-a-glance shape inspection).
// =====================================================================
'use strict';

const HQ = window.HQRules;

const COLS = 26, ROWS = 19;
const CELL = 40;
const PAD_L = 28, PAD_T = 28, PAD_R = 8, PAD_B = 8;
const W = PAD_L + COLS * CELL + PAD_R;
const H = PAD_T + ROWS * CELL + PAD_B;

const WALL_THICK = 4;
const C = {
  bg:          '#221d18',
  outOfPlay:   '#100c08',
  floor:       '#6e6258',
  floorHi:     '#7a6e62',
  grid:        'rgba(232,52,52,0.85)',     // red — calibration grid
  gridHalo:    'rgba(0,0,0,0.45)',          // dark shadow under red line
  coord:       'rgba(216,205,182,0.45)',
  wall:        '#e6d9bd',
  wallShade:   '#3a2e22',
  door:        '#b48742',
  doorClosed:  '#7a5424',
  doorSecret:  '#7d5cbf',
  blocked:     '#6e5544',
  blockedX:    '#241612',
  start:       'rgba(160,200,255,0.32)',
  startBdr:    '#88b3e0',
  furn:        '#c8a060',
  furnEdge:    '#3a2e1a',
  trap:        '#c83c3c',
  monster:     '#a44',
  npc:         '#6cb46c',
  selected:    'rgba(200,151,60,0.35)',
  selectedBdr: '#e0b25e',
};
const ROOM_TINTS = [
  '#5a4a3f','#6a4a4a','#4a5a4a','#4a4a6a','#6a5a4a','#5a4a6a','#4a6a5a','#6a4a5a',
  '#5a5a4a','#4a6a6a','#6a6a4a','#5a4a5a','#4a5a5a','#6a5a5a','#5a6a4a','#5a6a6a',
  '#7a5a3a','#3a5a7a','#7a3a5a','#5a3a3a','#3a7a3a','#3a3a7a',
];
function roomTint(roomId) {
  let h = 0;
  for (const ch of String(roomId)) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return ROOM_TINTS[Math.abs(h) % ROOM_TINTS.length];
}

// ---- State ---------------------------------------------------------------
const state = {
  questFile: null,
  quest: null,
  questIndex: [],
  board: null,              // master board.yaml: { corridorCells, rooms[] }
  zoneMap: new Map(),       // 'c,r' → 'corridor' | roomId  (from master board)
  selected: null,           // { c, r }
  layers: {
    floor: true, rooms: true, roomTex: false, roomBbox: false,
    walls: true, doors: true,
    furn: true, monsters: true, traps: true, blocked: true,
    start: true, dark: true, grid: true, coords: true,
    reference: false,
  },
  referenceOpacity: 0.55,
  textureScale: 1.0,    // user-tunable: per-room texture zoom factor
  corridorWalls: true,  // true → corridor.png, false → corridor_no_walls.png
};

// Per-room texture cache. The builder now loads from
// /assets/room_textures/room_NN.png — hand-prepared, grid-perfect
// textures sized to the room's cell footprint (cellW_png =
// naturalWidth/spanC). Each PNG covers exactly the room bbox so a
// cell at local (i, j) samples one uniform slice and the printed
// art lines up with the builder grid with no calibration needed.
//
// Note: this is BUILDER-ONLY. The live game still renders from its
// own asset path; we're not touching that here.
const FLOORS_VER = 3;
const ROOM_TEX = {};   // roomId → { img, ready }
// roomId 'r01' → 'room_01.png'.  Defensive: if the id is already in
// the new shape ('room_01' or '01') we still derive the right file.
function roomTextureFile(roomId) {
  const m = String(roomId).match(/(\d+)/);
  if (!m) return null;
  return `room_${m[1].padStart(2, '0')}.png`;
}
function loadRoomTexture(roomId) {
  if (ROOM_TEX[roomId]) return ROOM_TEX[roomId];
  const file = roomTextureFile(roomId);
  const img = new Image();
  const entry = { img, ready: false };
  ROOM_TEX[roomId] = entry;
  if (!file) { ROOM_TEX[roomId] = { img: null, ready: false, error: true }; return ROOM_TEX[roomId]; }
  img.onload  = () => { entry.ready = true; draw(); };
  img.onerror = () => { ROOM_TEX[roomId] = { img: null, ready: false, error: true }; };
  img.src = `/assets/room_textures/${file}?v=${FLOORS_VER}`;
  return entry;
}

// Corridor texture — one image covering ~ the full playable area.
// Drawn stretched to the canvas playable rect, clipped to corridor
// cells, so each corridor cell shows the slice of the source that
// corresponds to its position. Same rendering pattern as rooms.
//
// Two variants are cached, switched live by the layer-corridorWalls
// toggle: 'corridor.png' (with printed wall stones around the
// playable frame) and 'corridor_no_walls.png' (clean stone only).
const CORRIDOR_TEX = {};   // file → { img, ready }
function loadCorridorTexture(file) {
  if (CORRIDOR_TEX[file]) return CORRIDOR_TEX[file];
  const img = new Image();
  const entry = { img, ready: false };
  CORRIDOR_TEX[file] = entry;
  img.onload  = () => { entry.ready = true; draw(); };
  img.onerror = () => { CORRIDOR_TEX[file] = { img: null, ready: false, error: true }; };
  img.src = `/assets/room_textures/${file}?v=${FLOORS_VER}`;
  return entry;
}
function currentCorridorTexture() {
  const file = state.corridorWalls ? 'corridor.png' : 'corridor_no_walls.png';
  return loadCorridorTexture(file);
}

// Reference board image — decoration only, NOT consulted by render math.
// Loads board_v2.png directly. Calibration constants are inlined (they
// came from /assets/floors/_index.json originally but the values are
// stable properties of board_v2.png: a 14-px black margin around the
// art, and the playable 26×19 cells live at offset (55, 42) inside
// the image at 40 × 39.95 px per cell).
const REF_INDEX = {
  srcPlayable: { x: 55, y: 42, w: 1040, h: 759 },
  cellW: 40,
  cellH: 759 / 19,
};
let REF_IMG = null;
function loadReferenceImage() {
  const img = new Image();
  img.onload  = () => { REF_IMG = img; draw(); };
  img.onerror = () => { REF_IMG = null; };
  img.src = '/assets/board/board_v2.png';
}

async function loadMasterBoard() {
  try {
    const r = await fetch('/api/board');
    if (!r.ok) return;
    state.board = await r.json();
    state.zoneMap.clear();
    state.roomBbox = {};         // roomId → { mc, mr, xc, xr, spanC, spanR }
    for (const [c, r] of (state.board.corridorCells || []))
      state.zoneMap.set(c + ',' + r, 'corridor');
    for (const room of (state.board.rooms || [])) {
      let mc = 99, mr = 99, xc = -1, xr = -1;
      for (const [c, r] of (room.cells || [])) {
        state.zoneMap.set(c + ',' + r, room.id);
        if (c < mc) mc = c; if (r < mr) mr = r;
        if (c > xc) xc = c; if (r > xr) xr = r;
      }
      state.roomBbox[room.id] = {
        mc, mr, xc, xr,
        spanC: xc - mc + 1,
        spanR: xr - mr + 1,
      };
    }
  } catch (e) { console.warn('board load failed', e); }
}

// ---- DOM -----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const canvas = $('board');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');

// ---- Image cache for sprites (re-uses /assets/* from existing tools) -----
const SPRITE = {};
function getSprite(url) {
  if (SPRITE[url] !== undefined) return SPRITE[url];
  const img = new Image();
  const entry = { img, ready: false };
  SPRITE[url] = entry;
  img.onload  = () => { entry.ready = true; draw(); };
  img.onerror = () => { SPRITE[url] = null; };
  img.src = url;
  return entry;
}

// ---- Furniture icons — shared with the map-editor tool -------------
// Loaded from /api/canonical-pieces (sourced from
// data/canonical-pieces.yaml). The FALLBACK below keeps rendering
// alive while the fetch is in flight, and stays in lock-step with
// the YAML so an offline editor (no server) still works.
const FURN_FILE_FALLBACK = {
  'tomb':              { file: 'Tomb.png',            natural: 'downward' },
  'sarcophagus':       { file: 'Tomb.png',            natural: 'downward' },
  'sorcerer-table':    { file: 'SorcerersTable.png',  natural: 'downward' },
  'sorcerers-table':   { file: 'SorcerersTable.png',  natural: 'downward' },
  'alchemist-table':   { file: 'AlchemistsBench.png', natural: 'upward'   },
  'alchemist-bench':   { file: 'AlchemistsBench.png', natural: 'upward'   },
  'alchemists-bench':  { file: 'AlchemistsBench.png', natural: 'upward'   },
  'table':             { file: 'Table.png',           natural: 'downward' },
  'bookcase':          { file: 'Bookcase.png',        natural: 'downward' },
  'cupboard':          { file: 'Cupboard.png',        natural: 'downward' },
  'fireplace':         { file: 'Fireplace.png',       natural: 'downward' },
  'weapon-rack':       { file: 'WeaponsRack.png',     natural: 'downward' },
  'rack':              { file: 'Rack.png',            natural: 'downward' },
  'chest':             { file: 'TreasureChest.png',   natural: 'downward' },
  'throne':            { file: 'Throne.png',          natural: 'downward' },
  'stairway':          { file: 'Stairway.png',        natural: 'downward', dir: 'tiles' },
};
const FURN_ALT_FILE_FALLBACK = {
  'tomb':             'Tomb-2x3.png',
  'sarcophagus':      'Tomb-2x3.png',
  'sorcerer-table':   'Sorcerer Table-2x3.png',
  'sorcerers-table':  'Sorcerer Table-2x3.png',
  'alchemist-table':  'Alchemist Bench-2x3.png',
  'alchemist-bench':  'Alchemist Bench-2x3.png',
  'alchemists-bench': 'Alchemist Bench-2x3.png',
  'table':            'Table-2x3.png',
  'bookcase':         'Bookcase-1x3.png',
  'cupboard':         'Cupboard-1x3.png',
  'fireplace':        'Fireplace-1x3.png',
  'weapon-rack':      'Weapons Rack-1x3.png',
  'rack':             'Rack-2x3.png',
  'chest':            'Chest-1x1.png',
  'throne':           'Throne-1x1.png',
};
let FURN_FILE_BUILTIN = { ...FURN_FILE_FALLBACK };
let FURN_ALT_FILE     = { ...FURN_ALT_FILE_FALLBACK };
function applyCanonicalPieces(yamlData) {
  const pieces = (yamlData && yamlData.pieces) || {};
  const flat = {};
  const alt  = {};
  for (const pieceId of Object.keys(pieces)) {
    const p = pieces[pieceId] || {};
    if (!p.file || !Array.isArray(p.aliases)) continue;
    for (const alias of p.aliases) {
      flat[alias] = {
        file:    p.file,
        natural: p.naturalDir || 'downward',
        dir:     p.dir || 'furniture',
      };
      if (p.altFile) alt[alias] = p.altFile;
    }
  }
  if (Object.keys(flat).length) {
    FURN_FILE_BUILTIN = flat;
    FURN_ALT_FILE     = alt;
    if (typeof draw === 'function') draw();
  }
}
(async () => {
  try {
    const r = await fetch('/api/canonical-pieces');
    if (r.ok) applyCanonicalPieces(await r.json());
  } catch { /* keep fallback */ }
})();
const FACING_RAD_E = {
  downward:  0,
  upward:    Math.PI,
  leftward:  -Math.PI / 2,
  rightward:  Math.PI / 2,
};

// Same key + key shape as the tool. Read-only here — the tool owns
// editing; we just want to match its current rendering.
const NATURAL_LS_KEY         = 'hq_furn_natural_overrides_v1';
const FURN_INSETS_LS_KEY     = 'hq_furn_insets_v2';
const FURN_INSETS_ALT_LS_KEY = 'hq_furn_insets_alt_v1';
const DEFAULT_INSETS = { small: 5, linear: 5, stair: 6, block: 12 };
let NATURAL_OVERRIDES = (() => {
  try { return JSON.parse(localStorage.getItem(NATURAL_LS_KEY) || '{}') || {}; }
  catch { return {}; }
})();
function _readInsetsFrom(key) {
  try {
    const j = JSON.parse(localStorage.getItem(key) || '{}');
    const clamp = v => Math.max(0, Math.min(20, parseInt(v, 10) || 0));
    return {
      small:  Number.isFinite(j.small)  ? clamp(j.small)  : DEFAULT_INSETS.small,
      linear: Number.isFinite(j.linear) ? clamp(j.linear) : DEFAULT_INSETS.linear,
      stair:  Number.isFinite(j.stair)  ? clamp(j.stair)  : DEFAULT_INSETS.stair,
      block:  Number.isFinite(j.block)  ? clamp(j.block)  : DEFAULT_INSETS.block,
    };
  } catch { return { ...DEFAULT_INSETS }; }
}
let FURN_INSETS_CANON = _readInsetsFrom(FURN_INSETS_LS_KEY);
let FURN_INSETS_ALT   = _readInsetsFrom(FURN_INSETS_ALT_LS_KEY);
// Pull the server-side naturals (authoritative) once at boot. If it
// errors we keep the localStorage cache.
(async () => {
  try {
    const r = await fetch('/api/furn-naturals');
    if (!r.ok) return;
    const remote = await r.json();
    if (remote && typeof remote === 'object') {
      NATURAL_OVERRIDES = remote;
      try { localStorage.setItem(NATURAL_LS_KEY, JSON.stringify(remote)); } catch {}
      draw();
    }
  } catch { /* no-op */ }
})();
// React to live changes from the tool in another tab (storage event)
window.addEventListener('storage', (e) => {
  if (e.key === NATURAL_LS_KEY) {
    try { NATURAL_OVERRIDES = JSON.parse(e.newValue || '{}') || {}; }
    catch { NATURAL_OVERRIDES = {}; }
    draw();
  }
  if (e.key === FURN_INSETS_LS_KEY) {
    FURN_INSETS_CANON = _readInsetsFrom(FURN_INSETS_LS_KEY);
    draw();
  }
  if (e.key === FURN_INSETS_ALT_LS_KEY) {
    FURN_INSETS_ALT = _readInsetsFrom(FURN_INSETS_ALT_LS_KEY);
    draw();
  }
});

// Alternate furniture art (sized-name PNGs). FURN_ALT_FILE is now
// populated by the canonical-pieces fetch above (FURN_ALT_FILE_FALLBACK
// keeps the toggle functional in the meantime). Shared with the editor
// + live game via localStorage `hq_furn_alt_v1` — toggling in any
// surface updates the others through the `storage` event.
const FURN_ALT_KEY = 'hq_furn_alt_v1';
let ALT_FURN_ON = (() => {
  try { return localStorage.getItem(FURN_ALT_KEY) === '1'; }
  catch { return false; }
})();
window.addEventListener('storage', (e) => {
  if (e.key === FURN_ALT_KEY) {
    ALT_FURN_ON = e.newValue === '1';
    const el = document.getElementById('layer-altFurn');
    if (el) el.checked = ALT_FURN_ON;
    draw();
  }
});

function naturalOverrideKey(type) { return ALT_FURN_ON ? type + ':alt' : type; }
function furnEntry(type) {
  const def = FURN_FILE_BUILTIN[type];
  if (!def) return null;
  const file = (ALT_FURN_ON && FURN_ALT_FILE[type]) ? FURN_ALT_FILE[type] : def.file;
  const override = NATURAL_OVERRIDES[naturalOverrideKey(type)];
  return { file, natural: override || def.natural, dir: def.dir || 'furniture' };
}
const FURN_IMG = {};   // type → { img, ready, natural, file }
function getFurnImg(type) {
  const def = furnEntry(type);
  if (!def) return null;
  const cur = FURN_IMG[type];
  if (cur && cur.file === def.file) { cur.natural = def.natural; return cur; }
  const img = new Image();
  const entry = { img, ready: false, natural: def.natural, file: def.file };
  FURN_IMG[type] = entry;
  img.onload  = () => { entry.ready = true; draw(); };
  img.onerror = () => { entry.ready = false; };
  img.src = `/assets/${def.dir || 'furniture'}/${def.file}`;
  return entry;
}
function insetForBbox(cellsW, cellsH) {
  const set = ALT_FURN_ON ? FURN_INSETS_ALT : FURN_INSETS_CANON;
  const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
  if (mx <= 1) return set.small;
  if (mn <= 1) return set.linear;
  if (mn === 2 && mx === 2) return set.stair;
  return set.block;
}
function drawFurnIcon(type, px, py, pw, ph, facing, flipH, flipV) {
  const entry = getFurnImg(type);
  if (!entry || !entry.ready) return false;
  const img = entry.img;
  const facingA  = (facing != null) ? (FACING_RAD_E[facing] || 0) : 0;
  const naturalA = FACING_RAD_E[entry.natural] || 0;
  let angle = facingA - naturalA;
  while (angle >  Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  const transverse = (Math.abs(angle - Math.PI / 2) < 1e-6
                   || Math.abs(angle + Math.PI / 2) < 1e-6);
  const cellsW = Math.max(1, Math.round(pw / CELL));
  const cellsH = Math.max(1, Math.round(ph / CELL));
  const inset  = insetForBbox(cellsW, cellsH);
  const slotW = (transverse ? ph : pw) - 2 * inset;
  const slotH = (transverse ? pw : ph) - 2 * inset;
  const ar = img.naturalWidth / img.naturalHeight;
  let drawW = slotW, drawH = slotW / ar;
  if (drawH > slotH) { drawH = slotH; drawW = slotH * ar; }
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  const needsTransform = Math.abs(angle) > 1e-6 || sx !== 1 || sy !== 1;
  if (!needsTransform) {
    ctx.drawImage(img, px + (pw - drawW) / 2, py + (ph - drawH) / 2, drawW, drawH);
  } else {
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    if (Math.abs(angle) > 1e-6) ctx.rotate(angle);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
  return true;
}

// =====================================================================
// QUEST LOAD
// =====================================================================
async function loadQuestIndex() {
  setStatus('Loading quest index…');
  const r = await fetch('/api/quests');
  const j = await r.json();
  // Server returns { quests: [...] } — defensively support either shape
  state.questIndex = Array.isArray(j) ? j : (j.quests || []);
  renderQuestList();
  setStatus(`Ready — ${state.questIndex.length} quests.`);
  if (state.questIndex.length) loadQuest(state.questIndex[0].file);
}

async function loadQuest(file) {
  setStatus('Loading ' + file + '…');
  const r = await fetch('/api/quests/' + encodeURIComponent(file));
  if (!r.ok) { setStatus('Failed to load ' + file); return; }
  state.quest = await r.json();
  state.questFile = file;
  state.selected = null;
  $('quest-title').textContent = state.quest.title || state.quest.id || file;
  $('quest-meta').textContent =
    `${(state.quest.dark || []).length} dark · ` +
    `${(state.quest.doors || []).length} doors · ` +
    `${(state.quest.furniture || []).length} furn · ` +
    `${(state.quest.monsters || []).length} mob`;
  renderQuestList();
  renderInspector();
  draw();
  setStatus('Ready.');
}

function renderQuestList() {
  const ul = $('quest-list');
  ul.innerHTML = '';
  const filt = ($('quest-filter').value || '').toLowerCase();
  for (const q of state.questIndex) {
    if (filt && !((q.title || '').toLowerCase().includes(filt)
               || (q.id    || '').toLowerCase().includes(filt)
               || (q.file  || '').toLowerCase().includes(filt))) continue;
    const li = document.createElement('li');
    li.innerHTML = `<span>${q.title || q.id}</span><span class="qid">${q.file}</span>`;
    if (q.file === state.questFile) li.classList.add('active');
    li.addEventListener('click', () => loadQuest(q.file));
    ul.appendChild(li);
  }
}
$('quest-filter').addEventListener('input', renderQuestList);

function setStatus(s) { $('status').textContent = s; }

// =====================================================================
// EDGE QUERY — walls / doors / openings live BETWEEN cells
// =====================================================================
// Adjacency must be orthogonal. Returns one of:
//   { kind: 'open' }                       — explicit opening
//   { kind: 'door',  door }                — door entry
//   { kind: 'secret', door }               — secret door
//   { kind: 'wall' }                       — explicit or derived wall
//   { kind: 'clear' }                      — no wall (default within room)
function edgeBetween(quest, a, b) {
  if (!HQ.adjacent(a, b)) return { kind: 'clear' };
  // Explicit openings override everything
  for (const op of (quest.openings || [])) {
    if (sameEdge(op, a, b)) return { kind: 'open' };
  }
  // Doors take next priority
  for (const d of (quest.doors || [])) {
    if (sameEdge(d, a, b)) {
      if (d.secret) return { kind: 'secret', door: d };
      return { kind: 'door', door: d };
    }
  }
  // Secret doors as a separate array (legacy field)
  for (const sd of (quest.secretDoors || [])) {
    if (sameEdge(sd, a, b)) return { kind: 'secret', door: sd };
  }
  // Explicit walls
  for (const w of (quest.walls || [])) {
    if (sameEdge(w, a, b)) return { kind: 'wall' };
  }
  // Fallback rule: implicit wall when the two cells have different roomId
  // (or one is dark). This is how the legacy quests were authored.
  const za = zoneOf(quest, a[0], a[1]);
  const zb = zoneOf(quest, b[0], b[1]);
  if (za === 'dark' && zb === 'dark') return { kind: 'clear' };
  if (za === 'dark' || zb === 'dark') return { kind: 'wall' };
  if (za && zb && za !== zb) return { kind: 'wall' };
  return { kind: 'clear' };
}
function sameEdge(e, a, b) {
  return (eq(e.a, a) && eq(e.b, b)) || (eq(e.a, b) && eq(e.b, a));
}
function eq(p, q) { return p && q && p[0] === q[0] && p[1] === q[1]; }

// =====================================================================
// ZONE — which "thing" a cell is part of
//   dark   — out of play
//   room id (e.g. 'r07') — inside that room
//   'corridor' — playable but not in any specific room
// =====================================================================
// Zone for a cell:
//   1. Per-quest dark override (out of play for this quest)
//   2. Master board.yaml room/corridor classification
//   3. Fallback corridor if not found in either
function zoneOf(quest, c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return 'dark';
  for (const [dc, dr] of (quest.dark || []))
    if (dc === c && dr === r) return 'dark';
  const fromMaster = state.zoneMap.get(c + ',' + r);
  if (fromMaster) return fromMaster;
  return 'corridor';
}

// =====================================================================
// RENDER
// =====================================================================
function draw() {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  if (!state.quest) return;
  const q = state.quest;

  // Optional reference photo (decoration). Drawn first so the layered
  // render sits on top of it — toggling other layers off lets you see
  // the printed board behind the data-driven render.
  if (state.layers.reference && REF_IMG && REF_INDEX) {
    drawReferenceOverlay();
  }

  // Floor + room tint per cell ----------------------------------------
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const zone = zoneOf(q, c, r);
      const x = PAD_L + c * CELL, y = PAD_T + r * CELL;
      if (zone === 'dark') {
        if (state.layers.dark) {
          ctx.fillStyle = C.outOfPlay;
          ctx.fillRect(x, y, CELL, CELL);
        }
        continue;
      }
      if (!state.layers.floor) continue;
      // When the texture layer is on, the per-cell sub-sample IS the
      // floor — paint a solid dark base only (so any subpixel seam
      // reads as a thin dark line, not as the procedural stone
      // pattern that doubled the printed-art tile lines).
      if (state.layers.roomTex) {
        ctx.fillStyle = C.outOfPlay;
        ctx.fillRect(x, y, CELL, CELL);
        continue;
      }
      // Base flat-stone floor (only when textures are OFF)
      ctx.fillStyle = C.floor;
      ctx.fillRect(x, y, CELL, CELL);
      // Subtle stone tile pattern (cheap procedural)
      ctx.fillStyle = C.floorHi;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = C.floor;
      ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      // Room tint overlay
      if (state.layers.rooms && zone !== 'corridor') {
        ctx.fillStyle = roomTint(zone) + 'cc';   // alpha hex
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }
    }
  }

  // Room textures — ONE drawImage per room.
  //
  // Previously each cell did its own drawImage with a sub-pixel sample
  // (167/4 = 41.75px slice → 40px cell). That re-discretized the
  // printed art's own tile-divider lines, which no longer aligned with
  // the canvas grid — producing the visible "doubled grid" effect.
  //
  // Now: for each room, blit the WHOLE room_NN.png stretched across
  // the room's pixel bbox, clipped to the actual cell footprint. The
  // texture stays continuous, and L/T/U shapes work because the clip
  // path only includes cells in `room.cells` — the concave notch
  // (which belongs to another room/corridor) is simply not in the clip.
  if (state.layers.roomTex && state.board && state.roomBbox) {
    for (const room of (state.board.rooms || [])) {
      const cells = room.cells || [];
      if (!cells.length) continue;
      const tex = loadRoomTexture(room.id);
      if (!tex.ready || !tex.img) continue;
      const bbox = state.roomBbox[room.id];
      if (!bbox) continue;

      // Clip path = union of all NON-DARK cell rects in this room
      ctx.save();
      ctx.beginPath();
      let any = false;
      for (const [c, r] of cells) {
        if ((q.dark || []).some(([dc, dr]) => dc === c && dr === r)) continue;
        ctx.rect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
        any = true;
      }
      if (!any) { ctx.restore(); continue; }
      ctx.clip();

      // One drawImage stretching the whole PNG to the room bbox area
      const dx = PAD_L + bbox.mc * CELL;
      const dy = PAD_T + bbox.mr * CELL;
      const dw = bbox.spanC * CELL;
      const dh = bbox.spanR * CELL;
      ctx.drawImage(tex.img, 0, 0, tex.img.naturalWidth, tex.img.naturalHeight,
                    dx, dy, dw, dh);
      ctx.restore();
    }

    // Corridor — same approach: one drawImage stretched to the full
    // playable rect, clipped to every non-dark cell that is neither a
    // room nor a quest dark cell.
    const corTex = currentCorridorTexture();
    if (corTex.ready && corTex.img) {
      ctx.save();
      ctx.beginPath();
      let any = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (zoneOf(q, c, r) !== 'corridor') continue;
          ctx.rect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
          any = true;
        }
      }
      if (any) {
        ctx.clip();
        ctx.drawImage(corTex.img,
                      0, 0, corTex.img.naturalWidth, corTex.img.naturalHeight,
                      PAD_L, PAD_T, COLS * CELL, ROWS * CELL);
      }
      ctx.restore();
    }
  }

  // Room-bbox debug outline — strokes the logical cell footprint of
  // each room from board.yaml so we can see whether the room data
  // actually covers what the printed art shows. Useful when textures
  // look "missing squares" (the room data may simply not include them).
  if (state.layers.roomBbox && state.board) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,255,0.9)';
    ctx.fillStyle   = 'rgba(120,200,255,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (const room of (state.board.rooms || [])) {
      const cells = room.cells || [];
      if (!cells.length) continue;
      let mc = 99, mr = 99, xc = -1, xr = -1;
      for (const [c, r] of cells) {
        if (c < mc) mc = c; if (r < mr) mr = r;
        if (c > xc) xc = c; if (r > xr) xr = r;
      }
      const dx = PAD_L + mc * CELL;
      const dy = PAD_T + mr * CELL;
      const dw = (xc - mc + 1) * CELL;
      const dh = (xr - mr + 1) * CELL;
      ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
      // ID label in top-left corner with a dark backing box
      const label = `${room.id} ${xc - mc + 1}x${xr - mr + 1}`;
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(dx + 2, dy + 2, tw, 13);
      ctx.fillStyle = 'rgba(120,200,255,1)';
      ctx.fillText(label, dx + 5, dy + 3);

      // Also outline the individual cells in the room so we can spot
      // non-rectangular footprints (a room whose cells DON'T fill its
      // bbox — those gaps appear inside the dashed bbox).
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(120,200,255,0.45)';
      for (const [c, r] of cells) {
        ctx.strokeRect(PAD_L + c * CELL + 1.5, PAD_T + r * CELL + 1.5,
                       CELL - 3, CELL - 3);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Start cells -------------------------------------------------------
  if (state.layers.start) {
    const starts = q.startCells || q.stairCells || [];
    ctx.fillStyle = C.start;
    for (const [c, r] of starts) {
      ctx.fillRect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
    }
    if (starts.length) {
      let mn = [99, 99], mx = [-1, -1];
      for (const [c, r] of starts) {
        if (c < mn[0]) mn[0] = c; if (r < mn[1]) mn[1] = r;
        if (c > mx[0]) mx[0] = c; if (r > mx[1]) mx[1] = r;
      }
      ctx.strokeStyle = C.startBdr; ctx.lineWidth = 2;
      ctx.strokeRect(PAD_L + mn[0] * CELL + 1, PAD_T + mn[1] * CELL + 1,
                     (mx[0] - mn[0] + 1) * CELL - 2,
                     (mx[1] - mn[1] + 1) * CELL - 2);
    }
  }

  // Rubble / blocked --------------------------------------------------
  if (state.layers.blocked) {
    for (const [c, r] of (q.blocked || [])) {
      const x = PAD_L + c * CELL, y = PAD_T + r * CELL;
      ctx.fillStyle = C.blocked;
      ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      ctx.strokeStyle = C.blockedX; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + CELL - 6, y + CELL - 6);
      ctx.moveTo(x + CELL - 6, y + 6); ctx.lineTo(x + 6, y + CELL - 6);
      ctx.stroke();
    }
  }

  // Furniture — uses the same heroscribe PNG icons + per-bucket
  // insets + per-type natural-orientation overrides as the classic
  // editor (see FURN_FILE_BUILTIN / getFurnImg above). Falls back to
  // a labelled coloured rect only when the image hasn't loaded yet.
  if (state.layers.furn) {
    for (const f of (q.furniture || [])) {
      const cells = f.cells || [];
      if (!cells.length) continue;
      let mn = [99, 99], mx = [-1, -1];
      for (const [c, r] of cells) {
        if (c < mn[0]) mn[0] = c; if (r < mn[1]) mn[1] = r;
        if (c > mx[0]) mx[0] = c; if (r > mx[1]) mx[1] = r;
      }
      const px = PAD_L + mn[0] * CELL;
      const py = PAD_T + mn[1] * CELL;
      const pw = (mx[0] - mn[0] + 1) * CELL;
      const ph = (mx[1] - mn[1] + 1) * CELL;
      // Per-art-set flip: alt mode reads f._altFlipH/V.
      const flipH = ALT_FURN_ON ? !!f._altFlipH : !!f._flipH;
      const flipV = ALT_FURN_ON ? !!f._altFlipV : !!f._flipV;
      const usedImage = drawFurnIcon(f.type, px, py, pw, ph,
                                     f.facing, flipH, flipV);
      if (!usedImage) {
        // Fallback while the PNG is still loading or the type has no
        // canonical asset (e.g. an expansion piece): coloured rect +
        // label so the editor still shows SOMETHING placed.
        const x = px + 4, y = py + 4, w = pw - 8, h = ph - 8;
        ctx.fillStyle = C.furn;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = C.furnEdge; ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = C.furnEdge;
        ctx.font = 'bold 9px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((f.type || '').slice(0, 4).toUpperCase(),
                     x + w / 2, y + h / 2);
      }
    }
  }

  // ===== EDGE LAYER — walls / doors / secret doors ===================
  // For every adjacency we ask edgeBetween(); render only NON-clear
  // edges. Each horizontal edge sits at y = PAD_T + r·CELL; each
  // vertical edge at x = PAD_L + c·CELL.
  if (state.layers.walls || state.layers.doors) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // East edge: between (c, r) and (c+1, r)
        if (c + 1 < COLS) {
          drawEdge(q, [c, r], [c + 1, r], 'vertical');
        }
        // South edge: between (c, r) and (c, r+1)
        if (r + 1 < ROWS) {
          drawEdge(q, [c, r], [c, r + 1], 'horizontal');
        }
      }
    }
    // Outer perimeter walls used to be drawn here as a reference
    // frame. The corridor texture now includes the printed wall
    // stones around the playable area, so the code-drawn outer frame
    // is redundant and has been removed.
  }

  // Monsters ----------------------------------------------------------
  if (state.layers.monsters) {
    for (const m of (q.monsters || [])) {
      const [c, r] = m.at;
      const cx = PAD_L + c * CELL + CELL / 2;
      const cy = PAD_T + r * CELL + CELL / 2;
      ctx.fillStyle = C.monster;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((m.type || '?')[0].toUpperCase(), cx, cy + 1);
    }
  }

  // Traps -------------------------------------------------------------
  if (state.layers.traps) {
    for (const t of (q.traps || [])) {
      const [c, r] = t.at;
      const cx = PAD_L + c * CELL + CELL / 2;
      const cy = PAD_T + r * CELL + CELL / 2;
      ctx.fillStyle = C.trap;
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // Grid overlay (calibration aid). Drawn LAST of the layered renders
  // so it sits on top of every texture/decoration. Black halo under
  // the red line makes it readable against both light and dark
  // backgrounds (parquet, dark stone, etc.).
  if (state.layers.grid) {
    // Halo pass
    ctx.strokeStyle = C.gridHalo; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      ctx.moveTo(PAD_L + c * CELL + 0.5, PAD_T);
      ctx.lineTo(PAD_L + c * CELL + 0.5, PAD_T + ROWS * CELL);
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.moveTo(PAD_L,                  PAD_T + r * CELL + 0.5);
      ctx.lineTo(PAD_L + COLS * CELL,    PAD_T + r * CELL + 0.5);
    }
    ctx.stroke();
    // Red line pass
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      ctx.moveTo(PAD_L + c * CELL + 0.5, PAD_T);
      ctx.lineTo(PAD_L + c * CELL + 0.5, PAD_T + ROWS * CELL);
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.moveTo(PAD_L,                  PAD_T + r * CELL + 0.5);
      ctx.lineTo(PAD_L + COLS * CELL,    PAD_T + r * CELL + 0.5);
    }
    ctx.stroke();
  }

  // Coordinate labels -------------------------------------------------
  if (state.layers.coords) {
    ctx.fillStyle = C.coord;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let c = 0; c < COLS; c++)
      ctx.fillText(String(c + 1), PAD_L + c * CELL + CELL / 2, PAD_T - 2);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let r = 0; r < ROWS; r++)
      ctx.fillText(String(r + 1), PAD_L - 4, PAD_T + r * CELL + CELL / 2);
  }

  // Selection ---------------------------------------------------------
  if (state.selected) {
    const { c, r } = state.selected;
    ctx.fillStyle = C.selected;
    ctx.fillRect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
    ctx.strokeStyle = C.selectedBdr; ctx.lineWidth = 2;
    ctx.strokeRect(PAD_L + c * CELL + 1, PAD_T + r * CELL + 1, CELL - 2, CELL - 2);
  }
}

// Draw the reference photo (board_v2.png via playable.png) aligned to
// the editor grid. Strictly decorative — render math doesn't read it.
function drawReferenceOverlay() {
  const off = REF_INDEX.srcPlayable || { x: 0, y: 0 };
  const cw  = REF_INDEX.cellW || CELL;
  const ch  = REF_INDEX.cellH || CELL;
  const scaleX = CELL / cw;
  const scaleY = CELL / ch;
  const BLACK_MARGIN = 14;  // board_v2.png bakes a 14px black border
  const sx = BLACK_MARGIN;
  const sy = BLACK_MARGIN;
  const sw = REF_IMG.naturalWidth  - 2 * BLACK_MARGIN;
  const sh = REF_IMG.naturalHeight - 2 * BLACK_MARGIN;
  const dx = PAD_L - (off.x - BLACK_MARGIN) * scaleX;
  const dy = PAD_T - (off.y - BLACK_MARGIN) * scaleY;
  const dw = sw * scaleX;
  const dh = sh * scaleY;
  ctx.save();
  ctx.globalAlpha = state.referenceOpacity;
  ctx.drawImage(REF_IMG, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

// Render one edge between two ortho-adjacent cells.
// orient = 'vertical' (east edge of A) | 'horizontal' (south edge of A)
function drawEdge(q, a, b, orient) {
  const e = edgeBetween(q, a, b);
  if (e.kind === 'clear' || e.kind === 'open') return;

  const [c, r] = a;
  const x0 = PAD_L + c * CELL;
  const y0 = PAD_T + r * CELL;

  if (e.kind === 'wall') {
    if (!state.layers.walls) return;
    ctx.fillStyle = C.wall;
    if (orient === 'vertical') {
      ctx.fillRect(x0 + CELL - WALL_THICK / 2, y0, WALL_THICK, CELL);
    } else {
      ctx.fillRect(x0, y0 + CELL - WALL_THICK / 2, CELL, WALL_THICK);
    }
    return;
  }

  if (e.kind === 'door' || e.kind === 'secret') {
    if (!state.layers.doors) return;
    // Draw the wall first (so the door reads as "set into a wall")
    if (state.layers.walls) {
      ctx.fillStyle = C.wall;
      if (orient === 'vertical') {
        ctx.fillRect(x0 + CELL - WALL_THICK / 2, y0, WALL_THICK, CELL);
      } else {
        ctx.fillRect(x0, y0 + CELL - WALL_THICK / 2, CELL, WALL_THICK);
      }
    }
    // Then punch the door pill across the edge
    const isSecret = e.kind === 'secret';
    const isClosed = e.door && e.door.state && e.door.state !== 'open';
    ctx.fillStyle = isSecret ? C.doorSecret : (isClosed ? C.doorClosed : C.door);
    if (orient === 'vertical') {
      const px = x0 + CELL - 7, py = y0 + CELL * 0.25;
      ctx.fillRect(px, py, 14, CELL * 0.5);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, 13, CELL * 0.5 - 1);
    } else {
      const px = x0 + CELL * 0.25, py = y0 + CELL - 7;
      ctx.fillRect(px, py, CELL * 0.5, 14);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, CELL * 0.5 - 1, 13);
    }
  }
}

// Wall along the outer perimeter of the playable area (where a cell
// on the inside is not dark and the implied neighbour outside is).
function drawOuterFrame(q) {
  if (!state.layers.walls) return;
  for (let c = 0; c < COLS; c++) {
    if (zoneOf(q, c, 0) !== 'dark') {
      ctx.fillStyle = C.wall;
      ctx.fillRect(PAD_L + c * CELL, PAD_T - WALL_THICK / 2, CELL, WALL_THICK);
    }
    if (zoneOf(q, c, ROWS - 1) !== 'dark') {
      ctx.fillStyle = C.wall;
      ctx.fillRect(PAD_L + c * CELL, PAD_T + ROWS * CELL - WALL_THICK / 2, CELL, WALL_THICK);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    if (zoneOf(q, 0, r) !== 'dark') {
      ctx.fillStyle = C.wall;
      ctx.fillRect(PAD_L - WALL_THICK / 2, PAD_T + r * CELL, WALL_THICK, CELL);
    }
    if (zoneOf(q, COLS - 1, r) !== 'dark') {
      ctx.fillStyle = C.wall;
      ctx.fillRect(PAD_L + COLS * CELL - WALL_THICK / 2, PAD_T + r * CELL, WALL_THICK, CELL);
    }
  }
}

// =====================================================================
// CLICK → INSPECTOR
// =====================================================================
canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const py = (ev.clientY - rect.top)  * (canvas.height / rect.height);
  const c = Math.floor((px - PAD_L) / CELL);
  const r = Math.floor((py - PAD_T) / CELL);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) { state.selected = null; }
  else { state.selected = { c, r }; }
  renderInspector();
  draw();
});

function renderInspector() {
  const body = $('inspect-body');
  const coord = $('inspect-coord');
  if (!state.selected || !state.quest) {
    coord.textContent = '';
    body.innerHTML = '<div class="empty">Click a cell to see what lives on it and the edges around it.</div>';
    return;
  }
  const { c, r } = state.selected;
  const q = state.quest;
  coord.textContent = `· (${c + 1}, ${r + 1})`;
  const lines = [];
  const zone = zoneOf(q, c, r);
  lines.push(row('Zone', zone));
  // Cell contents
  const items = [];
  for (const f of (q.furniture || [])) {
    if ((f.cells || []).some(([cc, rr]) => cc === c && rr === r))
      items.push(`furniture ${f.type}#${f.id || '?'}`);
  }
  for (const m of (q.monsters || [])) {
    if (eq(m.at, [c, r])) items.push(`monster ${m.type}#${m.id || '?'}`);
  }
  for (const t of (q.traps || [])) {
    if (eq(t.at, [c, r])) items.push(`trap ${t.type || 'pit'}`);
  }
  for (const cell of (q.blocked || [])) {
    if (eq(cell, [c, r])) items.push('rubble (blocked)');
  }
  if ((q.startCells || q.stairCells || []).some(cc => eq(cc, [c, r])))
    items.push('start / stair');
  lines.push(row('Contents', items.length ? items.join(' · ') : '—'));

  // Edges around this cell
  const edges = [];
  const dirs = [
    [[-1, 0], 'west'], [[1, 0], 'east'],
    [[0, -1], 'north'], [[0, 1], 'south'],
  ];
  for (const [[dc, dr], name] of dirs) {
    const nb = [c + dc, r + dr];
    if (nb[0] < 0 || nb[0] >= COLS || nb[1] < 0 || nb[1] >= ROWS) continue;
    const e = edgeBetween(q, [c, r], nb);
    if (e.kind === 'clear') continue;
    let descr = e.kind;
    if (e.kind === 'door' && e.door) descr += ` (${e.door.state || 'closed'})`;
    edges.push(`${name}: ${descr}`);
  }
  let html = lines.join('');
  if (edges.length) {
    html += `<div class="group"><div class="group-title">Edges</div>` +
            edges.map(e => `<div class="row"><span class="val" style="grid-column:1/-1">${e}</span></div>`).join('') +
            `</div>`;
  }
  body.innerHTML = html;
}

function row(lbl, val) {
  return `<div class="row"><span class="lbl">${lbl}</span><span class="val">${val}</span></div>`;
}

// ---- Wire layer toggles -------------------------------------------------
for (const k of Object.keys(state.layers)) {
  const el = $('layer-' + k);
  if (!el) continue;
  el.checked = state.layers[k];
  el.addEventListener('change', () => {
    state.layers[k] = el.checked;
    draw();
  });
}

// Opacity slider for the reference-photo layer
const opSlider = $('layer-reference-opacity');
if (opSlider) {
  opSlider.addEventListener('input', () => {
    state.referenceOpacity = Math.max(0.1, Math.min(1, parseInt(opSlider.value, 10) / 100));
    if (state.layers.reference) draw();
  });
}

// Texture-scale slider for the per-room textures layer
const tsSlider = $('layer-roomTex-scale');
const tsVal    = $('layer-roomTex-scale-val');
if (tsSlider) {
  tsSlider.addEventListener('input', () => {
    const pct = parseInt(tsSlider.value, 10);
    state.textureScale = Math.max(0.5, Math.min(2, pct / 100));
    if (tsVal) tsVal.textContent = pct + '%';
    if (state.layers.roomTex) draw();
  });
}

// Corridor variant toggle (corridor.png vs corridor_no_walls.png)
const cwToggle = $('layer-corridorWalls');
if (cwToggle) {
  cwToggle.checked = state.corridorWalls;
  cwToggle.addEventListener('change', () => {
    state.corridorWalls = cwToggle.checked;
    if (state.layers.roomTex) draw();
  });
}

// Alt furniture art toggle — shared with the editor + game via
// localStorage `hq_furn_alt_v1`.
const altFurnToggle = $('layer-altFurn');
if (altFurnToggle) {
  altFurnToggle.checked = ALT_FURN_ON;
  altFurnToggle.addEventListener('change', () => {
    ALT_FURN_ON = altFurnToggle.checked;
    try { localStorage.setItem(FURN_ALT_KEY, ALT_FURN_ON ? '1' : '0'); } catch {}
    draw();
  });
}

// ---- Boot ---------------------------------------------------------------
(async () => {
  await loadMasterBoard();
  loadReferenceImage();      // async, drawn whenever it lands + toggle is on
  await loadQuestIndex();
})();
