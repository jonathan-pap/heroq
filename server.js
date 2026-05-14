/* ==========================================================
   HERO QUEST — multiplayer server
   Node 18+, ws package
   Architecture mirrors E:\Hitler: Node + ws, vanilla client,
   server-authoritative state, 4-letter room codes, debounced
   JSON snapshot to disk for crash recovery.
   ========================================================== */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { WebSocketServer } = require('ws');
const { decideMonsterTurn, pickBotName } = require('./bots');

// Pure helper modules — see game/*.md for each module's API.
const { uid, pid, code, rollD6, bresenham, shuffle } = require('./game/util');
const _combat = require('./game/combat');
const { DICE_FACES, rollCombatDie, rollAttackDice } = _combat;
const {
  tileAt, occupantAt, isMonsterVisibleToHeroes,
  losEdgeBlocked, lineOfSight, isMultiShareCell,
} = require('./game/los');
const { findPath: _findPathBFS, countVisibleBranches } = require('./game/pathfinding');
const {
  _evalObjectiveOne, evaluateObjectives, requiredObjectivesMet,
} = require('./game/objectives');
const { viewFor: _viewFor } = require('./game/view');
const { freshGameState: _freshGameState } = require('./game/quest-builder');
const { triggerTrapsForCell: _triggerTrapsForCell } = require('./game/traps');
const _td = require('./game/treasure-deck');
const _spells = require('./game/spells');
// Local wrapper — injects this file's `passable` predicate so callers
// keep the older 4-arg signature.
function findPath(s, hero, target, maxLength) {
  return _findPathBFS(s, hero, target, maxLength, passable);
}

function loadYAML(p) { return yaml.load(fs.readFileSync(p, 'utf8')); }

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR   = path.join(__dirname, 'data');
const QUESTS_DIR = path.join(DATA_DIR, 'quests');
const STATE_FILE = path.join(DATA_DIR, 'rooms.json');

const SAVE_DEBOUNCE_MS = 800;
const AI_TICK_MS       = 350;   // pause between AI monster moves so humans can follow
const AI_TICK_JITTER   = 200;

// Bump this when the saved-state shape changes incompatibly. On load,
// snapshots tagged with a different version are dropped to avoid
// restoring stale fog-of-war / door-reveal flags etc.
const STATE_VERSION = 2;

// ==========================================================
// GAME RULES TABLES — loaded from YAML so they're easy to edit
// ==========================================================
let HEROES = {};
let MONSTER_TYPES = {};
let SPELLS = {};                  // id -> hero spell card
let SPELLS_BY_ELEMENT = {};       // element -> [spell card, ...]
let DREAD_SPELLS = {};            // id -> dread (Zargon) spell card
let EQUIPMENT = {};               // id -> equipment card
let TREASURE_DECK_TEMPLATE = [];  // expanded list of treasure cards (count flattened)
let ARTIFACTS = {};               // id -> artifact card
let MASTER_BOARD = null;          // { boardSize, corridorCells:[[x,y]], rooms:[{id,name,cells}] }

function expandRect(r) {
  // [x, y, w, h] → list of [x, y] cells
  const out = [];
  for (let yy = r[1]; yy < r[1] + r[3]; yy++) {
    for (let xx = r[0]; xx < r[0] + r[2]; xx++) out.push([xx, yy]);
  }
  return out;
}

function loadMasterBoard() {
  const p = path.join(DATA_DIR, 'board.yaml');
  if (!fs.existsSync(p)) { MASTER_BOARD = null; return; }
  const raw = loadYAML(p);
  const corridorCells = [];
  for (const r of (raw.corridor?.rects || [])) corridorCells.push(...expandRect(r));
  for (const c of (raw.corridor?.cells || [])) corridorCells.push(c);
  const rooms = (raw.rooms || []).map(r => {
    const cells = r.rect ? expandRect(r.rect) : (r.cells || []);
    return { id: r.id, name: r.name, cells, hidden: r.hidden !== false, color: r.color || null };
  });
  MASTER_BOARD = { boardSize: raw.boardSize, corridorCells, rooms };
}

function loadGameData() {
  HEROES = loadYAML(path.join(DATA_DIR, 'heroes.yaml'));
  MONSTER_TYPES = loadYAML(path.join(DATA_DIR, 'monsters.yaml'));
  SPELLS = loadYAML(path.join(DATA_DIR, 'cards', 'spells.yaml'));
  EQUIPMENT = loadYAML(path.join(DATA_DIR, 'cards', 'equipment.yaml'));
  ARTIFACTS = loadYAML(path.join(DATA_DIR, 'cards', 'artifacts.yaml'));
  // Dread spells are optional — present from the 2021 set
  const dreadPath = path.join(DATA_DIR, 'cards', 'dread-spells.yaml');
  DREAD_SPELLS = fs.existsSync(dreadPath) ? loadYAML(dreadPath) : {};
  for (const [id, sp] of Object.entries(DREAD_SPELLS)) sp.id = id;
  loadMasterBoard();
  const treasure = loadYAML(path.join(DATA_DIR, 'cards', 'treasure.yaml'));
  TREASURE_DECK_TEMPLATE = [];
  for (const c of (treasure.cards || [])) {
    const n = c.count || 1;
    for (let i = 0; i < n; i++) {
      // shallow clone so deck draws don't mutate the template
      TREASURE_DECK_TEMPLATE.push({ ...c, count: undefined });
    }
  }
  // Index spells by element for hero spell-hand selection
  SPELLS_BY_ELEMENT = {};
  for (const [id, sp] of Object.entries(SPELLS)) {
    sp.id = id;
    if (!SPELLS_BY_ELEMENT[sp.element]) SPELLS_BY_ELEMENT[sp.element] = [];
    SPELLS_BY_ELEMENT[sp.element].push(sp);
  }
  // Patch hero/monster IDs onto entries
  for (const [id, h] of Object.entries(HEROES)) h.id = id;
  for (const [id, m] of Object.entries(MONSTER_TYPES)) {
    m.id = id;
    // Promote bosses' base-type defaults onto missing fields
    if (m.base && MONSTER_TYPES[m.base]) {
      const b = MONSTER_TYPES[m.base];
      for (const k of ['glyph','color','move','attack','defend','body','mind','tags','name']) {
        if (m[k] == null) m[k] = b[k];
      }
    }
  }
  for (const [id, e] of Object.entries(EQUIPMENT)) e.id = id;
  for (const [id, a] of Object.entries(ARTIFACTS)) a.id = id;
  const boardInfo = MASTER_BOARD ? `board=${MASTER_BOARD.rooms.length}rooms+${MASTER_BOARD.corridorCells.length}corridor` : 'board=NONE';
  console.log(`[data] heroes=${Object.keys(HEROES).length} monsters=${Object.keys(MONSTER_TYPES).length} spells=${Object.keys(SPELLS).length} dread-spells=${Object.keys(DREAD_SPELLS).length} equipment=${Object.keys(EQUIPMENT).length} artifacts=${Object.keys(ARTIFACTS).length} treasureDeck=${TREASURE_DECK_TEMPLATE.length} ${boardInfo}`);
}

// Combat dice (`DICE_FACES`, `rollCombatDie`, `rollAttackDice`) now
// live in `game/combat.js` and are imported at the top of this file.

// ==========================================================
// QUEST LOADING
// ==========================================================
const quests = new Map();      // id -> quest
// Optional schema/footprint validator — runs at load time and just
// warns to stderr-style output. Never throws; quests still load.
let validateQuestFn = null;
try { validateQuestFn = require('./scripts/validate-quests').validateQuest; }
catch (e) { /* validator missing is fine */ }

// Canonical-pieces YAML — single source of truth for furniture
// metadata (file, altFile, naturalDir, aliases, footprint). Loaded
// at boot, hot-reloaded by /api/canonical-pieces consumers via the
// editor's PUT path (or restart on direct YAML edits).
const CANONICAL_PIECES_PATH = path.join(__dirname, 'data', 'canonical-pieces.yaml');
let CANONICAL_PIECES = { pieces: {} };
function loadCanonicalPieces() {
  try {
    if (fs.existsSync(CANONICAL_PIECES_PATH)) {
      CANONICAL_PIECES = loadYAML(CANONICAL_PIECES_PATH) || { pieces: {} };
    }
  } catch (e) {
    console.warn('[canonical-pieces] load failed:', e.message);
  }
}
loadCanonicalPieces();

function loadQuests() {
  if (!fs.existsSync(QUESTS_DIR)) return;
  // Recurse one level so data/quests/sandbox/*.json (and any other
  // subfolders the user adds later) are picked up alongside the main
  // quest book.
  const validationIssues = [];
  function loadDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { loadDir(full); continue; }
      if (!ent.name.endsWith('.json')) continue;
      try {
        const q = JSON.parse(fs.readFileSync(full, 'utf8'));
        quests.set(q.id, q);
        if (validateQuestFn) {
          const rel = path.relative(QUESTS_DIR, full).replace(/\\/g, '/');
          for (const issue of validateQuestFn(q, rel)) validationIssues.push(issue);
        }
      } catch (e) {
        console.error(`[quest] failed to load ${ent.name}:`, e.message);
      }
    }
  }
  loadDir(QUESTS_DIR);
  const main = [...quests.values()].filter(q => (q.category || 'main') !== 'sandbox').length;
  const box  = quests.size - main;
  console.log(`[quest] loaded ${quests.size} quest(s) — ${main} main, ${box} sandbox`);
  // Surface any footprint problems but never block boot.
  const warns = validationIssues.filter(i => i.level === 'WARN');
  if (warns.length) {
    console.warn(`[quest] ${warns.length} footprint warning(s):`);
    for (const i of warns) console.warn(`        ${i.file}: ${i.msg}`);
  }
}

function questList() {
  // Sort by the leading quest number in the id. Recognises both the
  // legacy `quest##-…` prefix AND the new `…-q##-…` infix used by
  // canonical-XML-derived sandboxes (e.g. sandbox-canonical-q01-…).
  // Quests with no number drop to the bottom of their category.
  function questNum(id) {
    const id0 = id || '';
    let m = /^quest(\d+)/i.exec(id0);
    if (m) return parseInt(m[1], 10);
    m = /-q(\d+)-/i.exec(id0);
    if (m) return parseInt(m[1], 10);
    return Number.MAX_SAFE_INTEGER;
  }
  return [...quests.values()]
    .map(q => ({
      id: q.id, title: q.title, subtitle: q.subtitle || '', intro: q.intro || '',
      category: q.category || 'main',
      usesDefaultBoard: !!MASTER_BOARD &&
        (q.board === 'default' || (!q.rooms && !q.corridors)),
      _n: questNum(q.id),
    }))
    .sort((a, b) => {
      // Sandboxes after main quests, then numeric within each group.
      const ord = c => (c === 'sandbox' ? 1 : 0);
      const da = ord(a.category), db = ord(b.category);
      if (da !== db) return da - db;
      return a._n - b._n;
    })
    .map(({ _n, ...rest }) => rest);
}

// ==========================================================
// UTILITIES
// ==========================================================
// Pure helpers (`uid`, `pid`, `code`, `rollD6`, `bresenham`,
// `shuffle`) live in `game/util.js`. Combat dice live in
// `game/combat.js`. Both are imported at the top of this file.
//
// Shared geometry + adjacency + wall/door rules are kept in
// public/shared/rules.js so the server and both browser apps cannot
// drift. Local re-exports below preserve the existing call sites.
const HQRules = require('./public/shared/rules.js');
const { key, edgeKey, adjacent, adjacentDiag, chebyshev } = HQRules;

// ==========================================================
// ROOMS
// ==========================================================
const rooms = new Map(); // code -> Room

function newRoomCode() {
  let c;
  do { c = code(); } while (rooms.has(c));
  return c;
}

