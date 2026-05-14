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

// Optional sprite layer — drop PNGs into public/icons/monsters/<type>.png
// or public/icons/heroes/<id>.png and the renderer prefers them over the
// drawn glyphs. The folder is gitignored; you can use your own art,
// CC0 sources (Kenney.nl iso dungeon pack, Game-icons.net), commissioned
// artwork from the heroscribe project — pulled into /assets/monsters,
// /assets/heros, /assets/tiles by scripts/fetch-heroscribe-icons.js.
// Filenames are PascalCase (Goblin.png, ChaosWarrior.png, Barbarian.png),
// game data uses kebab-case (chaos-warrior, dread-warrior, etc.) so we
// translate via a small lookup.
const monsterSprites = {};
const heroSprites = {};

// Boss / named-monster ids in quest data → underlying creature type.
// Falls through to whatever the type field already is for unnamed ones.
// Prefer the new printed-style "<Type>-Token.png" art (matches the
// physical-board token look). A few legacy names from the original
// edition map onto the new tokens (chaos-warrior / chaos-sorcerer were
// renamed to dread-warrior / dread-sorcerer in 2021; "familiar" became
// "abomination"). All such aliases resolve to the new token art.
const MONSTER_TYPE_FILE = {
  'goblin':         'Goblin-Token.png',
  'orc':            'Orc-Token.png',
  'skeleton':       'Skeleton-Token.png',
  'zombie':         'Zombie-Token.png',
  'mummy':          'Mummy-Token.png',
  'gargoyle':       'Gargoyle-Token.png',
  // Old-edition names → new tokens
  'chaos-warrior':  'Dread-Warrior-Token.png',
  'chaos-sorcerer': 'Dread-Sorcerer-Token.png',
  'fimir':          'Abomination-Token.png',      // old "fimir" == new "abomination"
  // New-edition names
  'dread-warrior':  'Dread-Warrior-Token.png',
  'dread-sorcerer': 'Dread-Sorcerer-Token.png',
  'abomination':    'Abomination-Token.png',
  // Boss aliases — render as their underlying creature using the token art
  'verag':          'Gargoyle-Token.png',
  'ulag':           'Orc-Token.png',
  'grak':           'Goblin-Token.png',
  'balur':          'Dread-Warrior-Token.png',
  'witch-lord':     'Mummy-Token.png',
};
const HERO_FILE = {
  'barbarian': 'Barbarian.png',
  'dwarf':     'Dwarf.png',
  'elf':       'Elf.png',
  'wizard':    'Wizard.png',
};
// Per-variant printed tokens — Male / Female. Loaded under composite
// keys (`barbarian:male`, etc.) so drawHero can pick the right art.
// Falls back to the gender-neutral default if a variant PNG fails to
// load.
const HERO_NAMES = { barbarian: 'Barbarian', dwarf: 'Dwarf', elf: 'Elf', wizard: 'Wizard' };
const HERO_VARIANTS = ['male', 'female'];
function variantKey(heroId, variant) { return `${heroId}:${variant}`; }
function variantTokenURL(heroId, variant) {
  const v = variant === 'female' ? 'Female' : 'Male';
  return `/assets/heros/${HERO_NAMES[heroId]}-${v}-Token.png`;
}
function variantCardURL(heroId, variant) {
  const v = variant === 'female' ? 'Female' : 'Male';
  return `/assets/heros/${HERO_NAMES[heroId]}-${v}-Card.png`;
}

function tryLoadSprite(map, key, url) {
  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth > 0) {
      map[key] = img;
      if (lastView) drawBoard(lastView);
    }
  };
  img.onerror = () => { /* missing — fall back to drawn art */ };
  img.src = url;
}
function loadAllSprites() {
  for (const [type, file] of Object.entries(MONSTER_TYPE_FILE)) {
    tryLoadSprite(monsterSprites, type, `/assets/monsters/${file}`);
  }
  for (const [id, file] of Object.entries(HERO_FILE)) {
    tryLoadSprite(heroSprites, id, `/assets/heros/${file}`);
  }
  for (const id of Object.keys(HERO_NAMES)) {
    for (const v of HERO_VARIANTS) {
      tryLoadSprite(heroSprites, variantKey(id, v), variantTokenURL(id, v));
    }
  }
}
loadAllSprites();

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
    renderLobby(view);
    _audioLastLogLen = 0;            // reset when we leave a game
  } else {
    showScreen('game');
    initGameUIChrome();
    renderGame(view);
    fireSfxFromView(view);
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

// ---------- Lobby render ----------
function renderLobby(view) {
  document.getElementById('lobby-code').textContent = view.code;

  // Quest picker — split into Quest Book vs Sandbox / Tests via optgroup
  const qSel = document.getElementById('lobby-quest');
  qSel.innerHTML = '';
  const main = (view.quests || []).filter(q => (q.category || 'main') !== 'sandbox');
  const sandbox = (view.quests || []).filter(q => q.category === 'sandbox');
  function addGroup(label, items) {
    if (!items.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const q of items) {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = `${q.subtitle ? q.subtitle + ' — ' : ''}${q.title}`;
      g.appendChild(o);
    }
    qSel.appendChild(g);
  }
  addGroup('Quest Book', main);
  addGroup('Sandbox / Tests', sandbox);
  qSel.value = view.config.questId || '';
  qSel.disabled = !view.isHost;

  const intro = (view.quests.find(q => q.id === view.config.questId) || {}).intro || '';
  document.getElementById('lobby-quest-intro').textContent = intro;
  const boardLabel = document.getElementById('lobby-quest-board');
  if (boardLabel) {
    const q = view.quests.find(q => q.id === view.config.questId);
    boardLabel.textContent = (q && q.usesDefaultBoard) ? 'Uses the default master board.' : 'Uses a custom board layout.';
  }

  // Auto-roll option
  const auto = document.getElementById('opt-autoroll');
  if (auto) {
    auto.checked = !!view.config.autoRollMovement;
    auto.disabled = !view.isHost;
  }
  // Reveal-all (debug) option
  const reveal = document.getElementById('opt-reveal-all');
  if (reveal) {
    reveal.checked = !!view.config.revealAll;
    reveal.disabled = !view.isHost;
  }

  // GM mode
  for (const r of document.querySelectorAll('input[name="gmMode"]')) {
    r.checked = (r.value === view.config.gmMode);
    r.disabled = !view.isHost;
  }
  const claimGM = document.getElementById('lobby-claim-gm');
  const gmInfo  = document.getElementById('lobby-gm-info');
  if (view.config.gmMode === 'ai') {
    claimGM.classList.add('hidden');
    gmInfo.textContent = 'AI will run the dungeon.';
  } else {
    claimGM.classList.remove('hidden');
    if (view.seats.gm === view.youPid) {
      claimGM.textContent = 'Release GM seat';
      claimGM.classList.add('taken-by-me');
      gmInfo.textContent = `${view.youName} will run the dungeon.`;
    } else if (view.seats.gm) {
      const p = view.players.find(x => x.pid === view.seats.gm);
      claimGM.textContent = 'GM seat taken';
      claimGM.classList.remove('taken-by-me');
      claimGM.disabled = true;
      gmInfo.textContent = `${p ? p.name : 'Someone'} will run the dungeon.`;
    } else {
      claimGM.textContent = 'Take GM seat';
      claimGM.classList.remove('taken-by-me');
      claimGM.disabled = false;
      gmInfo.textContent = 'Someone must take the GM seat.';
    }
  }

  // Hero seats
  for (const btn of document.querySelectorAll('.seat-btn')) {
    const seat = btn.dataset.seat;
    const taken = view.seats[seat];
    btn.classList.remove('taken-by-me','taken-by-other');
    btn.disabled = false;
    const status = btn.querySelector('.seat-status');
    renderSeatBadgeToken(view, btn, seat);
    if (taken === view.youPid) {
      btn.classList.add('taken-by-me');
      status.textContent = '— you (click to release)';
    } else if (taken) {
      const p = view.players.find(x => x.pid === taken);
      btn.classList.add('taken-by-other');
      btn.disabled = true;
      status.textContent = `— ${p ? p.name : '?'}`;
    } else {
      status.textContent = '';
    }
    renderSeatVariant(view, btn, seat, taken);
  }

  // Players list
  const ul = document.getElementById('lobby-players');
  ul.innerHTML = '';
  for (const p of view.players) {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.isHost) li.appendChild(makeTag('host', 'Host'));
    if (view.seats.gm === p.pid) li.appendChild(makeTag('gm', 'GM'));
    for (const id of ['barbarian','dwarf','elf','wizard']) {
      if (view.seats[id] === p.pid) li.appendChild(makeTag('hero', id));
    }
    if (!p.connected) li.appendChild(makeTag('offline', 'offline'));
    ul.appendChild(li);
  }

  renderSpellDraft(view);

  // Start enabled?
  const heroesClaimed = ['barbarian','dwarf','elf','wizard'].some(id => view.seats[id]);
  const gmOK = view.config.gmMode === 'ai' || view.seats.gm;
  const draftReady = view.spellDraft?.done || view.spellDraft?.phase === 'na';
  const startable = view.isHost && heroesClaimed && gmOK && draftReady;
  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = !startable;
  startBtn.classList.toggle('hidden', !view.isHost);

  const msg = document.getElementById('lobby-msg');
  if (view.isHost && !draftReady && view.spellDraft) {
    msg.textContent = 'Spell draft not finished — pick element groups or use the suggested split.';
  } else {
    msg.textContent = '';
  }
}

const ELEMENT_LABELS = { air: 'Air', fire: 'Fire', water: 'Water', earth: 'Earth' };
const ELEMENT_ORDER  = ['air', 'fire', 'water', 'earth'];

