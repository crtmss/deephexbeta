// src/scenes/WorldSceneMapLocations.js
//
// FULLY DETERMINISTIC version.
// All POIs, roads, forests, mountain icons come only from mapInfo + mapData.
// NO randomness here.
//
// Forest rendering (improved):
// - Seed-based per-hex RNG (stable across redraw/order)
// - 3–4 tree emoji per forest hex
// - On a single hex, ONLY ONE vegetation type is used (e.g. either 🌴 OR 🌵, never both)
// - Biome palettes updated per your spec
// - No sway animation
//
// Added small biome decorations (deterministic):
// - 2–5 total decorations across the whole map, seeded
// - Each decoration is 1 per hex, size = 50% of tree size
// - Decorations are spaced: any two decorations must be within radius 5 hexes of each other
//   (clustered, not scattered)
// - 🍄 and 🌷 on any biome except desert and snow
// - ⛄ on snow biome
// - 🐚 on desert biome

import {
  effectiveElevationLocal,
  initOrUpdateGeography,
  drawGeographyOverlay,
  getNoPOISet,
  resolveBiome,
} from "./WorldSceneGeography.js";
import {
  generateRuinLoreForTile,
  generateRoadLoreForExistingConnections,
} from "./LoreGeneration.js";

const keyOf = (q, r) => `${q},${r}`;

/* ---------------------------------------------------------------
   Deterministic RNG helpers (seed + q,r + salt -> stable rand())
   --------------------------------------------------------------- */
function hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small, fast deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getSceneSeedString(scene) {
  return (
    (typeof scene?.seedStr === "string" && scene.seedStr) ||
    (typeof scene?.worldSeed === "string" && scene.worldSeed) ||
    (typeof scene?.seed === "string" && scene.seed) ||
    (typeof scene?.mapSeed === "string" && scene.mapSeed) ||
    String(scene?.seedStr ?? scene?.worldSeed ?? scene?.seed ?? "default-seed")
  );
}

function rngForHex(scene, q, r, salt = "treesV3") {
  const s = `${getSceneSeedString(scene)}|${salt}|${q},${r}`;
  const seed = hashStr32(s);
  const rand = mulberry32(seed);

  return {
    rand,
    int(min, max) {
      const a = Math.min(min, max);
      const b = Math.max(min, max);
      return a + Math.floor(rand() * (b - a + 1));
    },
    float(min, max) {
      return min + rand() * (max - min);
    },
    pick(arr) {
      if (!arr || arr.length === 0) return null;
      return arr[Math.floor(rand() * arr.length)];
    },
    pickWeighted(items) {
      // items: [{v, w}]
      if (!Array.isArray(items) || items.length === 0) return null;
      let sum = 0;
      for (const it of items) sum += Math.max(0, it.w || 0);
      if (sum <= 0) return items[0].v;
      let x = rand() * sum;
      for (const it of items) {
        x -= Math.max(0, it.w || 0);
        if (x <= 0) return it.v;
      }
      return items[items.length - 1].v;
    },
  };
}

/* ---------------------------------------------------------------
   Deterministic neighbor helpers
   --------------------------------------------------------------- */
function neighborsOddR(q, r) {
  const even = r % 2 === 0;
  return even
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
}

function inBounds(q, r, w, h) {
  return q >= 0 && r >= 0 && q < w && r < h;
}

/* ---------------------------------------------------------------
   Hex distance helper (odd-r axial-ish distance)
   Uses cube conversion for axial coords (q,r) where s = -q-r
   --------------------------------------------------------------- */
function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/* ---------------------------------------------------------------
   POI flags: now driven by mapInfo.objects (seed -> lore -> POI)
   --------------------------------------------------------------- */