function makeRoom(hostToken) {
  const c = newRoomCode();
  const now = Date.now();
  const room = {
    code: c,
    hostToken,
    createdAt: now,
    lastActivityAt: now,
    players: [],         // { token, name, connected, isBot }
    sockets: new Map(),  // token -> ws
    phase: 'lobby',
    config: {
      questId: questList()[0]?.id || null,
      gmMode: 'ai',                 // 'ai' | 'human'
      autoRollMovement: true,       // auto-roll 2d6 at start of each hero turn
      revealAll: false,             // debug: disable fog of war (heroes see whole map)
      aiSpeed: 1,                   // visual pacing for AI ticks: 1 | 2 | 3 | 4
    },
    seats: {                        // who controls what
      barbarian: null, dwarf: null, elf: null, wizard: null,
      gm: null,                     // null in AI mode; player token in human mode
    },
    // Hero spell-element draft (per the 2021 rules). The wizard picks one
    // of the four element groups, then the elf picks one of the remaining
    // three, then the wizard auto-takes the other two. Empty arrays =
    // not yet drafted; the YAML defaults kick in if the game starts
    // without a finished draft.
    spellPick: { wizardElements: [], elfElements: [] },
    // Player-chosen art variant per hero seat (Male / Female printed
    // tokens + cards). Defaults to 'male' on claim; resets to 'male'
    // when the seat is released.
    heroVariants: { barbarian: 'male', dwarf: 'male', elf: 'male', wizard: 'male' },
    state: null,
  };
  rooms.set(c, room);
  return room;
}

// ==========================================================
// PERSISTENCE
// ==========================================================
let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; saveState(); }, SAVE_DEBOUNCE_MS);
}
function saveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const rooms_arr = [];
    for (const room of rooms.values()) {
      if (room.phase === 'end') continue;
      rooms_arr.push({
        code: room.code, hostToken: room.hostToken,
        createdAt: room.createdAt, lastActivityAt: room.lastActivityAt,
        phase: room.phase, config: room.config, seats: room.seats,
        players: room.players.map(p => ({ ...p, connected: false })),
        state: room.state,
      });
    }
    const payload = { version: STATE_VERSION, rooms: rooms_arr };
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('[persist] save failed:', e.message);
  }
}
function loadRooms() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Accept both legacy plain-array snapshots and versioned payloads.
    // Drop the file if the version doesn't match the current code path.
    let arr;
    if (Array.isArray(raw)) {
      console.log('[persist] discarding pre-versioned snapshot');
      try { fs.unlinkSync(STATE_FILE); } catch {}
      return;
    } else {
      if (raw.version !== STATE_VERSION) {
        console.log(`[persist] discarding snapshot v${raw.version} (current v${STATE_VERSION})`);
        try { fs.unlinkSync(STATE_FILE); } catch {}
        return;
      }
      arr = raw.rooms || [];
    }
    for (const r of arr) {
      const room = {
        code: r.code, hostToken: r.hostToken,
        createdAt: r.createdAt, lastActivityAt: r.lastActivityAt,
        phase: r.phase, config: r.config, seats: r.seats,
        players: (r.players || []).map(p => ({ ...p, pid: p.pid || pid(), connected: false })),
        sockets: new Map(),
        state: r.state,
      };
      // Drop any half-finished AI turn cursor — it referenced a setTimeout
      // handle from the previous process, and the monster id may be dead.
      if (room.state) {
        delete room.state._aiPlan;
        delete room.state._aiCurrent;
      }
      rooms.set(room.code, room);
      // If we restored a room mid-GM-turn under AI, kick the scheduler
      // ourselves — without a broadcast nothing else will.
      if (room.phase === 'play' && room.state && room.config?.gmMode === 'ai') {
        const cur = room.state.turnOrder?.[room.state.turnIdx];
        if (cur && cur.kind === 'gm') scheduleAITick(room);
      }
    }
    if (arr.length) console.log(`[persist] restored ${arr.length} room(s)`);
  } catch (e) {
    console.error('[persist] load failed:', e.message);
  }
}

// ==========================================================
// MESSAGING / VIEW FILTERING
// ==========================================================
function send(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastRoom(room) {
  room.lastActivityAt = Date.now();
  for (const p of room.players) {
    const ws = room.sockets.get(p.token);
    if (!ws) continue;
    send(ws, 'state', { state: viewFor(room, p.token) });
  }
  scheduleAITick(room);
  scheduleSave();
}

function logEvent(room, text, cls = '') {
  if (!room.state) return;
  room.state.log.push({ text, cls, ts: Date.now() });
  if (room.state.log.length > 200) room.state.log.shift();
}

// What seats does this player control?
function seatsOf(room, token) {
  const out = { heroIds: [], isGM: false };
  for (const id of ['barbarian','dwarf','elf','wizard']) {
    if (room.seats[id] === token) out.heroIds.push(id);
  }
  if (room.seats.gm === token) out.isGM = true;
  return out;
}

function isMyTurn(room, token) {
  if (!room.state || room.phase !== 'play') return false;
  const cur = currentTurn(room);
  if (!cur) return false;
  if (cur.kind === 'hero') return room.seats[cur.heroId] === token;
  if (cur.kind === 'gm')   return room.config.gmMode === 'human' && room.seats.gm === token;
  return false;
}

// `viewFor` body now lives in `game/view.js`. This is a thin wrapper
// that supplies the deps fresh on every call so YAML hot-reloads
// (`loadGameData()`) stay live.
function viewFor(room, token) {
  return _viewFor(room, token, {
    HEROES, MONSTER_TYPES, SPELLS, SPELLS_BY_ELEMENT, SPELL_ELEMENTS,
    seatsOf, currentTurn, isMyTurn,
    effectiveAttack, effectiveDefend,
    spellDraftStatus, questList,
  });
}

// ==========================================================
// QUEST → BOARD STATE
// ==========================================================
// `buildBoardState`, `buildHeroes`, `buildMonsters`, `buildTreasure`,
// `buildTraps`, `buildFurnitureTraps`, `buildSecretDoors`, and the
// orchestrator `freshGameState` all live in `game/quest-builder.js`.
// The thin wrapper below is the only external call site (it threads
// the YAML data tables + the master board + `quests` + the
// fog-reveal flood-fill in).
function freshGameState(room) {
  return _freshGameState(room, {
    MASTER_BOARD, HEROES, MONSTER_TYPES, SPELLS, SPELLS_BY_ELEMENT,
    TREASURE_DECK_TEMPLATE, quests, exploreFromHero,
  });
}


// ==========================================================
// TURN HELPERS
// ==========================================================
function currentTurn(room) {
  const s = room.state;
  if (!s) return null;
  return s.turnOrder[s.turnIdx];
}
function currentHero(room) {
  const s = room.state;
  const cur = currentTurn(room);
  if (!cur || cur.kind !== 'hero') return null;
  return s.heroes.find(h => h.id === cur.heroId);
}

function advanceTurn(room) {
  const s = room.state;
  // End-of-turn cleanup for the OUTGOING actor. Single-move spell
  // statuses (passWalls / passOccupants) consume here only if the
  // hero actually used some movement this turn — otherwise the spell
  // sits patiently until they get to take their move.
  const outgoing = s.turnOrder[s.turnIdx];
  if (outgoing && outgoing.kind === 'hero' && s.movementUsed > 0) {
    const oh = s.heroes.find(x => x.id === outgoing.heroId);
    if (oh && oh.status) {
      if (oh.status.passWalls)     oh.status.passWalls = false;
      if (oh.status.passOccupants) oh.status.passOccupants = false;
    }
  }
  // Skip dead heroes / GM-with-no-active-monsters etc.
  for (let tries = 0; tries < s.turnOrder.length + 1; tries++) {
    s.turnIdx = (s.turnIdx + 1) % s.turnOrder.length;
    const cur = s.turnOrder[s.turnIdx];
    if (cur.kind === 'hero') {
      const h = s.heroes.find(x => x.id === cur.heroId);
      if (h && !h.dead) break;
    } else {
      // GM turn: skip if no active monsters at all
      if (s.monsters.some(m => !m.dead && m.active)) break;
      // No active monsters — skip GM
      continue;
    }
  }
  s.movementRoll = null;
  s.movementUsed = 0;
  s.actionUsed = false;
  s.movementLocked = false;
  s.combat = null;
  // If it's a hero turn, auto-roll could be done — but let player click "Roll" themselves
  // If GM turn and AI mode, the AI tick will handle it
}

// ==========================================================
// MOVEMENT / WALL DERIVATION
// ==========================================================
// `tileAt`, `occupantAt`, `isMonsterVisibleToHeroes`,
// `losEdgeBlocked`, `lineOfSight`, `isMultiShareCell` all live in
// `game/los.js` and are imported at the top of this file.

// Wall / door / melee predicates come from public/shared/rules.js so the
// browser previews use the exact same rules as the server enforces.
const { doorBetween, wallBetween, meleeBlocked } = HQRules;

function passable(s, fromCell, toCell, mover) {
  // mover: { kind:'hero'|'monster', id }
  const ta = tileAt(s, fromCell[0], fromCell[1]);
  const tb = tileAt(s, toCell[0], toCell[1]);
  if (!ta || !tb) return false;
  if (!adjacent(fromCell, toCell)) return false;

  // Permanently blocked cell (e.g. where a falling-block trap fired)
  if (tb.blocked) return false;

  // Movement-modifying spells: look up the hero so we can honour
  // passWalls (Pass Through Rock) and passOccupants (Veil of Mist).
  // These flags are set by the spell resolver and cleared at the end
  // of the recipient's next move (advanceTurn).
  const moverHero = (mover && mover.kind === 'hero')
    ? s.heroes.find(x => x.id === mover.id)
    : null;
  const ignoreWalls     = !!(moverHero && moverHero.status && moverHero.status.passWalls);
  const ignoreOccupants = !!(moverHero && moverHero.status && moverHero.status.passOccupants);

  // Wall blocks? (Pass Through Rock skips this check.)
  const door = doorBetween(s, fromCell, toCell);
  const wall = (ta.roomId !== tb.roomId) && !door;
  if (wall && !ignoreWalls) return false;

  // Closed door blocks until opened (heroes auto-open on attempted move).
  // Even with passWalls active, a door is still a door — opens normally
  // rather than getting bypassed.
  if (door && door.state !== 'open') return { needsOpenDoor: door };

  // Furniture blocks (no spell currently lets heroes phase through it)
  if (tb.furnitureId) return false;

  // Occupant blocks (heroes pass through allies — same hero kind — but
  // not enemies, unless Veil of Mist's passOccupants is active).
  const occupant = occupantAt(s, toCell);
  if (occupant) {
    if (mover.kind === 'hero' && (occupant.kind === 'hero' || ignoreOccupants)) {
      // 2021 rule: heroes may not END on the same square as another
      // creature EXCEPT when on stairs or in a sprung pit. We can't
      // tell from here whether this is a pass-through or a stop, so
      // we return `true` (allow movement). Final-cell occupancy is
      // enforced in `findPath()` via its own check.
      return true;
    }
    return false;
  }
  return true;
}

// `isMultiShareCell` + `occupantAt` are imported from `game/los.js`
// at the top of this file.

// Visibility / fog-of-war engine lives in game/fog.js. The wrappers
// below adapt the server's room+log convention to the pure-state API.
const fog = require('./game/fog.js');
function revealRoom(room, roomId, _by) {
  if (!room.state) return;
  fog.revealRoomById(room.state, roomId, (text, cls) => logEvent(room, text, cls));
}

// Flood-fill visibility from a hero's current cell. Reveals every cell
// reachable through OPEN paths (same room, same corridor segment, or
// through an open door). Closed doors and walls block the flood.
// Activates monsters in any newly-revealed room (the GM "wakes" them).
// Canonical 2021 fog-of-war rule:
//  - When a hero enters a ROOM, the WHOLE room is revealed at once.
//  - When a hero is in a CORRIDOR, only cells in their CARDINAL LINE
//    OF SIGHT are revealed — blocked by solid rock, walls, and closed
//    doors.
//  - Opening a door reveals the ROOM behind it (cascades through
//    chained open doors).
//
// The previous implementation flood-filled through every adjacent
// corridor pair which leaked the entire corridor network the moment
// a hero stepped onto any corridor cell.
function exploreFromHero(room, hero) {
  if (!room.state) return;
  fog.recomputeFromHero(room.state, hero, (text, cls) => logEvent(room, text, cls));
}

// Recompute visibility from all living heroes — used after door opens, etc.
function exploreFromAllHeroes(room) {
  if (!room.state) return;
  fog.recomputeFromAllHeroes(room.state, (text, cls) => logEvent(room, text, cls));
}

function openDoor(room, door, by) {
  if (door.state === 'open') return;
  door.state = 'open';
  door.revealed = true;
  logEvent(room, `Door opened.`);
  // Re-explore from every living hero so newly-connected cells become visible
  exploreFromAllHeroes(room);
}

// 2021 rule: opening an adjacent door is FREE — no movement cost, no
// action consumed. Hero must be standing on one of the two cells the
// door bridges, and the door must already be visible (revealed) and
// closed. Reveals what's beyond via the existing flood-fill.
function handleOpenDoor(room, token, a, b) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (!cur || cur.kind !== 'hero') return;
  const h = currentHero(room);
  if (!h || !a || !b) return;
  const door = s.doors.find(d =>
    (d.a[0] === a[0] && d.a[1] === a[1] && d.b[0] === b[0] && d.b[1] === b[1]) ||
    (d.a[0] === b[0] && d.a[1] === b[1] && d.b[0] === a[0] && d.b[1] === a[1])
  );
  if (!door) return;
  if (door.state !== 'closed') return;
  if (!door.revealed) return;
  const onA = h.at[0] === door.a[0] && h.at[1] === door.a[1];
  const onB = h.at[0] === door.b[0] && h.at[1] === door.b[1];
  if (!onA && !onB) return;
  openDoor(room, door, h);
  broadcastRoom(room);
}

