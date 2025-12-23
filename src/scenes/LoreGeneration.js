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
  // v7: enforce max 2 AI factions; first settlement is created at Discovery.
  const rng = xorshift32(hashStr32(`${seedStr}|worldLoreV7`));

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

  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

  const isCoast = (t) => {
    if (!t || t.type === "water") return false;
    for (const [dq, dr] of dirs) {
      const nb = getTile(t.q + dq, t.r + dr);
      if (nb && nb.type === "water") return true;
    }
    return false;
  };

  const isCoastalWater = (t) => {
    if (!t || t.type !== "water") return false;
    for (const [dq, dr] of dirs) {
      const nb = getTile(t.q + dq, t.r + dr);
      if (nb && nb.type !== "water") return true;
    }
    return false;
  };

  const isShallow = (t) => {
    const d = typeof t?.waterDepth === "number" ? t.waterDepth : 2;
    return d <= 2;
  };

  // --- Island name & factions ---
  const islandName = `${pick(rng, ISLAND_PREFIX)} ${pick(rng, ISLAND_ROOT)}`;

  // IMPORTANT: In-game max AI factions = 2.
  // We interpret this as: 1 or 2 world factions (A always exists, B optional).
  const factionCount = 1 + Math.floor(rng() * 2); // 1–2 (was 1–3)
  const factions = pickMany(rng, FACTIONS, factionCount);
  const factionA = factions[0];
  const factionB = factions[1];

  // Deterministic helper: assign POI "owner/claimer" among island factions.
  function pickFactionOwner() {
    return factions[Math.floor(rng() * factions.length)];
  }

  // ============================================================
  // POI generation: seed -> lore -> POI
  //
  // v7 changes:
  // - enforce max 2 AI factions
  // - first settlement is guaranteed to be created as part of Discovery
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

  function pickTileFromPool(pool, { minDist = 3, tries = 90 } = {}) {
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
        tile.settlementName = name || tile.settlementName;
        tile.owningFaction = faction || tile.owningFaction;
      }
      if (type === "ruin") {
        tile.cityName = name || tile.cityName;
        if (faction) tile.ruinClaimFaction = faction;
      }
    }
  }

  const coastLand = anyLand.filter(isCoast);
  const forestLand = anyLand.filter(isForesty);
  const mountainLand = anyLand.filter(isMountainish);
  const highLand = anyLand.filter(isHigh);
  const inlandLand = anyLand.filter((t) => t && !isCoast(t) && t.type !== "water");

  const coastalWater = anyWater.filter(isCoastalWater);
  const shallowCoastalWater = coastalWater.filter(isShallow);

  // --- POI lists for lore state ---
  const settlements = [];
  const ruins = [];
  const raiderCamps = [];
  const roadsideCamps = [];
  const watchtowers = [];
  const mines = [];
  const shrines = [];

  // --- DISCOVERY: FIRST SETTLEMENT MUST BE CREATED HERE ---
  // Try: coast -> any land. If no land exists, we can't place it.
  if (anyLand.length) {
    const pool = coastLand.length ? coastLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 6 });
    if (t) {
      const name = makePlaceName(rng, 0, "Settlement");
      addPOI({ type: "settlement", q: t.q, r: t.r, name, faction: factionA });
      settlements.push({ name, q: t.q, r: t.r, type: "settlement", faction: factionA });
    }
  }

  // --- Additional settlements (0–1) ---
  // (kept small; discovery already created the first one)
  const extraSettlementCount = (settlements.length && rng() < 0.55) ? 1 : 0;
  for (let i = 0; i < extraSettlementCount; i++) {
    const pool = coastLand.length ? coastLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 6 });
    if (!t) break;
    const name = makePlaceName(rng, i + 1, "Settlement");
    addPOI({ type: "settlement", q: t.q, r: t.r, name, faction: factionA });
    settlements.push({ name, q: t.q, r: t.r, type: "settlement", faction: factionA });
  }

  // --- Ruins (1–3) ---
  const ruinCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < ruinCount; i++) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (!t) break;
    const name = `Ruins of ${pick(rng, PLACE_ROOT)}${i ? "-" + (i + 1) : ""}`;
    const claimant = pickFactionOwner();
    addPOI({ type: "ruin", q: t.q, r: t.r, name, faction: claimant });
    ruins.push({ name, q: t.q, r: t.r, type: "ruin", faction: claimant });
  }

  // --- Mines (0–2), only if mountains/high exist ---
  const mineCount = (mountainLand.length || highLand.length) ? Math.floor(rng() * 3) : 0; // 0..2
  for (let i = 0; i < mineCount; i++) {
    const pool = mountainLand.length ? mountainLand : (highLand.length ? highLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (!t) break;
    const owner = pickFactionOwner();
    addPOI({ type: "mine", q: t.q, r: t.r, faction: owner });
    mines.push({ q: t.q, r: t.r, type: "mine", faction: owner });
  }

  // --- Watchtowers (0–2) prefer high ground ---
  const towerCount = (highLand.length || mountainLand.length) ? Math.floor(rng() * 3) : 0; // 0..2
  for (let i = 0; i < towerCount; i++) {
    const pool = highLand.length ? highLand : (mountainLand.length ? mountainLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (!t) break;
    const owner = pickFactionOwner();
    addPOI({ type: "watchtower", q: t.q, r: t.r, faction: owner });
    watchtowers.push({ q: t.q, r: t.r, type: "watchtower", faction: owner });
  }

  // --- Shrines (0–2) prefer forest/inland ---
  const shrineCount = (forestLand.length || inlandLand.length) ? Math.floor(rng() * 3) : 0; // 0..2
  for (let i = 0; i < shrineCount; i++) {
    const pool = forestLand.length ? forestLand : (inlandLand.length ? inlandLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (!t) break;
    const owner = pickFactionOwner();
    addPOI({ type: "shrine", q: t.q, r: t.r, faction: owner });
    shrines.push({ q: t.q, r: t.r, type: "shrine", faction: owner });
  }

  // --- Roadside camps (1–2) ---
  const roadsideCount = 1 + Math.floor(rng() * 2); // 1..2
  for (let i = 0; i < roadsideCount; i++) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 4 });
    if (!t) break;
    const owner = pickFactionOwner();
    addPOI({ type: "roadside_camp", q: t.q, r: t.r, faction: owner });
    roadsideCamps.push({ q: t.q, r: t.r, type: "roadside_camp", faction: owner });
  }

  // --- Raider camps (0–2) ---
  const raiderCampCount = (rng() < 0.65) ? Math.floor(rng() * 3) : 0; // 0..2 with 65% chance
  for (let i = 0; i < raiderCampCount; i++) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (!t) break;
    const owner = factionB && rng() < 0.7 ? factionB : pickFactionOwner();
    addPOI({ type: "raider_camp", q: t.q, r: t.r, faction: owner });
    raiderCamps.push({ q: t.q, r: t.r, type: "raider_camp", faction: owner });
  }

  // --- Ensure legacy POIs exist: crash_site / wreck / vehicle ---
  const ensureTypeAtLeast = (type, count, pool, opts, factoryMeta = null) => {
    const current = worldObjects.filter((o) => String(o.type || "").toLowerCase() === type).length;
    const need = Math.max(0, count - current);
    for (let i = 0; i < need; i++) {
      const t = pickTileFromPool(pool, opts);
      if (!t) break;
      const owner = pickFactionOwner();
      addPOI({
        type,
        q: t.q,
        r: t.r,
        faction: owner,
        meta: (typeof factoryMeta === "function" ? factoryMeta(t, owner) : factoryMeta)
      });
    }
  };

  // Crash sites: land near coast
  ensureTypeAtLeast(
    "crash_site",
    1,
    (coastLand.length ? coastLand : anyLand),
    { minDist: 5 },
    (t, owner) => ({ salvageClaim: owner })
  );

  // Wreck: MUST be in water near coast (fixes "ship wreck doesn't spawn")
  const wreckPool = (shallowCoastalWater.length ? shallowCoastalWater : (coastalWater.length ? coastalWater : anyWater));
  ensureTypeAtLeast(
    "wreck",
    1,
    (wreckPool.length ? wreckPool : (coastLand.length ? coastLand : anyLand)),
    { minDist: 5 },
    (t, owner) => ({ wreckKind: "ship", salvageClaim: owner })
  );

  // Vehicle: inland land
  ensureTypeAtLeast(
    "vehicle",
    1,
    (inlandLand.length ? inlandLand : anyLand),
    { minDist: 5 },
    (t, owner) => ({ salvageClaim: owner })
  );

  const crashSites = worldObjects.filter((o) => {
    const t = String(o.type || "").toLowerCase();
    return t === "crash_site";
  });

  const wrecks = worldObjects.filter((o) => {
    const t = String(o.type || "").toLowerCase();
    return t === "wreck";
  });

  const vehicles = worldObjects.filter((o) => {
    const t = String(o.type || "").toLowerCase();
    return t === "vehicle" || t === "abandoned_vehicle";
  });

  // ============================================================
  // Phase-based Events (History) — FEWER, organic, causal.
  // ============================================================
  const baseYear = 5000;
  const events = [];
  let yearCursor = baseYear;

  const bumpYear = (minStep = 1, maxStep = 3) => {
    yearCursor += minStep + Math.floor(rng() * (maxStep - minStep + 1));
    return yearCursor;
  };

  function humanCoord(q, r) {
    return `(${q},${r})`;
  }

  function pushEvent(ev) {
    if (!ev || typeof ev.text !== "string") return;
    events.push(ev);
  }

  function pushPOIBeat(poi, text, extra = null) {
    if (!poi) return;
    pushEvent({
      year: bumpYear(1, 3),
      type: "poi_beat",
      poiType: poi.type,
      q: poi.q,
      r: poi.r,
      faction: poi.faction,
      text,
      ...(extra ? extra : {}),
    });
  }

  // Phase 1: Discovery / landing (always references the first settlement we created above)
  const firstSettlement = settlements[0] || null;
  if (firstSettlement) {
    pushEvent({
      year: baseYear,
      type: "founding",
      poiType: "settlement",
      q: firstSettlement.q,
      r: firstSettlement.r,
      faction: factionA,
      text: `${factionA} sight ${islandName} and establish ${firstSettlement.name} at ${humanCoord(firstSettlement.q, firstSettlement.r)}.`,
    });
  } else if (anyLand.length) {
    const t = anyLand[Math.floor(rng() * anyLand.length)];
    pushEvent({
      year: baseYear,
      type: "founding",
      q: t.q,
      r: t.r,
      faction: factionA,
      text: `${factionA} make landfall on ${islandName}, camping at ${humanCoord(t.q, t.r)} before scouts fan out.`,
    });
  } else {
    pushEvent({
      year: baseYear,
      type: "founding",
      faction: factionA,
      text: `${factionA} chart ${islandName} from afar, but find no safe landfall in the surveyed waters.`,
    });
  }

  // Phase 2: Survey (resource/geography-driven) — 2–3 beats
  const surveyBeats = [];

  surveyBeats.push(() => ({
    year: bumpYear(1, 2),
    type: "survey_maps",
    text: `Scouts return with crude charts: safe passes, flood lines, and the first routes worth marking across ${islandName}.`,
  }));

  if (resInfo.waterRatio > 0.25 || resInfo.fishNodes > 2) {
    surveyBeats.push(() => ({
      year: bumpYear(1, 2),
      type: "survey_fishing",
      text: `Fishing coves are charted; smoke racks and net lines become the earliest steady trade on ${islandName}.`,
    }));
  }
  if (resInfo.forestRatio > 0.15 || resInfo.forestTiles > 35) {
    surveyBeats.push(() => ({
      year: bumpYear(1, 2),
      type: "survey_forests",
      text: `Timber in the inland thickets draws work crews off the coast; the first hauling trails are cut through brush.`,
    }));
  }
  if (resInfo.mountainRatio > 0.08 || resInfo.mountainTiles > 18) {
    surveyBeats.push(() => ({
      year: bumpYear(1, 2),
      type: "survey_mountains",
      text: `Ridges and cliffs promise ore; prospectors leave cairns and paint marks where rock shows promise.`,
    }));
  }
  if (resInfo.oilNodes > 0 || (resInfo.shallowWaterTiles > 18 && rng() < 0.6)) {
    surveyBeats.push(() => ({
      year: bumpYear(1, 2),
      type: "survey_oil",
      text: `Dark slicks are spotted in the shallows; crude lamps soon burn late along the docks.`,
    }));
  }

  const surveyCount = Math.min(3, Math.max(2, 2 + Math.floor(rng() * 2))); // 2..3
  const bag = [...surveyBeats];
  for (let i = 0; i < surveyCount && bag.length; i++) {
    const idx = Math.floor(rng() * bag.length);
    const fn = bag[idx];
    bag.splice(idx, 1);
    pushEvent(fn());
  }

  // Phase 3: Foundations / key sites (1–4 beats, not spam)
  if (settlements.length) {
    pushPOIBeat(
      settlements[0],
      `${settlements[0].name} grows beyond tents; storehouses and repair sheds draw steady traffic from the shoreline.`,
      { settlementName: settlements[0].name }
    );
  }
  if (settlements.length > 1) {
    pushPOIBeat(
      settlements[1],
      `${factionA} open a second foothold at ${settlements[1].name} ${humanCoord(settlements[1].q, settlements[1].r)} to reach the interior more safely.`,
      { settlementName: settlements[1].name }
    );
  }
  if (mines.length) {
    const m = mines[0];
    pushPOIBeat(
      m,
      `${m.faction} open a mine at ${humanCoord(m.q, m.r)}; ore begins to flow toward the coast under guard.`
    );
  }
  if (watchtowers.length) {
    const w = watchtowers[0];
    pushPOIBeat(
      w,
      `${w.faction} raise a watchtower at ${humanCoord(w.q, w.r)} to keep eyes on approaches and signal the coast.`
    );
  }

  // Ruins: 1–2 with real hooks
  const ruinHooks = [
    (rr) => `At ${rr.name} ${humanCoord(rr.q, rr.r)}, stonework shows scorch marks and collapsed roofs—signs of a sudden end.`,
    (rr) => `At ${rr.name} ${humanCoord(rr.q, rr.r)}, cisterns and carved channels hint at a community that fought scarcity before it fell.`,
    (rr) => `At ${rr.name} ${humanCoord(rr.q, rr.r)}, broken tools and workshop floors suggest careful craft long before the current flags arrived.`,
  ];
  const ruinsToDescribe = Math.min(2, ruins.length);
  for (let i = 0; i < ruinsToDescribe; i++) {
    const rr = ruins[i];
    pushPOIBeat(
      rr,
      ruinHooks[i % ruinHooks.length](rr),
      { ruinName: rr.name }
    );
  }

  // Camps: summary beats (1–2)
  if (roadsideCamps.length) {
    const c0 = roadsideCamps[0];
    const extra = roadsideCamps.length - 1;
    pushEvent({
      year: bumpYear(1, 3),
      type: "camps_emerge",
      poiType: "roadside_camp",
      q: c0.q,
      r: c0.r,
      faction: c0.faction,
      targets: roadsideCamps.map(c => ({ q: c.q, r: c.r })),
      text: extra > 0
        ? `Roadside camps appear along the safest routes—one near ${humanCoord(c0.q, c0.r)} and ${extra} more as traffic grows.`
        : `A roadside camp forms near ${humanCoord(c0.q, c0.r)}, trading scraps and rumors with whoever passes through.`,
    });
  }

  if (raiderCamps.length) {
    const rc = raiderCamps[0];
    pushEvent({
      year: bumpYear(1, 3),
      type: "raiders_take_hold",
      poiType: "raider_camp",
      q: rc.q,
      r: rc.r,
      faction: rc.faction,
      targets: raiderCamps.map(c => ({ q: c.q, r: c.r })),
      text: `Raiders tied to ${rc.faction} establish a camp near ${humanCoord(rc.q, rc.r)}, striking at isolated travelers and lightly guarded caravans.`,
    });
    if (watchtowers.length) {
      const w = watchtowers[0];
      pushEvent({
        year: bumpYear(1, 3),
        type: "watchtower_signals",
        poiType: "watchtower",
        q: w.q,
        r: w.r,
        faction: w.faction,
        text: `Smoke by day and fire by night from the watchtower at ${humanCoord(w.q, w.r)} warn of raids and moving patrols.`,
      });
    }
  }

  // Salvage (wreck / crash / vehicle): 1–2 beats total
  if (wrecks.length) {
    const w = wrecks[Math.floor(rng() * wrecks.length)];
    pushEvent({
      year: bumpYear(1, 3),
      type: "wreck_found",
      poiType: "wreck",
      q: w.q,
      r: w.r,
      faction: w.faction,
      text: `${w.faction} claim a shipwreck near ${humanCoord(w.q, w.r)}; salvage crews strip fittings and haul usable metal ashore.`,
    });
  } else if (crashSites.length) {
    const c = crashSites[Math.floor(rng() * crashSites.length)];
    pushEvent({
      year: bumpYear(1, 3),
      type: "crash_site_found",
      poiType: "crash_site",
      q: c.q,
      r: c.r,
      faction: c.faction,
      text: `${c.faction} secure a crash site at ${humanCoord(c.q, c.r)}; scavengers argue over what to keep and what to trade.`,
    });
  }

  if (vehicles.length && rng() < 0.7) {
    const v = vehicles[Math.floor(rng() * vehicles.length)];
    pushEvent({
      year: bumpYear(1, 3),
      type: "vehicle_found",
      poiType: "vehicle",
      q: v.q,
      r: v.r,
      faction: v.faction,
      text: `A stranded vehicle at ${humanCoord(v.q, v.r)} becomes a waypoint—its frame visible from afar, its cargo long gone.`,
    });
  }

  // Phase 4: Tension (optional, 0–2 beats)
  const multiFaction = !!factionB && rng() < 0.55;
  if (multiFaction) {
    pushEvent({
      year: bumpYear(1, 3),
      type: "second_faction_arrives",
      faction: factionB,
      text: `${factionB} arrive on ${islandName} and raise banners on sheltered coves; boundary stones appear overnight.`,
    });
    pushEvent({
      year: bumpYear(1, 3),
      type: "tensions_rise",
      text: `Patrols cross paths, trade turns sharp, and watchfires become common on the ridges.`,
    });
  }

  // Phase 5: Infrastructure (roads) — reserve a window so road entries don't always come last
  const roadStartYear = bumpYear(1, 3);
  pushEvent({
    year: roadStartYear,
    type: "routes_formalized",
    text: `As trade stabilizes, the most-used trails are widened into proper routes—stones cleared, markers raised, and crossings mapped.`,
  });

  // Optional cataclysm:
  // - NOT required
  // - If settlements exist: cataclysm MUST NOT happen (your rule).
  let finalCataclysmEvent = null;
  const allowCataclysm = settlements.length === 0;
  if (allowCataclysm && rng() < 0.5) {
    const disaster = pick(rng, DISASTER_TYPES);
    finalCataclysmEvent = {
      year: bumpYear(1, 3),
      text: `When ${disaster} sweeps ${islandName}, the remaining camps are abandoned and their fires finally go cold.`,
      type: "cataclysm",
      disaster,
    };
    pushEvent(finalCataclysmEvent);

    for (const obj of worldObjects) {
      const t = String(obj.type || "").toLowerCase();
      if (t === "roadside_camp" && rng() < 0.35) {
        obj.type = "ruin";
        obj.wasRoadsideCamp = true;
        obj.ruinedYear = finalCataclysmEvent.year;
        // keep faction so it stays attributable
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
    if (ev.from && Number.isFinite(ev.from.q) && Number.isFinite(ev.from.r)) entry.from = ev.from;
    if (ev.to && Number.isFinite(ev.to.q) && Number.isFinite(ev.to.r)) entry.to = ev.to;
    if (Array.isArray(ev.targets) && ev.targets.length) entry.targets = ev.targets;
    if (ev.faction) entry.faction = ev.faction;
    if (ev.settlementName) entry.settlementName = ev.settlementName;
    if (ev.ruinName) entry.ruinName = ev.ruinName;

    addEntry(entry);
  }

  const namedPlaces = []
    .concat(settlements)
    .concat(ruins);

  scene.loreState = {
    islandName,
    factions,
    outposts: namedPlaces, // legacy field (used by History UI)
    settlements,
    ruins,
    mines,
    watchtowers,
    shrines,
    roadsideCamps,
    raiderCamps,
    resources: resInfo,
    disaster: finalCataclysmEvent?.disaster || null,

    // reserve road insertion window
    roadStartYear,
    __roadYearCursor: roadStartYear,
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
// v7: insert roads into reserved timeline window so they don't always appear "last".
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

  let year = Number.isFinite(scene.loreState?.__roadYearCursor)
    ? scene.loreState.__roadYearCursor
    : (scene.getNextHistoryYear ? scene.getNextHistoryYear() : 5030);

  const bumpRoadYear = () => {
    year += 1; // compact sequence
    return year;
  };

  // Keep deterministic ordering (stable by coords)
  const sorted = [...conns].sort((a, b) => {
    const aq = a?.from?.q ?? 0;
    const ar = a?.from?.r ?? 0;
    const bq = b?.from?.q ?? 0;
    const br = b?.from?.r ?? 0;
    if (aq !== bq) return aq - bq;
    if (ar !== br) return ar - br;
    const aq2 = a?.to?.q ?? 0;
    const ar2 = a?.to?.r ?? 0;
    const bq2 = b?.to?.q ?? 0;
    const br2 = b?.to?.r ?? 0;
    if (aq2 !== bq2) return aq2 - bq2;
    return ar2 - br2;
  });

  for (const conn of sorted) {
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

    addEntry({
      year: bumpRoadYear(),
      text: `${faction} formalize a route across ${islandName}, linking ${fromLabel} with ${toLabel}.`,
      type: "road_built",
      from: { q: fq, r: fr },
      to: { q: tq, r: tr },
      faction,
    });
  }

  if (scene.loreState) scene.loreState.__roadYearCursor = year;

  scene.__roadLoreGenerated = true;
}

function buildLocationLabel(endpoint, tile, isFrom) {
  if (!endpoint) return "an unknown place";
  const q = endpoint.q;
  const r = endpoint.r;
  const type = String(endpoint.type || "").toLowerCase();

  if (tile && tile.cityName) {
    if (type === "settlement") return `the settlement ${tile.cityName} (${q},${r})`;
    if (type === "ruin") return `the ruins of ${tile.cityName} (${q},${r})`;

    if (isFrom) return `the outpost ${tile.cityName} (${q},${r})`;
    return `the ruins of ${tile.cityName} (${q},${r})`;
  }

  if (type === "crash_site") {
    return `a crash site at (${q},${r})`;
  }
  if (type === "wreck") {
    return `a shipwreck near (${q},${r})`;
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
