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
//
// FIXES (requested):
// - Roads / POIs must NOT appear on mountain hexes.
//   * A* pathfinder now rejects mountain tiles as passable.
//   * Endpoints (pts) skip any mountain tile too.
//   * Mountain detection is robust (type/groundType/elevation==7).
// - Mountain icons still render for mountains.
//
// NOTE (NEW):
// - Road history generation is moved OUT of MapLocations into LoreGeneration.
//   This file must NOT add history entries about roads anymore.

import {
  effectiveElevationLocal,
  initOrUpdateGeography,
  drawGeographyOverlay,
  getNoPOISet,
  resolveBiome,
} from "./WorldSceneGeography.js";
import {
  generateRuinLoreForTile,
  // generateRoadLoreForExistingConnections, // MOVED OUT (do not generate history here)
} from "./LoreGeneration.js";

const keyOf = (q, r) => `${q},${r}`;

/* ---------------------------------------------------------------
   Mountain detection (robust, used for "no spawn on mountains")
   --------------------------------------------------------------- */
function isMountainTile(t) {
  if (!t) return false;
  const type = String(t.type || "").toLowerCase();
  const ground = String(t.groundType || "").toLowerCase();
  if (type === "mountain") return true;
  if (ground === "mountain") return true;
  // Legacy: some gens mark mountains with elevation==7
  if (t.elevation === 7 && type !== "water") return true;
  return false;
}

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
    (typeof scene?.seed === "string" && scene.seed) ||
    (typeof scene?.roomCode === "string" && scene.roomCode) ||
    "defaultseed"
  );
}

function randForHex(scene, q, r, salt = "") {
  const base = getSceneSeedString(scene);
  const h = hashStr32(`${base}|${q},${r}|${salt}`);
  return mulberry32(h);
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
/**
 * Apply POI flags onto tiles based on deterministic map objects.
 *
 * NOTE:
 *  - mapData is a flat array of tiles ({q,r,...}).
 *  - mapObjects usually come from scene.mapInfo.objects,
 *    which are filled by LoreGeneration (ensureWorldLoreGenerated).
 *
 * Backwards compatible: if mapObjects не переданы, ф-ция просто
 * возвращает mapData как есть.
 */
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
  const byKey = new Map(mapData.map((t) => [keyOf(t.q, t.r), t]));

  // Сначала сбросить все флаги POI (мы хотим, чтобы ИСТОРИЯ была источником правды)
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

    if (typeof t.hasObject !== "boolean") t.hasObject = !!t.hasObject;

    if (typeof t.settlementName !== "string") t.settlementName = "";
    if (typeof t.poiName !== "string") t.poiName = "";
    if (typeof t.owningFaction !== "string") t.owningFaction = "";
  }

  // Затем проставить флаги по объектам карты
  for (const o of objs) {
    if (!o) continue;
    const q = o.q;
    const r = o.r;
    if (typeof q !== "number" || typeof r !== "number") continue;

    const t = byKey.get(keyOf(q, r));
    if (!t) continue;

    // ✅ Roads/POIs/resources/etc must NOT spawn on mountains
    if (isMountainTile(t)) continue;

    const type = String(o.type || "").toLowerCase();

    if (type === "ruin") {
      t.hasRuin = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "crash_site") {
      t.hasCrashSite = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "vehicle") {
      t.hasVehicle = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "wreck") {
      t.hasWreck = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "settlement") {
      t.hasSettlement = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.settlementName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "raider_camp") {
      t.hasRaiderCamp = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "roadside_camp") {
      t.hasRoadsideCamp = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "watchtower") {
      t.hasWatchtower = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "mine") {
      t.hasMinePOI = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    } else if (type === "shrine") {
      t.hasShrine = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
    }
  }

  return mapData;
}

/* ---------------------------------------------------------------
   Roads data helpers (apply existing road flags/links only)
   --------------------------------------------------------------- */
function ensureRoadLinksTile(tile) {
  if (!tile) return;
  if (!(tile.roadLinks instanceof Set)) tile.roadLinks = new Set();
}