// ==========================================================
// TURN ACTIONS — heroes
// ==========================================================
function rollHeroMovement(room, h) {
  // Server-side roll, no token check. Used both for explicit roll action and auto-roll.
  const s = room.state;
  if (s.movementRoll != null) return false;
  let dice = effectiveMoveDice(h);
  let multiplier = 1;
  if (h.status.doubleNextMovement) { multiplier = 2; h.status.doubleNextMovement = false; }
  const rolls = [];
  for (let i = 0; i < dice * multiplier; i++) rolls.push(rollD6());
  s.movementRoll = rolls.reduce((a, b) => a + b, 0);
  s.movementUsed = 0;
  s.movementDice = rolls;
  logEvent(room, `${h.name} rolls movement: ${rolls.join('+')}=${s.movementRoll}`);
  return true;
}

function handleRollMovement(room, token) {
  if (!isMyTurn(room, token)) return;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  const h = currentHero(room);
  if (!h) return;
  if (rollHeroMovement(room, h)) broadcastRoom(room);
}

// Per the 2021 rulebook: a hero may move-then-act or act-then-move, but
// not split movement around an action. Call this from every action
// handler — it locks further movement IFF the hero has already moved.
function lockMovementOnAction(s) {
  if (s.movementUsed > 0) s.movementLocked = true;
}

function handleMove(room, token, target) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  if (s.movementRoll == null) return;
  if (s.movementUsed >= s.movementRoll) return;
  if (s.movementLocked) return;          // already acted after moving — split forbidden
  const h = currentHero(room);
  if (!h) return;

  const next = passable(s, h.at, target, { kind: 'hero', id: h.id });
  if (!next) return;
  if (next.needsOpenDoor) {
    openDoor(room, next.needsOpenDoor, h);
  }
  // Climbing out of a pit clears the in-pit penalty (the pit tile stays).
  if (h.status.inPit) {
    const here = tileAt(s, h.at[0], h.at[1]);
    const movingOut = (target[0] !== h.at[0] || target[1] !== h.at[1]);
    if (movingOut) h.status.inPit = false;
  }
  h.at = [...target];
  s.movementUsed++;
  exploreFromHero(room, h);
  triggerTrapsForCell(room, h, target);
  broadcastRoom(room);
}

// 2021 attack rules:
//   - default range = orthogonally-adjacent
//   - weapons with `diagonal: true` (staff, longsword, shortsword, spear)
//     also allow Chebyshev-1 (king-style) attacks
//   - ranged weapons (crossbow) require LOS, up to a max range
//   - thrown weapons (hand-axe, spear, dagger) at non-adjacent range
//     are LOST after the attack — `equipment.throwable: true`
function handleAttack(room, token, targetMonsterId) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  if (s.actionUsed) return;
  const h = currentHero(room);
  if (!h) return;
  const m = s.monsters.find(x => x.id === targetMonsterId);
  if (!m || m.dead) return;

  const eq = h.equipped.weapon ? EQUIPMENT[h.equipped.weapon] : null;
  const isAdjOrtho = adjacent(h.at, m.at);
  const isAdjDiag  = adjacentDiag(h.at, m.at);
  const dist = chebyshev(h.at, m.at);
  let willThrow = false;

  if (eq && eq.ranged) {
    // Crossbow: not adjacent, requires LOS, max 12 squares.
    if (eq.noAdjacent && isAdjOrtho) {
      logEvent(room, `${h.name} cannot use the Crossbow at point-blank range.`);
      return;
    }
    if (dist > (eq.maxRange || 12)) return;
    if (!lineOfSight(s, h.at, m.at)) return;
  } else if (eq && eq.throwable && !isAdjOrtho) {
    // Hand-axe / spear / dagger thrown attack — needs LOS + max range (6).
    if (dist > (eq.maxRange || 6)) return;
    if (!lineOfSight(s, h.at, m.at)) return;
    willThrow = true;
  } else if (eq && eq.diagonal && isAdjDiag) {
    // Diagonal attack with staff / longsword / shortsword / spear.
  } else if (!isAdjOrtho) {
    return;
  } else if (isAdjOrtho && meleeBlocked(s, h.at, m.at)) {
    // Wall or closed door between attacker and target — no melee.
    return;
  }

  resolveAttack(room, { kind: 'hero', ref: h }, { kind: 'monster', ref: m });
  h.status.bonusAttackOnce = 0;
  if (willThrow) {
    // Thrown weapon is lost — clear the slot.
    logEvent(room, `${h.name} hurls their ${eq.name} — lost in the throw.`);
    h.equipped.weapon = null;
  }
  if (h.status.doubleAttacksOneTurn) {
    h.status.doubleAttacksOneTurn = false;
    h._bonusAttackPending = true;
  }
  if (!h._bonusAttackPending) {
    s.actionUsed = true;
    lockMovementOnAction(s);
  } else {
    h._bonusAttackPending = false;
  }
  broadcastRoom(room);
}

function handleSearchTreasure(room, token) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  if (s.actionUsed) return;
  const h = currentHero(room);
  if (!h) return;
  const tile = tileAt(s, h.at[0], h.at[1]);
  if (!tile || tile.kind !== 'room') return;
  // Cannot search if monsters still in this room
  if (s.monsters.some(m => !m.dead && m.roomId === tile.roomId)) {
    logEvent(room, `${h.name} cannot search — monsters still in the room.`);
    s.actionUsed = true;
    lockMovementOnAction(s);
    broadcastRoom(room);
    return;
  }
  // 2021 rule: each hero may only search a given room ONCE for treasure.
  if (!s.searchedTreasure) s.searchedTreasure = {};
  if (!s.searchedTreasure[h.id]) s.searchedTreasure[h.id] = {};
  if (s.searchedTreasure[h.id][tile.roomId]) {
    logEvent(room, `${h.name} has already searched this room.`);
    return;
  }
  s.searchedTreasure[h.id][tile.roomId] = true;
  // Chest/furniture traps fire if the hero searches before disarming them.
  // Engine support is on the chest cell (or any furniture cell) of the same
  // room — fire any unsprung furniture traps on the searcher.
  let trapFired = false;
  for (const ft of (s.furnitureTraps || [])) {
    if (ft.disarmed || ft.triggered) continue;
    const ftt = tileAt(s, ft.at[0], ft.at[1]);
    if (!ftt || ftt.roomId !== tile.roomId) continue;
    ft.triggered = true; ft.revealed = true;
    const dmg = ft.damage || 1;
    h.body = Math.max(0, h.body - dmg);
    logEvent(room, `${h.name} springs the ${ft.kind || 'chest'} trap! -${dmg} Body.`, 'death');
    trapFired = true;
    checkEndConditions(room);
    if (h.dead) break;
  }
  if (trapFired) {
    // Chest is now sprung — search ends without yielding treasure.
    s.actionUsed = true;
    lockMovementOnAction(s);
    broadcastRoom(room);
    return;
  }
  // Quest-placed fixed treasure on this exact cell (legacy quest format)
  const t = s.treasure.find(t => !t.taken && t.at[0] === h.at[0] && t.at[1] === h.at[1]);
  if (t) {
    t.taken = true;
    if (t.kind === 'gold') {
      h.gold += t.amount;
      logEvent(room, `${h.name} finds ${t.amount} gold (placed treasure).`, 'treasure');
    } else if (t.kind === 'potion') {
      h.inventory.push({ id: `potion-${t.potion}`, name: `Potion of ${t.potion}`, use: 'heal', amount: 4 });
      logEvent(room, `${h.name} finds a ${t.potion} potion.`, 'treasure');
    }
    s.actionUsed = true;
    lockMovementOnAction(s);
    broadcastRoom(room);
    return;
  }
  // Draw from the room's treasure deck
  const card = drawTreasureCard(room, h);
  if (!card) {
    logEvent(room, `${h.name} searches but the treasure pile is exhausted.`);
  }
  s.actionUsed = true;
  lockMovementOnAction(s);
  broadcastRoom(room);
}

function handleEndTurn(room, token) {
  if (!isMyTurn(room, token)) return;
  advanceTurn(room);
  startOfTurn(room);
  if (currentTurn(room) && currentTurn(room).kind === 'hero') {
    const h = currentHero(room);
    logEvent(room, `${h.name}'s turn.`);
  } else if (currentTurn(room) && currentTurn(room).kind === 'gm') {
    logEvent(room, `Evil Wizard's turn.`);
  }
  broadcastRoom(room);
}

// ==========================================================
// COMBAT — body in game/combat.js. Thin wrapper injects the YAML
// tables + logEvent + checkEndConditions.
// ==========================================================
function resolveAttack(room, attacker, defender) {
  return _combat.resolveAttack(room, attacker, defender, {
    EQUIPMENT, ARTIFACTS, MONSTER_TYPES, logEvent, checkEndConditions,
  });
}

// ==========================================================
// OBJECTIVES — derive a checklist of [{id,text,done,optional,locked}]
// from the quest's objective(s). Used both by the live UI panel AND
// (for array-form quests) by checkEndConditions to flip objectiveMet.
//
// Quest JSON may declare either:
//   • single  `objective`  : { kind, text, ... }            (existing)
//   • or rich `objectives` : [{ id, kind, text, ... }, ...] (new)
// In either case a synthesized "Return to a staircase" row is always
// appended — it's locked until all required earlier rows are done,
// then completes when a living hero stands on a stair cell.
// ==========================================================
// `_evalObjectiveOne`, `evaluateObjectives`, and `requiredObjectivesMet`
// now live in `game/objectives.js` and are imported at the top of
// this file. `checkEndConditions` (below) keeps the state-mutating
// promotion to `winner` and the between-quest hero restoration.

