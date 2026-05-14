// =====================================================================
// game/spells.js — spell-effect resolver
//
// `applySpellEffect` switches on `spell.effect` (the engine-hook
// string from data/cards/spells.yaml) and mutates state per the
// 2021 rules: heal body, double movement, pass walls / occupants,
// rock skin (defend until wounded), courage (attack until safe),
// sleep (target rolls mind dice to resist), skip next turn, direct
// damage (e.g. Fire of Wrath), and the Genie summon (5-die ranged
// attack).
//
// LoS gate: a spell whose `range !== 'anywhere'` and whose target is
// NOT `self` requires the caster to have line-of-sight to the
// target's cell. Genie and Fire of Wrath are board-wide and bypass
// this check.
//
// `handleCastSpell` (the entry point with hand / artifact / spell-
// per-turn checks and the WebSocket broadcast) stays in server.js
// because it touches turn-state mutation, broadcastRoom, and the
// Wand of Recall counter.
//
// See game/spells.md for the public API + deps contract.
// =====================================================================
'use strict';

const { lineOfSight } = require('./los');
const { rollAttackDice } = require('./combat');

// resolveTarget(s, kind, t)
//   Look up the live hero / monster the spell is targeting from the
//   wire-format `{ kind, id }` payload. Filters out dead pieces.
function resolveTarget(s, kind, t) {
  if (!t) return null;
  if (t.kind === 'hero') {
    const h = s.heroes.find(x => x.id === t.id && !x.dead);
    return h ? { kind: 'hero', ref: h } : null;
  }
  if (t.kind === 'monster') {
    const m = s.monsters.find(x => x.id === t.id && !x.dead);
    return m ? { kind: 'monster', ref: m } : null;
  }
  return null;
}

// applySpellEffect(room, caster, spell, target, deps) → bool
//   Returns true on success, false when the spell cannot resolve
//   (no target, target out of LoS, wrong target kind). The caller
//   (handleCastSpell) only spends the card on a true return.
function applySpellEffect(room, caster, spell, target, deps) {
  const { logEvent, checkEndConditions } = deps;
  const s = room.state;

  const tgt = resolveTarget(s, spell.target, target);
  if (spell.target !== 'self' && spell.target !== 'line' && !tgt) return false;

  // 2021 rule: a spell may only be cast on a target the caster can SEE.
  // Spells flagged `range: anywhere` (Genie summon, Fire of Wrath) skip
  // the LoS check; everything else needs an unobstructed line.
  if (tgt && spell.range !== 'anywhere' && spell.target !== 'self') {
    const tgtCell = tgt.ref && tgt.ref.at;
    if (tgtCell && !lineOfSight(s, caster.at, tgtCell)) {
      logEvent(room, `${caster.name} has no line of sight to that target.`);
      return false;
    }
  }

  switch (spell.effect) {
    case 'healBody': {
      const t = tgt; if (!t || t.kind !== 'hero') return false;
      const heal = Math.min(spell.amount || 4, t.ref.bodyMax - t.ref.body);
      t.ref.body += heal;
      logEvent(room, `${t.ref.name} restored ${heal} Body.`, 'spell');
      return true;
    }
    case 'doubleNextMovement': {
      const t = tgt; if (!t || t.kind !== 'hero') return false;
      t.ref.status.doubleNextMovement = true;
      return true;
    }
    case 'passWalls': {
      const t = tgt; if (!t || t.kind !== 'hero') return false;
      t.ref.status.passWalls = true;
      return true;
    }
    case 'passOccupants': {
      const t = tgt; if (!t || t.kind !== 'hero') return false;
      t.ref.status.passOccupants = true;
      return true;
    }
    case 'bonusDefendUntilWounded': {
      const t = tgt; if (!t || t.kind !== 'hero') return false;
      t.ref.status.rockSkin = true;
      return true;
    }
    case 'bonusAttackUntilSafe': {
      const t = tgt; if (!t || t.kind !== 'hero') return false;
      t.ref.status.courage = true;
      return true;
    }
    case 'skipNextTurn': {
      const t = tgt; if (!t) return false;
      t.ref.status.skipNextTurn = true;
      return true;
    }
    case 'directDamage': {
      const t = tgt; if (!t) return false;
      const dmg = spell.damage || 1;
      const def = spell.defenceDice || 0;
      const dDice = rollAttackDice(def);
      const blockFace = (t.kind === 'hero') ? 'heroShield' : 'monsterShield';
      const blocks = dDice.filter(f => f === blockFace).length;
      const taken = Math.max(0, dmg - blocks);
      t.ref.body = Math.max(0, t.ref.body - taken);
      if (t.ref.body === 0) t.ref.dead = true;
      // Show as combat-resolution payload so the existing modal can render.
      s.combat = {
        attacker: { kind: 'hero', id: caster.id, name: caster.name + ` (${spell.name})` },
        defender: { kind: t.kind, id: t.ref.id, name: t.ref.name || t.ref.type },
        attackDice: Array(dmg).fill('skull'),
        defendDice: dDice,
        skulls: dmg, blocks, damage: taken, killed: t.ref.dead,
        ts: Date.now(),
      };
      // Break rockSkin if hero defender took damage.
      if (t.kind === 'hero' && taken > 0) t.ref.status.rockSkin = false;
      checkEndConditions(room);
      return true;
    }
    case 'sleep': {
      const t = tgt; if (!t) return false;
      const mind = t.ref.mind || 0;
      const dDice = rollAttackDice(mind);
      const blockFace = (t.kind === 'hero') ? 'heroShield' : 'monsterShield';
      const negated = dDice.some(f => f === blockFace);
      if (negated) {
        logEvent(room, `${t.ref.name || t.ref.type} resists the Sleep spell.`, 'spell');
      } else {
        t.ref.status.sleeping = true;
        logEvent(room, `${t.ref.name || t.ref.type} falls asleep!`, 'spell');
      }
      return true;
    }
    case 'summonGenie': {
      // Simplified: Genie attacks the chosen target with 5 attack dice.
      const t = tgt; if (!t) return false;
      const aDice = rollAttackDice(5);
      const blockFace = (t.kind === 'hero') ? 'heroShield' : 'monsterShield';
      const dDice = rollAttackDice(t.ref.defend || t.ref.defendBase || 2);
      const skulls = aDice.filter(f => f === 'skull').length;
      const blocks = dDice.filter(f => f === blockFace).length;
      const dmg = Math.max(0, skulls - blocks);
      t.ref.body = Math.max(0, t.ref.body - dmg);
      if (t.ref.body === 0) t.ref.dead = true;
      s.combat = {
        attacker: { kind: 'hero', id: caster.id, name: 'Genie' },
        defender: { kind: t.kind, id: t.ref.id, name: t.ref.name || t.ref.type },
        attackDice: aDice, defendDice: dDice,
        skulls, blocks, damage: dmg, killed: t.ref.dead,
        ts: Date.now(),
      };
      checkEndConditions(room);
      return true;
    }
  }
  return false;
}

module.exports = { applySpellEffect, resolveTarget };
