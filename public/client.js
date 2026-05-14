/* ==========================================================
   HEROQUEST — client
   Vanilla JS. Renders canvas board + DOM panels from server state.
   No framework, no build step.
   ========================================================== */

// ---------- WebSocket plumbing ----------
let ws;
let myToken = localStorage.getItem('hq_token') || null;
let myCode  = localStorage.getItem('hq_code')  || null;
let lastView = null;
let lastCombatTs = 0;
let selectedGMMonsterId = null;
let pendingSpell = null;  // { id, target } — when set, board clicks become spell-target picks
let lastTreasureCardKey = null;  // de-dupe the card-reveal modal per draw
let hoverCell = null;  // [x, y] currently under the cursor (for path preview / cost)
let lastReachable = null;  // Map "x,y" -> distance, recomputed each render

// Sprite assets — see public/client/sprites.js for the per-type filename
// table and PNG-loading internals. Names destructured here so the rest of
// client.js can keep using them unprefixed. The maps are mutable
// references, so as PNGs finish loading the sprite module mutates the
// same objects this file sees.
const {
  monsterSprites, heroSprites,
  HERO_NAMES, HERO_VARIANTS,
  variantKey, variantTokenURL, variantCardURL,
} = window.HQSprites;
window.HQSprites.load({
  onLoaded: () => { if (lastView) drawBoard(lastView); },
});

function wsURL() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function connect() {
  ws = new WebSocket(wsURL());
  ws.addEventListener('open', () => {
    if (myToken && myCode) {
      send({ type: 'rejoin', token: myToken, code: myCode });
    }
  });
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    handleServerMessage(m);
  });
  ws.addEventListener('close', () => {
    setTimeout(connect, 1500);
  });
  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function action(name, extra = {}) {
  send({ type: 'action', action: name, ...extra });
}

function handleServerMessage(m) {
  if (m.type === 'joined') {
    myToken = m.token; myCode = m.code;
    localStorage.setItem('hq_token', myToken);
    localStorage.setItem('hq_code',  myCode);
    return;
  }
  if (m.type === 'error') {
    showError(m.message);
    return;
  }
  if (m.type === 'state') {
    applyState(m.state);
  }
}

// ---------- Screens / state apply ----------
const $welcome = document.getElementById('screen-welcome');
const $lobby   = document.getElementById('screen-lobby');
const $game    = document.getElementById('screen-game');

function showScreen(which) {
  for (const el of [$welcome, $lobby, $game]) el.classList.add('hidden');
  if (which === 'welcome') $welcome.classList.remove('hidden');
  if (which === 'lobby')   $lobby.classList.remove('hidden');
  if (which === 'game')    $game.classList.remove('hidden');
}

function applyState(view) {
  if (!view) {
    // We were dropped from the room
    localStorage.removeItem('hq_token'); localStorage.removeItem('hq_code');
    myToken = null; myCode = null;
    showScreen('welcome');
    return;
  }
  lastView = view;
  if (view.phase === 'lobby') {
    showScreen('lobby');
    HQLobby.render(view);
    HQAudio.reset();                 // reset when we leave a game
  } else {
    showScreen('game');
    initGameUIChrome();
    renderGame(view);
    HQAudio.fireSfxFromView(view);
  }
}

function showError(message) {
  // Shown on welcome and as transient toast on game screens
  const wEl = document.getElementById('welcome-error');
  if (!$welcome.classList.contains('hidden')) {
    wEl.textContent = message;
    wEl.classList.remove('hidden');
    setTimeout(() => wEl.classList.add('hidden'), 4000);
  } else {
    const lobbyMsg = document.getElementById('lobby-msg');
    if (lobbyMsg && !$lobby.classList.contains('hidden')) {
      lobbyMsg.textContent = message;
      lobbyMsg.style.color = '#b22222';
      setTimeout(() => { lobbyMsg.textContent = ''; lobbyMsg.style.color = ''; }, 3500);
    } else {
      // Game screen — log to console; we could add a toast later
      console.warn('[server]', message);
    }
  }
}

// ---------- Welcome handlers ----------
document.getElementById('form-create').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('create-name').value.trim();
  if (!name) return;
  // Reset any old session
  localStorage.removeItem('hq_token'); localStorage.removeItem('hq_code');
  myToken = null; myCode = null;
  send({ type: 'create', name });
});

document.getElementById('form-join').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name || !code) return;
  localStorage.removeItem('hq_token'); localStorage.removeItem('hq_code');
  myToken = null; myCode = null;
  send({ type: 'join', name, code });
});

document.getElementById('btn-leave').addEventListener('click', () => {
  send({ type: 'leave' });
  localStorage.removeItem('hq_token'); localStorage.removeItem('hq_code');
  myToken = null; myCode = null;
  showScreen('welcome');
});

// ---------- Lobby ----------
// renderLobby + the spell-draft picker + seat badge / variant helpers
// + makeTag + all the lobby form-control listeners live in
// public/client/lobby.js. Wire the listeners once at boot; applyState
// calls HQLobby.render(view) on each 'lobby' phase view.
HQLobby.init({ send, getLastView: () => lastView });

// Panel collapse + rails toggle + Options ⚙ menu + the floor/light/outer-walls
// preference state all live in public/client/options.js — exposes
// window.HQOptions. Init once at boot; initGameUIChrome wires the
// game-screen chrome on first 'game' render.
HQOptions.init({ send, getLastView: () => lastView, drawBoard: (v) => drawBoard(v) });

function initGameUIChrome() {
  HQOptions.mountPanelCollapse();
  HQOptions.applyRailsHidden(localStorage.getItem(HQOptions.RAILS_STATE_KEY) === '1');
  HQOverlays.mountHandOverlays();
  HQOptions.mountOptionsMenu();
}

// Hand overlays + mobile tabs live in public/client/overlays.js — exposes
// window.HQOverlays.{mountHandOverlays, mountMobileTabs, setMobileTab}.

// ---------- Game render ----------
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const CELL = 32;

// Camera — auto-fit + center the explored area inside the fixed-size canvas
// so a small visible patch doesn't render as a tiny island in a black ocean.
// The transform is applied in drawBoard via ctx.setTransform; both hit-test
// paths (mousemove + click) invert it via screenToCell().
let camera = { scale: 1, offsetX: 0, offsetY: 0 };

function computeCamera(view) {
  const [W, H] = view.boardSize;
  const canvasW = W * CELL;
  const canvasH = H * CELL;

  // Bounding box of "interesting" content: revealed tiles + living heroes
  // (heroes are always interesting even before tiles around them reveal).
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (const t of view.tiles || []) {
    if (!t.revealed) continue;
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
  }
  for (const h of view.heroes || []) {
    if (!h || h.dead || !h.at) continue;
    if (h.at[0] < minX) minX = h.at[0];
    if (h.at[1] < minY) minY = h.at[1];
    if (h.at[0] > maxX) maxX = h.at[0];
    if (h.at[1] > maxY) maxY = h.at[1];
  }
  // Fallback: nothing revealed yet — show the whole board
  if (maxX < 0) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }

  // Pad by 1 cell so heroes aren't pinned to the canvas edge
  minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
  maxX = Math.min(W - 1, maxX + 1); maxY = Math.min(H - 1, maxY + 1);

  const bboxW = (maxX - minX + 1) * CELL;
  const bboxH = (maxY - minY + 1) * CELL;

  // Pick a uniform scale that fits the bbox; cap so cells don't get cartoonish
  const scale = Math.min(canvasW / bboxW, canvasH / bboxH, 2.4);

  // Center the bbox inside the canvas
  const offsetX = (canvasW - bboxW * scale) / 2 - minX * CELL * scale;
  const offsetY = (canvasH - bboxH * scale) / 2 - minY * CELL * scale;

  return { scale, offsetX, offsetY };
}

