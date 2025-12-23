// src/scenes/WorldSceneMapLocations.js
//
// FULLY DETERMINISTIC version.
// All POIs, roads, forests, mountain icons come only from mapInfo + mapData.
// NO randomness here.
//
// Forest rendering:
// - Seed-based per-hex RNG (stable across redraw/order)
// - 3–4 tree emoji per forest hex
// - Different tree emoji depending on terrain/biome
// - No sway animation

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

function rngForHex(scene, q, r, salt = "treesV2") {
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
   POI flags: now driven by mapInfo.objects (seed -> lore -> POI)
   --------------------------------------------------------------- */
export function applyLocationFlags(mapData, mapObjects) {
  if (!Array.isArray(mapData)) return mapData;

  const objs = Array.isArray(mapObjects) ? mapObjects : [];
  if (!objs.length) {
    // Nothing to apply – просто убедимся, что флаги существуют
    for (const t of mapData) {
      if (!t) continue;
      t.hasRuin = !!t.hasRuin;
      t.hasCrashSite = !!t.hasCrashSite;
      t.hasVehicle = !!t.hasVehicle;
      t.hasWreck = !!t.hasWreck;

      // New POIs (default false if absent)
      t.hasSettlement = !!t.hasSettlement;
      t.hasRaiderCamp = !!t.hasRaiderCamp;
      t.hasRoadsideCamp = !!t.hasRoadsideCamp;
      t.hasWatchtower = !!t.hasWatchtower;
      t.hasMinePOI = !!t.hasMinePOI;
      t.hasShrine = !!t.hasShrine;

      // optional label fields
      if (typeof t.settlementName !== "string") t.settlementName = t.settlementName || "";
      if (typeof t.poiName !== "string") t.poiName = t.poiName || "";
      if (typeof t.owningFaction !== "string") t.owningFaction = t.owningFaction || "";
    }
    return mapData;
  }

  // Index tiles by q,r
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));

  // Сначала сбросить все флаги POI (мы хотим, чтобы ИСТОРИЯ была источником правды)
  for (const t of mapData) {
    if (!t) continue;
    t.hasRuin = false;
    t.hasCrashSite = false;
    t.hasVehicle = false;
    t.hasWreck = false;

    // New POIs
    t.hasSettlement = false;
    t.hasRaiderCamp = false;
    t.hasRoadsideCamp = false;
    t.hasWatchtower = false;
    t.hasMinePOI = false;
    t.hasShrine = false;

    // name helpers (optional)
    if (typeof t.settlementName !== "string") t.settlementName = "";
    if (typeof t.poiName !== "string") t.poiName = "";
    if (typeof t.owningFaction !== "string") t.owningFaction = "";

    // hasObject может использоваться и в других местах
    if (typeof t.hasObject !== "boolean") t.hasObject = !!t.hasObject;
    else t.hasObject = false;
  }

  // Затем проставить флаги по объектам карты
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
   Forest visuals (seed-based, old-style look)
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

function pickTreeEmoji(scene, tile, rng) {
  const biome = safeResolveBiome(scene, tile);

  const type = String(tile?.type || "").toLowerCase();
  const ground = String(tile?.groundType || "").toLowerCase();
  const elev = Number.isFinite(tile?.elevation) ? tile.elevation : (Number.isFinite(tile?.visualElevation) ? tile.visualElevation : 0);

  // Weighted palettes (emoji only)
  // You can tweak these anytime; deterministic will stay stable if you keep salt constant.
  const palettes = {
    // desert/sand-ish
    arid: [{ v: "🌴", w: 3 }, { v: "🌵", w: 2 }],
    // cold
    cold: [{ v: "🌲", w: 6 }, { v: "🌳", w: 1 }],
    // swamp / lush
    lush: [{ v: "🌳", w: 4 }, { v: "🌿", w: 2 }],
    // forest
    forest: [{ v: "🌲", w: 4 }, { v: "🌳", w: 3 }],
    // default
    normal: [{ v: "🌳", w: 5 }, { v: "🌲", w: 2 }],
  };

  const isSnow = biome.includes("snow") || biome.includes("tundra") || biome.includes("ice") || ground.includes("snow") || ground.includes("ice");
  const isArid = biome.includes("desert") || biome.includes("arid") || ground.includes("sand") || ground.includes("dune") || ground.includes("ash");
  const isSwamp = biome.includes("swamp") || biome.includes("marsh") || ground.includes("swamp") || ground.includes("marsh");
  const isForestBiome = biome.includes("forest") || biome.includes("wood") || tile?.hasForest;

  // Hills/high elev lean conifer
  const isHigh = elev >= 5 || biome.includes("mountain") || type === "mountain";

  if (isSnow) return rng.pickWeighted(palettes.cold);
  if (isArid) return rng.pickWeighted(palettes.arid);
  if (isSwamp) return rng.pickWeighted(palettes.lush);
  if (isHigh) return "🌲";
  if (isForestBiome) return rng.pickWeighted(palettes.forest);
  return rng.pickWeighted(palettes.normal);
}

