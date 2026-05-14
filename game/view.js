// =====================================================================
// game/view.js — per-tab view projection
//
// `viewFor(room, token, deps)` builds the JSON payload the server
// broadcasts to one player. It's a pure projection: reads the room +
// state + deps, mutates nothing, returns the view object.
//
// Why deps are injected (not imported): viewFor needs the data
// tables loaded by server.js's `loadGameData()` (HEROES, SPELLS, …)
// and several helpers that touch room/state mutation (currentTurn,
// isMyTurn, spellDraftStatus, the effective-dice resolvers). Keeping
// those in server.js avoids pulling the state-mutating webs over
// here. The deps object is documented in game/view.md.
//
// See game/view.md for the full deps contract + state-shape.
// =====================================================================
'use strict';

const HQRules = require('../public/shared/rules.js');
const { key } = HQRules;
const { evaluateObjectives } = require('./objectives');

function viewFor(room, token, deps) {
  const {
    HEROES, MONSTER_TYPES, SPELLS, SPELLS_BY_ELEMENT, SPELL_ELEMENTS,
    seatsOf, currentTurn, isMyTurn,
    effectiveAttack, effectiveDefend,
    spellDraftStatus, questList,
  } = deps;

  const me = room.players.find(p => p.token === token);
  if (!me) return null;
  const seats = seatsOf(room, token);
  // Treat the debug "reveal entire map" toggle as if it were a GM view —
  // every fog-gated piece of state (tiles, doors, monsters, traps,
  // furniture, secret doors) flips to visible without changing each
  // gating call site individually.
  const isGMView = seats.isGM || room.phase === 'lobby' || !!room.config?.revealAll;

  // Project server-internal token-keyed structures through a public-id
  // mapping. Tokens are auth secrets and must NEVER be sent to peers —
  // any player who saw another's token could impersonate them.
  const tokenToPid = new Map(room.players.map(p => [p.token, p.pid]));
  const projectSeats = (src) => {
    const out = {};
    for (const k of Object.keys(src)) out[k] = src[k] ? (tokenToPid.get(src[k]) || null) : null;
    return out;
  };
  const baseView = {
    code: room.code,
    phase: room.phase,
    isHost: me.token === room.hostToken,
    youName: me.name,
    youPid: me.pid,
    heroIds: seats.heroIds,
    isGM: seats.isGM,
    config: room.config,
    seats: projectSeats(room.seats),
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, connected: p.connected, isBot: !!p.isBot,
      isHost: p.token === room.hostToken,
    })),
    quests: questList(),
    spellDraft: spellDraftStatus(room),
    heroVariants: { ...(room.heroVariants || {}) },
  };

  if (room.phase === 'lobby') {
    // Lobby-only metadata: lets the spell-draft picker show what each
    // element group contains without the client having to fetch /api/.
    baseView.spellsByElement = {};
    for (const el of SPELL_ELEMENTS) {
      baseView.spellsByElement[el] = (SPELLS_BY_ELEMENT[el] || []).map(sp => ({
        id: sp.id, name: sp.name,
      }));
    }
    return baseView;
  }

  // Build the gameplay view
  const s = room.state;
  const view = {
    ...baseView,
    questId: s.questId,
    questTitle: s.questTitle,
    questIntro: s.questIntro,
    objectiveText: s.objectiveText,
    objectives: evaluateObjectives(s),
    stairCells: (s.stairCells && s.stairCells.length) ? s.stairCells : (s._startCells || []),
    // Structured stair groups (with per-group facing) — new shape.
    // Renderers can fall back to grouping stairCells if `stairs` is
    // missing (older quests / runtime state pre-schema-bump).
    stairs: Array.isArray(s.stairs) ? s.stairs : null,
    showCellCoords: !!s.showCellCoords,
    showRoomIds: !!s.showRoomIds,
    // Furniture as discrete pieces with full footprints — the renderer
    // uses this to draw each multi-cell piece (table 2x1, tomb 2x1,
    // bookcase 2x1, etc) as ONE glyph spanning its bounding box, not
    // N tiled mini-glyphs. Fog rule: a piece appears only when at
    // least one of its cells is revealed (heroes); GM sees all.
    furniture: (s.furniturePieces || []).filter(f => {
      if (isGMView) return true;
      return f.cells.some(([x, y]) => {
        const t = s.tileMeta[`${x},${y}`];
        return t && !t.hiddenFor.heroes;
      });
    }),
    boardSize: s.boardSize,
    log: s.log.slice(-80),
    turnOrder: s.turnOrder,
    turnIdx: s.turnIdx,
    movementRoll: s.movementRoll,
    movementUsed: s.movementUsed,
    actionUsed: s.actionUsed,
    movementLocked: !!s.movementLocked,
    combat: s.combat,
    winner: s.winner,
    winReason: s.winReason,
  };

  // Tiles: GM sees all rooms (including hidden), heroes see only revealed.
  view.tiles = [];
  for (const k of s.allTileKeys) {
    const t = s.tileMeta[k];
    // Solid rock is NEVER visible — even GM and reveal-all should
    // see it as void (it's literally not part of this quest's board).
    const visible = !t.solidRock && (isGMView || !t.hiddenFor.heroes);
    view.tiles.push({
      x: t.x, y: t.y,
      kind: t.kind,                // 'corridor' | 'room'
      roomId: t.roomId,
      color: visible ? t.color : null,
      blocked: !!t.blocked,
      blockedKind: t.blocked ? (t.blockedKind || 'rubble') : null,
      revealed: visible,
      hasFurniture: visible ? t.furnitureId : null,
      furnitureType: visible ? (t.furnitureType || null) : null,
    });
  }

  // Doors
  view.doors = s.doors.map(d => ({
    a: d.a, b: d.b, state: d.state,
    revealed: isGMView || d.revealed,
    wasSecret: !!d.wasSecret,
  }));

  // Heroes always visible to all (they ARE the heroes)
  view.heroes = s.heroes.map(h => ({
    id: h.id, name: HEROES[h.id].name, glyph: HEROES[h.id].glyph, color: HEROES[h.id].color,
    variant: h.variant || 'male',
    at: h.at,
    body: h.body, bodyMax: h.bodyMax,
    mind: h.mind, mindMax: h.mindMax,
    attack: effectiveAttack(h, null), defend: effectiveDefend(h),
    attackBase: h.attackBase, defendBase: h.defendBase,
    gold: h.gold,
    dead: h.dead,
    seatToken: room.seats[h.id],
    spellHand: h.spellHand.map(id => ({ ...SPELLS[id], id })),
    inventory: h.inventory.map((it, idx) => ({ ...it, idx })),
    equipped: { ...h.equipped },
    status: { ...h.status },
  }));

  // Monsters: visible only if their room is revealed (or to GM)
  view.monsters = s.monsters.filter(m => !m.dead).map(m => {
    let reveal;
    if (isGMView) {
      reveal = true;
    } else if (m.roomId) {
      reveal = !s.roomState[m.roomId].hiddenFor.heroes;
    } else {
      // Corridor monster — reveal only if its specific tile has been
      // explored. Previously these were always shown to heroes, leaking
      // every corridor monster on the board through fog of war.
      const t = s.tileMeta[key(m.at[0], m.at[1])];
      reveal = !!(t && !t.hiddenFor.heroes);
    }
    if (!reveal) return null;
    return {
      id: m.id, type: m.type, name: m.name || MONSTER_TYPES[m.type]?.name || m.type,
      glyph: MONSTER_TYPES[m.type]?.glyph || '?',
      color: MONSTER_TYPES[m.type]?.color || '#888',
      at: m.at, body: m.body, bodyMax: m.bodyMax,
      attack: m.attack, defend: m.defend,
      active: m.active,
    };
  }).filter(Boolean);

  // Treasure: GM always sees; heroes see revealed-room treasure only
  view.treasure = s.treasure.filter(t => !t.taken).map(t => {
    const tile = s.tileMeta[key(t.at[0], t.at[1])];
    const reveal = isGMView || (tile && (!tile.hiddenFor.heroes));
    if (!reveal) return null;
    return { at: t.at, kind: t.kind, amount: t.amount, potion: t.potion };
  }).filter(Boolean);

  // Traps — GM sees all; heroes only see revealed traps in revealed rooms
  view.traps = (s.traps || []).filter(tr => !tr.disarmed && !tr.triggered).map(tr => {
    const tile = s.tileMeta[key(tr.at[0], tr.at[1])];
    const inRevealedRoom = tile && !tile.hiddenFor.heroes;
    if (!isGMView && (!inRevealedRoom || !tr.revealed)) return null;
    return { id: tr.id, type: tr.type, at: tr.at, revealed: tr.revealed, gmOnly: !tr.revealed };
  }).filter(Boolean);

  // Secret doors — only after found, or always for GM
  view.secretDoors = (s.secretDoors || []).map(d => {
    if (!isGMView && !d.revealed) return null;
    return { id: d.id, a: d.a, b: d.b, revealed: d.revealed, state: d.state };
  }).filter(Boolean);

  // Treasure deck pile size
  view.treasureDeckCount = s.treasureDeck ? s.treasureDeck.length : 0;
  view.revealedTreasureCard = s.revealedTreasureCard || null;
  // Pending drink-to-save decision (visible to everyone for awareness;
  // only the controlling seat gets a modal client-side).
  view.pendingSaveRoll = s.pendingSaveRoll || null;
  view.lostArtifacts = s.lostArtifacts || [];

  // Whose turn is it
  const cur = currentTurn(room);
  view.currentTurn = cur;
  view.myTurn = isMyTurn(room, token);

  return view;
}

module.exports = { viewFor };
