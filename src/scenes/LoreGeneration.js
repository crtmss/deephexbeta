// src/scenes/LoreGeneration.js
//
// Deterministic lore generation for the whole island.
// Now uses multiple phases & event pools and inspects the map's
// terrain/resources to generate resource-aware events.
//
// Public API (unchanged):
//   generateRuinLoreForTile(scene, tile)
//   generateRoadLoreForExistingConnections(scene)
//
// IMPORTANT:
//   This file now also shapes POI (mapInfo.objects) based on the
//   generated lore, establishing the order:
//     seed -> lore -> POI

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

/**
 * Lightweight scan of terrain & resources to drive resource-aware lore.
 * Tries to be robust to unknown structures by checking several patterns.
 */
function analyzeResources(tiles, mapObjects) {
  let waterTiles = 0;
  let shallowWaterTiles = 0;
  let forestTiles = 0;
  let mountainTiles = 0;
  let fishNodes = 0;
  let oilNodes = 0;

  for (const t of tiles) {
    if (!t) continue;
    if (t.type === "water") {
      waterTiles++;
      const depth = typeof t.waterDepth === "number" ? t.waterDepth : 2;
      if (depth <= 2) shallowWaterTiles++;
    }
    if (t.hasForest) forestTiles++;
    if (t.type === "mountain" || t.elevation === 7) mountainTiles++;

    // Try to guess resource markers on tiles
    const resType = String(t.resourceType || "").toLowerCase();
    if (resType === "fish") fishNodes++;
    if (resType === "crudeoil" || resType === "crude_oil" || resType === "oil") oilNodes++;

    if (Array.isArray(t.resources)) {
      for (const r of t.resources) {
        const rt = String(r?.type || "").toLowerCase();
        if (rt === "fish") fishNodes++;
        if (rt === "crudeoil" || rt === "crude_oil" || rt === "oil") oilNodes++;
      }
    }
    if (t.hasFishResource) fishNodes++;
    if (t.hasCrudeOilResource || t.hasOilResource) oilNodes++;
  }

  for (const o of mapObjects) {
    const t = String(o.type || "").toLowerCase();
    if (t === "fish" || t === "fish_node") fishNodes++;
    if (t === "crudeoil" || t === "crude_oil" || t === "oil") oilNodes++;
  }

  const total = tiles.length || 1;
  return {
    waterTiles,
    shallowWaterTiles,
    forestTiles,
    mountainTiles,
    fishNodes,
    oilNodes,
    waterRatio: waterTiles / total,
    forestRatio: forestTiles / total,
    mountainRatio: mountainTiles / total,
  };
}

