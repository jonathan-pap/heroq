// HeroQuest — entity painters (treasure / secretDoor / trap / hero / monster).
//
// Pure canvas helpers: each takes one game-state entity and paints it
// into the canvas at the right cell. The hero / monster painters prefer
// the loaded PNG sprite when present and fall back to a glyph + filled
// shape otherwise. The trap painter prefers the canonical tile PNG via
// HQFurnitureArt.drawTileIcon and falls back to a pit circle / X cross.
//
// No game state lives here; nothing mutates outside the canvas context.
//
// Public API (window.HQEntityDraw):
//   init({ ctx, CELL, sprites, drawTileIcon })  — once at boot
//     ctx          — 2D canvas context
//     CELL         — pixel size of one grid cell
//     sprites      — { monsterSprites, heroSprites, variantKey }
//                    (the HQSprites surface used by the hero / monster
//                    painters). Captured by reference so async PNG
//                    loads keep updating the same maps.
//     drawTileIcon — kind/x/y/w/h → bool (HQFurnitureArt.drawTileIcon)
//   drawTreasure(t)              — small ★ + dot at the cell centre
//   drawSecretDoor(d)            — dashed purple line across the edge
//   drawTrap(tr)                  — PNG icon (preferred) or fallback shape;
//                                   gmOnly traps are painted at half alpha
//   drawHero(h, isCurrent)        — variant token (preferred) or coloured
//                                   circle + glyph; isCurrent rings yellow
//   drawMonster(m, isSelected)    — monster token (preferred) or coloured
//                                   diamond + glyph; isSelected rings red;
//                                   wounded monsters get a body HP bar