// 2021 rule: a quest is complete only when its objective has been met
// AND at least one living hero stands on a stairway tile. We track
// `objectiveMet` independently from `winner` and check both each tick.
function checkEndConditions(room) {
  const s = room.state;
  if (s.winner) return true;
  // Defeat — all heroes dead
  if (s.heroes.every(h => h.dead)) {
    s.winner = 'evil';
    s.winReason = s.defeat?.text || 'All heroes have fallen.';
    room.phase = 'end';
    logEvent(room, `DEFEAT: ${s.winReason}`, 'defeat');
    return true;
  }
  // Update objectiveMet — supports rich `objectives` array OR singleton
  // `objective`. Reuses requiredObjectivesMet from game/objectives.js
  // so the flip is in lockstep with what the live UI panel shows.
  if (!s.objectiveMet && requiredObjectivesMet(s)) {
    const arr = (Array.isArray(s.objectives) && s.objectives.length) ? s.objectives : null;
    const textForLog = arr
      ? (arr.filter(o => !o.optional).map(o => o.text).filter(Boolean).join('; ') || 'goal complete.')
      : ((s.objective && s.objective.text) || 'goal complete.');
    s.objectiveMet = true;
    logEvent(room, `Objective achieved: ${textForLog} Now return to the staircase to finish the quest.`, 'reveal');
  }
  const obj = s.objective;
  // Victory — objective met AND every living hero on a stair cell.
  // Per F2847 p.21: "you successfully complete a quest only when you
  // have achieved the quest goal and have returned to the safety of
  // the stairway." Each surviving hero must individually return.
  if (s.objectiveMet) {
    const stairCells = (s.stairCells && s.stairCells.length) ? s.stairCells : (s._startCells || []);
    const livingHeroes = s.heroes.filter(h => !h.dead);
    const allOnStair = livingHeroes.length > 0 && stairCells.length > 0
      && livingHeroes.every(h => stairCells.some(c => c[0] === h.at[0] && c[1] === h.at[1]));
    if (allOnStair) {
      s.winner = 'heroes';
      s.winReason = (obj && obj.text) || 'Quest complete — heroes return to safety.';
      room.phase = 'end';
      // Between-quest restoration: full Body/Mind heal, all spells back
      for (const h of s.heroes) {
        if (h.dead) continue;
        h.body = h.bodyMax;
        h.mind = h.mindMax;
        // Refill the spell hand from the elements the hero originally
        // drafted (stored on the hero at quest start), not the YAML
        // default — otherwise a wizard who drafted Air+Earth+Water
        // would get reset back to Fire+Water+Air after the quest.
        const proto = HEROES[h.id];
        const elements = (Array.isArray(h.spellElements) && h.spellElements.length)
          ? h.spellElements
          : ((proto.spells && proto.spells.default) || []);
        const fresh = [];
        for (const el of elements) for (const sp of (SPELLS_BY_ELEMENT[el] || [])) fresh.push(sp.id);
        h.spellHand = fresh;
        h.status = {
          skipNextTurn: false, doubleNextMovement: false, passWalls: false,
          passOccupants: false, rockSkin: false, courage: false,
          bonusDefendOnce: 0, bonusAttackOnce: 0, sleeping: false,
          doubleAttacksOneTurn: false, inPit: false,
        };
      }
      logEvent(room, `VICTORY: ${s.winReason}`, 'victory');
      logEvent(room, `Body & Mind Points restored. Spells refreshed for the next quest.`, 'treasure');
      return true;
    }
  }
  return false;
}

// ==========================================================
// EFFECTIVE COMBAT DICE — body in game/combat.js. Thin wrappers
// inject the YAML EQUIPMENT + ARTIFACTS tables.
// ==========================================================
function effectiveAttack(hero, target) {
  return _combat.effectiveAttack(hero, target, { EQUIPMENT, ARTIFACTS });
}
function effectiveDefend(hero) {
  return _combat.effectiveDefend(hero, { EQUIPMENT, ARTIFACTS });
}
function effectiveMoveDice(hero) {
  return _combat.effectiveMoveDice(hero, { EQUIPMENT });
}

// ==========================================================
// SPELLS
// ==========================================================
function handleCastSpell(room, token, spellId, target) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  const h = currentHero(room);
  if (!h) return;
  if (s.actionUsed) return;

  // Spell hand check
  const idx = h.spellHand.indexOf(spellId);
  if (idx === -1) return;
  const spell = SPELLS[spellId];
  if (!spell) return;

  // Spells per turn — Wand of Recall lets you cast 2
  const wand = h.equipped.artifactItem ? ARTIFACTS[h.equipped.artifactItem] : null;
  const maxSpells = (wand && wand.spellsPerTurn) || 1;
  if (s.spellsCastThisTurn >= maxSpells) return;

  // Resolve effect
  const ok = applySpellEffect(room, h, spell, target);
  if (!ok) return;

  // Consume the spell card and the action (unless wand grants extra)
  h.spellHand.splice(idx, 1);
  s.spellsCastThisTurn++;
  if (s.spellsCastThisTurn >= maxSpells) {
    s.actionUsed = true;
    lockMovementOnAction(s);
  }
  logEvent(room, `${h.name} casts ${spell.name}.`, 'spell');
  broadcastRoom(room);
}

// `applySpellEffect` + `resolveTarget` bodies live in `game/spells.js`.
// `handleCastSpell` (above) keeps the WebSocket plumbing — hand
// check, Wand of Recall counter, lockMovementOnAction, broadcast.
function applySpellEffect(room, caster, spell, target) {
  return _spells.applySpellEffect(room, caster, spell, target, {
    logEvent, checkEndConditions,
  });
}
const resolveTarget = _spells.resolveTarget;

// ==========================================================
// TREASURE DECK — body in game/treasure-deck.js. Thin wrappers
// inject logEvent + MONSTER_TYPES + resolveAttack + checkEndConditions.
// ==========================================================
function drawTreasureCard(room, hero) {
  return _td.drawTreasureCard(room, hero, {
    logEvent, MONSTER_TYPES, resolveAttack, checkEndConditions,
  });
}
function applyTreasureCard(room, hero, card) {
  return _td.applyTreasureCard(room, hero, card, {
    logEvent, MONSTER_TYPES, resolveAttack, checkEndConditions,
  });
}
const adjacentFreeCells = _td.adjacentFreeCells;

// ==========================================================
// USE INVENTORY ITEM
// ==========================================================
function handleUseItem(room, token, itemIndex) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  const h = currentHero(room);
  if (!h) return;
  const item = h.inventory[itemIndex];
  if (!item) return;

  switch (item.use) {
    case 'heal':
      const heal = Math.min(item.amount || 4, h.bodyMax - h.body);
      h.body += heal;
      logEvent(room, `${h.name} drinks ${item.name}: +${heal} Body.`, 'treasure');
      break;
    case 'bonusAttackOnce':
      h.status.bonusAttackOnce = (item.bonus || 2);
      logEvent(room, `${h.name} drinks ${item.name}: next attack +${item.bonus} dice.`, 'treasure');
      break;
    case 'bonusDefendOnce':
      h.status.bonusDefendOnce = (item.bonus || 2);
      logEvent(room, `${h.name} drinks ${item.name}: next defence +${item.bonus} dice.`, 'treasure');
      break;
    case 'doubleNextMovement':
      h.status.doubleNextMovement = true;
      logEvent(room, `${h.name} drinks ${item.name}: next movement doubled.`, 'treasure');
      break;
    case 'doubleAttacksOneTurn':
      h.status.doubleAttacksOneTurn = true;
      logEvent(room, `${h.name} drinks ${item.name}: 2 attacks this turn.`, 'treasure');
      break;
    case 'smiteUndead':
      // Use against an adjacent undead automatically slays it
      // Not yet wired with a target picker — placeholder for future
      logEvent(room, `${h.name} readies the Holy Water (use on next attack vs undead).`);
      h.status.holyWaterReady = true;
      break;
  }
  h.inventory.splice(itemIndex, 1);
  broadcastRoom(room);
}

// ==========================================================
// EQUIPMENT SHOP — between quests
// ==========================================================
function handleBuyEquipment(room, token, equipmentId) {
  if (room.phase !== 'shop') return;
  const s = room.state;
  if (!s) return;
  const h = s.heroes.find(x => room.seats[x.id] === token);
  if (!h) return;
  const eq = EQUIPMENT[equipmentId];
  if (!eq) return;
  if (eq.notWizard && h.id === 'wizard') return;
  if (eq.wizardOnly && h.id !== 'wizard') return;
  if (h.gold < eq.cost) return;
  // Slot conflicts: replace existing item in same slot (refund half? no, keep simple — they discard old)
  h.gold -= eq.cost;
  if (h.equipped[eq.slot]) {
    // Drop old to inventory? For simplicity just lose it.
    logEvent(room, `${h.name} replaces ${EQUIPMENT[h.equipped[eq.slot]].name}.`);
  }
  h.equipped[eq.slot] = equipmentId;
  logEvent(room, `${h.name} buys ${eq.name} for ${eq.cost}g.`, 'treasure');
  broadcastRoom(room);
}

function handleEndShop(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return;
  if (room.phase !== 'shop') return;
  room.phase = 'lobby';
  // Heroes' state is preserved (gold + equipped + spellHand reset is per-quest at startGame time)
  broadcastRoom(room);
}

// ==========================================================
// TRAPS — body in game/traps.js. Thin wrapper injects logEvent +
// checkEndConditions.
// ==========================================================
function triggerTrapsForCell(room, hero, cell) {
  return _triggerTrapsForCell(room, hero, cell, {
    logEvent, checkEndConditions,
  });
}

// =============================================================
// PATHFINDING — BFS now lives in `game/pathfinding.js`. The local
// `findPath` wrapper above injects this file's `passable` predicate.
// =============================================================

// Click-to-walk: server pathfinds, then walks the path one cell at a
// time. Halts mid-walk if a trap fires, the hero falls, or a monster
// comes into adjacency (e.g., a newly-revealed room wakes one up).
function handleMoveTo(room, token, target) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  if (s.movementRoll == null) return;
  if (s.movementLocked) return;
  const h = currentHero(room);
  if (!h) return;
  const remaining = s.movementRoll - s.movementUsed;
  if (remaining <= 0) return;

  const path = findPath(s, h, target, remaining);
  if (!path || path.length < 2) return;
  console.log(`[move] ${room.code} ${h.name} roll=${s.movementRoll} used=${s.movementUsed} from (${h.at.join(',')}) → click (${target[0]},${target[1]}) path=${path.length - 1}`);

  let stopReason = null;
  for (let i = 1; i < path.length; i++) {
    const next = path[i];
    const result = passable(s, h.at, next, { kind: 'hero', id: h.id });
    if (!result) { stopReason = 'blocked'; break; }
    if (result.needsOpenDoor) {
      openDoor(room, result.needsOpenDoor, h);
      console.log(`[move] ${room.code} ${h.name} opens door at (${result.needsOpenDoor.a.join(',')})-(${result.needsOpenDoor.b.join(',')})`);
    }

    // Snapshot what the heroes already see — used to detect a fresh
    // reveal triggered by this step (canonical 2021 rule: movement ends
    // when a new room is entered or a previously-unseen monster comes
    // into line of sight, so the player can react).
    const beforeRooms = new Set();
    for (const rid in s.roomState) {
      if (!s.roomState[rid].hiddenFor.heroes) beforeRooms.add(rid);
    }
    const beforeMonsters = new Set();
    for (const m of s.monsters) {
      if (!m.dead && isMonsterVisibleToHeroes(s, m)) beforeMonsters.add(m.id);
    }

    const fromCell = [...h.at];
    h.at = [...next];
    s.movementUsed++;
    exploreFromHero(room, h);
    console.log(`[move] ${room.code} ${h.name} step ${s.movementUsed}/${s.movementRoll} (${fromCell.join(',')})→(${next.join(',')})`);
    const trap = triggerTrapsForCell(room, h, next);
    if (h.dead) { stopReason = 'died'; break; }
    if (trap.endsTurn) {
      // Spear-trap skull: "This ends your turn." Drain remaining movement
      // and lock action so no further play happens this turn.
      s.movementUsed = s.movementRoll;
      s.actionUsed = true;
      lockMovementOnAction(s);
      stopReason = 'trap-ends-turn';
      break;
    }
    if (trap.halt) { stopReason = 'trap'; break; }
    // (spear-dodged: trap.fired but trap.halt is false — keep walking)
    // Halt if a monster has become adjacent during this walk
    const adjFoe = s.monsters.find(m => !m.dead && m.active && adjacent(h.at, m.at));
    if (adjFoe) { stopReason = `monster-adjacent (${adjFoe.type})`; break; }

    // Reveal-stop: did this step show the hero something new?
    let revealedRoomName = null;
    for (const rid in s.roomState) {
      if (!s.roomState[rid].hiddenFor.heroes && !beforeRooms.has(rid)) {
        revealedRoomName = s.roomState[rid].name || rid;
        break;
      }
    }
    let newMonster = null;
    if (!revealedRoomName) {
      for (const m of s.monsters) {
        if (m.dead || beforeMonsters.has(m.id)) continue;
        if (isMonsterVisibleToHeroes(s, m)) { newMonster = m; break; }
      }
    }
    if (revealedRoomName || newMonster) {
      const what = revealedRoomName
        ? `enters ${revealedRoomName}`
        : `spots a ${MONSTER_TYPES[newMonster.type]?.name || newMonster.type}`;
      logEvent(room, `${h.name} ${what} — pauses to take stock.`, 'reveal');
      stopReason = revealedRoomName ? `room-reveal (${revealedRoomName})` : `monster-reveal (${newMonster.type})`;
      break;
    }

    // Intersection-stop: when walking down a corridor, halt as soon as
    // we step onto a cell with more than one visible forward option.
    // The player gets to re-evaluate (does the side branch lead anywhere
    // good?) before committing further movement. Doesn't apply inside
    // rooms — entering a room already triggers the reveal-stop above.
    const tNext = tileAt(s, next[0], next[1]);
    if (tNext && !tNext.roomId) {
      const prev = path[i - 1];
      const branches = countVisibleBranches(s, next, prev);
      if (branches >= 2) {
        logEvent(room, `${h.name} pauses at the intersection.`, 'reveal');
        stopReason = `intersection (${branches} branches)`;
        break;
      }
    }
  }
  console.log(`[move] ${room.code} ${h.name} done — at (${h.at.join(',')}) used=${s.movementUsed}/${s.movementRoll}${stopReason ? ' stop=' + stopReason : ' stop=path-end'}`);
  broadcastRoom(room);
}

