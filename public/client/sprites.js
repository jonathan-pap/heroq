// HeroQuest — sprite / token loader.
//
// Hands the renderer two name → Image() maps (monsterSprites,
// heroSprites). Maps populate asynchronously as PNGs finish loading;
// drawHero / drawMonster prefer the sprite when present and fall back
// to drawn glyphs when not.
//
// Art conventions:
//   /assets/monsters/<Type>-Token.png  — printed-board look (preferred)
//   /assets/heros/<Hero>.png           — base portrait
//   /assets/heros/<Hero>-<Male|Female>-Token.png  — per-variant token
//
// Old-edition monster names (chaos-warrior, fimir, ...) alias to the
// 2021-renamed creatures (dread-warrior, abomination, ...) so the same
// quest JSON renders correctly with the new art pack.
//
// Public API (window.HQSprites):
//   monsterSprites, heroSprites    — mutable maps (callers may read)
//   HERO_NAMES, HERO_VARIANTS      — name + variant tables
//   variantKey(id, variant)        — composite map key
//   variantTokenURL(id, variant)   — token PNG path
//   variantCardURL(id, variant)    — character-card PNG path
//   load({ onLoaded })             — boot. onLoaded fires after each
//                                    PNG resolves so the renderer can
//                                    redraw.

(function (global) {
  'use strict';

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

  let onLoadedCb = null;

  function tryLoadSprite(map, key, url) {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0) {
        map[key] = img;
        if (onLoadedCb) onLoadedCb();
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

  global.HQSprites = {
    monsterSprites,
    heroSprites,
    HERO_NAMES,
    HERO_VARIANTS,
    variantKey,
    variantTokenURL,
    variantCardURL,
    load(deps) {
      onLoadedCb = deps && deps.onLoaded ? deps.onLoaded : null;
      loadAllSprites();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
