// src/scenes/LoreGeneration.js
//
// Deterministic lore generation for the whole island.
// Now uses multiple phases & event pools so each island's story
// can vary much more than the previous 2-scenario version.
//
// Public API (unchanged):
//   generateRuinLoreForTile(scene, tile)
//   generateRoadLoreForExistingConnections(scene)
//
// Implementation idea:
//   - Once per world, we build an "island arc" with phases:
//       discovery → expansion → tension/economy → climax
//   - Each phase draws 1–3 events from a pool, depending on
//     how many factions & outposts exist.
//   - Ruins / crash sites are used as named outposts.
//   - Roads get separate "road built" events based on the
//     roadConnections recorded on the scene.

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
  "Glass Current Guild",
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
  "Gloomharbor",
];

const OUTPOST_PREFIX = [
  "Outpost",
  "Harbor",
  "Fort",
  "Watch",
  "Camp",
  "Dock",
  "Station",
];

const OUTPOST_ROOT = [
  "Aster",
  "Gale",
  "Karn",
  "Mire",
  "Ridge",
  "Pearl",
  "Thorn",
  "Skerry",
];

const DISASTER_TYPES = [
  "a meteor shower",
  "a sweeping plague",
  "a black tide",
  "rising seas",
  "a chain of earthquakes",
  "a burning sky",
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

function ensureWorldLoreGenerated(scene) {
  if (!scene || scene.__worldLoreGenerated) return;

  const seedStr = String(scene.seed || "000000");
  const rng = xorshift32(hashStr32(`${seedStr}|worldLoreV2`));

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;
  if (!addEntry) {
    scene.__worldLoreGenerated = true;
    return;
  }

  const mapObjects = scene.mapInfo && Array.isArray(scene.mapInfo.objects)
    ? scene.mapInfo.objects
    : [];
  const tiles = Array.isArray(scene.mapData) ? scene.mapData : [];

  const ruins = mapObjects.filter(o =>
    String(o.type || "").toLowerCase() === "ruin"
  );
  const crashSites = mapObjects.filter(o => {
    const t = String(o.type || "").toLowerCase();
    return t === "crash_site" || t === "wreck";
  });
  const anyLand = tiles.filter(t => t && t.type !== "water");

  // --- Island name & factions ---
  const islandName = `${pick(rng, ISLAND_PREFIX)} ${pick(rng, ISLAND_ROOT)}`;

  const factionCount = 1 + Math.floor(rng() * 3); // 1–3
  const factions = pickMany(rng, FACTIONS, factionCount);
  const factionA = factions[0];
  const factionB = factions[1];
  const factionC = factions[2];

  // --- Key locations → outposts ---
  const keyLocs = [];
  const basePool = ruins.length ? ruins : anyLand;
  const maxLocs = Math.min(4, basePool.length || 4);
  const used = new Set();

  for (let i = 0; i < maxLocs && basePool.length; i++) {
    let idx = Math.floor(rng() * basePool.length);
    let tries = 0;
    while (tries < 10 && used.has(idx)) {
      idx = Math.floor(rng() * basePool.length);
      tries++;
    }
    used.add(idx);
    const obj = basePool[idx];
    keyLocs.push({
      q: obj.q,
      r: obj.r,
      type: String(obj.type || (obj.type === "water" ? "water" : "land")).toLowerCase(),
    });
  }

  if (!keyLocs.length && anyLand.length) {
    const t = anyLand[Math.floor(rng() * anyLand.length)];
    keyLocs.push({ q: t.q, r: t.r, type: "land" });
  }

  const getTile = (q, r) => tiles.find(t => t.q === q && t.r === r);

  const outposts = keyLocs.map((loc, idx) => {
    const name = `${pick(rng, OUTPOST_PREFIX)} ${pick(rng, OUTPOST_ROOT)}${idx ? "-" + (idx + 1) : ""}`;
    const tile = getTile(loc.q, loc.r);
    if (tile) {
      tile.cityName = name;
      tile.owningFaction = factionA;
    }
    return {
      name,
      q: loc.q,
      r: loc.r,
      type: loc.type,
    };
  });

  // --- Phased storyline ---
  const baseYear = 5000;
  const events = [];

  // Phase 1: Discovery / first settlement
  const firstOut = outposts[0];

  events.push({
    year: baseYear,
    text: `${factionA} sight ${islandName} and establish the outpost ${firstOut.name} near (${firstOut.q},${firstOut.r}).`,
    type: "discovery",
  });

  const hasCrashSite = crashSites.length > 0;

  if (hasCrashSite && rng() < 0.5) {
    const c = crashSites[Math.floor(rng() * crashSites.length)];
    events.push({
      year: baseYear + 3,
      text: `A derelict vessel is found beached near (${c.q},${c.r}); scavengers from ${firstOut.name} drag its timbers inland.`,
      type: "early_scavenging",
    });
  }

  // Phase 2: Expansion & economy
  const econTemplates = [];

  econTemplates.push((year) => ({
    year,
    text: `${factionA} begin netting the surrounding shallows, raising fishpens and smoke racks along the coves of ${islandName}.`,
    type: "fish_economy",
  }));

  econTemplates.push((year) => ({
    year,
    text: `Trade slowly picks up; small cutters from distant ports anchor off ${islandName} to barter for dried fish and scrap.`,
    type: "trade_grows",
  }));

  econTemplates.push((year) => ({
    year,
    text: `Work crews from ${firstOut.name} lay crude paths inland, marking the first overland routes on ${islandName}.`,
    type: "paths_built",
  }));

  if (outposts[1]) {
    const out2 = outposts[1];
    econTemplates.push((year) => ({
      year,
      text: `To secure another anchorage, ${factionA} raise a second outpost, ${out2.name}, on the far side of ${islandName}.`,
      type: "second_outpost",
    }));
  }

  let yearCursor = baseYear + 8;
  const econEventsToTake = 1 + Math.floor(rng() * 3); // 1–3 events
  const econPool = [...econTemplates];
  for (let i = 0; i < econEventsToTake && econPool.length; i++) {
    const idx = Math.floor(rng() * econPool.length);
    const fn = econPool[idx];
    econPool.splice(idx, 1);
    events.push(fn(yearCursor));
    yearCursor += 5 + Math.floor(rng() * 6);
  }

  // Phase 3: Other factions / tensions OR deeper economy
  const multiFaction = factionB && rng() < 0.7;

  if (multiFaction) {
    const out2 = outposts[1] || firstOut;
    events.push({
      year: yearCursor,
      text: `${factionB} arrive on ${islandName}, staking a claim near (${out2.q},${out2.r}) and raising banners not far from ${firstOut.name}.`,
      type: "second_faction_arrives",
    });
    yearCursor += 7 + Math.floor(rng() * 5);

    if (rng() < 0.6) {
      events.push({
        year: yearCursor,
        text: `Patrols from ${factionA} and ${factionB} cross paths; markers are torn down, and arguments over streams and coves grow violent.`,
        type: "tensions_rise",
      });
      yearCursor += 5 + Math.floor(rng() * 4);
    }

    if (outposts[2] && rng() < 0.7) {
      const out3 = outposts[2];
      events.push({
        year: yearCursor,
        text: `${factionA} answer the pressure by founding a new redoubt, ${out3.name}, closer to the disputed shore.`,
        type: "third_outpost_built",
      });
      yearCursor += 4 + Math.floor(rng() * 4);
    }
  } else {
    if (outposts[2] && rng() < 0.7) {
      const out3 = outposts[2];
      events.push({
        year: yearCursor,
        text: `Prosperity on ${islandName} allows ${factionA} to form a third settlement, ${out3.name}, overlooking distant reefs.`,
        type: "third_outpost_single_faction",
      });
      yearCursor += 6 + Math.floor(rng() * 5);
    }
  }

  // Optional skirmish / brief war
  if (multiFaction && rng() < 0.7) {
    const attacker = rng() < 0.5 ? factionA : factionB;
    const defender = attacker === factionA ? factionB : factionA;
    const targetOut = outposts[1] || firstOut;
    events.push({
      year: yearCursor,
      text: `A brief war flares: ${attacker} storm ${targetOut.name}, and for a season, campfires of ${defender} burn only on the far horizon.`,
      type: "brief_war",
    });
    yearCursor += 4 + Math.floor(rng() * 3);
  }

  // Phase 4: Climax (cataclysm)
  const disaster = pick(rng, DISASTER_TYPES);

  const namesList = outposts.map(o => o.name).join(", ");

  if (rng() < 0.5) {
    events.push({
      year: yearCursor,
      text: `As arguments over supply and tribute sharpen, every banner on ${islandName} is struck down at once when ${disaster} ravages ${namesList}.`,
      type: "cataclysm_conflict",
      disaster,
    });
  } else {
    events.push({
      year: yearCursor,
      text: `Years of overfishing, scavenging and quiet feuds leave ${islandName} hollow. When ${disaster} comes, there is no strength left to resist, and ${namesList} fall silent.`,
      type: "cataclysm_collapse",
      disaster,
    });
  }

  // Write events into the history
  for (const ev of events) {
    addEntry({
      year: ev.year,
      text: ev.text,
      type: ev.type,
      islandName,
      factions,
    });
  }

  scene.loreState = {
    islandName,
    factions,
    outposts,
    disaster,
  };

  scene.__worldLoreGenerated = true;
}

// Called per-ruin from WorldSceneMapLocations.
// Now it just ensures world-level lore exists and marks the tile.
export function generateRuinLoreForTile(scene, tile) {
  if (!scene || !tile) return;
  ensureWorldLoreGenerated(scene);
  tile.__loreGenerated = true;
}

// Same API as before: we add "road built" events based on recorded connections.
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