(function (global) {
  'use strict';

  let _ctx = null;
  let _CELL = 32;
  let _monsterSprites = {};
  let _heroSprites = {};
  let _variantKey = (id, variant) => `${id}:${variant}`;
  let _drawTileIcon = () => false;

  function drawTreasure(t) {
    const x = t.at[0] * _CELL + _CELL / 2;
    const y = t.at[1] * _CELL + _CELL / 2;
    _ctx.fillStyle = '#c5a14e';
    _ctx.beginPath();
    _ctx.arc(x, y - 6, 4, 0, Math.PI * 2);
    _ctx.fill();
    _ctx.fillStyle = 'rgba(255,216,112,0.5)';
    _ctx.font = '8px serif';
    _ctx.textAlign = 'center';
    _ctx.fillText('★', x, y + 6);
  }

  function drawSecretDoor(d) {
    const cx = (d.a[0] + d.b[0] + 1) * _CELL / 2;
    const cy = (d.a[1] + d.b[1] + 1) * _CELL / 2;
    const horizontal = (d.a[1] === d.b[1]);
    _ctx.save();
    _ctx.setLineDash([4, 3]);
    _ctx.strokeStyle = '#8b4ca0';
    _ctx.lineWidth = 3;
    _ctx.beginPath();
    if (horizontal) {
      _ctx.moveTo(cx, cy - 14);
      _ctx.lineTo(cx, cy + 14);
    } else {
      _ctx.moveTo(cx - 14, cy);
      _ctx.lineTo(cx + 14, cy);
    }
    _ctx.stroke();
    _ctx.restore();
  }

  function drawTrap(tr) {
    const x = tr.at[0] * _CELL;
    const y = tr.at[1] * _CELL;
    const cx = x + _CELL / 2;
    const cy = y + _CELL / 2;
    _ctx.save();
    if (tr.gmOnly) _ctx.globalAlpha = 0.45;
    // Prefer canonical heroscribe PNG when available
    if (_drawTileIcon(tr.type || tr.kind || 'pit', x, y, _CELL, _CELL)) {
      _ctx.restore();
      return;
    }
    // Pixel-art fallback (used while the trap PNG loads or for unknown kinds)
    if (tr.type === 'pit') {
      _ctx.fillStyle = '#1a1208';
      _ctx.beginPath();
      _ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.strokeStyle = '#d8a040';
      _ctx.lineWidth = 2;
      _ctx.stroke();
    } else {
      _ctx.strokeStyle = '#d8a040';
      _ctx.lineWidth = 3;
      _ctx.beginPath();
      _ctx.moveTo(cx - 8, cy - 8); _ctx.lineTo(cx + 8, cy + 8);
      _ctx.moveTo(cx + 8, cy - 8); _ctx.lineTo(cx - 8, cy + 8);
      _ctx.stroke();
    }
    _ctx.restore();
  }

  function drawHero(h, isCurrent) {
    if (h.dead) return;
    const cx = h.at[0] * _CELL + _CELL / 2;
    const cy = h.at[1] * _CELL + _CELL / 2;
    // Prefer the player's chosen variant token; fall back to the
    // gender-neutral default if the variant PNG hasn't loaded yet.
    const sprite = _heroSprites[_variantKey(h.id, h.variant || 'male')] || _heroSprites[h.id];
    if (isCurrent) {
      _ctx.strokeStyle = 'rgba(255,216,112,0.9)';
      _ctx.lineWidth = 3;
      _ctx.beginPath();
      _ctx.arc(cx, cy, _CELL / 2 - 1, 0, Math.PI * 2);
      _ctx.stroke();
    }
    if (sprite) {
      _ctx.drawImage(sprite, cx - _CELL/2 + 3, cy - _CELL/2 + 3, _CELL - 6, _CELL - 6);
    } else {
      _ctx.fillStyle = h.color;
      _ctx.beginPath();
      _ctx.arc(cx, cy, _CELL / 2 - 4, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.strokeStyle = '#000';
      _ctx.lineWidth = 1.5;
      _ctx.stroke();
      _ctx.fillStyle = 'white';
      _ctx.font = 'bold 16px serif';
      _ctx.textAlign = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(h.glyph, cx, cy + 1);
    }
  }

  function drawMonster(m, isSelected) {
    const cx = m.at[0] * _CELL + _CELL / 2;
    const cy = m.at[1] * _CELL + _CELL / 2;
    const sprite = _monsterSprites[m.type];
    if (isSelected) {
      _ctx.strokeStyle = 'rgba(255,80,80,0.9)';
      _ctx.lineWidth = 3;
      _ctx.beginPath();
      _ctx.arc(cx, cy, _CELL / 2 - 1, 0, Math.PI * 2);
      _ctx.stroke();
    }
    if (sprite) {
      _ctx.drawImage(sprite, cx - _CELL/2 + 3, cy - _CELL/2 + 3, _CELL - 6, _CELL - 6);
    } else {
      // Diamond shape — programmer-art fallback
      _ctx.fillStyle = m.color;
      _ctx.beginPath();
      _ctx.moveTo(cx, cy - _CELL/2 + 4);
      _ctx.lineTo(cx + _CELL/2 - 4, cy);
      _ctx.lineTo(cx, cy + _CELL/2 - 4);
      _ctx.lineTo(cx - _CELL/2 + 4, cy);
      _ctx.closePath();
      _ctx.fill();
      _ctx.strokeStyle = '#000';
      _ctx.lineWidth = 1.5;
      _ctx.stroke();
      _ctx.fillStyle = 'white';
      _ctx.font = 'bold 14px serif';
      _ctx.textAlign = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(m.glyph, cx, cy + 1);
    }
    // HP indicator if wounded — drawn over either sprite or glyph
    if (m.body < m.bodyMax) {
      _ctx.fillStyle = 'rgba(0,0,0,0.7)';
      _ctx.fillRect(cx - 10, cy + _CELL/2 - 8, 20, 4);
      _ctx.fillStyle = '#c83030';
      _ctx.fillRect(cx - 10, cy + _CELL/2 - 8, 20 * (m.body / m.bodyMax), 4);
    }
  }

  function init(deps) {
    _ctx = deps.ctx;
    _CELL = deps.CELL;
    if (deps.sprites) {
      _monsterSprites = deps.sprites.monsterSprites || _monsterSprites;
      _heroSprites    = deps.sprites.heroSprites    || _heroSprites;
      if (deps.sprites.variantKey) _variantKey = deps.sprites.variantKey;
    }
    if (deps.drawTileIcon) _drawTileIcon = deps.drawTileIcon;
  }

  global.HQEntityDraw = {
    init,
    drawTreasure, drawSecretDoor, drawTrap, drawHero, drawMonster,
  };
})(typeof window !== 'undefined' ? window : globalThis);
