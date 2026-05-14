/* =========================================================================
 * HeroQuest map editor — standalone in-browser tool
 *
 * Loads quests from /api/quests, renders to a canvas (style matches the
 * offline scripts/render-quest-maps.js renderer), supports click-select,
 * rotation, nudge, delete, undo/redo and atomic save back to disk via
 * PUT /api/quests/<file>.
 *
 * Lives at /map-editor.html. Independent of the in-game client.js.
 * =========================================================================*/

(() => {
'use strict';

// ---- Board geometry (must match scripts/render-quest-maps.js) -----------
const COLS = 26;
const ROWS = 19;
// Match the floor-texture source cell pitch closely. playable.png is
// the full board_v2.png (1150×843) but cells sub-sample from the
// playable region inside the wall frame: srcPlayable.x=55, y=42,
// cell pitch 40 × 39.95. Editor CELL = 40 keeps 1:1 with the source
// so grid lines, walls, dark cells, and furniture overlays land
// exactly on the printed cell boundaries.
const CELL = 40;
const PAD_L = 36;
const PAD_T = 36;
// Right / bottom pads enlarged to fit the printed stone-wall frame of
// the board image (~55 px horizontal / 42 px vertical) that draws
// outside the playable grid when the floors layer is on. Left/top
// walls clip slightly into the label margin; right/bottom are fully
// visible.
const PAD_R = 64;
const PAD_B = 52;
const W = PAD_L + COLS * CELL + PAD_R;
const H = PAD_T + ROWS * CELL + PAD_B;

// ---- Furniture natural footprints (mirrors data/pieces/canonical-pieces.yaml)
// Used to recompute cells when rotating.
const FURN_NATURAL = {
  'tomb':            { w: 2, h: 3 },
  'sorcerer-table':  { w: 3, h: 2 },
  'alchemist-table': { w: 3, h: 2 },
  'table':           { w: 3, h: 2 },
  'bookcase':        { w: 3, h: 1 },
  'cupboard':        { w: 3, h: 1 },
  'fireplace':       { w: 3, h: 1 },
  'weapon-rack':     { w: 3, h: 1 },
  'rack':            { w: 2, h: 3 },
  'stairway':        { w: 2, h: 2 },
  'throne':          { w: 1, h: 1 },
  'chest':           { w: 1, h: 1 },
  'altar':           { w: 1, h: 1 },
  'block':           { w: 1, h: 1 },
};

// ---- Palette (matches the offline renderer for visual consistency) -----
const C = {
  bg:        '#000000',          // canvas frame — black so the play
                                  // area sits on a void backdrop instead
                                  // of cream parchment leaking through.
  outOfPlay: '#000000',          // out-of-play / dark cells — black to
                                  // match the canvas frame; previously
                                  // #281e14 dark brown.
  floor:     '#6e6258',           // neutral stone-grey — was cream #e1d2af,
                                  // which showed through tiny subpixel
                                  // gaps between floor texture cells and
                                  // gave the whole render a yellow cast.
  corridor:  '#9b8f7f',           // neutral mortar-grey (was sand #cbb588)
  room:      '#ead7af',           // room base — slightly lighter than corridor
  roomBdr:   '#9a7a4a',           // room outline
  wall:      '#e6d9bd',           // cream wall — matches builder + printed art
  blocked:   '#78695a',
  blockedX:  '#46372d',
  grid:      '#c8b48c',
  start:     '#b4dcff',
  startBdr:  '#3c6eb4',
  door:      '#aa6e32',
  doorBdr:   '#503214',
  secretDoor:'#c828c8',
  trap:      '#dc1e1e',
  treasure:  '#f0c83c',
  treasureBdr:'#8c6400',
  npc:       '#3cc85a',
  title:     '#281e14',
  legend:    '#1e1e1e',
  furn: {
    'tomb':            '#6e5a46',
    'sorcerer-table':  '#783ca0',
    'alchemist-table': '#b43c64',
    'table':           '#96693c',
    'bookcase':        '#503c28',
    'cupboard':        '#6e5032',
    'fireplace':       '#c8501e',
    'weapon-rack':     '#505064',
    'rack':            '#505064',
    'chest':           '#b48c3c',
    'throne':          '#783c78',
    'altar':           '#c8c8dc',
    'stairway':        '#4682c8',
    'door':            '#aa6e32',
    'block':           '#6e6959',
  },
  monster: {
    'goblin':         '#50a03c',
    'orc':            '#327832',
    'fimir':          '#b45028',
    'familiar':       '#b45028',   // legacy name for fimir / abomination
    'skeleton':       '#f0f0dc',
    'zombie':         '#829664',
    'mummy':          '#c8b482',
    'chaos-warrior':  '#3c3c50',
    'chaos-sorcerer': '#7828a0',
    'dread-sorcerer': '#7828a0',
    'gargoyle':       '#5a5a6e',
    'dread-warrior':  '#28283c',
    'abomination':    '#a01e1e',
    'verag':          '#464682',
  },
};
const FURN_LABEL = {
  'tomb':'TOMB','sorcerer-table':'SORC','alchemist-table':'ALCH',
  'table':'TBL','bookcase':'BOOK','cupboard':'CUPB','fireplace':'FIRE',
  'weapon-rack':'RACK','rack':'RACK','chest':'CH','throne':'THRN',
  'altar':'ALTR','stairway':'STRS','block':'BLOK',
};
const MONSTER_LETTER = {
  'goblin':'G','orc':'O','fimir':'F','familiar':'F','skeleton':'S','zombie':'Z',
  'mummy':'M','chaos-warrior':'C','chaos-sorcerer':'X','dread-sorcerer':'X',
  'gargoyle':'V','dread-warrior':'D','abomination':'A',
};

// Canonical token art — same mapping the live game uses (client.js).
// Editor renders these as round PNG tokens at each monster's cell so
// the editor's preview matches what players will see in-game. Falls
// back to the coloured-circle + letter glyph if the PNG fails to load.
const MONSTER_TYPE_FILE = {
  'goblin':         'Goblin-Token.png',
  'orc':            'Orc-Token.png',
  'skeleton':       'Skeleton-Token.png',
  'zombie':         'Zombie-Token.png',
  'mummy':          'Mummy-Token.png',
  'gargoyle':       'Gargoyle-Token.png',
  'chaos-warrior':  'Dread-Warrior-Token.png',
  'chaos-sorcerer': 'Dread-Sorcerer-Token.png',
  'fimir':          'Abomination-Token.png',
  'dread-warrior':  'Dread-Warrior-Token.png',
  'dread-sorcerer': 'Dread-Sorcerer-Token.png',
  'abomination':    'Abomination-Token.png',
  // Boss aliases
  'verag':          'Gargoyle-Token.png',
  'ulag':           'Orc-Token.png',
  'grak':           'Goblin-Token.png',
  'balur':          'Dread-Warrior-Token.png',
  'witch-lord':     'Mummy-Token.png',
};
const HERO_FILE = {
  barbarian: 'Barbarian.png',
  dwarf:     'Dwarf.png',
  elf:       'Elf.png',
  wizard:    'Wizard.png',
};
const HERO_NAMES = { barbarian: 'Barbarian', dwarf: 'Dwarf', elf: 'Elf', wizard: 'Wizard' };
const HERO_ORDER = ['barbarian', 'dwarf', 'elf', 'wizard'];

const monsterSprites = {};
const heroSprites = {};
function _trySprite(map, key, url) {
  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth > 0) { map[key] = img; draw(); }
  };
  img.onerror = () => { /* missing — fall back */ };
  img.src = url;
}
(function loadTokenSprites() {
  for (const [type, file] of Object.entries(MONSTER_TYPE_FILE)) {
    _trySprite(monsterSprites, type, `/assets/monsters/${file}`);
  }
  for (const [id, file] of Object.entries(HERO_FILE)) {
    _trySprite(heroSprites, id, `/assets/heros/${file}`);
  }
  for (const id of Object.keys(HERO_NAMES)) {
    _trySprite(heroSprites, id + ':male',
               `/assets/heros/${HERO_NAMES[id]}-Male-Token.png`);
    _trySprite(heroSprites, id + ':female',
               `/assets/heros/${HERO_NAMES[id]}-Female-Token.png`);
  }
})();
// Every furniture type is rotatable in the editor — heroscribe icons all
// have a defined natural orientation, so rotating any piece (including
// 1×1 pieces like throne/chest) just updates the facing field.
const ROTATABLE_FURN = new Set([
  'throne', 'weapon-rack', 'rack', 'tomb', 'sarcophagus',
  'sorcerer-table', 'sorcerers-table',
  'alchemist-table', 'alchemist-bench', 'alchemists-bench',
  'table', 'bookcase', 'cupboard', 'fireplace', 'stairway',
  'chest', 'altar',
]);

// ---- Heroscribe canonical icons + per-type natural override -----------
// Furniture metadata lives in /api/canonical-pieces (sourced from
// data/pieces/canonical-pieces.yaml). We fetch it at boot and rebuild the
// flat per-type lookup table the rest of this file expects. While
// the fetch is in flight, the hardcoded FALLBACK below keeps the
// editor functional — same shape as the YAML resolves to.
const FURN_FILE_FALLBACK = {
  'tomb':              { file: 'Tomb.png',            natural: 'downward' },
  'sarcophagus':       { file: 'Tomb.png',            natural: 'downward' },
  'sorcerer-table':    { file: 'SorcerersTable.png',  natural: 'downward' },
  'sorcerers-table':   { file: 'SorcerersTable.png',  natural: 'downward' },
  'alchemist-table':   { file: 'AlchemistsBench.png', natural: 'upward' },
  'alchemist-bench':   { file: 'AlchemistsBench.png', natural: 'upward' },
  'alchemists-bench':  { file: 'AlchemistsBench.png', natural: 'upward' },
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
// Alt-art fallback (sized-name icons). Populated by canonicalPieces
// when present; kept here so the toggle still has something to swap
// to while the fetch is pending.
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
// Live tables, possibly replaced by canonical-pieces fetch.
let FURN_FILE_BUILTIN = { ...FURN_FILE_FALLBACK };
let FURN_ALT_FILE     = { ...FURN_ALT_FILE_FALLBACK };

// Rebuild the flat per-type lookup from canonical-pieces YAML data.
// Each PascalCase piece entry contributes one row per alias.
function applyCanonicalPieces(yaml) {
  const pieces = (yaml && yaml.pieces) || {};
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
    // Invalidate cached natural so the next paint re-resolves.
    for (const t of Object.keys(FURN_IMG || {})) {
      if (FURN_IMG[t]) FURN_IMG[t].natural = (flat[t] && flat[t].natural) || 'downward';
    }
    if (typeof draw === 'function') draw();
    if (typeof renderNaturalList === 'function') {
      try { renderNaturalList(); } catch {}
    }
  }
}
(async () => {
  try {
    const r = await fetch('/api/canonical-pieces');
    if (r.ok) applyCanonicalPieces(await r.json());
  } catch { /* offline → keep fallback */ }
})();

