// HeroQuest — Web Audio SFX synth.
//
// All sound effects are oscillator-synthesized at call time — no PNG /
// MP3 assets to ship. A short note table covers door / combat / spell /
// boss-reveal / victory / defeat. The renderer pipes each view through
// fireSfxFromView, which diffs the log + combat fields to play exactly
// one SFX per new event.
//
// State:
//   audioEnabled       — mute toggle, persists via localStorage hq_audio
//   audioCtx           — lazy single AudioContext (resumed on toggle)
//   _audioLastLogLen   — high-watermark on view.log to detect new lines
//   _audioLastCombatTs — last view.combat.ts that we sounded for
//
// Public API (window.HQAudio):
//   sfx(name)             — play a named effect
//   fireSfxFromView(view) — diff the view and play any pending SFX
//   reset()               — clear the log-tracking watermark (call on
//                           transition out of game screen)
//   mount()               — install the corner 🔊 / 🔇 toggle button.

(function (global) {
  'use strict';

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

  function reset() {
    _audioLastLogLen = 0;
  }

  // Mute toggle — reachable via a tiny corner button.
  function mount() {
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

  global.HQAudio = { sfx, fireSfxFromView, reset, mount };
})(typeof window !== 'undefined' ? window : globalThis);