// Convert a mouse event's pixel coords to a board cell, accounting for
// canvas DPR scaling AND the camera transform.
function screenToCell(e) {
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (canvas.width / r.width);
  const py = (e.clientY - r.top)  * (canvas.height / r.height);
  const wx = (px - camera.offsetX) / camera.scale;
  const wy = (py - camera.offsetY) / camera.scale;
  return [Math.floor(wx / CELL), Math.floor(wy / CELL)];
}

function renderGame(view) {
  // Header
  document.getElementById('game-quest-title').textContent = view.questTitle;
  document.getElementById('game-quest-objective').textContent = view.objectiveText || '';

  // R5: the centred turn-banner element is gone — whose-turn is now the
  // gold ring on the active hero card in the left rail. The block below
  // is null-safe so it tolerates the missing element. (If we ever
  // re-introduce a banner we just have to re-add the markup.)
  const turn = view.currentTurn;
  const tb = document.getElementById('turn-banner');
  if (tb) {
    let banner = '—';
    if (view.phase === 'end') {
      banner = view.winner === 'heroes' ? 'VICTORY' : 'DEFEAT';
    } else if (turn?.kind === 'hero') {
      const h = view.heroes.find(x => x.id === turn.heroId);
      banner = `${h ? h.name : '—'}'s turn`;
    } else if (turn?.kind === 'gm') {
      banner = view.config.gmMode === 'ai' ? 'Zargon (AI) thinks…' : 'Zargon (GM)';
    }
    tb.textContent = banner;
    tb.classList.toggle('my-turn', !!view.myTurn);
  }

  // Hero strip
  renderHeroStrip(view);

  // Header buttons (End Turn + Leave) — always-visible chrome
  renderHeaderButtons(view);

  // Turn controls
  renderTurnControls(view);

  // Objectives checklist (left rail)
  renderObjectives(view);

  // Log
  HQSidebar.renderLog(view);

  // Treasure deck badge — number of cards remaining on top of the deck back.
  const tcCount = document.getElementById('treasure-deck-count');
  if (tcCount) tcCount.textContent = (view.treasureDeckCount != null) ? view.treasureDeckCount : '—';
  const tcCap = document.getElementById('treasure-deck-caption-count');
  if (tcCap) tcCap.textContent = (view.treasureDeckCount != null) ? view.treasureDeckCount : '—';

  // Sync the ⚙ options menu state (rails hidden, Zargon speed)
  HQOptions.syncFromView(view);

  // Board
  drawBoard(view);

  // Combat modal
  if (view.combat && view.combat.ts !== lastCombatTs) {
    lastCombatTs = view.combat.ts;
    HQModals.showCombatModal(view.combat);
  }

  // Treasure card reveal modal
  const tcKey = view.revealedTreasureCard
    ? `${view.revealedTreasureCard.drawnBy}-${view.revealedTreasureCard.id}-${view.log.length}`
    : null;
  if (tcKey && tcKey !== lastTreasureCardKey) {
    lastTreasureCardKey = tcKey;
    HQModals.showTreasureCardModal(view.revealedTreasureCard);
  }

  // Drink-to-save modal — appears when one of OUR heroes is at 0 Body
  // and has multiple healing potions. Only the seat that controls the
  // falling hero gets the modal.
  const sm = document.getElementById('save-modal');
  if (sm) {
    if (view.pendingSaveRoll && (view.heroIds || []).includes(view.pendingSaveRoll.heroId)) {
      const h = view.heroes.find(x => x.id === view.pendingSaveRoll.heroId);
      document.getElementById('save-title').textContent = `${h ? h.name : 'A hero'} is down!`;
      document.getElementById('save-prompt').textContent = 'Drink a potion to survive, or accept death.';
      const opts = document.getElementById('save-options');
      opts.innerHTML = '';
      for (const o of view.pendingSaveRoll.options) {
        const b = document.createElement('button');
        b.className = 'primary';
        b.style.marginTop = '8px'; b.style.display = 'block'; b.style.width = '100%';
        b.textContent = `Drink ${o.name}`;
        b.addEventListener('click', () => {
          send({ type: 'action', action: 'choosePotion', idx: o.idx });
        });
        opts.appendChild(b);
      }
      sm.classList.remove('hidden');
    } else {
      sm.classList.add('hidden');
    }
  }

  // End modal
  const endModal = document.getElementById('end-modal');
  if (view.phase === 'end') {
    document.getElementById('end-title').textContent = view.winner === 'heroes' ? 'VICTORY' : 'DEFEAT';
    document.getElementById('end-title').className = view.winner === 'heroes' ? 'victory' : 'defeat';
    document.getElementById('end-reason').textContent = view.winReason || '';
    endModal.classList.remove('hidden');
    document.getElementById('btn-restart').classList.toggle('hidden', !view.isHost);
  } else {
    endModal.classList.add('hidden');
    document.getElementById('btn-restart').classList.add('hidden');
  }
}

// One horizontal strip showing the four phases of a hero turn:
//   Roll  ›  Move  ›  Action  ›  End
// Each step lights up based on game state. Replaces three scattered
// labels (turn banner annotation, "(locked)" tag, "(act-first)" tag)
// with a single source of truth.
function pipelineState(view) {
  const rolled = view.movementRoll != null;
  const moveLocked = !!view.movementLocked;
  const moveExhausted = rolled && view.movementUsed >= view.movementRoll;
  const acted = !!view.actionUsed;

  const roll   = rolled ? 'done' : 'active';
  let move;
  if (!rolled)             move = 'pending';
  else if (moveLocked)     move = 'locked';
  else if (moveExhausted)  move = 'done';
  else                     move = 'active';
  const actionStep = acted ? 'done' : 'active';
  const end = (acted && (move === 'done' || move === 'locked')) ? 'active' : 'pending';
  return { roll, move, action: actionStep, end };
}

function renderTurnPipeline(view) {
  const st = pipelineState(view);
  const wrap = document.createElement('div');
  wrap.className = 'turn-pipeline';
  const steps = [
    { id: 'roll',   label: 'Roll',   state: st.roll },
    { id: 'move',   label: 'Move',   state: st.move },
    { id: 'action', label: 'Action', state: st.action },
    { id: 'end',    label: 'End',    state: st.end },
  ];
  for (const s of steps) {
    const d = document.createElement('div');
    d.className = `step ${s.state}`;
    d.textContent = s.label;
    if (s.state === 'locked') d.title = 'Movement locked — you acted after moving (no split allowed).';
    if (s.state === 'pending') d.title = 'Not yet reachable.';
    if (s.state === 'active') d.title = 'Current step.';
    wrap.appendChild(d);
  }
  return wrap;
}

// Render the live objective checklist into #objectives-list. The view
// carries `objectives: [{id, text, done, optional, locked}]` from the
// server (see evaluateObjectives()) — this just paints them.
function renderObjectives(view) {
  const ul = document.getElementById('objectives-list');
  if (!ul) return;
  ul.innerHTML = '';
  const list = view && Array.isArray(view.objectives) ? view.objectives : [];
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'locked';
    li.innerHTML = '<span class="obj-box">·</span><span class="obj-text">No objective set.</span>';
    ul.appendChild(li);
    return;
  }
  for (const o of list) {
    const li = document.createElement('li');
    if (o.done)     li.classList.add('done');
    if (o.locked && !o.done) li.classList.add('locked');
    if (o.optional) li.classList.add('optional');
    const box = document.createElement('span');
    box.className = 'obj-box';
    box.textContent = o.done ? '✓' : (o.locked ? '·' : '☐');
    const txt = document.createElement('span');
    txt.className = 'obj-text';
    txt.textContent = o.text;
    li.appendChild(box);
    li.appendChild(txt);
    ul.appendChild(li);
  }
}

// Render N glyphs of a stat — `filled` count solid, `(max - filled)` hollow.
// Caps the count at maxRender so a hero with 14 Body doesn't blow up the row.
function renderGlyphRow(filled, max, glyphSolid, glyphHollow, maxRender = 8) {
  const cap = Math.min(max, maxRender);
  let html = '';
  for (let i = 0; i < cap; i++) {
    if (i < filled) html += glyphSolid;
    else html += `<span class="hollow">${glyphHollow}</span>`;
  }
  if (max > maxRender) html += ` ${filled}/${max}`;
  return html;
}