function renderSpellDraft(view) {
  const panel = document.getElementById('spell-draft-panel');
  const draft = view.spellDraft;
  if (!panel || !draft || draft.phase === 'na') {
    if (panel) panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const wizSeat = view.seats.wizard;
  const elfSeat = view.seats.elf;
  const youAreWizard = wizSeat && wizSeat === view.youPid;
  const youAreElf    = elfSeat && elfSeat === view.youPid;

  // Status line.
  const statusEl = document.getElementById('spell-draft-status');
  let statusText = '';
  if (draft.done) {
    statusText = '— draft complete';
  } else if (draft.phase === 'wizardFirst') {
    statusText = '— wizard picks first';
  } else if (draft.phase === 'elf') {
    statusText = '— elf picks';
  } else if (draft.phase === 'wizardOnly') {
    statusText = `— wizard picks ${3 - draft.wizardElements.length} more`;
  } else if (draft.phase === 'elfOnly') {
    statusText = '— elf picks one';
  }
  statusEl.textContent = statusText;

  // Tiles.
  const grid = document.getElementById('spell-elements');
  grid.innerHTML = '';
  for (const el of ELEMENT_ORDER) {
    const tile = document.createElement('div');
    tile.className = 'spell-element-tile';
    tile.dataset.element = el;

    const isWizard = draft.wizardElements.includes(el);
    const isElf    = draft.elfElements.includes(el);
    if (isWizard) tile.classList.add('owner-wizard');
    if (isElf)    tile.classList.add('owner-elf');

    const myTurn = (draft.currentSeat === 'wizard' && youAreWizard)
                || (draft.currentSeat === 'elf'    && youAreElf);
    const claimable = myTurn && !isWizard && !isElf;
    if (claimable) tile.classList.add('claimable');

    // Card-back artwork — the real printed back for this element.
    const cardWrap = document.createElement('div');
    cardWrap.className = 'spell-card-wrap';
    const img = document.createElement('img');
    img.className = 'spell-card-back';
    img.alt = `${ELEMENT_LABELS[el]} Spell`;
    img.src = `/assets/cards/card_backs/${encodeURIComponent(ELEMENT_LABELS[el] + ' Spell')}.png`;
    img.draggable = false;
    cardWrap.appendChild(img);

    if (isWizard || isElf) {
      const claimedBy = document.createElement('div');
      claimedBy.className = 'spell-card-claimed-by';
      claimedBy.textContent = isWizard ? 'Wizard' : 'Elf';
      cardWrap.appendChild(claimedBy);
    }
    tile.appendChild(cardWrap);

    const head = document.createElement('div');
    head.className = 'spell-element-head';
    head.innerHTML = `<strong>${ELEMENT_LABELS[el]}</strong>`;
    tile.appendChild(head);

    // Spell names as a compact tooltip on the tile.
    const names = (view.spellsByElement?.[el] || []).map(sp => sp.name);
    if (names.length) tile.title = names.join(' · ');

    if (claimable) {
      tile.addEventListener('click', () => {
        send({ type: 'pickSpellElement', seat: draft.currentSeat, element: el });
      });
    }
    grid.appendChild(tile);
  }
}

// Single body-level card-preview popover. One element reused for every
// hover; sits at the top of the DOM so no ancestor's overflow can clip
// it. Position chosen each hover: prefer to the right of the thumbnail,
// flip to the left if it would run off-screen, with vertical clamping
// against the viewport.
let _cardPreviewEl = null;
function getCardPreview() {
  if (_cardPreviewEl) return _cardPreviewEl;
  const el = document.createElement('img');
  el.className = 'card-preview-popover';
  el.alt = '';
  el.draggable = false;
  document.body.appendChild(el);
  _cardPreviewEl = el;
  return el;
}
function attachCardPreview(thumb, url) {
  thumb.addEventListener('mouseenter', () => {
    const el = getCardPreview();
    el.src = url;
    el.style.display = 'block';
    // Wait a frame so the popover has natural dimensions, then place it.
    requestAnimationFrame(() => positionCardPreview(thumb, el));
  });
  thumb.addEventListener('mouseleave', () => {
    if (_cardPreviewEl) _cardPreviewEl.style.display = 'none';
  });
}
function positionCardPreview(thumb, el) {
  const rect = thumb.getBoundingClientRect();
  const pw = el.offsetWidth || 220;
  const ph = el.offsetHeight || 308;
  const gap = 10;
  // Prefer right of thumbnail; flip left if it would clip off-screen.
  let x = rect.right + gap;
  if (x + pw > window.innerWidth - 4) x = rect.left - gap - pw;
  if (x < 4) x = 4;
  // Vertical: align centre to thumbnail; clamp inside viewport.
  let y = rect.top + rect.height / 2 - ph / 2;
  y = Math.max(4, Math.min(y, window.innerHeight - ph - 4));
  el.style.left = `${Math.round(x)}px`;
  el.style.top  = `${Math.round(y)}px`;
}

// Replace the coloured letter badge with the printed-art token for the
// current variant choice. Falls back to the glyph letter if the PNG
// hasn't loaded yet (or doesn't exist for some reason).
function renderSeatBadgeToken(view, btn, seat) {
  const badge = btn.querySelector('.hero-badge');
  if (!badge) return;
  const variant = view.heroVariants?.[seat] || 'male';
  const url = variantTokenURL(seat, variant);
  // Use a CSS background-image so we don't fight the badge's circular
  // shape and shadow. Fall back to the letter glyph until the image is
  // confirmed loaded.
  badge.style.backgroundImage = `url("${url}")`;
  badge.style.backgroundSize = 'cover';
  badge.style.backgroundPosition = 'center';
  badge.classList.add('with-token');
  // Probe load — if it errors, drop the bg-image so the glyph shows.
  const probe = new Image();
  probe.onerror = () => {
    badge.style.backgroundImage = '';
    badge.classList.remove('with-token');
  };
  probe.src = url;
}

// Inside each lobby seat button, render the printed-art card preview
// plus a Male / Female toggle. The toggle is only enabled for the
// player who currently holds the seat — other players see the chosen
// art but can't change it.
function renderSeatVariant(view, btn, seat, taken) {
  let host = btn.querySelector('.seat-variant');
  if (!host) {
    host = document.createElement('div');
    host.className = 'seat-variant';
    btn.appendChild(host);
  }
  const variant = view.heroVariants?.[seat] || 'male';
  const cardUrl = variantCardURL(seat, variant);
  const isMine  = taken && taken === view.youPid;

  host.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'seat-variant-card';
  img.src = cardUrl;
  img.alt = `${HERO_NAMES[seat]} (${variant})`;
  img.draggable = false;
  // Hover-zoom: a single body-level popover (avoids parent overflow clips).
  attachCardPreview(img, cardUrl);
  host.appendChild(img);

  if (isMine) {
    const toggle = document.createElement('div');
    toggle.className = 'seat-variant-toggle';
    for (const v of HERO_VARIANTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v[0].toUpperCase() + v.slice(1);
      b.className = (v === variant) ? 'active' : '';
      // The seat-tile itself listens for clicks to release the seat,
      // so swallow the toggle clicks before they bubble.
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (v !== variant) send({ type: 'setHeroVariant', seat, variant: v });
      });
      toggle.appendChild(b);
    }
    host.appendChild(toggle);
  }
}

function makeTag(kind, text) {
  const t = document.createElement('span');
  t.className = `player-tag ${kind}`;
  t.textContent = text;
  return t;
}

// Lobby controls
for (const r of document.querySelectorAll('input[name="gmMode"]')) {
  r.addEventListener('change', () => {
    if (r.checked) send({ type: 'setConfig', gmMode: r.value });
  });
}
document.getElementById('lobby-quest').addEventListener('change', (e) => {
  send({ type: 'setConfig', questId: e.target.value });
});
document.getElementById('opt-reveal-all')?.addEventListener('change', (e) => {
  send({ type: 'setConfig', revealAll: e.target.checked });
});
document.getElementById('opt-autoroll')?.addEventListener('change', (e) => {
  send({ type: 'setConfig', autoRollMovement: e.target.checked });
});
document.getElementById('lobby-claim-gm').addEventListener('click', () => {
  if (!lastView) return;
  if (lastView.seats.gm === lastView.youPid) send({ type: 'release', seat: 'gm' });
  else send({ type: 'claim', seat: 'gm' });
});
for (const btn of document.querySelectorAll('.seat-btn')) {
  btn.addEventListener('click', () => {
    if (!lastView) return;
    const seat = btn.dataset.seat;
    if (lastView.seats[seat] === lastView.youPid) send({ type: 'release', seat });
    else send({ type: 'claim', seat });
  });
}
document.getElementById('btn-spell-suggested')?.addEventListener('click', () => {
  send({ type: 'suggestSpellDraft' });
});
document.getElementById('btn-spell-reset')?.addEventListener('click', () => {
  send({ type: 'resetSpellDraft' });
});
document.getElementById('btn-start').addEventListener('click', () => {
  send({ type: 'start' });
});

// ---------- Panel collapse + rails-hidden toggle ----------
// Each panel <h3> folds its body on click. Persists per-panel id.
// The header "☰ Panels" button hides both side rails entirely so the
// board area gets the full width. State survives reloads.
const PANEL_STATE_KEY    = 'hq_panel_collapsed_v1';
const RAILS_STATE_KEY    = 'hq_rails_hidden_v1';
const TEXTURES_STATE_KEY = 'hq_floor_textures_v1';   // '1' on / '0' off
const LIGHT_WALLS_KEY    = 'hq_light_walls_v1';      // '1' light / '0' dark
const OUTER_WALLS_KEY    = 'hq_outer_walls_v1';      // '1' shown / '0' hidden
// Floor-texture preference. Default ON (string '1') if no prior choice
// stored. Read once at boot; the options menu toggles + persists it.
let FLOOR_TEXTURES_ON = (() => {
  try {
    const v = localStorage.getItem(TEXTURES_STATE_KEY);
    return v == null ? true : v === '1';
  } catch { return true; }
})();
// Wall-colour preference. Default LIGHT (cream stones, filled rects,
// matches the editor + printed art). Off = the legacy dark brown stroke.
let LIGHT_WALLS_ON = (() => {
  try {
    const v = localStorage.getItem(LIGHT_WALLS_KEY);
    return v == null ? true : v === '1';
  } catch { return true; }
})();
// Outer-perimeter wall preference. Default ON. When off, walls between
// a revealed cell and either (a) the map edge or (b) an unrevealed
// neighbour are skipped — the printed wall stones in the floor texture
// provide the visual edge instead.
let OUTER_WALLS_ON = (() => {
  try {
    const v = localStorage.getItem(OUTER_WALLS_KEY);
    return v == null ? true : v === '1';
  } catch { return true; }
})();
// Cross-tab live sync — if the editor toggles wall style or perimeter,
// the game re-renders without a refresh and vice versa.
window.addEventListener('storage', (e) => {
  if (e.key === LIGHT_WALLS_KEY) {
    LIGHT_WALLS_ON = e.newValue === '1' || e.newValue == null;
    if (lastView) drawBoard(lastView);
  } else if (e.key === OUTER_WALLS_KEY) {
    OUTER_WALLS_ON = e.newValue === '1' || e.newValue == null;
    if (lastView) drawBoard(lastView);
  }
});

function loadPanelState() {
  try { return new Set(JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || '[]')); }
  catch { return new Set(); }
}
function savePanelState(set) {
  try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify([...set])); } catch {}
}

const collapsedPanels = loadPanelState();

function panelKey(panel) {
  // Stable id: prefer explicit id, fall back to the first <h3>'s text.
  if (panel.id) return panel.id;
  const h = panel.querySelector('h3');
  return h ? `h3:${h.textContent.trim().toLowerCase().replace(/\s+/g, '-')}` : null;
}

function wirePanelCollapse() {
  for (const panel of document.querySelectorAll('.game-layout .panel')) {
    const key = panelKey(panel);
    if (!key) continue;
    if (collapsedPanels.has(key)) panel.classList.add('collapsed');
    const h = panel.querySelector('h3');
    if (!h || h._wired) continue;
    h.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      if (panel.classList.contains('collapsed')) collapsedPanels.add(key);
      else collapsedPanels.delete(key);
      savePanelState(collapsedPanels);
    });
    h._wired = true;
  }
}