export function applyLocationFlags(mapData, mapObjects) {
  if (!Array.isArray(mapData)) return mapData;

  const objs = Array.isArray(mapObjects) ? mapObjects : [];
  if (!objs.length) {
    for (const t of mapData) {
      if (!t) continue;
      t.hasRuin = !!t.hasRuin;
      t.hasCrashSite = !!t.hasCrashSite;
      t.hasVehicle = !!t.hasVehicle;
      t.hasWreck = !!t.hasWreck;

      t.hasSettlement = !!t.hasSettlement;
      t.hasRaiderCamp = !!t.hasRaiderCamp;
      t.hasRoadsideCamp = !!t.hasRoadsideCamp;
      t.hasWatchtower = !!t.hasWatchtower;
      t.hasMinePOI = !!t.hasMinePOI;
      t.hasShrine = !!t.hasShrine;

      if (typeof t.settlementName !== "string") t.settlementName = t.settlementName || "";
      if (typeof t.poiName !== "string") t.poiName = t.poiName || "";
      if (typeof t.owningFaction !== "string") t.owningFaction = t.owningFaction || "";
    }
    return mapData;
  }

  const byKey = new Map(mapData.map((t) => [keyOf(t.q, t.r), t]));

  for (const t of mapData) {
    if (!t) continue;
    t.hasRuin = false;
    t.hasCrashSite = false;
    t.hasVehicle = false;
    t.hasWreck = false;

    t.hasSettlement = false;
    t.hasRaiderCamp = false;
    t.hasRoadsideCamp = false;
    t.hasWatchtower = false;
    t.hasMinePOI = false;
    t.hasShrine = false;

    if (typeof t.settlementName !== "string") t.settlementName = "";
    if (typeof t.poiName !== "string") t.poiName = "";
    if (typeof t.owningFaction !== "string") t.owningFaction = "";

    if (typeof t.hasObject !== "boolean") t.hasObject = !!t.hasObject;
    else t.hasObject = false;
  }

  for (const o of objs) {
    if (!o) continue;
    const q = o.q;
    const r = o.r;
    if (typeof q !== "number" || typeof r !== "number") continue;

    const tile = byKey.get(keyOf(q, r));
    if (!tile) continue;

    const type = String(o.type || "").toLowerCase();

    if (type === "ruin") {
      tile.hasRuin = true;
      tile.hasObject = true;
      if (o.name) tile.poiName = String(o.name);
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "crash_site") {
      tile.hasCrashSite = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "wreck") {
      tile.hasWreck = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "vehicle" || type === "abandoned_vehicle") {
      tile.hasVehicle = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "settlement") {
      tile.hasSettlement = true;
      tile.hasObject = true;
      const n = o.name ? String(o.name) : (tile.cityName ? String(tile.cityName) : "");
      tile.settlementName = n;
      tile.poiName = n || tile.poiName;
      if (n) tile.cityName = n;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "raider_camp") {
      tile.hasRaiderCamp = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "roadside_camp") {
      tile.hasRoadsideCamp = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "watchtower") {
      tile.hasWatchtower = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "mine") {
      tile.hasMinePOI = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    } else if (type === "shrine") {
      tile.hasShrine = true;
      tile.hasObject = true;
      if (o.faction) tile.owningFaction = String(o.faction);
    }
  }

  return mapData;
}

/* ---------------------------------------------------------------
   Deterministic ASTAR roads
   --------------------------------------------------------------- */
function deterministicAStar(byKey, width, height, start, goal) {
  const startK = keyOf(start.q, start.r);
  const goalK = keyOf(goal.q, goal.r);

  const open = new Map([
    [
      startK,
      {
        k: startK,
        q: start.q,
        r: start.r,
        g: 0,
        f: 0,
        parent: null,
      },
    ],
  ]);

  const closed = new Set();

  const heuristic = (q, r) => Math.abs(q - goal.q) + Math.abs(r - goal.r);

  while (open.size > 0) {
    let cur = null;
    for (const n of open.values()) {
      if (!cur || n.f < cur.f || (n.f === cur.f && n.k < cur.k)) cur = n;
    }
    open.delete(cur.k);

    if (cur.k === goalK) {
      const path = [];
      let n = cur;
      while (n) {
        path.push(byKey.get(keyOf(n.q, n.r)));
        n = n.parent;
      }
      return path.reverse();
    }

    closed.add(cur.k);

    for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
      const nq = cur.q + dq;
      const nr = cur.r + dr;
      if (!inBounds(nq, nr, width, height)) continue;

      const nk = keyOf(nq, nr);
      if (!byKey.has(nk) || closed.has(nk)) continue;

      const nTile = byKey.get(nk);
      if (!nTile || nTile.type === "water") continue;

      const g = cur.g + 1;
      const f = g + heuristic(nq, nr);
      const existing = open.get(nk);

      if (!existing || g < existing.g) {
        open.set(nk, {
          k: nk,
          q: nq,
          r: nr,
          g,
          f,
          parent: cur,
        });
      }
    }
  }
  return null;
}

