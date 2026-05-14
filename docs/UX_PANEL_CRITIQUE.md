# UX panel critique — HeroQuest web recreation

> **Purpose:** Strategic critique of the player experience by a
> simulated multi-expert business panel (Christensen / Godin /
> Kim & Mauborgne / Doumont). Produced 2026-05-14 via the
> `/sc:business-panel` skill. Reference document — not a backlog.
>
> **Related:** [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md),
> [`BACKLOG.md`](BACKLOG.md) (where concrete items get extracted from
> here when we decide to act on them).

---

## Opening framing

The product is not a board game. It is a *re-enactment device* for a
memory people already love. That single reframe should govern every UI
decision. The original 1989 box is the competitor — not other digital
adaptations — because the user's reference image is plastic furniture
on a kitchen table at age 11, not a Steam dungeon-crawler. The UI's
job is to give that memory back faithfully *and then* give them
something the cardboard never could.

---

## Per-expert lens

### Clayton Christensen — Jobs-to-be-Done

The hire is not "play HeroQuest." The hire is **"host a HeroQuest
night with friends without being the rules-lawyer."** The dominant
non-consumption isn't people who never tried board games; it's people
who *own the 1989 box* and stopped playing it because setup is 40
minutes, the GM does 80% of the labor, and one friend lives 200 miles
away.

That reframes the feature priorities:

- The current sandbox quest editor serves the wrong job (designer,
  not host).
- The right job-progress signal is "we got to the dragon in under 90
  minutes with three drinks involved." Latency and friction are the
  metric, not feature count.
- Hover-tooltips with monster stats are a *sustaining* feature
  against the cardboard box. The disruptive moves are the ones the
  cardboard literally cannot do: synchronised remote play, no setup,
  no lost minis, save/resume, encounter telemetry the GM uses to tune
  difficulty next session.

What's overshooting? The options menu (six toggles for floor
textures, wall colour, alt art) is overshooting a casual host who
just wants to launch a quest. What's undershooting? There is no
"explain my turn to me" affordance — and that is the *primary* job a
new player hires this UI for.

### Seth Godin — Remarkable

A "passable" fan recreation is the curse here. Nobody screenshots
passable. Nobody tells their D&D group "you have to try this." The
question is: **who would miss this if it disappeared, and what would
they say about it?**

Right now, the answer is "people who already love HeroQuest" — that's
a tribe, but it's a tribe being served *adequately*. The remarkable
layer is missing:

- Combat resolution is a modal that closes. It should be a *moment* —
  the dice rattle, the result lands, the room reacts. The current
  synth audio is a start; the visuals aren't matching it.
- The hero stat strip ("Body / Mind / Move / Gold / equipped") is
  information, not character. A barbarian with 1 Body left should
  *look* injured. The portrait should bleed.
- The Zargon (GM) reveal is the iconic HeroQuest moment — door opens,
  room fills with monsters, dread. That should be the screenshot.
  Currently it's a fog reveal and some tooltips.

The Purple Cow here is **theatrical Zargon**. Lean into it.

### Kim & Mauborgne — Value Innovation (ERRC)

Apply the Four Actions Framework against the implicit "digital board
game" category:

