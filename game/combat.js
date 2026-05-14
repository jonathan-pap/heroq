// =====================================================================
// game/combat.js — combat dice
//
// Owns the canonical 6-face HeroQuest combat die (3 skulls / 2 hero
// shields / 1 monster shield). Damage resolution + effective-dice
// calculation still live in server.js for now; this module is the
// first extraction step and may grow to absorb more combat logic
// later (see docs/BACKLOG.md).
//
// See game/combat.md for the public API.
// =====================================================================
'use strict';

// Canonical HeroQuest combat die — six faces:
//   3 × skull           — attacker hit
//   2 × heroShield      — hero blocks
//   1 × monsterShield   — monster blocks
// Per the 2021 rulebook. Older editions use the same distribution.
const DICE_FACES = [
  'skull', 'skull', 'skull',
  'heroShield', 'heroShield',
  'monsterShield',
];

// rollCombatDie() — uniform pick from DICE_FACES. Returns the face
// string directly so callers can switch on it without indexing.
function rollCombatDie() {
  return DICE_FACES[Math.floor(Math.random() * 6)];
}

// rollAttackDice(n) — n combat dice, returned as an array of face
// strings. Used for both attack rolls and defence rolls (the dice
// are physically the same; only the side that counts each face
// differs, which the caller handles).
function rollAttackDice(n) {
  const r = [];
  for (let i = 0; i < n; i++) r.push(rollCombatDie());
  return r;
}

module.exports = { DICE_FACES, rollCombatDie, rollAttackDice };