function applyRoadLink(a, b) {
  if (!a || !b) return;
  ensureRoadLinksTile(a);
  ensureRoadLinksTile(b);
  a.roadLinks.add(keyOf(b.q, b.r));
  b.roadLinks.add(keyOf(a.q, a.r));
  a.hasRoad = true;
  b.hasRoad = true;
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

  // Apply POI flags from lore-generated map objects.
  applyLocationFlags(map, mapObjects);

  // NOTE:
  // Road generation has been removed from MapLocations.
  // LoreGeneration is responsible for creating roads (tile.hasRoad / tile.roadLinks)
  // and for emitting the corresponding history events in the intended order.
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
    if (!t) continue;
    if (!t.hasRoad) continue;
    if (!(t.roadLinks instanceof Set)) continue;

    // ✅ never draw road on mountains
    if (isMountainTile(t)) continue;

    const c1 = scene.hexToPixel(t.q, t.r, size);
    const y1 = c1.y - LIFT * effectiveElevationLocal(t);

    for (const target of t.roadLinks) {
      if (target <= keyOf(t.q, t.r)) continue;
      const n = byKey.get(target);
      if (!n) continue;
      if (isMountainTile(n)) continue; // ✅ never draw road segment to mountains

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
    const t = scene.mapData.find((h) => h.q === q && h.r === r);
    if (!t) return null;
    if (noPOISet && noPOISet.has(keyOf(q, r))) return null;

    // never spawn icons on mountains
    if (isMountainTile(t)) return null;

    const c = scene.hexToPixel(q, r, size);
    const x = c.x + offsetX + ox;
    const y = c.y + offsetY + oy - LIFT * effectiveElevationLocal(t);
    const obj = scene.add
      .text(x, y, char, {
        fontFamily: "Arial",
        fontSize: `${px}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(depth);

    layer.add(obj);
    return obj;
  };

  // Keep ref for tree spacing (for decor scaling)
  const treePxRef = { value: Math.max(14, Math.round(size * 0.55)) };

  for (const t of map) {
    if (!t) continue;

    const isWater = String(t.type || "").toLowerCase() === "water";
    const cx = scene.hexToPixel(t.q, t.r, size).x + offsetX;
    const cy = scene.hexToPixel(t.q, t.r, size).y + offsetY - LIFT * effectiveElevationLocal(t);

    // Mountains: render icon but no POIs/roads/resources etc
    if (!isWater && isMountainTile(t)) {
      const m = addEmoji(t.q, t.r, 0, 0, "⛰️", size * 0.86, 106);
      if (m) {
        m.x = cx;
        m.y = cy;
      }
      continue;
    }

    /* ---------------- Settlement ---------------- */
    if (!isWater && t.hasSettlement) {
      const s = addEmoji(t.q, t.r, 0, 0, "🏠", size * 0.82, 106);
      if (s) {
        s.x = cx;
        s.y = cy;
      }
    }

    /* ---------------- Ruin ---------------- */
    if (!isWater && t.hasRuin) {
      const r = addEmoji(t.q, t.r, 0, 0, "🏛️", size * 0.78, 106);
      if (r) {
        r.x = cx;
        r.y = cy;
      }
    }

    /* ---------------- Crash Site ---------------- */
    if (!isWater && t.hasCrashSite) {
      const cs = addEmoji(t.q, t.r, 0, 0, "💥", size * 0.78, 106);
      if (cs) {
        cs.x = cx;
        cs.y = cy;
      }
    }

    /* ---------------- Vehicle ---------------- */
    if (!isWater && t.hasVehicle) {
      const veh = addEmoji(t.q, t.r, 0, 0, "🚗", size * 0.78, 106);
      if (veh) {
        veh.x = cx;
        veh.y = cy;
      }
    }

    /* ---------------- Ship Wreck ---------------- */
    if (!isWater && t.hasWreck) {
      const wr = addEmoji(t.q, t.r, 0, 0, "⚓", size * 0.78, 106);
      if (wr) {
        wr.x = cx;
        wr.y = cy;
      }
    }

    /* ---------------- Raider camp ---------------- */
    if (!isWater && t.hasRaiderCamp) {
      const rc = addEmoji(t.q, t.r, 0, 0, "☠️", size * 0.8, 106);
      if (rc) {
        rc.x = cx;
        rc.y = cy;
      }
    }

    /* ---------------- Roadside camp ---------------- */
    if (!isWater && t.hasRoadsideCamp) {
      const camp = addEmoji(t.q, t.r, 0, 0, "🏕️", size * 0.78, 106);
      if (camp) {
        camp.x = cx;
        camp.y = cy;
      }
    }

    /* ---------------- Watchtower ---------------- */
    if (!isWater && t.hasWatchtower) {
      const wt = addEmoji(t.q, t.r, 0, 0, "🏰", size * 0.78, 106);
      if (wt) {
        wt.x = cx;
        wt.y = cy;
      }
    }

    /* ---------------- Mine POI ---------------- */
    if (!isWater && t.hasMinePOI) {
      const m = addEmoji(t.q, t.r, 0, 0, "⚒️", size * 0.78, 106);
      if (m) {
        m.x = cx;
        m.y = cy;
      }
    }

    /* ---------------- Shrine ---------------- */
    if (!isWater && t.hasShrine) {
      const sh = addEmoji(t.q, t.r, 0, 0, "⛩️", size * 0.78, 106);
      if (sh) {
        sh.x = cx;
        sh.y = cy;
      }
    }
  }

  // Forests + biome decorations are deterministic, but skip mountains via noPOISet/isMountainTile guard above.
  const noPOISet2 = getNoPOISet(map);
  drawForests(scene, map, size, offsetX, offsetY, LIFT, noPOISet2, treePxRef, addEmoji);
  drawDecorations(scene, addEmoji, map, size, offsetX, offsetY, LIFT, noPOISet2, treePxRef);

  refreshLocationIcons(scene);

  // IMPORTANT:
  // Road lore generation has been removed from MapLocations.
  // It will be produced in LoreGeneration during world history creation,
  // in the correct DF-like sequence.
}

/* ---------------------------------------------------------------
   Forest rendering (3–4 trees per hex, single vegetation type per hex)
   --------------------------------------------------------------- */
function vegetationPaletteFor(biomeName, tileType) {
  const b = String(biomeName || "").toLowerCase();
  const t = String(tileType || "").toLowerCase();

  // desert + volcanic
  if (t.includes("desert") || t.includes("sand") || t.includes("volcan") || t.includes("ash")) {
    return ["🌴", "🌵"]; // pick exactly one for whole hex
  }

  // snow / ice
  if (t.includes("snow") || t.includes("ice") || b.includes("snow") || b.includes("ice")) {
    return ["🌲", "🤍"]; // pick exactly one for whole hex
  }

  // swamp
  if (t.includes("swamp") || b.includes("swamp") || t.includes("marsh")) {
    return ["🌳", "🌱"]; // pick exactly one for whole hex
  }

  // temperate
  return ["🌳", "🌲"]; // 70/30 handled by weighting below
}

function pickVegetationForHex(scene, q, r, biomeName, tileType) {
  const palette = vegetationPaletteFor(biomeName, tileType);
  const rnd = randForHex(scene, q, r, "vegType");

  // If temperate palette, bias 70/30 to 🌳
  if (palette.length === 2 && palette[0] === "🌳" && palette[1] === "🌲") {
    return rnd() < 0.7 ? "🌳" : "🌲";
  }

  // Otherwise choose uniformly between two (but still ONE per hex)
  const idx = Math.floor(rnd() * palette.length);
  return palette[Math.max(0, Math.min(palette.length - 1, idx))];
}

function drawForests(scene, map, size, offsetX, offsetY, LIFT, noPOISet, treePxRef, addEmoji) {
  const treePx = Math.max(14, Math.round(size * 0.55));
  treePxRef.value = treePx;

  for (const t of map) {
    if (!t) continue;

    // no forests on water or mountains
    if (String(t.type || "").toLowerCase() === "water") continue;
    if (isMountainTile(t)) continue;

    const biomeName = resolveBiome(scene, t) || "";
    const tileType = t.type || "";

    // Forest presence is encoded on the tile (seed-based elsewhere).
    // Support multiple legacy fields:
    const isForest =
      t.hasForest === true ||
      t.isForest === true ||
      String(t.groundType || "").toLowerCase() === "forest" ||
      String(t.type || "").toLowerCase() === "forest";

    if (!isForest) continue;

    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const veg = pickVegetationForHex(scene, t.q, t.r, biomeName, tileType);

    // 3–4 trees per hex, deterministic
    const rnd = randForHex(scene, t.q, t.r, "trees");
    const n = 3 + (rnd() < 0.5 ? 0 : 1);

    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = (0.18 + rnd() * 0.22) * size;
      const ox = Math.cos(ang) * rad;
      const oy = Math.sin(ang) * rad;

      const tr = addEmoji(t.q, t.r, ox, oy, veg, treePx, 105);
      if (!tr) continue;
    }
  }
}

/* ---------------------------------------------------------------
   Small biome decorations (clustered within radius 5)
   --------------------------------------------------------------- */
function axialDist(q1, r1, q2, r2) {
  const x1 = q1;
  const z1 = r1;
  const y1 = -x1 - z1;
  const x2 = q2;
  const z2 = r2;
  const y2 = -x2 - z2;
  const dx = Math.abs(x1 - x2);
  const dy = Math.abs(y1 - y2);
  const dz = Math.abs(z1 - z2);
  return Math.max(dx, dy, dz);
}

function decorationEmojiForTile(tile, biomeName) {
  const t = String(tile?.type || "").toLowerCase();
  const b = String(biomeName || "").toLowerCase();

  const isDesert = t.includes("desert") || t.includes("sand") || t.includes("volcan") || t.includes("ash");
  const isSnow = t.includes("snow") || t.includes("ice") || b.includes("snow") || b.includes("ice");

  if (isDesert) return "🐚";
  if (isSnow) return "⛄";

  // any non-desert non-snow: 🍄 or 🌷
  return null;
}

function drawDecorations(scene, addEmoji, map, size, offsetX, offsetY, LIFT, noPOISet, treePxRef) {
  const baseSeed = getSceneSeedString(scene);
  const rnd = mulberry32(hashStr32(`${baseSeed}|decorations`));

  const total = 2 + Math.floor(rnd() * 4); // 2..5
  const candidates = [];

  for (const t of map) {
    if (!t) continue;
    if (String(t.type || "").toLowerCase() === "water") continue;
    if (isMountainTile(t)) continue;
    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const biomeName = resolveBiome(scene, t) || "";
    const dec = decorationEmojiForTile(t, biomeName);
    if (!dec) {
      // non-desert/non-snow: allow 🍄/🌷
      const tt = String(t.type || "").toLowerCase();
      const bb = String(biomeName || "").toLowerCase();
      const isDesert = tt.includes("desert") || tt.includes("sand") || tt.includes("volcan") || tt.includes("ash");
      const isSnow = tt.includes("snow") || tt.includes("ice") || bb.includes("snow") || bb.includes("ice");
      if (isDesert || isSnow) continue;
      candidates.push({ t, biomeName, forced: null });
    } else {
      candidates.push({ t, biomeName, forced: dec });
    }
  }

  if (!candidates.length) return;

  // pick a cluster anchor
  const anchor = candidates[Math.floor(rnd() * candidates.length)]?.t;
  if (!anchor) return;

  // choose decorations clustered within radius 5 of anchor
  const cluster = candidates
    .filter((c) => axialDist(c.t.q, c.t.r, anchor.q, anchor.r) <= 5)
    .slice();

  if (!cluster.length) return;

  // deterministic shuffle
  for (let i = cluster.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cluster[i], cluster[j]] = [cluster[j], cluster[i]];
  }

  const px = Math.max(10, Math.round((treePxRef?.value || Math.round(size * 0.55)) * 0.5));

  let placed = 0;
  for (const c of cluster) {
    if (placed >= total) break;

    const t = c.t;
    const biomeName = c.biomeName;

    let emoji = c.forced;
    if (!emoji) {
      // 🍄 / 🌷 for non-desert/non-snow
      const rr = randForHex(scene, t.q, t.r, "decorChoice");
      emoji = rr() < 0.5 ? "🍄" : "🌷";
    }

    // slight random offset
    const rr2 = randForHex(scene, t.q, t.r, "decorOffset");
    const ang = rr2() * Math.PI * 2;
    const rad = (0.10 + rr2() * 0.18) * size;
    const ox = Math.cos(ang) * rad;
    const oy = Math.sin(ang) * rad;

    const obj = addEmoji(t.q, t.r, ox, oy, emoji, px, 104);
    if (!obj) continue;

    placed += 1;
  }
}

/* ---------------------------------------------------------------
   Refresh icons (used after redraw)
   --------------------------------------------------------------- */
export function refreshLocationIcons(scene) {
  if (!scene) return;

  // no-op placeholder for now; kept for compatibility
  // (previous versions updated interactive bounds, etc)
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
  refreshLocationIcons,
};