// Number of visible forward options from `here`, excluding the cell we
// came from. A "branch" is a cardinal neighbour that the heroes can
// actually see right now: not solid rock, not behind a wall, not behind
// a closed door they haven't discovered yet, not hidden by fog of war.
// Used by the corridor intersection-stop rule.
// `countVisibleBranches` now lives in `game/pathfinding.js` and is
// imported at the top of this file.

// ==========================================================
// SEARCH — for traps + secret doors in current room
// ==========================================================
// 2021: Search for Traps and Search for Secret Doors are TWO separate
// actions of the six. The "no monsters" precondition is LINE-OF-SIGHT
// based for both ("no monsters visible to you"), NOT same-room. (The
// Search Treasure rule is the room-based one.)
function anyMonsterVisibleToHero(s, hero) {
  return s.monsters.some(m => !m.dead && lineOfSight(s, hero.at, m.at));
}

function _searchPrelude(room, token) {
  if (!isMyTurn(room, token)) return null;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return null;
  if (s.actionUsed) return null;
  const h = currentHero(room);
  if (!h) return null;
  const tile = tileAt(s, h.at[0], h.at[1]);
  if (!tile) return null;
  return { s, h, tile };
}

function handleSearchTraps(room, token) {
  const ctx = _searchPrelude(room, token); if (!ctx) return;
  const { s, h, tile } = ctx;
  if (anyMonsterVisibleToHero(s, h)) {
    logEvent(room, `${h.name} cannot search for traps — a monster is in sight.`);
    s.actionUsed = true;
    lockMovementOnAction(s);
    broadcastRoom(room);
    return;
  }
  let found = 0;
  for (const tr of s.traps) {
    if (tr.revealed || tr.disarmed || tr.triggered) continue;
    const tt = tileAt(s, tr.at[0], tr.at[1]);
    if (!tt || tt.roomId !== tile.roomId) continue;
    tr.revealed = true; found++;
  }
  if (found === 0) logEvent(room, `${h.name} searches for traps — nothing.`);
  else logEvent(room, `${h.name} spots ${found} trap${found === 1 ? '' : 's'} in the room.`, 'reveal');
  s.actionUsed = true;
  lockMovementOnAction(s);
  broadcastRoom(room);
}

function handleSearchSecretDoors(room, token) {
  const ctx = _searchPrelude(room, token); if (!ctx) return;
  const { s, h, tile } = ctx;
  if (anyMonsterVisibleToHero(s, h)) {
    logEvent(room, `${h.name} cannot search for secret doors — a monster is in sight.`);
    s.actionUsed = true;
    lockMovementOnAction(s);
    broadcastRoom(room);
    return;
  }
  let found = 0;
  // Iterate backwards so we can splice without messing up indices.
  for (let i = s.secretDoors.length - 1; i >= 0; i--) {
    const d = s.secretDoors[i];
    if (d.revealed) continue;
    const ta = tileAt(s, d.a[0], d.a[1]);
    const tb = tileAt(s, d.b[0], d.b[1]);
    const onA = ta && ta.roomId === tile.roomId;
    const onB = tb && tb.roomId === tile.roomId;
    if (!onA && !onB) continue;
    d.revealed = true; found++;
    // Per the rule, a discovered secret door is placed as a CLOSED
    // tile — hero must move adjacent and explicitly open it before
    // what's beyond is revealed. We materialise it into s.doors so
    // the standard Adjacent-Doors panel + free open-door flow take
    // over. `wasSecret: true` lets the renderer hint at the origin.
    s.doors.push({
      a: [...d.a], b: [...d.b],
      state: 'closed',
      revealed: true,
      wasSecret: true,
    });
    logEvent(room, `${h.name} discovers a secret door!`, 'reveal');
  }
  if (found === 0) logEvent(room, `${h.name} searches for secret doors — nothing.`);
  s.actionUsed = true;
  lockMovementOnAction(s);
  broadcastRoom(room);
}

// Legacy combined search — kept so older clients still work; dispatches
// to both new handlers in sequence (both bits of info revealed at once).
function handleSearchRoom(room, token) {
  handleSearchTraps(room, token);
  handleSearchSecretDoors(room, token);
}

// 2021 disarm rules:
//   Non-Dwarf with tool kit: roll 1 combat die. Skull = sprung, any
//     shield (white/black) = disarmed.
//   Dwarf (no tool kit needed): roll 1 combat die. Black shield =
//     sprung, anything else (skull/white shield) = disarmed.
// 2021 jump-trap rule: hero with ≥2 movement remaining may attempt to
// hop over a discovered trap onto the cell beyond. Roll 1 combat die —
// no skull = jumped (consumes 2 movement); skull = sprung as if walked.
function handleJumpTrap(room, token, trapId, target) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  const h = currentHero(room);
  if (!h) return;
  if (s.movementRoll == null) return;
  const remaining = s.movementRoll - s.movementUsed;
  if (remaining < 2) {
    logEvent(room, `${h.name} needs at least 2 movement to jump.`);
    return;
  }
  const tr = s.traps.find(x => x.id === trapId);
  if (!tr || !tr.revealed) return;
  if (tr.type === 'block' && tr.triggered) {
    logEvent(room, `A sprung falling-block cannot be jumped.`);
    return;
  }
  // Hero must be adjacent to the trap and target the cell beyond.
  if (!adjacent(h.at, tr.at)) return;
  if (!adjacent(tr.at, target)) return;
  // Trap and target must be in line with hero (no L-jumps — over-then-90).
  const dx1 = tr.at[0] - h.at[0], dy1 = tr.at[1] - h.at[1];
  const dx2 = target[0] - tr.at[0], dy2 = target[1] - tr.at[1];
  if (dx1 !== dx2 || dy1 !== dy2) return;
  const tt = tileAt(s, target[0], target[1]);
  if (!tt || tt.furnitureId || tt.blocked) return;
  if (occupantAt(s, target) && !isMultiShareCell(s, target)) return;

  const die = rollCombatDie();
  if (die === 'skull') {
    logEvent(room, `${h.name} stumbles into the ${tr.type} trap mid-jump!`, 'death');
    h.at = [...tr.at];
    s.movementUsed += 1;
    triggerTrapsForCell(room, h, tr.at);
  } else {
    logEvent(room, `${h.name} leaps over the ${tr.type} trap.`, 'reveal');
    h.at = [...target];
    s.movementUsed += 2;
    exploreFromHero(room, h);
    triggerTrapsForCell(room, h, target);
  }
  broadcastRoom(room);
}

// Hero passes an item (potion or artifact) to another hero — only on
// their own turn, only if both heroes are alive. Per the rulebook,
// gold can also be shared at any time but we don't model individual
// gold transfers (it's all one purse anyway between quests).
function handleGiveItem(room, token, toHeroId, itemIndex, itemKind) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  const giver = currentHero(room);
  if (!giver) return;
  const recv = s.heroes.find(x => x.id === toHeroId);
  if (!recv || recv.dead || recv.id === giver.id) return;

  if (itemKind === 'potion' || itemKind === 'consumable' || itemKind === 'inventory') {
    const it = giver.inventory[itemIndex];
    if (!it) return;
    giver.inventory.splice(itemIndex, 1);
    recv.inventory.push(it);
    logEvent(room, `${giver.name} gives ${recv.name} a ${it.name}.`);
  } else if (itemKind === 'artifact') {
    const slot = ['artifactWeapon','artifactArmour','artifactItem'][itemIndex] || itemIndex;
    const aId = giver.equipped[slot];
    if (!aId) return;
    giver.equipped[slot] = null;
    recv.equipped[slot] = aId;
    const a = ARTIFACTS[aId];
    logEvent(room, `${giver.name} hands ${recv.name} the ${a ? a.name : aId}.`);
  } else {
    return;
  }
  // Mark that a hero-to-hero transfer happened — tracked for objectives
  // like "Transfer items between heroes" (sandbox-F).
  s._gaveItem = true;
  broadcastRoom(room);
}

function handleDisarmTrap(room, token, trapId) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'hero') return;
  if (s.actionUsed) return;
  const h = currentHero(room);
  if (!h) return;
  const tr = s.traps.find(x => x.id === trapId);
  if (!tr || tr.disarmed || tr.triggered) return;
  if (!adjacent(h.at, tr.at) && !(h.at[0] === tr.at[0] && h.at[1] === tr.at[1])) return;
  const hasToolkit = h.equipped.utility === 'tool-kit';
  const isDwarf = h.id === 'dwarf';
  if (!hasToolkit && !isDwarf) {
    logEvent(room, `${h.name} has no Tool Kit and cannot disarm.`);
    return;
  }
  const die = rollCombatDie();
  let sprung;
  if (isDwarf) {
    sprung = (die === 'monsterShield');     // Dwarf only fails on a black shield
  } else {
    sprung = (die === 'skull');             // Tool kit fails on a skull
  }
  if (sprung) {
    if (tr.type === 'block') {
      tr.triggered = true; tr.revealed = true;
      const dice = rollAttackDice(3);
      const dmg = dice.filter(f => f === 'skull').length;
      h.body = Math.max(0, h.body - dmg);
      const t = tileAt(s, tr.at[0], tr.at[1]);
      if (t) { t.blocked = true; t.blockedKind = 'falling-block'; }
      logEvent(room, `${h.name} fumbles a falling-block trap! Took ${dmg} Body. Cell now blocked.`, 'death');
    } else if (tr.type === 'pit') {
      tr.triggered = true; tr.revealed = true;
      h.body = Math.max(0, h.body - 1);
      h.status.inPit = (h.at[0] === tr.at[0] && h.at[1] === tr.at[1]);
      logEvent(room, `${h.name} fumbles a pit trap! -1 Body.`, 'death');
    } else {
      tr.triggered = true; tr.revealed = true;
      h.body = Math.max(0, h.body - 1);
      logEvent(room, `${h.name} fumbles a ${tr.type} trap! -1 Body.`, 'death');
    }
  } else {
    tr.disarmed = true; tr.revealed = true;
    logEvent(room, `${h.name} disarms a ${tr.type} trap.`, 'reveal');
  }
  s.actionUsed = true;
  lockMovementOnAction(s);
  checkEndConditions(room);
  broadcastRoom(room);
}

