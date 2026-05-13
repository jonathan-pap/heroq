// =====================================================================
// install-canonical-q03.js
//
// Promotes sandbox-canonical-q03-…json to data/quests/quest3-lair-of-
// the-orc-warlord.json with Quest 3 canonical metadata applied.
//
// Run:  node scripts/install-canonical-q03.js
// =====================================================================

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, '..', 'data', 'quests', 'sandbox',
                         'sandbox-canonical-q03-lairofthe-orc-warlord.json');
const MAIN    = path.join(__dirname, '..', 'data', 'quests',
                         'quest3-lair-of-the-orc-warlord.json');

if (!fs.existsSync(SANDBOX)) {
  throw new Error(
    `${SANDBOX} not found. Run scripts/build-quest1-from-xml.js HQBase-03-LairoftheOrcWarlord_US.xml first.`
  );
}

const q = JSON.parse(fs.readFileSync(SANDBOX, 'utf8'));

// ---- 1. Quest metadata --------------------------------------------------
q.id = 'quest3-lair-of-the-orc-warlord';
q.title = 'Lair of the Orc Warlord';
q.subtitle = 'Quest 3';
q.category = 'main';
q.intro =
  "Ulag, the Orc Warlord, has been raising an army of orcs and goblins " +
  "to march on the Empire. The heroes must find his lair and slay him " +
  "before his horde sets out. Mentor charges them with the task — " +
  "complete this quest and the borderlands stay safe.";
q._canonical_notes =
  "Auto-generated from canonical HeroScribe XML " +
  "(assets/maps/HQBase-03-LairoftheOrcWarlord_US.xml) via " +
  "scripts/build-quest1-from-xml.js, then promoted by " +
  "scripts/install-canonical-q03.js. Boss is Ulag — represented by an " +
  "Orc figure with boosted stats (Body 5, Mind 4, Attack 4, Defend 4) " +
  "per the 2021 rulebook. Wandering monster: Orc.";
q.wanderingMonster = 'orc';

// ---- 2. Ulag — boss override on the centrally-placed throne-room Orc ---
// XML places several orcs in the southern throne room (rows 16–17 in
// 1-based). The central one — Orc (5, 16) → 0-based (4, 15) — is Ulag.
// He retains type 'orc' so the existing engine treats him correctly,
// but we boost stats to canonical boss values and rename him.
const ulag = q.monsters.find(m =>
  m.type === 'orc' && m.at[0] === 4 && m.at[1] === 15
);
if (ulag) {
  ulag.id = 'ulag';
  ulag.name = 'Ulag';
  ulag.attack = 4;
  ulag.defend = 4;
  ulag.body = 5;
  ulag.bodyMax = 5;
  ulag.mind = 4;
  ulag.mindMax = 4;
  ulag._note = "Quest 3 boss — Orc Warlord. Body 5 / Mind 4 / Attack 4 / Defend 4.";
} else {
  console.warn(
    "Could not find Orc at (4, 15) to designate as Ulag — check XML; " +
    "Quest 3 objective will not have a valid monsterId."
  );
}

// ---- 3. Treasure chest values (default 50g placeholder; adjust here
//        if the canonical rulebook lists specific amounts) ---------------
const treasureOverrides = {
  // No firm per-chest values from the rulebook page; chests stay at the
  // converter's default 50g. Override here if/when canonical values
  // are confirmed (e.g. '8,10': { amount: 200 }).
};
q.treasure = q.treasure.map(t => {
  const key = `${t.at[0]},${t.at[1]}`;
  const override = treasureOverrides[key];
  return override ? { ...t, ...override } : t;
});

// ---- 4. Objective: slay Ulag -------------------------------------------
const ulagId = ulag ? ulag.id : 'ulag';
q.objective = {
  kind: 'kill',
  monsterId: ulagId,
  text: 'Slay Ulag, the Orc Warlord.',
};
q.objectives = [
  { id: 'slay-ulag', kind: 'kill', monsterId: ulagId,
    text: 'Slay Ulag the Orc Warlord' },
];
q.defeat = {
  kind: 'all-dead',
  text: "Ulag's horde rolls forth unopposed.",
};

// ---- 5. Write ----------------------------------------------------------
fs.writeFileSync(MAIN, JSON.stringify(q, null, 2) + '\n');

console.log(`wrote ${MAIN}`);
console.log(`  id=${q.id}  title=${q.title}  category=${q.category}`);
console.log(`  ${q.monsters.length} monsters, ${q.furniture.length} furniture pieces`);
console.log(`  ${q.doors.length} doors, ${q.secretDoors.length} secret door(s)`);
console.log(`  ${q.treasure.length} treasures, ${q.traps.length} floor trap(s), ${q.furnitureTraps.length} chest trap(s)`);
if (ulag) console.log(`  Ulag at L${ulag.at[0] + 1}T${ulag.at[1] + 1}: A${ulag.attack} D${ulag.defend} B${ulag.body} M${ulag.mind}`);