- **Eliminate**: setup. Rule lookups. Per-turn book-keeping
  (movement-die addition, line-of-sight arguments, "wait does the Orc
  have 2 Body or 3?"). The fact that the player can see numbers at
  all is a *crutch* for the limits of cardboard.
- **Reduce**: chrome. Six options-menu toggles is a settings page,
  not a game. Two-line combat-result modals that demand a click to
  dismiss. The header strip is doing four jobs (turn pipeline +
  buttons + leave + stats) and none of them with hierarchy.
- **Raise**: the *physicality* the original box delivered
  effortlessly. Cards being drawn, dice being thrown, the GM's
  screen, the moment a door opens. A web app has every advantage to
  make these feel *more* tactile than the cardboard, not less.
- **Create**: things only software can. Turn-replay scrubber.
  Encounter-by-encounter timing ("this fight took 11 minutes").
  Spectator mode for the friend whose laptop died. AI-Zargon that
  *taunts* in character. Automatic difficulty calibration. Shareable
  death cards.

The blue ocean is **HeroQuest as a hosted ritual**, not HeroQuest as
a digital port.

### Jean-luc Doumont — Signal Hierarchy

On any given turn, the player needs three things in this order:

1. **Is it my turn, and what phase am I in?** (roll → move → action → end)
2. **What can I do *right now*, and what will it cost?**
3. **What changed since I last looked?**

The current UI surfaces all three but with equal weight. The
turn-pipeline indicator is in the header strip alongside buttons and
stats — same visual loudness as "leave quest." The cursor changes are
doing heavy lifting that the *layout* should be doing. The right-rail
tabs (Spells / Items / Log) badge counts but don't surface the one
item that matters this turn.

The Doumont prescription is severe and clear:

- **One thing should be loudest.** On a hero's turn, that's the
  action they're about to take. On Zargon's turn, that's what just
  emerged from the fog.
- **Modals are a confession of failed hierarchy.** The combat-result
  modal exists because the board can't tell the story inline. Fix
  the board, kill the modal.
- **The log is the wrong primary.** A log is a *fallback* for missed
  signal. If players need the log to know what happened, the in-board
  signal failed.

The hover tooltip surfacing monster stats *and* move cost *and*
attack prompt is three messages at the same volume. Pick one. The
other two are on-demand.

---

## Debates

### 1. Should the UI have *character*, or should it disappear?

**Godin**: Character is the entire moat. A clean, neutral UI is a
commodity. The reason this gets recommended is because the Zargon AI
taunts you when you miss, because the death screen is a Victorian
funeral card, because the dice clatter like bone. Strip the character
and you've built a free Roll20 module.

**Christensen**: Character is overshoot for the core job. The host
wants friction-free play. Every taunt is a 0.8-second tax the host
pays sixty times a session. The first ten taunts are charm; taunts
eleven through sixty are why people stop playing.

**Doumont**: Both of you are wrong about the same thing. Character
isn't a layer you add or remove — it's a hierarchy decision. *Where*
you put character matters. Put it in the rare moments (door reveal,
hero death, quest victory) and it's signal. Put it in the per-turn
loop (every miss, every move) and it's noise that competes with the
actions that need to be loud.

**Kim & Mauborgne**: Doumont resolves it. Character belongs in the
**Create** quadrant — the moments only software can stage. Not in the
**Reduce** quadrant — the per-turn loop. The mistake fan recreations
make is putting character everywhere uniformly, which makes it
ambient and forgettable.

**Resolution**: character concentrated at threshold moments, not
distributed across the per-turn loop.

### 2. Onboarding — tutorial quest, or learn-by-playing?

**Christensen**: A dedicated tutorial quest is the obvious answer and
it's wrong. Nobody finishes tutorials. The hire is "play with my
friends tonight." Inline contextual coaching during the first real
quest is what serves the job.

**Godin**: Tutorials are also unremarkable. The first quest should
*be* the tutorial. Quest 1 of the official campaign is literally
designed as a tutorial. Lean into it. Add a "first time?" toggle the
GM flips for the table, and the UI surfaces hints to *that* player
only.

**Doumont**: In the first 60 seconds, a brand-new player needs to
learn three things: *whose turn is it, what does this board
represent, what do I click*. Not the rules. Not the lore. Three
things. Anything that competes with those three signals in the first
60 seconds is malpractice.

**Kim & Mauborgne**: The cheapest intervention isn't a tutorial — it's
a **mode**. "Learning HeroQuest?" on the lobby toggle that does three
things: (a) coach captions appear over the loudest UI element each
turn, (b) the GM gets a one-line tip per hero turn to read aloud,
(c) the rulebook stub appears as a pinned card not a modal.

**Resolution**: dedicated tutorial is the wrong unit. Disagreement is
whether coaching is per-player (Christensen, Kim/Mauborgne) or
per-table (Godin's "GM reads it aloud" angle). For a game where one
human runs the table, both should exist — coach the GM more than the
heroes.

### 3. Mobile

**Christensen**: Stretched single-column is a confession that mobile
isn't the job. Don't dignify it. The host plays on a laptop; the
friends are also on laptops or iPads. A phone player is a
*spectator*. Build spectator mode for phone, not play mode.

**Godin**: Spectator mode is the remarkable answer. The friend whose
laptop died, the partner who's curious — give them a beautiful
read-only view with the death cards and the room-reveals. That's the
screenshot.

**Doumont**: Spectator mode also gives you a forcing function for
hierarchy. If a passive viewer can follow the game from the board
alone, you've built the right signal hierarchy. If they can't, the
active UI is also failing.

**Resolution**: kill mobile-play, build mobile-spectate. Unanimous.

### 4. The right rail

**Doumont**: Three tabs (Spells / Items / Log) at equal weight is
hierarchy failure. On most turns, two of the three are dormant. The
active tab should *be* the rail; the others should be a thin spine.

**Godin**: The log specifically is unremarkable. It's text. Replace
it with a "session reel" — animated thumbnails of key moments (door
opens, monster slain, treasure found). Now it's screenshot-able.

**Christensen**: The log isn't for the player — it's for the GM tuning
the next session and for the post-game retrospective. Don't kill the
data, kill the *prominence*. Move it to the post-game.

**Kim & Mauborgne**: Eliminate the log tab in-session. Create the
post-game replay. Two ERRC moves resolving one disagreement.

---

## If you do nothing else, do these three

### 1. Build the Zargon Reveal moment. _(Delight)_

The door-opens-and-the-room-fills-with-monsters beat is the iconic
HeroQuest memory. Make it cinematic in software in a way cardboard
never could: brief board dim, the door swings, monsters animate in
one at a time with their name cards flipping, Zargon's voice line
lands, the fog clears with a sweep. This is the screenshot, the
recommendation engine, and the answer to "why play this instead of
Tabletop Simulator." Concentrate the production value here, not in
ambient chrome.

### 2. Compress the per-turn signal to one loudest thing. _(Per-turn UX)_

Right now the turn pipeline, the action buttons, the hero stats, and
the hover tooltips all compete. Pick a hierarchy and enforce it. The
action available *right now* (move-X-cost, attack-this-monster,
cast-this-spell) should dominate. The turn-pipeline indicator should
be ambient — a thin progress thread, not a header chip. Hero stats
should hide until the player needs them or until they change. The
combat-result modal should resolve inline on the board and not steal
focus.

### 3. Ship "Learning HeroQuest" mode, not a tutorial. _(Onboarding)_

A lobby toggle the GM flips. While it's on: (a) one inline coach
caption per hero turn, attached to the loudest UI element, dismissible
by acting; (b) the GM's screen surfaces a one-line "read this aloud"
prompt before each room reveal — turns the host into the storyteller
the game wants; (c) the rulebook stub becomes a pinned card on the
right rail, not a modal. No separate tutorial quest. The first real
quest *is* the tutorial when coaching is on.

---

## Secondary recommendations

### Per-turn UX

- Kill the combat-result modal; resolve combat as an inline board
  animation with the result lingering on the attacking token for ~2s.
- Hero portrait reflects damage state (3 stages: healthy, wounded,
  near-death). Numbers become confirmation, not primary signal.
- Cursor-state work is good; promote it from affordance to *signal*
  by adding a one-glyph status near the cursor on hover (e.g. "−2
  move" trailing the pointer over reachable cells).
- Collapse right-rail tabs: the active context is the rail; others
  are a 24px spine you expand.

### Onboarding

- Lobby quest picker should default to Quest 1 with "Learning mode"
  pre-checked for first-session sessions (detect via local storage).
- Hero seat tiles should show a one-line "best for new players" tag
  on the Barbarian.
- Spell-draft picker is intimidating to a first-timer — in Learning
  mode, default-draft sensible spell groups and let the player
  override, rather than asking them to pick cold.

### Delight / memorable

- Death cards: when a hero falls, generate a shareable image (hero
  portrait, cause of death, room, quest, date). The viral surface.
- Session reel replaces the in-session log; post-game screen surfaces
  5-8 key moments as thumbnails.
- AI-Zargon voice lines at threshold moments only: first reveal, hero
  near-death, hero falls, boss reveal, victory, defeat. Never
  per-attack.
- Mobile becomes spectator-only with a deliberately beautiful
  read-only board.

---

## The through-line

Every expert, even where they fight, agrees on one structural point:
**the per-turn loop should be quieter and the threshold moments should
be louder.** Today the UI is roughly uniform in volume across both.
Inverting that ratio is the single highest-leverage change, and it is
simultaneously a per-turn UX improvement (Doumont), a friction
reduction for the host (Christensen), a delight investment (Godin),
and a value-innovation move (Kim/Mauborgne).

The passable-to-memorable gap is not more features. It is the same
features, redistributed so the right things are loud.