// ==========================================================
// START-OF-TURN status processing
// ==========================================================
function startOfTurn(room) {
  const s = room.state;
  const cur = currentTurn(room);
  if (!cur) return;
  s.spellsCastThisTurn = 0;
  if (cur.kind === 'hero') {
    const h = s.heroes.find(x => x.id === cur.heroId);
    if (!h) return;
    if (h.status.skipNextTurn) {
      h.status.skipNextTurn = false;
      logEvent(room, `${h.name} loses their turn.`, 'reveal');
      setTimeout(() => { advanceTurn(room); startOfTurn(room); broadcastRoom(room); }, 50);
      return;
    }
    if (h.status.sleeping) {
      const r = rollD6();
      if (r === 6) {
        h.status.sleeping = false;
        logEvent(room, `${h.name} wakes up!`, 'reveal');
      } else {
        logEvent(room, `${h.name} sleeps through the turn (rolled ${r}).`, 'reveal');
        setTimeout(() => { advanceTurn(room); startOfTurn(room); broadcastRoom(room); }, 50);
        return;
      }
    }
    // Auto-roll movement if the room option is on
    if (room.config.autoRollMovement && s.movementRoll == null) {
      rollHeroMovement(room, h);
    }
  }
}

// ==========================================================
// GM TURN — human or AI
// ==========================================================
function handleGMRollAndMove(room, token, monsterId, targetCell) {
  // Human GM action: move a monster one cell. We give the GM a budget pool
  // per active monster equal to a fresh 2d6 each turn, tracked in s.gmBudget.
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'gm') return;
  if (room.config.gmMode !== 'human') return;

  const m = s.monsters.find(x => x.id === monsterId);
  if (!m || m.dead || !m.active) return;
  if (!s.gmBudget) s.gmBudget = {};
  if (s.gmBudget[m.id] == null) {
    s.gmBudget[m.id] = (MONSTER_TYPES[m.type] && MONSTER_TYPES[m.type].move) || 6;
  }
  if (s.gmBudget[m.id] <= 0) return;
  // Same split rule as heroes — once this monster has acted (attacked
  // or cast a Dread spell) AFTER moving, it can't move further.
  if (s.gmMovementLocked && s.gmMovementLocked[m.id]) return;

  const next = passable(s, m.at, targetCell, { kind: 'monster', id: m.id });
  if (!next) return;
  if (next.needsOpenDoor) openDoor(room, next.needsOpenDoor, m);
  m.at = [...targetCell];
  s.gmBudget[m.id]--;
  broadcastRoom(room);
}

function handleGMAttack(room, token, monsterId, heroId) {
  if (!isMyTurn(room, token)) return;
  const s = room.state;
  const cur = currentTurn(room);
  if (cur.kind !== 'gm') return;
  if (room.config.gmMode !== 'human') return;
  const m = s.monsters.find(x => x.id === monsterId);
  const h = s.heroes.find(x => x.id === heroId);
  if (!m || m.dead || !m.active) return;
  if (!h || h.dead) return;
  if (!adjacent(m.at, h.at)) return;
  if (meleeBlocked(s, m.at, h.at)) return;
  if (!s.gmAttackUsed) s.gmAttackUsed = {};
  if (s.gmAttackUsed[m.id]) return;
  resolveAttack(room, { kind: 'monster', ref: m }, { kind: 'hero', ref: h });
  s.gmAttackUsed[m.id] = true;
  // If this monster has already moved this turn, lock its movement —
  // it cannot finish a partial move after attacking.
  const initialMove = (MONSTER_TYPES[m.type] && MONSTER_TYPES[m.type].move) || 6;
  if ((s.gmBudget && s.gmBudget[m.id] != null) && s.gmBudget[m.id] < initialMove) {
    if (!s.gmMovementLocked) s.gmMovementLocked = {};
    s.gmMovementLocked[m.id] = true;
  }
  broadcastRoom(room);
}

function handleGMEndTurn(room, token) {
  if (!isMyTurn(room, token)) return;
  const cur = currentTurn(room);
  if (cur.kind !== 'gm') return;
  if (room.config.gmMode !== 'human') return;
  const s = room.state;
  s.gmBudget = {};
  s.gmAttackUsed = {};
  s.gmMovementLocked = {};
  advanceTurn(room);
  logEvent(room, `Evil Wizard ends turn.`);
  broadcastRoom(room);
}

// ==========================================================
// AI GM SCHEDULER
// ==========================================================
function scheduleAITick(room) {
  if (!room.state) return;
  if (room.phase !== 'play') return;
  if (room._aiTimer) return;
  const cur = currentTurn(room);
  if (!cur) return;
  // AI runs the GM in AI mode
  if (cur.kind === 'gm' && room.config.gmMode === 'ai') {
    const speed = Math.max(1, Math.min(4, room.config.aiSpeed || 1));
    const delay = Math.round((AI_TICK_MS + Math.random() * AI_TICK_JITTER) / speed);
    room._aiTimer = setTimeout(() => {
      room._aiTimer = null;
      try { runAITick(room); }
      catch (e) {
        console.error('[ai] runAITick crashed:', e && e.stack || e);
        // Don't let a dead AI freeze the GM turn — pop the current monster
        // and try again on the next tick.
        if (room.state) { room.state._aiCurrent = null; }
        try { broadcastRoom(room); } catch {}
      }
    }, delay);
    return;
  }
}

function runAITick(room) {
  if (!room.state) return;
  if (currentTurn(room)?.kind !== 'gm') return;
  if (room.config.gmMode !== 'ai') return;

  // Process monsters one at a time across ticks (visible animation)
  const s = room.state;
  if (!s._aiPlan) {
    // Plan: list of active monsters that haven't moved yet this turn
    s._aiPlan = s.monsters.filter(m => m.active && !m.dead).map(m => m.id);
    s._aiCurrent = null;
    const total  = s.monsters.length;
    const active = s.monsters.filter(m => m.active && !m.dead).length;
    console.log(`[ai] ${room.code} GM turn: ${active}/${total} active monsters`);
    if (active === 0) {
      // Nothing to do — close the turn out immediately rather than
      // burning a tick on an empty plan.
      s._aiPlan = null;
      s._aiCurrent = null;
      advanceTurn(room);
      logEvent(room, `Evil Wizard ends turn.`);
      broadcastRoom(room);
      return;
    }
  }
  // Pop or start next monster
  if (!s._aiCurrent) {
    if (s._aiPlan.length === 0) {
      // GM turn done
      s._aiPlan = null;
      s._aiCurrent = null;
      advanceTurn(room);
      logEvent(room, `Evil Wizard ends turn.`);
      broadcastRoom(room);
      return;
    }
    const id = s._aiPlan.shift();
    const m = s.monsters.find(x => x.id === id);
    const mp = (m && MONSTER_TYPES[m.type] && MONSTER_TYPES[m.type].move) || 6;
    s._aiCurrent = { id, mp, mpInitial: mp, attacked: false, movedBeforeAttack: false };
  }

  const action = decideMonsterTurn(s, s._aiCurrent, { adjacent, passable, occupantAt, key, tileAt, meleeBlocked });
  {
    const m = s.monsters.find(x => x.id === s._aiCurrent.id);
    console.log(`[ai] ${room.code} ${m?.type || '?'}#${s._aiCurrent.id} mp=${s._aiCurrent.mp} → ${action.type}${action.heroId ? ' '+action.heroId : ''}${action.to ? ' ('+action.to.join(',')+')' : ''}`);
  }

  if (action.type === 'move') {
    const m = s.monsters.find(x => x.id === s._aiCurrent.id);
    if (!m || m.dead) { s._aiCurrent = null; return scheduleAITick(room); }
    const next = passable(s, m.at, action.to, { kind: 'monster', id: m.id });
    if (next) {
      if (next.needsOpenDoor) openDoor(room, next.needsOpenDoor, m);
      m.at = [...action.to];
      s._aiCurrent.mp--;
    } else {
      s._aiCurrent.mp = 0;
    }
    broadcastRoom(room);
    return;
  }
  if (action.type === 'attack') {
    const m = s.monsters.find(x => x.id === s._aiCurrent.id);
    const h = s.heroes.find(x => x.id === action.heroId);
    if (m && h && !m.dead && !h.dead && adjacent(m.at, h.at) && !meleeBlocked(s, m.at, h.at)) {
      resolveAttack(room, { kind: 'monster', ref: m }, { kind: 'hero', ref: h });
    }
    // Mark whether the monster moved before attacking — if so, it can't
    // move further this turn (split-action rule).
    if (s._aiCurrent.mpInitial - s._aiCurrent.mp > 0) {
      s._aiCurrent.movedBeforeAttack = true;
    }
    s._aiCurrent.attacked = true;
    broadcastRoom(room);
    return;
  }
  // 'end' — done with this monster
  s._aiCurrent = null;
  // Schedule next tick to handle next monster
  broadcastRoom(room);
}

// ==========================================================
// LOBBY ACTIONS
// ==========================================================
function onCreate(ws, msg) {
  const name = (msg.name || '').toString().trim().slice(0, 14);
  if (!name) return send(ws, 'error', { message: 'Name required.' });
  const token = uid();
  const room = makeRoom(token);
  room.players.push({ token, pid: pid(), name, connected: true, isBot: false });
  room.sockets.set(token, ws);
  ws._roomCode = room.code; ws._token = token;
  send(ws, 'joined', { code: room.code, token, youName: name });
  broadcastRoom(room);
}

function onJoin(ws, msg) {
  const name = (msg.name || '').toString().trim().slice(0, 14);
  const c = (msg.code || '').toString().trim().toUpperCase();
  if (!name) return send(ws, 'error', { message: 'Name required.' });
  const room = rooms.get(c);
  if (!room) return send(ws, 'error', { message: 'Room not found.' });
  if (room.phase !== 'lobby') return send(ws, 'error', { message: 'Game already in progress. Ask the host to restart.' });
  if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
    return send(ws, 'error', { message: 'Name already taken in this room.' });
  if (room.players.length >= 6)
    return send(ws, 'error', { message: 'Room is full.' });
  const token = uid();
  room.players.push({ token, pid: pid(), name, connected: true, isBot: false });
  room.sockets.set(token, ws);
  ws._roomCode = room.code; ws._token = token;
  send(ws, 'joined', { code: room.code, token, youName: name });
  broadcastRoom(room);
}

function onRejoin(ws, msg) {
  const c = (msg.code || '').toString().trim().toUpperCase();
  const token = (msg.token || '').toString();
  const room = rooms.get(c);
  if (!room) return send(ws, 'error', { message: 'Room no longer exists.' });
  const p = room.players.find(x => x.token === token);
  if (!p) return send(ws, 'error', { message: 'You are not in this room.' });
  const prev = room.sockets.get(token);
  if (prev && prev !== ws) try { prev.close(); } catch {}
  room.sockets.set(token, ws);
  p.connected = true;
  ws._roomCode = room.code; ws._token = token;
  send(ws, 'joined', { code: room.code, token, youName: p.name });
  broadcastRoom(room);
}

function onLeave(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  const token = ws._token;
  if (room.phase === 'lobby') {
    room.players = room.players.filter(p => p.token !== token);
    // Release seats they held
    for (const id of ['barbarian','dwarf','elf','wizard','gm']) {
      if (room.seats[id] === token) room.seats[id] = null;
    }
    if (token === room.hostToken && room.players.length > 0) {
      room.hostToken = room.players[0].token;
    }
    if (room.players.length === 0) { rooms.delete(room.code); return; }
  } else {
    const p = room.players.find(p => p.token === token);
    if (p) p.connected = false;
  }
  room.sockets.delete(token);
  broadcastRoom(room);
}

function onSetConfig(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can change settings.' });
  if (room.phase !== 'lobby') return;
  if (msg.questId && quests.has(msg.questId)) room.config.questId = msg.questId;
  if (msg.gmMode === 'ai' || msg.gmMode === 'human') {
    room.config.gmMode = msg.gmMode;
    if (msg.gmMode === 'ai' && room.seats.gm) room.seats.gm = null;
  }
  if (typeof msg.autoRollMovement === 'boolean') {
    room.config.autoRollMovement = msg.autoRollMovement;
  }
  if (typeof msg.revealAll === 'boolean') {
    room.config.revealAll = msg.revealAll;
  }
  broadcastRoom(room);
}

