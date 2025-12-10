// src/scenes/WorldSceneMapLocations.js
//
// FULLY DETERMINISTIC version.
// All POIs, roads, forests, mountain icons come only from mapInfo + mapData.
// NO randomness here.

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
   Deterministic neighbor helpers
   --------------------------------------------------------------- */
function neighborsOddR(q, r) {
  const even = r % 2 === 0;
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

function inBounds(q, r, w, h) {
  return q >= 0 && r >= 0 && q < w && r < h;
}

/* ---------------------------------------------------------------
   POI flags (NOOP — deterministic now)
   --------------------------------------------------------------- */
export function applyLocationFlags(mapData) {
  return mapData; // nothing needed
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

  const heuristic = (q, r) =>
    Math.abs(q - goal.q) + Math.abs(r - goal.r);

  while (open.size > 0) {
    // pick smallest f, then lexicographically smallest key
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

    for (const [dq, dr] of neighborsOddR(0, 0)) {
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

/**
 * Generate deterministic road network:
 * - Connects significant POIs (ruins, crash sites, vehicles, wrecks)
 * - Also records connections on scene.roadConnections for lore.
 */
function generateDeterministicRoads(scene, mapData, width, height, mapObjects) {
  const byKey = new Map(mapData.map((t) => [keyOf(t.q, t.r), t]));
  const roadConns = scene.roadConnections || [];
  scene.roadConnections = roadConns;

  // Significant POIs
  const pts = mapObjects.filter((o) => {
    const T = String(o.type || "").toLowerCase();
    return (
      T === "ruin" ||
      T === "crash_site" ||
      T === "vehicle" ||
      T === "wreck"
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

    // Apply roads to tiles
    for (let j = 0; j + 1 < path.length; j++) {
      addRoad(mapData, path[j], path[j + 1]);
    }

    // Record connection for lore (from POI A to POI B)
    roadConns.push({
      from: { q: A.q, r: A.r, type: String(A.type || "").toLowerCase() },
      to:   { q: B.q, r: B.r, type: String(B.type || "").toLowerCase() },
      path: path.map(t => ({ q: t.q, r: t.r })),
    });
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

  const mapObjects =
    scene.mapInfo && Array.isArray(scene.mapInfo.objects)
      ? scene.mapInfo.objects
      : [];

  if (!map.__roadsApplied) {
    generateDeterministicRoads(scene, map, scene.mapWidth, scene.mapHeight, mapObjects);
    Object.defineProperty(map, "__roadsApplied", {
      value: true,
      enumerable: false,
    });
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

  /* ------------------- POI Icons ------------------- */
  const noPOISet = getNoPOISet(map);

  const addEmoji = (x, y, char, px, depth = 42) => {
    const t = scene.add.text(x, y, char, {
      fontSize: `${px}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    });
    t.setOrigin(0.5).setDepth(depth);
    layer.add(t);
    return t;
  };

  for (const t of map) {
    if (t.type === "water") continue;
    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const c = scene.hexToPixel(t.q, t.r, size);
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(t);

    /* ---------------- Mountain icons (FIXED!) ---------------- */
    if (t.type === "mountain" || t.elevation === 7) {
      addEmoji(cx, cy, "⛰️", size * 0.9, 110);
      continue;
    }

    /* ---------------- Forests ---------------- */
    if (t.hasForest) {
      const offsets = [
        [0, -size * 0.25],
        [-size * 0.22, size * 0.1],
        [size * 0.22, size * 0.1],
      ];
      offsets.forEach(([ox, oy]) => {
        addEmoji(cx + ox, cy + oy, "🌳", size * 0.5, 105);
      });
    }

    /* ---------------- Ruins ---------------- */
    if (t.hasRuin) {
      addEmoji(cx, cy, "🏚️", size * 0.8, 106);
      generateRuinLoreForTile(scene, t);
    }

    /* ---------------- Other POIs ---------------- */
    if (t.hasCrashSite) addEmoji(cx, cy, "🚀", size * 0.8, 106);
    if (t.hasVehicle) addEmoji(cx, cy, "🚙", size * 0.8, 106);
  }

  // After POIs / ruins have had their city/faction lore assigned,
  // generate road history entries for the connections we recorded earlier.
  generateRoadLoreForExistingConnections(scene);
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
};