function applyRailsHidden(hidden) {
  const root = document.querySelector('.game-layout');
  if (!root) return;
  root.classList.toggle('rails-hidden', hidden);
  const btn = document.getElementById('btn-toggle-rails');
  if (btn) {
    btn.classList.toggle('active', hidden);
    btn.textContent = hidden ? 'Show rails' : 'Hide rails';
  }
}

document.getElementById('btn-toggle-rails')?.addEventListener('click', () => {
  const root = document.querySelector('.game-layout');
  const next = !root.classList.contains('rails-hidden');
  applyRailsHidden(next);
  try { localStorage.setItem(RAILS_STATE_KEY, next ? '1' : '0'); } catch {}
});

// Restore on first render of the game screen.
function initGameUIChrome() {
  wirePanelCollapse();
  applyRailsHidden(localStorage.getItem(RAILS_STATE_KEY) === '1');
  wireHandOverlays();
  wireOptionsMenu();
}

// ---------- Options ⚙ dropdown menu ----------
// R5 collapses the secondary header buttons (Hide rails, Zargon speed,
// Leave Quest) into a single ⚙ button. Anyone in the room can change
// pacing or hide rails; Leave Quest still goes through confirm().
function wireOptionsMenu() {
  const btn  = document.getElementById('btn-options-menu');
  const menu = document.getElementById('options-menu');
  if (!btn || !menu) return;
  if (btn._wired) return;
  btn._wired = true;

  // Lift the menu out of the parchment ancestor chain — the parchment's
  // ::before pseudo uses mix-blend-mode which creates a stacking context
  // that traps fixed-position descendants underneath things like the
  // treasure deck card. Re-parenting to <body> puts the menu in the
  // root stacking context where its z-index actually wins.
  if (menu.parentNode !== document.body) document.body.appendChild(menu);

  function positionMenu() {
    // Anchor the right edge of the menu under the right edge of the
    // button, hanging straight down with a 6px gap. Clamped to viewport.
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 230;
    const mh = menu.offsetHeight || 200;
    let right = window.innerWidth - r.right;
    let top   = r.bottom + 6;
    // If it would extend off the bottom, flip above the button.
    if (top + mh > window.innerHeight - 4) top = Math.max(4, r.top - 6 - mh);
    if (right < 4) right = 4;
    menu.style.right = `${Math.round(right)}px`;
    menu.style.left  = 'auto';
    menu.style.top   = `${Math.round(top)}px`;
  }

  const open  = () => {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('active');
    requestAnimationFrame(positionMenu);
  };
  const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('active'); };
  const toggle = () => { menu.classList.contains('hidden') ? open() : close(); };

  // Keep the menu pinned to the button if the window resizes while open
  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  btn.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });

  // Click outside → close. Wire once on the document.
  document.addEventListener('click', (ev) => {
    if (menu.classList.contains('hidden')) return;
    if (menu.contains(ev.target) || btn.contains(ev.target)) return;
    close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !menu.classList.contains('hidden')) close();
  });

  // Item clicks
  menu.addEventListener('click', (ev) => {
    const item = ev.target.closest('.item');
    if (!item) return;
    const opt = item.dataset.opt;
    if (opt === 'hide-rails') {
      const root = document.querySelector('.game-layout');
      const next = !root.classList.contains('rails-hidden');
      applyRailsHidden(next);
      try { localStorage.setItem(RAILS_STATE_KEY, next ? '1' : '0'); } catch {}
      syncOptionsMenuState(lastView);
    } else if (opt === 'floor-textures') {
      FLOOR_TEXTURES_ON = !FLOOR_TEXTURES_ON;
      try { localStorage.setItem(TEXTURES_STATE_KEY, FLOOR_TEXTURES_ON ? '1' : '0'); } catch {}
      syncOptionsMenuState(lastView);
      if (lastView) drawBoard(lastView);
    } else if (opt === 'light-walls') {
      LIGHT_WALLS_ON = !LIGHT_WALLS_ON;
      try { localStorage.setItem(LIGHT_WALLS_KEY, LIGHT_WALLS_ON ? '1' : '0'); } catch {}
      syncOptionsMenuState(lastView);
      if (lastView) drawBoard(lastView);
    } else if (opt === 'outer-walls') {
      OUTER_WALLS_ON = !OUTER_WALLS_ON;
      try { localStorage.setItem(OUTER_WALLS_KEY, OUTER_WALLS_ON ? '1' : '0'); } catch {}
      syncOptionsMenuState(lastView);
      if (lastView) drawBoard(lastView);
    } else if (opt === 'alt-furn') {
      ALT_FURN_ON = !ALT_FURN_ON;
      try { localStorage.setItem(FURN_ALT_KEY, ALT_FURN_ON ? '1' : '0'); } catch {}
      syncOptionsMenuState(lastView);
      if (lastView) drawBoard(lastView);
    } else if (opt === 'zargon-speed') {
      const cur = Math.max(1, Math.min(4, lastView?.config?.aiSpeed || 1));
      const next = cur >= 4 ? 1 : cur + 1;
      send({ type: 'setAiSpeed', value: next });
    } else if (opt === 'leave-quest') {
      if (confirm('Leave this quest and return to the lobby? Progress on this quest will be lost.')) {
        send({ type: 'leaveQuest' });
      }
      close();
    }
  });
}

// Reflect the room's current settings into the menu's toggle/value
// states. Called once per render so it stays accurate after server
// broadcasts (other players may change pacing, etc.).
function syncOptionsMenuState(view) {
  const railsToggle = document.getElementById('opt-hide-rails-state');
  if (railsToggle) {
    const root = document.querySelector('.game-layout');
    const hidden = !!(root && root.classList.contains('rails-hidden'));
    railsToggle.classList.toggle('on', hidden);
  }
  const texToggle = document.getElementById('opt-floor-textures-state');
  if (texToggle) texToggle.classList.toggle('on', !!FLOOR_TEXTURES_ON);
  const lwToggle = document.getElementById('opt-light-walls-state');
  if (lwToggle) lwToggle.classList.toggle('on', !!LIGHT_WALLS_ON);
  const owToggle = document.getElementById('opt-outer-walls-state');
  if (owToggle) owToggle.classList.toggle('on', !!OUTER_WALLS_ON);
  const afToggle = document.getElementById('opt-alt-furn-state');
  if (afToggle) afToggle.classList.toggle('on', !!ALT_FURN_ON);
  const speedVal = document.getElementById('opt-zargon-speed-value');
  if (speedVal && view) {
    const s = Math.max(1, Math.min(4, view.config?.aiSpeed || 1));
    speedVal.textContent = `×${s}`;
  }
}

