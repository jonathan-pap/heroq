// =====================================================================
// game/quest-builder.js — convert quest JSON → runtime state
//
// Owns the `build*` family that turns a quest JSON (plus the master
// board) into the server's runtime `state` object: tiles, rooms,
// fog flags, doors, heroes, monsters, treasure, traps, secret doors,
// turn order, treasure deck, objectives. Pure modulo `shuffle` (used
// for the treasure deck) and `exploreFromHero` (the fog-reveal
// flood-fill).
//
// `freshGameState(room, deps)` is the only external entry point.
// Helpers are exported too for testability.
//
// See game/quest-builder.md for the deps contract + state-shape.
// =====================================================================
'use strict';

const HQRules = require('../public/shared/rules.js');
const { key } = HQRules;
const { shuffle } = require('./util');

// Static — heroes have two variants. Server-side validation lives in
// server.js (the setter); this is just the truth table used during
// state-build.
const HERO_VARIANTS = ['male', 'female'];

// buildBoardState(quest, deps) — tiles, rooms (with fog flags), doors,
// furniture pieces. `deps.MASTER_BOARD` is required.
function buildBoardState(quest, deps) {
  const { MASTER_BOARD } = deps;
  // A quest may either:
  //  (A) Use the master board (default if `board` is "default" or unset
  //      AND quest does not provide its own rooms/corridors).
  //  (B) Provide its own rooms[] and corridors[] arrays (legacy format,
  //      handy for one-off custom dungeons or the quest designer).
  const useMaster = MASTER_BOARD &&
    (quest.board === 'default' || (!quest.rooms && !quest.corridors));

  const tileMeta = {};
  const allTileKeys = [];
  const roomState = {};

  // All cells start HIDDEN to heroes. exploreFromHero() will flood-fill from
  // every hero's start cell after the board is built, revealing connected
  // open-path neighbours (same room, same corridor segment, or across an
  // open door). Closed doors and walls stop the flood.
  if (useMaster) {
    const overrides = quest.roomOverrides || {};
    for (const r of MASTER_BOARD.rooms) {
      const ov = overrides[r.id] || {};
      const hidden = ('hidden' in ov) ? !!ov.hidden : !!r.hidden;
      const name = ov.name || r.name;
      const color = ov.color || r.color || null;
      roomState[r.id] = { id: r.id, name, color, hiddenFor: { heroes: true } };
      for (const [x, y] of r.cells) {
        const k = key(x, y);
        tileMeta[k] = {
          x, y, kind: 'room', roomId: r.id, hiddenFor: { heroes: true },
          furnitureId: null, _initialHidden: hidden, color,
        };
        allTileKeys.push(k);
      }
    }
    for (const [x, y] of MASTER_BOARD.corridorCells) {
      const k = key(x, y);
      tileMeta[k] = {
        x, y, kind: 'corridor', roomId: null, hiddenFor: { heroes: true },
        furnitureId: null,
      };
      allTileKeys.push(k);
    }
  } else {
    for (const r of (quest.rooms || [])) {
      roomState[r.id] = {
        id: r.id, name: r.name, hiddenFor: { heroes: true },
      };
      for (const [x, y] of r.cells) {
        const k = key(x, y);
        tileMeta[k] = {
          x, y, kind: 'room', roomId: r.id, hiddenFor: { heroes: true },
          furnitureId: null, _initialHidden: !!r.hidden,
        };
        allTileKeys.push(k);
      }
    }
    for (const [x, y] of (quest.corridors || [])) {
      const k = key(x, y);
      tileMeta[k] = {
        x, y, kind: 'corridor', roomId: null, hiddenFor: { heroes: true },
        furnitureId: null,
      };
      allTileKeys.push(k);
    }
  }

  // Furniture (always quest-supplied; it's quest-specific dressing).
  // Tags each occupied tile with both the furniture id and its type so
  // movement/search lookups can stay O(1) per cell. Also keeps the
  // pieces' canonical cell arrays as a list, so the renderer can paint
  // each multi-cell piece (table, tomb, bookcase, …) as ONE glyph
  // spanning its full footprint instead of N tiled mini-glyphs.
  const furniturePieces = [];
  for (const f of (quest.furniture || [])) {
    for (const [x, y] of f.cells) {
      const t = tileMeta[key(x, y)];
      if (t) {
        t.furnitureId = f.id;
        t.furnitureType = f.type || 'block';
        t.furnitureFacing = f.facing || null;
      }
    }
    // Pass through every render-relevant field so the client sees the
    // same orientation the editor does. Previously only id/type/cells
    // were forwarded, which silently stripped facing + flip flags and
    // made every piece render in its natural orientation.
    furniturePieces.push({
      id: f.id,
      type: f.type || 'block',
      cells: (f.cells || []).map(c => [...c]),
      facing: f.facing || null,
      _flipH:    !!f._flipH    || undefined,
      _flipV:    !!f._flipV    || undefined,
      // Per-art-set flips — the client picks _altFlip* when the
      // "Alt furniture art" option is on (and falls back to _flip*).
      // Strip-and-undefined keeps the wire payload clean for pieces
      // that don't carry alt flips.
      _altFlipH: !!f._altFlipH || undefined,
      _altFlipV: !!f._altFlipV || undefined,
      _note:  f._note || undefined,
    });
  }

  // Rubble / blocked cells — per 2021 rulebook, the "blocked square"
  // cardboard tiles. They render as stone-brick rubble, are impassable,
  // and reveal under the same fog-of-war rule as room cells. Distinct
  // from a SPRUNG falling-block trap (which renders as the red square
  // tile from the icon legend); we mark blockedKind so the client can
  // pick the right visual.
  for (const [x, y] of (quest.blocked || [])) {
    const t = tileMeta[key(x, y)];
    if (t) { t.blocked = true; t.blockedKind = 'rubble'; }
  }

  // Solid rock / dark cells — per the canonical "Dark shaded areas on
  // all quest maps are considered solid rock" rule. These cells are
  // PERMANENTLY off-board for this quest: never revealed, impassable,
  // and they break the corridor flood-fill so heroes never see what's
  // beyond them. Render as pure void/black (matching unrevealed).
  // Distinct from rubble (which IS visible once seen).
  for (const [x, y] of (quest.dark || [])) {
    const t = tileMeta[key(x, y)];
    if (t) { t.blocked = true; t.solidRock = true; }
  }

  // Doors are quest-supplied. They start *unrevealed* under fog of war —
  // exploreFromHero promotes them to revealed only when at least one of
  // the two cells they border becomes visible to the heroes.
  const doors = (quest.doors || []).map(d => ({
    a: d.a, b: d.b,
    state: d.state || 'closed',
    revealed: false,
  }));

  return { tileMeta, allTileKeys, roomState, doors, furniturePieces };
}