// R5: heroes now live in a vertical strip on the left rail. Each hero
// becomes a stacked card: top row = token + name; lower rows = body
// hearts + mind stars + attack/defend/gold. Active hero gets a gold
// ring (replacing the centre turn banner).
function renderHeroStrip(view) {
  const el = document.getElementById('hero-strip');
  if (!el) return;
  el.innerHTML = '';
  const cur = view.currentTurn;
  for (const h of view.heroes) {
    const card = document.createElement('div');
    card.className = 'hero-card-v';
    if (cur?.kind === 'hero' && cur.heroId === h.id) card.classList.add('current');
    if (h.dead) card.classList.add('dead');

    const row1 = document.createElement('div');
    row1.className = 'row1';
    const badge = document.createElement('span');
    badge.className = 'hero-badge';
    badge.style.setProperty('--badge-bg', h.color);
    badge.setAttribute('data-glyph', h.glyph);
    // Use the variant-specific token if one loaded; falls back to glyph.
    const variantSprite = heroSprites[variantKey(h.id, h.variant || 'male')];
    if (variantSprite && variantSprite.src) {
      badge.style.backgroundImage = `url("${variantSprite.src}")`;
      badge.style.backgroundSize = 'cover';
      badge.style.backgroundPosition = 'center';
      badge.classList.add('with-token');
    }
    row1.appendChild(badge);
    const name = document.createElement('span');
    name.className = 'hero-name';
    name.textContent = h.name;
    row1.appendChild(name);
    card.appendChild(row1);

    const heartsHTML = renderGlyphRow(h.body, h.bodyMax, '♥', '♡', 8);
    const starsHTML  = renderGlyphRow(h.mind, h.mindMax, '★', '☆', 6);
    const line1 = document.createElement('div');
    line1.className = 'stat-line';
    line1.innerHTML =
      `<span class="stat-hearts" title="Body ${h.body}/${h.bodyMax}">${heartsHTML}</span>` +
      ` <span class="stat-stars" title="Mind ${h.mind}/${h.mindMax}">${starsHTML}</span>`;
    card.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'stat-line';
    line2.innerHTML =
      `<span class="stat-ad" title="Attack / Defend dice">A${h.attack} D${h.defend}</span>` +
      ` · <span class="gold">${h.gold}g</span>`;
    card.appendChild(line2);

    // Status badges — inline below the stats
    const stat = h.status || {};
    const tags = [];
    if (stat.rockSkin)     tags.push(['rs', 'Rock Skin']);
    if (stat.courage)      tags.push(['cr', 'Courage']);
    if (stat.sleeping)     tags.push(['sl', 'Asleep']);
    if (stat.skipNextTurn) tags.push(['sk', 'Skip']);
    if (tags.length) {
      const t = document.createElement('div');
      t.className = 'status-tags';
      for (const [c, lbl] of tags) {
        const x = document.createElement('span');
        x.className = `tag tag-${c}`;
        x.textContent = lbl;
        t.appendChild(x);
      }
      card.appendChild(t);
    }

    el.appendChild(card);
  }
}

function onSpellClick(spell, hero, view) {
  // Some spells have a fixed self target — fire immediately
  if (spell.target === 'self') {
    sendCast(spell.id, { kind: 'hero', id: hero.id });
    return;
  }
  // Some spells (heal/buffs) can target any ally — for simplicity prompt with hero list
  if (spell.target === 'ally') {
    const targetId = pickHeroTarget(view, spell);
    if (targetId) sendCast(spell.id, { kind: 'hero', id: targetId });
    return;
  }
  // Otherwise enter board-pick mode
  pendingSpell = { id: spell.id, target: spell.target };
  renderGame(view);
  drawBoard(view);
}

function pickHeroTarget(view, spell) {
  const alive = view.heroes.filter(h => !h.dead);
  if (alive.length === 1) return alive[0].id;
  const names = alive.map((h, i) => `${i + 1}. ${h.name}`).join('\n');
  const choice = prompt(`Cast ${spell.name} on which hero?\n${names}\nEnter a number:`);
  const idx = parseInt(choice, 10) - 1;
  return Number.isInteger(idx) && alive[idx] ? alive[idx].id : null;
}

function sendCast(spellId, target) {
  send({ type: 'action', action: 'castSpell', spellId, target });
  pendingSpell = null;
}

// Update the header End-Turn + Leave buttons. End-Turn glows when the
// pipeline says "End" is the next step; disabled on non-myTurn / non-hero
// turns / quest end. Leave is always clickable.
function renderHeaderButtons(view) {
  const endBtn = document.getElementById('btn-end-turn-header');
  const leaveBtn = document.getElementById('btn-leave-game');
  if (endBtn) {
    const cur = view.currentTurn;
    const myHeroTurn = view.myTurn && cur?.kind === 'hero' && view.phase !== 'end';
    endBtn.disabled = !myHeroTurn;
    const ready = myHeroTurn && pipelineState(view).end === 'active';
    endBtn.classList.toggle('ready', ready);
    if (!endBtn._wired) {
      endBtn.addEventListener('click', () => {
        if (!endBtn.disabled) action('endTurn');
      });
      endBtn._wired = true;
    }
  }
  if (leaveBtn && !leaveBtn._wired) {
    leaveBtn.addEventListener('click', () => {
      if (confirm('Leave this quest and return to the lobby? Progress on this quest will be lost.')) {
        send({ type: 'leaveQuest' });
      }
    });
    leaveBtn._wired = true;
  }
  const speedBtn = document.getElementById('btn-ai-speed');
  if (speedBtn) {
    const speed = Math.max(1, Math.min(4, view.config?.aiSpeed || 1));
    speedBtn.textContent = `Zargon ×${speed}`;
    if (!speedBtn._wired) {
      speedBtn.addEventListener('click', () => {
        const cur = Math.max(1, Math.min(4, lastView?.config?.aiSpeed || 1));
        const next = cur >= 4 ? 1 : cur + 1;
        send({ type: 'setAiSpeed', value: next });
      });
      speedBtn._wired = true;
    }
  }
}

// R5: a single inline pill that stands in for the action toolbar when
// it isn't the player's turn ("Waiting for Dwarf…", "Quest over",
// "Zargon (AI) is acting"). Renders into #turn-controls-body so the
// strip stays a single visual line.
function makeStripStatus(text, opts) {
  const el = document.createElement('div');
  el.className = 'strip-status' + (opts && opts.myTurn ? ' my-turn' : '');
  el.textContent = text;
  return el;
}