// ---------- Inventory / Spellbook hand overlays ----------
function openOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
}
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
}
function wireHandOverlays() {
  const itemsBtn  = document.getElementById('btn-open-items');
  const spellsBtn = document.getElementById('btn-open-spells');
  if (itemsBtn && !itemsBtn._wired) {
    itemsBtn.addEventListener('click', () => openOverlay('items-overlay'));
    itemsBtn._wired = true;
  }
  if (spellsBtn && !spellsBtn._wired) {
    spellsBtn.addEventListener('click', () => openOverlay('spells-overlay'));
    spellsBtn._wired = true;
  }
  // Click outside the inner card, or click an element with data-dismiss,
  // closes the overlay. Wire once across the document.
  if (!document._handOverlayWired) {
    document.addEventListener('click', (ev) => {
      const dismissTarget = ev.target.closest('[data-dismiss]');
      if (dismissTarget) {
        closeOverlay(dismissTarget.dataset.dismiss);
        return;
      }
      // Click on the overlay backdrop itself (not on the inner card)
      const overlay = ev.target.closest('.modal[data-dismissable]');
      if (overlay && ev.target === overlay) {
        closeOverlay(overlay.id);
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      for (const id of ['items-overlay', 'spells-overlay']) {
        closeOverlay(id);
      }
    });
    document._handOverlayWired = true;
  }
}

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
  renderLog(view);

  // Treasure deck badge — number of cards remaining on top of the deck back.
  const tcCount = document.getElementById('treasure-deck-count');
  if (tcCount) tcCount.textContent = (view.treasureDeckCount != null) ? view.treasureDeckCount : '—';
  const tcCap = document.getElementById('treasure-deck-caption-count');
  if (tcCap) tcCap.textContent = (view.treasureDeckCount != null) ? view.treasureDeckCount : '—';

  // Sync the ⚙ options menu state (rails hidden, Zargon speed)
  syncOptionsMenuState(view);

  // Board
  drawBoard(view);

  // Combat modal
  if (view.combat && view.combat.ts !== lastCombatTs) {
    lastCombatTs = view.combat.ts;
    showCombatModal(view.combat);
  }

  // Treasure card reveal modal
  const tcKey = view.revealedTreasureCard
    ? `${view.revealedTreasureCard.drawnBy}-${view.revealedTreasureCard.id}-${view.log.length}`
    : null;
  if (tcKey && tcKey !== lastTreasureCardKey) {
    lastTreasureCardKey = tcKey;
    showTreasureCardModal(view.revealedTreasureCard);
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
  renderSpellsPane(view);
  renderItemsPane(view);
  updateTabCounts(view);
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

// ----- Sidebar tab panes (Spells / Items) -----------------------------
// These were previously stuffed into the Actions card as sub-sections.
// Splitting them out reduces the right-rail to one focused panel at a
// time (Drucker: cut to essential; Doumont: hierarchy by frequency).
function renderSpellsPane(view) {
  const el = document.getElementById('spells-body');
  if (!el) return;
  el.innerHTML = '';
  const cur = view.currentTurn;
  if (cur?.kind !== 'hero' || !view.myTurn) {
    el.innerHTML = '<p class="muted small">No spells available right now.</p>';
    return;
  }
  const h = view.heroes.find(x => x.id === cur.heroId);
  if (!h || !h.spellHand || h.spellHand.length === 0) {
    el.innerHTML = '<p class="muted small">No spells in hand.</p>';
    return;
  }
  const sg = document.createElement('div');
  sg.className = 'spell-grid';
  for (const sp of h.spellHand) {
    const b = document.createElement('button');
    b.className = `spell-card el-${sp.element}`;
    if (pendingSpell && pendingSpell.id === sp.id) b.classList.add('active');
    b.innerHTML = `<div class="sp-name">${sp.name}</div><div class="sp-el">${sp.element.toUpperCase()}</div>`;
    b.title = sp.text || '';
    b.disabled = view.actionUsed && !(h.equipped.artifactItem === 'wand-of-recall');
    b.addEventListener('click', () => onSpellClick(sp, h, view));
    sg.appendChild(b);
  }
  el.appendChild(sg);
}

function renderItemsPane(view) {
  const el = document.getElementById('items-body');
  if (!el) return;
  el.innerHTML = '';
  const cur = view.currentTurn;
  if (cur?.kind !== 'hero' || !view.myTurn) {
    el.innerHTML = '<p class="muted small">No inventory available right now.</p>';
    return;
  }
  const h = view.heroes.find(x => x.id === cur.heroId);
  if (!h || !h.inventory || h.inventory.length === 0) {
    el.innerHTML = '<p class="muted small">Inventory is empty.</p>';
    return;
  }
  for (const it of h.inventory) {
    const ib = document.createElement('button');
    ib.className = 'inv-row';
    ib.textContent = it.name;
    ib.title = `Use ${it.name}`;
    ib.addEventListener('click', () => action('useItem', { itemIndex: it.idx }));
    el.appendChild(ib);
  }
}

function updateTabCounts(view) {
  const sc = document.getElementById('spells-count');
  const ic = document.getElementById('items-count');
  const cur = view.currentTurn;
  let spells = 0, items = 0;
  if (cur?.kind === 'hero') {
    const h = view.heroes.find(x => x.id === cur.heroId);
    if (h) {
      spells = (h.spellHand || []).length;
      items = (h.inventory || []).length;
    }
  }
  if (sc) sc.textContent = spells > 0 ? `(${spells})` : '';
  if (ic) ic.textContent = items > 0 ? `(${items})` : '';
  // Mirror the counts onto the action-panel buttons that open the
  // Inventory / Spellbook overlays.
  const bi = document.getElementById('btn-items-count');
  const bs = document.getElementById('btn-spells-count');
  if (bi) bi.textContent = items;
  if (bs) bs.textContent = spells;
  // Dim the buttons when there's nothing inside (still clickable, but
  // visually quiet — your hero might not have anything yet).
  const btnItems  = document.getElementById('btn-open-items');
  const btnSpells = document.getElementById('btn-open-spells');
  if (btnItems)  btnItems.classList.toggle('empty', items === 0);
  if (btnSpells) btnSpells.classList.toggle('empty', spells === 0);
}

// Sidebar tab switcher — purely visual (Actions / Spells / Items / Log).
function setSidebarTab(name) {
  for (const b of document.querySelectorAll('#sidebar-tabs button')) {
    b.classList.toggle('active', b.dataset.stab === name);
  }
  for (const p of document.querySelectorAll('[data-stab-content]')) {
    p.classList.toggle('hidden', p.dataset.stabContent !== name);
  }
}
for (const b of document.querySelectorAll('#sidebar-tabs button')) {
  b.addEventListener('click', () => setSidebarTab(b.dataset.stab));
}

function renderLog(view) {
  const log = document.getElementById('log');
  log.innerHTML = '';
  for (const e of view.log) {
    const div = document.createElement('div');
    div.className = `entry ${e.cls || ''}`;
    div.textContent = e.text;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

// ---------- Floor textures (optional overlay) -------------------------
// Same texture system the builder + map-editor use. Gated by the
// FLOOR_TEXTURES_ON preference (Options menu → Floor textures).
// Renders ONLY revealed cells (fog-of-war respected) by clipping to
// the union of each room's / corridor's revealed tile rects.
const FLOORS_VER = 3;
function roomTextureFile(roomId) {
  const m = String(roomId).match(/(\d+)/);
  return m ? `room_${m[1].padStart(2, '0')}.png` : null;
}
const ROOM_TEX = {};   // roomId → { img, ready }
function loadRoomTexture(roomId) {
  if (ROOM_TEX[roomId]) return ROOM_TEX[roomId];
  const file = roomTextureFile(roomId);
  const img = new Image();
  const entry = { img, ready: false };
  ROOM_TEX[roomId] = entry;
  if (!file) { ROOM_TEX[roomId] = { img: null, ready: false, error: true }; return ROOM_TEX[roomId]; }
  img.onload  = () => { entry.ready = true; if (lastView) drawBoard(lastView); };
  img.onerror = () => { ROOM_TEX[roomId] = { img: null, ready: false, error: true }; };
  img.src = `/assets/room_textures/${file}?v=${FLOORS_VER}`;
  return entry;
}
const CORRIDOR_TEX = {};   // file → { img, ready }
function loadCorridorTexture(file) {
  if (CORRIDOR_TEX[file]) return CORRIDOR_TEX[file];
  const img = new Image();
  const entry = { img, ready: false };
  CORRIDOR_TEX[file] = entry;
  img.onload  = () => { entry.ready = true; if (lastView) drawBoard(lastView); };
  img.onerror = () => { CORRIDOR_TEX[file] = { img: null, ready: false, error: true }; };
  img.src = `/assets/room_textures/${file}?v=${FLOORS_VER}`;
  return entry;
}
// Default: corridor without walls (corridor walls live in the room
// textures + drawWalls). If a quest ever wants the printed wall frame
// we can expose another toggle later.
function currentCorridorTexture() { return loadCorridorTexture('corridor_no_walls.png'); }

// Room bbox cache from master board.yaml. Fetched lazily on first
// texture render. We need the full bbox (not just revealed cells)
// because the per-room PNG is stretched across the room's entire
// footprint; each revealed cell then samples its correct slice.
let ROOM_BBOX = null;             // { [roomId]: { mc, mr, spanC, spanR } }
let ROOM_BBOX_LOADING = false;
async function loadRoomBbox() {
  if (ROOM_BBOX || ROOM_BBOX_LOADING) return;
  ROOM_BBOX_LOADING = true;
  try {
    const r = await fetch('/api/board');
    if (!r.ok) return;
    const b = await r.json();
    const bbox = {};
    for (const room of (b.rooms || [])) {
      let mc = 99, mr = 99, xc = -1, xr = -1;
      for (const [c, rr] of (room.cells || [])) {
        if (c < mc) mc = c; if (rr < mr) mr = rr;
        if (c > xc) xc = c; if (rr > xr) xr = rr;
      }
      bbox[room.id] = { mc, mr, spanC: xc - mc + 1, spanR: xr - mr + 1 };
    }
    ROOM_BBOX = bbox;
    if (lastView) drawBoard(lastView);
  } catch { /* leave null — textures simply won't render until next try */ }
  finally { ROOM_BBOX_LOADING = false; }
}

// Render textures over the base floor tiles. Called after the tile
// loop in drawBoard. Only paints over REVEALED tiles so fog of war is
// preserved. Each room is one drawImage stretched to its bbox area,
// clipped to revealed cells of that room — same "blit once + clip"
// pattern as the builder/tool.
function drawFloorTextures(view, tm) {
  if (!FLOOR_TEXTURES_ON) return;
  if (!ROOM_BBOX) { loadRoomBbox(); return; }
  const [W, H] = view.boardSize;

  // Group revealed, non-blocked tiles by zone. Blocked tiles render
  // their rubble icon over a floor base painted in drawTile (see the
  // blocked branch there) so the floor texture is NOT drawn over the
  // rubble.
  const byRoom = new Map();         // roomId → [tile,...]
  const corridorTiles = [];
  for (const t of view.tiles) {
    if (!t.revealed || t.blocked) continue;
    if (t.roomId && t.kind !== 'corridor') {
      if (!byRoom.has(t.roomId)) byRoom.set(t.roomId, []);
      byRoom.get(t.roomId).push(t);
    } else if (t.kind === 'corridor') {
      corridorTiles.push(t);
    }
  }
  // Rooms — one blit + clip per room
  for (const [roomId, tiles] of byRoom) {
    const bbox = ROOM_BBOX[roomId];
    if (!bbox) continue;
    const tex = loadRoomTexture(roomId);
    if (!tex.ready || !tex.img) continue;
    ctx.save();
    ctx.beginPath();
    for (const t of tiles) ctx.rect(t.x * CELL, t.y * CELL, CELL, CELL);
    ctx.clip();
    ctx.drawImage(tex.img,
                  0, 0, tex.img.naturalWidth, tex.img.naturalHeight,
                  bbox.mc * CELL, bbox.mr * CELL,
                  bbox.spanC * CELL, bbox.spanR * CELL);
    ctx.restore();
  }
  // Corridor — single blit stretched across the playable rect
  if (corridorTiles.length) {
    const cor = currentCorridorTexture();
    if (cor.ready && cor.img) {
      ctx.save();
      ctx.beginPath();
      for (const t of corridorTiles) ctx.rect(t.x * CELL, t.y * CELL, CELL, CELL);
      ctx.clip();
      ctx.drawImage(cor.img,
                    0, 0, cor.img.naturalWidth, cor.img.naturalHeight,
                    0, 0, W * CELL, H * CELL);
      ctx.restore();
    }
  }
}

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
  drawFloorTextures(view, tm);
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
    drawTreasure(t);
  }
  // Secret doors
  for (const d of (view.secretDoors || [])) {
    drawSecretDoor(d);
  }
  // Traps (revealed only — gmOnly traps for GM view are dimmed)
  for (const tr of (view.traps || [])) {
    drawTrap(tr);
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
  for (const h of view.heroes) drawHero(h, view.currentTurn?.kind === 'hero' && view.currentTurn.heroId === h.id);
  // Monsters
  for (const m of view.monsters) drawMonster(m, selectedGMMonsterId === m.id);

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
  if (FLOOR_TEXTURES_ON) return;
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
  const wallColour = LIGHT_WALLS_ON ? '#e6d9bd' : '#1c1208';
  if (LIGHT_WALLS_ON) ctx.fillStyle = wallColour;
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
      if (isOuter && !OUTER_WALLS_ON) continue;
      if (hasDoor([t.x, t.y], [t.x + s.dx, t.y + s.dy])) continue;
      if (LIGHT_WALLS_ON) {
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

// ----- Heroscribe canonical icons -----------------------------------
// FURN_FILE + FURN_ALT_FILE are sourced at boot from
// /api/canonical-pieces (which reads data/canonical-pieces.yaml). The
// hardcoded FALLBACK keeps the game rendering while the fetch is in
// flight, and works as a self-contained offline default. Adding a new
// piece is now a single YAML entry — server + all three frontends
// pick it up on reload.
const _f = (file, natural = 'downward', dir = 'furniture') => ({ file, natural, dir });
const FURN_FILE_FALLBACK = {
  'tomb':              _f('Tomb.png'),
  'sarcophagus':       _f('Tomb.png'),
  'sorcerer-table':    _f('SorcerersTable.png'),
  'sorcerers-table':   _f('SorcerersTable.png'),
  'alchemist-table':   _f('AlchemistsBench.png', 'upward'),
  'alchemist-bench':   _f('AlchemistsBench.png', 'upward'),
  'alchemists-bench':  _f('AlchemistsBench.png', 'upward'),
  'table':             _f('Table.png'),
  'bookcase':          _f('Bookcase.png'),
  'cupboard':          _f('Cupboard.png'),
  'fireplace':         _f('Fireplace.png'),
  'weapon-rack':       _f('WeaponsRack.png'),
  'rack':              _f('Rack.png'),
  'chest':             _f('TreasureChest.png'),
  'throne':            _f('Throne.png'),
  'stairway':          _f('Stairway.png', 'downward', 'tiles'),
};
const FURN_ALT_FILE_FALLBACK = {
  'tomb':             'Tomb-2x3.png',
  'sarcophagus':      'Tomb-2x3.png',
  'sorcerer-table':   'Sorcerer Table-2x3.png',
  'sorcerers-table':  'Sorcerer Table-2x3.png',
  'alchemist-table':  'Alchemist Bench-2x3.png',
  'alchemist-bench':  'Alchemist Bench-2x3.png',
  'alchemists-bench': 'Alchemist Bench-2x3.png',
  'table':            'Table-2x3.png',
  'bookcase':         'Bookcase-1x3.png',
  'cupboard':         'Cupboard-1x3.png',
  'fireplace':        'Fireplace-1x3.png',
  'weapon-rack':      'Weapons Rack-1x3.png',
  'rack':             'Rack-2x3.png',
  'chest':            'Chest-1x1.png',
  'throne':           'Throne-1x1.png',
};
let FURN_FILE     = { ...FURN_FILE_FALLBACK };
let FURN_ALT_FILE = { ...FURN_ALT_FILE_FALLBACK };
function applyCanonicalPieces(yamlData) {
  const pieces = (yamlData && yamlData.pieces) || {};
  const flat = {};
  const alt  = {};
  for (const pieceId of Object.keys(pieces)) {
    const p = pieces[pieceId] || {};
    if (!p.file || !Array.isArray(p.aliases)) continue;
    for (const alias of p.aliases) {
      flat[alias] = { file: p.file, natural: p.naturalDir || 'downward', dir: p.dir || 'furniture' };
      if (p.altFile) alt[alias] = p.altFile;
    }
  }
  if (Object.keys(flat).length) {
    FURN_FILE = flat;
    FURN_ALT_FILE = alt;
    // Wipe per-art-set image caches so getFurnImg re-resolves with the
    // refreshed FURN_FILE / FURN_ALT_FILE on next draw.
    for (const k of Object.keys(FURN_IMG))     delete FURN_IMG[k];
    for (const k of Object.keys(FURN_IMG_ALT)) delete FURN_IMG_ALT[k];
    if (lastView) drawBoard(lastView);
  }
}
(async () => {
  try {
    const r = await fetch('/api/canonical-pieces');
    if (r.ok) applyCanonicalPieces(await r.json());
  } catch { /* offline → keep fallback */ }
})();

// Furniture natural-orientation overrides — set in the map editor's
// playground and persisted to data/furniture-naturals.json on the
// server. Applied on top of the hardcoded FURN_FILE defaults so the
// live game inherits whatever the user dialled in via the editor.
//
// localStorage is kept as a fast-path cache so the game has SOMETHING
// to render before the GET completes; the `storage` event keeps tabs
// in sync so an editor change in another tab live-updates the running
// game. Source of truth on reload is always the server file.
const FURN_NATURAL_LS_KEY = 'hq_furn_natural_overrides_v1';
function readFurnNaturalsLocal() {
  try { return JSON.parse(localStorage.getItem(FURN_NATURAL_LS_KEY) || '{}') || {}; }
  catch { return {}; }
}
let FURN_NATURAL_OVERRIDES = readFurnNaturalsLocal();
function applyFurnNaturals(map) {
  FURN_NATURAL_OVERRIDES = map || {};
  // Each cache uses its own override key — canonical reads `type`,
  // alt reads `${type}:alt`. Fall back to the file's default natural.
  for (const t of Object.keys(FURN_IMG)) {
    if (FURN_IMG[t]) {
      const def = FURN_FILE[t];
      FURN_IMG[t].natural = FURN_NATURAL_OVERRIDES[t] || (def && def.natural) || 'downward';
    }
  }
  for (const t of Object.keys(FURN_IMG_ALT)) {
    if (FURN_IMG_ALT[t]) {
      const def = FURN_FILE[t];
      FURN_IMG_ALT[t].natural = FURN_NATURAL_OVERRIDES[t + ':alt'] || (def && def.natural) || 'downward';
    }
  }
  if (lastView) drawBoard(lastView);
}
// Server is source of truth — fetch on boot, then keep the localStorage
// cache in sync.
fetch('/api/furn-naturals').then(r => r.ok ? r.json() : null).then(j => {
  if (j && typeof j === 'object') {
    try { localStorage.setItem(FURN_NATURAL_LS_KEY, JSON.stringify(j)); } catch {}
    applyFurnNaturals(j);
  }
}).catch(() => {});
// Cross-tab live updates from the editor's playground panel.
window.addEventListener('storage', e => {
  if (e.key !== FURN_NATURAL_LS_KEY) return;
  applyFurnNaturals(readFurnNaturalsLocal());
});

// Alternate furniture art — sized-name PNGs (Tomb-2x3.png, etc.).
// FURN_ALT_FILE is populated by the canonical-pieces fetch above
// (FURN_ALT_FILE_FALLBACK keeps things rendering in the meantime).
// Toggleable via the Options menu's "Alt furniture art" item; shared
// localStorage key with the editor + builder so all three surfaces
// stay visually consistent.
const FURN_ALT_KEY = 'hq_furn_alt_v1';
let ALT_FURN_ON = (() => {
  try { return localStorage.getItem(FURN_ALT_KEY) === '1'; }
  catch { return false; }
})();
window.addEventListener('storage', (e) => {
  if (e.key === FURN_ALT_KEY) {
    ALT_FURN_ON = e.newValue === '1';
    if (lastView) drawBoard(lastView);
  }
});

// Two caches — one per art set — so toggling alt vs canonical doesn't
// blow away images already in memory.
const FURN_IMG     = {};   // canonical art cache
const FURN_IMG_ALT = {};   // alt art cache
function getFurnImg(type) {
  const def = FURN_FILE[type];
  if (!def) return null;
  const useAlt = ALT_FURN_ON && !!FURN_ALT_FILE[type];
  const cache = useAlt ? FURN_IMG_ALT : FURN_IMG;
  if (cache[type] !== undefined) return cache[type];
  const file = useAlt ? FURN_ALT_FILE[type] : def.file;
  // Per-art-set natural override — alt key `${type}:alt`, canonical key `type`.
  const overrideKey = useAlt ? type + ':alt' : type;
  const natural = FURN_NATURAL_OVERRIDES[overrideKey] || def.natural;
  const img = new Image();
  const entry = { img, ready: false, natural };
  cache[type] = entry;
  img.onload  = () => { entry.ready = true; if (lastView) drawBoard(lastView); };
  img.onerror = () => { cache[type] = null; };
  img.src = `/assets/${def.dir || 'furniture'}/${file}`;
  return entry;
}

// ----- Tile icons (rubble + trap markers) ---------------------------
// Map a logical tile kind to a PNG in /assets/tiles/. Used by the
// blocked-tile and trap renderers to replace hand-drawn glyphs.
const TILE_FILE = {
  // rubble / blocked
  'rubble':         'SingleBlockedSquare.png',
  'rubble-double':  'DoubleBlockedSquare.png',
  'falling-block':  'FallingRock.png',
  'block':          'FallingRock.png',
  // traps
  'pit':            'PitTrap.png',
  'spear':          'SpearTrap.png',
  'spear-trap':     'SpearTrap.png',
  'pit-trap':       'PitTrap.png',
  'chest-trap':     'TreasureChestTrap.png',
};
const TILE_IMG = {};
function getTileImg(kind) {
  if (TILE_IMG[kind] !== undefined) return TILE_IMG[kind];
  const fn = TILE_FILE[kind];
  if (!fn) { TILE_IMG[kind] = null; return null; }
  const img = new Image();
  const entry = { img, ready: false };
  TILE_IMG[kind] = entry;
  img.onload  = () => { entry.ready = true; if (lastView) drawBoard(lastView); };
  img.onerror = () => { TILE_IMG[kind] = null; };
  img.src = `/assets/tiles/${fn}`;
  return entry;
}
function drawTileIcon(kind, px, py, pw, ph) {
  const e = getTileImg(kind);
  if (!e || !e.ready) return false;
  const img = e.img;
  const cellsW = Math.max(1, Math.round(pw / CELL));
  const cellsH = Math.max(1, Math.round(ph / CELL));
  const inset  = tileInsetForBbox(cellsW, cellsH);
  const slotW = pw - 2 * inset;
  const slotH = ph - 2 * inset;
  const ar = img.naturalWidth / img.naturalHeight;
  let drawW = slotW, drawH = slotW / ar;
  if (drawH > slotH) { drawH = slotH; drawW = slotH * ar; }
  ctx.drawImage(img, px + (pw - drawW) / 2, py + (ph - drawH) / 2, drawW, drawH);
  return true;
}

// Draw a furniture piece using its canonical image, rotated for facing.
// Returns true if drawn, false if no image (caller falls back to pixel art).
//
// "contain" fit: the image keeps its natural aspect ratio and is
// centred inside the bbox (with small empty padding when aspects differ
// from the cell-grid footprint). This avoids the "stretched look" you
// get from forcing 33×23 into a 32×32 cell or 91×59 into 96×64.
// Per-shape furniture inset (px gap between icon and cell wall).
// Four buckets — small (1×1), linear (Nx1), stair (2×2), block (else).
// Read from the same localStorage key the editor's sliders write so
// the live game inherits whatever values you tuned in the tool.
// Per-art-set insets — canonical and alt art keep independent values
// since they have different proportions. Active set follows
// ALT_FURN_ON. Editor + builder write to these same keys.
const FURN_INSETS_LS_KEY     = 'hq_furn_insets_v2';
const FURN_INSETS_ALT_LS_KEY = 'hq_furn_insets_alt_v1';
const DEFAULT_FURN_INSETS = { small: 5, linear: 5, stair: 6, block: 12 };
function _readFurnInsetsFrom(key) {
  try {
    const j = JSON.parse(localStorage.getItem(key) || '{}');
    const clamp = v => Math.max(0, Math.min(20, parseInt(v, 10) || 0));
    return {
      small:  Number.isFinite(j.small)  ? clamp(j.small)  : DEFAULT_FURN_INSETS.small,
      linear: Number.isFinite(j.linear) ? clamp(j.linear) : DEFAULT_FURN_INSETS.linear,
      stair:  Number.isFinite(j.stair)  ? clamp(j.stair)  : DEFAULT_FURN_INSETS.stair,
      block:  Number.isFinite(j.block)  ? clamp(j.block)  : DEFAULT_FURN_INSETS.block,
    };
  } catch { return { ...DEFAULT_FURN_INSETS }; }
}
let FURN_INSETS_CANON = _readFurnInsetsFrom(FURN_INSETS_LS_KEY);
let FURN_INSETS_ALT   = _readFurnInsetsFrom(FURN_INSETS_ALT_LS_KEY);
function activeFurnInsets() { return ALT_FURN_ON ? FURN_INSETS_ALT : FURN_INSETS_CANON; }
window.addEventListener('storage', e => {
  if (e.key === FURN_INSETS_LS_KEY)     FURN_INSETS_CANON = _readFurnInsetsFrom(FURN_INSETS_LS_KEY);
  else if (e.key === FURN_INSETS_ALT_LS_KEY) FURN_INSETS_ALT = _readFurnInsetsFrom(FURN_INSETS_ALT_LS_KEY);
  else return;
  if (lastView) drawBoard(lastView);
});
function insetForBbox(cellsW, cellsH) {
  const FURN_INSETS = activeFurnInsets();
  const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
  if (mx <= 1) return FURN_INSETS.small;
  if (mn <= 1) return FURN_INSETS.linear;
  if (mn === 2 && mx === 2) return FURN_INSETS.stair;
  return FURN_INSETS.block;
}

// Tile-icon insets (rubble + traps). Same shape as the furniture
// buckets; tuned independently because tile art is generally smaller.
const TILE_INSETS_LS_KEY = 'hq_tile_insets_v1';
const DEFAULT_TILE_INSETS = { small: 4, linear: 4, block: 6 };
function _readTileInsets() {
  try {
    const j = JSON.parse(localStorage.getItem(TILE_INSETS_LS_KEY) || '{}');
    const clamp = v => Math.max(0, Math.min(20, parseInt(v, 10) || 0));
    return {
      small:  Number.isFinite(j.small)  ? clamp(j.small)  : DEFAULT_TILE_INSETS.small,
      linear: Number.isFinite(j.linear) ? clamp(j.linear) : DEFAULT_TILE_INSETS.linear,
      block:  Number.isFinite(j.block)  ? clamp(j.block)  : DEFAULT_TILE_INSETS.block,
    };
  } catch { return { ...DEFAULT_TILE_INSETS }; }
}
let TILE_INSETS = _readTileInsets();
window.addEventListener('storage', e => {
  if (e.key !== TILE_INSETS_LS_KEY) return;
  TILE_INSETS = _readTileInsets();
  if (lastView) drawBoard(lastView);
});
function tileInsetForBbox(cellsW, cellsH) {
  const mn = Math.min(cellsW, cellsH), mx = Math.max(cellsW, cellsH);
  if (mx <= 1) return TILE_INSETS.small;
  if (mn <= 1) return TILE_INSETS.linear;
  return TILE_INSETS.block;
}
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
  const flipH = ALT_FURN_ON ? !!f._altFlipH : !!f._flipH;
  const flipV = ALT_FURN_ON ? !!f._altFlipV : !!f._flipV;
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

  switch (type) {
    case 'table':            drawTable(px, py, pw, ph); break;
    case 'chest':            drawChest(px, py, pw, ph); break;
    case 'throne':           drawThrone(px, py, pw, ph); break;
    case 'sarcophagus':
    case 'tomb':             drawTomb(px, py, pw, ph); break;
    case 'weapon-rack':      drawWeaponRack(px, py, pw, ph); break;
    case 'rack':             drawSkullRack(px, py, pw, ph); break;
    case 'bookcase':         drawBookcase(px, py, pw, ph); break;
    case 'alchemist-bench':
    case 'alchemists-bench': drawAlchemistBench(px, py, pw, ph); break;
    case 'fireplace':        drawFireplace(px, py, pw, ph); break;
    case 'cupboard':         drawCupboard(px, py, pw, ph); break;
    case 'sorcerer-table':
    case 'sorcerers-table':  drawSorcererTable(px, py, pw, ph); break;
    default:                 drawGenericFurniture(px, py, pw, ph); break;
  }

  if (angle !== 0) ctx.restore();
}

// Per-tile fallback used only when the server view is older and doesn't
// emit `view.furniture`. Forwards each tile to the (now piece-aware)
// helpers at default 1x1 size.
function drawFurniture(t) {
  const x = t.x * CELL, y = t.y * CELL;
  const type = t.furnitureType || 'block';
  if (drawFurniturePieceImage(type, x, y, CELL, CELL, t.facing)) return;
  switch (type) {
    case 'table':            return drawTable(x, y);
    case 'chest':            return drawChest(x, y);
    case 'throne':           return drawThrone(x, y);
    case 'sarcophagus':
    case 'tomb':             return drawTomb(x, y);
    case 'weapon-rack':      return drawWeaponRack(x, y);
    case 'rack':             return drawSkullRack(x, y);
    case 'bookcase':         return drawBookcase(x, y);
    case 'alchemist-bench':
    case 'alchemists-bench': return drawAlchemistBench(x, y);
    case 'fireplace':        return drawFireplace(x, y);
    case 'cupboard':         return drawCupboard(x, y);
    case 'sorcerer-table':
    case 'sorcerers-table':  return drawSorcererTable(x, y);
    default:                 return drawGenericFurniture(x, y);
  }
}

function drawGenericFurniture(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#3e2a16';
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.strokeStyle = '#1c1208';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
}

// --- Table: long wooden plank with leg dots at each end
function drawTable(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#7a4a1c';
  ctx.fillRect(x + 3, y + 8, w - 6, h - 16);
  ctx.strokeStyle = '#3e2208';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 3, y + 8, w - 6, h - 16);
  // wood-grain — span the full width
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
  for (const dy of [0, 6]) {
    if (y + 12 + dy >= y + h - 8) break;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 12 + dy); ctx.lineTo(x + w - 5, y + 12 + dy);
    ctx.stroke();
  }
  // legs: at the four corners of the table footprint
  ctx.fillStyle = '#3e2208';
  ctx.fillRect(x + 5, y + h - 8, 3, 5);
  ctx.fillRect(x + w - 8, y + h - 8, 3, 5);
}

// --- Chest: rounded-top box with a brass band + lock (canonical 1x1)
function drawChest(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#6e4520';
  ctx.fillRect(x + 6, y + 12, w - 12, h - 18);
  // arched lid
  ctx.fillStyle = '#8b5a2b';
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 12);
  ctx.quadraticCurveTo(x + w/2, y + 4, x + w - 6, y + 12);
  ctx.lineTo(x + w - 6, y + 14);
  ctx.lineTo(x + 6, y + 14);
  ctx.closePath();
  ctx.fill();
  // metal band
  ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + w/2, y + 6); ctx.lineTo(x + w/2, y + h - 8);
  ctx.stroke();
  // outline
  ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 6, y + 12, w - 12, h - 18);
  // lock
  ctx.fillStyle = '#c8a040';
  ctx.fillRect(x + w/2 - 2, y + 18, 4, 4);
}