function addRoad(mapData, a, b) {
  if (!a || !b) return;
  if (!a.roadLinks) a.roadLinks = new Set();
  if (!b.roadLinks) b.roadLinks = new Set();
  a.roadLinks.add(keyOf(b.q, b.r));
  b.roadLinks.add(keyOf(a.q, a.r));
  a.hasRoad = true;
  b.hasRoad = true;
}

function clearRoads(mapData) {
  if (!Array.isArray(mapData)) return;
  for (const t of mapData) {
    if (!t) continue;
    t.hasRoad = false;
    if (t.roadLinks) t.roadLinks = null;
  }
}

function generateDeterministicRoads(scene, mapData, width, height, mapObjects) {
  const byKey = new Map(mapData.map((t) => [keyOf(t.q, t.r), t]));

  scene.roadConnections = [];
  const roadConns = scene.roadConnections;

  const pts = mapObjects.filter((o) => {
    const T = String(o.type || "").toLowerCase();
    return (
      T === "settlement" ||
      T === "ruin" ||
      T === "raider_camp" ||
      T === "roadside_camp" ||
      T === "watchtower" ||
      T === "mine" ||
      T === "shrine" ||
      T === "crash_site" ||
      T === "vehicle"
    );
  });

  pts.sort((a, b) => a.q - b.q || a.r - b.r);

  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const tA = byKey.get(keyOf(A.q, A.r));
    const tB = byKey.get(keyOf(B.q, B.r));
    if (!tA || !tB) continue;

    const path = deterministicAStar(byKey, width, height, tA, tB);
    if (!path || path.length < 2) continue;

    for (let j = 0; j + 1 < path.length; j++) {
      addRoad(mapData, path[j], path[j + 1]);
    }

    roadConns.push({
      from: { q: A.q, r: A.r, type: String(A.type || "").toLowerCase() },
      to: { q: B.q, r: B.r, type: String(B.type || "").toLowerCase() },
      path: path.map((t) => ({ q: t.q, r: t.r })),
    });
  }
}

/* ---------------------------------------------------------------
   Reposition helpers: keep emoji locked to hex elevation
   --------------------------------------------------------------- */
export function refreshLocationIcons(scene) {
  if (!scene || !scene.locationsLayer) return;
  const layer = scene.locationsLayer;
  const size = scene.hexSize || 24;

  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;

  const map = scene.mapData || [];
  const byKey = new Map(map.map((t) => [keyOf(t.q, t.r), t]));

  layer.iterate((obj) => {
    if (!obj || !obj.__hex) return;

    const { q, r, ox = 0, oy = 0 } = obj.__hex;
    const tile = byKey.get(keyOf(q, r));
    if (!tile) return;

    const c = scene.hexToPixel(q, r, size);
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(tile);

    obj.x = cx + ox;
    obj.y = cy + oy;
  });
}

/* ---------------------------------------------------------------
   Biome detection + vegetation palettes
   --------------------------------------------------------------- */
function safeResolveBiome(scene, tile) {
  // resolveBiome signature may vary; be defensive.
  try {
    const b = resolveBiome?.(scene, tile);
    if (typeof b === "string" && b) return b.toLowerCase();
  } catch (_e) {}
  try {
    const b = resolveBiome?.(tile);
    if (typeof b === "string" && b) return b.toLowerCase();
  } catch (_e) {}
  const fallback = String(tile?.biome || tile?.biomeName || "").toLowerCase();
  return fallback || "";
}

function biomeClass(scene, tile) {
  const biome = safeResolveBiome(scene, tile);
  const type = String(tile?.type || "").toLowerCase();
  const ground = String(tile?.groundType || "").toLowerCase();
  const elev = Number.isFinite(tile?.elevation)
    ? tile.elevation
    : (Number.isFinite(tile?.visualElevation) ? tile.visualElevation : 0);

  const isSnow =
    biome.includes("snow") ||
    biome.includes("tundra") ||
    biome.includes("ice") ||
    ground.includes("snow") ||
    ground.includes("ice");

  const isDesertVolcanic =
    biome.includes("desert") ||
    biome.includes("arid") ||
    biome.includes("volcan") ||
    ground.includes("sand") ||
    ground.includes("dune") ||
    ground.includes("ash") ||
    ground.includes("lava");

  const isSwamp =
    biome.includes("swamp") ||
    biome.includes("marsh") ||
    ground.includes("swamp") ||
    ground.includes("marsh");

  // "temperate" is the default land class; we can bias conifers on high elevation
  const isHigh = elev >= 5 || biome.includes("mountain") || type === "mountain";

  if (isSnow) return "snow";
  if (isDesertVolcanic) return "desert";
  if (isSwamp) return "swamp";
  if (isHigh) return "temperate_high";
  return "temperate";
}