// Natural-orientation overrides — persisted to data/pieces/furniture-naturals.json
// via the /api/furn-naturals endpoint. localStorage is kept as a warm
// cache so the panel renders something on first paint before the GET
// completes; it's also broadcast on `storage` so other tabs (the live
// game) can react without a refetch.
const NATURAL_LS_KEY = 'hq_furn_natural_overrides_v1';
function loadNaturalOverridesLocal() {
  try { return JSON.parse(localStorage.getItem(NATURAL_LS_KEY) || '{}') || {}; }
  catch { return {}; }
}
function cacheNaturalOverridesLocal(map) {
  localStorage.setItem(NATURAL_LS_KEY, JSON.stringify(map));
}
async function fetchNaturalOverrides() {
  try {
    const r = await fetch('/api/furn-naturals');
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function saveNaturalOverrides(map) {
  cacheNaturalOverridesLocal(map);
  try {
    const r = await fetch('/api/furn-naturals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(map),
    });
    if (!r.ok) { setStatus('Save failed: ' + r.status); return false; }
    return true;
  } catch (e) {
    setStatus('Save failed: ' + e.message);
    return false;
  }
}
let NATURAL_OVERRIDES = loadNaturalOverridesLocal();

// Alternate furniture art — sized-name files in /assets/furniture/
// (Tomb-2x3.png, Bookcase-1x3.png, etc.). FURN_ALT_FILE is now
// populated by the canonical-pieces fetch at boot (defined near
// FURN_FILE_BUILTIN above) and the FURN_ALT_FILE_FALLBACK keeps the
// toggle functional while the fetch is pending. Toggleable via the
// "Alt furniture art" preference (shared with the builder + live
// game so all three surfaces stay visually consistent). Types
// without an alt PNG fall through to the canonical file.
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
    if (state && state._refreshFurnInsetSliders) state._refreshFurnInsetSliders();
    try { renderNaturalList(); } catch {}
    try { refreshSelectionPanel(); } catch {}
    draw();
  }
});

// Effective entry for a type — picks alt file when the preference is
// on (with canonical fallback), then overlays the per-type natural
// orientation override. Natural overrides are STORED per art set so
// the two art styles can have different orientations: the alt key is
// `${type}:alt`, canonical is plain `${type}`.
function naturalOverrideKey(type) { return ALT_FURN_ON ? type + ':alt' : type; }
function furnEntry(type) {
  const def = FURN_FILE_BUILTIN[type];
  if (!def) return null;
  const file = (ALT_FURN_ON && FURN_ALT_FILE[type]) ? FURN_ALT_FILE[type] : def.file;
  const override = NATURAL_OVERRIDES[naturalOverrideKey(type)];
  return { file, natural: override || def.natural, dir: def.dir || 'furniture' };
}

const FACING_RAD_E = {
  downward:  0,
  upward:    Math.PI,
  leftward:  -Math.PI / 2,
  rightward:  Math.PI / 2,
};

// Allowed values for the natural-orientation override panel — needs to
// be defined BEFORE init() runs (which happens at the bottom of the
// IIFE, but synchronously calls bindUi → renderNaturalList).
const NATURAL_OPTS = ['downward', 'upward', 'leftward', 'rightward'];

const FURN_IMG = {};   // type → { img, ready, natural } | null
function getFurnImg(type) {
  const def = furnEntry(type);
  if (!def) return null;
  // Re-key cache by both file AND natural so a natural change forces
  // re-evaluation (we don't reload the bytes — we just read the cache
  // entry's `natural`, which we update on override change).
  const cur = FURN_IMG[type];
  if (cur && cur.file === def.file) {
    cur.natural = def.natural;        // refresh natural (may have changed)
    return cur;
  }
  const img = new Image();
  const entry = { img, ready: false, natural: def.natural, file: def.file };
  FURN_IMG[type] = entry;
  img.onload  = () => { entry.ready = true; draw(); };
  img.onerror = () => { entry.ready = false; };
  img.src = `/assets/${def.dir || 'furniture'}/${def.file}`;
  return entry;
}

// ----- Floor textures (per-room PNGs + corridor PNG) ----------------
// Each room has its own hand-prepared texture at
// /assets/room_textures/room_NN.png that covers the room's full cell
// footprint uniformly. Corridors share one image (corridor.png or
// corridor_no_walls.png, toggled live) stretched across the playable
// rect. Both are rendered "blit once + clip to actual cell
// footprint" so L/T/U-shaped rooms paint correctly and the printed
// art's tile-divider lines stay continuous within each region.
const FLOORS_VER = 3;   // bump together with map-editor.js cache version

function roomTextureFile(roomId) {
  const m = String(roomId).match(/(\d+)/);
  if (!m) return null;
  return `room_${m[1].padStart(2, '0')}.png`;
}

const ROOM_TEX = {};   // roomId → { img, ready }
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

// ----- Tile icons (rubble + traps + stairway) -----------------------
// Sourced from /api/canonical-tiles (data/tiles/canonical-tiles.yaml).
// The hardcoded FALLBACK keeps things rendering before the fetch lands.
// Two file maps + two image caches, mirroring the furniture path:
// ALT_FURN_ON drives both, so toggling the alt-art pref swaps tiles +
// furniture together.
let TILE_FILE = {
  'rubble':         'SingleBlockedSquare.png',
  'rubble-double':  'DoubleBlockedSquare.png',
  'falling-block':  'FallingRock.png',
  'block':          'FallingRock.png',
  'pit':            'PitTrap.png',
  'spear':          'SpearTrap.png',
  'spear-trap':     'SpearTrap.png',
  'pit-trap':       'PitTrap.png',
  'chest-trap':     'TreasureChestTrap.png',
  'stairway':       'Stairway.png',
};
let TILE_FILE_ALT = {
  'rubble':         'Block-Square-Single.png',
  'rubble-double':  'Double-Block-Tile.png',
  'stairway':       'Stair-way.png',
};
function applyCanonicalTiles(yaml) {
  const tiles = (yaml && yaml.tiles) || {};
  const flat = {};
  const alt  = {};
  for (const tileId of Object.keys(tiles)) {
    const t = tiles[tileId] || {};
    if (!t.file || !Array.isArray(t.aliases)) continue;
    for (const alias of t.aliases) {
      flat[alias] = t.file;
      if (t.altFile) alt[alias] = t.altFile;
    }
  }
  if (Object.keys(flat).length) {
    TILE_FILE = flat;
    TILE_FILE_ALT = alt;
    // Wipe both caches so the next draw re-resolves.
    for (const k of Object.keys(TILE_IMG || {}))     delete TILE_IMG[k];
    for (const k of Object.keys(TILE_IMG_ALT || {})) delete TILE_IMG_ALT[k];
    if (typeof draw === 'function') draw();
  }
}
(async () => {
  try {
    const r = await fetch('/api/canonical-tiles');
    if (r.ok) applyCanonicalTiles(await r.json());
  } catch { /* offline → keep fallback */ }
})();
const TILE_IMG     = {};
const TILE_IMG_ALT = {};
function getTileImg(kind) {
  const useAlt = ALT_FURN_ON && !!TILE_FILE_ALT[kind];
  const cache = useAlt ? TILE_IMG_ALT : TILE_IMG;
  if (cache[kind] !== undefined) return cache[kind];
  const fn = useAlt ? TILE_FILE_ALT[kind] : TILE_FILE[kind];
  if (!fn) { cache[kind] = null; return null; }
  const img = new Image();
  const entry = { img, ready: false };
  cache[kind] = entry;
  img.onload  = () => { entry.ready = true; draw(); };
  img.onerror = () => { cache[kind] = null; };
  img.src = `/assets/tiles/${fn}`;
  return entry;
}
function drawTileIcon(kind, px, py, pw, ph) {
  const e = getTileImg(kind);
  if (!e || !e.ready) return false;
  const img = e.img;
  const cellsW = Math.max(1, Math.round(pw / CELL));
  const cellsH = Math.max(1, Math.round(ph / CELL));
  const inset  = tileInsetForBbox(cellsW, cellsH);
  const slotW = pw - 2 * inset;
  const slotH = ph - 2 * inset;
  const ar = img.naturalWidth / img.naturalHeight;
  let drawW = slotW, drawH = slotW / ar;
  if (drawH > slotH) { drawH = slotH; drawW = slotH * ar; }
  ctx.drawImage(img, px + (pw - drawW) / 2, py + (ph - drawH) / 2, drawW, drawH);
  return true;
}

// Per-shape inset (px gap between icon and cell wall). Four buckets:
//   small  — 1×1 pieces (throne, chest, altar)
//   linear — Nx1 / 1xN pieces (bookcase, cupboard, fireplace, weapon-rack)
//   stair  — 2×2 pieces (specifically the stair tile)
//   block  — bigger rectangles (tomb 2×3, table 3×2, rack 2×3, etc.)
// Each bucket has its own slider in the inspector panel; values
// persist to localStorage and the live game reads the same key.
// Per-art-set insets: canonical and alt art use different proportions
// so they need independent padding values. Each set persists to its
// own localStorage key; the sliders write into the ACTIVE set (chosen
// by ALT_FURN_ON), so toggling the art set also swaps which numbers
// the sliders + game read.
const FURN_INSETS_LS_KEY     = 'hq_furn_insets_v2';     // canonical
const FURN_INSETS_ALT_LS_KEY = 'hq_furn_insets_alt_v1'; // alt
const DEFAULT_INSETS = { small: 5, linear: 5, stair: 6, block: 12 };
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
const FURN_INSETS_CANON = _readInsetsFrom(FURN_INSETS_LS_KEY);
const FURN_INSETS_ALT   = _readInsetsFrom(FURN_INSETS_ALT_LS_KEY);
function activeInsets() { return ALT_FURN_ON ? FURN_INSETS_ALT : FURN_INSETS_CANON; }
function activeInsetsKey() { return ALT_FURN_ON ? FURN_INSETS_ALT_LS_KEY : FURN_INSETS_LS_KEY; }
function setFurnInset(bucket, v) {
  const set = activeInsets();
  set[bucket] = Math.max(0, Math.min(20, v));
  localStorage.setItem(activeInsetsKey(), JSON.stringify(set));
  draw();
}
// Categorise a piece by its on-screen bbox (in cells). 1×1 → small,
// thin Nx1 strips → linear, exactly 2×2 → stair, anything else → block.
function insetForBbox(cellsW, cellsH) {
  const set = activeInsets();
  const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
  if (mx <= 1) return set.small;
  if (mn <= 1) return set.linear;
  if (mn === 2 && mx === 2) return set.stair;
  return set.block;
}