// --- Throne: chair with high arched back + cushion (canonical 1x1)
function drawThrone(x, y, w = CELL, h = CELL) {
  // back
  ctx.fillStyle = '#5a2a4a';
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 6);
  ctx.lineTo(x + w - 6, y + 6);
  ctx.lineTo(x + w - 6, y + h - 6);
  ctx.lineTo(x + 6, y + h - 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#1c1208'; ctx.lineWidth = 1.5;
  ctx.stroke();
  // arched top
  ctx.fillStyle = '#3e1a36';
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 6);
  ctx.quadraticCurveTo(x + w/2, y - 2, x + w - 6, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // cushion
  ctx.fillStyle = '#c83030';
  ctx.fillRect(x + 9, y + 14, w - 18, h/2 - 6);
  // gold trim
  ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 9, y + 14, w - 18, h/2 - 6);
}

// --- Tomb / sarcophagus: rounded capsule with a cross. Cross sits at
// the head of the casket (centered horizontally for 2x1, top for 1x2).
function drawTomb(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#a09080';
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 6, w - 8, h - 12, 6);
  ctx.fill();
  ctx.strokeStyle = '#3e2e20'; ctx.lineWidth = 1.5;
  ctx.stroke();
  // cross at head — long axis aware
  const horizontal = w >= h;
  ctx.strokeStyle = '#1c1208'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (horizontal) {
    // cross at left third (head end)
    const cx = x + Math.min(w, CELL) / 2 + (w > CELL ? 0 : 0);
    const cy = y + h/2;
    ctx.moveTo(cx, y + 11); ctx.lineTo(cx, y + h - 11);
    ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy - 4);
  } else {
    const cx = x + w/2;
    ctx.moveTo(cx, y + 11); ctx.lineTo(cx, y + h - 11);
    ctx.moveTo(cx - 4, y + 15); ctx.lineTo(cx + 4, y + 15);
  }
  ctx.stroke();
}

