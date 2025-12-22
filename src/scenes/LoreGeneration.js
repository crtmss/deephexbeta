// src/scenes/LoreGeneration.js
//
// Deterministic lore generation for the whole island.
// Resource-aware + POI-aware lore.
// seed -> lore -> POI (scene.mapInfo.objects)
//
// Public API (unchanged):
//   generateRuinLoreForTile(scene, tile)
//   generateRoadLoreForExistingConnections(scene)

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

const PLACE_PREFIX = [
  "Outpost",
  "Harbor",
  "Fort",
  "Watch",
  "Camp",
  "Dock",
  "Station",
  "Hold",
  "Gate",
];

const PLACE_ROOT = [
  "Aster",
  "Gale",
  "Karn",
  "Mire",
  "Ridge",
  "Pearl",
  "Thorn",
  "Skerry",
  "Cairn",
  "Warden",
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

// Axial distance
function hexDistance(a, b) {
  const dq = (b.q - a.q);
  const dr = (b.r - a.r);
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function ensureWorldLoreGenerated(scene) {
  if (!scene || scene.__worldLoreGenerated) return;

  const seedStr = String(scene.seed || "000000");
  // Bump version so deterministic output changes in a controlled way
  const rng = xorshift32(hashStr32(`${seedStr}|worldLoreV4`));

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;

  if (!addEntry) {
    scene.__worldLoreGenerated = true;
    return;
  }

  const tiles = Array.isArray(scene.mapData) ? scene.mapData : [];

  const originalMapObjects =
    scene.mapInfo && Array.isArray(scene.mapInfo.objects)
      ? scene.mapInfo.objects
      : [];

  // Start with a shallow copy of whatever is already present.
  const worldObjects = originalMapObjects.map((o) => ({ ...o }));

  const resInfo = analyzeResources(tiles, worldObjects);

  const anyLand = tiles.filter((t) => t && t.type !== "water");
  const anyWater = tiles.filter((t) => t && t.type === "water");

  const getTile = (q, r) => tiles.find((t) => t.q === q && t.r === r);

  const isMountainish = (t) => t && (t.type === "mountain" || t.elevation === 7);
  const isHigh = (t) => t && (typeof t.elevation === "number") && t.elevation >= 5 && t.type !== "water";
  const isForesty = (t) => t && (t.hasForest || String(t.type || "").toLowerCase() === "forest");

  const isCoast = (t) => {
    if (!t || t.type === "water") return false;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
    for (const [dq, dr] of dirs) {
      const nb = getTile(t.q + dq, t.r + dr);
      if (nb && nb.type === "water") return true;
    }
    return false;
  };

  // --- Island name & factions ---
  const islandName = `${pick(rng, ISLAND_PREFIX)} ${pick(rng, ISLAND_ROOT)}`;
  const factionCount = 1 + Math.floor(rng() * 3); // 1–3
  const factions = pickMany(rng, FACTIONS, factionCount);
  const factionA = factions[0];
  const factionB = factions[1];
  // const factionC = factions[2]; // reserved

  // ============================================================
  // POI generation: seed -> lore -> POI
  // ============================================================
  // New POI types:
  //   settlement, ruin, raider_camp, roadside_camp, watchtower, mine, shrine
  // Ensure legacy types appear:
  //   crash_site, wreck, vehicle
  // ============================================================

  // Reserve already-present POIs to avoid collisions
  const taken = new Set();
  const placed = [];
  for (const o of worldObjects) {
    if (o && Number.isFinite(o.q) && Number.isFinite(o.r)) {
      const k = `${o.q},${o.r}`;
      taken.add(k);
      placed.push({ q: o.q, r: o.r });
    }
  }

  const isFree = (q, r) => !taken.has(`${q},${r}`);

  const farEnough = (q, r, minDist) => {
    const p = { q, r };
    for (const ex of placed) {
      if (hexDistance(ex, p) < minDist) return false;
    }
    return true;
  };

  function pickTileFromPool(pool, { minDist = 3, tries = 80 } = {}) {
    if (!pool || !pool.length) return null;
    for (let i = 0; i < tries; i++) {
      const t = pool[Math.floor(rng() * pool.length)];
      if (!t) continue;
      if (!isFree(t.q, t.r)) continue;
      if (!farEnough(t.q, t.r, minDist)) continue;
      return t;
    }
    for (let i = 0; i < tries; i++) {
      const t = pool[Math.floor(rng() * pool.length)];
      if (t && isFree(t.q, t.r)) return t;
    }
    return null;
  }

  function markTaken(q, r) {
    const k = `${q},${r}`;
    taken.add(k);
    placed.push({ q, r });
  }

  function makePlaceName(rngLocal, idx = 0, kind = "") {
    const base = `${pick(rngLocal, PLACE_PREFIX)} ${pick(rngLocal, PLACE_ROOT)}`;
    const suffix = idx ? `-${idx + 1}` : "";
    if (!kind) return base + suffix;
    return `${base}${suffix} (${kind})`;
  }

  function addPOI({ type, q, r, name = null, faction = null, meta = null }) {
    worldObjects.push({
      q, r, type,
      ...(name ? { name } : {}),
      ...(faction ? { faction } : {}),
      ...(meta ? meta : {}),
    });
    markTaken(q, r);

    // Put some helpful info on tile for downstream UI (optional)
    const tile = getTile(q, r);
    if (tile) {
      if (type === "settlement") {
        tile.cityName = name || tile.cityName;
        tile.owningFaction = faction || tile.owningFaction;
      }
      if (type === "ruin") {
        tile.cityName = name || tile.cityName;
      }
    }
  }

  const coastLand = anyLand.filter(isCoast);
  const forestLand = anyLand.filter(isForesty);
  const mountainLand = anyLand.filter(isMountainish);
  const highLand = anyLand.filter(isHigh);
  const inlandLand = anyLand.filter((t) => t && !isCoast(t) && t.type !== "water");

  // --- Settlements (1–3) ---
  const settlementCount = 1 + Math.floor(rng() * 3);
  const settlements = [];
  for (let i = 0; i < settlementCount; i++) {
    const pool = coastLand.length ? coastLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (!t) break;
    const name = makePlaceName(rng, i, "Settlement");
    addPOI({ type: "settlement", q: t.q, r: t.r, name, faction: factionA });
    settlements.push({ name, q: t.q, r: t.r, type: "settlement" });
  }

  // --- Ruins (2–5) ---
  const ruinCount = 2 + Math.floor(rng() * 4);
  const ruins = [];
  for (let i = 0; i < ruinCount; i++) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 4 });
    if (!t) break;
    const name = `Ruins of ${pick(rng, PLACE_ROOT)}${i ? "-" + (i + 1) : ""}`;
    addPOI({ type: "ruin", q: t.q, r: t.r, name });
    ruins.push({ name, q: t.q, r: t.r, type: "ruin" });
  }

  // --- Raider camps (1–3) ---
  const raiderCampCount = 1 + Math.floor(rng() * 3);
  const raiderCamps = [];
  for (let i = 0; i < raiderCampCount; i++) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 4 });
    if (!t) break;
    addPOI({ type: "raider_camp", q: t.q, r: t.r });
    raiderCamps.push({ q: t.q, r: t.r, type: "raider_camp" });
  }

  // --- Roadside camps (2–6) ---
  const roadsideCount = 2 + Math.floor(rng() * 5);
  const roadsideCamps = [];
  for (let i = 0; i < roadsideCount; i++) {
    const pool = coastLand.length ? coastLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 3 });
    if (!t) break;
    addPOI({ type: "roadside_camp", q: t.q, r: t.r });
    roadsideCamps.push({ q: t.q, r: t.r, type: "roadside_camp" });
  }

  // --- Watchtowers (1–3) ---
  const towerCount = 1 + Math.floor(rng() * 3);
  const watchtowers = [];
  for (let i = 0; i < towerCount; i++) {
    const pool = highLand.length ? highLand : (mountainLand.length ? mountainLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 4 });
    if (!t) break;
    addPOI({ type: "watchtower", q: t.q, r: t.r });
    watchtowers.push({ q: t.q, r: t.r, type: "watchtower" });
  }

  // --- Mines (1–3) ---
  const mineCount = 1 + Math.floor(rng() * 3);
  const mines = [];
  for (let i = 0; i < mineCount; i++) {
    const pool = mountainLand.length ? mountainLand : (highLand.length ? highLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 4 });
    if (!t) break;
    addPOI({ type: "mine", q: t.q, r: t.r });
    mines.push({ q: t.q, r: t.r, type: "mine" });
  }

  // --- Shrines (1–4) ---
  const shrineCount = 1 + Math.floor(rng() * 4);
  const shrines = [];
  for (let i = 0; i < shrineCount; i++) {
    const pool = forestLand.length ? forestLand : (inlandLand.length ? inlandLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 4 });
    if (!t) break;
    addPOI({ type: "shrine", q: t.q, r: t.r });
    shrines.push({ q: t.q, r: t.r, type: "shrine" });
  }

  // --- Ensure legacy POIs exist: crash_site / wreck / vehicle ---
  const ensureTypeAtLeast = (type, count, pool, opts) => {
    const current = worldObjects.filter((o) => String(o.type || "").toLowerCase() === type).length;
    const need = Math.max(0, count - current);
    for (let i = 0; i < need; i++) {
      const t = pickTileFromPool(pool, opts);
      if (!t) break;
      addPOI({ type, q: t.q, r: t.r });
    }
  };

  ensureTypeAtLeast("crash_site", 1, (coastLand.length ? coastLand : anyLand), { minDist: 4 });
  ensureTypeAtLeast("wreck", 1, (coastLand.length ? coastLand : anyLand), { minDist: 4 });
  ensureTypeAtLeast("vehicle", 1, (inlandLand.length ? inlandLand : anyLand), { minDist: 4 });

  const crashSites = worldObjects.filter((o) => {
    const t = String(o.type || "").toLowerCase();
    return t === "crash_site" || t === "wreck";
  });

  const vehicles = worldObjects.filter((o) => {
    const t = String(o.type || "").toLowerCase();
    return t === "vehicle" || t === "abandoned_vehicle";
  });

  // ============================================================
  // Events (History) — ~3x density
  // ============================================================
  const baseYear = 5000;
  const events = [];

  let yearCursor = baseYear;
  const bumpYear = () => {
    yearCursor += 1 + Math.floor(rng() * 4); // 1..4 years step
    return yearCursor;
  };

  const firstSettlement = settlements[0] || null;

  // Discovery
  if (firstSettlement) {
    events.push({
      year: baseYear,
      text: `${factionA} sight ${islandName} and establish the settlement ${firstSettlement.name} near (${firstSettlement.q},${firstSettlement.r}).`,
      type: "discovery",
      q: firstSettlement.q,
      r: firstSettlement.r,
    });
  } else if (anyLand.length) {
    const t = anyLand[Math.floor(rng() * anyLand.length)];
    events.push({
      year: baseYear,
      text: `${factionA} make landfall on ${islandName}, raising tents at (${t.q},${t.r}) before spreading inland.`,
      type: "discovery",
      q: t.q,
      r: t.r,
    });
  }

  function pushPOIEvent(type, q, r, text) {
    events.push({
      year: bumpYear(),
      text,
      type: "poi_spawned",
      poiType: type,
      q, r,
    });
  }

  // POI appearance events (major density multiplier)
  for (const s of settlements) {
    pushPOIEvent("settlement", s.q, s.r, `${factionA} expand ${s.name} (${s.q},${s.r}); docks and storehouses bring steady traffic to the coast.`);
  }
  for (const rr of ruins) {
    pushPOIEvent("ruin", rr.q, rr.r, `Stonework is found at ${rr.name} (${rr.q},${rr.r}); no one agrees who built it first.`);
  }
  for (const c of raiderCamps) {
    pushPOIEvent("raider_camp", c.q, c.r, `A raider camp takes hold near (${c.q},${c.r}); signal fires warn travelers away.`);
  }
  for (const c of roadsideCamps) {
    pushPOIEvent("roadside_camp", c.q, c.r, `A roadside camp appears at (${c.q},${c.r}), trading scraps and rumors with whoever passes through.`);
  }
  for (const w of watchtowers) {
    pushPOIEvent("watchtower", w.q, w.r, `A watchtower is raised on high ground at (${w.q},${w.r}), watching the approaches.`);
  }
  for (const m of mines) {
    pushPOIEvent("mine", m.q, m.r, `Miners cut a new drift at (${m.q},${m.r}); ore begins to trickle down to the shore.`);
  }
  for (const s of shrines) {
    pushPOIEvent("shrine", s.q, s.r, `A shrine is set up at (${s.q},${s.r}); offerings gather there even in harsh seasons.`);
  }

  // Wreck / crash / vehicle events (guaranteed if POIs exist)
  if (crashSites.length) {
    const c = crashSites[Math.floor(rng() * crashSites.length)];
    events.push({
      year: bumpYear(),
      text: `A derelict hull is discovered near (${c.q},${c.r}); scavengers haul twisted metal inland and argue over the find.`,
      type: "early_scavenging",
      q: c.q,
      r: c.r,
    });
  }
  if (vehicles.length) {
    const v = vehicles[Math.floor(rng() * vehicles.length)];
    events.push({
      year: bumpYear(),
      text: `A stranded vehicle is found at (${v.q},${v.r}); its cargo is stripped, but the frame becomes a landmark for travelers.`,
      type: "vehicle_found",
      q: v.q,
      r: v.r,
    });
  }

  // Economy & expansion (expanded pool, take more)
  const econTemplates = [];

  if (resInfo.waterRatio > 0.25 || resInfo.fishNodes > 4) {
    econTemplates.push((year) => ({
      year,
      text: `${factionA} begin netting the surrounding shallows, raising fishpens and smoke racks along the coves of ${islandName}.`,
      type: "fish_economy",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Skiffs push farther offshore, following glittering shoals that circle ${islandName} each season.`,
      type: "deep_fishing",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Salt-curers and rope-makers gather near the harbors, turning fish runs into hard trade goods.`,
      type: "coastal_industry",
    }));
  } else {
    econTemplates.push((year) => ({
      year,
      text: `${factionA} clear thin terraces of soil and coax stubborn crops from the island's dust.`,
      type: "meagre_farming",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Small gardens and windbreaks spread around the first homes, a stubborn answer to bad seasons.`,
      type: "subsistence",
    }));
  }

  if (resInfo.forestRatio > 0.15 || resInfo.forestTiles > 40) {
    econTemplates.push((year) => ({
      year,
      text: `Loggers move into the island's thickets, cutting timber for piers and modest halls.`,
      type: "logging",
    }));
    econTemplates.push((year) => ({
      year,
      text: `The best trunks are hauled to the shore and shaped into hulls; small shipyards appear beside the settlements.`,
      type: "shipbuilding",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Charcoal pits burn through the night, feeding smiths with cheap fuel from the forest.`,
      type: "charcoal",
    }));
  }

  if (resInfo.mountainRatio > 0.08 || resInfo.mountainTiles > 20) {
    econTemplates.push((year) => ({
      year,
      text: `Prospectors hammer the cliffs and ridges of ${islandName}, marking seams where metal glints in the rock.`,
      type: "prospecting",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Ore carts creak down from the ridges; crude smelters by the shore cough smoke into the wind.`,
      type: "mining_economy",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Rough forges appear near the hills; the smell of slag drifts downwind for miles.`,
      type: "forges",
    }));
  }

  if (resInfo.oilNodes > 0 || (resInfo.shallowWaterTiles > 20 && rng() < 0.6)) {
    econTemplates.push((year) => ({
      year,
      text: `Dark slicks are spotted in the shallows; makeshift derricks are rigged over the seabed.`,
      type: "oil_discovery",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Crude is boiled down in noisy stills; lamps burn late into the night and soot stains the docks.`,
      type: "oil_refining",
    }));
    econTemplates.push((year) => ({
      year,
      text: `Improvised pumps and hoses spread from cove to cove; traders pay well for fuel and pitch.`,
      type: "oil_trade",
    }));
  }

  // Generic path/trade/conflict templates (always available)
  econTemplates.push((year) => ({
    year,
    text: `Trade slowly picks up; cutters from distant ports anchor off ${islandName} to barter for whatever the settlers can spare.`,
    type: "trade_grows",
  }));
  econTemplates.push((year) => ({
    year,
    text: `Work crews mark the first overland routes on ${islandName}, clearing stones and laying crude signage.`,
    type: "paths_built",
  }));
  econTemplates.push((year) => ({
    year,
    text: `Caravans begin to move between camps and ruins; certain crossroads become well-known stopping points.`,
    type: "routes_used",
  }));
  econTemplates.push((year) => ({
    year,
    text: `Watchfires multiply on the ridges; travelers learn to read smoke and silence alike.`,
    type: "watchfires",
  }));

  // Take 6–10 economy events (roughly ~3x old density)
  const econEventsToTake = 6 + Math.floor(rng() * 5); // 6..10
  const econPool = [...econTemplates];
  for (let i = 0; i < econEventsToTake && econPool.length; i++) {
    const idx = Math.floor(rng() * econPool.length);
    const fn = econPool[idx];
    econPool.splice(idx, 1);
    events.push(fn(bumpYear()));
  }

  // Faction tension (expanded)
  const multiFaction = factionB && rng() < 0.8;

  if (multiFaction) {
    events.push({
      year: bumpYear(),
      text: `${factionB} arrive on ${islandName}, raising banners and claiming coves not far from ${firstSettlement ? firstSettlement.name : "the first landing"}.`,
      type: "second_faction_arrives",
    });

    events.push({
      year: bumpYear(),
      text: `Patrols cross paths; markers are torn down and arguments over streams, coves, and ore seams grow ugly.`,
      type: "tensions_rise",
    });

    if (rng() < 0.7) {
      events.push({
        year: bumpYear(),
        text: `A season of skirmishes follows: small parties vanish on the roads, and watchfires burn late across the ridges.`,
        type: "skirmishes",
      });
    }

    if (rng() < 0.6 && raiderCamps.length) {
      const rc = raiderCamps[Math.floor(rng() * raiderCamps.length)];
      events.push({
        year: bumpYear(),
        text: `Under cover of the unrest, raiders expand their hold near (${rc.q},${rc.r}), preying on isolated camps.`,
        type: "raiders_emboldened",
        q: rc.q,
        r: rc.r,
      });
    }
  } else {
    events.push({
      year: bumpYear(),
      text: `With no serious rival fleet in sight, ${factionA} focus on consolidating holdings and fortifying routes across ${islandName}.`,
      type: "consolidation",
    });
  }

  // Optional cataclysm:
  // - NOT required
  // - If settlements exist: cataclysm MUST NOT happen (your rule).
  let finalCataclysmEvent = null;

  const allowCataclysm = settlements.length === 0;
  if (allowCataclysm && rng() < 0.65) {
    const disaster = pick(rng, DISASTER_TYPES);
    finalCataclysmEvent = {
      year: bumpYear(),
      text: `When ${disaster} sweeps ${islandName}, the remaining camps are abandoned and their fires finally go cold.`,
      type: "cataclysm",
      disaster,
    };
    events.push(finalCataclysmEvent);

    // In no-settlement worlds we can degrade some roadside camps into ruins
    for (const obj of worldObjects) {
      const t = String(obj.type || "").toLowerCase();
      if (t === "roadside_camp" && rng() < 0.4) {
        obj.type = "ruin";
        obj.wasRoadsideCamp = true;
        obj.ruinedYear = finalCataclysmEvent.year;
      }
    }
  }

  // Sort & commit events (stable)
  events.sort((a, b) => (a.year || 0) - (b.year || 0));
  for (const ev of events) {
    const entry = {
      year: ev.year,
      text: ev.text,
      type: ev.type,
      islandName,
      factions,
    };
    if (Number.isFinite(ev.q) && Number.isFinite(ev.r)) {
      entry.q = ev.q;
      entry.r = ev.r;
    }
    if (ev.poiType) entry.poiType = ev.poiType;
    addEntry(entry);
  }

  // Backward compatibility: some UI expects loreState.outposts (names for highlighting).
  // We treat it as "named places".
  const namedPlaces = []
    .concat(settlements)
    .concat(ruins);

  scene.loreState = {
    islandName,
    factions,
    outposts: namedPlaces,      // legacy field (used by History UI)
    settlements,
    ruins,
    resources: resInfo,
    disaster: finalCataclysmEvent?.disaster || null,
  };

  // Seed -> lore -> POI: commit worldObjects back into mapInfo / hexMap
  if (!scene.mapInfo) scene.mapInfo = { tiles, objects: [] };
  scene.mapInfo.objects = worldObjects;
  if (scene.hexMap) {
    scene.hexMap.objects = worldObjects;
  }

  scene.__worldLoreGenerated = true;
}