// Anyone in the room can change the AI pacing — it's just visual,
// non-strategic, and players want it both during the lobby and mid-quest.
function onSetAiSpeed(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  const v = Math.max(1, Math.min(4, parseInt(msg.value, 10) || 1));
  room.config.aiSpeed = v;
  broadcastRoom(room);
}

// ==========================================================
// HERO SPELL-ELEMENT DRAFT (2021 rules)
// ==========================================================
// Wizard picks one of {air, fire, water, earth}; elf picks one of the
// remaining three; the wizard auto-takes the other two.

const SPELL_ELEMENTS = ['air', 'fire', 'water', 'earth'];

function spellDraftStatus(room) {
  const wSeated = !!room.seats.wizard;
  const eSeated = !!room.seats.elf;
  const sp = room.spellPick || (room.spellPick = { wizardElements: [], elfElements: [] });
  // Defensive: drop unknown / duplicate elements that may have leaked in.
  const cleanList = (xs) => {
    const seen = new Set(); const out = [];
    for (const x of xs || []) if (SPELL_ELEMENTS.includes(x) && !seen.has(x)) { seen.add(x); out.push(x); }
    return out;
  };
  sp.wizardElements = cleanList(sp.wizardElements);
  sp.elfElements    = cleanList(sp.elfElements);

  const taken = new Set([...sp.wizardElements, ...sp.elfElements]);
  const available = SPELL_ELEMENTS.filter(e => !taken.has(e));

  let phase, currentSeat = null, done = false;
  if (!wSeated && !eSeated) {
    phase = 'na';   // no spellcasters in the party — nothing to draft
  } else if (wSeated && eSeated) {
    if (sp.wizardElements.length === 0)        { phase = 'wizardFirst'; currentSeat = 'wizard'; }
    else if (sp.elfElements.length === 0)      { phase = 'elf';         currentSeat = 'elf'; }
    else if (sp.wizardElements.length < 3)     { phase = 'wizardAuto';  currentSeat = 'wizard'; }
    else                                       { phase = 'done';        done = true; }
  } else if (wSeated) {
    if (sp.wizardElements.length < 3)          { phase = 'wizardOnly';  currentSeat = 'wizard'; }
    else                                       { phase = 'done';        done = true; }
  } else /* elf only */ {
    if (sp.elfElements.length < 1)             { phase = 'elfOnly';     currentSeat = 'elf'; }
    else                                       { phase = 'done';        done = true; }
  }
  return { phase, currentSeat, done, available, wizardElements: sp.wizardElements, elfElements: sp.elfElements };
}

// Auto-finalize: in the both-seats case, once the elf has picked, the
// wizard's remaining two elements are filled in automatically per the
// rule. Called after any draft mutation.
function autoFinalizeSpellDraft(room) {
  const sp = room.spellPick;
  const wSeated = !!room.seats.wizard;
  const eSeated = !!room.seats.elf;
  if (wSeated && eSeated && sp.wizardElements.length === 1 && sp.elfElements.length === 1) {
    const taken = new Set([...sp.wizardElements, ...sp.elfElements]);
    for (const el of SPELL_ELEMENTS) {
      if (!taken.has(el)) sp.wizardElements.push(el);
    }
  }
}

// Drop any picks that are no longer valid (seat released, etc).
function resetSpellDraft(room) {
  room.spellPick = { wizardElements: [], elfElements: [] };
}

function onPickSpellElement(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.phase !== 'lobby') return;
  const seat = msg.seat;
  const element = msg.element;
  if (!['wizard', 'elf'].includes(seat)) return;
  if (!SPELL_ELEMENTS.includes(element))
    return send(ws, 'error', { message: 'Unknown spell element.' });
  // Sender must own the seat they claim to be picking for.
  if (room.seats[seat] !== ws._token)
    return send(ws, 'error', { message: 'You do not control that seat.' });

  const status = spellDraftStatus(room);
  // Validate it's that seat's turn.
  if (status.currentSeat !== seat)
    return send(ws, 'error', { message: 'Not your turn to pick.' });
  // Element must still be available.
  if (!status.available.includes(element))
    return send(ws, 'error', { message: 'That element is already taken.' });

  if (seat === 'wizard') room.spellPick.wizardElements.push(element);
  else                    room.spellPick.elfElements.push(element);
  autoFinalizeSpellDraft(room);
  broadcastRoom(room);
}

function onResetSpellDraft(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.phase !== 'lobby') return;
  // Anyone seated as wizard, elf, or host may reset the draft (lobby UX).
  const t = ws._token;
  const allowed = t === room.hostToken
    || room.seats.wizard === t
    || room.seats.elf === t;
  if (!allowed) return;
  resetSpellDraft(room);
  broadcastRoom(room);
}

// Sets the printed-art variant ('male' | 'female') for one hero seat.
// Only the player currently sitting in that seat may change their own
// art; the host may not override another player's choice.
const HERO_SEATS = ['barbarian', 'dwarf', 'elf', 'wizard'];
const HERO_VARIANTS = ['male', 'female'];
function onSetHeroVariant(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.phase !== 'lobby') return;
  const seat = msg.seat;
  const variant = msg.variant;
  if (!HERO_SEATS.includes(seat))      return;
  if (!HERO_VARIANTS.includes(variant)) return;
  if (room.seats[seat] !== ws._token)
    return send(ws, 'error', { message: 'You do not control that seat.' });
  if (!room.heroVariants) room.heroVariants = {};
  room.heroVariants[seat] = variant;
  broadcastRoom(room);
}

// First-quest convenience — apply the rulebook's beginner suggestion:
// the wizard takes Fire; the elf takes Earth; the wizard auto-fills
// with Air and Water. Anyone seated as wizard, elf, or host can apply.
function onSuggestSpellDraft(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.phase !== 'lobby') return;
  const t = ws._token;
  const allowed = t === room.hostToken
    || room.seats.wizard === t
    || room.seats.elf === t;
  if (!allowed) return;
  resetSpellDraft(room);
  if (room.seats.wizard) room.spellPick.wizardElements.push('fire');
  if (room.seats.elf)    room.spellPick.elfElements.push('earth');
  autoFinalizeSpellDraft(room);
  broadcastRoom(room);
}

function onClaim(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.phase !== 'lobby') return;
  const seat = msg.seat;
  const valid = ['barbarian','dwarf','elf','wizard','gm'];
  if (!valid.includes(seat)) return;
  if (seat === 'gm' && room.config.gmMode !== 'human')
    return send(ws, 'error', { message: 'GM seat is closed (AI GM).' });
  // Release any other heroes I had if claiming GM
  if (seat === 'gm') {
    for (const id of ['barbarian','dwarf','elf','wizard']) {
      if (room.seats[id] === ws._token) room.seats[id] = null;
    }
  } else if (room.seats.gm === ws._token) {
    return send(ws, 'error', { message: 'You are the GM. Release GM first.' });
  }
  if (room.seats[seat] && room.seats[seat] !== ws._token)
    return send(ws, 'error', { message: 'Seat already taken.' });
  room.seats[seat] = ws._token;
  // Spellcaster seat changes invalidate any in-progress draft.
  if (seat === 'wizard' || seat === 'elf') resetSpellDraft(room);
  broadcastRoom(room);
}

function onRelease(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.phase !== 'lobby') return;
  const seat = msg.seat;
  if (room.seats[seat] === ws._token) {
    room.seats[seat] = null;
    if (seat === 'wizard' || seat === 'elf') resetSpellDraft(room);
    // Reset variant to default when the seat goes empty so the next
    // player who claims it starts from the canonical 'male' art.
    if (room.heroVariants && HERO_SEATS.includes(seat)) room.heroVariants[seat] = 'male';
  }
  broadcastRoom(room);
}

function onStart(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can start.' });
  if (room.phase !== 'lobby') return;
  // Need at least one hero
  const heroSeats = ['barbarian','dwarf','elf','wizard'].filter(id => room.seats[id]);
  if (heroSeats.length === 0) return send(ws, 'error', { message: 'At least one hero must be claimed.' });
  if (room.config.gmMode === 'human' && !room.seats.gm)
    return send(ws, 'error', { message: 'Human GM mode requires a GM seat.' });
  if (!room.config.questId || !quests.has(room.config.questId))
    return send(ws, 'error', { message: 'Pick a quest.' });
  // If there's a wizard or elf in the party, the spell draft must be
  // settled before play begins. The "Use suggested" shortcut in the
  // lobby applies the rulebook's beginner default in one click.
  const draft = spellDraftStatus(room);
  if (!draft.done && draft.phase !== 'na')
    return send(ws, 'error', { message: 'Finish the spell draft (or apply the suggested split) before starting.' });

  room.state = freshGameState(room);
  if (!room.state) return send(ws, 'error', { message: 'Quest failed to load.' });
  room.phase = 'play';
  logEvent(room, `Quest "${room.state.questTitle}" begins.`);
  if (currentTurn(room)?.kind === 'hero') {
    const h = currentHero(room);
    logEvent(room, `${HEROES[h.id].name}'s turn.`);
  }
  startOfTurn(room);
  broadcastRoom(room);
}

function onRestart(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can restart.' });
  room.state = null;
  room.phase = 'lobby';
  broadcastRoom(room);
}

// ==========================================================
// CONNECTION HANDLERS
// ==========================================================
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  switch (msg.type) {
    case 'create':    return onCreate(ws, msg);
    case 'join':      return onJoin(ws, msg);
    case 'rejoin':    return onRejoin(ws, msg);
    case 'leave':     return onLeave(ws);
    case 'leaveQuest': return onRestart(ws);  // mid-quest "Leave" → back to lobby
    case 'setConfig': return onSetConfig(ws, msg);
    case 'setAiSpeed': return onSetAiSpeed(ws, msg);
    case 'claim':     return onClaim(ws, msg);
    case 'release':   return onRelease(ws, msg);
    case 'pickSpellElement':  return onPickSpellElement(ws, msg);
    case 'resetSpellDraft':   return onResetSpellDraft(ws);
    case 'suggestSpellDraft': return onSuggestSpellDraft(ws);
    case 'setHeroVariant':    return onSetHeroVariant(ws, msg);
    case 'start':     return onStart(ws);
    case 'restart':   return onRestart(ws);
    case 'action':    return onAction(ws, msg);
  }
}

function onAction(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room || !room.state) return;
  const token = ws._token;
  switch (msg.action) {
    case 'rollMovement':   return handleRollMovement(room, token);
    case 'move':           return handleMove(room, token, msg.target);
    case 'moveTo':         return handleMoveTo(room, token, msg.target);
    case 'openDoor':       return handleOpenDoor(room, token, msg.a, msg.b);
    case 'attack':         return handleAttack(room, token, msg.targetMonsterId);
    case 'searchTreasure': return handleSearchTreasure(room, token);
    case 'searchRoom':         return handleSearchRoom(room, token);
    case 'searchTraps':        return handleSearchTraps(room, token);
    case 'searchSecretDoors':  return handleSearchSecretDoors(room, token);
    case 'disarmTrap':         return handleDisarmTrap(room, token, msg.trapId);
    case 'jumpTrap':           return handleJumpTrap(room, token, msg.trapId, msg.target);
    case 'giveItem':           return handleGiveItem(room, token, msg.toHeroId, msg.itemIndex, msg.itemKind);
    case 'castSpell':      return handleCastSpell(room, token, msg.spellId, msg.target);
    case 'useItem':        return handleUseItem(room, token, msg.itemIndex);
    case 'buyEquipment':   return handleBuyEquipment(room, token, msg.equipmentId);
    case 'endShop':        return handleEndShop(ws);
    case 'endTurn':        return handleEndTurn(room, token);
    case 'gmMove':         return handleGMRollAndMove(room, token, msg.monsterId, msg.target);
    case 'gmAttack':       return handleGMAttack(room, token, msg.monsterId, msg.heroId);
    case 'gmEndTurn':      return handleGMEndTurn(room, token);
    case 'dismissCombat': {
      // Block dismissals from pure spectators — only seated players
      // (hero or GM) can clear the table.
      const s2 = seatsOf(room, token);
      if (!s2.heroIds.length && !s2.isGM) return;
      if (room.state.combat) { room.state.combat = null; broadcastRoom(room); }
      return;
    }
    case 'dismissTreasureCard': {
      const s2 = seatsOf(room, token);
      if (!s2.heroIds.length && !s2.isGM) return;
      if (room.state.revealedTreasureCard) { room.state.revealedTreasureCard = null; broadcastRoom(room); }
      return;
    }
    case 'choosePotion':
      return handleChoosePotion(room, token, msg.idx);
  }
}