function renderTurnControls(view) {
  const el = document.getElementById('turn-controls-body');
  el.innerHTML = '';
  // Always update the spells/items panes too — they're now their own tabs.
  HQSidebar.renderSpells(view);
  HQSidebar.renderItems(view);
  HQSidebar.updateTabCounts(view);
  const cur = view.currentTurn;
  const strip = document.getElementById('header-actions-strip');
  if (strip) strip.classList.remove('actions-strip-mine', 'actions-strip-other', 'actions-strip-end');

  if (view.phase === 'end') {
    if (strip) strip.classList.add('actions-strip-end', 'actions-strip-other');
    el.appendChild(makeStripStatus('Quest over'));
    return;
  }

  if (cur?.kind === 'hero') {
    const h = view.heroes.find(x => x.id === cur.heroId);
    if (!view.myTurn) {
      if (strip) strip.classList.add('actions-strip-other');
      el.appendChild(makeStripStatus(`Waiting for ${h ? h.name : '—'}…`));
      return;
    }
    if (strip) strip.classList.add('actions-strip-mine');

    // Turn-state pipeline — at-a-glance status of the four phases.
    el.appendChild(renderTurnPipeline(view));

    if (view.movementRoll == null) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Roll Movement (2d6)';
      btn.addEventListener('click', () => action('rollMovement'));
      el.appendChild(btn);
    } else {
      const display = document.createElement('div');
      display.className = 'roll-display';
      const used = view.movementUsed, total = view.movementRoll;
      const remaining = total - used;
      const cls = remaining > 0 ? 'avail' : 'spent';
      display.innerHTML = `Move: <strong class="${cls}">${used}<span class="slash"> / </span>${total}</strong>`;
      el.appendChild(display);
    }

    // Action row — six hero actions per the 2021 rulebook (Search Traps
    // and Search Secret Doors are now distinct).
    const row = document.createElement('div');
    row.className = 'action-row';

    const inRoom = view.tiles.find(t => t.x === h.at[0] && t.y === h.at[1] && t.kind === 'room');

    // Rule-name tooltips: when a search is unavailable, the title spells
    // out the rule (Godin's "make the invisible rules-correctness
    // visible"). Tabletop rule pointers help fans trust the engine.
    const monstersInRoom = inRoom && view.monsters.some(m => m.at && view.tiles.some(t => t.x === m.at[0] && t.y === m.at[1] && t.roomId === inRoom.roomId));

    const stBtn = document.createElement('button');
    stBtn.className = 'ghost';
    stBtn.textContent = 'Treasure';
    stBtn.disabled = view.actionUsed || !inRoom || monstersInRoom;
    stBtn.title = !inRoom
      ? 'Search Treasure works in rooms only, not corridors.'
      : monstersInRoom
        ? 'Cannot Search Treasure — monsters still in this room.'
        : view.actionUsed
          ? 'Action already used this turn.'
          : 'Search the room for treasure (each hero only once per room).';
    stBtn.addEventListener('click', () => action('searchTreasure'));
    row.appendChild(stBtn);

    const tBtn = document.createElement('button');
    tBtn.className = 'ghost';
    tBtn.textContent = 'Traps';
    tBtn.disabled = view.actionUsed || !inRoom;
    tBtn.title = !inRoom
      ? 'Search Traps works in rooms or corridors.'
      : view.actionUsed
        ? 'Action already used this turn.'
        : 'Search for traps. Refused if any monster is in line of sight.';
    tBtn.addEventListener('click', () => action('searchTraps'));
    row.appendChild(tBtn);

    const dBtn = document.createElement('button');
    dBtn.className = 'ghost';
    dBtn.textContent = 'Secrets';
    dBtn.disabled = view.actionUsed || !inRoom;
    dBtn.title = !inRoom
      ? 'Search Secret Doors works in rooms only.'
      : view.actionUsed
        ? 'Action already used this turn.'
        : 'Search for secret doors. Refused if any monster is in line of sight. Discovered doors must still be opened (free) before what is beyond is revealed.';
    dBtn.addEventListener('click', () => action('searchSecretDoors'));
    row.appendChild(dBtn);

    el.appendChild(row);

    // Jump-trap button — when standing adjacent to a discovered trap
    // with at least 2 movement remaining and a free cell beyond it.
    if (view.movementRoll != null) {
      const remaining = view.movementRoll - view.movementUsed;
      if (remaining >= 2) {
        const jumpable = (view.traps || []).filter(tr => {
          if (!tr.revealed) return false;
          if (Math.abs(tr.at[0]-h.at[0]) + Math.abs(tr.at[1]-h.at[1]) !== 1) return false;
          // beyond cell must exist and be in line
          const dx = tr.at[0]-h.at[0], dy = tr.at[1]-h.at[1];
          const beyond = [tr.at[0]+dx, tr.at[1]+dy];
          const tt = view.tiles.find(t => t.x === beyond[0] && t.y === beyond[1] && t.revealed);
          if (!tt || tt.hasFurniture) return false;
          return true;
        });
        if (jumpable.length > 0) {
          const jr = document.createElement('div');
          jr.className = 'action-row';
          for (const tr of jumpable) {
            const dx = tr.at[0]-h.at[0], dy = tr.at[1]-h.at[1];
            const beyond = [tr.at[0]+dx, tr.at[1]+dy];
            const b = document.createElement('button');
            b.className = 'ghost';
            b.textContent = `Jump ${tr.type} trap`;
            b.title = '1 die, no skull = jump (2 MP); skull = sprung.';
            b.addEventListener('click', () => {
              send({ type: 'action', action: 'jumpTrap', trapId: tr.id, target: beyond });
            });
            jr.appendChild(b);
          }
          el.appendChild(jr);
        }
      }
    }

    // Give-item picker — only when an ally is adjacent and we have
    // something to hand over (potion in inventory or an artifact).
    const adjAlly = (view.heroes || []).find(o =>
      o.id !== h.id && !o.dead &&
      Math.abs(o.at[0]-h.at[0]) + Math.abs(o.at[1]-h.at[1]) === 1
    );
    const givables = [];
    (h.inventory || []).forEach((it, idx) => givables.push({ kind: 'inventory', idx, name: it.name }));
    for (const slot of ['artifactWeapon','artifactArmour','artifactItem']) {
      if (h.equipped && h.equipped[slot]) {
        const a = h.equipped[slot];
        givables.push({ kind: 'artifact', slot, name: a });
      }
    }
    if (adjAlly && givables.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'panel-sub';
      heading.textContent = `Give to ${adjAlly.name}`;
      el.appendChild(heading);
      for (const g of givables) {
        const b = document.createElement('button');
        b.className = 'inv-row';
        b.textContent = `→ ${g.name}`;
        b.addEventListener('click', () => {
          send({
            type: 'action', action: 'giveItem', toHeroId: adjAlly.id,
            itemIndex: g.idx, itemKind: g.kind,
          });
        });
        el.appendChild(b);
      }
    }

    // Open-door shortcuts — opening an adjacent revealed-but-closed door
    // is FREE (no MP, no action). Per the 2021 rule, you "may move
    // adjacent to a closed door and ask Zargon to open it." We surface
    // any such doors as direction-labelled buttons.
    const adjDoors = (view.doors || []).filter(d => {
      if (d.state !== 'closed' || !d.revealed) return false;
      return (d.a[0] === h.at[0] && d.a[1] === h.at[1]) ||
             (d.b[0] === h.at[0] && d.b[1] === h.at[1]);
    });
    if (adjDoors.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'panel-sub';
      heading.textContent = 'Adjacent doors';
      el.appendChild(heading);
      const dr = document.createElement('div');
      dr.className = 'action-row';
      for (const d of adjDoors) {
        // Compute the cell on the OTHER side of the door from the hero.
        const onA = (d.a[0] === h.at[0] && d.a[1] === h.at[1]);
        const other = onA ? d.b : d.a;
        const dx = other[0] - h.at[0], dy = other[1] - h.at[1];
        let dir = '';
        if (dy < 0) dir = 'north';
        else if (dy > 0) dir = 'south';
        else if (dx < 0) dir = 'west';
        else dir = 'east';
        const b = document.createElement('button');
        b.className = 'ghost';
        b.textContent = `Open door (${dir})`;
        b.title = 'Free — costs no movement or action.';
        b.addEventListener('click', () => {
          send({ type: 'action', action: 'openDoor', a: d.a, b: d.b });
        });
        dr.appendChild(b);
      }
      el.appendChild(dr);
    }

    // Spell hand + inventory now live in their own sidebar tabs — see
    // renderSpellsPane and renderItemsPane. The Actions tab stays focused
    // on TURN-FLOW only: pipeline + roll + search + adjacent doors + give.

    const help = document.createElement('p');
    help.className = 'muted small';
    help.style.margin = '0';
    if (pendingSpell) {
      help.textContent = `Casting ${pendingSpell.id}. Click a valid target.`;
      help.style.color = '#6b1010';
    } else if (view.actionUsed) {
      help.textContent = 'Action used — move, then End Turn.';
    } else if (view.movementRoll == null) {
      // Show the verbose hint only before the first roll. After that,
      // the player has figured it out — the text becomes noise.
      help.textContent = 'Click to move · click a monster to attack.';
    } else {
      help.textContent = '';
    }
    el.appendChild(help);
    return;
  }

  // Fallback when there is no current turn yet (e.g. quest just started
   // before the server set turnIdx) — show a neutral placeholder so the
   // strip is never blank.
  if (!cur) {
    if (strip) strip.classList.add('actions-strip-other');
    el.appendChild(makeStripStatus('Quest starting…'));
    return;
  }

  if (cur?.kind === 'gm') {
    if (view.config.gmMode === 'ai') {
      if (strip) strip.classList.add('actions-strip-other');
      el.appendChild(makeStripStatus('Zargon (AI) is acting…'));
      return;
    }
    if (!view.myTurn) {
      if (strip) strip.classList.add('actions-strip-other');
      el.appendChild(makeStripStatus('Zargon (GM) is moving monsters…'));
      return;
    }
    if (strip) strip.classList.add('actions-strip-mine');
    // Pick a monster to act with
    const activeMonsters = view.monsters.filter(m => m.active);
    if (activeMonsters.length === 0) {
      const endBtn = document.createElement('button');
      endBtn.className = 'end-turn';
      endBtn.textContent = 'End Turn (no active monsters)';
      endBtn.addEventListener('click', () => send({ type: 'action', action: 'gmEndTurn' }));
      el.appendChild(endBtn);
      return;
    }
    const help = document.createElement('p');
    help.className = 'muted small';
    help.style.margin = '0';
    help.textContent = 'Pick a monster, then click an adjacent square to move or a hero to attack.';
    el.appendChild(help);

    for (const m of activeMonsters) {
      const b = document.createElement('button');
      b.className = 'ghost';
      b.textContent = `${m.name} @ (${m.at[0]},${m.at[1]})`;
      if (selectedGMMonsterId === m.id) b.style.background = '#c5a14e';
      b.addEventListener('click', () => {
        selectedGMMonsterId = m.id;
        renderGame(lastView);
        drawBoard(lastView);
      });
      el.appendChild(b);
    }

    const endBtn = document.createElement('button');
    endBtn.className = 'end-turn';
    endBtn.textContent = 'End GM Turn';
    endBtn.addEventListener('click', () => send({ type: 'action', action: 'gmEndTurn' }));
    el.appendChild(endBtn);
    return;
  }
}

