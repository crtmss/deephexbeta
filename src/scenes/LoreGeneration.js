// src/scenes/LoreGeneration.js
//
// Deterministic lore generation for the whole island.
// Instead of giving each ruin a tiny 4-line story, we now:
// - Generate a single island-level storyline per world (per seed).
// - Use 1–2 factions, an island name, and multiple outposts.
// - Create events like:
//    • faction arrives and founds first outpost
//    • second faction arrives (optional)
//    • tensions rise, expansion, trade, roads
//    • war / plague / meteor wipes everything into ruins
//
// Public API (kept for compatibility):
//   generateRuinLoreForTile(scene, tile)
//   generateRoadLoreForExistingConnections(scene)
//
// NOTE: generateRuinLoreForTile() now just ensures the world-level lore
// has been generated once; it does NOT emit per-tile micro-stories anymore.
// This way all ruins share a common history.

function hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

const FACTIONS = [
  "Azure Concord",
  "Dust Mariners",
  "Iron Compact",
  "Verdant Covenant",
  "Sable Court",
  "Old Reef League",
  "Marrow Tide Company",
];

const ISLAND_PREFIX = [
  "Isle of",
  "Island of",
  "Shoals of",
  "Reach of",
  "Haven of",
  "Reef of",
];

const ISLAND_ROOT = [
  "Brinefall",
  "Nareth",
  "Korvan",
  "Greywatch",
  "Solmere",
  "Lowmar",
  "Tiderest",
  "Stormwake",
];

const OUTPOST_PREFIX = [
  "Outpost",
  "Harbor",
  "Fort",
  "Watch",
  "Camp",
  "Dock",
];

const OUTPOST_ROOT = [
  "Aster",
  "Gale",
  "Karn",
  "Mire",
  "Ridge",
  "Pearl",
  "Thorn",
];

