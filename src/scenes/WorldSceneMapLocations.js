// src/scenes/WorldSceneMapLocations.js
//
// FULLY DETERMINISTIC version.
// All POIs, roads, forests, mountain icons come only from mapInfo + mapData.
// NO randomness here.
//
// Forest rendering (improved):
// - Seed-based per-hex RNG (stable across redraw/order)
// - 3–4 tree emoji per forest hex
// - On a single hex, ONLY ONE vegetation type is used (e.g. either 🌴 OR 🌵)
// - Biome palettes updated per your spec
// - No sway animation
//
// Added small biome decorations (deterministic):
// - 2–5 total decorations across the whole map, seeded
// - Each decoration is 1 per hex, size = 50% of tree size
// - Decorations are clustered within radius 5 of an anchor (not scattered)
// - 🍄 and 🌷 on any biome except desert and snow
// - ⛄ on snow biome
// - 🐚 on desert biome
//
// FIXES (requested):
// - Roads / POIs must NOT appear on mountain hexes.
// - Mountain icons still render for mountains.
//
// NEW (UI FIX):
// - POI/Geo icons now render with a "badge" background and border,
//   similar to buildings UI: diamond badge for POI/Geo.
// - Badge fill color depends on `ownedByPlayer` (neutral = gray).
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
   Owner color helpers (6 colors: 4 players + 2 AI), neutral gray
   --------------------------------------------------------------- */
const DEFAULT_OWNER_COLORS = {
  0: 0xff3b30, // P0 red
  1: 0x34c759, // P1 green
  2: 0x0a84ff, // P2 blue
  3: 0xffcc00, // P3 yellow
  ai0: 0xaf52de, // AI0 purple
  ai1: 0x5e5ce6, // AI1 indigo
};
const NEUTRAL_GRAY = 0x9aa0a6;
const BADGE_BORDER = 0x0b1d2a;

function getOwnedByPlayerFromTile(tile) {
  // tolerate different representations:
  // - number 0..3 for players
  // - "ai0"/"ai1"
  // - string "0"/"1"
  if (!tile) return null;
  const v =
    tile.ownedByPlayer ??
    tile.ownedBy ??
    tile.ownerId ??
    tile.owner ??
    null;

  if (v === null || v === undefined) return null;

  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    if (s === "ai0" || s === "ai1") return s;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return s;
  }
  return null;
}

function getOwnerColor(scene, ownerId) {
  // if scene provides a color helper, use it
  try {
    if (scene && typeof scene.getOwnerColor === "function") {
      const c = scene.getOwnerColor(ownerId);
      if (Number.isFinite(c)) return c;
    }
  } catch (_) {}

  // if scene has a palette
  const pal =
    scene?.ownerColors ||
    scene?.playerColors ||
    scene?.colorsByOwner ||
    null;

  if (pal) {
    if (Array.isArray(pal) && typeof ownerId === "number" && pal[ownerId] != null) {
      return pal[ownerId];
    }
    if (typeof pal === "object" && pal[ownerId] != null) {
      return pal[ownerId];
    }
  }

  // fallback
  if (ownerId == null) return NEUTRAL_GRAY;
  if (DEFAULT_OWNER_COLORS[ownerId] != null) return DEFAULT_OWNER_COLORS[ownerId];
  if (typeof ownerId === "number" && DEFAULT_OWNER_COLORS[ownerId] != null) return DEFAULT_OWNER_COLORS[ownerId];
  return NEUTRAL_GRAY;
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
   POI flags: now driven by mapInfo.objects (seed -> lore -> POI)
   --------------------------------------------------------------- */
export function applyLocationFlags(mapData, mapObjects) {
  if (!Array.isArray(mapData)) return mapData;

  const objs = Array.isArray(mapObjects) ? mapObjects : [];
  if (!objs.length) {
    // Nothing to apply – ensure flags exist
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

      if (typeof t.settlementName !== "string") t.settlementName = t.settlementName || "";
      if (typeof t.poiName !== "string") t.poiName = t.poiName || "";
      if (typeof t.owningFaction !== "string") t.owningFaction = t.owningFaction || "";
    }
    return mapData;
  }

  const byKey = new Map(mapData.map((t) => [keyOf(t.q, t.r), t]));

  // Reset all POI flags
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

  // Apply from objects
  for (const o of objs) {
    if (!o) continue;
    const q = o.q;
    const r = o.r;
    if (typeof q !== "number" || typeof r !== "number") continue;

    const t = byKey.get(keyOf(q, r));
    if (!t) continue;

    // POIs must NOT spawn on mountains
    if (isMountainTile(t)) continue;

    const type = String(o.type || "").toLowerCase();

    if (type === "ruin") {
      t.hasRuin = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "crash_site") {
      t.hasCrashSite = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "vehicle") {
      t.hasVehicle = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "wreck") {
      t.hasWreck = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "settlement") {
      t.hasSettlement = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.settlementName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "raider_camp") {
      t.hasRaiderCamp = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "roadside_camp") {
      t.hasRoadsideCamp = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "watchtower") {
      t.hasWatchtower = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "mine") {
      t.hasMinePOI = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    } else if (type === "shrine") {
      t.hasShrine = true;
      t.hasObject = true;
      if (o.name && typeof o.name === "string") t.poiName = o.name;
      if (o.faction && typeof o.faction === "string") t.owningFaction = o.faction;
      if (o.ownedByPlayer != null) t.ownedByPlayer = o.ownedByPlayer;
    }
  }

  return mapData;
}