// Sidebar tab panes (Spells / Items / Log) live in public/client/sidebar.js.
// Public surface: HQSidebar.renderSpells / .renderItems / .renderLog /
// .updateTabCounts / .setSidebarTab. Init wires the tab switcher + stores
// the cross-module callbacks (pendingSpell, onSpellClick, action).
HQSidebar.init({
  getPendingSpell: () => pendingSpell,
  onSpellClick:    (sp, h, view) => onSpellClick(sp, h, view),
  action,
});

// Floor texture overlay lives in public/client/textures.js — exposes
// window.HQTextures. Wire deps once; drawFloorTextures is then called
// from drawBoard.
HQTextures.init({
  ctx, CELL,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
  isEnabled:   () => HQOptions.floorTexturesOn(),
});
HQFurnitureDraw.init({ ctx, CELL });
HQEntityDraw.init({
  ctx, CELL,
  sprites: { monsterSprites, heroSprites, variantKey },
  drawTileIcon: HQFurnitureArt.drawTileIcon,
});

// ---------- Canvas: board drawing ----------
function tileMap(view) {
  const m = new Map();
  for (const t of view.tiles) m.set(`${t.x},${t.y}`, t);
  return m;
}

function drawBoard(view) {
  if (!view) return;
  const [W, H] = view.boardSize;
  // Resize canvas if needed
  if (canvas.width !== W * CELL) canvas.width = W * CELL;
  if (canvas.height !== H * CELL) canvas.height = H * CELL;

  // 1. Clear background WITHOUT transform so the void fills the whole
  // canvas. Pure black so the play frame sits on a true void backdrop.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Compute & apply camera so all subsequent x*CELL draws auto-fit
  camera = computeCamera(view);
  ctx.setTransform(camera.scale, 0, 0, camera.scale, camera.offsetX, camera.offsetY);

  const tm = tileMap(view);
  // Pre-pass: identify horizontal rubble pairs so we render them as
  // ONE wider sprite (DoubleBlockedSquare.png) instead of two adjacent
  // 1×1 tiles. The right-half cell is recorded so its render iteration
  // skips drawing the rubble icon — the wider sprite already covers it.
  // IMPORTANT: only revealed cells count. Out-of-play `solidRock` cells
  // are marked `blocked: true` server-side too (to block movement) but
  // they are never revealed; we must not let them trigger a merge with
  // an adjacent real rubble tile, otherwise a single rubble against the
  // map edge renders as a phantom double.
  const rubblePairRights = new Set();
  for (const t of view.tiles) {
    if (!t.blocked || !t.revealed) continue;
    const left = tm.get(`${t.x - 1},${t.y}`);
    if (left && left.revealed && left.blocked &&
        (left.blockedKind || 'rubble') === (t.blockedKind || 'rubble')) {
      rubblePairRights.add(`${t.x},${t.y}`);
    }
  }
  // Draw tiles (revealed only — hidden tiles stay as void)
  for (const t of view.tiles) {
    if (!t.revealed) continue;
    drawTile(t, tm, rubblePairRights);
  }
  // Optional per-room / corridor texture overlay (Options → Floor
  // textures). Draws over the base floor render but UNDER walls,
  // doors, furniture, etc., so the readable game art stays on top.
  HQTextures.drawFloorTextures(view, tm);
  // Stair markers — group adjacent stair cells into one footprint (the
  // canonical 2x2 stairway tile renders as a single piece, not 4 tiled
  // glyphs). Only revealed cells participate so fog still hides hidden
  // stairs.
  const visibleStairs = (view.stairCells || []).filter(c => {
    const t = tm.get(`${c[0]},${c[1]}`);
    return t && t.revealed;
  });
  for (const group of groupAdjacentCells(visibleStairs)) {
    drawStairsGroup(group);
  }
  // Inter-cell walls (between revealed tiles only — hidden walls remain dark)
  drawWalls(view, tm);
  // Doors
  for (const d of view.doors) {
    if (!d.revealed) continue;
    drawDoor(d);
  }
  // Furniture — per-piece (one glyph per piece, spanning the full
  // footprint). Falls back to per-tile rendering for pre-upgrade
  // server views that don't yet emit `view.furniture`.
  if (Array.isArray(view.furniture)) {
    for (const f of view.furniture) drawFurniturePiece(f);
  } else {
    for (const t of view.tiles) {
      if (!t.revealed || !t.hasFurniture) continue;
      drawFurniture(t);
    }
  }
  // Treasure (revealed only)
  for (const t of view.treasure) {
    HQEntityDraw.drawTreasure(t);
  }
  // Secret doors
  for (const d of (view.secretDoors || [])) {
    HQEntityDraw.drawSecretDoor(d);
  }
  // Traps (revealed only — gmOnly traps for GM view are dimmed)
  for (const tr of (view.traps || [])) {
    HQEntityDraw.drawTrap(tr);
  }
  // Movement-reachable highlight
  if (view.myTurn && view.currentTurn?.kind === 'hero' && view.movementRoll != null) {
    const h = view.heroes.find(x => x.id === view.currentTurn.heroId);
    if (h) {
      drawReachable(view, h);
      drawHoverPath(view, h);
    }
  }
  // Heroes
  for (const h of view.heroes) HQEntityDraw.drawHero(h, view.currentTurn?.kind === 'hero' && view.currentTurn.heroId === h.id);
  // Monsters
  for (const m of view.monsters) HQEntityDraw.drawMonster(m, selectedGMMonsterId === m.id);

  // Debug overlay — show L#T# coordinates on each revealed cell when
  // the quest sets showCellCoords. Useful for transcribing canonical
  // maps cell-by-cell. 1-based to match XML / rulebook conventions.
  if (view.showCellCoords) {
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of view.tiles) {
      if (!t.revealed) continue;
      const cx = t.x * CELL + CELL / 2;
      const cy = t.y * CELL + CELL / 2;
      // Black rim then white text for legibility against any floor colour
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const label = `L${t.x + 1}T${t.y + 1}`;
      // Drop-shadow text outline
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        ctx.fillText(label, cx + dx, cy + dy);
      }
      ctx.fillStyle = '#fff8d8';
      ctx.fillText(label, cx, cy);
    }
  }

  // Show internal room IDs (r01, r02 …) at each room-cell centre.
  // Useful for verifying the master board's room layout.
  if (view.showRoomIds) {
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of view.tiles) {
      if (!t.revealed || !t.roomId) continue;
      const cx = t.x * CELL + CELL / 2;
      const cy = t.y * CELL + CELL / 2 + (view.showCellCoords ? 12 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        ctx.fillText(t.roomId, cx + dx, cy + dy);
      }
      ctx.fillStyle = '#ffd870';
      ctx.fillText(t.roomId, cx, cy);
    }
  }

  // Reset transform so any subsequent overlay draws (tooltips, etc.) work
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawTile(t, tm, rubblePairRights) {
  const x = t.x * CELL, y = t.y * CELL;
  if (t.blocked) {
    // If this cell is the RIGHT half of a horizontal rubble pair, the
    // wider sprite from the left neighbour already covered it — skip
    // rendering so we don't double-draw the rubble texture.
    if (rubblePairRights && rubblePairRights.has(`${t.x},${t.y}`)) return;
    // Paint a floor base BEFORE the rubble icon so the canonical
    // PNG's dark stone outlines blend into a stone-coloured floor
    // instead of sitting on the pure-black void. The editor implicitly
    // does this (the play-area fill paints a colour first); we have
    // to do it explicitly here because the game paints tiles directly
    // over the void background.
    ctx.fillStyle = (t.kind === 'corridor') ? '#5e4e36' : (t.color || '#8b7448');
    ctx.fillRect(x, y, CELL, CELL);

    // Canonical visuals from the 2021 icon legend:
    //   'rubble'        — stone-brick blocked-square tile (pre-placed)
    //   'falling-block' — collapsed-rock trap-aftermath tile
    // Heroscribe PNGs cover both — fall back to pixel-art if the image
    // is still loading or missing.
    const kind = (t.blockedKind === 'falling-block') ? 'falling-block' : 'rubble';
    // Horizontal pair check — if the right neighbour is also blocked
    // (same kind), render the wider DoubleBlockedSquare sprite spanning
    // both cells. Matches the canonical 2021 quest book's 2×1 rubble
    // pile look instead of two adjacent 1×1 sprites.
    let pairRight = false;
    if (tm && kind === 'rubble') {
      const right = tm.get(`${t.x + 1},${t.y}`);
      // Require the right neighbour to be REVEALED and blocked — without
      // the revealed check, out-of-play `solidRock` cells (also flagged
      // blocked server-side) would falsely trigger a merge with single
      // rubble cells against the map edge.
      pairRight = !!(right && right.revealed && right.blocked &&
                     (right.blockedKind || 'rubble') === 'rubble');
    }
    const iconKind = pairRight ? 'rubble-double' : kind;
    const iconW    = pairRight ? CELL * 2 : CELL;
    if (drawTileIcon(iconKind, x, y, iconW, CELL)) return;
    if (t.blockedKind === 'falling-block') {
      ctx.fillStyle = '#a02828';                  // canonical blood-red
      ctx.fillRect(x, y, CELL, CELL);
      ctx.strokeStyle = '#5a1010'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      ctx.strokeStyle = '#3a0808'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + CELL/2, y + CELL/2);
      ctx.lineTo(x + 8, y + CELL - 6);
      ctx.moveTo(x + CELL - 4, y + 8); ctx.lineTo(x + CELL/2 + 4, y + CELL/2 - 2);
      ctx.stroke();
    } else {
      // Stone-brick rubble (canonical "blocked square" tile)
      ctx.fillStyle = '#8e6e4a';
      ctx.fillRect(x, y, CELL, CELL);
      ctx.strokeStyle = '#3a2818'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      // Mortar grid — staggered brick courses
      ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + CELL/3);     ctx.lineTo(x + CELL - 2, y + CELL/3);
      ctx.moveTo(x + 2, y + 2*CELL/3);   ctx.lineTo(x + CELL - 2, y + 2*CELL/3);
      // Vertical mortar (offset for brick pattern)
      ctx.moveTo(x + CELL/2,  y + 2);          ctx.lineTo(x + CELL/2,  y + CELL/3);
      ctx.moveTo(x + CELL/3,  y + CELL/3);     ctx.lineTo(x + CELL/3,  y + 2*CELL/3);
      ctx.moveTo(x + 2*CELL/3, y + CELL/3);    ctx.lineTo(x + 2*CELL/3, y + 2*CELL/3);
      ctx.moveTo(x + CELL/2,  y + 2*CELL/3);   ctx.lineTo(x + CELL/2,  y + CELL - 2);
      ctx.stroke();
      // Cracks for rubble texture
      ctx.strokeStyle = '#2a1808'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x + CELL*0.2, y + CELL*0.15); ctx.lineTo(x + CELL*0.35, y + CELL*0.30);
      ctx.moveTo(x + CELL*0.7, y + CELL*0.55); ctx.lineTo(x + CELL*0.82, y + CELL*0.72);
      ctx.stroke();
    }
    return;
  }
  // Base — corridors get a broken-stone grey, rooms get their per-room
  // palette from board.yaml (or a sensible default).
  if (t.kind === 'corridor') {
    ctx.fillStyle = '#5e4e36';
  } else {
    ctx.fillStyle = t.color || '#8b7448';
  }
  ctx.fillRect(x, y, CELL, CELL);
  // The base floor's stipple + per-cell grid stroke read as black
  // hairlines around every cell when a texture overlay sits on top of
  // them (subpixel seams expose them). Skip both when textures are on —
  // the printed art already has its own cell divisions, so we don't
  // need (or want) the procedural ones underneath.
  if (HQOptions.floorTexturesOn()) return;
  // Inner stipple — subtle pattern
  ctx.fillStyle = (t.kind === 'corridor') ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.08)';
  for (let i = 4; i < CELL; i += 8) {
    for (let j = 4; j < CELL; j += 8) {
      if (((t.x + t.y + i + j) & 1) === 0) {
        ctx.fillRect(x + i, y + j, 2, 2);
      }
    }
  }
  // Cell grid line
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
}

