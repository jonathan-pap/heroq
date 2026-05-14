// =====================================================================
// game/combat.js — combat dice + effective-dice + damage resolution
//
// Owns:
//   • The canonical 6-face HeroQuest combat die (3 skull / 2 hero
//     shield / 1 monster shield) + roll helpers.
//   • `effectiveAttack` / `effectiveDefend` / `effectiveMoveDice` —
//     hero base stats overlaid with equipment + artifact + spell
//     status modifiers.
//   • `resolveAttack` — full attack-resolution pipeline: roll dice,
//     count skulls vs shields, apply damage, handle the
//     drink-to-save potion rule, claim artifacts on hero death,
//     decay one-shot bonuses, write `state.combat` for the UI,
//     emit log lines.
//
// `resolveAttack` mutates state heavily; effective-dice helpers are
// pure functions of the hero record + injected data tables. Both
// take a `deps` arg with the YAML-loaded tables + server.js helpers.
//
// See game/combat.md for the public API + deps contract.
// =====================================================================
'use strict';

// Canonical HeroQuest combat die — six faces:
//   3 × skull           — attacker hit
//   2 × heroShield      — hero blocks
//   1 × monsterShield   — monster blocks
const DICE_FACES = [
  'skull', 'skull', 'skull',
  'heroShield', 'heroShield',
  'monsterShield',
];

function rollCombatDie() {
  return DICE_FACES[Math.floor(Math.random() * 6)];
}
function rollAttackDice(n) {
  const r = [];
  for (let i = 0; i < n; i++) r.push(rollCombatDie());
  return r;
}

// ---- Effective combat dice -----------------------------------------
// Hero base + weapon + artifact + status modifiers.
// `deps` provides the EQUIPMENT + ARTIFACTS YAML tables.

function effectiveAttack(hero, target, deps) {
  const { EQUIPMENT, ARTIFACTS } = deps;
  let dice = hero.attackBase;
  // Weapon
  const w = hero.equipped.weapon ? EQUIPMENT[hero.equipped.weapon] : null;
  if (w && w.replaceAttack) dice = w.replaceAttack;
  // Artifact weapon — additive over weapon if present, otherwise sets
  const aw = hero.equipped.artifactWeapon ? ARTIFACTS[hero.equipped.artifactWeapon] : null;
  if (aw) {
    dice = Math.max(dice, aw.attack || 0);
    if (target && aw.bonusAttackVs && aw.bonusAttackVs.targets.includes(target.type)) {
      dice += aw.bonusAttackVs.extraDice || 0;
    }
  }
  // Status: courage / strength / one-shot
  if (hero.status.courage) dice += 2;
  if (hero.status.bonusAttackOnce > 0) dice += hero.status.bonusAttackOnce;
  // 2021 rule: a hero in a pit attacks with -1 die (minimum 1).
  if (hero.status.inPit) dice = Math.max(1, dice - 1);
  return dice;
}

function effectiveDefend(hero, deps) {
  const { EQUIPMENT, ARTIFACTS } = deps;
  let dice = hero.defendBase;
  const arm = hero.equipped.bodyArmour ? EQUIPMENT[hero.equipped.bodyArmour] : null;
  if (arm && arm.setDefend != null) dice = arm.setDefend;
  // Helmet / shield / bracers / cloak — additive
  for (const slot of ['helmet', 'shield', 'utility']) {
    const it = hero.equipped[slot] ? EQUIPMENT[hero.equipped[slot]] : null;
    if (it && it.defendBonus) dice += it.defendBonus;
  }
  if (arm && arm.defendBonus) dice += arm.defendBonus;
  // Artifact armour replaces base
  const aa = hero.equipped.artifactArmour ? ARTIFACTS[hero.equipped.artifactArmour] : null;
  if (aa && aa.setDefend != null) dice = Math.max(dice, aa.setDefend);
  if (hero.status.rockSkin) dice += 2;
  if (hero.status.bonusDefendOnce > 0) dice += hero.status.bonusDefendOnce;
  // 2021 rule: a hero in a pit defends with -1 die (minimum 1).
  if (hero.status.inPit) dice = Math.max(1, dice - 1);
  return dice;
}

function effectiveMoveDice(hero, deps) {
  const { EQUIPMENT } = deps;
  // Plate armour drops you to 1d6 movement.
  const arm = hero.equipped.bodyArmour ? EQUIPMENT[hero.equipped.bodyArmour] : null;
  return (arm && arm.movePenalty) ? 1 : 2;
}