/* ---------------------------------------------------------------
   Rendering: Roads + POIs + Geography
   --------------------------------------------------------------- */
export function \1
  // ---------------------------------------------------------------------------
  // PNG diamond badges (POI / resources)
  // - Neutral gray by default
  // - Tint updates to last player who stepped on the hex
  // ---------------------------------------------------------------------------
  const RES_NEUTRAL_GRAY = 0x9aa0a6;
  const ROMB_KEY = "rombFrameForObjects";
  const ROMB_URL = "src/assets/sprites/RombFrameForObjects.png";

  // Persistent per-hex claim tint: key "q,r" -> owner slot (number or string) or null
  scene._diamondClaimByHex = scene._diamondClaimByHex || new Map();

  const ensureRombTexture = () => {
    if (scene.textures && scene.textures.exists(ROMB_KEY)) return true;

    // Queue load once, use string URL to avoid MIME module errors
    if (!scene._rombFrameQueued && scene.load && typeof scene.load.image === "function") {
      scene._rombFrameQueued = true;
      scene.load.image(ROMB_KEY, ROMB_URL);

      scene.load.once("complete", () => {
        scene.events.emit("rombFrameForObjectsLoaded");
      });

      if (typeof scene.load.start === "function") scene.load.start();
    }
    return false;
  };

  // Update claim/tint each frame after movement resolves
  if (!scene._rombClaimPostUpdateHooked) {
    scene._rombClaimPostUpdateHooked = true;
    scene.events.on("postupdate", () => {
      const players = scene.players || [];
      const allUnits = []
        .concat(scene.units || [])
        .concat(players)
        .concat(scene.enemies || [])
        .concat(scene.haulers || []);

      for (const u of allUnits) {
        if (!u || u.isDead) continue;
        const q = u.q, r = u.r;
        if (!Number.isFinite(q) || !Number.isFinite(r)) continue;

        // Determine owner slot color (prefer numeric playerIndex if present)
        const ownerSlot =
          (typeof u.playerIndex === "number" ? u.playerIndex :
           (typeof u.ownerSlot === "number" ? u.ownerSlot :
            (typeof u.ownerKey === "number" ? u.ownerKey :
             (typeof u.owner === "number" ? u.owner : null))));

        // Only players (numeric slots) claim; ignore enemies/neutral unless you want them too
        if (typeof ownerSlot === "number") {
          scene._diamondClaimByHex.set(`${q},${r}`, ownerSlot);
        }
      }
    });
  }
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

  applyLocationFlags(map, mapObjects);

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

  /* ------------------- Roads (render only) ------------------- */
  for (const t of map) {
    if (!t) continue;
    if (!t.hasRoad) continue;
    if (!(t.roadLinks instanceof Set)) continue;

    // never draw road on mountains
    if (isMountainTile(t)) continue;

    const c1 = scene.hexToPixel(t.q, t.r, size);
    const y1 = c1.y - LIFT * effectiveElevationLocal(t);

    for (const target of t.roadLinks) {
      if (target <= keyOf(t.q, t.r)) continue;
      const n = byKey.get(target);
      if (!n) continue;
      if (isMountainTile(n)) continue;

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

  /* ------------------- Badge helpers ------------------- */
  const noPOISet = getNoPOISet(map);

  const makeDiamondBadge = (x, y, _fillColorIgnored, px, depth, tileRef) => {
  const badge = scene.add.container(x, y).setDepth(depth);

  // size: px is icon font-size; diamond surrounds it
  const half = Math.max(14, Math.round(px * 0.95));
  const size = half * 2;

  const hasTex = ensureRombTexture();

  const bg = scene.add.image(0, 0, ROMB_KEY).setOrigin(0.5);
  // Keep square format (avoid stretching)
  bg.setDisplaySize(size, size);

  // Start neutral gray; recolor when a player steps on it
  bg.setTint(RES_NEUTRAL_GRAY ?? 0x9aa0a6);

  badge.add(bg);

  // keep references for updater
  badge._bg = bg;
  badge._tile = tileRef;
  scene._rombBadges.push(badge);

  // If texture wasn't loaded yet, swap once loaded (keeps icon ordering intact)
  if (!hasTex) {
    scene.events.once("rombFrameLoaded", () => {
      if (!badge.scene) return;
      if (!(scene.textures && scene.textures.exists(ROMB_KEY))) return;
      // refresh texture binding
      bg.setTexture(ROMB_KEY);
    });
  }

  return badge;
};


  const addBadgeEmoji = (q, r, ox, oy, char, px, depth = 106, opts = null) => {
    const t = scene.mapData.find((h) => h.q === q && h.r === r);
    if (!t) return null;
    if (noPOISet && noPOISet.has(keyOf(q, r))) return null;

    const allowOnMountains = !!(opts && opts.allowOnMountains);
    if (!allowOnMountains && isMountainTile(t)) return null;

    const c = scene.hexToPixel(q, r, size);
    const x = c.x + offsetX + ox;
    const y = c.y + offsetY + oy - LIFT * effectiveElevationLocal(t);

    const ownerId = getOwnedByPlayerFromTile(t);
    const fill = getOwnerColor(scene, ownerId);

    const badge = makeDiamondBadge(x, y, fill, px, depth);

    const icon = scene.add
      .text(0, 0, char, {
        fontFamily: "Arial",
        fontSize: `${Math.max(12, Math.round(px * 0.72))}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    badge.add(icon);
    layer.add(badge);

    // store for future updates (claiming tiles etc)
    scene.mapBadges = scene.mapBadges || [];
    scene.mapBadges.push({ kind: "poi", q, r, badge, icon, char });

    return badge;
  };


  /* ------------------- POI/Geo icons + Mountains ------------------- */
  // Keep ref for tree spacing (for decor scaling)
  const treePxRef = { value: Math.max(14, Math.round(size * 0.55)) };

  for (const t of map) {
    if (!t) continue;

    const isWater = String(t.type || "").toLowerCase() === "water";

    // Mountains: show as Geo badge (allowed on mountains)
    if (!isWater && isMountainTile(t)) {
      addBadgeEmoji(t.q, t.r, 0, 0, "⛰️", size * 0.92, 110, { allowOnMountains: true });
      continue;
    }

    // Settlement
    if (!isWater && t.hasSettlement) {
      addBadgeEmoji(t.q, t.r, 0, 0, "🏠", size * 0.92, 110);
    }

    // Ruin
    if (!isWater && t.hasRuin) {
      addBadgeEmoji(t.q, t.r, 0, 0, "🏛️", size * 0.92, 110);
    }

    // Crash Site
    if (!isWater && t.hasCrashSite) {
      addBadgeEmoji(t.q, t.r, 0, 0, "💥", size * 0.92, 110);
    }

    // Vehicle
    if (!isWater && t.hasVehicle) {
      addBadgeEmoji(t.q, t.r, 0, 0, "🚗", size * 0.92, 110);
    }

    // Ship Wreck (can be on water too)
    if (t.hasWreck) {
      addBadgeEmoji(t.q, t.r, 0, 0, "⚓", size * 0.92, 110);
    }

    // Raider camp
    if (!isWater && t.hasRaiderCamp) {
      addBadgeEmoji(t.q, t.r, 0, 0, "☠️", size * 0.92, 110);
    }

    // Roadside camp
    if (!isWater && t.hasRoadsideCamp) {
      addBadgeEmoji(t.q, t.r, 0, 0, "🏕️", size * 0.92, 110);
    }

    // Watchtower
    if (!isWater && t.hasWatchtower) {
      addBadgeEmoji(t.q, t.r, 0, 0, "🏰", size * 0.92, 110);
    }

    // Mine POI
    if (!isWater && t.hasMinePOI) {
      addBadgeEmoji(t.q, t.r, 0, 0, "⚒️", size * 0.92, 110);
    }

    // Shrine
    if (!isWater && t.hasShrine) {
      addBadgeEmoji(t.q, t.r, 0, 0, "⛩️", size * 0.92, 110);
    }
  }

  // Forests + decorations (keep emoji-only)
  const noPOISet2 = getNoPOISet(map);
  drawForests(scene, map, size, offsetX, offsetY, LIFT, noPOISet2, treePxRef, addBadgeEmoji /* not used for trees */);
  drawDecorations(scene, addBadgeEmoji, map, size, offsetX, offsetY, LIFT, noPOISet2, treePxRef);

  refreshLocationIcons(scene);
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

function drawForests(scene, map, size, offsetX, offsetY, LIFT, noPOISet, treePxRef, _addBadgeEmoji) {
  const treePx = Math.max(14, Math.round(size * 0.55));
  treePxRef.value = treePx;

  for (const t of map) {
    if (!t) continue;

    // no forests on water or mountains
    if (String(t.type || "").toLowerCase() === "water") continue;
    if (isMountainTile(t)) continue;

    const biomeName = resolveBiome(scene, t) || "";
    const tileType = t.type || "";

    const isForest =
      t.hasForest === true ||
      t.isForest === true ||
      String(t.groundType || "").toLowerCase() === "forest" ||
      String(t.type || "").toLowerCase() === "forest";

    if (!isForest) continue;

    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const veg = pickVegetationForHex(scene, t.q, t.r, biomeName, tileType);
    const rnd = randForHex(scene, t.q, t.r, "trees");
    const n = 3 + (rnd() < 0.5 ? 0 : 1);

    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = (0.18 + rnd() * 0.22) * size;
      const ox = Math.cos(ang) * rad;
      const oy = Math.sin(ang) * rad;

      const c = scene.hexToPixel(t.q, t.r, size);
      const x = c.x + offsetX + ox;
      const y = c.y + offsetY + oy - LIFT * effectiveElevationLocal(t);

      const obj = scene.add
        .text(x, y, veg, {
          fontFamily: "Arial",
          fontSize: `${treePx}px`,
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setDepth(105);

      scene.locationsLayer.add(obj);
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
  return null; // non-desert non-snow: 🍄 or 🌷
}

function drawDecorations(scene, addBadgeEmoji, map, size, offsetX, offsetY, LIFT, noPOISet, treePxRef) {
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
      // allow 🍄/🌷 (exclude desert/snow)
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

  const anchor = candidates[Math.floor(rnd() * candidates.length)]?.t;
  if (!anchor) return;

  const cluster = candidates
    .filter((c) => axialDist(c.t.q, c.t.r, anchor.q, anchor.r) <= 5)
    .slice();

  if (!cluster.length) return;

  for (let i = cluster.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cluster[i], cluster[j]] = [cluster[j], cluster[i]];
  }

  const px = Math.max(10, Math.round((treePxRef?.value || Math.round(size * 0.55)) * 0.5));

  let placed = 0;
  for (const c of cluster) {
    if (placed >= total) break;

    const t = c.t;

    let emoji = c.forced;
    if (!emoji) {
      const rr = randForHex(scene, t.q, t.r, "decorChoice");
      emoji = rr() < 0.5 ? "🍄" : "🌷";
    }

    const rr2 = randForHex(scene, t.q, t.r, "decorOffset");
    const ang = rr2() * Math.PI * 2;
    const rad = (0.10 + rr2() * 0.18) * size;
    const ox = Math.cos(ang) * rad;
    const oy = Math.sin(ang) * rad;

    // decorations are just small emoji (no badge)
    const cxy = scene.hexToPixel(t.q, t.r, size);
    const x = cxy.x + offsetX + ox;
    const y = cxy.y + offsetY + oy - LIFT * effectiveElevationLocal(t);

    const obj = scene.add
      .text(x, y, emoji, {
        fontFamily: "Arial",
        fontSize: `${px}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(104);

    scene.locationsLayer.add(obj);
    placed += 1;
  }
}

/* ---------------------------------------------------------------
   Refresh icons (kept for compatibility)
   --------------------------------------------------------------- */
export function refreshLocationIcons(scene) {
  if (!scene) return;
  // placeholder; kept for older code paths
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
  refreshLocationIcons,
};