// buildHeroes(quest, claimedSeats, spellPick, heroVariants, deps)
// → heroes[]. Needs HEROES + SPELLS + SPELLS_BY_ELEMENT tables.
function buildHeroes(quest, claimedSeats, spellPick, heroVariants, deps) {
  const { HEROES, SPELLS, SPELLS_BY_ELEMENT } = deps;
  const heroes = [];
  const order = ['barbarian', 'dwarf', 'elf', 'wizard'];
  const claimed = order.filter(id => claimedSeats[id]);
  const setup = quest.heroSetup || {};
  for (let i = 0; i < claimed.length; i++) {
    const id = claimed[i];
    const proto = HEROES[id];
    const at = quest.startCells[i % quest.startCells.length];
    const hsu = setup[id] || {};

    // Spell hand:
    //   - sandbox `heroSetup[id].spellHand` overrides explicitly
    //   - quest-level `showAllSpells: true` gives the Wizard one of every
    //     spell for ad-hoc testing; the Elf gets all 12 too if flagged
    //   - lobby spell-draft picks override the YAML default if the
    //     wizard / elf player picked their own elements
    //   - otherwise: hero's YAML default elements (3 wizard / 1 elf)
    let elements = (proto.spells && proto.spells.default) || [];
    if (spellPick) {
      if (id === 'wizard' && Array.isArray(spellPick.wizardElements) && spellPick.wizardElements.length === 3) {
        elements = spellPick.wizardElements.slice();
      } else if (id === 'elf' && Array.isArray(spellPick.elfElements) && spellPick.elfElements.length === 1) {
        elements = spellPick.elfElements.slice();
      }
    }
    let spellHand;
    if (Array.isArray(hsu.spellHand)) {
      spellHand = hsu.spellHand.slice();
    } else {
      spellHand = [];
      for (const el of elements) {
        for (const sp of (SPELLS_BY_ELEMENT[el] || [])) spellHand.push(sp.id);
      }
      if (quest.showAllSpells && (id === 'wizard' || id === 'elf')) {
        for (const sid of Object.keys(SPELLS)) {
          if (!spellHand.includes(sid)) spellHand.push(sid);
        }
      }
    }

    const equippedDefaults = {
      weapon: null, bodyArmour: null, helmet: null, shield: null, utility: null,
      artifactWeapon: null, artifactArmour: null, artifactItem: null,
    };
    const equipped = Object.assign(equippedDefaults, hsu.equipped || {});

    const inventory = Array.isArray(hsu.inventory)
      ? hsu.inventory.map(it => ({ ...it }))
      : [];

    const variant = (heroVariants && HERO_VARIANTS.includes(heroVariants[id]))
      ? heroVariants[id]
      : 'male';
    heroes.push({
      id, name: proto.name, variant,
      bodyMax: proto.body,
      body: (hsu.body != null) ? hsu.body : proto.body,
      mindMax: proto.mind,
      mind: (hsu.mind != null) ? hsu.mind : proto.mind,
      attackBase: proto.attack, defendBase: proto.defend,
      attack: proto.attack, defend: proto.defend,
      at: [...at],
      gold: (hsu.gold != null) ? hsu.gold : 0,
      dead: false,
      spellHand,
      spellElements: [...elements],
      inventory,
      equipped,
      status: {
        skipNextTurn: false,
        doubleNextMovement: false,
        passWalls: false,
        passOccupants: false,
        rockSkin: false,
        courage: false,
        bonusDefendOnce: 0,
        bonusAttackOnce: 0,
        sleeping: false,
        doubleAttacksOneTurn: false,
        inPit: false,
      },
    });
  }
  return heroes;
}