// --- Weapon rack: vertical weapons standing on a backing plank.
// Number of weapons scales with width.
function drawWeaponRack(x, y, w = CELL, h = CELL) {
  // backing plank along the bottom
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(x + 2, y + h - 8, w - 4, 4);
  // weapons (vertical lines) — one every 6px across the width
  ctx.strokeStyle = '#a8a8a8'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  const tops = [6, 4, 8, 5, 7, 4, 6];
  let i = 0;
  for (let wx = 7; wx < w - 4; wx += 6) {
    const top = tops[i % tops.length];
    ctx.moveTo(x + wx, y + h - 7);
    ctx.lineTo(x + wx, y + top);
    i++;
  }
  ctx.stroke();
  // axe head on the rightmost weapon
  ctx.fillStyle = '#b8b8b8';
  ctx.beginPath();
  ctx.moveTo(x + w - 8, y + 5); ctx.lineTo(x + w - 4, y + 8); ctx.lineTo(x + w - 7, y + 10);
  ctx.closePath(); ctx.fill();
}

// --- Skull rack: small skulls on a plank (row spans full width)
// Skull / iron rack — for a multi-cell footprint (e.g. 2W × 3H per the
// canonical spec), draw two vertical wooden posts on the sides, multiple
// horizontal cross-bars, and a grid of skulls hanging on the bars.
function drawSkullRack(x, y, w = CELL, h = CELL) {
  // Two vertical posts on the left and right edges
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(x + 3, y + 3, 4, h - 6);
  ctx.fillRect(x + w - 7, y + 3, 4, h - 6);

  // Horizontal cross-bars — count proportional to height
  const barCount = Math.max(2, Math.round(h / 18));
  const rowSpacing = (h - 12) / Math.max(1, barCount);
  ctx.fillStyle = '#5a3a1c';
  for (let i = 0; i < barCount; i++) {
    const yy = Math.round(y + 6 + i * rowSpacing + rowSpacing * 0.7);
    ctx.fillRect(x + 5, yy, w - 10, 3);
  }

  // Skulls on each cross-bar
  const skullsPerRow = Math.max(1, Math.floor((w - 12) / 9));
  for (let row = 0; row < barCount; row++) {
    const yy = Math.round(y + 6 + row * rowSpacing + rowSpacing * 0.4);
    for (let col = 0; col < skullsPerRow; col++) {
      const sx = Math.round(x + 9 + col * (w - 18) / Math.max(1, skullsPerRow));
      ctx.fillStyle = '#e8e0d0';
      ctx.beginPath(); ctx.arc(sx, yy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c1208';
      ctx.fillRect(sx - 2, yy - 1, 1, 1);
      ctx.fillRect(sx + 1, yy - 1, 1, 1);
    }
  }
}

// --- Bookcase: shelves of books spanning the full footprint
function drawBookcase(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#3e2a16';
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  // 3 horizontal shelves
  ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1;
  for (const off of [10, 16, 22]) {
    if (y + off >= y + h - 4) break;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + off); ctx.lineTo(x + w - 5, y + off);
    ctx.stroke();
  }
  // book spines — fill the full width
  const colors = ['#c83030', '#3aa05a', '#5060d0', '#d0a040', '#c83030', '#3aa05a', '#5060d0', '#d0a040'];
  const bookCount = Math.floor((w - 12) / 4);
  for (let i = 0; i < bookCount; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x + 6 + i * 4, y + 11, 3, 4);
    ctx.fillRect(x + 6 + i * 4, y + 17, 3, 4);
  }
}

