// HeroQuest — UI chrome + Options ⚙ menu + boolean preferences.
//
// One module covers three closely-coupled concerns:
//
// 1. Per-panel collapse state — each right-rail <h3> folds its body on
//    click; collapsed ids are persisted in localStorage.hq_panel_collapsed_v1.
// 2. Rails-hidden toggle — header "Hide rails" / option-menu "Hide rails"
//    toggles the `.rails-hidden` class on `.game-layout`.
// 3. Options ⚙ dropdown — the secondary header button cluster collapsed
//    into one menu: hide rails / floor textures / light walls / outer
//    walls / alt furniture art / Zargon speed / Leave Quest.
//
// Owns three boolean preferences read by the canvas renderer:
//   floorTexturesOn, lightWallsOn, outerWallsOn
// Cross-tab live sync via the `storage` event (the map editor toggles
// the wall prefs from another tab; the live game re-renders).
//
// Public API (window.HQOptions):
//   init({ send, getLastView, drawBoard })  — once at boot. Wires the
//                                              storage listener + the
//                                              header rails-toggle button.
//   floorTexturesOn() / lightWallsOn() / outerWallsOn()  — preference getters.
//   mountPanelCollapse()       — wire each .panel > h3 click. Idempotent.
//   applyRailsHidden(hidden)   — toggle the `.rails-hidden` class.
//   mountOptionsMenu()         — wire the ⚙ button + dropdown.
//                                Idempotent (uses _wired flag).
//   syncFromView(view)         — refresh option-toggle dots from current
//                                state. Call once per render.