// buildMonsters(quest, deps) → monsters[]. Needs MONSTER_TYPES.
function buildMonsters(quest, deps) {
  const { MONSTER_TYPES } = deps;
  // Quest data may override individual stats for any monster — useful
  // for named bosses (e.g. Fellmarg's mummy in Quest 1 rolls 4 Attack
  // dice instead of the 3 a regular mummy would).
  return (quest.monsters || []).map(m => {
    const proto = MONSTER_TYPES[m.type] || MONSTER_TYPES.goblin;
    const body = (m.body   != null) ? m.body   : proto.body;
    const mind = (m.mind   != null) ? m.mind   : proto.mind;
    const atk  = (m.attack != null) ? m.attack : proto.attack;
    const def  = (m.defend != null) ? m.defend : proto.defend;
    const mv   = (m.move   != null) ? m.move   : proto.move;
    return {
      id: m.id, type: m.type, name: m.name || null,
      bodyMax: body, body,
      mindMax: mind, mind,
      attack: atk, defend: def,
      moveSquares: mv,                     // fixed squares per turn (no roll)
      at: [...m.at], roomId: m.roomId || null,
      dead: false,
      active: false,
      status: { skipNextTurn: false, sleeping: false },
      tags: Array.isArray(m.tags) ? m.tags.slice() : (proto.tags ? proto.tags.slice() : []),
    };
  });
}

// buildTreasure(quest) → treasure[]. Pure.
function buildTreasure(quest) {
  return (quest.treasure || []).map(t => ({
    at: [...t.at], kind: t.kind, amount: t.amount, potion: t.potion, taken: false,
  }));
}

// buildTraps(quest) → traps[]. Pure.
function buildTraps(quest) {
  return (quest.traps || []).map((t, i) => ({
    id: t.id || `trap-${i}`,
    type: t.type,                 // 'spear' | 'pit' | 'block'
    at: [...t.at],
    direction: t.direction || null,
    revealed: false,
    triggered: false,
    disarmed: false,
  }));
}

// Furniture / chest traps — fire when a hero searches the room for
// treasure without first disarming them. `at` should be the cell of
// the chest or piece of furniture the trap is hidden in.
function buildFurnitureTraps(quest) {
  return (quest.furnitureTraps || []).map((t, i) => ({
    id: t.id || `ftrap-${i}`,
    kind: t.kind || 'poison-needle',
    at: [...t.at],
    damage: t.damage || 1,
    revealed: false,
    triggered: false,
    disarmed: false,
  }));
}

function buildSecretDoors(quest) {
  // 2021 rule: a discovered secret door is placed as a CLOSED tile —
  // hero must move adjacent and declare opening it before what's
  // behind is revealed. So we keep state 'closed' from build; the
  // search action just flips revealed=true and materialises the door
  // into s.doors so the standard open-door flow takes over.
  return (quest.secretDoors || []).map((d, i) => ({
    id: d.id || `secret-${i}`,
    a: [...d.a], b: [...d.b],
    revealed: false,
    state: 'closed',
  }));
}