/**
 * IMPORTANT RULE (per your request):
 * On a single hex, we pick ONE vegetation emoji and use it for all trees on that hex.
 * (So no "🌴 and 🌵" mixture on the same tile.)
 */
function pickHexVegetationEmoji(scene, tile, rng) {
  const cls = biomeClass(scene, tile);

  // Updated palettes:
  // desert & volcanic: [🌴, 🌵]
  // snow/ice: [🌲, white flower]
  // swamp: [🌳, seedling]
  // temperate: [🌳, 🌲] 70/30
  if (cls === "desert") {
    return rng.pick(["🌴", "🌵"]);
  }
  if (cls === "snow") {
    return rng.pick(["🌲", "🤍"]); // "white_flower" in emoji is usually "💮" but you asked :white_flower:
  }
  if (cls === "swamp") {
    return rng.pick(["🌳", "🌱"]);
  }

  // Temperate (incl high-elev bias)
  if (cls === "temperate_high") {
    // More conifer-y on high elevation; still single type per hex
    return rng.pickWeighted([{ v: "🌲", w: 7 }, { v: "🌳", w: 3 }]);
  }

  // Default temperate: 70/30
  return rng.pickWeighted([{ v: "🌳", w: 7 }, { v: "🌲", w: 3 }]);
}

/* ---------------------------------------------------------------
   Forest visuals (seed-based, old-style look)
   --------------------------------------------------------------- */
