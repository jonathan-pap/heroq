// =====================================================================
// fetch-heroscribe-icons.js
//
// Pulls the canonical raster icons from the heroscribe project and
// drops them into:
//
//   assets/heros/        <- the four heroes
//   assets/monsters/     <- all monster types
//   assets/furniture/    <- tomb / table / chest / etc
//   assets/tiles/        <- doors, traps, letter & number markers,
//                          stair fan, blocked-square tiles
//
// Source: https://github.com/adelolmo/heroscribe/tree/main/Icons/Raster/USA/<set>
// (Kept under that project's licence — see its repo for terms.)
//
// Run: node scripts/fetch-heroscribe-icons.js          (Base set)
//      node scripts/fetch-heroscribe-icons.js KellarsKeep
//      node scripts/fetch-heroscribe-icons.js ReturnOfTheWitchLord
//      node scripts/fetch-heroscribe-icons.js all      (all sets it finds)
// =====================================================================

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const SET      = process.argv[2] || 'Base';
const ROOT     = path.join(__dirname, '..', 'assets');
const PARENT_API = 'https://api.github.com/repos/adelolmo/heroscribe/contents/Icons/Raster/USA';
const setApi = name => `${PARENT_API}/${encodeURIComponent(name)}`;

// ---- Categorisation rules — applied in order, first match wins ------
// Each pattern is matched against the *bare* piece name (the file name
// minus any `<Set>.` prefix and the `_US.png` suffix), so the same
// rules work for Base ("Goblin_US.png") and expansion sets
// ("KellarsKeep.GiantStoneBoulder_US.png").
const RULES = [
  // heroes (the assets folder is spelled `heros` in this repo)
  { dir: 'heros',     match: /^(Barbarian|Dwarf|Elf|Wizard)/ },

  // monsters — base + expansion creatures and named soldier NPCs.
  // Use a negative lookahead on IceGremlin so the
  // "IceGremlinTreasureRoom" furniture piece doesn't slip in.
  { dir: 'monsters',  match: /^(Goblin|Orc|Fimir|Skeleton|Zombie|Mummy|ChaosWarrior|ChaosSorcerer|Gargoyle|DreadWarrior|Abomination|FrozenHorror|PolarWarbear|YetiBeast|MirrorElf|FrozenElf|Yeti|IceGremlin(?!TreasureRoom)|Halberdier|Crossbowman|Swordsman|Scout|ElvenWarrior|ElvenArcher|OgreWarrior|OgreChampion|OgreLord|OgreChieftain|GiantWolf|Necromancer|HighMage|StormMaster|OrcShaman|DarkWarrior)/ },

  // tiles — markers, doors, traps, blocked squares, stairs, corridor
  // pieces, hazards, magical-effect tiles, boulders, ice slip pieces,
  // crevasses, river sections, teleporters, arrows. Patterns are
  // explicit rather than substring-y so room names containing "Pit"
  // or "Stairway" don't get pulled into tiles by accident.
  { dir: 'tiles',     match: /^(Letter|Number|Door(?:In|Out|Trap)?$|Door_|SecretDoor|DoubleArrowDoor|OpenDoor|TrapDoor|StoneDoorway|Portcullis|FallingRock|PitTrap|LongPitTrap|DeepPitTrap|DeepPitTrapAlternate|SpearTrap|TreasureChestTrap|SwingingAxe|SwingingBladeTrap|HurricaneTrap|FireburstTrap|TeleportTrap|SingleBlockedSquare|DoubleBlockedSquare|Stairway$|ShortStairway|LongStairway|Stairs$|CliffCorridor|GiantStoneBoulder|StarBurst|CloudOfChaos|DarkArrow|DeathMist|Fog$|BottomlessChasm|IceLedge|IceSlide|IceTunnel|IceCaveEntrance|IcyRiver|SlipperyIce|Stalactite|WanderingMonster|Quicksand|Arrow$)/ },

  // everything else → furniture
  { dir: 'furniture', match: /.*/ },
];

function bareName(filename) {
  // "KellarsKeep.GiantStoneBoulder_US.png" → "GiantStoneBoulder"
  // "Goblin_US.png"                        → "Goblin"
  let n = filename.replace(/_US\.png$/i, '').replace(/\.png$/i, '');
  const dot = n.indexOf('.');
  if (dot >= 0) n = n.slice(dot + 1);   // drop "<Set>." prefix
  return n;
}

function categoriseOf(filename) {
  const bare = bareName(filename);
  for (const r of RULES) if (r.match.test(bare)) return r.dir;
  return 'furniture';
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'hq-fetch' } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    const handle = (u, redirectsLeft) => {
      https.get(u, { headers: { 'User-Agent': 'hq-fetch' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
          return handle(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${u}`));
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      }).on('error', reject);
    };
    handle(url, 5);
  });
}

// strip the trailing `_US` suffix to give cleaner filenames
function localName(remote) {
  return remote.replace(/_US\.png$/i, '.png');
}

async function fetchSet(setName) {
  console.log(`\n=== ${setName} ===`);
  let listing;
  try {
    listing = await getJson(setApi(setName));
  } catch (e) {
    console.error(`  ! could not list set "${setName}": ${e.message}`);
    return { written: 0, skipped: 0, failed: 1 };
  }
  const pngs = listing.filter(f => f.name && f.name.toLowerCase().endsWith('.png'));
  console.log(`  found ${pngs.length} PNG(s).`);

  let written = 0, skipped = 0, failed = 0;
  await Promise.all(pngs.map(async f => {
    const cat   = categoriseOf(f.name);
    const local = localName(f.name);
    const dest  = path.join(ROOT, cat, local);
    if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) {
      skipped++;
      return;
    }
    try {
      await downloadBinary(f.download_url, dest);
      written++;
      console.log(`  → ${cat}/${local}  (${f.size} bytes)`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${cat}/${local}: ${e.message}`);
    }
  }));
  return { written, skipped, failed };
}

(async () => {
  for (const d of ['heros', 'monsters', 'furniture', 'tiles']) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }

  let sets;
  if (SET === 'all') {
    const parent = await getJson(PARENT_API);
    sets = parent.filter(e => e.type === 'dir').map(e => e.name);
    console.log(`Discovered sets:`, sets.join(', '));
  } else {
    sets = [SET];
  }

  const totals = { written: 0, skipped: 0, failed: 0 };
  for (const s of sets) {
    const r = await fetchSet(s);
    totals.written += r.written;
    totals.skipped += r.skipped;
    totals.failed  += r.failed;
  }

  console.log(`\nDone. ${totals.written} written, ${totals.skipped} skipped, ${totals.failed} failed.`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