// Same idea, but for tile icons (rubble, traps). Stairway now flows
// through the furniture path so it uses FURN_INSETS.block, not the
// tile insets — but the linear/block buckets stay so we can add e.g.
// double-blocked rubble or 2×2 trap effects later.
const TILE_INSETS_LS_KEY = 'hq_tile_insets_v1';
const DEFAULT_TILE_INSETS = { small: 4, linear: 4, block: 6 };
function _readTileInsets() {
  try {
    const j = JSON.parse(localStorage.getItem(TILE_INSETS_LS_KEY) || '{}');
    const clamp = v => Math.max(0, Math.min(20, parseInt(v, 10) || 0));
    return {
      small:  Number.isFinite(j.small)  ? clamp(j.small)  : DEFAULT_TILE_INSETS.small,
      linear: Number.isFinite(j.linear) ? clamp(j.linear) : DEFAULT_TILE_INSETS.linear,
      block:  Number.isFinite(j.block)  ? clamp(j.block)  : DEFAULT_TILE_INSETS.block,
    };
  } catch { return { ...DEFAULT_TILE_INSETS }; }
}
let TILE_INSETS = _readTileInsets();
function setTileInset(bucket, v) {
  TILE_INSETS[bucket] = Math.max(0, Math.min(20, v));
  localStorage.setItem(TILE_INSETS_LS_KEY, JSON.stringify(TILE_INSETS));
  draw();
}
function tileInsetForBbox(cellsW, cellsH) {
  const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
  if (mx <= 1) return TILE_INSETS.small;
  if (mn <= 1) return TILE_INSETS.linear;
  return TILE_INSETS.block;
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

// ---- DOM refs -----------------------------------------------------------
const $ = id => document.getElementById(id);
const canvas = $('board');
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d');

// ---- Editor state -------------------------------------------------------
const state = {
  list: [],            // {file, id, title, subtitle, category}
  current: null,       // current file
  quest: null,         // current quest JSON (mutated in place)
  board: null,         // master board: { boardSize, corridorCells, rooms[] }
  zoneOf: null,        // (c,r) → 'corridor' | <roomId> | null   (precomputed)
  roomMeta: null,      // roomId → { id, name, color, cells, bbox? }
  selection: null,     // { kind, index, ref }
  dirty: false,
  history: [],         // stack of JSON snapshots
  histIdx: -1,
  layers: {
    grid: true, coords: true, furniture: true, doors: true,
    secret: true, monsters: true, treasure: true, traps: true,
    blocked: true, start: true, heroes: true, darkmask: true,
    walls: true, rooms: true, roomLabels: true,
    floors: true,
  },
  corridorWalls: false,  // false → corridor_no_walls.png (default); true → corridor.png
  roomBbox: {},         // roomId → { mc, mr, xc, xr, spanC, spanR }
  lightWalls: true,     // true → cream filled rects, false → legacy dark stroke
  outerWalls: true,     // true → draw floor↔dark perimeter walls
};

// Wall-style preferences shared with the live game via localStorage —
// toggling in either place syncs the other tab through `storage` events.
const LIGHT_WALLS_KEY = 'hq_light_walls_v1';
const OUTER_WALLS_KEY = 'hq_outer_walls_v1';
state.lightWalls = (() => {
  try {
    const v = localStorage.getItem(LIGHT_WALLS_KEY);
    return v == null ? true : v === '1';
  } catch { return true; }
})();
state.outerWalls = (() => {
  try {
    const v = localStorage.getItem(OUTER_WALLS_KEY);
    return v == null ? true : v === '1';
  } catch { return true; }
})();
window.addEventListener('storage', (e) => {
  if (e.key === LIGHT_WALLS_KEY) {
    state.lightWalls = e.newValue === '1' || e.newValue == null;
    const el = document.getElementById('layer-lightWalls');
    if (el) el.checked = state.lightWalls;
    draw();
  } else if (e.key === OUTER_WALLS_KEY) {
    state.outerWalls = e.newValue === '1' || e.newValue == null;
    const el = document.getElementById('layer-outerWalls');
    if (el) el.checked = state.outerWalls;
    draw();
  }
});

// ===== INIT ==============================================================
init().catch(err => {
  console.error('[map-editor] init failed:', err);
  try { setStatus('init failed: ' + (err && err.message || err)); } catch {}
});

async function init() {
  console.log('[map-editor] booting (v3 — server-side naturals)');
  // Server-stored naturals are the source of truth; merge over the
  // localStorage cache so we render correctly even if the GET errors.
  const remote = await fetchNaturalOverrides();
  if (remote && typeof remote === 'object') {
    NATURAL_OVERRIDES = remote;
    cacheNaturalOverridesLocal(remote);
  }
  // Texture system now lazy-loads per-room PNGs and the corridor PNG
  // on first draw() — no upfront index fetch needed.
  try { bindUi(); }
  catch (e) { console.error('[map-editor] bindUi threw:', e); throw e; }
  try { await loadBoard(); }
  catch (e) { console.warn('[map-editor] loadBoard failed (non-fatal):', e); }
  try { await loadList(); }
  catch (e) { console.error('[map-editor] loadList failed:', e); throw e; }
  setStatus('Pick a quest from the list.');
  draw();
}

async function loadBoard() {
  try {
    const r = await fetch('/api/board');
    if (!r.ok) return;
    const b = await r.json();
    state.board = b;
    // build zone lookup: corridor cells + room cells
    const zone = new Map();
    for (const [c, r] of (b.corridorCells || [])) zone.set(c + ',' + r, 'corridor');
    const meta = {};
    const bbox = {};
    for (const room of (b.rooms || [])) {
      meta[room.id] = room;
      let mc = 99, mr = 99, xc = -1, xr = -1;
      for (const [c, r] of (room.cells || [])) {
        zone.set(c + ',' + r, room.id);
        if (c < mc) mc = c; if (r < mr) mr = r;
        if (c > xc) xc = c; if (r > xr) xr = r;
      }
      bbox[room.id] = { mc, mr, xc, xr, spanC: xc - mc + 1, spanR: xr - mr + 1 };
    }
    state.zoneOf = (c, r) => zone.get(c + ',' + r) || null;
    state.roomMeta = meta;
    state.roomBbox = bbox;
  } catch (e) { console.warn('board load failed', e); }
}

// ===== UI WIRING =========================================================
function bindUi() {
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-reload').addEventListener('click', () => state.current && loadQuest(state.current, true));
  $('btn-save').addEventListener('click', save);
  $('btn-render-png').addEventListener('click', rerenderPng);
  $('btn-rot-cw').addEventListener('click', () => rotateSelection(+1));
  $('btn-rot-ccw').addEventListener('click', () => rotateSelection(-1));
  $('btn-flip-h').addEventListener('click', () => flipSelection('h'));
  $('btn-flip-v').addEventListener('click', () => flipSelection('v'));
  $('btn-delete').addEventListener('click', deleteSelection);

  $('quest-filter').addEventListener('input', renderList);

  for (const k of Object.keys(state.layers)) {
    const el = $('layer-' + k);
    if (!el) continue;
    el.addEventListener('change', () => { state.layers[k] = el.checked; draw(); });
  }

  // Corridor variant toggle — not a "layer" (it's the source asset
  // choice for the corridor render) so it lives outside state.layers.
  const cwToggle = $('layer-corridorWalls');
  if (cwToggle) {
    cwToggle.checked = state.corridorWalls;
    cwToggle.addEventListener('change', () => {
      state.corridorWalls = cwToggle.checked;
      if (state.layers.floors) draw();
    });
  }

  // Light/dark wall toggle — shared with the live game via localStorage.
  const lwToggle = $('layer-lightWalls');
  if (lwToggle) {
    lwToggle.checked = state.lightWalls;
    lwToggle.addEventListener('change', () => {
      state.lightWalls = lwToggle.checked;
      try { localStorage.setItem(LIGHT_WALLS_KEY, state.lightWalls ? '1' : '0'); } catch {}
      draw();
    });
  }

  // Outer-perimeter wall toggle — shared with the game.
  const owToggle = $('layer-outerWalls');
  if (owToggle) {
    owToggle.checked = state.outerWalls;
    owToggle.addEventListener('change', () => {
      state.outerWalls = owToggle.checked;
      try { localStorage.setItem(OUTER_WALLS_KEY, state.outerWalls ? '1' : '0'); } catch {}
      draw();
    });
  }

  // Alt furniture art toggle — shared with the builder + game. Also
  // refreshes the furniture-inset slider DOM + the natural-orientation
  // panel so the user sees the active art set's tuned values (each
  // art set has its own independent values).
  const altFurnToggle = $('layer-altFurn');
  if (altFurnToggle) {
    altFurnToggle.checked = ALT_FURN_ON;
    altFurnToggle.addEventListener('change', () => {
      ALT_FURN_ON = altFurnToggle.checked;
      try { localStorage.setItem(FURN_ALT_KEY, ALT_FURN_ON ? '1' : '0'); } catch {}
      if (state._refreshFurnInsetSliders) state._refreshFurnInsetSliders();
      renderNaturalList();
      refreshSelectionPanel();
      draw();
    });
  }

  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseup',   onCanvasMouseUp);
  canvas.addEventListener('mouseleave', onCanvasMouseUp);   // catch off-canvas release

  document.addEventListener('keydown', onKeyDown);

  // Natural-orientation playground (changes auto-save to the server)
  renderNaturalList();
  const btnCopy = $('btn-natural-copy');
  if (btnCopy) btnCopy.style.display = 'none';   // legacy — no longer needed
  $('btn-natural-reset').addEventListener('click', resetNaturalOverrides);

  // Layers — show all / hide all shortcuts
  $('layer-all').addEventListener('click', e => {
    e.preventDefault();
    for (const k of Object.keys(state.layers)) {
      const el = $('layer-' + k);
      if (el) { el.checked = true; state.layers[k] = true; }
    }
    draw();
  });
  $('layer-none').addEventListener('click', e => {
    e.preventDefault();
    for (const k of Object.keys(state.layers)) {
      const el = $('layer-' + k);
      if (el) { el.checked = false; state.layers[k] = false; }
    }
    draw();
  });

  // Furniture inset sliders — one per shape bucket. Each slider reads
  // and writes the ACTIVE inset set (canonical or alt depending on
  // ALT_FURN_ON), so flipping art sets gives you independent tuning.
  function refreshFurnInsetSliders() {
    const set = activeInsets();
    for (const bucket of ['small', 'linear', 'stair', 'block']) {
      const el  = $(`furn-inset-${bucket}`);
      const lab = $(`furn-inset-${bucket}-val`);
      if (!el || !lab) continue;
      el.value = String(set[bucket]);
      lab.textContent = `${set[bucket]}px`;
    }
    const tag = $('furn-inset-mode-tag');
    if (tag) tag.textContent = ALT_FURN_ON ? '(alt art)' : '(canonical art)';
  }
  for (const bucket of ['small', 'linear', 'stair', 'block']) {
    const el  = $(`furn-inset-${bucket}`);
    const lab = $(`furn-inset-${bucket}-val`);
    if (!el || !lab) continue;
    el.addEventListener('input', () => {
      setFurnInset(bucket, parseInt(el.value, 10));
      lab.textContent = `${activeInsets()[bucket]}px`;
    });
  }
  refreshFurnInsetSliders();
  // Expose so the alt-furn toggle handler can refresh slider DOM when
  // the active art set changes.
  state._refreshFurnInsetSliders = refreshFurnInsetSliders;

  // Tile inset sliders (rubble + traps)
  for (const bucket of ['small', 'linear', 'block']) {
    const el  = $(`tile-inset-${bucket}`);
    const lab = $(`tile-inset-${bucket}-val`);
    if (!el || !lab) continue;
    el.value = String(TILE_INSETS[bucket]);
    lab.textContent = `${TILE_INSETS[bucket]}px`;
    el.addEventListener('input', () => {
      setTileInset(bucket, parseInt(el.value, 10));
      lab.textContent = `${TILE_INSETS[bucket]}px`;
    });
  }

  window.addEventListener('beforeunload', e => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

// ===== NATURAL-ORIENTATION PLAYGROUND ====================================
// Build a map: file → [type aliases that point to it]. Used so the
// natural panel shows ONE row per icon, and editing it propagates to
// every alias (otherwise an override on `alchemist-bench` wouldn't
// affect quest data that uses `alchemist-table`).
function aliasesByFile() {
  const groups = {};
  for (const type of Object.keys(FURN_FILE_BUILTIN)) {
    const file = FURN_FILE_BUILTIN[type].file;
    (groups[file] = groups[file] || []).push(type);
  }
  return groups;
}

function renderNaturalList() {
  const host = $('natural-list');
  if (!host) return;
  host.innerHTML = '';
  // One row per unique icon file. Representative type = first alias
  // alphabetically (stable + predictable for the UI label).
  const groups = aliasesByFile();
  const reps = Object.keys(groups).sort().map(file => groups[file].slice().sort()[0]);
  for (const rep of reps.sort()) {
    const def = FURN_FILE_BUILTIN[rep];
    const repKey = naturalOverrideKey(rep);
    const cur = NATURAL_OVERRIDES[repKey] || def.natural;
    const isOverride = !!NATURAL_OVERRIDES[repKey];
    const aliases = groups[def.file].slice().sort();
    const aliasNote = aliases.length > 1
      ? ` <span class="hint" style="font-size:10px;">(+${aliases.length - 1} alias${aliases.length > 2 ? 'es' : ''})</span>`
      : '';
    const titleAttr = aliases.length > 1
      ? `aliases: ${aliases.join(', ')} · ${def.file}`
      : def.file;
    const row = document.createElement('div');
    row.className = 'natural-row' + (isOverride ? ' changed' : '');
    row.innerHTML = `
      <code title="${escapeHtml(titleAttr)}">${escapeHtml(rep)}${aliasNote}</code>
      <select data-type="${escapeHtml(rep)}">
        ${NATURAL_OPTS.map(o => `<option value="${o}"${o === cur ? ' selected' : ''}>${o}</option>`).join('')}
      </select>
      <button class="reset-one" data-type="${escapeHtml(rep)}" title="Reset to default (${def.natural})">×</button>
    `;
    host.appendChild(row);
  }
  for (const sel of host.querySelectorAll('select[data-type]')) {
    sel.addEventListener('change', () => onNaturalChange(sel.dataset.type, sel.value));
  }
  for (const btn of host.querySelectorAll('button.reset-one[data-type]')) {
    btn.addEventListener('click', () => onNaturalChange(btn.dataset.type, FURN_FILE_BUILTIN[btn.dataset.type].natural, true));
  }
  // Panel hint shows which art set is being edited.
  const tag = document.getElementById('natural-mode-tag');
  if (tag) tag.textContent = ALT_FURN_ON ? '(alt art)' : '(canonical art)';
}

async function onNaturalChange(type, value, isReset) {
  const def = FURN_FILE_BUILTIN[type];
  if (!def) return;
  // Propagate to every alias pointing at the same file, otherwise a
  // change on one name (e.g. 'alchemist-bench') wouldn't apply to a
  // quest that uses a different alias (e.g. 'alchemist-table').
  const groups = aliasesByFile();
  const aliases = groups[def.file] || [type];
  for (const t of aliases) {
    const k = naturalOverrideKey(t);
    if (isReset || value === FURN_FILE_BUILTIN[t].natural) {
      delete NATURAL_OVERRIDES[k];
      if (FURN_IMG[t]) FURN_IMG[t].natural = FURN_FILE_BUILTIN[t].natural;
    } else {
      NATURAL_OVERRIDES[k] = value;
      if (FURN_IMG[t]) FURN_IMG[t].natural = value;
    }
  }
  renderNaturalList();
  draw();
  setStatus(`saving natural for ${type}${ALT_FURN_ON ? ' (alt)' : ''}…`);
  const ok = await saveNaturalOverrides(NATURAL_OVERRIDES);
  if (ok) setStatus(`Saved · ${type}${ALT_FURN_ON ? ' (alt)' : ''} → ${isReset ? def.natural + ' (reset)' : value} (${aliases.length} alias${aliases.length > 1 ? 'es' : ''})`);
}

async function resetNaturalOverrides() {
  if (!Object.keys(NATURAL_OVERRIDES).length) { setStatus('No overrides to reset.'); return; }
  if (!confirm('Clear all natural-orientation overrides (BOTH art sets)? This writes to disk.')) return;
  NATURAL_OVERRIDES = {};
  for (const t of Object.keys(FURN_IMG)) {
    if (FURN_IMG[t]) FURN_IMG[t].natural = FURN_FILE_BUILTIN[t]?.natural || 'downward';
  }
  renderNaturalList();
  draw();
  setStatus('clearing overrides…');
  const ok = await saveNaturalOverrides(NATURAL_OVERRIDES);
  if (ok) setStatus('All overrides cleared and saved.');
}

function onKeyDown(e) {
  // ignore typing in inputs
  if (e.target.matches('input, textarea, select')) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.key.toLowerCase() === 'z' && e.shiftKey)  { e.preventDefault(); redo(); return; }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  }
  if (!state.selection) return;
  switch (e.key) {
    case 'r': case 'R': rotateSelection(+1); break;
    case 'l': case 'L': rotateSelection(-1); break;
    case 'h': case 'H': flipSelection('h'); break;
    case 'v': case 'V': flipSelection('v'); break;
    case 'Delete': case 'Backspace': deleteSelection(); break;
    case 'ArrowUp':    nudgeSelection(0, -1); e.preventDefault(); break;
    case 'ArrowDown':  nudgeSelection(0, +1); e.preventDefault(); break;
    case 'ArrowLeft':  nudgeSelection(-1, 0); e.preventDefault(); break;
    case 'ArrowRight': nudgeSelection(+1, 0); e.preventDefault(); break;
    case 'Escape': clearSelection(); break;
  }
}

// ===== API ===============================================================
async function loadList() {
  const r = await fetch('/api/quests');
  const j = await r.json();
  state.list = j.quests || [];
  renderList();
}

async function loadQuest(file, silent) {
  if (state.dirty && !silent) {
    if (!confirm('Discard unsaved changes?')) return;
  }
  const r = await fetch('/api/quests/' + encodeURIComponent(file));
  if (!r.ok) { setStatus('load failed'); return; }
  const q = await r.json();
  state.current = file;
  state.quest = q;
  state.selection = null;
  state.history = [];
  state.histIdx = -1;
  pushHistory();   // baseline so first edit can be undone
  state.dirty = false;
  refreshTitle();
  refreshDirty();
  refreshHistButtons();
  refreshSelectionPanel();
  renderList();
  setStatus(`Loaded ${file}`);
  draw();

  $('qa-link').href = '/assets/map_qa/' + file.replace(/\.json$/, '.png') + '?v=' + Date.now();
}

async function save() {
  if (!state.quest || !state.current) return;
  setStatus('saving…');
  try {
    const r = await fetch('/api/quests/' + encodeURIComponent(state.current), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.quest),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'save failed');
    state.dirty = false;
    refreshDirty();
    setStatus('Saved ' + state.current);
  } catch (e) {
    setStatus('save failed: ' + e.message);
  }
}

