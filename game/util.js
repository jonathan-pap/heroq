// =====================================================================
// game/util.js — pure utility helpers
//
// Zero game state, zero side-effects. Random IDs, dice, geometry,
// array helpers. See game/util.md for the public API.
// =====================================================================
'use strict';

const crypto = require('crypto');

// ---- IDs ------------------------------------------------------------
// uid()  — opaque per-session token (32 hex chars).
// pid()  — public id safe to expose to peers (12 hex chars).
// code() — 4-char alphanumeric lobby code, no ambiguous letters (no I/L/O).
function uid() { return crypto.randomBytes(16).toString('hex'); }
function pid() { return crypto.randomBytes(6).toString('hex'); }
function code() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// ---- Dice -----------------------------------------------------------
// rollD6() — single standard six-sided die (1..6). Used for hero
// movement rolls and miscellaneous d6 mechanics. Combat-specific dice
// (skull / shield faces) live in game/combat.js.
function rollD6() { return 1 + Math.floor(Math.random() * 6); }

// ---- Geometry -------------------------------------------------------
// bresenham(from, to) — list of cells from `from` to `to` inclusive
// using the classic Bresenham line algorithm. Used by line-of-sight
// (game/los.js) to walk the straight-line trace between two cells.
function bresenham(from, to) {
  let [x0, y0] = from;
  const [x1, y1] = to;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out = [];
  while (true) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

// ---- Arrays ---------------------------------------------------------
// shuffle(arr) — Fisher-Yates in place; returns the same array for
// convenience. Used by deck builders (game/treasure-deck.js etc.).
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { uid, pid, code, rollD6, bresenham, shuffle };