const DISASTER_TYPES = [
  "a meteor shower",
  "a great plague",
  "a black tide",
  "rising seas",
  "a chain of earthquakes",
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickMany(rng, arr, count) {
  const pool = [...arr];
  const res = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    res.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return res;
}

/**
 * Ensure that world-level lore for this scene is generated once.
 * Uses:
 *   - scene.seed
 *   - scene.mapInfo.objects (for ruins/crash_sites)
 *   - scene.mapData (to annotate tiles with meta)
 */
function ensureWorldLoreGenerated(scene) {
  if (!scene || scene.__worldLoreGenerated) return;

  const seedStr = String(scene.seed || "000000");
  const rng = xorshift32(hashStr32(`${seedStr}|worldLore`));

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;
  if (!addEntry) {
    // If there's no history system wired yet, bail out silently.
    scene.__worldLoreGenerated = true;
    return;
  }

  const mapObjects = scene.mapInfo && Array.isArray(scene.mapInfo.objects)
    ? scene.mapInfo.objects
    : [];

  const ruins = mapObjects.filter(o =>
    String(o.type || "").toLowerCase() === "ruin"
  );
  const crashSites = mapObjects.filter(o => {
    const t = String(o.type || "").toLowerCase();
    return t === "crash_site" || t === "wreck";
  });

  // Fallback coords if there are no explicit objects
  const tiles = Array.isArray(scene.mapData) ? scene.mapData : [];
  const anyLand = tiles.filter(t => t && t.type !== "water");

  // Island name & factions
  const islandName = `${pick(rng, ISLAND_PREFIX)} ${pick(rng, ISLAND_ROOT)}`;

  // 1 or 2 main factions
  const factionCount = rng() < 0.6 ? 2 : 1;
  const factions = pickMany(rng, FACTIONS, factionCount);
  const factionA = factions[0] || pick(rng, FACTIONS);
  const factionB = factions[1] || pick(rng, FACTIONS);

  // Key locations: up to 3 ruins or any land tiles
  const keyLocs = [];
  const pool = ruins.length ? ruins : anyLand;
  const maxLocs = 3;
  const used = new Set();
  for (let i = 0; i < maxLocs && pool.length; i++) {
    let idx = Math.floor(rng() * pool.length);
    let tries = 0;
    while (tries < 10 && used.has(idx)) {
      idx = Math.floor(rng() * pool.length);
      tries++;
    }
    used.add(idx);
    const obj = pool[idx];
    keyLocs.push({ q: obj.q, r: obj.r, type: String(obj.type || "").toLowerCase() });
  }

  if (!keyLocs.length && anyLand.length) {
    const t = anyLand[Math.floor(rng() * anyLand.length)];
    keyLocs.push({ q: t.q, r: t.r, type: "land" });
  }

  // Helper to find matching tile & annotate
  const getTile = (q, r) =>
    tiles.find(t => t.q === q && t.r === r);

  const outposts = keyLocs.map((loc, idx) => {
    const name = `${pick(rng, OUTPOST_PREFIX)} ${pick(rng, OUTPOST_ROOT)}${idx ? "-" + (idx + 1) : ""}`;
    const tile = getTile(loc.q, loc.r);
    if (tile) {
      tile.cityName = name;
    }
    return {
      name,
      q: loc.q,
      r: loc.r,
      type: loc.type,
    };
  });

  const baseYear = 5000;
  const events = [];

  // Decide scenario: A = two factions & war; B = single faction growth & plague.
  const scenario = (factionCount === 2 && rng() < 0.7) ? "A" : "B";

  if (scenario === "A") {
    // === Scenario A: contested island, war, cataclysm ===
    const disaster = pick(rng, DISASTER_TYPES);

    const out1 = outposts[0];
    const out2 = outposts[1] || out1;
    const out3 = outposts[2] || out2;

    events.push({
      year: baseYear,
      text: `${factionA} first discover ${islandName} and establish the outpost ${out1.name} near hex (${out1.q},${out1.r}).`,
      type: "island_discovered",
    });

    events.push({
      year: baseYear + 7,
      text: `${factionB} arrive on ${islandName} and settle on the distant shore, founding ${out2.name} at (${out2.q},${out2.r}).`,
      type: "second_faction_arrives",
    });

    events.push({
      year: baseYear + 23,
      text: `Tensions between ${factionA} and ${factionB} rise as patrols cross paths and trade routes are disputed.`,
      type: "tensions_rise",
    });

    events.push({
      year: baseYear + 37,
      text: `${factionA} expands, building a second outpost called ${out3.name} on the shore of ${islandName}.`,
      type: "second_outpost_built",
    });

    events.push({
      year: baseYear + 41,
      text: `${factionB} declares war and seizes ${out1.name}, driving ${factionA} back to the far side of the island.`,
      type: "war_outbreak",
    });

    events.push({
      year: baseYear + 42,
      text: `In the chaos of the war, ${disaster} devastates ${islandName}, leaving ${out1.name}, ${out2.name} and ${out3.name} in ruins.`,
      type: "cataclysm",
      disaster,
    });
  } else {
    // === Scenario B: single faction growth, economy, then plague ===
    const disaster = "a sweeping plague";

    const out1 = outposts[0];
    const out2 = outposts[1] || out1;
    const out3 = outposts[2] || out2;

    events.push({
      year: baseYear,
      text: `${factionA} settle ${islandName}, founding the outpost ${out1.name} near the higher ground at (${out1.q},${out1.r}).`,
      type: "island_settled",
    });

    events.push({
      year: baseYear + 11,
      text: `${factionA} starts gathering food from the surrounding waters, establishing fish farms and drying racks along the coast.`,
      type: "food_economy",
    });

    events.push({
      year: baseYear + 13,
      text: `${factionA}'s trade flourishes; merchants pass through ${islandName}, and a second outpost, ${out2.name}, is built on the opposite shore.`,
      type: "trade_boom",
    });

    events.push({
      year: baseYear + 27,
      text: `Roads and small docks are constructed between ${out1.name} and ${out2.name}, turning ${islandName} into a minor hub.`,
      type: "infrastructure",
    });

    events.push({
      year: baseYear + 41,
      text: `${factionA} establishes a third outpost, ${out3.name}, to control the far reefs and fishing grounds.`,
      type: "third_outpost_built",
    });

    events.push({
      year: baseYear + 59,
      text: `A sudden outbreak of ${disaster} sweeps across ${islandName}, emptying ${out1.name}, ${out2.name} and ${out3.name} and leaving only ruins behind.`,
      type: "plague_cataclysm",
      disaster,
    });
  }

  // Write all events into the history
  for (const ev of events) {
    addEntry({
      year: ev.year,
      text: ev.text,
      type: ev.type,
      islandName,
      factions,
    });
  }

  // Store some global lore state for other systems (roads, etc.)
  scene.loreState = {
    islandName,
    factions,
    outposts,
  };

  scene.__worldLoreGenerated = true;
}

/**
 * Called from WorldSceneMapLocations for each ruin tile.
 * Now it simply ensures world-level lore exists and
 * marks the tile as "participating" in that lore.
 */
export function generateRuinLoreForTile(scene, tile) {
  if (!scene || !tile) return;
  ensureWorldLoreGenerated(scene);

  // Mark tile so we don't try to "regenerate" per-tile stories anywhere else.
  tile.__loreGenerated = true;
}

/**
 * Road lore still works like before: for each recorded connection
 * in scene.roadConnections we create a "road built from X to Y"
 * event. We also make sure world-level lore exists first so that
 * outpost names / factions can be reused.
 */
export function generateRoadLoreForExistingConnections(scene) {
  if (!scene) return;

  ensureWorldLoreGenerated(scene);

  if (scene.__roadLoreGenerated) return;

  const conns = Array.isArray(scene.roadConnections)
    ? scene.roadConnections
    : [];
  if (!conns.length) {
    scene.__roadLoreGenerated = true;
    return;
  }

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;
  if (!addEntry) {
    scene.__roadLoreGenerated = true;
    return;
  }

  const tiles = Array.isArray(scene.mapData) ? scene.mapData : [];
  const getTile = (q, r) => tiles.find(t => t.q === q && t.r === r);

  const islandName = scene.loreState?.islandName || "the island";
  const factions = scene.loreState?.factions || [];

  const defaultFaction = factions[0] || "an unknown faction";

  for (const conn of conns) {
    const fq = conn.from?.q;
    const fr = conn.from?.r;
    const tq = conn.to?.q;
    const tr = conn.to?.r;

    const fromTile = getTile(fq, fr);
    const toTile   = getTile(tq, tr);

    const faction =
      fromTile?.owningFaction ||
      toTile?.owningFaction ||
      defaultFaction;

    const fromLabel = buildLocationLabel(conn.from, fromTile, true);
    const toLabel   = buildLocationLabel(conn.to, toTile, false);

    const year = scene.getNextHistoryYear
      ? scene.getNextHistoryYear()
      : 5030;

    addEntry({
      year,
      text: `${faction} lay a road across ${islandName}, linking ${fromLabel} with ${toLabel}.`,
      type: "road_built",
      from: { q: fq, r: fr },
      to: { q: tq, r: tr },
      faction,
    });
  }

  scene.__roadLoreGenerated = true;
}

function buildLocationLabel(endpoint, tile, isFrom) {
  if (!endpoint) return "an unknown place";
  const q = endpoint.q;
  const r = endpoint.r;
  const type = String(endpoint.type || "").toLowerCase();

  if (tile && tile.cityName) {
    if (isFrom) {
      return `the outpost ${tile.cityName} (${q},${r})`;
    }
    return `the ruins of ${tile.cityName} (${q},${r})`;
  }

  if (type === "crash_site" || type === "wreck") {
    return `a crash site near (${q},${r})`;
  }

  if (type === "vehicle") {
    return `a stranded vehicle at (${q},${r})`;
  }

  if (type === "ruin") {
    return `ruins at (${q},${r})`;
  }

  return `(${q},${r})`;
}