// ---- Damage resolution ---------------------------------------------
// resolveAttack(room, attacker, defender, deps)
//   attacker / defender: { kind: 'hero'|'monster', ref: heroOrMonster }
//   deps: {
//     EQUIPMENT, ARTIFACTS, MONSTER_TYPES,   (data tables)
//     logEvent,                              (room narration)
//     checkEndConditions,                    (winner / defeat promotion)
//   }
//
// Side effects (typical attack):
//   • defender.ref.body -= max(0, skulls - blocks)
//   • defender.ref.dead = true if body hit 0 (modulo drink-to-save)
//   • state.combat = { ... } snapshot for the UI
//   • state.lostArtifacts append on hero death
//   • state.pendingSaveRoll if drink-choice is ambiguous
//   • status decay (sleeping → awake, rockSkin → broken on damage,
//     one-shot bonusAttack/Defend → 0)
//   • log lines for the swing + any kill
//   • checkEndConditions() at the end
function resolveAttack(room, attacker, defender, deps) {
  const { MONSTER_TYPES, ARTIFACTS, logEvent, checkEndConditions } = deps;
  const s = room.state;
  const a = attacker.ref, d = defender.ref;

  // Compute effective dice with equipment + status.
  const aDiceCount = (attacker.kind === 'hero')
    ? effectiveAttack(a, defender.kind === 'monster' ? d : null, deps)
    : a.attack;
  const dDiceCount = (defender.kind === 'hero') ? effectiveDefend(d, deps) : d.defend;

  const aDice = rollAttackDice(aDiceCount);
  const dDice = rollAttackDice(dDiceCount);

  // Sleeping defender cannot defend.
  const sleeping = d.status && d.status.sleeping;
  const defenderBlockFace = (defender.kind === 'hero') ? 'heroShield' : 'monsterShield';
  const skulls = aDice.filter(f => f === 'skull').length;
  const blocks = sleeping ? 0 : dDice.filter(f => f === defenderBlockFace).length;
  const damage = Math.max(0, skulls - blocks);
  d.body = Math.max(0, d.body - damage);

  // 2021 drink-to-save rule: a hero whose Body Points hit 0 may
  // immediately drink any healing potion in their possession to save
  // themselves. With exactly one healable potion we auto-drink; with
  // multiple we surface a `pendingSaveRoll` for the client modal.
  if (defender.kind === 'hero' && d.body === 0) {
    const heals = (d.inventory || [])
      .map((it, idx) => ({ it, idx }))
      .filter(x => x.it && (x.it.use === 'heal' || x.it.use === 'revive'));
    if (heals.length === 1) {
      const { it, idx } = heals[0];
      const heal = Math.min(it.amount || 4, d.bodyMax);
      d.body = heal;
      d.inventory.splice(idx, 1);
      logEvent(room, `${d.name} drinks a ${it.name} as they fall — saved with ${heal} Body!`, 'treasure');
    } else if (heals.length > 1) {
      s.pendingSaveRoll = {
        heroId: d.id,
        options: heals.map(h => ({ idx: h.idx, name: h.it.name, use: h.it.use, amount: h.it.amount })),
      };
      logEvent(room, `${d.name} is down — choose a potion or perish.`, 'death');
    }
  }

  if (d.body === 0) d.dead = true;

  // Lost artifacts: when a hero dies, monsters claim any artifacts
  // they were carrying (rule: artifacts reappear in a future quest).
  if (defender.kind === 'hero' && d.dead) {
    const carriedArtifacts = ['artifactWeapon', 'artifactArmour', 'artifactItem']
      .map(slot => d.equipped[slot]).filter(Boolean);
    if (carriedArtifacts.length > 0) {
      if (!s.lostArtifacts) s.lostArtifacts = [];
      for (const aid of carriedArtifacts) {
        s.lostArtifacts.push(aid);
        logEvent(room, `Monsters claim the ${ARTIFACTS[aid]?.name || aid}! It will reappear in a future quest.`, 'death');
      }
      d.equipped.artifactWeapon = null;
      d.equipped.artifactArmour = null;
      d.equipped.artifactItem = null;
    }
  }

  // Status decay.
  if (sleeping) d.status.sleeping = false;
  if (defender.kind === 'hero' && damage > 0 && d.status.rockSkin) d.status.rockSkin = false;
  if (attacker.kind === 'hero' && a.status.bonusAttackOnce > 0) a.status.bonusAttackOnce = 0;
  if (defender.kind === 'hero' && d.status.bonusDefendOnce > 0) d.status.bonusDefendOnce = 0;

  const aName = (attacker.kind === 'hero') ? a.name : (a.name || MONSTER_TYPES[a.type]?.name || a.type);
  const dName = (defender.kind === 'hero') ? d.name : (d.name || MONSTER_TYPES[d.type]?.name || d.type);

  s.combat = {
    attacker: { kind: attacker.kind, id: a.id, name: aName },
    defender: { kind: defender.kind, id: d.id, name: dName },
    attackDice: aDice, defendDice: dDice,
    skulls, blocks, damage,
    killed: d.dead,
    sleeping,
    ts: Date.now(),
  };
  logEvent(room, `${aName} attacks ${dName}: ${skulls} skull${skulls === 1 ? '' : 's'} - ${blocks} block${blocks === 1 ? '' : 's'} = ${damage} damage${d.dead ? ' — slain!' : ''}`, 'combat');
  if (defender.kind === 'hero' && d.dead) logEvent(room, `${dName} has fallen!`, 'death');

  checkEndConditions(room);
}

module.exports = {
  DICE_FACES,
  rollCombatDie,
  rollAttackDice,
  effectiveAttack,
  effectiveDefend,
  effectiveMoveDice,
  resolveAttack,
};