// --- Alchemist's bench: bottles on a long table
function drawAlchemistBench(x, y, w = CELL, h = CELL) {
  // table top
  ctx.fillStyle = '#7a4a1c';
  ctx.fillRect(x + 3, y + h - 12, w - 6, 6);
  ctx.strokeStyle = '#3e2208'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 3, y + h - 12, w - 6, 6);
  // bottles — distribute across the width
  const bottleCols = ['#5db4d8', '#3aa05a', '#c83030', '#d0a040', '#5db4d8'];
  const bottleCount = Math.max(3, Math.floor((w - 8) / 7));
  for (let i = 0; i < bottleCount; i++) {
    const bx = x + 6 + i * ((w - 12) / Math.max(1, bottleCount));
    ctx.fillStyle = bottleCols[i % bottleCols.length];
    ctx.fillRect(bx, y + 8, 4, h - 20);
    // neck
    ctx.fillStyle = '#3e2e20';
    ctx.fillRect(bx + 1, y + 6, 2, 2);
  }
}

// --- Fireplace: stone hearth with flame
function drawFireplace(x, y, w = CELL, h = CELL) {
  // stone surround
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(x + 3, y + 4, w - 6, h - 8);
  ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 3, y + 4, w - 6, h - 8);
  // opening
  ctx.fillStyle = '#1c0a04';
  ctx.fillRect(x + 8, y + 9, w - 16, h - 14);
  // outer flame
  ctx.fillStyle = '#e8801c';
  ctx.beginPath();
  ctx.moveTo(x + w/2, y + h - 8);
  ctx.quadraticCurveTo(x + 10, y + 16, x + w/2, y + 12);
  ctx.quadraticCurveTo(x + w - 10, y + 16, x + w/2, y + h - 8);
  ctx.fill();
  // inner flame
  ctx.fillStyle = '#fdd540';
  ctx.beginPath();
  ctx.moveTo(x + w/2, y + h - 10);
  ctx.quadraticCurveTo(x + 14, y + 18, x + w/2, y + 16);
  ctx.quadraticCurveTo(x + w - 14, y + 18, x + w/2, y + h - 10);
  ctx.fill();
}

// --- Cupboard: tall wardrobe with two doors (vertical seam)
function drawCupboard(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#6e4520';
  ctx.fillRect(x + 6, y + 4, w - 12, h - 8);
  ctx.strokeStyle = '#1c0e04'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 6, y + 4, w - 12, h - 8);
  // central seam
  ctx.beginPath();
  ctx.moveTo(x + w/2, y + 4); ctx.lineTo(x + w/2, y + h - 4);
  ctx.stroke();
  // handles either side of the seam, midway down
  ctx.fillStyle = '#c8a040';
  ctx.fillRect(x + w/2 - 4, y + h/2 - 1, 2, 2);
  ctx.fillRect(x + w/2 + 2, y + h/2 - 1, 2, 2);
}

// --- Sorcerer's table: dark table with arcane sigil
function drawSorcererTable(x, y, w = CELL, h = CELL) {
  ctx.fillStyle = '#2a1a3a';
  ctx.fillRect(x + 4, y + 8, w - 8, h - 14);
  ctx.strokeStyle = '#5a3088'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 4, y + 8, w - 8, h - 14);
  // legs
  ctx.fillStyle = '#1c0a20';
  ctx.fillRect(x + 6, y + h - 8, 3, 4);
  ctx.fillRect(x + w - 9, y + h - 8, 3, 4);
  // sigil at center
  ctx.strokeStyle = '#c8a0e8'; ctx.lineWidth = 1;
  const cx = x + w/2, cy = y + Math.min(14, h/2);
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
  ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
  ctx.stroke();
}

function drawTreasure(t) {
  const x = t.at[0] * CELL + CELL / 2;
  const y = t.at[1] * CELL + CELL / 2;
  ctx.fillStyle = '#c5a14e';
  ctx.beginPath();
  ctx.arc(x, y - 6, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,216,112,0.5)';
  ctx.font = '8px serif';
  ctx.textAlign = 'center';
  ctx.fillText('★', x, y + 6);
}

