// HeroQuest — furniture + tile PNG art subsystem.
//
// Owns everything around the PNG-based renderer (the path that
// supersedes the geometric fallbacks in client/furniture-draw.js):
//
//   - Canonical-pieces hydration: FURN_FILE / FURN_ALT_FILE are seeded
//     from a hardcoded fallback and replaced on boot from
//     /api/canonical-pieces (data/pieces/canonical-pieces.yaml).
//   - Furniture image caches: FURN_IMG (canonical) and FURN_IMG_ALT
//     (alt printed-art set). Independent caches so toggling alt vs
//     canonical doesn't blow away in-memory images.
//   - Tile-icon caches: TILE_IMG (rubble + trap PNGs).
//   - Per-art-set "natural" orientation overrides from the map editor
//     (data/pieces/furniture-naturals.json + a localStorage fast-path).
//   - Per-art-set inset tables (small / linear / stair / block) read
//     from localStorage so the editor's sliders propagate to the game.
//   - Tile-icon inset table (small / linear / block).
//   - ALT_FURN_ON preference + cross-tab live sync.
//
// Public API (window.HQFurnitureArt):
//   init({ ctx, CELL, getLastView, drawBoard })  — once at boot
//   isAltOn()                                    — read ALT_FURN_ON pref
//   setAltOn(bool)                               — toggle + persist + redraw
//   getFurnImg(type)                             — cache lookup; returns
//                                                  { img, ready, natural }
//                                                  or null if unmapped.
//   drawTileIcon(kind, px, py, pw, ph)           — paint tile PNG. Returns
//                                                  true if drawn (image
//                                                  loaded), false otherwise.
//   insetForBbox(cellsW, cellsH)                 — furniture inset in px
//   tileInsetForBbox(cellsW, cellsH)             — tile-icon inset in px