// freshGameState(room, deps) — the only external entry point.
// Builds the runtime `state` object from `room.config.questId` and
// returns it (or `null` if the quest id doesn't resolve).
function freshGameState(room, deps) {
  const {
    MASTER_BOARD, quests, TREASURE_DECK_TEMPLATE, exploreFromHero,
  } = deps;
  const quest = quests.get(room.config.questId);
  if (!quest) return null;

  const board = buildBoardState(quest, deps);
  const heroes = buildHeroes(quest, room.seats, room.spellPick, room.heroVariants, deps);
  const monsters = buildMonsters(quest, deps);
  const treasure = buildTreasure(quest);
  const traps = buildTraps(quest);
  const furnitureTraps = buildFurnitureTraps(quest);
  const secretDoors = buildSecretDoors(quest);

  // Turn order: heroes in claim order, then GM
  const claimedHeroes = heroes.map(h => ({ kind: 'hero', heroId: h.id }));
  const turnOrder = [...claimedHeroes, { kind: 'gm' }];

  // Treasure deck — shuffled copy of the template
  const treasureDeck = shuffle([...TREASURE_DECK_TEMPLATE]);

  const state = {
    questId: quest.id,
    questTitle: quest.title,
    questIntro: quest.intro || '',
    objectiveText: quest.objective?.text || '',
    objective: quest.objective || null,
    // Optional rich form — array of named sub-objectives, each
    // independently checkable. Falls back to single-`objective` when
    // absent. The staircase-return step is auto-appended by
    // evaluateObjectives().
    objectives: Array.isArray(quest.objectives) ? quest.objectives.map(o => ({ ...o })) : null,
    defeat: quest.defeat || { kind: 'all-dead' },
    boardSize: quest.boardSize || (MASTER_BOARD ? MASTER_BOARD.boardSize : [26, 19]),
    wanderingMonster: quest.wanderingMonster || 'goblin',
    ...board,
    heroes, monsters, treasure, traps, furnitureTraps, secretDoors,
    treasureDeck, treasureDiscard: [],
    revealedTreasureCard: null,
    searchedTreasure: {},                // hero id -> { roomId: true }
    pendingSaveRoll: null,               // { heroId, options: [{ kind, idx, name }] }
    turnOrder, turnIdx: 0,
    movementRoll: null, movementUsed: 0, actionUsed: false,
    // 2021 rule: a hero may move-then-act OR act-then-move, but not
    // split (move part way, act, finish moving). We track whether
    // movement has been "locked" by an action that landed AFTER some
    // movement had already happened.
    movementLocked: false,
    spellsCastThisTurn: 0,
    combat: null,
    log: [],
    winner: null, winReason: '',
    objectiveMet: false,
    // Quests may specify stairCells explicitly; otherwise the start cells
    // double as the staircase. Heroes must return here after the objective
    // is met to officially complete the quest (2021 rules).
    stairCells: (quest.stairCells && quest.stairCells.length)
      ? quest.stairCells.map(c => [...c])
      : (quest.startCells || []).map(c => [...c]),
    // Structured stair groups (per-group cells + facing). Falls back
    // to a single 'downward' group built from stairCells/startCells if
    // the quest JSON doesn't carry the new shape yet (older quests).
    stairs: Array.isArray(quest.stairs)
      ? quest.stairs.map(s => ({
          cells: (s.cells || []).map(c => [...c]),
          facing: s.facing || 'downward',
        }))
      : null,
    _startCells: (quest.startCells || []).map(c => [...c]),
    // Debug overlays — show 1-based coords (L#T#) and / or room IDs.
    showCellCoords: !!quest.showCellCoords,
    showRoomIds: !!quest.showRoomIds,
  };

  // Initial fog-of-war reveal from each hero's start cell
  const tempRoom = { state };
  for (const h of heroes) exploreFromHero(tempRoom, h);

  // Also surface any quest-marked "starts revealed" rooms (the start room
  // for the heroes, typically) — these flag _initialHidden=false on tiles.
  for (const k of state.allTileKeys) {
    const t = state.tileMeta[k];
    if (t._initialHidden === false && t.hiddenFor.heroes) {
      // Force-reveal whole connected room
      if (t.roomId) {
        state.roomState[t.roomId].hiddenFor.heroes = false;
        for (const k2 of state.allTileKeys) {
          const t2 = state.tileMeta[k2];
          if (t2.roomId === t.roomId) t2.hiddenFor.heroes = false;
        }
      } else {
        t.hiddenFor.heroes = false;
      }
    }
  }
  return state;
}

module.exports = {
  buildBoardState,
  buildHeroes,
  buildMonsters,
  buildTreasure,
  buildTraps,
  buildFurnitureTraps,
  buildSecretDoors,
  freshGameState,
};