(function (global) {
  'use strict';

  let _send = () => {};
  let _getLastView = () => null;
  let _drawBoard = () => {};

  // ----- Storage keys --------------------------------------------------
  const PANEL_STATE_KEY    = 'hq_panel_collapsed_v1';
  const RAILS_STATE_KEY    = 'hq_rails_hidden_v1';
  const TEXTURES_STATE_KEY = 'hq_floor_textures_v1';   // '1' on / '0' off
  const LIGHT_WALLS_KEY    = 'hq_light_walls_v1';      // '1' light / '0' dark
  const OUTER_WALLS_KEY    = 'hq_outer_walls_v1';      // '1' shown / '0' hidden
  const TEXTURES_MODE_KEY  = 'hq_floor_textures_v2';   // 'off' / 'canonical' / 'alt'

  // ----- Boolean preference state -------------------------------------
  // Floor textures: 3-state ('off' / 'canonical' / 'alt'). Migrates the
  // legacy v1 boolean (`'1'` / `'0'`) on first read so users keep their
  // existing on/off preference; default is 'canonical' when neither key
  // is set.
  const TEXTURE_MODES = ['off', 'canonical', 'alt'];
  let FLOOR_TEXTURES_MODE = (() => {
    try {
      const v2 = localStorage.getItem(TEXTURES_MODE_KEY);
      if (v2 != null && TEXTURE_MODES.indexOf(v2) >= 0) return v2;
      const v1 = localStorage.getItem(TEXTURES_STATE_KEY);
      if (v1 === '0') return 'off';
      return 'canonical';
    } catch { return 'canonical'; }
  })();
  let LIGHT_WALLS_ON = (() => {
    try {
      const v = localStorage.getItem(LIGHT_WALLS_KEY);
      return v == null ? true : v === '1';
    } catch { return true; }
  })();
  let OUTER_WALLS_ON = (() => {
    try {
      const v = localStorage.getItem(OUTER_WALLS_KEY);
      return v == null ? true : v === '1';
    } catch { return true; }
  })();

  function floorTexturesMode() { return FLOOR_TEXTURES_MODE; }
  function floorTexturesOn()   { return FLOOR_TEXTURES_MODE !== 'off'; }
  function cycleFloorTextures() {
    const idx = TEXTURE_MODES.indexOf(FLOOR_TEXTURES_MODE);
    FLOOR_TEXTURES_MODE = TEXTURE_MODES[(idx + 1) % TEXTURE_MODES.length];
    try {
      localStorage.setItem(TEXTURES_MODE_KEY, FLOOR_TEXTURES_MODE);
      // Keep the legacy boolean in sync so nothing else regresses.
      localStorage.setItem(TEXTURES_STATE_KEY, FLOOR_TEXTURES_MODE === 'off' ? '0' : '1');
    } catch {}
  }
  function lightWallsOn()    { return LIGHT_WALLS_ON; }
  function outerWallsOn()    { return OUTER_WALLS_ON; }

  // ----- Panel collapse ------------------------------------------------
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

  function mountPanelCollapse() {
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

  // ----- Rails hidden --------------------------------------------------
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

  // ----- Options ⚙ dropdown menu --------------------------------------
  function mountOptionsMenu() {
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
    const close = () => {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('active');
    };
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

    function redraw() {
      const v = _getLastView();
      if (v) _drawBoard(v);
    }
    function refresh() { syncFromView(_getLastView()); }

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
        refresh();
      } else if (opt === 'floor-textures') {
        cycleFloorTextures();
        refresh();
        redraw();
      } else if (opt === 'light-walls') {
        LIGHT_WALLS_ON = !LIGHT_WALLS_ON;
        try { localStorage.setItem(LIGHT_WALLS_KEY, LIGHT_WALLS_ON ? '1' : '0'); } catch {}
        refresh();
        redraw();
      } else if (opt === 'outer-walls') {
        OUTER_WALLS_ON = !OUTER_WALLS_ON;
        try { localStorage.setItem(OUTER_WALLS_KEY, OUTER_WALLS_ON ? '1' : '0'); } catch {}
        refresh();
        redraw();
      } else if (opt === 'alt-furn') {
        if (global.HQFurnitureArt) {
          global.HQFurnitureArt.setAltOn(!global.HQFurnitureArt.isAltOn());
        }
        refresh();
      } else if (opt === 'zargon-speed') {
        const v = _getLastView();
        const cur = Math.max(1, Math.min(4, v?.config?.aiSpeed || 1));
        const next = cur >= 4 ? 1 : cur + 1;
        _send({ type: 'setAiSpeed', value: next });
      } else if (opt === 'leave-quest') {
        if (confirm('Leave this quest and return to the lobby? Progress on this quest will be lost.')) {
          _send({ type: 'leaveQuest' });
        }
        close();
      }
    });
  }

  // ----- Sync option-toggle dots from current state -------------------
  function syncFromView(view) {
    const railsToggle = document.getElementById('opt-hide-rails-state');
    if (railsToggle) {
      const root = document.querySelector('.game-layout');
      const hidden = !!(root && root.classList.contains('rails-hidden'));
      railsToggle.classList.toggle('on', hidden);
    }
    const texToggle = document.getElementById('opt-floor-textures-state');
    if (texToggle) {
      const labels = { off: 'Off', canonical: 'Canon', alt: 'Alt' };
      texToggle.textContent = labels[FLOOR_TEXTURES_MODE] || '?';
      texToggle.classList.toggle('on', FLOOR_TEXTURES_MODE !== 'off');
    }
    const lwToggle = document.getElementById('opt-light-walls-state');
    if (lwToggle) lwToggle.classList.toggle('on', !!LIGHT_WALLS_ON);
    const owToggle = document.getElementById('opt-outer-walls-state');
    if (owToggle) owToggle.classList.toggle('on', !!OUTER_WALLS_ON);
    const afToggle = document.getElementById('opt-alt-furn-state');
    if (afToggle && global.HQFurnitureArt) afToggle.classList.toggle('on', global.HQFurnitureArt.isAltOn());
    const speedVal = document.getElementById('opt-zargon-speed-value');
    if (speedVal && view) {
      const s = Math.max(1, Math.min(4, view.config?.aiSpeed || 1));
      speedVal.textContent = `×${s}`;
    }
  }

  function init(deps) {
    _send = deps.send;
    _getLastView = deps.getLastView;
    _drawBoard = deps.drawBoard;

    // Cross-tab live sync — if the editor toggles wall style or
    // perimeter, the game re-renders without a refresh and vice versa.
    window.addEventListener('storage', (e) => {
      if (e.key === LIGHT_WALLS_KEY) {
        LIGHT_WALLS_ON = e.newValue === '1' || e.newValue == null;
        const v = _getLastView(); if (v) _drawBoard(v);
      } else if (e.key === OUTER_WALLS_KEY) {
        OUTER_WALLS_ON = e.newValue === '1' || e.newValue == null;
        const v = _getLastView(); if (v) _drawBoard(v);
      } else if (e.key === TEXTURES_MODE_KEY) {
        if (e.newValue && TEXTURE_MODES.indexOf(e.newValue) >= 0) {
          FLOOR_TEXTURES_MODE = e.newValue;
        }
        const v = _getLastView(); if (v) _drawBoard(v);
      }
    });

    // Header "Hide rails" button (mirrors the option-menu item).
    document.getElementById('btn-toggle-rails')?.addEventListener('click', () => {
      const root = document.querySelector('.game-layout');
      const next = !root.classList.contains('rails-hidden');
      applyRailsHidden(next);
      try { localStorage.setItem(RAILS_STATE_KEY, next ? '1' : '0'); } catch {}
    });
  }

  global.HQOptions = {
    init,
    floorTexturesOn, floorTexturesMode, cycleFloorTextures,
    lightWallsOn, outerWallsOn,
    mountPanelCollapse, applyRailsHidden, mountOptionsMenu,
    syncFromView,
    // Expose the rails-state key so initGameUIChrome can read it on first
    // game-screen render (matches the original behavior).
    RAILS_STATE_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