// Player resolves a `pendingSaveRoll`: pick a potion to drink, or null
// to accept death.
function handleChoosePotion(room, token, idx) {
  const s = room.state;
  if (!s.pendingSaveRoll) return;
  const h = s.heroes.find(x => x.id === s.pendingSaveRoll.heroId);
  if (!h) return;
  const seat = seatsOf(room, token);
  if (!seat.heroIds.includes(h.id) && !seat.isGM) return;
  if (idx == null || idx === -1) {
    // Accept death.
    h.dead = true;
    s.pendingSaveRoll = null;
    logEvent(room, `${h.name} refuses the potion — falls.`, 'death');
    checkEndConditions(room);
    broadcastRoom(room);
    return;
  }
  const it = h.inventory[idx];
  if (!it) return;
  if (it.use !== 'heal' && it.use !== 'revive') return;
  const heal = Math.min(it.amount || 4, h.bodyMax);
  h.body = heal;
  h.dead = false;
  h.inventory.splice(idx, 1);
  s.pendingSaveRoll = null;
  logEvent(room, `${h.name} drinks ${it.name} — saved with ${heal} Body.`, 'treasure');
  broadcastRoom(room);
}

// ==========================================================
// HTTP STATIC SERVER
// ==========================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};
const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // ---- API ROUTES (used by the in-browser map editor) ----------------
  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath);

  // ---- Whitelisted /assets/ static route (used by the editor for the
  //      pre-rendered map_qa PNG previews and a few shared images) -----
  if (urlPath.startsWith('/assets/')) {
    const ASSETS_DIR = path.join(__dirname, 'assets');
    // URL-decode so filenames with spaces / unicode resolve correctly
    // (e.g. "Air%20Spell.png" → "Air Spell.png"). Then normalize and
    // do the prefix-check to keep traversal blocked.
    let rel;
    try { rel = decodeURIComponent(urlPath.slice('/assets/'.length)); }
    catch { res.writeHead(400); res.end('Bad Request'); return; }
    const assetPath = path.normalize(path.join(ASSETS_DIR, rel));
    if (!assetPath.startsWith(ASSETS_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(assetPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const ext = path.extname(assetPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  let publicRel;
  try { publicRel = decodeURIComponent(urlPath); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }
  const filePath = path.normalize(path.join(PUBLIC_DIR, publicRel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ==========================================================
// MAP-EDITOR API
// GET  /api/quests              → list of quest files (id, title)
// GET  /api/quests/:file        → raw quest JSON
// PUT  /api/quests/:file        → save quest JSON (atomic)
// POST /api/render-png/:file    → regenerate the QA PNG for one quest
// ==========================================================
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function safeQuestFile(file) {
  // strict: must be foo.json, no separators, no traversal, must exist
  if (!/^[\w\-]+\.json$/.test(file)) return null;
  const fp = path.join(QUESTS_DIR, file);
  if (path.dirname(fp) !== QUESTS_DIR) return null;
  return fp;
}
function readBody(req, max = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', c => {
      total += c.length;
      if (total > max) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
// Furniture natural-orientation overrides — persisted to disk so the
// editor's "apply" actually saves, and the live game reads the same
// file on boot. Shape: { "tomb": "upward", ... }
const FURN_NATURALS_FILE = path.join(DATA_DIR, 'furniture-naturals.json');
function readFurnNaturals() {
  try {
    if (!fs.existsSync(FURN_NATURALS_FILE)) return {};
    const raw = fs.readFileSync(FURN_NATURALS_FILE, 'utf8');
    const j = JSON.parse(raw);
    return (j && typeof j === 'object') ? j : {};
  } catch { return {}; }
}
function writeFurnNaturals(map) {
  const tmp = FURN_NATURALS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
  fs.renameSync(tmp, FURN_NATURALS_FILE);
}

function handleApi(req, res, urlPath) {
  // GET /api/board → master board (rooms + corridor cells)
  if (req.method === 'GET' && urlPath === '/api/board') {
    if (!MASTER_BOARD) return sendJson(res, 404, { error: 'no master board' });
    return sendJson(res, 200, MASTER_BOARD);
  }

  // GET /api/canonical-pieces → furniture metadata (file, altFile,
  // naturalDir, aliases, footprint). Single source of truth for the
  // three frontends + the XML converter + the quest validator.
  if (req.method === 'GET' && urlPath === '/api/canonical-pieces') {
    return sendJson(res, 200, CANONICAL_PIECES);
  }
  // Force a fresh YAML read without restarting the server (useful
  // while iterating on the file). Any client can call this; we just
  // re-parse the file and bump an in-memory copy.
  if (req.method === 'POST' && urlPath === '/api/canonical-pieces/reload') {
    loadCanonicalPieces();
    return sendJson(res, 200, { ok: true, pieces: Object.keys(CANONICAL_PIECES.pieces || {}).length });
  }

  // GET / PUT /api/furn-naturals → per-type natural-orientation overrides
  if (urlPath === '/api/furn-naturals') {
    if (req.method === 'GET') {
      return sendJson(res, 200, readFurnNaturals());
    }
    if (req.method === 'PUT') {
      readBody(req).then(body => {
        let parsed;
        try { parsed = JSON.parse(body); }
        catch (e) { return sendJson(res, 400, { error: 'bad JSON: ' + e.message }); }
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          return sendJson(res, 400, { error: 'expected an object' });
        }
        const VALID = new Set(['downward','upward','leftward','rightward']);
        const cleaned = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === 'string' && typeof v === 'string' && VALID.has(v)) {
            cleaned[k] = v;
          }
        }
        try {
          writeFurnNaturals(cleaned);
          return sendJson(res, 200, { ok: true, count: Object.keys(cleaned).length });
        } catch (e) {
          return sendJson(res, 500, { error: String(e) });
        }
      }).catch(err => sendJson(res, 413, { error: err.message }));
      return;
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // GET /api/quests
  if (req.method === 'GET' && urlPath === '/api/quests') {
    const items = [];
    for (const f of fs.readdirSync(QUESTS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const q = JSON.parse(fs.readFileSync(path.join(QUESTS_DIR, f), 'utf8'));
        items.push({
          file: f,
          id: q.id || f.replace(/\.json$/, ''),
          title: q.title || '',
          subtitle: q.subtitle || '',
          category: q.category || 'main',
        });
      } catch (e) { /* skip unreadable */ }
    }
    items.sort((a, b) => {
      const na = parseInt((a.file.match(/quest(\d+)/) || [])[1] || 999);
      const nb = parseInt((b.file.match(/quest(\d+)/) || [])[1] || 999);
      return na - nb;
    });
    return sendJson(res, 200, { quests: items });
  }

  // GET / PUT /api/quests/<file>
  let m = urlPath.match(/^\/api\/quests\/([^/]+)$/);
  if (m) {
    const fp = safeQuestFile(m[1]);
    if (!fp) return sendJson(res, 400, { error: 'bad filename' });
    if (req.method === 'GET') {
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'not found' });
      try {
        const q = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return sendJson(res, 200, q);
      } catch (e) {
        return sendJson(res, 500, { error: 'parse error: ' + e.message });
      }
    }
    if (req.method === 'PUT') {
      readBody(req).then(body => {
        let parsed;
        try { parsed = JSON.parse(body); }
        catch (e) { return sendJson(res, 400, { error: 'bad JSON: ' + e.message }); }
        // sanity: must have monsters/furniture/doors/etc keys, even if empty
        if (typeof parsed !== 'object' || !parsed.id) {
          return sendJson(res, 400, { error: 'quest must have an id' });
        }
        // Run the canonical-footprint validator before writing. WARN-level
        // issues mean the quest violates a 2021 spec constraint (wrong
        // stair size, illegal furniture footprint, etc.) — block the save
        // so the editor never silently ships a broken quest. INFO is OK.
        if (validateQuestFn) {
          const issues = validateQuestFn(parsed, m[1]);
          const blockers = issues.filter(i => i.level === 'WARN');
          if (blockers.length) {
            return sendJson(res, 422, {
              error: 'quest validation failed',
              issues: blockers.map(i => i.msg),
            });
          }
        }
        const tmp = fp + '.tmp';
        try {
          fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n');
          fs.renameSync(tmp, fp);
          // hot-reload the in-memory quest table so live games & the
          // editor stay in sync.
          try { loadQuests(); } catch {}
          return sendJson(res, 200, { ok: true, file: m[1] });
        } catch (e) {
          return sendJson(res, 500, { error: String(e) });
        }
      }).catch(err => sendJson(res, 413, { error: err.message }));
      return;
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // POST /api/render-png/<file>
  m = urlPath.match(/^\/api\/render-png\/([^/]+)$/);
  if (m && req.method === 'POST') {
    const fp = safeQuestFile(m[1]);
    if (!fp) return sendJson(res, 400, { error: 'bad filename' });
    if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'not found' });
    const { spawn } = require('child_process');
    const stem = m[1].replace(/\.json$/, '');
    const child = spawn(process.execPath,
      [path.join(__dirname, 'scripts', 'render-quest-maps.js'), stem],
      { cwd: __dirname });
    let stderr = '';
    child.stderr.on('data', c => stderr += c.toString());
    child.on('close', code => {
      if (code === 0) return sendJson(res, 200, { ok: true, png: `/assets/map_qa/${stem}.png` });
      return sendJson(res, 500, { error: 'renderer failed: ' + stderr });
    });
    return;
  }

  return sendJson(res, 404, { error: 'not found' });
}
const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  ws.on('message', raw => handleMessage(ws, raw));
  ws.on('close',  () => onLeave(ws));
  ws.on('error',  () => {});
});

// Periodic cleanup
function disposeRoom(c, r) {
  if (r && r._aiTimer) { try { clearTimeout(r._aiTimer); } catch {} r._aiTimer = null; }
  rooms.delete(c);
}
setInterval(() => {
  const now = Date.now();
  for (const [c, r] of rooms.entries()) {
    const idle = now - (r.lastActivityAt || r.createdAt || 0);
    const allOffline = r.players.every(p => !p.connected);
    if (r.players.length === 0 && idle > 10 * 60 * 1000) { disposeRoom(c, r); continue; }
    if (r.phase === 'lobby' && allOffline && idle > 30 * 60 * 1000) { disposeRoom(c, r); continue; }
    if (r.phase === 'end' && idle > 2 * 60 * 60 * 1000) { disposeRoom(c, r); continue; }
    if (idle > 24 * 60 * 60 * 1000) { disposeRoom(c, r); continue; }
  }
}, 5 * 60 * 1000);

// ==========================================================
// BOOT
// ==========================================================
loadGameData();
loadQuests();
loadRooms();

httpServer.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────────┐`);
  console.log(`  │  HeroQuest — multiplayer server              │`);
  console.log(`  │  Running on http://localhost:${PORT}             │`);
  console.log(`  └──────────────────────────────────────────────┘\n`);
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  → http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`[shutdown] ${signal} — flushing state to disk`);
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  saveState();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e);
  try { saveState(); } catch {}
  process.exit(1);
});
// Surface stray promise rejections (e.g. readBody rejecting in an async
// handler) instead of letting them die silently. Don't exit — these
// shouldn't be process-fatal — just log and persist current state.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
  try { saveState(); } catch {}
});