// Wall thickness — kept identical for the two styles so layout stays
// consistent; only the colour and the draw primitive differ.
const WALL_THICK = 4;
function drawWalls(view, tm) {
  // For every revealed tile, check 4 sides. If neighbor is in different room
  // (or out of bounds among revealed), draw wall — UNLESS there's a door.
  const doorSet = new Set(view.doors.map(d => `${d.a[0]},${d.a[1]}|${d.b[0]},${d.b[1]}`));
  function hasDoor(a, b) {
    return doorSet.has(`${a[0]},${a[1]}|${b[0]},${b[1]}`) ||
           doorSet.has(`${b[0]},${b[1]}|${a[0]},${a[1]}`);
  }
  // Two styles, same toggle the editor uses:
  //   Light  → filled cream rectangle, crisp printed-art look
  //   Dark   → legacy stroked dark-brown line
  const lightOn = HQOptions.lightWallsOn();
  const wallColour = lightOn ? '#e6d9bd' : '#1c1208';
  if (lightOn) ctx.fillStyle = wallColour;
  else { ctx.strokeStyle = wallColour; ctx.lineWidth = WALL_THICK; }

  for (const t of view.tiles) {
    if (!t.revealed) continue;
    // Each side: (dx, dy) = direction to neighbour;
    //   rect = fill rect for the "light" path (centred on edge);
    //   x1..y2 = stroke endpoints for the "dark" path.
    const x = t.x * CELL, y = t.y * CELL;
    const sides = [
      // N
      { dx:  0, dy: -1,
        rect: [x, y - WALL_THICK / 2, CELL, WALL_THICK],
        line: [x, y, x + CELL, y] },
      // E
      { dx:  1, dy:  0,
        rect: [x + CELL - WALL_THICK / 2, y, WALL_THICK, CELL],
        line: [x + CELL, y, x + CELL, y + CELL] },
      // S
      { dx:  0, dy:  1,
        rect: [x, y + CELL - WALL_THICK / 2, CELL, WALL_THICK],
        line: [x, y + CELL, x + CELL, y + CELL] },
      // W
      { dx: -1, dy:  0,
        rect: [x - WALL_THICK / 2, y, WALL_THICK, CELL],
        line: [x, y, x, y + CELL] },
    ];
    for (const s of sides) {
      const n = tm.get(`${t.x + s.dx},${t.y + s.dy}`);
      // isOuter == "this is one of the four real board edges" — ONLY
      // the out-of-bounds case. The fog-of-war boundary (`!n.revealed`)
      // must always draw a wall so the revealed area stays enclosed,
      // otherwise the play frame visually leaks into the void.
      let isWall, isOuter;
      if (!n)               { isWall = true;  isOuter = true;  }
      else if (!n.revealed) { isWall = true;  isOuter = false; }
      else                  { isWall = (n.roomId !== t.roomId); isOuter = false; }
      if (!isWall) continue;
      if (isOuter && !HQOptions.outerWallsOn()) continue;
      if (hasDoor([t.x, t.y], [t.x + s.dx, t.y + s.dy])) continue;
      if (lightOn) {
        ctx.fillRect(s.rect[0], s.rect[1], s.rect[2], s.rect[3]);
      } else {
        ctx.beginPath();
        ctx.moveTo(s.line[0], s.line[1]);
        ctx.lineTo(s.line[2], s.line[3]);
        ctx.stroke();
      }
    }
  }
}

