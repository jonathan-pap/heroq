// HeroQuest — floor texture overlay.
//
// Renders the per-room and corridor PNG textures from /assets/room_textures
// on top of the base canvas floor. Only revealed (fog-cleared) tiles get
// painted — each room is one drawImage + ctx.clip across the union of
// its currently-visible cells; the corridor is one stretched blit
// across the playable rect clipped to revealed corridor cells.
//
// Same texture system the builder + map-editor use; both consume the
// same PNGs under /assets/room_textures.
//
// Public API (window.HQTextures):
//   init({ ctx, CELL, getLastView, drawBoard, isEnabled }) — once at boot
//     ctx          — 2D context to paint into
//     CELL         — pixel size of one grid cell
//     getLastView  — () => the current view object (for redraw callbacks)
//     drawBoard    — view => triggers a full board redraw
//     isEnabled    — () => boolean, returns FLOOR_TEXTURES_ON preference
//   drawFloorTextures(view, tm) — call from drawBoard.

(function (global) {
  'use strict';

  let _ctx = null;
  let _CELL = 0;
  let _getLastView = null;
  let _drawBoard = null;
  let _isEnabled = () => true;
  let _getMode = () => 'canonical';   // 'off' | 'canonical' | 'alt'

  const FLOORS_VER = 3;

  function roomTextureFile(roomId, mode) {
    const m = String(roomId).match(/(\d+)/);
    if (!m) return null;
    const n = m[1].padStart(2, '0');
    return mode === 'alt' ? `room_${n}_alt.png` : `room_${n}.png`;
  }

  // Two caches — one per art set — so toggling alt vs canonical does
  // not blow away images already in memory.
  // mode → roomId → { img, ready }
  const ROOM_TEX = { canonical: {}, alt: {} };
  function loadRoomTexture(roomId) {
    const mode = _getMode() === 'alt' ? 'alt' : 'canonical';
    const cache = ROOM_TEX[mode];
    if (cache[roomId]) return cache[roomId];
    const file = roomTextureFile(roomId, mode);
    const img = new Image();
    const entry = { img, ready: false };
    cache[roomId] = entry;
    if (!file) { cache[roomId] = { img: null, ready: false, error: true }; return cache[roomId]; }
    img.onload  = () => {
      entry.ready = true;
      const v = _getLastView && _getLastView();
      if (v && _drawBoard) _drawBoard(v);
    };
    img.onerror = () => { cache[roomId] = { img: null, ready: false, error: true }; };
    img.src = `/assets/room_textures/${file}?v=${FLOORS_VER}`;
    return entry;
  }

  // file → { img, ready }
  const CORRIDOR_TEX = {};
  function loadCorridorTexture(file) {
    if (CORRIDOR_TEX[file]) return CORRIDOR_TEX[file];
    const img = new Image();
    const entry = { img, ready: false };
    CORRIDOR_TEX[file] = entry;
    img.onload  = () => {
      entry.ready = true;
      const v = _getLastView && _getLastView();
      if (v && _drawBoard) _drawBoard(v);
    };
    img.onerror = () => { CORRIDOR_TEX[file] = { img: null, ready: false, error: true }; };
    img.src = `/assets/room_textures/${file}?v=${FLOORS_VER}`;
    return entry;
  }

  // Default: corridor without walls (corridor walls live in the room
  // textures + drawWalls). If a quest ever wants the printed wall frame
  // we can expose another toggle later.
  function currentCorridorTexture() { return loadCorridorTexture('corridor_no_walls.png'); }

  // Room bbox cache from master board.yaml. Fetched lazily on first
  // texture render. We need the full bbox (not just revealed cells)
  // because the per-room PNG is stretched across the room's entire
  // footprint; each revealed cell then samples its correct slice.
  let ROOM_BBOX = null;             // { [roomId]: { mc, mr, spanC, spanR } }
  let ROOM_BBOX_LOADING = false;
  async function loadRoomBbox() {
    if (ROOM_BBOX || ROOM_BBOX_LOADING) return;
    ROOM_BBOX_LOADING = true;
    try {
      const r = await fetch('/api/board');
      if (!r.ok) return;
      const b = await r.json();
      const bbox = {};
      for (const room of (b.rooms || [])) {
        let mc = 99, mr = 99, xc = -1, xr = -1;
        for (const [c, rr] of (room.cells || [])) {
          if (c < mc) mc = c; if (rr < mr) mr = rr;
          if (c > xc) xc = c; if (rr > xr) xr = rr;
        }
        bbox[room.id] = { mc, mr, spanC: xc - mc + 1, spanR: xr - mr + 1 };
      }
      ROOM_BBOX = bbox;
      const v = _getLastView && _getLastView();
      if (v && _drawBoard) _drawBoard(v);
    } catch { /* leave null — textures simply won't render until next try */ }
    finally { ROOM_BBOX_LOADING = false; }
  }

  // Render textures over the base floor tiles. Called after the tile
  // loop in drawBoard. Only paints over REVEALED tiles so fog of war is
  // preserved. Each room is one drawImage stretched to its bbox area,
  // clipped to revealed cells of that room — same "blit once + clip"
  // pattern as the builder/tool.
  function drawFloorTextures(view, _tm) {
    if (!_isEnabled()) return;
    if (!ROOM_BBOX) { loadRoomBbox(); return; }
    const [W, H] = view.boardSize;

    // Group revealed, non-blocked tiles by zone. Blocked tiles render
    // their rubble icon over a floor base painted in drawTile (see the
    // blocked branch there) so the floor texture is NOT drawn over the
    // rubble.
    const byRoom = new Map();         // roomId → [tile,...]
    const corridorTiles = [];
    for (const t of view.tiles) {
      if (!t.revealed || t.blocked) continue;
      if (t.roomId && t.kind !== 'corridor') {
        if (!byRoom.has(t.roomId)) byRoom.set(t.roomId, []);
        byRoom.get(t.roomId).push(t);
      } else if (t.kind === 'corridor') {
        corridorTiles.push(t);
      }
    }
    // Rooms — one blit + clip per room
    for (const [roomId, tiles] of byRoom) {
      const bbox = ROOM_BBOX[roomId];
      if (!bbox) continue;
      const tex = loadRoomTexture(roomId);
      if (!tex.ready || !tex.img) continue;
      _ctx.save();
      _ctx.beginPath();
      for (const t of tiles) _ctx.rect(t.x * _CELL, t.y * _CELL, _CELL, _CELL);
      _ctx.clip();
      _ctx.drawImage(tex.img,
                    0, 0, tex.img.naturalWidth, tex.img.naturalHeight,
                    bbox.mc * _CELL, bbox.mr * _CELL,
                    bbox.spanC * _CELL, bbox.spanR * _CELL);
      _ctx.restore();
    }
    // Corridor — single blit stretched across the playable rect
    if (corridorTiles.length) {
      const cor = currentCorridorTexture();
      if (cor.ready && cor.img) {
        _ctx.save();
        _ctx.beginPath();
        for (const t of corridorTiles) _ctx.rect(t.x * _CELL, t.y * _CELL, _CELL, _CELL);
        _ctx.clip();
        _ctx.drawImage(cor.img,
                      0, 0, cor.img.naturalWidth, cor.img.naturalHeight,
                      0, 0, W * _CELL, H * _CELL);
        _ctx.restore();
      }
    }
  }

  function init(deps) {
    _ctx = deps.ctx;
    _CELL = deps.CELL;
    _getLastView = deps.getLastView;
    _drawBoard = deps.drawBoard;
    if (typeof deps.isEnabled === 'function') _isEnabled = deps.isEnabled;
    if (typeof deps.getMode === 'function') _getMode = deps.getMode;
  }

  global.HQTextures = { init, drawFloorTextures };
})(typeof window !== 'undefined' ? window : globalThis);