function drawSecretDoor(d) {
  const cx = (d.a[0] + d.b[0] + 1) * CELL / 2;
  const cy = (d.a[1] + d.b[1] + 1) * CELL / 2;
  const horizontal = (d.a[1] === d.b[1]);
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#8b4ca0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx, cy + 14);
  } else {
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx + 14, cy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTrap(tr) {
  const x = tr.at[0] * CELL;
  const y = tr.at[1] * CELL;
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  ctx.save();
  if (tr.gmOnly) ctx.globalAlpha = 0.45;
  // Prefer canonical heroscribe PNG when available
  if (drawTileIcon(tr.type || tr.kind || 'pit', x, y, CELL, CELL)) {
    ctx.restore();
    return;
  }
  // Pixel-art fallback (used while the trap PNG loads or for unknown kinds)
  if (tr.type === 'pit') {
    ctx.fillStyle = '#1a1208';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d8a040';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#d8a040';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 8); ctx.lineTo(cx + 8, cy + 8);
    ctx.moveTo(cx + 8, cy - 8); ctx.lineTo(cx - 8, cy + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHero(h, isCurrent) {
  if (h.dead) return;
  const cx = h.at[0] * CELL + CELL / 2;
  const cy = h.at[1] * CELL + CELL / 2;
  // Prefer the player's chosen variant token; fall back to the
  // gender-neutral default if the variant PNG hasn't loaded yet.
  const sprite = heroSprites[variantKey(h.id, h.variant || 'male')] || heroSprites[h.id];
  if (isCurrent) {
    ctx.strokeStyle = 'rgba(255,216,112,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (sprite) {
    ctx.drawImage(sprite, cx - CELL/2 + 3, cy - CELL/2 + 3, CELL - 6, CELL - 6);
  } else {
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(h.glyph, cx, cy + 1);
  }
}

function drawMonster(m, isSelected) {
  const cx = m.at[0] * CELL + CELL / 2;
  const cy = m.at[1] * CELL + CELL / 2;
  const sprite = monsterSprites[m.type];
  if (isSelected) {
    ctx.strokeStyle = 'rgba(255,80,80,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (sprite) {
    ctx.drawImage(sprite, cx - CELL/2 + 3, cy - CELL/2 + 3, CELL - 6, CELL - 6);
  } else {
    // Diamond shape — programmer-art fallback
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - CELL/2 + 4);
    ctx.lineTo(cx + CELL/2 - 4, cy);
    ctx.lineTo(cx, cy + CELL/2 - 4);
    ctx.lineTo(cx - CELL/2 + 4, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.glyph, cx, cy + 1);
  }
  // HP indicator if wounded — drawn over either sprite or glyph
  if (m.body < m.bodyMax) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(cx - 10, cy + CELL/2 - 8, 20, 4);
    ctx.fillStyle = '#c83030';
    ctx.fillRect(cx - 10, cy + CELL/2 - 8, 20 * (m.body / m.bodyMax), 4);
  }
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

// ---------- Canvas: click handling ----------
// Mouse hover: track cell under cursor for path preview, set cursor style,
// and surface a small floating tooltip with the move cost or attack target.
canvas.addEventListener('mousemove', (e) => {
  if (!lastView) return;
  const [x, y] = screenToCell(e);
  if (hoverCell && hoverCell[0] === x && hoverCell[1] === y) {
    moveTooltip(e); return;
  }
  hoverCell = [x, y];
  updateHoverCursor(e);
  drawBoard(lastView);
});
canvas.addEventListener('mouseleave', () => {
  hoverCell = null;
  canvas.style.cursor = 'default';
  hideTooltip();
  if (lastView) drawBoard(lastView);
});

function statLine(o) {
  // "B 1/1 · A2 D1 M10" for a monster, similar for a hero
  const bm = (o.bodyMax != null) ? `${o.body}/${o.bodyMax}` : `${o.body}`;
  const parts = [`Body ${bm}`];
  if (o.mind != null && o.mindMax != null) parts.push(`Mind ${o.mind}/${o.mindMax}`);
  if (o.attack != null) parts.push(`A${o.attack}`);
  if (o.defend != null) parts.push(`D${o.defend}`);
  if (o.moveSquares != null) parts.push(`Mv${o.moveSquares}`);
  return parts.join(' · ');
}

function updateHoverCursor(e) {
  if (!lastView || !hoverCell) return;
  const cur = lastView.currentTurn;
  let cursorStyle = 'default';
  let label = '';
  const [x, y] = hoverCell;

  // Inspection tooltips work even when it's NOT your turn — hovering a
  // monster or ally shows their stats card-equivalent (P1.2: lite version
  // of "click to inspect", per the panel synthesis).
  const monster = lastView.monsters.find(m => m.at[0] === x && m.at[1] === y);
  const heroOnCell = lastView.heroes.find(hh => !hh.dead && hh.at[0] === x && hh.at[1] === y);

  if (lastView.myTurn && cur?.kind === 'hero') {
    const h = lastView.heroes.find(hh => hh.id === cur.heroId);
    if (h) {
      const trap = (lastView.traps || []).find(t => t.at[0] === x && t.at[1] === y && t.revealed);
      if (monster && (Math.abs(h.at[0]-x) + Math.abs(h.at[1]-y) === 1)) {
        cursorStyle = 'crosshair';
        label = `Attack ${monster.name} — ${statLine(monster)}`;
      } else if (monster) {
        // Non-adjacent monster: inspect tooltip (no cursor for click — server
        // will validate range/LOS if they click)
        cursorStyle = 'help';
        label = `${monster.name} — ${statLine(monster)}`;
      } else if (heroOnCell && heroOnCell.id !== h.id) {
        cursorStyle = 'help';
        label = `${heroOnCell.name} — ${statLine(heroOnCell)}`;
      } else if (trap && (Math.abs(h.at[0]-x) + Math.abs(h.at[1]-y) <= 1)) {
        cursorStyle = 'help';
        label = `Disarm ${trap.type} trap`;
      } else if (lastReachable && lastReachable.dist.has(`${x},${y}`)) {
        const d = lastReachable.dist.get(`${x},${y}`);
        if (d === 0) { cursorStyle = 'default'; label = ''; }
        else { cursorStyle = 'pointer'; label = `Move (${d} sq)`; }
      } else {
        cursorStyle = 'not-allowed';
      }
    }
  } else {
    // Spectator / GM-AI turn / your hero waiting — still let hovering
    // monsters and heroes surface their stats. No cursor change.
    if (monster) {
      cursorStyle = 'help';
      label = `${monster.name} — ${statLine(monster)}`;
    } else if (heroOnCell) {
      cursorStyle = 'help';
      label = `${heroOnCell.name} — ${statLine(heroOnCell)}`;
    }
  }
  canvas.style.cursor = cursorStyle;
  if (label) showTooltip(e, label); else hideTooltip();
}

let _tipEl = null;
function tipEl() {
  if (!_tipEl) {
    _tipEl = document.createElement('div');
    _tipEl.className = 'hover-tip';
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}
function showTooltip(e, text) {
  const t = tipEl();
  t.textContent = text;
  t.style.display = 'block';
  moveTooltip(e);
}
function moveTooltip(e) {
  if (!_tipEl || _tipEl.style.display === 'none') return;
  _tipEl.style.left = (e.clientX + 14) + 'px';
  _tipEl.style.top  = (e.clientY + 14) + 'px';
}
function hideTooltip() { if (_tipEl) _tipEl.style.display = 'none'; }

canvas.addEventListener('click', (e) => {
  if (!lastView) return;
  const [x, y] = screenToCell(e);
  if (!lastView.myTurn) return;

  const cur = lastView.currentTurn;

  // Spell-target picker mode
  if (pendingSpell) {
    const targetMonster = lastView.monsters.find(m => m.at[0] === x && m.at[1] === y);
    const targetHero = lastView.heroes.find(h => !h.dead && h.at[0] === x && h.at[1] === y);
    if (targetMonster && (pendingSpell.target === 'enemy' || pendingSpell.target === 'anyone' || pendingSpell.target === 'line')) {
      sendCast(pendingSpell.id, { kind: 'monster', id: targetMonster.id });
      return;
    }
    if (targetHero && (pendingSpell.target === 'ally' || pendingSpell.target === 'anyone' || pendingSpell.target === 'line')) {
      sendCast(pendingSpell.id, { kind: 'hero', id: targetHero.id });
      return;
    }
    // Click elsewhere cancels
    pendingSpell = null;
    drawBoard(lastView);
    return;
  }

  if (cur?.kind === 'hero') {
    const h = lastView.heroes.find(h => h.id === cur.heroId);
    if (!h) return;
    // Click a revealed trap when adjacent → disarm (Dwarf or Tool Kit)
    const trap = (lastView.traps || []).find(t => t.at[0] === x && t.at[1] === y && t.revealed);
    if (trap && (Math.abs(h.at[0]-x) + Math.abs(h.at[1]-y) <= 1)) {
      if (confirm(`Attempt to disarm ${trap.type} trap?`)) {
        send({ type: 'action', action: 'disarmTrap', trapId: trap.id });
        return;
      }
    }
    // Click a monster → attack. Range / diagonal allowed depends on
    // the equipped weapon — the server validates and rejects out-of-
    // range. We send the action for any monster click and let server
    // be the source of truth.
    const targetMonster = lastView.monsters.find(m => m.at[0] === x && m.at[1] === y);
    if (targetMonster) {
      action('attack', { targetMonsterId: targetMonster.id });
      return;
    }
    // Otherwise pathfind: server walks the BFS path one cell at a time,
    // halting on traps / new monster encounters / out-of-MP.
    action('moveTo', { target: [x, y] });
    return;
  }

  if (cur?.kind === 'gm' && lastView.config.gmMode === 'human') {
    if (!selectedGMMonsterId) return;
    const m = lastView.monsters.find(x => x.id === selectedGMMonsterId);
    if (!m) return;
    const targetHero = lastView.heroes.find(h => !h.dead && h.at[0] === x && h.at[1] === y);
    if (targetHero && Math.abs(m.at[0]-x) + Math.abs(m.at[1]-y) === 1) {
      send({ type: 'action', action: 'gmAttack', monsterId: m.id, heroId: targetHero.id });
      return;
    }
    send({ type: 'action', action: 'gmMove', monsterId: m.id, target: [x, y] });
    return;
  }
});

// ---------- Combat modal ----------
const $cmodal = document.getElementById('combat-modal');
const $catt   = document.getElementById('combat-attack-dice');
const $cdef   = document.getElementById('combat-defend-dice');
const $ctitle = document.getElementById('combat-title');
const $csum   = document.getElementById('combat-summary');

function diceGlyph(face) {
  if (face === 'skull') return '☠';        // ☠
  if (face === 'heroShield') return '❖';   // ❖ (hero shield placeholder)
  return '◆';                              // ◆ (monster shield placeholder)
}

function showCombatModal(combat) {
  $ctitle.textContent = `${combat.attacker.name} attacks ${combat.defender.name}`;
  $catt.innerHTML = '';
  $cdef.innerHTML = '';
  for (const f of combat.attackDice) {
    const d = document.createElement('div');
    d.className = `die ${f}`;
    d.textContent = diceGlyph(f);
    $catt.appendChild(d);
  }
  for (const f of combat.defendDice) {
    const d = document.createElement('div');
    d.className = `die ${f}`;
    d.textContent = diceGlyph(f);
    $cdef.appendChild(d);
  }
  $csum.classList.toggle('killed', !!combat.killed);
  $csum.textContent = `${combat.skulls} skull${combat.skulls===1?'':'s'} − ${combat.blocks} block${combat.blocks===1?'':'s'} = ${combat.damage} damage` +
                      (combat.killed ? ` — ${combat.defender.name} slain!` : '');
  $cmodal.classList.remove('hidden');
}
document.getElementById('combat-ok').addEventListener('click', () => {
  $cmodal.classList.add('hidden');
  send({ type: 'action', action: 'dismissCombat' });
});

// Treasure card modal
function showTreasureCardModal(card) {
  const m = document.getElementById('treasure-modal');
  document.getElementById('treasure-card-name').textContent = card.name;
  document.getElementById('treasure-card-flavour').textContent = card.flavour || '';
  m.classList.remove('hidden');
}
document.getElementById('treasure-card-ok')?.addEventListener('click', () => {
  document.getElementById('treasure-modal').classList.add('hidden');
  send({ type: 'action', action: 'dismissTreasureCard' });
});

// End modal: back to lobby
document.getElementById('end-ok').addEventListener('click', () => {
  if (lastView?.isHost) send({ type: 'restart' });
  document.getElementById('end-modal').classList.add('hidden');
});

// Save modal "Accept death" — sends a -1 idx to take the death.
document.getElementById('save-decline')?.addEventListener('click', () => {
  send({ type: 'action', action: 'choosePotion', idx: -1 });
});
document.getElementById('btn-restart').addEventListener('click', () => {
  send({ type: 'restart' });
});

// ---------- Mobile tabs ----------
// At ≤768px the right sidebar collapses into a bottom drawer toggled
// by a tab bar. Each tab sets `body[data-mtab]` which CSS reads to
// reveal exactly one panel (Board / Turn / Hero / Log).
function setMobileTab(name) {
  document.body.dataset.mtab = name;
  for (const b of document.querySelectorAll('#mobile-tabs button')) {
    b.classList.toggle('active', b.dataset.mtab === name);
  }
}
document.body.dataset.mtab = 'board';
for (const b of document.querySelectorAll('#mobile-tabs button')) {
  b.addEventListener('click', () => setMobileTab(b.dataset.mtab));
}

// ---------- Audio (Web Audio synth — no external files) ----------
let audioEnabled = (localStorage.getItem('hq_audio') !== '0');
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  // Browsers suspend audio until a user gesture; resume on demand.
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, dur, type = 'sine', vol = 0.25, delay = 0) {
  if (!audioEnabled) return;
  const ctx = getAudioCtx(); if (!ctx) return;
  setTimeout(() => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur);
  }, delay);
}
function sfx(name) {
  if (!audioEnabled) return;
  switch (name) {
    case 'roll':       tone(800, 0.04, 'square', 0.10);
                       tone(620, 0.05, 'square', 0.10, 60); break;
    case 'doorOpen':   tone(220, 0.35, 'sawtooth', 0.18);
                       tone(180, 0.30, 'sawtooth', 0.15, 150); break;
    case 'combatHit':  tone(440, 0.08, 'square',   0.30);
                       tone(220, 0.10, 'sawtooth', 0.20, 60); break;
    case 'combatMiss': tone(180, 0.12, 'triangle', 0.18); break;
    case 'kill':       tone(300, 0.14, 'sawtooth', 0.30);
                       tone(150, 0.25, 'sawtooth', 0.25, 100); break;
    case 'heroFall':   tone(440, 0.10, 'sawtooth', 0.35);
                       tone(220, 0.30, 'sawtooth', 0.35, 100);
                       tone(110, 0.45, 'sawtooth', 0.35, 280); break;
    case 'victory':    [523, 659, 784, 1047].forEach((f, i) =>
                         tone(f, 0.18, 'sine', 0.28, i * 90)); break;
    case 'defeat':     [330, 277, 220, 165].forEach((f, i) =>
                         tone(f, 0.22, 'sawtooth', 0.30, i * 110)); break;
    case 'spellCast':  tone(660, 0.14, 'sine',     0.25);
                       tone(880, 0.18, 'sine',     0.18, 70); break;
    case 'reveal':     tone(440, 0.05, 'sine',     0.20);
                       tone(660, 0.10, 'sine',     0.15, 50);
                       tone(880, 0.12, 'sine',     0.10, 110); break;
    case 'treasure':   tone(880, 0.06, 'sine',     0.20);
                       tone(1175, 0.10, 'sine',    0.18, 60); break;
    case 'bossReveal': tone(110, 0.30, 'sawtooth', 0.35);
                       tone(82,  0.45, 'sawtooth', 0.30, 200);
                       tone(55,  0.60, 'sawtooth', 0.25, 450); break;
  }
}

// Translate log-line classes / combat-modal events into SFX. We track
// the last log length so we only fire for *new* entries each render.
let _audioLastLogLen = 0;
let _audioLastCombatTs = 0;
function fireSfxFromView(view) {
  if (!view || !view.log) return;
  // New log entries → class-based SFX
  const start = Math.max(0, _audioLastLogLen);
  for (let i = start; i < view.log.length; i++) {
    const e = view.log[i];
    switch (e.cls) {
      case 'spell':    sfx('spellCast'); break;
      case 'reveal':   sfx('reveal'); break;
      case 'treasure': sfx('treasure'); break;
      case 'death':    sfx('heroFall'); break;
      case 'victory':  sfx('victory'); break;
      case 'defeat':   sfx('defeat'); break;
      default:
        if (/Door opened/.test(e.text || ''))            sfx('doorOpen');
        else if (/rolls movement/.test(e.text || ''))    sfx('roll');
        break;
    }
  }
  _audioLastLogLen = view.log.length;
  // Combat resolution modal — different SFX for hit / kill / miss
  if (view.combat && view.combat.ts !== _audioLastCombatTs) {
    _audioLastCombatTs = view.combat.ts;
    if (view.combat.killed) sfx('kill');
    else if (view.combat.damage > 0) sfx('combatHit');
    else sfx('combatMiss');
  }
}

// Mute toggle — reachable via a tiny corner button.
function makeAudioToggle() {
  const btn = document.createElement('button');
  btn.id = 'audio-toggle';
  btn.title = 'Toggle sound effects';
  btn.textContent = audioEnabled ? '🔊' : '🔇';
  btn.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    localStorage.setItem('hq_audio', audioEnabled ? '1' : '0');
    btn.textContent = audioEnabled ? '🔊' : '🔇';
    if (audioEnabled) sfx('reveal');   // confirm tone
  });
  document.body.appendChild(btn);
}
makeAudioToggle();

// ---------- Boot ----------
connect();