async function rerenderPng() {
  if (!state.current) return;
  setStatus('regenerating PNG…');
  try {
    const r = await fetch('/api/render-png/' + encodeURIComponent(state.current),
      { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'failed');
    setStatus('PNG re-rendered: ' + j.png);
    $('qa-link').href = j.png + '?v=' + Date.now();
  } catch (e) {
    setStatus('PNG re-render failed: ' + e.message);
  }
}

// ===== QUEST LIST ========================================================
function renderList() {
  const ul = $('quest-list');
  const filter = ($('quest-filter').value || '').toLowerCase();
  ul.innerHTML = '';
  for (const q of state.list) {
    if (filter && !((q.title || '').toLowerCase().includes(filter)
                 || (q.id || '').toLowerCase().includes(filter)
                 || (q.file || '').toLowerCase().includes(filter))) continue;
    const li = document.createElement('li');
    if (q.file === state.current) li.className = 'active';
    li.innerHTML = `${escapeHtml(q.title || q.id)}<small>${escapeHtml(q.subtitle || q.file)}</small>`;
    li.addEventListener('click', () => loadQuest(q.file));
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ===== HISTORY ===========================================================
function pushHistory() {
  if (!state.quest) return;
  const snap = JSON.stringify(state.quest);
  // truncate any redo branch
  state.history.length = state.histIdx + 1;
  state.history.push(snap);
  state.histIdx = state.history.length - 1;
  // cap history depth
  if (state.history.length > 80) {
    state.history.shift();
    state.histIdx--;
  }
  refreshHistButtons();
}
function undo() {
  if (state.histIdx <= 0) return;
  state.histIdx--;
  state.quest = JSON.parse(state.history[state.histIdx]);
  state.dirty = true;
  state.selection = null;
  refreshDirty();
  refreshHistButtons();
  refreshSelectionPanel();
  draw();
  setStatus('Undo');
}
function redo() {
  if (state.histIdx >= state.history.length - 1) return;
  state.histIdx++;
  state.quest = JSON.parse(state.history[state.histIdx]);
  state.dirty = true;
  state.selection = null;
  refreshDirty();
  refreshHistButtons();
  refreshSelectionPanel();
  draw();
  setStatus('Redo');
}

// ===== MUTATIONS =========================================================
function commitMutation(label) {
  state.dirty = true;
  refreshDirty();
  pushHistory();
  refreshSelectionPanel();
  draw();
  if (label) setStatus(label);
}

function flipSelection(axis) {
  const s = state.selection;
  if (!s || !state.quest) return;
  if (s.kind !== 'furniture') {
    setStatus('Flip only applies to furniture.');
    return;
  }
  const f = state.quest.furniture[s.index];
  if (!f) return;
  // Per-art-set flip — canonical fields are f._flipH/_flipV; alt fields
  // are f._altFlipH/_altFlipV. The active set's field is toggled and
  // also cleaned up when false to keep the JSON tidy.
  const hKey = ALT_FURN_ON ? '_altFlipH' : '_flipH';
  const vKey = ALT_FURN_ON ? '_altFlipV' : '_flipV';
  if (axis === 'h') f[hKey] = !f[hKey];
  else              f[vKey] = !f[vKey];
  if (!f[hKey]) delete f[hKey];
  if (!f[vKey]) delete f[vKey];
  const suffix = ALT_FURN_ON ? ' (alt)' : '';
  commitMutation(`Flipped ${f.type} ${axis === 'h' ? 'horizontally' : 'vertically'}${suffix}`);
}

function rotateSelection(dir) {
  // dir = +1 CW, -1 CCW
  const s = state.selection;
  if (!s || !state.quest) return;
  if (s.kind === 'furniture') {
    const f = state.quest.furniture[s.index];
    if (!f || !ROTATABLE_FURN.has(f.type)) return;
    rotateFurniture(f, dir);
    commitMutation('Rotated ' + f.type);
    return;
  }
  if (s.kind === 'door' || s.kind === 'secretDoor') {
    const arr = s.kind === 'door' ? state.quest.doors : state.quest.secretDoors;
    const d = arr[s.index];
    if (!d) return;
    rotateDoor(d, dir);
    commitMutation('Rotated door');
    return;
  }
  setStatus('Rotation only applies to furniture and doors.');
}

function rotateFurniture(f, dir) {
  const order = ['downward', 'rightward', 'upward', 'leftward'];
  const cur = order.indexOf(f.facing || 'downward');
  const nextIdx = ((cur + (dir > 0 ? 1 : -1)) + 4) % 4;
  const newFacing = order[nextIdx];

  // Pivot rotation around the bbox top-left corner so N rotations are
  // perfectly reversible (no drift). The previous "centre" pivot used
  // Math.round() which lost half-cell offsets when bbox dims swapped
  // between odd and even sizes — every rotation slid the piece by a
  // cell or two.
  const cells = f.cells || [];
  let minC = 99, minR = 99;
  for (const [c, r] of cells) {
    if (c < minC) minC = c;
    if (r < minR) minR = r;
  }
  const nat = FURN_NATURAL[f.type] || { w: 1, h: 1 };
  const transverse = (newFacing === 'leftward' || newFacing === 'rightward');
  const newW = transverse ? nat.h : nat.w;
  const newH = transverse ? nat.w : nat.h;

  // Clamp the (top-left) anchor to the board.
  const newMinC = Math.max(0, Math.min(COLS - newW, minC));
  const newMinR = Math.max(0, Math.min(ROWS - newH, minR));

  const newCells = [];
  for (let rr = newMinR; rr < newMinR + newH; rr++) {
    for (let cc = newMinC; cc < newMinC + newW; cc++) newCells.push([cc, rr]);
  }
  f.cells = newCells;
  f.facing = newFacing;
}

function rotateDoor(d, dir) {
  const order = ['leftward', 'downward', 'rightward', 'upward']; // visual CW cycle
  // Treat anchor as door.a; partner b is the cell on the other side.
  // Rebuild b from the new rotation.
  const cur = order.indexOf(d._rot || inferDoorRot(d));
  const next = ((cur + (dir > 0 ? 1 : -1)) + 4) % 4;
  const rot = order[next];
  const [c, r] = d.a;
  let b;
  switch (rot) {
    case 'leftward':  b = [c + 1, r]; break;
    case 'rightward': b = [c - 1, r]; break;
    case 'upward':    b = [c, r + 1]; break;
    case 'downward':  b = [c, r - 1]; break;
  }
  if (b[0] < 0 || b[0] >= COLS || b[1] < 0 || b[1] >= ROWS) {
    setStatus('Door would extend off the board.');
    return;
  }
  d.b = b;
  d._rot = rot;
}
function inferDoorRot(d) {
  if (d.a[1] === d.b[1]) return d.a[0] < d.b[0] ? 'leftward' : 'rightward';
  return d.a[1] < d.b[1] ? 'upward' : 'downward';
}

function deleteSelection() {
  const s = state.selection;
  if (!s || !state.quest) return;
  const map = {
    furniture: 'furniture',
    door: 'doors',
    secretDoor: 'secretDoors',
    monster: 'monsters',
    treasure: 'treasure',
    trap: 'traps',
    blocked: 'blocked',
  };
  if (s.kind === 'npc') {
    delete state.quest.friendlyNpc;
  } else {
    const key = map[s.kind];
    if (!key || !state.quest[key]) return;
    state.quest[key].splice(s.index, 1);
  }
  state.selection = null;
  commitMutation('Deleted ' + s.kind);
}

function nudgeSelection(dx, dy) {
  const s = state.selection;
  if (!s || !state.quest) return;
  const inB = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
  switch (s.kind) {
    case 'furniture': {
      const f = state.quest.furniture[s.index];
      if (!f) return;
      const moved = f.cells.map(([c, r]) => [c + dx, r + dy]);
      if (!moved.every(([c, r]) => inB(c, r))) return;
      f.cells = moved;
      break;
    }
    case 'monster': {
      const m = state.quest.monsters[s.index];
      if (!m) return;
      const [c, r] = m.at; if (!inB(c + dx, r + dy)) return;
      m.at = [c + dx, r + dy]; break;
    }
    case 'treasure': {
      const t = state.quest.treasure[s.index];
      if (!t) return;
      const [c, r] = t.at; if (!inB(c + dx, r + dy)) return;
      t.at = [c + dx, r + dy]; break;
    }
    case 'trap': {
      const t = state.quest.traps[s.index];
      if (!t || !t.at) return;
      const [c, r] = t.at; if (!inB(c + dx, r + dy)) return;
      t.at = [c + dx, r + dy]; break;
    }
    case 'npc': {
      const n = state.quest.friendlyNpc; if (!n || !n.at) return;
      const [c, r] = n.at; if (!inB(c + dx, r + dy)) return;
      n.at = [c + dx, r + dy]; break;
    }
    case 'door':
    case 'secretDoor': {
      const arr = s.kind === 'door' ? state.quest.doors : state.quest.secretDoors;
      const d = arr[s.index]; if (!d) return;
      const [ac, ar] = d.a, [bc, br] = d.b;
      if (!inB(ac + dx, ar + dy) || !inB(bc + dx, br + dy)) return;
      d.a = [ac + dx, ar + dy];
      d.b = [bc + dx, br + dy];
      break;
    }
    case 'blocked': {
      const arr = state.quest.blocked || [];
      const cur = arr[s.index]; if (!cur) return;
      const nc = cur[0] + dx, nr = cur[1] + dy;
      if (!inB(nc, nr)) return;
      arr[s.index] = [nc, nr];
      s.ref = arr[s.index];
      break;
    }
  }
  commitMutation('Nudged ' + s.kind);
}

function clearSelection() {
  state.selection = null;
  refreshSelectionPanel();
  draw();
}

// ===== HIT-TESTING =======================================================
function pickAt(c, r) {
  const q = state.quest;
  if (!q) return null;
  // priority order: monster > npc > treasure > trap > door > secretDoor > furniture
  if (q.friendlyNpc && q.friendlyNpc.at && eq(q.friendlyNpc.at, [c, r])) {
    return { kind: 'npc', index: 0, ref: q.friendlyNpc };
  }
  for (let i = 0; i < (q.monsters || []).length; i++) {
    if (eq(q.monsters[i].at, [c, r])) return { kind: 'monster', index: i, ref: q.monsters[i] };
  }
  for (let i = 0; i < (q.treasure || []).length; i++) {
    if (eq(q.treasure[i].at, [c, r])) return { kind: 'treasure', index: i, ref: q.treasure[i] };
  }
  for (let i = 0; i < (q.traps || []).length; i++) {
    const t = q.traps[i]; if (t.at && eq(t.at, [c, r])) return { kind: 'trap', index: i, ref: t };
  }
  for (let i = 0; i < (q.doors || []).length; i++) {
    const d = q.doors[i]; if (eq(d.a, [c, r]) || eq(d.b, [c, r])) return { kind: 'door', index: i, ref: d };
  }
  for (let i = 0; i < (q.secretDoors || []).length; i++) {
    const d = q.secretDoors[i]; if (eq(d.a, [c, r]) || eq(d.b, [c, r])) return { kind: 'secretDoor', index: i, ref: d };
  }
  for (let i = 0; i < (q.furniture || []).length; i++) {
    const f = q.furniture[i];
    if ((f.cells || []).some(p => eq(p, [c, r]))) return { kind: 'furniture', index: i, ref: f };
  }
  // Rubble / blocked tiles — q.blocked is an array of [c, r] tuples,
  // so the ref IS the tuple. moveEntityTo handles the in-place index
  // replacement so the array slot stays in sync.
  for (let i = 0; i < (q.blocked || []).length; i++) {
    const b = q.blocked[i];
    if (b && b[0] === c && b[1] === r) return { kind: 'blocked', index: i, ref: b };
  }
  return null;
}
function eq(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }

// ===== POINTER: select + drag ===========================================
// Single pointer flow handles BOTH selection (click) and drag.
// - mousedown picks the entity under the cursor and arms a drag
// - mousemove rebuilds the entity's position from cursor − offset
// - mouseup commits the move into history (if anything actually moved)
let dragState = null;

function eventToCell(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * sx;
  const y = (e.clientY - rect.top)  * sy;
  if (x < PAD_L || y < PAD_T || x > PAD_L + COLS * CELL || y > PAD_T + ROWS * CELL) return null;
  return [Math.floor((x - PAD_L) / CELL), Math.floor((y - PAD_T) / CELL)];
}

function onCanvasMouseDown(e) {
  if (!state.quest || e.button !== 0) return;
  const cell = eventToCell(e);
  if (!cell) { clearSelection(); return; }
  const [c, r] = cell;
  const hit = pickAt(c, r);
  if (!hit) {
    state.selection = null;
    refreshSelectionPanel();
    draw();
    setStatus(`Empty cell L${c + 1}T${r + 1}`);
    return;
  }
  state.selection = hit;
  refreshSelectionPanel();
  draw();
  setStatus(`Selected ${hit.kind} @ L${c + 1}T${r + 1}`);

  // Arm the drag — record the anchor cell of the picked entity and
  // the cursor offset from it so motion is relative.
  const ref = hit.ref;
  let anchor = null;
  if (hit.kind === 'furniture') {
    let mc = 99, mr = 99;
    for (const [cc, rr] of (ref.cells || [])) { if (cc < mc) mc = cc; if (rr < mr) mr = rr; }
    anchor = [mc, mr];
  } else if (hit.kind === 'door' || hit.kind === 'secretDoor') {
    anchor = [ref.a[0], ref.a[1]];
  } else if (hit.kind === 'blocked' && Array.isArray(ref)) {
    anchor = [ref[0], ref[1]];
  } else if (ref.at) {
    anchor = [ref.at[0], ref.at[1]];
  }
  if (!anchor) return;
  dragState = {
    kind: hit.kind, index: hit.index, ref,
    offsetC: c - anchor[0], offsetR: r - anchor[1],
    moved: false,
  };
}

function onCanvasMouseMove(e) {
  if (!state.quest) return;
  // No active drag — just keep the cursor informative
  if (!dragState) {
    const cell = eventToCell(e);
    canvas.style.cursor = (cell && pickAt(cell[0], cell[1])) ? 'move' : '';
    return;
  }
  const cell = eventToCell(e);
  if (!cell) return;
  const targetC = cell[0] - dragState.offsetC;
  const targetR = cell[1] - dragState.offsetR;
  if (moveEntityTo(dragState, targetC, targetR)) {
    dragState.moved = true;
    draw();
  }
}

function onCanvasMouseUp() {
  if (!dragState) return;
  if (dragState.moved) commitMutation(`Moved ${dragState.kind}`);
  dragState = null;
  canvas.style.cursor = '';
}

// Move the entity referenced by `ds` so its anchor lands at (newC, newR).
// Returns true if the entity actually moved (i.e. the new anchor differs
// from its current anchor and stays on-board).
function moveEntityTo(ds, newC, newR) {
  const ref = ds.ref;
  if (ds.kind === 'furniture') {
    const cells = ref.cells || [];
    let mc = 99, mr = 99, xc = -1, xr = -1;
    for (const [cc, rr] of cells) {
      if (cc < mc) mc = cc; if (rr < mr) mr = rr;
      if (cc > xc) xc = cc; if (rr > xr) xr = rr;
    }
    if (mc === newC && mr === newR) return false;
    const w = xc - mc + 1, h = xr - mr + 1;
    if (newC < 0 || newR < 0 || newC + w > COLS || newR + h > ROWS) return false;
    const dc = newC - mc, dr = newR - mr;
    ref.cells = cells.map(([cc, rr]) => [cc + dc, rr + dr]);
    return true;
  }
  if (ds.kind === 'door' || ds.kind === 'secretDoor') {
    const a = ref.a, b = ref.b;
    if (a[0] === newC && a[1] === newR) return false;
    const dc = newC - a[0], dr = newR - a[1];
    const nb = [b[0] + dc, b[1] + dr];
    if (newC < 0 || newR < 0 || newC >= COLS || newR >= ROWS) return false;
    if (nb[0] < 0 || nb[1] < 0 || nb[0] >= COLS || nb[1] >= ROWS) return false;
    ref.a = [newC, newR];
    ref.b = nb;
    return true;
  }
  // blocked / rubble — single-cell, but stored as a bare [c, r] tuple
  // inside q.blocked. MUST come before the `ref.at` branch because
  // Array.prototype.at exists in modern JS, so an array tuple's .at is
  // a function (truthy) and the wrong branch would otherwise fire and
  // clobber the array.
  if (ds.kind === 'blocked') {
    const arr = state.quest.blocked || [];
    const cur = arr[ds.index];
    if (!cur || (cur[0] === newC && cur[1] === newR)) return false;
    if (newC < 0 || newR < 0 || newC >= COLS || newR >= ROWS) return false;
    arr[ds.index] = [newC, newR];
    ds.ref = arr[ds.index];
    return true;
  }
  // monster / treasure / trap / npc → single-cell entity
  if (ref && !Array.isArray(ref) && ref.at) {
    if (ref.at[0] === newC && ref.at[1] === newR) return false;
    if (newC < 0 || newR < 0 || newC >= COLS || newR >= ROWS) return false;
    ref.at = [newC, newR];
    return true;
  }
  return false;
}

// ===== INSPECTOR PANEL ===================================================
function refreshSelectionPanel() {
  const s = state.selection;
  $('selection-empty').hidden = !!s;
  $('selection-detail').hidden = !s;
  if (!s) return;
  $('sel-kind').textContent = s.kind;
  const r = s.ref;
  if (s.kind === 'furniture') {
    const cs = r.cells || [];
    let minC = 99, minR = 99, maxC = -1, maxR = -1;
    for (const [c, rr] of cs) { if (c < minC) minC = c; if (rr < minR) minR = rr; if (c > maxC) maxC = c; if (rr > maxR) maxR = rr; }
    $('sel-type').textContent = r.type || '?';
    $('sel-at').textContent = `L${minC + 1}T${minR + 1} (${maxC - minC + 1}×${maxR - minR + 1})`;
    $('sel-row-facing').hidden = false;
    const flipH = ALT_FURN_ON ? !!r._altFlipH : !!r._flipH;
    const flipV = ALT_FURN_ON ? !!r._altFlipV : !!r._flipV;
    const flipBits = (flipH ? ' · flipH' : '') + (flipV ? ' · flipV' : '');
    const tag = ALT_FURN_ON ? ' [alt]' : '';
    $('sel-facing').textContent = (r.facing || 'downward') + flipBits + tag;
    $('sel-row-name').hidden = !r._note;
    $('sel-name').textContent = r._note || '';
    $('btn-rot-cw').disabled  = !ROTATABLE_FURN.has(r.type);
    $('btn-rot-ccw').disabled = !ROTATABLE_FURN.has(r.type);
    $('btn-flip-h').disabled  = false;
    $('btn-flip-v').disabled  = false;
  } else if (s.kind === 'door' || s.kind === 'secretDoor') {
    $('sel-type').textContent = s.kind;
    $('sel-at').textContent = `L${r.a[0] + 1}T${r.a[1] + 1} ↔ L${r.b[0] + 1}T${r.b[1] + 1}`;
    $('sel-row-facing').hidden = false;
    $('sel-facing').textContent = r._rot || inferDoorRot(r);
    $('sel-row-name').hidden = true;
    $('btn-rot-cw').disabled  = false;
    $('btn-rot-ccw').disabled = false;
    $('btn-flip-h').disabled  = true;
    $('btn-flip-v').disabled  = true;
  } else if (s.kind === 'monster') {
    $('sel-type').textContent = r.type || '?';
    $('sel-at').textContent = `L${r.at[0] + 1}T${r.at[1] + 1}`;
    $('sel-row-facing').hidden = true;
    $('sel-row-name').hidden = !r.name;
    $('sel-name').textContent = r.name || '';
    $('btn-rot-cw').disabled  = true;
    $('btn-rot-ccw').disabled = true;
    $('btn-flip-h').disabled  = true;
    $('btn-flip-v').disabled  = true;
  } else if (s.kind === 'treasure') {
    $('sel-type').textContent = r.kind || 'gold';
    $('sel-at').textContent = `L${r.at[0] + 1}T${r.at[1] + 1}` + (r.amount != null ? ` — ${r.amount}g` : '');
    $('sel-row-facing').hidden = true;
    $('sel-row-name').hidden = !r._note;
    $('sel-name').textContent = r._note || '';
    $('btn-rot-cw').disabled  = true;
    $('btn-rot-ccw').disabled = true;
    $('btn-flip-h').disabled  = true;
    $('btn-flip-v').disabled  = true;
  } else if (s.kind === 'trap') {
    $('sel-type').textContent = r.kind || r.type || 'trap';
    $('sel-at').textContent = `L${r.at[0] + 1}T${r.at[1] + 1}`;
    $('sel-row-facing').hidden = true;
    $('sel-row-name').hidden = true;
    $('btn-rot-cw').disabled  = true;
    $('btn-rot-ccw').disabled = true;
    $('btn-flip-h').disabled  = true;
    $('btn-flip-v').disabled  = true;
  } else if (s.kind === 'blocked') {
    $('sel-type').textContent = 'rubble';
    $('sel-at').textContent = `L${r[0] + 1}T${r[1] + 1}`;
    $('sel-row-facing').hidden = true;
    $('sel-row-name').hidden = true;
    $('btn-rot-cw').disabled  = true;
    $('btn-rot-ccw').disabled = true;
    $('btn-flip-h').disabled  = true;
    $('btn-flip-v').disabled  = true;
  } else if (s.kind === 'npc') {
    $('sel-type').textContent = r.id || 'npc';
    $('sel-at').textContent = r.at ? `L${r.at[0] + 1}T${r.at[1] + 1}` : '?';
    $('sel-row-facing').hidden = true;
    $('sel-row-name').hidden = !r.name;
    $('sel-name').textContent = r.name || '';
    $('btn-rot-cw').disabled  = true;
    $('btn-rot-ccw').disabled = true;
    $('btn-flip-h').disabled  = true;
    $('btn-flip-v').disabled  = true;
  }
}

function refreshTitle() {
  const q = state.quest;
  if (!q) {
    $('quest-title').textContent = 'Pick a quest';
    $('quest-meta').textContent = '';
    return;
  }
  $('quest-title').textContent = q.title || q.id || '?';
  $('quest-meta').textContent = q.subtitle ? `${q.subtitle} · ${q.id}` : q.id;
}
function refreshDirty()       { $('dirty-flag').hidden = !state.dirty; $('btn-save').disabled = !state.dirty; }
function refreshHistButtons() {
  $('btn-undo').disabled = state.histIdx <= 0;
  $('btn-redo').disabled = state.histIdx >= state.history.length - 1;
}
function setStatus(t) { $('status').textContent = t; }

// ===== RENDER ============================================================
function draw() {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  drawCoords();
  drawBoard();
  drawSelectionHighlight();
}

function drawCoords() {
  if (!state.layers.coords) return;
  ctx.fillStyle = C.title;
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (let c = 0; c < COLS; c++) ctx.fillText(String(c + 1), PAD_L + c * CELL + CELL / 2, PAD_T - 12);
  ctx.textAlign = 'right';
  for (let r = 0; r < ROWS; r++) ctx.fillText(String(r + 1), PAD_L - 6, PAD_T + r * CELL + CELL / 2);
}

function drawBoard() {
  const q = state.quest;
  if (!q) {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No quest loaded.', W / 2, H / 2);
    return;
  }

  // base out-of-play
  ctx.fillStyle = state.layers.darkmask ? C.outOfPlay : C.floor;
  ctx.fillRect(PAD_L, PAD_T, COLS * CELL, ROWS * CELL);

  const dark = new Set();
  for (const [c, r] of (q.dark || [])) dark.add(c + ',' + r);

  // Compute which dark cells are on the OUTER perimeter — i.e.
  // connected via other dark cells back to the outside of the board.
  // Seed the flood fill from every dark cell touching the absolute
  // outermost row/col, then expand through 4-neighbour dark cells.
  // Anything reachable that way is "outer"; anything that isn't is an
  // inner cutout (e.g. a small dark pocket carved out mid-board for a
  // specific quest) and its walls must always draw.
  const outerDark = new Set();
  const queue = [];
  for (const k of dark) {
    const [c, r] = k.split(',').map(Number);
    if (c === 0 || c === COLS - 1 || r === 0 || r === ROWS - 1) {
      outerDark.add(k);
      queue.push([c, r]);
    }
  }
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const k = nc + ',' + nr;
      if (!dark.has(k) || outerDark.has(k)) continue;
      outerDark.add(k);
      queue.push([nc, nr]);
    }
  }
  state._outerDark = outerDark;

  const useFloorTex = state.layers.floors;
  // Floor render — per-room blit + clip, then corridor blit + clip.
  // Each region's texture is drawn ONCE stretched to its cell
  // footprint (or the playable rect for corridors), clipped to the
  // actual cells that belong to it. Continuous within each region,
  // no per-cell sub-sampling artifacts.
  let texturedCells = null;
  if (useFloorTex && state.board && state.roomBbox) {
    texturedCells = new Set();
    // Rooms
    for (const room of (state.board.rooms || [])) {
      const cells = room.cells || [];
      if (!cells.length) continue;
      const tex = loadRoomTexture(room.id);
      if (!tex.ready || !tex.img) continue;
      const bbox = state.roomBbox[room.id];
      if (!bbox) continue;
      ctx.save();
      ctx.beginPath();
      let any = false;
      for (const [c, r] of cells) {
        if (dark.has(c + ',' + r)) continue;
        ctx.rect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
        texturedCells.add(c + ',' + r);
        any = true;
      }
      if (!any) { ctx.restore(); continue; }
      ctx.clip();
      const dx = PAD_L + bbox.mc * CELL;
      const dy = PAD_T + bbox.mr * CELL;
      const dw = bbox.spanC * CELL;
      const dh = bbox.spanR * CELL;
      ctx.drawImage(tex.img, 0, 0, tex.img.naturalWidth, tex.img.naturalHeight,
                    dx, dy, dw, dh);
      ctx.restore();
    }
    // Corridor
    const corTex = currentCorridorTexture();
    if (corTex.ready && corTex.img) {
      ctx.save();
      ctx.beginPath();
      let any = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (dark.has(c + ',' + r)) continue;
          if ((state.zoneOf && state.zoneOf(c, r)) !== 'corridor') continue;
          ctx.rect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
          texturedCells.add(c + ',' + r);
          any = true;
        }
      }
      if (any) {
        ctx.clip();
        ctx.drawImage(corTex.img, 0, 0, corTex.img.naturalWidth, corTex.img.naturalHeight,
                      PAD_L, PAD_T, COLS * CELL, ROWS * CELL);
      }
      ctx.restore();
    }
  }

  // Floor cells — for any cell NOT covered by the texture pass above,
  // paint the dark-mask, room tint, or plain floor colour. Darkmask
  // also gets a hard paint over textured cells so out-of-play stays
  // visible even when a room texture happens to include them.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = PAD_L + c * CELL, y = PAD_T + r * CELL;
      if (state.layers.darkmask && dark.has(c + ',' + r)) {
        ctx.fillStyle = C.outOfPlay;
        ctx.fillRect(x, y, CELL, CELL);
        continue;
      }
      if (texturedCells && texturedCells.has(c + ',' + r)) continue;

      const zone = state.zoneOf ? state.zoneOf(c, r) : null;
      let fill = C.floor;
      if (state.layers.rooms && zone) {
        fill = (zone === 'corridor') ? C.corridor : roomTint(zone);
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, CELL, CELL);
    }
  }

  // room labels (small id+name in the bbox top-left)
  if (state.layers.roomLabels && state.roomMeta) {
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (const room of Object.values(state.roomMeta)) {
      if (!room.cells || !room.cells.length) continue;
      let mc = 99, mr = 99;
      for (const [c, rr] of room.cells) { if (c < mc) mc = c; if (rr < mr) mr = rr; }
      const x = PAD_L + mc * CELL + 3, y = PAD_T + mr * CELL + 2;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x - 1, y - 1, 26, 11);
      ctx.fillStyle = '#3a2a18';
      ctx.fillText(room.id.toUpperCase(), x, y);
    }
  }

  // start / stair cells — render the heroscribe stairway image over
  // the blue START highlight so the editor matches the live game.
  if (state.layers.start) {
    const starts = q.startCells || q.stairCells || [];
    ctx.fillStyle = C.start;
    for (const [c, r] of starts) ctx.fillRect(PAD_L + c * CELL, PAD_T + r * CELL, CELL, CELL);
    if (starts.length) {
      let mn = [99, 99], mx = [-1, -1];
      for (const [c, r] of starts) {
        if (c < mn[0]) mn[0] = c; if (r < mn[1]) mn[1] = r;
        if (c > mx[0]) mx[0] = c; if (r > mx[1]) mx[1] = r;
      }
      const sx = PAD_L + mn[0] * CELL;
      const sy = PAD_T + mn[1] * CELL;
      const sw = (mx[0] - mn[0] + 1) * CELL;
      const sh = (mx[1] - mn[1] + 1) * CELL;
      // Try the heroscribe stair tile via the furniture image cache —
      // routed through drawFurnIcon so it picks up the FURN_INSETS.stair
      // bucket automatically (stairway is canonically 2×2).
      drawFurnIcon('stairway', sx, sy, sw, sh, null, false, false);
      ctx.strokeStyle = C.startBdr; ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
      ctx.fillStyle = C.startBdr;
      ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('START', sx + 4, sy + 4);
    }
  }

  // Hero tokens — one canonical token per start cell, in
  // HERO_ORDER (Barbarian, Dwarf, Elf, Wizard). Cycles if there are
  // more start cells than heroes. Drawn after the start highlight so
  // the tokens sit on top of the cyan tint + stairway. Falls back to
  // a coloured letter glyph if a token PNG isn't loaded yet.
  if (state.layers.heroes) {
    const starts = q.startCells || q.stairCells || [];
    for (let i = 0; i < starts.length && i < HERO_ORDER.length; i++) {
      const [c, r] = starts[i];
      const id = HERO_ORDER[i];
      const x = PAD_L + c * CELL, y = PAD_T + r * CELL;
      const sprite = heroSprites[id + ':male'] || heroSprites[id];
      if (sprite) {
        ctx.drawImage(sprite, x + 3, y + 3, CELL - 6, CELL - 6);
      } else {
        const cx = x + CELL / 2, cy = y + CELL / 2;
        ctx.fillStyle = '#3a2814';
        ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(id[0].toUpperCase(), cx, cy + 1);
      }
    }
  }

  // blocked / rubble — heroscribe SingleBlockedSquare.png if available,
  // otherwise the gray rect + X fallback. Two horizontally-adjacent
  // rubble cells render as ONE DoubleBlockedSquare sprite (matches the
  // live game's pair-merge logic — see client.js drawBoard).
  if (state.layers.blocked) {
    const blocks = q.blocked || [];
    const blockSet = new Set(blocks.map(([c, r]) => `${c},${r}`));
    const pairRights = new Set();
    for (const [c, r] of blocks) {
      if (blockSet.has(`${c - 1},${r}`)) pairRights.add(`${c},${r}`);
    }
    for (const [c, r] of blocks) {
      const key = `${c},${r}`;
      if (pairRights.has(key)) continue;     // covered by left neighbour
      const x = PAD_L + c * CELL, y = PAD_T + r * CELL;
      const pairRight = blockSet.has(`${c + 1},${r}`);
      const iconKind = pairRight ? 'rubble-double' : 'rubble';
      const iconW    = pairRight ? CELL * 2 : CELL;
      if (drawTileIcon(iconKind, x, y, iconW, CELL)) continue;
      // Fallback pixel-art — single or double rect + X
      const w = iconW;
      ctx.fillStyle = C.blocked;
      ctx.strokeStyle = C.blockedX; ctx.lineWidth = 1;
      ctx.fillRect(x + 3, y + 3, w - 6, CELL - 6);
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + w - 6, y + CELL - 6);
      ctx.moveTo(x + w - 6, y + 6); ctx.lineTo(x + 6, y + CELL - 6);
      ctx.stroke();
    }
  }

  // grid
  if (state.layers.grid) {
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r <= ROWS; r++) {
      ctx.moveTo(PAD_L, PAD_T + r * CELL + 0.5);
      ctx.lineTo(PAD_L + COLS * CELL, PAD_T + r * CELL + 0.5);
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.moveTo(PAD_L + c * CELL + 0.5, PAD_T);
      ctx.lineTo(PAD_L + c * CELL + 0.5, PAD_T + ROWS * CELL);
    }
    ctx.stroke();
  }

  // walls between cells — derived from dark/floor + zone boundaries.
  // Drawn before furniture so doors can punch through visually.
  if (state.layers.walls) drawWalls(q, dark);
  // Outer-perimeter frame — only the four literal board edges,
  // controlled by the Outer walls toggle. Inner walls are unaffected.
  if (state.layers.walls) drawOuterFrame();

  // furniture
  if (state.layers.furniture) for (const f of (q.furniture || [])) drawFurniture(f);

  // doors / secret doors
  if (state.layers.doors)  for (const d of (q.doors || []))       drawDoor(d, false);
  if (state.layers.secret) for (const d of (q.secretDoors || [])) drawDoor(d, true);

  // traps / treasure / monsters / npc
  if (state.layers.traps)    for (const t of (q.traps || []))    drawTrap(t);
  if (state.layers.treasure) for (const t of (q.treasure || [])) drawTreasure(t);
  if (state.layers.monsters) for (const m of (q.monsters || [])) drawMonster(m);
  if (q.friendlyNpc) drawNpc(q.friendlyNpc);
}