(function (global) {
  'use strict';

  let _ctx = null;
  let _CELL = 32;
  let _getLastView = null;
  let _drawBoard = null;

  function _redraw() {
    const v = _getLastView && _getLastView();
    if (v && _drawBoard) _drawBoard(v);
  }

  // ----- Canonical pieces ---------------------------------------------
  const _f = (file, natural = 'downward', dir = 'furniture') => ({ file, natural, dir });
  const FURN_FILE_FALLBACK = {
    'tomb':              _f('Tomb.png'),
    'sarcophagus':       _f('Tomb.png'),
    'sorcerer-table':    _f('SorcerersTable.png'),
    'sorcerers-table':   _f('SorcerersTable.png'),
    'alchemist-table':   _f('AlchemistsBench.png', 'upward'),
    'alchemist-bench':   _f('AlchemistsBench.png', 'upward'),
    'alchemists-bench':  _f('AlchemistsBench.png', 'upward'),
    'table':             _f('Table.png'),
    'bookcase':          _f('Bookcase.png'),
    'cupboard':          _f('Cupboard.png'),
    'fireplace':         _f('Fireplace.png'),
    'weapon-rack':       _f('WeaponsRack.png'),
    'rack':              _f('Rack.png'),
    'chest':             _f('TreasureChest.png'),
    'throne':            _f('Throne.png'),
    'stairway':          _f('Stairway.png', 'downward', 'tiles'),
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
  let FURN_FILE     = { ...FURN_FILE_FALLBACK };
  let FURN_ALT_FILE = { ...FURN_ALT_FILE_FALLBACK };

  function applyCanonicalPieces(yamlData) {
    const pieces = (yamlData && yamlData.pieces) || {};
    const flat = {};
    const alt  = {};
    for (const pieceId of Object.keys(pieces)) {
      const p = pieces[pieceId] || {};
      if (!p.file || !Array.isArray(p.aliases)) continue;
      for (const alias of p.aliases) {
        flat[alias] = { file: p.file, natural: p.naturalDir || 'downward', dir: p.dir || 'furniture' };
        if (p.altFile) alt[alias] = p.altFile;
      }
    }
    if (Object.keys(flat).length) {
      FURN_FILE = flat;
      FURN_ALT_FILE = alt;
      // Wipe per-art-set image caches so getFurnImg re-resolves with the
      // refreshed FURN_FILE / FURN_ALT_FILE on next draw.
      for (const k of Object.keys(FURN_IMG))     delete FURN_IMG[k];
      for (const k of Object.keys(FURN_IMG_ALT)) delete FURN_IMG_ALT[k];
      _redraw();
    }
  }

  // ----- Furniture-naturals overrides ---------------------------------
  // Set in the map editor's playground and persisted to
  // data/pieces/furniture-naturals.json on the server. Applied on top of the
  // hardcoded FURN_FILE defaults so the live game inherits whatever the
  // user dialled in via the editor.
  const FURN_NATURAL_LS_KEY = 'hq_furn_natural_overrides_v1';
  function readFurnNaturalsLocal() {
    try { return JSON.parse(localStorage.getItem(FURN_NATURAL_LS_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  let FURN_NATURAL_OVERRIDES = readFurnNaturalsLocal();
  function applyFurnNaturals(map) {
    FURN_NATURAL_OVERRIDES = map || {};
    // Each cache uses its own override key — canonical reads `type`,
    // alt reads `${type}:alt`. Fall back to the file's default natural.
    for (const t of Object.keys(FURN_IMG)) {
      if (FURN_IMG[t]) {
        const def = FURN_FILE[t];
        FURN_IMG[t].natural = FURN_NATURAL_OVERRIDES[t] || (def && def.natural) || 'downward';
      }
    }
    for (const t of Object.keys(FURN_IMG_ALT)) {
      if (FURN_IMG_ALT[t]) {
        const def = FURN_FILE[t];
        FURN_IMG_ALT[t].natural = FURN_NATURAL_OVERRIDES[t + ':alt'] || (def && def.natural) || 'downward';
      }
    }
    _redraw();
  }

  // ----- Alt furniture art toggle -------------------------------------
  const FURN_ALT_KEY = 'hq_furn_alt_v1';
  let ALT_FURN_ON = (() => {
    try { return localStorage.getItem(FURN_ALT_KEY) === '1'; }
    catch { return false; }
  })();
  function isAltOn() { return ALT_FURN_ON; }
  function setAltOn(on) {
    ALT_FURN_ON = !!on;
    try { localStorage.setItem(FURN_ALT_KEY, ALT_FURN_ON ? '1' : '0'); } catch {}
    _redraw();
  }

  // ----- Furniture image caches ---------------------------------------
  // Two caches — one per art set — so toggling alt vs canonical doesn't
  // blow away images already in memory.
  const FURN_IMG     = {};
  const FURN_IMG_ALT = {};
  function getFurnImg(type) {
    const def = FURN_FILE[type];
    if (!def) return null;
    const useAlt = ALT_FURN_ON && !!FURN_ALT_FILE[type];
    const cache = useAlt ? FURN_IMG_ALT : FURN_IMG;
    if (cache[type] !== undefined) return cache[type];
    const file = useAlt ? FURN_ALT_FILE[type] : def.file;
    // Per-art-set natural override — alt key `${type}:alt`, canonical key `type`.
    const overrideKey = useAlt ? type + ':alt' : type;
    const natural = FURN_NATURAL_OVERRIDES[overrideKey] || def.natural;
    const img = new Image();
    const entry = { img, ready: false, natural };
    cache[type] = entry;
    img.onload  = () => { entry.ready = true; _redraw(); };
    img.onerror = () => { cache[type] = null; };
    img.src = `/assets/${def.dir || 'furniture'}/${file}`;
    return entry;
  }

  // ----- Tile icons (rubble + trap markers + stairway) ----------------
  // Sourced from /api/canonical-tiles (data/tiles/canonical-tiles.yaml).
  // The hardcoded FALLBACK below keeps things rendering while the fetch
  // is in flight, and works as a self-contained offline default. Adding
  // a new tile is one YAML entry — the fetch on next boot picks it up.
  let TILE_FILE = {
    // rubble / blocked
    'rubble':         'SingleBlockedSquare.png',
    'rubble-double':  'DoubleBlockedSquare.png',
    'falling-block':  'FallingRock.png',
    'block':          'FallingRock.png',
    // traps
    'pit':            'PitTrap.png',
    'spear':          'SpearTrap.png',
    'spear-trap':     'SpearTrap.png',
    'pit-trap':       'PitTrap.png',
    'chest-trap':     'TreasureChestTrap.png',
    // stairway
    'stairway':       'Stairway.png',
  };
  function applyCanonicalTiles(yamlData) {
    const tiles = (yamlData && yamlData.tiles) || {};
    const flat = {};
    for (const tileId of Object.keys(tiles)) {
      const t = tiles[tileId] || {};
      if (!t.file || !Array.isArray(t.aliases)) continue;
      for (const alias of t.aliases) flat[alias] = t.file;
    }
    if (Object.keys(flat).length) {
      TILE_FILE = flat;
      // Wipe the image cache so the next draw re-resolves through the
      // refreshed alias map.
      for (const k of Object.keys(TILE_IMG)) delete TILE_IMG[k];
      _redraw();
    }
  }
  const TILE_IMG = {};
  function getTileImg(kind) {
    if (TILE_IMG[kind] !== undefined) return TILE_IMG[kind];
    const fn = TILE_FILE[kind];
    if (!fn) { TILE_IMG[kind] = null; return null; }
    const img = new Image();
    const entry = { img, ready: false };
    TILE_IMG[kind] = entry;
    img.onload  = () => { entry.ready = true; _redraw(); };
    img.onerror = () => { TILE_IMG[kind] = null; };
    img.src = `/assets/tiles/${fn}`;
    return entry;
  }
  function drawTileIcon(kind, px, py, pw, ph) {
    const e = getTileImg(kind);
    if (!e || !e.ready) return false;
    const img = e.img;
    const cellsW = Math.max(1, Math.round(pw / _CELL));
    const cellsH = Math.max(1, Math.round(ph / _CELL));
    const inset  = tileInsetForBbox(cellsW, cellsH);
    const slotW = pw - 2 * inset;
    const slotH = ph - 2 * inset;
    const ar = img.naturalWidth / img.naturalHeight;
    let drawW = slotW, drawH = slotW / ar;
    if (drawH > slotH) { drawH = slotH; drawW = slotH * ar; }
    _ctx.drawImage(img, px + (pw - drawW) / 2, py + (ph - drawH) / 2, drawW, drawH);
    return true;
  }

  // ----- Furniture insets (per-art-set, read from editor's sliders) ---
  const FURN_INSETS_LS_KEY     = 'hq_furn_insets_v2';
  const FURN_INSETS_ALT_LS_KEY = 'hq_furn_insets_alt_v1';
  const DEFAULT_FURN_INSETS = { small: 5, linear: 5, stair: 6, block: 12 };
  function _readFurnInsetsFrom(key) {
    try {
      const j = JSON.parse(localStorage.getItem(key) || '{}');
      const clamp = v => Math.max(0, Math.min(20, parseInt(v, 10) || 0));
      return {
        small:  Number.isFinite(j.small)  ? clamp(j.small)  : DEFAULT_FURN_INSETS.small,
        linear: Number.isFinite(j.linear) ? clamp(j.linear) : DEFAULT_FURN_INSETS.linear,
        stair:  Number.isFinite(j.stair)  ? clamp(j.stair)  : DEFAULT_FURN_INSETS.stair,
        block:  Number.isFinite(j.block)  ? clamp(j.block)  : DEFAULT_FURN_INSETS.block,
      };
    } catch { return { ...DEFAULT_FURN_INSETS }; }
  }
  let FURN_INSETS_CANON = _readFurnInsetsFrom(FURN_INSETS_LS_KEY);
  let FURN_INSETS_ALT   = _readFurnInsetsFrom(FURN_INSETS_ALT_LS_KEY);
  function activeFurnInsets() { return ALT_FURN_ON ? FURN_INSETS_ALT : FURN_INSETS_CANON; }
  function insetForBbox(cellsW, cellsH) {
    const FURN_INSETS = activeFurnInsets();
    const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
    if (mx <= 1) return FURN_INSETS.small;
    if (mn <= 1) return FURN_INSETS.linear;
    if (mn === 2 && mx === 2) return FURN_INSETS.stair;
    return FURN_INSETS.block;
  }

  // ----- Tile-icon insets ---------------------------------------------
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
  function tileInsetForBbox(cellsW, cellsH) {
    const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
    if (mx <= 1) return TILE_INSETS.small;
    if (mn <= 1) return TILE_INSETS.linear;
    return TILE_INSETS.block;
  }

  // ----- Cross-tab live sync (storage event) --------------------------
  window.addEventListener('storage', (e) => {
    if (e.key === FURN_NATURAL_LS_KEY) {
      applyFurnNaturals(readFurnNaturalsLocal());
    } else if (e.key === FURN_ALT_KEY) {
      ALT_FURN_ON = e.newValue === '1';
      _redraw();
    } else if (e.key === FURN_INSETS_LS_KEY) {
      FURN_INSETS_CANON = _readFurnInsetsFrom(FURN_INSETS_LS_KEY);
      _redraw();
    } else if (e.key === FURN_INSETS_ALT_LS_KEY) {
      FURN_INSETS_ALT = _readFurnInsetsFrom(FURN_INSETS_ALT_LS_KEY);
      _redraw();
    } else if (e.key === TILE_INSETS_LS_KEY) {
      TILE_INSETS = _readTileInsets();
      _redraw();
    }
  });

  // ----- Boot fetch ---------------------------------------------------
  // Server is source of truth — fetch canonical-pieces + furn-naturals
  // on boot, then keep the localStorage cache in sync.
  function init(deps) {
    _ctx = deps.ctx;
    _CELL = deps.CELL;
    _getLastView = deps.getLastView;
    _drawBoard = deps.drawBoard;

    (async () => {
      try {
        const r = await fetch('/api/canonical-pieces');
        if (r.ok) applyCanonicalPieces(await r.json());
      } catch { /* offline → keep fallback */ }
    })();
    (async () => {
      try {
        const r = await fetch('/api/canonical-tiles');
        if (r.ok) applyCanonicalTiles(await r.json());
      } catch { /* offline → keep fallback */ }
    })();
    fetch('/api/furn-naturals').then(r => r.ok ? r.json() : null).then(j => {
      if (j && typeof j === 'object') {
        try { localStorage.setItem(FURN_NATURAL_LS_KEY, JSON.stringify(j)); } catch {}
        applyFurnNaturals(j);
      }
    }).catch(() => {});
  }

  global.HQFurnitureArt = {
    init,
    isAltOn, setAltOn,
    getFurnImg,
    drawTileIcon,
    insetForBbox,
    tileInsetForBbox,
  };
})(typeof window !== 'undefined' ? window : globalThis);