function placeForestTrees(scene, tile, addEmoji, cx, cy, size) {
  // Deterministic per-hex RNG
  const rng = rngForHex(scene, tile.q, tile.r, "treesV2");

  // 3–4 trees
  const nTrees = rng.int(3, 4);

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
      const oy = Math.sin(ang) * rad * 0.70; // slightly squashed vertically (nice look)

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

      const emoji = pickTreeEmoji(scene, tile, rng);

      // Font size variation (deterministic)
      const px = size * rng.float(0.46, 0.62);

      const tree = addEmoji(tile.q, tile.r, ox, oy, emoji, px, 105);
      tree.x = cx + ox;
      tree.y = cy + oy;

      placed.push({ ox, oy });
      placedOne = true;
      break;
    }

    // If we couldn't place with spacing, fallback to center-ish
    if (!placedOne) {
      const ox = rng.float(-size * 0.18, size * 0.18);
      const oy = rng.float(-size * 0.18, size * 0.18);
      const emoji = pickTreeEmoji(scene, tile, rng);
      const px = size * rng.float(0.46, 0.62);

      const tree = addEmoji(tile.q, tile.r, ox, oy, emoji, px, 105);
      tree.x = cx + ox;
      tree.y = cy + oy;
      placed.push({ ox, oy });
    }
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

  /* ------------------- POI Icons ------------------- */
  const noPOISet = getNoPOISet(map);

  const addEmoji = (q, r, ox, oy, char, px, depth = 42) => {
    const t = scene.add.text(0, 0, char, {
      fontSize: `${px}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    });
    t.setOrigin(0.5).setDepth(depth);

    // attach tile anchor so we can resnap after water level changes
    t.__hex = { q, r, ox: ox || 0, oy: oy || 0 };

    layer.add(t);
    return t;
  };

  for (const t of map) {
    if (!t) continue;

    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const isWater = t.type === "water";
    const allowOnWater = !!t.hasWreck;

    if (isWater && !allowOnWater) {
      // NOTE: trees/POI icons are skipped on water, except wreck
      continue;
    }

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

    /* ---------------- Forests (NEW OLD-STYLE LOOK, SEED-BASED) ---------------- */
    if (!isWater && t.hasForest) {
      placeForestTrees(scene, t, addEmoji, cx, cy, size);
    }

    /* ---------------- Settlement (NEW ICON) ---------------- */
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

    /* ---------------- Raider camp (NEW ICON) ---------------- */
    if (!isWater && t.hasRaiderCamp) {
      const rc = addEmoji(t.q, t.r, 0, 0, "☠️", size * 0.8, 106);
      rc.x = cx;
      rc.y = cy;
    }

    /* ---------------- Roadside camp (NEW ICON) ---------------- */
    if (!isWater && t.hasRoadsideCamp) {
      const camp = addEmoji(t.q, t.r, 0, 0, "🏕️", size * 0.78, 106);
      camp.x = cx;
      camp.y = cy;
    }

    /* ---------------- Watchtower (NEW ICON) ---------------- */
    if (!isWater && t.hasWatchtower) {
      const wt = addEmoji(t.q, t.r, 0, 0, "🏰", size * 0.78, 106);
      wt.x = cx;
      wt.y = cy;
    }

    /* ---------------- Mine POI (NEW ICON) ---------------- */
    if (!isWater && t.hasMinePOI) {
      const m = addEmoji(t.q, t.r, 0, 0, "⚒️", size * 0.78, 106);
      m.x = cx;
      m.y = cy;
    }

    /* ---------------- Shrine (NEW ICON) ---------------- */
    if (!isWater && t.hasShrine) {
      const sh = addEmoji(t.q, t.r, 0, 0, "⛩️", size * 0.78, 106);
      sh.x = cx;
      sh.y = cy;
    }
  }

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