// Subtle per-room tint from a hash of the room id, kept inside the
// "warm parchment" range so the board still reads as one piece.
function roomTint(roomId) {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = ((h * 31) + roomId.charCodeAt(i)) | 0;
  // hue jitter ±18° around 36° (warm sand), low saturation
  const hue = (36 + ((h % 36) - 18) + 360) % 360;
  const sat = 28 + (Math.abs(h >> 4) % 12);     // 28–40%
  const lit = 78 + (Math.abs(h >> 8) % 6);      // 78–84%
  return `hsl(${hue} ${sat}% ${lit}%)`;
}

// Draw walls between adjacent cells where:
//   - one side is dark (out-of-play) and the other is floor;
//   - both are floor but in different zones (corridor↔room, room↔room).
// Walls draw under doors — the door rect paints over the middle of the
// wall edge afterwards, giving the natural wall-stubs-flanking-door look.
// Walls are FILLED rectangles spanning the cell edge — same style
// the builder uses (cream-on-printed-art). Each wall is WALL_THICK
// pixels wide, centred on the cell boundary, so adjacent cells each
// contribute half the wall thickness.
//
// Colour follows the shared "Light walls" preference: cream (light)
// or the legacy dark-brown (dark). Filled-rect primitive in both
// cases so the geometry is identical.
const WALL_THICK = 4;
const WALL_LIGHT = '#e6d9bd';
const WALL_DARK  = '#1c1208';
function drawWalls(q, darkSet) {
  const isDark = (c, r) => darkSet.has(c + ',' + r);
  const zone = state.zoneOf || (() => null);

  ctx.fillStyle = state.lightWalls ? WALL_LIGHT : WALL_DARK;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // East edge between (c, r) and (c+1, r)
      if (c + 1 < COLS && wallNeeded(c, r, c + 1, r, isDark, zone)) {
        const x = PAD_L + (c + 1) * CELL - WALL_THICK / 2;
        const y0 = PAD_T + r * CELL;
        ctx.fillRect(x, y0, WALL_THICK, CELL);
      }
      // South edge between (c, r) and (c, r+1)
      if (r + 1 < ROWS && wallNeeded(c, r, c, r + 1, isDark, zone)) {
        const x0 = PAD_L + c * CELL;
        const y = PAD_T + (r + 1) * CELL - WALL_THICK / 2;
        ctx.fillRect(x0, y, CELL, WALL_THICK);
      }
    }
  }
}

