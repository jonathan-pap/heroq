// HeroQuest — lobby render + spell-draft picker.
//
// Everything visible before the host hits "Start quest":
//   - Quest picker (Quest Book vs Sandbox optgroups)
//   - Quest intro / board label
//   - Auto-roll + reveal-all (debug) options
//   - GM mode radio + GM-seat claim button
//   - Four hero-seat tiles (claim/release + Male/Female variant toggle)
//   - Players list (with host / GM / hero / offline tags)
//   - Spell-draft picker (wizard + elf pick 3 / 1 elemental groups)
//   - Start button + start-blocked message
//
// Public API (window.HQLobby):
//   init({ send, getLastView })  — wire all the form-control + button
//                                  listeners once at boot.
//   render(view)                 — re-paint everything from a view.

(function (global) {
  'use strict';

  let _send = null;
  let _getLastView = null;

  const ELEMENT_LABELS = { air: 'Air', fire: 'Fire', water: 'Water', earth: 'Earth' };
  const ELEMENT_ORDER  = ['air', 'fire', 'water', 'earth'];

  function send(msg) { if (_send) _send(msg); }
  function lastView() { return _getLastView ? _getLastView() : null; }

  // Pull the cross-module helpers off the namespaces they live in. Pulled
  // lazily inside the functions because HQSprites loads before HQLobby
  // (HTML script order) but it's cleaner to reach for them at use time.
  function spritesAPI() { return global.HQSprites || {}; }

  function makeTag(kind, text) {
    const t = document.createElement('span');
    t.className = `player-tag ${kind}`;
    t.textContent = text;
    return t;
  }

  // Replace the coloured letter badge with the printed-art token for the
  // current variant choice. Falls back to the glyph letter if the PNG
  // hasn't loaded yet (or doesn't exist for some reason).
  function renderSeatBadgeToken(view, btn, seat) {
    const badge = btn.querySelector('.hero-badge');
    if (!badge) return;
    const variant = view.heroVariants?.[seat] || 'male';
    const url = spritesAPI().variantTokenURL(seat, variant);
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
    const sp = spritesAPI();
    let host = btn.querySelector('.seat-variant');
    if (!host) {
      host = document.createElement('div');
      host.className = 'seat-variant';
      btn.appendChild(host);
    }
    const variant = view.heroVariants?.[seat] || 'male';
    const cardUrl = sp.variantCardURL(seat, variant);
    const isMine  = taken && taken === view.youPid;

    host.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'seat-variant-card';
    img.src = cardUrl;
    img.alt = `${sp.HERO_NAMES[seat]} (${variant})`;
    img.draggable = false;
    // Hover-zoom: a single body-level popover (avoids parent overflow clips).
    if (global.HQCardPreview) global.HQCardPreview.attach(img, cardUrl);
    host.appendChild(img);

    if (isMine) {
      const toggle = document.createElement('div');
      toggle.className = 'seat-variant-toggle';
      for (const v of sp.HERO_VARIANTS) {
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

  function render(view) {
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

  function init(deps) {
    _send = deps.send;
    _getLastView = deps.getLastView;

    // Lobby form-control listeners — wired once.
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
      const v = lastView(); if (!v) return;
      if (v.seats.gm === v.youPid) send({ type: 'release', seat: 'gm' });
      else send({ type: 'claim', seat: 'gm' });
    });
    for (const btn of document.querySelectorAll('.seat-btn')) {
      btn.addEventListener('click', () => {
        const v = lastView(); if (!v) return;
        const seat = btn.dataset.seat;
        if (v.seats[seat] === v.youPid) send({ type: 'release', seat });
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
  }

  global.HQLobby = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
