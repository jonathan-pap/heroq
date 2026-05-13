// =====================================================================
// install-canonical-q02.js
//
// Promotes sandbox-canonical-q02-…json to data/quests/quest2-rescue-of-
// sir-ragnar.json with Quest 2 canonical metadata applied:
//
//   - id, title, intro (rulebook text)
//   - category: 'main'
//   - Sir Ragnar friendlyNpc placed at LetterX position
//   - Chest A: 0 gold, trapped (poison needle, -1 Body) — already from XML
//   - Chest B: 50 gold (canonical reward)
//   - Objective: escort Sir Ragnar back to the staircase (240g reward)
//   - Wandering monster: Orc
//
// Run:  node scripts/install-canonical-q02.js
// =====================================================================

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, '..', 'data', 'quests', 'sandbox',
                         'sandbox-canonical-q02-the-rescueof-sir-ragnar.json');
const MAIN    = path.join(__dirname, '..', 'data', 'quests',
                         'quest2-rescue-of-sir-ragnar.json');

if (!fs.existsSync(SANDBOX)) {
  throw new Error(
    `${SANDBOX} not found. Run scripts/build-quest1-from-xml.js HQBase-02-TheRescueofSirRagnar_US.xml first.`
  );
}

const q = JSON.parse(fs.readFileSync(SANDBOX, 'utf8'));

// ---- 1. Quest metadata --------------------------------------------------
q.id = 'quest2-rescue-of-sir-ragnar';
q.title = 'The Rescue of Sir Ragnar';
q.subtitle = 'Quest 2';
q.category = 'main';
q.intro =
  "Sir Ragnar, one of the King's most powerful knights, has been " +
  "captured. He is being held by Ulag, the orc warlord. Find Sir Ragnar " +
  "and bring him back to the stairway. Prince Magnus has offered 240 " +
  "gold coins, divided among the heroes, on his safe return — no reward " +
  "if he is killed during the escape.";
q._canonical_notes =
  "Auto-generated from canonical HeroScribe XML " +
  "(assets/maps/HQBase-02-TheRescueofSirRagnar_US.xml) via " +
  "scripts/build-quest1-from-xml.js, then promoted by " +
  "scripts/install-canonical-q02.js. Per the 2021 rulebook: Sir Ragnar " +
  "is represented by the Dread sorcerer figure; his cell is marked X. " +
  "When the cell door is opened, an alarm sounds: all remaining monsters, " +
  "doors and furniture are placed and EVERY door opens. The hero who " +
  "opened the cell moves Sir Ragnar each turn (1 red die). He cannot " +
  "attack, rolls 2 Defend dice, has 2 Body. Heroes cannot search for " +
  "treasure in his cell. Quest fails if Sir Ragnar dies. Wandering monster: Orc.";
q.wanderingMonster = 'orc';

// ---- 2. Sir Ragnar — friendly NPC at LetterX position ------------------
// LetterX in the XML is at (6, 12) 1-based → 0-based (5, 11). Sir Ragnar
// stands behind the door at (7, 12) leftward, in his cell.
q.friendlyNpc = {
  id: 'sir-ragnar',
  name: 'Sir Ragnar',
  displayType: 'dread-sorcerer',
  at: [5, 11],
  body: 2,
  bodyMax: 2,
  defendDice: 2,
  attackDice: 0,
  movementDice: 1,
  alarmTriggerCell: [5, 11],
  rescuedBy: 'stairway',
  _engine_note:
    "Engine support partial: friendlyNpc renders + can be killed for " +
    "defeat. Escort movement (1d6 by the rescuing hero) and alarm trigger " +
    "(every door opens when his cell is breached) not yet wired — see " +
    "objective.fallbackKind for current behaviour.",
};

// ---- 3. Treasure chests — apply canonical amounts ----------------------
// XML LetterA is at (4, 14) → 0-based (3, 13). The TreasureChestTrap is
// adjacent at (3, 14) → 0-based (2, 13). That's chest A — trapped poison
// needle. The converter already added a furniture trap; we just zero
// out its gold (canonical: trapped chests have no reward).
//
// XML LetterB is at (21, 9) → 0-based (20, 8). The TreasureChest is
// adjacent at (20, 9) → 0-based (19, 8). That's chest B — 50g.
const treasureOverrides = {
  '2,13':  { amount: 0,  _note: "A: poison-needle trap — no gold (canonical)" },
  '19,8':  { amount: 50, _note: "B: 50 gold (first searcher only)" },
};
q.treasure = q.treasure.map(t => {
  const key = `${t.at[0]},${t.at[1]}`;
  const override = treasureOverrides[key];
  return override ? { ...t, ...override } : t;
});

// ---- 4. Objective: escort Sir Ragnar back to the staircase -------------
q.objective = {
  kind: 'escort',
  npcId: 'sir-ragnar',
  fallbackKind: 'reach',
  fallbackCell: [5, 11],
  text: "Find Sir Ragnar and escort him back to the staircase.",
  _engine_note:
    "Until the 'escort' objective handler ships, the engine reads the " +
    "fallbackKind ('reach') and treats this as 'a hero must reach Sir " +
    "Ragnar's cell at (5, 11)'.",
};
q.objectives = [
  { id: 'reach-ragnar', kind: 'reach', cell: [5, 11],
    text: "Reach Sir Ragnar's cell at L6T12" },
  { id: 'claim-50',     kind: 'reach', cell: [19, 8],
    text: 'Reach chest B (50g)', optional: true },
];
q.defeat = {
  kind: 'all-dead',
  text: 'All heroes have fallen — or Sir Ragnar with them.',
};

// ---- 5. Write ----------------------------------------------------------
fs.writeFileSync(MAIN, JSON.stringify(q, null, 2) + '\n');

console.log(`wrote ${MAIN}`);
console.log(`  id=${q.id}  title=${q.title}  category=${q.category}`);
console.log(`  ${q.monsters.length} monsters, ${q.furniture.length} furniture pieces`);
console.log(`  ${q.doors.length} doors, ${q.secretDoors.length} secret door(s)`);
console.log(`  ${q.treasure.length} treasures, ${q.furnitureTraps.length} chest/furniture trap(s)`);
console.log(`  Sir Ragnar at L${q.friendlyNpc.at[0] + 1}T${q.friendlyNpc.at[1] + 1}`);