function wallNeeded(ac, ar, bc, br, isDark, zone) {
  const aD = isDark(ac, ar), bD = isDark(bc, br);
  if (aD && bD) return false;          // both rock — no visible edge
  if (aD || bD) return true;            // floor↔rock = wall (always)
  // both floor — wall iff different zones
  const za = zone(ac, ar), zb = zone(bc, br);
  if (za && zb && za !== zb) return true;
  return false;
}

// Outer-perimeter frame — four cream wall strips along the four
// literal canvas edges of the play area. This is the ONLY thing the
// "Outer walls" toggle controls; floor↔dark and room↔corridor walls
// inside the grid are always drawn. Matches how the builder defines
// the perimeter (board edges only, nothing inside).
function drawOuterFrame() {
  if (!state.outerWalls) return;
  ctx.fillStyle = state.lightWalls ? WALL_LIGHT : WALL_DARK;
  const x0 = PAD_L, y0 = PAD_T;
  const x1 = PAD_L + COLS * CELL;
  const y1 = PAD_T + ROWS * CELL;
  // top
  ctx.fillRect(x0 - WALL_THICK / 2, y0 - WALL_THICK / 2,
               (x1 - x0) + WALL_THICK, WALL_THICK);
  // bottom
  ctx.fillRect(x0 - WALL_THICK / 2, y1 - WALL_THICK / 2,
               (x1 - x0) + WALL_THICK, WALL_THICK);
  // left
  ctx.fillRect(x0 - WALL_THICK / 2, y0 - WALL_THICK / 2,
               WALL_THICK, (y1 - y0) + WALL_THICK);
  // right
  ctx.fillRect(x1 - WALL_THICK / 2, y0 - WALL_THICK / 2,
               WALL_THICK, (y1 - y0) + WALL_THICK);
}

