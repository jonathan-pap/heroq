// HeroQuest — fallback canvas primitives for furniture pieces.
//
// Each function paints one piece (table / chest / throne / tomb /
// weapon-rack / skull-rack / bookcase / alchemist-bench / fireplace /
// cupboard / sorcerer-table / generic block) into the supplied bbox.
// These are the FALLBACK renderer used when no PNG art is loaded for
// the piece — the renderer first tries drawFurniturePieceImage(); when
// that returns false, drawShape() dispatches here.
//
// Pure pixel-pushing: nothing about game state, no fog, no facing
// transforms. Callers wrap with ctx.save/translate/rotate/restore for
// rotated pieces.
//
// Public API (window.HQFurnitureDraw):
//   init({ ctx, CELL })           — once at boot
//   drawShape(kind, x, y, w, h)   — dispatcher across all 12 pieces
//                                   (handles legacy aliases like
//                                   sarcophagus → tomb,
//                                   alchemist-bench → alchemists-bench,
//                                   sorcerer-table → sorcerers-table)

(function (global) {
  'use strict';

  let ctx = null;
  let CELL = 32;

  function drawGenericFurniture(x, y, w, h) {
    ctx.fillStyle = '#3e2a16';
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    ctx.strokeStyle = '#1c1208';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  }

  // --- Table: long wooden plank with leg dots at each end
  function drawTable(x, y, w, h) {
    ctx.fillStyle = '#7a4a1c';
    ctx.fillRect(x + 3, y + 8, w - 6, h - 16);
    ctx.strokeStyle = '#3e2208';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 3, y + 8, w - 6, h - 16);
    // wood-grain — span the full width
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (const dy of [0, 6]) {
      if (y + 12 + dy >= y + h - 8) break;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 12 + dy); ctx.lineTo(x + w - 5, y + 12 + dy);
      ctx.stroke();
    }
    // legs: at the four corners of the table footprint
    ctx.fillStyle = '#3e2208';
    ctx.fillRect(x + 5, y + h - 8, 3, 5);
    ctx.fillRect(x + w - 8, y + h - 8, 3, 5);
  }

  // --- Chest: rounded-top box with a brass band + lock (canonical 1x1)
  function drawChest(x, y, w, h) {
    ctx.fillStyle = '#6e4520';
    ctx.fillRect(x + 6, y + 12, w - 12, h - 18);
    // arched lid
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 12);
    ctx.quadraticCurveTo(x + w/2, y + 4, x + w - 6, y + 12);
    ctx.lineTo(x + w - 6, y + 14);
    ctx.lineTo(x + 6, y + 14);
    ctx.closePath();
    ctx.fill();
    // metal band
    ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + w/2, y + 6); ctx.lineTo(x + w/2, y + h - 8);
    ctx.stroke();
    // outline
    ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 6, y + 12, w - 12, h - 18);
    // lock
    ctx.fillStyle = '#c8a040';
    ctx.fillRect(x + w/2 - 2, y + 18, 4, 4);
  }

  // --- Throne: chair with high arched back + cushion (canonical 1x1)
  function drawThrone(x, y, w, h) {
    // back
    ctx.fillStyle = '#5a2a4a';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6);
    ctx.lineTo(x + w - 6, y + 6);
    ctx.lineTo(x + w - 6, y + h - 6);
    ctx.lineTo(x + 6, y + h - 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1c1208'; ctx.lineWidth = 1.5;
    ctx.stroke();
    // arched top
    ctx.fillStyle = '#3e1a36';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6);
    ctx.quadraticCurveTo(x + w/2, y - 2, x + w - 6, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // cushion
    ctx.fillStyle = '#c83030';
    ctx.fillRect(x + 9, y + 14, w - 18, h/2 - 6);
    // gold trim
    ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 9, y + 14, w - 18, h/2 - 6);
  }

  // --- Tomb / sarcophagus: rounded capsule with a cross. Cross sits at
  // the head of the casket (centered horizontally for 2x1, top for 1x2).
  function drawTomb(x, y, w, h) {
    ctx.fillStyle = '#a09080';
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 6, w - 8, h - 12, 6);
    ctx.fill();
    ctx.strokeStyle = '#3e2e20'; ctx.lineWidth = 1.5;
    ctx.stroke();
    // cross at head — long axis aware
    const horizontal = w >= h;
    ctx.strokeStyle = '#1c1208'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (horizontal) {
      // cross at left third (head end)
      const cx = x + Math.min(w, CELL) / 2 + (w > CELL ? 0 : 0);
      const cy = y + h/2;
      ctx.moveTo(cx, y + 11); ctx.lineTo(cx, y + h - 11);
      ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy - 4);
    } else {
      const cx = x + w/2;
      ctx.moveTo(cx, y + 11); ctx.lineTo(cx, y + h - 11);
      ctx.moveTo(cx - 4, y + 15); ctx.lineTo(cx + 4, y + 15);
    }
    ctx.stroke();
  }

  // --- Weapon rack: vertical weapons standing on a backing plank.
  // Number of weapons scales with width.
  function drawWeaponRack(x, y, w, h) {
    // backing plank along the bottom
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(x + 2, y + h - 8, w - 4, 4);
    // weapons (vertical lines) — one every 6px across the width
    ctx.strokeStyle = '#a8a8a8'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    const tops = [6, 4, 8, 5, 7, 4, 6];
    let i = 0;
    for (let wx = 7; wx < w - 4; wx += 6) {
      const top = tops[i % tops.length];
      ctx.moveTo(x + wx, y + h - 7);
      ctx.lineTo(x + wx, y + top);
      i++;
    }
    ctx.stroke();
    // axe head on the rightmost weapon
    ctx.fillStyle = '#b8b8b8';
    ctx.beginPath();
    ctx.moveTo(x + w - 8, y + 5); ctx.lineTo(x + w - 4, y + 8); ctx.lineTo(x + w - 7, y + 10);
    ctx.closePath(); ctx.fill();
  }

  // --- Skull rack: small skulls on a plank (row spans full width)
  // For a multi-cell footprint (e.g. 2W × 3H per the canonical spec),
  // draw two vertical wooden posts on the sides, multiple horizontal
  // cross-bars, and a grid of skulls hanging on the bars.
  function drawSkullRack(x, y, w, h) {
    // Two vertical posts on the left and right edges
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(x + 3, y + 3, 4, h - 6);
    ctx.fillRect(x + w - 7, y + 3, 4, h - 6);

    // Horizontal cross-bars — count proportional to height
    const barCount = Math.max(2, Math.round(h / 18));
    const rowSpacing = (h - 12) / Math.max(1, barCount);
    ctx.fillStyle = '#5a3a1c';
    for (let i = 0; i < barCount; i++) {
      const yy = Math.round(y + 6 + i * rowSpacing + rowSpacing * 0.7);
      ctx.fillRect(x + 5, yy, w - 10, 3);
    }

    // Skulls on each cross-bar
    const skullsPerRow = Math.max(1, Math.floor((w - 12) / 9));
    for (let row = 0; row < barCount; row++) {
      const yy = Math.round(y + 6 + row * rowSpacing + rowSpacing * 0.4);
      for (let col = 0; col < skullsPerRow; col++) {
        const sx = Math.round(x + 9 + col * (w - 18) / Math.max(1, skullsPerRow));
        ctx.fillStyle = '#e8e0d0';
        ctx.beginPath(); ctx.arc(sx, yy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1c1208';
        ctx.fillRect(sx - 2, yy - 1, 1, 1);
        ctx.fillRect(sx + 1, yy - 1, 1, 1);
      }
    }
  }

  // --- Bookcase: shelves of books spanning the full footprint
  function drawBookcase(x, y, w, h) {
    ctx.fillStyle = '#3e2a16';
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    // 3 horizontal shelves
    ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1;
    for (const off of [10, 16, 22]) {
      if (y + off >= y + h - 4) break;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + off); ctx.lineTo(x + w - 5, y + off);
      ctx.stroke();
    }
    // book spines — fill the full width
    const colors = ['#c83030', '#3aa05a', '#5060d0', '#d0a040', '#c83030', '#3aa05a', '#5060d0', '#d0a040'];
    const bookCount = Math.floor((w - 12) / 4);
    for (let i = 0; i < bookCount; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x + 6 + i * 4, y + 11, 3, 4);
      ctx.fillRect(x + 6 + i * 4, y + 17, 3, 4);
    }
  }

  // --- Alchemist's bench: bottles on a long table
  function drawAlchemistBench(x, y, w, h) {
    // table top
    ctx.fillStyle = '#7a4a1c';
    ctx.fillRect(x + 3, y + h - 12, w - 6, 6);
    ctx.strokeStyle = '#3e2208'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 3, y + h - 12, w - 6, 6);
    // bottles — distribute across the width
    const bottleCols = ['#5db4d8', '#3aa05a', '#c83030', '#d0a040', '#5db4d8'];
    const bottleCount = Math.max(3, Math.floor((w - 8) / 7));
    for (let i = 0; i < bottleCount; i++) {
      const bx = x + 6 + i * ((w - 12) / Math.max(1, bottleCount));
      ctx.fillStyle = bottleCols[i % bottleCols.length];
      ctx.fillRect(bx, y + 8, 4, h - 20);
      // neck
      ctx.fillStyle = '#3e2e20';
      ctx.fillRect(bx + 1, y + 6, 2, 2);
    }
  }

  // --- Fireplace: stone hearth with flame
  function drawFireplace(x, y, w, h) {
    // stone surround
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(x + 3, y + 4, w - 6, h - 8);
    ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 3, y + 4, w - 6, h - 8);
    // opening
    ctx.fillStyle = '#1c0a04';
    ctx.fillRect(x + 8, y + 9, w - 16, h - 14);
    // outer flame
    ctx.fillStyle = '#e8801c';
    ctx.beginPath();
    ctx.moveTo(x + w/2, y + h - 8);
    ctx.quadraticCurveTo(x + 10, y + 16, x + w/2, y + 12);
    ctx.quadraticCurveTo(x + w - 10, y + 16, x + w/2, y + h - 8);
    ctx.fill();
    // inner flame
    ctx.fillStyle = '#fdd540';
    ctx.beginPath();
    ctx.moveTo(x + w/2, y + h - 10);
    ctx.quadraticCurveTo(x + 14, y + 18, x + w/2, y + 16);
    ctx.quadraticCurveTo(x + w - 14, y + 18, x + w/2, y + h - 10);
    ctx.fill();
  }

  // --- Cupboard: tall wardrobe with two doors (vertical seam)
  function drawCupboard(x, y, w, h) {
    ctx.fillStyle = '#6e4520';
    ctx.fillRect(x + 6, y + 4, w - 12, h - 8);
    ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 6, y + 4, w - 12, h - 8);
    // central seam
    ctx.beginPath();
    ctx.moveTo(x + w/2, y + 4); ctx.lineTo(x + w/2, y + h - 4);
    ctx.stroke();
    // handles either side of the seam, midway down
    ctx.fillStyle = '#c8a040';
    ctx.fillRect(x + w/2 - 4, y + h/2 - 1, 2, 2);
    ctx.fillRect(x + w/2 + 2, y + h/2 - 1, 2, 2);
  }

  // --- Sorcerer's table: dark table with arcane sigil
  function drawSorcererTable(x, y, w, h) {
    ctx.fillStyle = '#2a1a3a';
    ctx.fillRect(x + 4, y + 8, w - 8, h - 14);
    ctx.strokeStyle = '#5a3088'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 4, y + 8, w - 8, h - 14);
    // legs
    ctx.fillStyle = '#1c0a20';
    ctx.fillRect(x + 6, y + h - 8, 3, 4);
    ctx.fillRect(x + w - 9, y + h - 8, 3, 4);
    // sigil at center
    ctx.strokeStyle = '#c8a0e8'; ctx.lineWidth = 1;
    const cx = x + w/2, cy = y + Math.min(14, h/2);
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
    ctx.stroke();
  }

  // Single dispatcher — knows the legacy-alias map so callers don't.
  function drawShape(kind, x, y, w, h) {
    if (w == null) w = CELL;
    if (h == null) h = CELL;
    switch (kind) {
      case 'table':            return drawTable(x, y, w, h);
      case 'chest':            return drawChest(x, y, w, h);
      case 'throne':           return drawThrone(x, y, w, h);
      case 'sarcophagus':
      case 'tomb':             return drawTomb(x, y, w, h);
      case 'weapon-rack':      return drawWeaponRack(x, y, w, h);
      case 'rack':             return drawSkullRack(x, y, w, h);
      case 'bookcase':         return drawBookcase(x, y, w, h);
      case 'alchemist-bench':
      case 'alchemists-bench': return drawAlchemistBench(x, y, w, h);
      case 'fireplace':        return drawFireplace(x, y, w, h);
      case 'cupboard':         return drawCupboard(x, y, w, h);
      case 'sorcerer-table':
      case 'sorcerers-table':  return drawSorcererTable(x, y, w, h);
      default:                 return drawGenericFurniture(x, y, w, h);
    }
  }

  function init(deps) {
    ctx = deps.ctx;
    CELL = deps.CELL;
  }

  global.HQFurnitureDraw = { init, drawShape };
})(typeof window !== 'undefined' ? window : globalThis);