function placeForestTrees(scene, tile, addEmoji, cx, cy, size) {
  const rng = rngForHex(scene, tile.q, tile.r, "treesV3");

  // 3–4 trees
  const nTrees = rng.int(3, 4);

  // Pick ONE vegetation emoji for the whole tile
  const vegEmoji = pickHexVegetationEmoji(scene, tile, rng);

  // Old style: random radial offsets with spacing
  const placed = [];
  const minDist = size * 0.32;
  const triesMax = 40;

  for (let i = 0; i < nTrees; i++) {
    let placedOne = false;

    for (let tries = 0; tries < triesMax; tries++) {
      const ang = rng.float(0, Math.PI * 2);
      const rad = rng.float(size * 0.20, size * 0.60);

      const ox = Math.cos(ang) * rad;
      const oy = Math.sin(ang) * rad * 0.70; // squashed vertically

      let ok = true;
      for (const p of placed) {
        const dx = p.ox - ox;
        const dy = p.oy - oy;
        if (Math.hypot(dx, dy) < minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const px = size * rng.float(0.46, 0.62);

      const tree = addEmoji(tile.q, tile.r, ox, oy, vegEmoji, px, 105);
      tree.x = cx + ox;
      tree.y = cy + oy;

      placed.push({ ox, oy });
      placedOne = true;
      break;
    }

    if (!placedOne) {
      const ox = rng.float(-size * 0.18, size * 0.18);
      const oy = rng.float(-size * 0.18, size * 0.18);
      const px = size * rng.float(0.46, 0.62);

      const tree = addEmoji(tile.q, tile.r, ox, oy, vegEmoji, px, 105);
      tree.x = cx + ox;
      tree.y = cy + oy;

      placed.push({ ox, oy });
    }
  }

  // Return typical tree px size, so decorations can be scaled to 50% of it.
  // Use median-ish value rather than last tree
  return size * 0.54;
}

/* ---------------------------------------------------------------
   Biome decorations (deterministic cluster, 2–5 total)
   --------------------------------------------------------------- */
function buildDecorationPlan(scene, mapData) {
  // Cache plan per map + seed
  const seedStr = getSceneSeedString(scene);
  const cacheKey = `${seedStr}|decorV1|${scene.mapWidth}x${scene.mapHeight}`;
  if (scene.__decorPlan && scene.__decorPlan.key === cacheKey) return scene.__decorPlan.plan;

  const rngGlobal = mulberry32(hashStr32(cacheKey));

  // Candidate hexes by biome (only land, and not blocked by noPOISet)
  const candidates = {
    desert: [],
    snow: [],
    other: [], // everything else (land)
  };

  for (const t of mapData) {
    if (!t) continue;
    if (t.type === "water") continue; // decorations only on land
    const cls = biomeClass(scene, t);
    if (cls === "desert") candidates.desert.push(t);
    else if (cls === "snow") candidates.snow.push(t);
    else candidates.other.push(t);
  }

  // If no candidates, no plan.
  if (
    candidates.desert.length + candidates.snow.length + candidates.other.length === 0
  ) {
    const plan = [];
    scene.__decorPlan = { key: cacheKey, plan };
    return plan;
  }

  // Choose a cluster center deterministically from any land candidates
  const allLand = candidates.desert.concat(candidates.snow, candidates.other);
  allLand.sort((a, b) => a.q - b.q || a.r - b.r);
  const centerIdx = Math.floor(rngGlobal() * allLand.length);
  const center = allLand[Math.max(0, Math.min(allLand.length - 1, centerIdx))];

  // Total decorations (2–5)
  const total = 2 + Math.floor(rngGlobal() * 4); // 2..5

  // We enforce: any two decorations must be within radius 5 of each other
  // We'll implement as: all decorations must be within radius 5 of the cluster center.
  const R = 5;

  const withinRadius = (t) => hexDistance(center.q, center.r, t.q, t.r) <= R;

  // Collect within-radius candidates by biome
  const local = {
    desert: candidates.desert.filter(withinRadius),
    snow: candidates.snow.filter(withinRadius),
    other: candidates.other.filter(withinRadius),
  };

  // If cluster too sparse, relax by selecting from global, but still keep radius logic by moving center
  if (local.desert.length + local.snow.length + local.other.length < total) {
    // pick a new center from "other" if possible
    const fallbackPool = candidates.other.length ? candidates.other : allLand;
    fallbackPool.sort((a, b) => a.q - b.q || a.r - b.r);
    const c2 = fallbackPool[Math.floor(rngGlobal() * fallbackPool.length)];
    const within2 = (t) => hexDistance(c2.q, c2.r, t.q, t.r) <= R;

    local.desert = candidates.desert.filter(within2);
    local.snow = candidates.snow.filter(within2);
    local.other = candidates.other.filter(within2);
  }

  // Plan entries: {q,r, emoji}
  const plan = [];
  const used = new Set();

  function pickFrom(arr) {
    if (!arr.length) return null;
    // deterministic choice: shuffle-like by picking an index from rngGlobal
    const idx = Math.floor(rngGlobal() * arr.length);
    const t = arr.splice(idx, 1)[0];
    return t;
  }

  for (let i = 0; i < total; i++) {
    // Pick a tile from whichever bucket has something (biased toward "other")
    let tile = null;

    // Try to place at least 1 snowman if we have snow locally and rng says so
    if (!tile && local.snow.length && rngGlobal() < 0.25) tile = pickFrom(local.snow);

    // Try to place at least 1 shell if desert exists and rng says so
    if (!tile && local.desert.length && rngGlobal() < 0.25) tile = pickFrom(local.desert);

    // Default
    if (!tile && local.other.length) tile = pickFrom(local.other);
    if (!tile && local.desert.length) tile = pickFrom(local.desert);
    if (!tile && local.snow.length) tile = pickFrom(local.snow);

    if (!tile) break;

    const k = keyOf(tile.q, tile.r);
    if (used.has(k)) {
      i--;
      continue;
    }
    used.add(k);

    const cls = biomeClass(scene, tile);

    let emoji = "🍄";
    if (cls === "desert") {
      emoji = "🐚"; // shell on desert biome
    } else if (cls === "snow") {
      emoji = "⛄"; // snowman on snow biome
    } else {
      // other biomes: 🍄 or 🌷
      emoji = rngGlobal() < 0.5 ? "🍄" : "🌷";
    }

    plan.push({ q: tile.q, r: tile.r, emoji });
  }

  scene.__decorPlan = { key: cacheKey, plan };
  return plan;
}

function drawDecorations(scene, addEmoji, mapData, size, offsetX, offsetY, LIFT, noPOISet, treePxRef) {
  // treePxRef is ~ tree px; decorations are 50% of it
  const px = Math.max(8, (treePxRef || size * 0.54) * 0.5);

  const plan = buildDecorationPlan(scene, mapData);
  if (!plan || !plan.length) return;

  // quick lookup tile by q,r
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));

  for (const d of plan) {
    if (!d) continue;
    const k = keyOf(d.q, d.r);
    if (noPOISet && noPOISet.has(k)) continue;

    const tile = byKey.get(k);
    if (!tile) continue;
    if (tile.type === "water") continue;

    const c = scene.hexToPixel(tile.q, tile.r, size);
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(tile);

    // small random-ish local offset inside hex (deterministic per hex)
    const rng = rngForHex(scene, tile.q, tile.r, "decorV1");
    const ang = rng.float(0, Math.PI * 2);
    const rad = rng.float(size * 0.10, size * 0.35);
    const ox = Math.cos(ang) * rad;
    const oy = Math.sin(ang) * rad * 0.65;

    const deco = addEmoji(tile.q, tile.r, ox, oy, d.emoji, px, 104); // slightly below trees
    deco.x = cx + ox;
    deco.y = cy + oy;
  }
}