function drawFurniture(f) {
  const cells = f.cells || [];
  if (!cells.length) return;
  let minC = 99, minR = 99, maxC = -1, maxR = -1;
  for (const [c, r] of cells) {
    if (c < minC) minC = c; if (r < minR) minR = r;
    if (c > maxC) maxC = c; if (r > maxR) maxR = r;
  }
  const x = PAD_L + minC * CELL;
  const y = PAD_T + minR * CELL;
  const w = (maxC - minC + 1) * CELL;
  const h = (maxR - minR + 1) * CELL;

  // Heroscribe canonical PNG when available — falls back to the
  // colored-rect + label glyph otherwise (still useful when a type
  // doesn't have an image yet, e.g. expansion pieces). Per-art-set
  // flip: alt mode reads f._altFlipH/V, canonical reads f._flipH/V.
  const flipH = ALT_FURN_ON ? !!f._altFlipH : !!f._flipH;
  const flipV = ALT_FURN_ON ? !!f._altFlipV : !!f._flipV;
  const usedImage = drawFurnIcon(f.type, x, y, w, h, f.facing, flipH, flipV);
  if (!usedImage) {
    ctx.fillStyle = C.furn[f.type] || '#969696';
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    ctx.strokeStyle = '#1e1410'; ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    const cx2 = x + w / 2, cy2 = y + h / 2;
    drawArrow(cx2, cy2, Math.min(w, h) * 0.32, f.facing, '#fff');
    const lbl = FURN_LABEL[f.type] || (f.type || '').slice(0, 4).toUpperCase();
    ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#000'; ctx.fillText(lbl, cx2 + 1, y + h - 5);
    ctx.fillStyle = '#fff'; ctx.fillText(lbl, cx2, y + h - 6);
  }

  // Always overlay the small facing arrow so editors can see
  // direction at a glance even on top of the image.
  if (usedImage && f.facing) {
    const cx = x + w / 2, cy = y + h / 2;
    drawArrow(cx, cy + h / 2 - 8, Math.min(w, h) * 0.16, f.facing, 'rgba(60,30,12,0.8)');
  }
}