function ensureWorldLoreGenerated(scene) {
  if (!scene || scene.__worldLoreGenerated) return;

  const seedStr = String(scene.seed || "000000");
  const rng = xorshift32(hashStr32(`${seedStr}|worldLoreV3`));

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;
  if (!addEntry) {
    scene.__worldLoreGenerated = true;
    return;
  }

  const tiles = Array.isArray(scene.mapData) ? scene.mapData : [];

  const originalMapObjects = scene.mapInfo && Array.isArray(scene.mapInfo.objects)
    ? scene.mapInfo.objects
    : [];

  // World-level POI state that will be shaped by lore.
  // Start with a shallow copy of whatever is already present.
  const worldObjects = originalMapObjects.map(o => ({ ...o }));

  const resInfo = analyzeResources(tiles, worldObjects);

  const ruins = worldObjects.filter(o =>
    String(o.type || "").toLowerCase() === "ruin"
  );
  const crashSites = worldObjects.filter(o => {
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
  const factionC = factions[2]; // currently unused but kept for future phases

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

    // Record the outpost as a POI in worldObjects (seed -> lore -> POI).
    worldObjects.push({
      q: loc.q,
      r: loc.r,
      type: "outpost",
      name,
      faction: factionA,
    });

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

  if (firstOut) {
    events.push({
      year: baseYear,
      text: `${factionA} sight ${islandName} and establish the outpost ${firstOut.name} near (${firstOut.q},${firstOut.r}).`,
      type: "discovery",
    });
  }

  const hasCrashSite = crashSites.length > 0;

  if (hasCrashSite && rng() < 0.5) {
    const c = crashSites[Math.floor(rng() * crashSites.length)];
    events.push({
      year: baseYear + 3,
      text: `A derelict vessel is found beached near (${c.q},${c.r}); scavengers from ${firstOut ? firstOut.name : "the first camp"} drag its timbers inland.`,
      type: "early_scavenging",
    });
  }

  // Phase 2: Expansion & economy — now resource-aware
  const econTemplates = [];

  // Generic fishing / food if lots of water or fish nodes
  if (resInfo.waterRatio > 0.25 || resInfo.fishNodes > 4) {
    econTemplates.push((year) => ({
      year,
      text: `${factionA} begin netting the surrounding shallows, raising fishpens and smoke racks along the coves of ${islandName}.`,
      type: "fish_economy",
    }));

    econTemplates.push((year) => ({
      year,
      text: `Skiffs from ${firstOut ? firstOut.name : "the first settlement"} push ever farther offshore, following glittering shoals that circle ${islandName} each season.`,
      type: "deep_fishing",
    }));
  } else {
    econTemplates.push((year) => ({
      year,
      text: `${factionA} clear a few terraces of soil around ${firstOut ? firstOut.name : "their first camp"}, coaxing thin crops from the island's dust.`,
      type: "meagre_farming",
    }));
  }

  // Forest-based events
  if (resInfo.forestRatio > 0.15 || resInfo.forestTiles > 40) {
    econTemplates.push((year) => ({
      year,
      text: `Loggers from ${firstOut ? firstOut.name : "the main settlement"} move into the island's thickets, cutting timber for piers and modest halls.`,
      type: "logging",
    }));

    econTemplates.push((year) => ({
      year,
      text: `The best trunks are hauled to the shore and shaped into hulls; small shipyards grow up beside ${firstOut ? firstOut.name : "the harbor"}.`,
      type: "shipbuilding",
    }));
  }

  // Mountain / ore events
  if (resInfo.mountainRatio > 0.08 || resInfo.mountainTiles > 20) {
    econTemplates.push((year) => ({
      year,
      text: `Prospectors hammer the cliffs and ridges of ${islandName}, marking seams where metal glints in the rock.`,
      type: "prospecting",
    }));

    econTemplates.push((year) => ({
      year,
      text: `Mines bite into the hills; carts from ${firstOut ? firstOut.name : "the coastal yards"} creak under ore bound for crude smelters by the shore.`,
      type: "mining",
    }));
  }

  // Oil events – based on crude oil resource nodes or lots of shallow water
  if (resInfo.oilNodes > 0 || (resInfo.shallowWaterTiles > 20 && rng() < 0.6)) {
    econTemplates.push((year) => ({
      year,
      text: `Dark slicks are spotted in the shallows; ${factionA} rig makeshift derricks over the seabed near ${firstOut ? firstOut.name : "their harbor"}.`,
      type: "oil_discovery",
    }));

    econTemplates.push((year) => ({
      year,
      text: `Crude from the reefs of ${islandName} is boiled down in noisy stills; lamps in ${firstOut ? firstOut.name : "the settlements"} burn late into the night.`,
      type: "oil_refining",
    }));
  }

  // Always have at least one generic trade / paths template
  econTemplates.push((year) => ({
    year,
    text: `Trade slowly picks up; small cutters from distant ports anchor off ${islandName} to barter for whatever the settlers can spare.`,
    type: "trade_grows",
  }));

  econTemplates.push((year) => ({
    year,
    text: `Work crews from ${firstOut ? firstOut.name : "the main settlement"} lay crude paths inland, marking the first overland routes on ${islandName}.`,
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
  const econEventsToTake = 2 + Math.floor(rng() * 3); // 2–4 events
  const econPool = [...econTemplates];
  for (let i = 0; i < econEventsToTake && econPool.length; i++) {
    const idx = Math.floor(rng() * econPool.length);
    const fn = econPool[idx];
    econPool.splice(idx, 1);
    events.push(fn(yearCursor));
    yearCursor += 4 + Math.floor(rng() * 6);
  }

  // Phase 3: Other factions / tensions OR deeper economy
  const multiFaction = factionB && rng() < 0.7;

  if (multiFaction) {
    const out2 = outposts[1] || firstOut || outposts[0];
    if (out2) {
      events.push({
        year: yearCursor,
        text: `${factionB} arrive on ${islandName}, staking a claim near (${out2.q},${out2.r}) and raising banners not far from ${firstOut ? firstOut.name : "the first settlement"}.`,
        type: "second_faction_arrives",
      });
      yearCursor += 7 + Math.floor(rng() * 5);
    }

    if (rng() < 0.6) {
      events.push({
        year: yearCursor,
        text: `Patrols from ${factionA} and ${factionB} cross paths; markers are torn down, and arguments over streams, coves and seams of ore grow violent.`,
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
    const targetOut = outposts[1] || firstOut || outposts[0];
    if (targetOut) {
      events.push({
        year: yearCursor,
        text: `A brief war flares: ${attacker} storm ${targetOut.name}, and for a season, campfires of ${defender} burn only on the far horizon.`,
        type: "brief_war",
      });
      yearCursor += 4 + Math.floor(rng() * 3);
    }
  }

  // Phase 4: Climax (cataclysm)
  const disaster = pick(rng, DISASTER_TYPES);

  const namesList = outposts.map(o => o.name).join(", ");

  let finalCataclysmEvent = null;

  if (rng() < 0.5) {
    finalCataclysmEvent = {
      year: yearCursor,
      text: `As arguments over supply and tribute sharpen, every banner on ${islandName} is struck down at once when ${disaster} ravages ${namesList}.`,
      type: "cataclysm_conflict",
      disaster,
    };
    events.push(finalCataclysmEvent);
  } else {
    let resourceFlavor = "";
    if (resInfo.oilNodes > 0) {
      resourceFlavor = "oil rigs rust and topple,";
    } else if (resInfo.mountainTiles > 10) {
      resourceFlavor = "shafts cave in and furnaces go cold,";
    } else if (resInfo.fishNodes > 3 || resInfo.waterRatio > 0.25) {
      resourceFlavor = "nets rot on their poles and the harbors silt over,";
    } else if (resInfo.forestTiles > 20) {
      resourceFlavor = "cut stumps stand along the hillsides like teeth,";
    }

    finalCataclysmEvent = {
      year: yearCursor,
      text: `Years of overfishing, scavenging and quiet feuds leave ${islandName} hollow; ${resourceFlavor} and when ${disaster} comes there is no strength left to resist, and ${namesList} fall silent.`,
      type: "cataclysm_collapse",
      disaster,
    };
    events.push(finalCataclysmEvent);
  }

  // === Lore -> POI translation step ==================================
  // At the moment of the cataclysm, all outposts are considered ruined.
  // We convert the corresponding POI entries from "outpost" to "ruin".
  if (finalCataclysmEvent) {
    for (const obj of worldObjects) {
      const t = String(obj.type || "").toLowerCase();
      if (t === "outpost") {
        obj.type = "ruin";
        obj.wasOutpost = true;
        obj.ruinedYear = finalCataclysmEvent.year;
      }
    }
  }
  // ===================================================================

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
    resources: resInfo,
  };

  // Seed -> lore -> POI: commit worldObjects back into the mapInfo.
  if (!scene.mapInfo) scene.mapInfo = { tiles, objects: [] };
  scene.mapInfo.objects = worldObjects;
  if (scene.hexMap) {
    // Keep hexMap.objects in sync if used elsewhere.
    scene.hexMap.objects = worldObjects;
  }

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
  if (!co