/* ---------------------------------------------------------------
   Rendering: Roads + POIs + Geography
   --------------------------------------------------------------- */
export function drawLocationsAndRoads() {
  const scene = this;
  const map = this.mapData;
  const size = this.hexSize || 24;

  if (!Array.isArray(map) || !map.length) return;

  // Ensure lore exists (mapInfo.objects)
  if (!scene.__worldLoreGenerated) {
    const firstLand = map.find((t) => t && t.type !== "water");
    if (firstLand) {
      generateRuinLoreForTile(scene, firstLand);
    }
  }

  const mapObjects =
    scene.mapInfo && Array.isArray(scene.mapInfo.objects) ? scene.mapInfo.objects : [];

  const objectsHash = mapObjects
    .map((o) => `${String(o.type || "").toLowerCase()}:${o.q},${o.r}`)
    .sort()
    .join("|");

  const prevHash = map.__roadsHash || "";
  const needRebuildRoads = !map.__roadsApplied || prevHash !== objectsHash;

  applyLocationFlags(map, mapObjects);

  if (needRebuildRoads) {
    clearRoads(map);
    generateDeterministicRoads(scene, map, scene.mapWidth, scene.mapHeight, mapObjects);

    Object.defineProperty(map, "__roadsApplied", {
      value: true,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(map, "__roadsHash", {
      value: objectsHash,
      enumerable: false,
      writable: true,
      configurable: true,
    });

    scene.__roadLoreGenerated = false;
  }

  initOrUpdateGeography(scene, map);

  if (scene.roadsGraphics) scene.roadsGraphics.destroy();
  if (scene.locationsLayer) scene.locationsLayer.destroy();
  if (scene.geoOutlineGraphics) scene.geoOutlineGraphics.destroy();

  const roads = scene.add.graphics().setDepth(30);
  const layer = scene.add.container().setDepth(40);
  const geoOutline = scene.add.graphics().setDepth(120);

  scene.roadsGraphics = roads;
  scene.locationsLayer = layer;
  scene.geoOutlineGraphics = geoOutline;

  const byKey = new Map(map.map((t) => [keyOf(t.q, t.r), t]));

  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;

  /* ------------------- Roads ------------------- */
  for (const t of map) {
    if (!t.roadLinks) continue;

    const c1 = scene.hexToPixel(t.q, t.r, size);
    const y1 = c1.y - LIFT * effectiveElevationLocal(t);

    for (const target of t.roadLinks) {
      if (target <= keyOf(t.q, t.r)) continue;
      const n = byKey.get(target);
      if (!n) continue;

      const c2 = scene.hexToPixel(n.q, n.r, size);
      const y2 = c2.y - LIFT * effectiveElevationLocal(n);

      roads.lineStyle(4, 0x6b5430, 0.9);
      roads.beginPath();
      roads.moveTo(c1.x + offsetX, y1 + offsetY);
      roads.lineTo(c2.x + offsetX, y2 + offsetY);
      roads.strokePath();
    }
  }

  /* ------------------- Geography overlays ------------------- */
  drawGeographyOverlay(scene);

  /* ------------------- Electricity overlay (if present) ------------------- */
  if (typeof scene.drawElectricityOverlay === "function") {
    scene.drawElectricityOverlay();
  } else if (scene.electricity && typeof scene.electricity.drawOverlay === "function") {
    scene.electricity.drawOverlay();
  }

  /* ------------------- POI Icons + Forests + Decorations ------------------- */
  const noPOISet = getNoPOISet(map);

  const addEmoji = (q, r, ox, oy, char, px, depth = 42) => {
    const t = scene.add.text(0, 0, char, {
      fontSize: `${px}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    });
    t.setOrigin(0.5).setDepth(depth);
    t.__hex = { q, r, ox: ox || 0, oy: oy || 0 };
    layer.add(t);
    return t;
  };

  let treePxRef = size * 0.54; // default

  for (const t of map) {
    if (!t) continue;

    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const isWater = t.type === "water";
    const allowOnWater = !!t.hasWreck;

    // Skip everything on water except wreck icon
    if (isWater && !allowOnWater) continue;

    const c = scene.hexToPixel(t.q, t.r, size);
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(t);

    /* ---------------- Mountain icons ---------------- */
    if (!isWater && (t.type === "mountain" || t.elevation === 7)) {
      const icon = addEmoji(t.q, t.r, 0, 0, "⛰️", size * 0.9, 110);
      icon.x = cx;
      icon.y = cy;
      continue;
    }

    /* ---------------- Forests (IMPROVED, SEED-BASED, ONE TYPE PER HEX) ---------------- */
    if (!isWater && t.hasForest) {
      treePxRef = placeForestTrees(scene, t, addEmoji, cx, cy, size) || treePxRef;
    }

    /* ---------------- Settlement ---------------- */
    if (!isWater && t.hasSettlement) {
      const s = addEmoji(t.q, t.r, 0, 0, "🏘️", size * 0.85, 106);
      s.x = cx;
      s.y = cy;
    }

    /* ---------------- Ruins ---------------- */
    if (!isWater && t.hasRuin) {
      const ruin = addEmoji(t.q, t.r, 0, 0, "🏚️", size * 0.8, 106);
      ruin.x = cx;
      ruin.y = cy;
      generateRuinLoreForTile(scene, t);
    }

    /* ---------------- Crash site (land) ---------------- */
    if (!isWater && t.hasCrashSite) {
      const crash = addEmoji(t.q, t.r, 0, 0, "💥", size * 0.8, 106);
      crash.x = cx;
      crash.y = cy;
    }

    /* ---------------- Wreck (water allowed) ---------------- */
    if (t.hasWreck) {
      const wr = addEmoji(t.q, t.r, 0, 0, "⚓", size * 0.8, 106);
      wr.x = cx;
      wr.y = cy;
    }

    /* ---------------- Vehicle ---------------- */
    if (!isWater && t.hasVehicle) {
      const veh = addEmoji(t.q, t.r, 0, 0, "🚙", size * 0.8, 106);
      veh.x = cx;
      veh.y = cy;
    }

    /* ---------------- Raider camp ---------------- */
    if (!isWater && t.hasRaiderCamp) {
      const rc = addEmoji(t.q, t.r, 0, 0, "☠️", size * 0.8, 106);
      rc.x = cx;
      rc.y = cy;
    }

    /* ---------------- Roadside camp ---------------- */
    if (!isWater && t.hasRoadsideCamp) {
      const camp = addEmoji(t.q, t.r, 0, 0, "🏕️", size * 0.78, 106);
      camp.x = cx;
      camp.y = cy;
    }

    /* ---------------- Watchtower ---------------- */
    if (!isWater && t.hasWatchtower) {
      const wt = addEmoji(t.q, t.r, 0, 0, "🏰", size * 0.78, 106);
      wt.x = cx;
      wt.y = cy;
    }

    /* ---------------- Mine POI ---------------- */
    if (!isWater && t.hasMinePOI) {
      const m = addEmoji(t.q, t.r, 0, 0, "⚒️", size * 0.78, 106);
      m.x = cx;
      m.y = cy;
    }

    /* ---------------- Shrine ---------------- */
    if (!isWater && t.hasShrine) {
      const sh = addEmoji(t.q, t.r, 0, 0, "⛩️", size * 0.78, 106);
      sh.x = cx;
      sh.y = cy;
    }
  }

  // Decorations are drawn after forests so they can sit under POIs but near trees.
  drawDecorations(scene, addEmoji, map, size, offsetX, offsetY, LIFT, noPOISet, treePxRef);

  // Safety: snap all icons to current elevation
  refreshLocationIcons(scene);

  if (!scene.__roadLoreGenerated) {
    generateRoadLoreForExistingConnections(scene);
  }
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
  refreshLocationIcons,
};