function drawArrow(cx, cy, size, facing, color) {
  if (!facing) return;
  let dx = 0, dy = 0;
  switch (facing) {
    case 'downward':  dy = +1; break;
    case 'upward':    dy = -1; break;
    case 'leftward':  dx = -1; break;
    case 'rightward': dx = +1; break;
    default: return;
  }
  const tip = [cx + dx * size, cy + dy * size];
  const px = -dy, py = dx;
  const b1 = [cx - dx * size * 0.5 + px * size * 0.5, cy - dy * size * 0.5 + py * size * 0.5];
  const b2 = [cx - dx * size * 0.5 - px * size * 0.5, cy - dy * size * 0.5 - py * size * 0.5];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(b1[0], b1[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.closePath();
  ctx.fill();
}

function drawDoor(d, secret) {
  const ax = PAD_L + d.a[0] * CELL, ay = PAD_T + d.a[1] * CELL;
  const bx = PAD_L + d.b[0] * CELL, by = PAD_T + d.b[1] * CELL;
  const cx = (ax + bx + CELL) / 2, cy = (ay + by + CELL) / 2;
  const horizontal = (d.a[1] === d.b[1]);   // cells side-by-side -> wall is vertical
  ctx.fillStyle  = secret ? C.secretDoor : C.door;
  ctx.strokeStyle = secret ? '#640064' : C.doorBdr;
  ctx.lineWidth = 1;
  if (horizontal) {
    const x = Math.round(cx) - 5, y = Math.round(cy) - 13;
    ctx.fillRect(x, y, 10, 26);
    ctx.strokeRect(x + .5, y + .5, 10, 26);
    if (secret) hatch(x, y, 10, 26, '#fff');
  } else {
    const x = Math.round(cx) - 13, y = Math.round(cy) - 5;
    ctx.fillRect(x, y, 26, 10);
    ctx.strokeRect(x + .5, y + .5, 26, 10);
    if (secret) hatch(x, y, 26, 10, '#fff');
  }
}
function hatch(x, y, w, h, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < w + h; i += 4) {
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i - h, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTrap(t) {
  if (!t || !t.at) return;
  const [c, r] = t.at;
  const x = PAD_L + c * CELL;
  const y = PAD_T + r * CELL;
  // Try the heroscribe icon for this trap kind first
  if (drawTileIcon(t.kind || t.type || 'pit', x, y, CELL, CELL)) return;
  // Pixel-art fallback: red triangle + kind letter
  const cx = x + CELL / 2, cy = y + CELL / 2;
  ctx.fillStyle = C.trap;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx - 10, cy + 8);
  ctx.lineTo(cx + 10, cy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 1, cy - 5, 2, 7);
  ctx.fillRect(cx - 1, cy + 4, 2, 2);
  ctx.fillStyle = '#000';
  ctx.font = '9px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText((t.kind || t.type || 'T').slice(0, 1).toUpperCase(), cx, cy + 10);
}

function drawTreasure(t) {
  const [c, r] = t.at;
  const cx = PAD_L + c * CELL + CELL / 2;
  const cy = PAD_T + r * CELL + CELL / 2;
  ctx.fillStyle = C.treasure;
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.treasureBdr; ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#321e00';
  ctx.font = 'bold 9px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t.amount != null ? String(t.amount) : '$', cx, cy);
}

function drawMonster(m) {
  const [c, r] = m.at;
  const x = PAD_L + c * CELL, y = PAD_T + r * CELL;
  const cx = x + CELL / 2, cy = y + CELL / 2;
  // Prefer the canonical printed token (same art the live game uses).
  const sprite = monsterSprites[m.type];
  if (sprite) {
    ctx.drawImage(sprite, x + 3, y + 3, CELL - 6, CELL - 6);
    return;
  }
  // Fallback — coloured circle + letter glyph (legacy editor look).
  const col = C.monster[m.type] || '#c83c3c';
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#141414'; ctx.lineWidth = 1.5;
  ctx.stroke();
  const ltr = (m.name && m.name[0]) || MONSTER_LETTER[m.type] || (m.type || '?')[0];
  const rgb = hexToRgb(col);
  const dark = (rgb.r + rgb.g + rgb.b) < 380;
  ctx.fillStyle = dark ? '#fff' : '#000';
  ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ltr.toUpperCase(), cx, cy + 1);
}
function hexToRgb(h) {
  const m = /^#?([\da-f]{6})$/i.exec(h);
  if (!m) return { r: 200, g: 200, b: 200 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
function drawNpc(n) {
  if (!n.at) return;
  const cx = PAD_L + n.at[0] * CELL + CELL / 2;
  const cy = PAD_T + n.at[1] * CELL + CELL / 2;
  ctx.fillStyle = C.npc;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#143c1e'; ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#143014';
  ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy + 1);
}

function drawSelectionHighlight() {
  const s = state.selection;
  if (!s || !state.quest) return;
  ctx.save();
  ctx.strokeStyle = C.startBdr;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  const r = s.ref;
  let cells = [];
  if (s.kind === 'furniture') cells = r.cells || [];
  else if (s.kind === 'door' || s.kind === 'secretDoor') cells = [r.a, r.b];
  else if (s.kind === 'monster' || s.kind === 'treasure' || s.kind === 'trap')
    cells = r.at ? [r.at] : [];
  else if (s.kind === 'npc') cells = r.at ? [r.at] : [];
  for (const [c, rr] of cells) {
    ctx.strokeRect(PAD_L + c * CELL + 1.5, PAD_T + rr * CELL + 1.5, CELL - 3, CELL - 3);
  }
  ctx.restore();
}

})();