// Called per-ruin from WorldSceneMapLocations.
// Ensures world-level lore exists and marks the tile.
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
  const getTile = (q, r) => tiles.find((t) => t.q === q && t.r === r);

  const islandName = scene.loreState?.islandName || "the island";
  const factions = scene.loreState?.factions || [];
  const defaultFaction = factions[0] || "an unknown faction";

  for (const conn of conns) {
    const fq = conn.from?.q;
    const fr = conn.from?.r;
    const tq = conn.to?.q;
    const tr = conn.to?.r;

    const fromTile = getTile(fq, fr);
    const toTile = getTile(tq, tr);

    const faction =
      fromTile?.owningFaction ||
      toTile?.owningFaction ||
      defaultFaction;

    const fromLabel = buildLocationLabel(conn.from, fromTile, true);
    const toLabel = buildLocationLabel(conn.to, toTile, false);

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
    // If a tile has cityName, prefer settlement vs ruin wording when possible
    if (type === "settlement") return `the settlement ${tile.cityName} (${q},${r})`;
    if (type === "ruin") return `the ruins of ${tile.cityName} (${q},${r})`;

    // Legacy fallback
    if (isFrom) return `the outpost ${tile.cityName} (${q},${r})`;
    return `the ruins of ${tile.cityName} (${q},${r})`;
  }

  if (type === "crash_site" || type === "wreck") {
    return `a crash site near (${q},${r})`;
  }
  if (type === "vehicle" || type === "abandoned_vehicle") {
    return `a stranded vehicle at (${q},${r})`;
  }
  if (type === "raider_camp") {
    return `a raider camp at (${q},${r})`;
  }
  if (type === "roadside_camp") {
    return `a roadside camp at (${q},${r})`;
  }
  if (type === "watchtower") {
    return `a watchtower at (${q},${r})`;
  }
  if (type === "mine") {
    return `a mine at (${q},${r})`;
  }
  if (type === "shrine") {
    return `a shrine at (${q},${r})`;
  }
  if (type === "ruin") {
    return `ruins at (${q},${r})`;
  }
  if (type === "settlement") {
    return `a settlement at (${q},${r})`;
  }

  return `(${q},${r})`;
}
