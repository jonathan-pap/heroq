// HeroQuest — overlay tile rendering (rubble / traps / stairway).
//
// Companion to HQFurnitureArt — same shape, separate concern. Reads
// /api/canonical-tiles (data/tiles/canonical-tiles.yaml) at boot and
// hydrates an alias → PNG table the renderer uses to paint trap
// markers, rubble cells, and stairways. Falls back to a hardcoded
// table while the fetch is in flight.
//
// Alt art:
//   The `Alt furniture art` preference (owned by HQFurnitureArt) drives
//   both the furniture set AND the tile set. When alt-on is true and a
//   tile has an `altFile` declared, the alt PNG is used. Tiles without
//   an altFile just keep their canonical art in both modes. Toggling
//   the pref re-renders without re-fetching (each art set has its own
//   image cache so the OTHER set stays warm).
//
// Insets:
//   Tile-icon insets (small / linear / block buckets) come from
//   localStorage.hq_tile_insets_v1 — written by the map editor's tile
//   slider. The renderer reads them via tileInsetForBbox(cellsW, cellsH)
//   to keep the PNG centred with a bit of breathing room.
//
// Public API (window.HQTileArt):
//   init({ ctx, CELL, getLastView, drawBoard, isAltOn })  — once at boot
//     ctx, CELL                  — canvas + cell-size from client.js
//     getLastView / drawBoard    — for async-load redraws
//     isAltOn                    — () => bool, reads HQFurnitureArt's
//                                  ALT_FURN_ON pref so the toggle is
//                                  shared.
//   drawTileIcon(kind, px, py, pw, ph)  — paint a tile PNG. Returns
//                                         true if drawn, false if no
//                                         image (caller falls back).
//   tileInsetForBbox(cellsW, cellsH)    — inset in px for the bbox.

(function (global) {
  'use strict';

  let _ctx = null;
  let _CELL = 32;
  let _getLastView = null;
  let _drawBoard = null;
  let _isAltOn = () => false;

  function _redraw() {
    const v = _getLastView && _getLastView();
    if (v && _drawBoard) _drawBoard(v);
  }

  // ----- Tile file maps (canonical + alt) ------------------------------
  // Sourced from /api/canonical-tiles. Hardcoded fallback keeps things
  // rendering while the fetch is in flight.
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
  let TILE_FILE_ALT = {
    'rubble':         'Block-Square-Single.png',
    'rubble-double':  'Double-Block-Tile.png',
    'stairway':       'Stair-way.png',
  };

  function applyCanonicalTiles(yamlData) {
    const tiles = (yamlData && yamlData.tiles) || {};
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
      // Wipe both caches so the next draw re-resolves through the
      // refreshed alias maps.
      for (const k of Object.keys(TILE_IMG))     delete TILE_IMG[k];
      for (const k of Object.keys(TILE_IMG_ALT)) delete TILE_IMG_ALT[k];
      _redraw();
    }
  }

  // ----- Image caches (canonical + alt) -------------------------------
  const TILE_IMG     = {};
  const TILE_IMG_ALT = {};
  function getTileImg(kind) {
    // Alt art for tiles only kicks in when (a) the alt-art pref is on
    // and (b) the tile has an alt file declared. Otherwise canonical.
    const useAlt = _isAltOn() && !!TILE_FILE_ALT[kind];
    const cache = useAlt ? TILE_IMG_ALT : TILE_IMG;
    if (cache[kind] !== undefined) return cache[kind];
    const fn = useAlt ? TILE_FILE_ALT[kind] : TILE_FILE[kind];
    if (!fn) { cache[kind] = null; return null; }
    const img = new Image();
    const entry = { img, ready: false };
    cache[kind] = entry;
    img.onload  = () => { entry.ready = true; _redraw(); };
    img.onerror = () => { cache[kind] = null; };
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

  // ----- Tile-icon insets ---------------------------------------------
  // Written by the map editor's tile sliders. Cross-tab synced via the
  // `storage` event so a slider drag in the editor live-updates the
  // running game.
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

  // ----- Cross-tab live sync ------------------------------------------
  window.addEventListener('storage', (e) => {
    if (e.key === TILE_INSETS_LS_KEY) {
      TILE_INSETS = _readTileInsets();
      _redraw();
    }
  });

  function init(deps) {
    _ctx = deps.ctx;
    _CELL = deps.CELL;
    _getLastView = deps.getLastView;
    _drawBoard = deps.drawBoard;
    if (typeof deps.isAltOn === 'function') _isAltOn = deps.isAltOn;

    (async () => {
      try {
        const r = await fetch('/api/canonical-tiles');
        if (r.ok) applyCanonicalTiles(await r.json());
      } catch { /* offline → keep fallback */ }
    })();
  }

  global.HQTileArt = {
    init,
    drawTileIcon,
    tileInsetForBbox,
  };
})(typeof window !== 'undefined' ? window : globalThis);
