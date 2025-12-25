// src/scenes/LoreGeneration.js
//
// Deterministic lore generation for the whole island.
// seed -> lore -> POI (scene.mapInfo.objects)
//
// Public API:
//   generateRuinLoreForTile(scene, tile)
//   generateRoadLoreForExistingConnections(scene)   // NO-OP for backward compat

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

const RELIGIONS = [
  "the Tide-Lit",
  "the Iron Psalm",
  "the Green Vow",
  "the Ash Crown",
  "the Quiet Current",
  "the Lantern Choir",
];

const ISLAND_PREFIX = ["Isle of", "Island of", "Shoals of", "Reach of", "Haven of", "Reef of"];
const ISLAND_ROOT = ["Brinefall", "Nareth", "Korvan", "Greywatch", "Solmere", "Lowmar", "Tiderest", "Stormwake", "Gloomharbor"];

const PLACE_PREFIX = ["Outpost", "Harbor", "Fort", "Watch", "Camp", "Dock", "Station", "Hold", "Gate"];
const PLACE_ROOT = ["Aster", "Gale", "Karn", "Mire", "Ridge", "Pearl", "Thorn", "Skerry", "Cairn", "Warden"];

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

function hexDistance(a, b) {
  const dq = (b.q - a.q);
  const dr = (b.r - a.r);
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function ensureWorldLoreGenerated(scene) {
  if (!scene || scene.__worldLoreGenerated) return;

  const seedStr = String(scene.seed || "000000");
  const rng = xorshift32(hashStr32(`${seedStr}|worldLoreV8`));

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

  const worldObjects = originalMapObjects.map((o) => ({ ...o }));
  const resInfo = analyzeResources(tiles, worldObjects);

  const anyLand = tiles.filter((t) => t && t.type !== "water");
  const anyWater = tiles.filter((t) => t && t.type === "water");

  const getTile = (q, r) => tiles.find((t) => t.q === q && t.r === r);

  const isMountainish = (t) => t && (t.type === "mountain" || t.elevation === 7);

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

  // ✅ IMPORTANT: max 2 factions AI, but we want to actually see 2 often.
  const islandName = `${pick(rng, ISLAND_PREFIX)} ${pick(rng, ISLAND_ROOT)}`;
  const factionCount = (rng() < 0.80) ? 2 : 1; // 80% -> 2 factions
  const factions = pickMany(rng, FACTIONS, Math.min(2, factionCount));
  const factionA = factions[0];
  const factionB = factions[1] || null;

  function pickFactionOwner(prefer = null) {
    if (prefer && factions.includes(prefer)) return prefer;
    return factions[Math.floor(rng() * factions.length)];
  }

  // ----- POI placement bookkeeping -----
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
      if (isMountainish(t)) continue; // ✅ no POI on mountains
      if (!farEnough(t.q, t.r, minDist)) continue;
      return t;
    }
    for (let i = 0; i < tries; i++) {
      const t = pool[Math.floor(rng() * pool.length)];
      if (t && isFree(t.q, t.r) && !isMountainish(t)) return t;
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

    const tile = getTile(q, r);
    if (tile && type === "settlement") {
      tile.cityName = name || tile.cityName;
      tile.settlementName = name || tile.settlementName;
      tile.owningFaction = faction || tile.owningFaction;
    }
    if (tile && type === "ruin") {
      tile.cityName = name || tile.cityName;
      if (faction) tile.ruinClaimFaction = faction;
    }
  }

  const coastLand = anyLand.filter(isCoast).filter((t) => !isMountainish(t));
  const inlandLand = anyLand.filter((t) => t && !isCoast(t) && t.type !== "water" && !isMountainish(t));
  const forestLand = anyLand.filter((t) => t && (t.hasForest || String(t.type || "").toLowerCase() === "forest")).filter((t) => !isMountainish(t));
  const highLand = anyLand.filter((t) => t && (typeof t.elevation === "number") && t.elevation >= 5 && t.type !== "water" && !isMountainish(t));

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

  // ----- DISCOVERY MUST create first settlement -----
  let firstSettlement = null;
  {
    const pool = coastLand.length ? coastLand : (inlandLand.length ? inlandLand : anyLand);
    const t = pickTileFromPool(pool, { minDist: 6 });
    if (t) {
      const name = makePlaceName(rng, 0, "Settlement");
      addPOI({ type: "settlement", q: t.q, r: t.r, name, faction: factionA });
      firstSettlement = { name, q: t.q, r: t.r, type: "settlement", faction: factionA };
      settlements.push(firstSettlement);
    }
  }

  // Optional second settlement (helps “ruin” story without wiping everything)
  const allowSecondSettlement = rng() < 0.55;
  if (allowSecondSettlement) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t2 = pickTileFromPool(pool, { minDist: 8 });
    if (t2) {
      const name = makePlaceName(rng, 1, "Settlement");
      addPOI({ type: "settlement", q: t2.q, r: t2.r, name, faction: factionA });
      settlements.push({ name, q: t2.q, r: t2.r, type: "settlement", faction: factionA });
    }
  }

  // Ruins (1–2)
  const ruinCount = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < ruinCount; i++) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 6 });
    if (!t) break;
    const name = `Ruins of ${pick(rng, PLACE_ROOT)}${i ? "-" + (i + 1) : ""}`;
    const claimant = pickFactionOwner();
    addPOI({ type: "ruin", q: t.q, r: t.r, name, faction: claimant });
    ruins.push({ name, q: t.q, r: t.r, type: "ruin", faction: claimant });
  }

  // Mines (0–1)
  if (highLand.length && rng() < 0.55) {
    const t = pickTileFromPool(highLand, { minDist: 6 });
    if (t) {
      const owner = pickFactionOwner();
      addPOI({ type: "mine", q: t.q, r: t.r, faction: owner });
      mines.push({ q: t.q, r: t.r, type: "mine", faction: owner });
    }
  }

  // Watchtower (0–1)
  if (highLand.length && rng() < 0.55) {
    const t = pickTileFromPool(highLand, { minDist: 6 });
    if (t) {
      const owner = pickFactionOwner();
      addPOI({ type: "watchtower", q: t.q, r: t.r, faction: owner });
      watchtowers.push({ q: t.q, r: t.r, type: "watchtower", faction: owner });
    }
  }

  // Shrine (0–1)
  if ((forestLand.length || inlandLand.length) && rng() < 0.55) {
    const pool = forestLand.length ? forestLand : inlandLand;
    const t = pickTileFromPool(pool, { minDist: 6 });
    if (t) {
      const owner = pickFactionOwner();
      addPOI({ type: "shrine", q: t.q, r: t.r, faction: owner, meta: { religion: pick(rng, RELIGIONS) } });
      shrines.push({ q: t.q, r: t.r, type: "shrine", faction: owner });
    }
  }

  // Roadside camp (0–1)
  if (rng() < 0.6) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 5 });
    if (t) {
      const owner = pickFactionOwner();
      addPOI({ type: "roadside_camp", q: t.q, r: t.r, faction: owner });
      roadsideCamps.push({ q: t.q, r: t.r, type: "roadside_camp", faction: owner });
    }
  }

  // Raider camp (0–1) prefer second faction
  if (rng() < 0.55) {
    const pool = inlandLand.length ? inlandLand : anyLand;
    const t = pickTileFromPool(pool, { minDist: 7 });
    if (t) {
      const owner = (factionB && rng() < 0.80) ? factionB : pickFactionOwner();
      addPOI({ type: "raider_camp", q: t.q, r: t.r, faction: owner });
      raiderCamps.push({ q: t.q, r: t.r, type: "raider_camp", faction: owner });
    }
  }

  // Ensure crash_site / vehicle / wreck exist
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

  // Crash site on land
  ensureTypeAtLeast(
    "crash_site",
    1,
    (coastLand.length ? coastLand : inlandLand.length ? inlandLand : anyLand),
    { minDist: 7 },
    (t, owner) => ({ salvageClaim: owner })
  );

  // Vehicle inland
  ensureTypeAtLeast(
    "vehicle",
    1,
    (inlandLand.length ? inlandLand : anyLand),
    { minDist: 7 },
    (t, owner) => ({ salvageClaim: owner })
  );

  // Wreck on water near coast (ensure free)
  const wreckPool = (shallowCoastalWater.length ? shallowCoastalWater : (coastalWater.length ? coastalWater : anyWater));
  const ensureWreck = () => {
    const existing = worldObjects.some((o) => String(o.type || "").toLowerCase() === "wreck");
    if (existing) return;
    if (!wreckPool.length) return;

    for (let i = 0; i < 180; i++) {
      const t = wreckPool[Math.floor(rng() * wreckPool.length)];
      if (!t) continue;
      if (!isFree(t.q, t.r)) continue;
      const owner = pickFactionOwner();
      addPOI({ type: "wreck", q: t.q, r: t.r, faction: owner, meta: { wreckKind: "ship", salvageClaim: owner } });
      break;
    }
  };
  ensureWreck();

  const crashSites = worldObjects.filter((o) => String(o.type || "").toLowerCase() === "crash_site");
  const wrecks = worldObjects.filter((o) => String(o.type || "").toLowerCase() === "wreck");
  const vehicles = worldObjects.filter((o) => {
    const t = String(o.type || "").toLowerCase();
    return t === "vehicle" || t === "abandoned_vehicle";
  });

  // ============================================================
  // Timeline (DF-like strict order, now with extra block before players)
  // ============================================================
  const baseYear = 5000;
  let year = baseYear;

  const nextYear = (minStep = 1, maxStep = 3) => {
    year += minStep + Math.floor(rng() * (maxStep - minStep + 1));
    return year;
  };

  const events = [];
  const roadPlans = [];

  function humanCoord(q, r) {
    return `(${q},${r})`;
  }

  function pushEvent(ev) {
    if (!ev || typeof ev.text !== "string") return;
    events.push(ev);
  }

  function pushMain(ev) { pushEvent({ ...ev, __isMain: true }); }
  function pushSecondary(ev) { pushEvent({ ...ev, __isMain: false }); }

  function keyEdge(a, b) {
    const A = `${a.q},${a.r}`;
    const B = `${b.q},${b.r}`;
    return (A < B) ? `${A}|${B}` : `${B}|${A}`;
  }

  function graphHasPath(from, to) {
    const start = `${from.q},${from.r}`;
    const goal = `${to.q},${to.r}`;
    if (start === goal) return true;

    const adj = new Map();
    for (const rp of roadPlans) {
      const a = `${rp.from.q},${rp.from.r}`;
      const b = `${rp.to.q},${rp.to.r}`;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    }

    const q = [start];
    const seen = new Set([start]);
    while (q.length) {
      const cur = q.shift();
      const nbs = adj.get(cur) || [];
      for (const nb of nbs) {
        if (nb === goal) return true;
        if (!seen.has(nb)) {
          seen.add(nb);
          q.push(nb);
        }
      }
    }
    return false;
  }

  function canUseAsRoadEndpoint(poi) {
    if (!poi) return false;
    const t = getTile(poi.q, poi.r);
    if (!t) return false;
    if (t.type === "water") return false;
    if (isMountainish(t)) return false;
    return true;
  }

  // ✅ NEW: check if from->to is connected by land at all (prevents “two islands” road)
  function hasLandPath(from, to) {
    const start = { q: from.q, r: from.r };
    const goalK = `${to.q},${to.r}`;

    const startTile = getTile(start.q, start.r);
    const goalTile = getTile(to.q, to.r);
    if (!startTile || !goalTile) return false;
    if (startTile.type === "water" || goalTile.type === "water") return false;
    if (isMountainish(startTile) || isMountainish(goalTile)) return false;

    const q = [`${start.q},${start.r}`];
    const seen = new Set(q);

    while (q.length) {
      const cur = q.shift();
      if (cur === goalK) return true;

      const [cq, cr] = cur.split(",").map(Number);
      for (const [dq, dr] of dirs) {
        const nq = cq + dq;
        const nr = cr + dr;
        const nt = getTile(nq, nr);
        if (!nt) continue;
        if (nt.type === "water") continue;
        if (isMountainish(nt)) continue;

        const nk = `${nq},${nr}`;
        if (!seen.has(nk)) {
          seen.add(nk);
          q.push(nk);
        }
      }
    }
    return false;
  }

  function planRoad({ from, to, faction, reason, yearPlanned }) {
    if (!from || !to) return false;
    if (!canUseAsRoadEndpoint(from) || !canUseAsRoadEndpoint(to)) return false;

    // ✅ reject if no land connectivity (different islands)
    if (!hasLandPath(from, to)) return false;

    const edgeKey = keyEdge(from, to);
    if (roadPlans.some((rp) => keyEdge(rp.from, rp.to) === edgeKey)) return false;

    // avoid redundant parallel roads
    if (graphHasPath(from, to)) return false;

    roadPlans.push({
      from: { q: from.q, r: from.r, type: String(from.type || "").toLowerCase() },
      to: { q: to.q, r: to.r, type: String(to.type || "").toLowerCase() },
      faction,
      reason,
      year: yearPlanned,
    });

    return true;
  }

  function labelPOI(poi) {
    if (!poi) return "an unknown place";
    const q = poi.q, r = poi.r;
    const type = String(poi.type || "").toLowerCase();
    if (type === "settlement" && poi.name) return `${poi.name} ${humanCoord(q, r)}`;
    if (type === "ruin" && poi.name) return `${poi.name} ${humanCoord(q, r)}`;
    if (type === "mine") return `a mine at ${humanCoord(q, r)}`;
    if (type === "watchtower") return `a watchtower at ${humanCoord(q, r)}`;
    if (type === "shrine") return `a shrine at ${humanCoord(q, r)}`;
    if (type === "roadside_camp") return `a roadside camp at ${humanCoord(q, r)}`;
    if (type === "raider_camp") return `a raider camp at ${humanCoord(q, r)}`;
    if (type === "crash_site") return `a crash site at ${humanCoord(q, r)}`;
    if (type === "wreck") return `a shipwreck near ${humanCoord(q, r)}`;
    if (type === "vehicle" || type === "abandoned_vehicle") return `a stranded vehicle at ${humanCoord(q, r)}`;
    return `${humanCoord(q, r)}`;
  }

  function describeIslandGeography() {
    const notes = [];
    if (resInfo.waterRatio > 0.30) notes.push("broken into coves and shallow bays");
    else if (resInfo.waterRatio < 0.18) notes.push("broad landmass with only a few safe harbors");
    else notes.push("ringed with reefs and workable beaches");

    if (resInfo.forestRatio > 0.22) notes.push("thick with inland timber");
    else if (resInfo.forestRatio < 0.12) notes.push("sparse in trees, with open wind-scoured flats");
    else notes.push("mixed woods and clearings");

    if (resInfo.mountainRatio > 0.10) notes.push("cut by ridges and steep rock");
    else notes.push("shaped by rolling high ground and low plateaus");

    if (resInfo.fishNodes > 2) notes.push("rich in fish runs");
    if (resInfo.oilNodes > 0) notes.push("with dark slicks in the shallows");

    return notes.join(", ");
  }

  // 1) Discovery (also first settlement)
  if (firstSettlement) {
    pushMain({
      year: baseYear,
      type: "opening",
      poiType: "settlement",
      q: firstSettlement.q,
      r: firstSettlement.r,
      faction: factionA,
      settlementName: firstSettlement.name,
      text: `${factionA} discovers ${islandName}, ${describeIslandGeography()}. They establish ${firstSettlement.name} at ${humanCoord(firstSettlement.q, firstSettlement.r)}.`,
    });
  }

  const hasTwoFactions = !!factionB;
  let warOngoing = false;
  let trucePlanned = false;

  function mainEvent_Founding() {
    const s2 = settlements[1] || null;
    if (s2) {
      pushMain({
        year: nextYear(1, 3),
        type: "founding",
        poiType: "settlement",
        q: s2.q,
        r: s2.r,
        faction: factionA,
        settlementName: s2.name,
        text: `${factionA} expand inland and found ${s2.name} at ${humanCoord(s2.q, s2.r)} to secure routes and resources.`,
      });
      return true;
    }

    const w = watchtowers[0] || null;
    if (w) {
      pushMain({
        year: nextYear(1, 3),
        type: "founding",
        poiType: "watchtower",
        q: w.q,
        r: w.r,
        faction: w.faction || factionA,
        text: `${w.faction || factionA} raise a watchtower at ${humanCoord(w.q, w.r)} to mark borders and keep eyes on the interior.`,
      });
      return true;
    }

    pushMain({
      year: nextYear(1, 3),
      type: "survey",
      faction: factionA,
      text: `Scouts chart the safest passes and the first reliable trails across ${islandName}.`,
    });
    return true;
  }

  function mainEvent_Crash() {
    const c = crashSites[0] || null;
    if (!c) return false;

    const reasons = ["mechanical failure", "unknown causes", "suspected sabotage"];
    const reason = pick(rng, reasons);

    pushMain({
      year: nextYear(1, 3),
      type: "crash_site",
      poiType: "crash_site",
      q: c.q,
      r: c.r,
      faction: c.faction || pickFactionOwner(),
      text: `A ship falls from the sky at ${humanCoord(c.q, c.r)}. ${c.faction || "Salvage crews"} claim the site, citing ${reason}.`,
    });
    return true;
  }

  // ✅ Destruction is optional now, and only if we have a “spare” settlement
  function mainEvent_DestructionToRuin() {
    if (settlements.length < 2) return false;
    if (rng() < 0.45) return false; // ~55% chance to NOT do it at all

    const candidate = settlements[1];
    if (!candidate) return false;

    const reasons = [
      "a flood that swallowed the low ground",
      "a sickness that emptied the streets",
      "a civil clash that burned storehouses",
      "raids that never stopped long enough to rebuild",
      "a sudden quake that cracked foundations",
    ];
    const reason = pick(rng, reasons);

    const idx = worldObjects.findIndex((o) =>
      String(o.type || "").toLowerCase() === "settlement" &&
      o.q === candidate.q && o.r === candidate.r
    );

    const ruinName = `Ruins of ${String(candidate.name || pick(rng, PLACE_ROOT))}`;

    if (idx >= 0) {
      worldObjects[idx].type = "ruin";
      worldObjects[idx].name = ruinName;
      worldObjects[idx].ruinedFromSettlement = true;
      worldObjects[idx].faction = candidate.faction || factionA;
    } else {
      addPOI({ type: "ruin", q: candidate.q, r: candidate.r, name: ruinName, faction: candidate.faction || factionA });
    }

    ruins.push({ name: ruinName, q: candidate.q, r: candidate.r, type: "ruin", faction: candidate.faction || factionA });

    pushMain({
      year: nextYear(1, 3),
      type: "disaster",
      poiType: "ruin",
      q: candidate.q,
      r: candidate.r,
      faction: candidate.faction || factionA,
      ruinName,
      text: `${candidate.name} falls to ${reason}. What remains is now known as ${ruinName} at ${humanCoord(candidate.q, candidate.r)}.`,
    });
    return true;
  }

  function mainEvent_WarOrPolitics() {
    if (!hasTwoFactions) {
      pushMain({
        year: nextYear(1, 3),
        type: "politics",
        faction: factionA,
        text: `${factionA} reorganize after internal disputes, formalizing patrol routes and trade agreements to hold the island.`,
      });
      return true;
    }

    warOngoing = true;
    const causes = [
      "a war for resources",
      "a war for territory",
      "a religious war",
      "a spiral of raids that became open battle",
    ];
    const cause = pick(rng, causes);

    pushMain({
      year: nextYear(1, 3),
      type: "war",
      faction: factionA,
      otherFaction: factionB,
      text: `${factionA} and ${factionB} enter ${cause}. Patrols clash and banners move across the ridges.`,
    });

    trucePlanned = (rng() < 0.60);
    return true;
  }

  // Main events list (4 mains in the “core” chain)
  const mainFns = [
    mainEvent_Founding,
    (rng() < 0.55 ? mainEvent_Crash : mainEvent_DestructionToRuin),
    mainEvent_WarOrPolitics,
    // 4th main: choose whichever is still meaningful
    () => {
      // Prefer crash if not used or if destruction skipped
      if (crashSites.length && rng() < 0.55) return mainEvent_Crash();
      // Sometimes convert settlement->ruin if it didn’t happen yet
      if (settlements.length >= 2) return mainEvent_DestructionToRuin();
      // Otherwise major “mine/shrine” opening
      const m = mines[0] || null;
      if (m) {
        pushMain({
          year: nextYear(1, 3),
          type: "major",
          poiType: "mine",
          q: m.q,
          r: m.r,
          faction: m.faction || pickFactionOwner(),
          text: `${m.faction || "A faction"} open a mine at ${humanCoord(m.q, m.r)}, shifting trade and forcing escort patrols inland.`,
        });
        return true;
      }
      const s = shrines[0] || null;
      if (s) {
        const obj = worldObjects.find((o) => String(o.type || "").toLowerCase() === "shrine" && o.q === s.q && o.r === s.r);
        const religion = obj?.religion || obj?.meta?.religion || pick(rng, RELIGIONS);
        pushMain({
          year: nextYear(1, 3),
          type: "major",
          poiType: "shrine",
          q: s.q,
          r: s.r,
          faction: s.faction || pickFactionOwner(),
          text: `${s.faction || "A faction"} proclaim a shrine to ${religion} at ${humanCoord(s.q, s.r)}—pilgrims and guards soon follow.`,
        });
        return true;
      }
      pushMain({
        year: nextYear(1, 3),
        type: "major",
        faction: factionA,
        text: `A hard season forces new rules: rationing, escorts, and organized caravans across ${islandName}.`,
      });
      return true;
    }
  ];

  // Secondary generator
  const maxRoadEvents = 2;

  function doSecondaryPair() {
    const candidates = [];

    // ✅ ROAD: only if feasible AND only if planRoad succeeds
    if (roadPlans.length < maxRoadEvents) {
      candidates.push(() => {
        const endpoints = []
          .concat(settlements.map(s => ({ ...s, type: "settlement" })))
          .concat(mines.map(m => ({ ...m, type: "mine" })))
          .concat(watchtowers.map(w => ({ ...w, type: "watchtower" })))
          .concat(shrines.map(s => ({ ...s, type: "shrine" })))
          .concat(ruins.map(r => ({ ...r, type: "ruin" })));

        const usable = endpoints.filter(canUseAsRoadEndpoint);
        if (usable.length < 2) return false;

        const from = settlements[0] ? { ...settlements[0], type: "settlement" } : usable[0];

        const sorted = usable
          .filter(e => !(e.q === from.q && e.r === from.r))
          .slice()
          .sort((a, b) => {
            const da = hexDistance(from, a);
            const db = hexDistance(from, b);
            return db - da;
          });

        const to = sorted[Math.floor(rng() * Math.min(3, sorted.length))] || sorted[0];
        if (!to) return false;

        const owner = pickFactionOwner(from.faction || null);
        const yearPlanned = nextYear(1, 2);

        const ok = planRoad({
          from,
          to,
          faction: owner,
          reason: "trade and faster patrols",
          yearPlanned,
        });

        if (!ok) return false; // ✅ IMPORTANT: if not possible, we will pick another secondary

        pushSecondary({
          year: yearPlanned,
          type: "road_built",
          poiType: "road",
          from: { q: from.q, r: from.r },
          to: { q: to.q, r: to.r },
          faction: owner,
          text: `${owner} build a road to link ${labelPOI(from)} and ${labelPOI(to)}—a costly project justified by speed and security.`,
        });
        return true;
      });
    }

    // vehicle abandoned
    if (vehicles.length) {
      candidates.push(() => {
        const v = vehicles[Math.floor(rng() * vehicles.length)];
        if (!v) return false;
        const yearEv = nextYear(1, 2);
        const owner = v.faction || pickFactionOwner();
        const reasons = ["a breakdown", "unknown causes", "suspected sabotage"];
        pushSecondary({
          year: yearEv,
          type: "abandoned_vehicle",
          poiType: "vehicle",
          q: v.q,
          r: v.r,
          faction: owner,
          text: `${owner} lose a transport to ${pick(rng, reasons)} at ${humanCoord(v.q, v.r)}. The vehicle becomes a landmark for travelers.`,
        });
        return true;
      });
    }

    // wreck found
    if (wrecks.length) {
      candidates.push(() => {
        const w = wrecks[Math.floor(rng() * wrecks.length)];
        if (!w) return false;
        const yearEv = nextYear(1, 2);
        const owner = w.faction || pickFactionOwner();
        const reasons = ["mechanical failure", "unknown causes", "suspected sabotage"];
        pushSecondary({
          year: yearEv,
          type: "wreck_found",
          poiType: "wreck",
          q: w.q,
          r: w.r,
          faction: owner,
          text: `${owner} secure a shipwreck near ${humanCoord(w.q, w.r)}—salvage crews blame ${pick(rng, reasons)} and strip what the sea allows.`,
        });
        return true;
      });
    }

    // shrine founded
    if (shrines.length) {
      candidates.push(() => {
        const s = shrines[0];
        const yearEv = nextYear(1, 2);
        const owner = s.faction || pickFactionOwner();
        const obj = worldObjects.find((o) => String(o.type || "").toLowerCase() === "shrine" && o.q === s.q && o.r === s.r);
        const religion = obj?.religion || obj?.meta?.religion || pick(rng, RELIGIONS);
        pushSecondary({
          year: yearEv,
          type: "shrine_founded",
          poiType: "shrine",
          q: s.q,
          r: s.r,
          faction: owner,
          text: `${owner} found a shrine to ${religion} at ${humanCoord(s.q, s.r)}—pilgrims and guards soon follow the marked paths.`,
        });
        return true;
      });
    }

    // camp founded
    if (roadsideCamps.length) {
      candidates.push(() => {
        const c = roadsideCamps[0];
        const yearEv = nextYear(1, 2);
        const owner = c.faction || pickFactionOwner();
        pushSecondary({
          year: yearEv,
          type: "camp_founded",
          poiType: "roadside_camp",
          q: c.q,
          r: c.r,
          faction: owner,
          text: `${owner} establish a roadside camp at ${humanCoord(c.q, c.r)} as a paid stop for repairs, water, and rumors.`,
        });
        return true;
      });
    }

    // truce (as secondary, only if war happened)
    if (hasTwoFactions && warOngoing && trucePlanned) {
      candidates.push(() => {
        const yearEv = nextYear(1, 2);
        pushSecondary({
          year: yearEv,
          type: "truce",
          faction: factionA,
          otherFaction: factionB,
          text: `${factionA} and ${factionB} sign a tense truce—trade resumes under escort, and border stones are quietly reset.`,
        });
        warOngoing = false;
        trucePlanned = false;
        return true;
      });
    }

    // global event
    candidates.push(() => {
      const yearEv = nextYear(1, 2);
      const roll = rng();
      if (roll < 0.25) {
        pushSecondary({ year: yearEv, type: "flood", text: `Floodwaters redraw safe paths; some low routes become impassable for a season.` });
      } else if (roll < 0.50) {
        pushSecondary({ year: yearEv, type: "famine", text: `A lean season strains stores; escorts become common and petty theft rises along the trails.` });
      } else if (roll < 0.75) {
        pushSecondary({ year: yearEv, type: "good_harvest", text: `A good harvest steadies morale and supplies; repairs and building projects surge.` });
      } else {
        pushSecondary({ year: yearEv, type: "disaster", text: `A season of trouble—${pick(rng, DISASTER_TYPES)}—forces patrols to redraw their routes.` });
      }
      return true;
    });

    // Pick 2 successful
    let made = 0;
    const tried = new Set();
    while (made < 2 && tried.size < candidates.length) {
      const idx = Math.floor(rng() * candidates.length);
      if (tried.has(idx)) continue;
      tried.add(idx);
      if (candidates[idx]()) made++;
    }

    while (made < 2) {
      const yearEv = nextYear(1, 2);
      pushSecondary({ year: yearEv, type: "minor", text: `Work crews clear brush and stack stones along the most traveled paths.` });
      made++;
    }
  }

  // ---- Build order:
  // Discovery already in
  // Main -> 2 Secondary (x3)
  // Main
  // ✅ EXTRA: Main -> 2 Secondary
  // Players arrive (last)
  for (let i = 0; i < 4; i++) {
    mainFns[i]?.();
    if (i < 3) doSecondaryPair();
  }

  // ✅ NEW: extra block before players
  // Main + 2 secondaries
  {
    // extra main: try “founding outpost / fortification / claim mine”
    const yearEv = nextYear(1, 3);
    const pickMain = rng();

    if (watchtowers[0] && pickMain < 0.34) {
      const w = watchtowers[0];
      pushMain({
        year: yearEv,
        type: "founding",
        poiType: "watchtower",
        q: w.q,
        r: w.r,
        faction: w.faction || pickFactionOwner(),
        text: `${w.faction || "A faction"} strengthen the watchtower at ${humanCoord(w.q, w.r)}—a clear sign they intend to stay.`,
      });
    } else if (mines[0] && pickMain < 0.67) {
      const m = mines[0];
      pushMain({
        year: yearEv,
        type: "major",
        poiType: "mine",
        q: m.q,
        r: m.r,
        faction: m.faction || pickFactionOwner(),
        text: `${m.faction || "A faction"} officially claim the mine at ${humanCoord(m.q, m.r)} and begin guarded caravans.`,
      });
    } else {
      pushMain({
        year: yearEv,
        type: "major",
        faction: pickFactionOwner(),
        text: `A new wave of settlers arrives, bringing tools, debts, and fresh rivalries.`,
      });
    }

    doSecondaryPair(); // +2 secondary right before players
  }

  // Players arrive (always last)
  pushMain({
    year: nextYear(1, 2),
    type: "players_arrive",
    text: `New arrivals land on ${islandName}. Old claims, half-built roads, and unresolved grudges now collide with the player's ambitions.`,
  });

  // Sort & commit
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
    if (ev.faction) entry.faction = ev.faction;
    if (ev.otherFaction) entry.otherFaction = ev.otherFaction;
    if (ev.settlementName) entry.settlementName = ev.settlementName;
    if (ev.ruinName) entry.ruinName = ev.ruinName;

    addEntry(entry);
  }

  scene.loreState = {
    islandName,
    factions,
    outposts: [].concat(settlements).concat(ruins),
    settlements,
    ruins,
    mines,
    watchtowers,
    shrines,
    roadsideCamps,
    raiderCamps,
    resources: resInfo,
    disaster: null,
    roadPlans,
  };

  if (!scene.mapInfo) scene.mapInfo = { tiles, objects: [] };
  scene.mapInfo.objects = worldObjects;
  if (scene.hexMap) scene.hexMap.objects = worldObjects;

  scene.__worldLoreGenerated = true;
}

export function generateRuinLoreForTile(scene, tile) {
  if (!scene || !tile) return;
  ensureWorldLoreGenerated(scene);
  tile.__loreGenerated = true;
}

export function generateRoadLoreForExistingConnections(scene) {
  if (!scene) return;
  ensureWorldLoreGenerated(scene);
  scene.__roadLoreGenerated = true;
}