// Group cells into orthogonally-connected components, so e.g. a
// canonical 2x2 stair tile is treated as one piece (not 4 separate
// 1-cell markers tiled together). Used for stair rendering today;
// later for multi-cell furniture too.
function groupAdjacentCells(cells) {
  const set = new Set(cells.map(c => `${c[0]},${c[1]}`));
  const seen = new Set();
  const groups = [];
  for (const c of cells) {
    const key = `${c[0]},${c[1]}`;
    if (seen.has(key)) continue;
    const group = [];
    const stack = [c];
    while (stack.length) {
      const cur = stack.pop();
      const k = `${cur[0]},${cur[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      group.push(cur);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = `${cur[0]+dx},${cur[1]+dy}`;
        if (set.has(nk) && !seen.has(nk)) stack.push([cur[0]+dx, cur[1]+dy]);
      }
    }
    groups.push(group);
  }
  return groups;
}

// Stair tile — sandy backing + frame + simple step-treads. The tile is
// still mechanically the escape route, but the previous radial-fan arcs
// were visual noise so they're gone — replaced by three crisp step
// lines that read as "stairs" without the swirl.
// Stair tile — heroscribe Stairway.png drawn over the natural stair-tile
// backing. Falls back to a solid sand colour if the PNG hasn't loaded.
let stairImg = null;
(() => {
  const img = new Image();
  img.onload = () => { stairImg = img; if (lastView) drawBoard(lastView); };
  img.src = '/assets/tiles/Stairway.png';
})();
function drawStairsGroup(group) {
  if (!group || !group.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of group) {
    if (cx < minX) minX = cx; if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy;
  }
  const px = minX * CELL, py = minY * CELL;
  const pw = (maxX - minX + 1) * CELL;
  const ph = (maxY - minY + 1) * CELL;

  ctx.save();
  ctx.fillStyle = '#cba366';
  ctx.fillRect(px, py, pw, ph);
  if (stairImg) {
    // Use the same stair-bucket inset the editor's slider drives so
    // tweaks in the tool propagate to the live game.
    const cellsW = Math.max(1, Math.round(pw / CELL));
    const cellsH = Math.max(1, Math.round(ph / CELL));
    const inset  = insetForBbox(cellsW, cellsH);
    const slotW = pw - 2 * inset;
    const slotH = ph - 2 * inset;
    const ar = stairImg.naturalWidth / stairImg.naturalHeight;
    let drawW = slotW, drawH = slotW / ar;
    if (drawH > slotH) { drawH = slotH; drawW = slotH * ar; }
    ctx.drawImage(stairImg, px + (pw - drawW) / 2, py + (ph - drawH) / 2, drawW, drawH);
  }
  ctx.strokeStyle = '#3a2814';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  ctx.restore();
}

function drawDoor(d) {
  const cx = (d.a[0] + d.b[0] + 1) * CELL / 2;
  const cy = (d.a[1] + d.b[1] + 1) * CELL / 2;
  const horizontal = (d.a[1] === d.b[1]);
  ctx.fillStyle = d.state === 'open' ? '#3a2a18' : '#6e3a18';
  ctx.strokeStyle = '#1c0e06';
  ctx.lineWidth = 2;
  if (horizontal) {
    ctx.fillRect(cx - 4, cy - 12, 8, 24);
    ctx.strokeRect(cx - 4, cy - 12, 8, 24);
  } else {
    ctx.fillRect(cx - 12, cy - 4, 24, 8);
    ctx.strokeRect(cx - 12, cy - 4, 24, 8);
  }
  // wasSecret accent — a thin purple stripe across the door so a
  // discovered-secret door is visually distinct from an ordinary door.
  if (d.wasSecret) {
    ctx.strokeStyle = '#a060d8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6);
    } else {
      ctx.moveTo(cx - 10, cy - 2); ctx.lineTo(cx + 10, cy + 2);
    }
    ctx.stroke();
  }
}

// =====================================================================
// Furniture renderers — each draws a distinctive silhouette spanning
// the piece's full footprint (1x1, 2x1, 1x2, 2x2 — whatever the quest
// data declares). Each function now takes (x, y, w, h) so a 2x1 table
// renders as ONE 64x32 plank, not two side-by-side 32x32 planks.
// Defaults to (CELL, CELL) so the legacy per-tile fallback still works
// for old server views.
// =====================================================================
// Map XML rotation strings → radian angles for canvas rotation. Default
// (downward = the piece faces SOUTH) is the un-rotated orientation;
// other rotations re-orient the icon around its own bounding-box centre.
const FACING_RAD = {
  downward:  0,
  upward:    Math.PI,
  leftward:  -Math.PI / 2,
  rightward:  Math.PI / 2,
};

// Pieces whose icon has a clear front/back direction and should be
// rotated to match XML facing. Used by the pixel-art fallback only —
// the heroscribe-image path always rotates because the canonical icons
// have a defined orientation (downward).
const ROTATABLE_PIECES = new Set(['throne', 'weapon-rack']);

// Furniture + tile PNG art subsystem lives in public/client/furniture-art.js.
// Owns canonical-pieces hydration, FURN_IMG / FURN_IMG_ALT / TILE_IMG
// caches, furn-naturals overrides, the ALT_FURN_ON pref, and the
// per-art-set inset tables. Init once at boot.
HQFurnitureArt.init({
  ctx, CELL,
  getLastView: () => lastView,
  drawBoard:   (v) => drawBoard(v),
});
const { getFurnImg, drawTileIcon, insetForBbox } = HQFurnitureArt;
function drawFurniturePieceImage(type, px, py, pw, ph, facing, flipH, flipV) {
  const entry = getFurnImg(type);
  if (!entry || !entry.ready) return false;
  const img = entry.img;
  const facingA  = (facing != null) ? (FACING_RAD[facing] || 0) : 0;
  const naturalA = FACING_RAD[entry.natural] || 0;
  let angle = facingA - naturalA;
  while (angle >  Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  const transverse = (Math.abs(angle - Math.PI / 2) < 1e-6
                   || Math.abs(angle + Math.PI / 2) < 1e-6);
  const cellsW = Math.max(1, Math.round(pw / CELL));
  const cellsH = Math.max(1, Math.round(ph / CELL));
  const inset  = insetForBbox(cellsW, cellsH);
  const slotW = (transverse ? ph : pw) - 2 * inset;
  const slotH = (transverse ? pw : ph) - 2 * inset;
  const ar = img.naturalWidth / img.naturalHeight;
  let drawW = slotW, drawH = slotW / ar;
  if (drawH > slotH) { drawH = slotH; drawW = slotH * ar; }
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  const needsTransform = Math.abs(angle) > 1e-6 || sx !== 1 || sy !== 1;
  if (!needsTransform) {
    ctx.drawImage(img, px + (pw - drawW) / 2, py + (ph - drawH) / 2, drawW, drawH);
  } else {
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    if (Math.abs(angle) > 1e-6) ctx.rotate(angle);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
  return true;
}

function drawFurniturePiece(f) {
  if (!f || !f.cells || !f.cells.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of f.cells) {
    if (cx < minX) minX = cx; if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy;
  }
  const px = minX * CELL, py = minY * CELL;
  const pw = (maxX - minX + 1) * CELL;
  const ph = (maxY - minY + 1) * CELL;
  const type = f.type || 'block';

  // Preferred path: heroscribe canonical PNG. Falls back to pixel art
  // when the image is still loading or the type has no mapping.
  // Per-art-set flip — alt mode reads f._altFlipH/V, canonical reads
  // f._flipH/V. Same data model the editor + builder write into.
  const altOn = HQFurnitureArt.isAltOn();
  const flipH = altOn ? !!f._altFlipH : !!f._flipH;
  const flipV = altOn ? !!f._altFlipV : !!f._flipV;
  if (drawFurniturePieceImage(type, px, py, pw, ph, f.facing, flipH, flipV)) return;

  // Pixel-art fallback — uses the legacy ROTATABLE_PIECES rule because
  // most of the hand-drawn glyphs are symmetric.
  const angle = (ROTATABLE_PIECES.has(type) && f.facing != null)
    ? (FACING_RAD[f.facing] || 0) : 0;
  if (angle !== 0) {
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2);
    ctx.rotate(angle);
    ctx.translate(-(px + pw / 2), -(py + ph / 2));
  }

  HQFurnitureDraw.drawShape(type, px, py, pw, ph);

  if (angle !== 0) ctx.restore();
}

// Per-tile fallback used only when the server view is older and doesn't
// emit `view.furniture`. Forwards each tile to the (now piece-aware)
// helpers at default 1x1 size.
function drawFurniture(t) {
  const x = t.x * CELL, y = t.y * CELL;
  const type = t.furnitureType || 'block';
  if (drawFurniturePieceImage(type, x, y, CELL, CELL, t.facing)) return;
  HQFurnitureDraw.drawShape(type, x, y);
}

function drawReachable(view, h) {
  // BFS from hero across passable cells (treating closed-but-revealed doors
  // as walkable, since the server auto-opens them on move). Stores the
  // predecessor map so hover-path preview can backtrack.
  const remaining = view.movementRoll - view.movementUsed;
  if (remaining <= 0) { lastReachable = { dist: new Map(), prev: new Map() }; return; }
  const tm = tileMap(view);
  const occ = new Set();
  for (const x of view.heroes) if (!x.dead && x.id !== h.id) occ.add(`${x.at[0]},${x.at[1]}`);
  for (const m of view.monsters) if (!m.dead) occ.add(`${m.at[0]},${m.at[1]}`);

  // Movement-modifying spell flags from the current hero — must mirror
  // the server's `passable()` so the preview shows the actually-reachable
  // cells when Pass Through Rock or Veil of Mist are active.
  const ignoreWalls     = !!(h.status && h.status.passWalls);
  const ignoreOccupants = !!(h.status && h.status.passOccupants);

  // Adapt the wire-format view into a state-shape HQRules understands.
  // The shared module is the single source of truth for walls / doors;
  // movement-specific rules (closed-but-revealed door is walkable, since
  // the server auto-opens on attempted move) layer on top.
  const ruleState = { tileMeta: tm, doors: view.doors };
  function passEdge(a, b) {
    const ta = tm.get(`${a[0]},${a[1]}`);
    const tb = tm.get(`${b[0]},${b[1]}`);
    if (!ta || !tb) return false;
    if (!ta.revealed || !tb.revealed) return false;
    if (!ignoreWalls && HQRules.wallBetween(ruleState, a, b)) return false;
    if (tb.hasFurniture) return false;
    if (!ignoreOccupants && occ.has(`${b[0]},${b[1]}`)) return false;
    return true;
  }

  const dist = new Map();
  const prev = new Map();
  dist.set(`${h.at[0]},${h.at[1]}`, 0);
  prev.set(`${h.at[0]},${h.at[1]}`, null);
  const queue = [h.at];
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(`${cur[0]},${cur[1]}`);
    if (d >= remaining) continue;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n = [cur[0]+dx, cur[1]+dy];
      const k = `${n[0]},${n[1]}`;
      if (dist.has(k)) continue;
      if (!passEdge(cur, n)) continue;
      // Final-cell rule: don't allow ending on furniture or another occupant
      // (BFS still expands through allies as pass-through)
      const tb = tm.get(k);
      const isOcc = occ.has(k);
      if (tb && tb.hasFurniture) continue;
      if (isOcc) {
        // can pass through allied hero but can't end on it; mark distance
        // but don't propagate beyond
      }
      dist.set(k, d + 1);
      prev.set(k, `${cur[0]},${cur[1]}`);
      if (!isOcc) queue.push(n);
    }
  }

  // Paint the reachable cells
  for (const [k, d] of dist.entries()) {
    if (d === 0) continue;
    const [x, y] = k.split(',').map(Number);
    if (occ.has(k)) continue;     // don't paint allied-hero cells (can't end there)
    ctx.fillStyle = 'rgba(255,216,112,0.18)';
    ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
  }

  lastReachable = { dist, prev };
}

function drawHoverPath(view, h) {
  // Use lastReachable's predecessor map to draw the path the hero would walk
  // to the cell currently under the mouse.
  if (!hoverCell || !lastReachable || !lastReachable.dist) return;
  const k = `${hoverCell[0]},${hoverCell[1]}`;
  if (!lastReachable.dist.has(k)) return;
  let cur = k;
  const cells = [];
  while (cur != null) {
    cells.push(cur);
    cur = lastReachable.prev.get(cur);
  }
  // Skip the hero's own cell
  cells.pop();
  ctx.save();
  ctx.fillStyle = 'rgba(255,216,112,0.55)';
  for (const ck of cells) {
    const [x, y] = ck.split(',').map(Number);
    const cx = x * CELL + CELL / 2;
    const cy = y * CELL + CELL / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Final cell — small ring
  const [hx, hy] = hoverCell;
  ctx.strokeStyle = 'rgba(255,216,112,0.95)';
  ctx.lineWidth = 2;
  ctx.strokeRect(hx * CELL + 2, hy * CELL + 2, CELL - 4, CELL - 4);
  ctx.restore();
}

// Canvas hover + click handling and the floating tooltip live in
// public/client/board-input.js. The module borrows state via accessors
// so the canvas renderer + the input listeners read the same hoverCell
// / pendingSpell / lastReachable / selectedGMMonsterId.
HQBoardInput.init({
  canvas, screenToCell, drawBoard,
  getLastView:            () => lastView,
  getLastReachable:       () => lastReachable,
  getPendingSpell:        () => pendingSpell,
  setPendingSpell:        (v) => { pendingSpell = v; },
  getHoverCell:           () => hoverCell,
  setHoverCell:           (v) => { hoverCell = v; },
  getSelectedGMMonsterId: () => selectedGMMonsterId,
  sendCast, action, send,
});

// Modal dialogs (combat / treasure / end / save / restart) live in
// public/client/modals.js — exposes window.HQModals. Wire it up.
HQModals.init({ send, getLastView: () => lastView });

HQOverlays.mountMobileTabs();

// Audio synth lives in public/client/audio.js — exposes window.HQAudio
// (sfx / fireSfxFromView / reset / mount). Mount the 🔊 / 🔇 toggle.
HQAudio.mount();

// ---------- Boot ----------
connect();
