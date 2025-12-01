// src/scenes/WorldSceneMapLocations.js
//
// FULLY DETERMINISTIC version.
// Everything must match across ALL clients that share the same seed.
// All POIs, roads, forests, and icons come ONLY from mapInfo generated in HexMap.js.
//
// NO randomness remains. No Phaser.Math.Between. No mulberry32 RNG here.
// All tile flags (hasForest, hasRuin, etc.) come from HexMap.js.
// All POI objects come from mapInfo.objects.

import {
  effectiveElevationLocal,
  initOrUpdateGeography,
  drawGeographyOverlay,
  getNoPOISet,
  resolveBiome,
} from './WorldSceneGeography.js';

const keyOf = (q, r) => `${q},${r}`;

/* ==========================
   Deterministic neighbors
   ========================== */
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

function inBounds(q, r, w, h) {
  return q >= 0 && r >= 0 && q < w && r < h;
}

/* ============================================================================
   POIs + Forest Flags Binding
   ============================================================================

   IMPORTANT:
   - NO randomness here.
   - mapInfo.objects already contains deterministic POIs (fish, ruins, crash sites, vehicles, etc.)
   - mapData tiles have flags pre-set by HexMap.js (hasForest, hasRuin, hasCrashSite, etc.)
   ============================================================================ */

export function applyLocationFlags(mapData, width, height, seed) {
  // Nothing to do. All POIs are now seed-generated in HexMap.js.
  // This function is retained only for compatibility.
  return mapData;
}

/* ============================================================================
   Deterministic Road Generation
   ============================================================================

   Roads now work as follows:
   - For every pair of POIs of significance (ruin, crash site, vehicle):
   - Connect POIs in sorted order.
   - Use deterministic A* (no random tie breaks).
   ============================================================================ */

function deterministicAStar(byKey, width, height, start, goal) {
  const startK = keyOf(start.q, start.r);
  const goalK  = keyOf(goal.q, goal.r);

  const open = new Map([[startK, {
    k: startK, q: start.q, r: start.r,
    g: 0,
    f: 0,
    parent: null
  }]]);

  const closed = new Set();

  const heuristic = (q, r) =>
    Math.abs(q - goal.q) + Math.abs(r - goal.r);

  while (open.size > 0) {
    // deterministic: choose smallest f, then lexicographically smallest key
    let cur = null;
    for (const n of open.values()) {
      if (!cur ||
          n.f < cur.f ||
          (n.f === cur.f && n.k < cur.k)) {
        cur = n;
      }
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
          parent: cur
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

function generateDeterministicRoads(mapData, width, height, mapObjects) {
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));

  // Extract POIs that logically should be connected
  const significantPOIs = mapObjects.filter(o => {
    const T = String(o.type || "").toLowerCase();
    return (
      T === "ruin" ||
      T === "crash_site" ||
      T === "vehicle_wreck" ||
      T === "wreck" ||
      T === "ancient_site"
    );
  });

  // Sort by q,r for deterministic order
  significantPOIs.sort((a, b) => a.q - b.q || a.r - b.r);

  // Connect each POI to the next one
  for (let i = 0; i + 1 < significantPOIs.length; i++) {
    const A = significantPOIs[i];
    const B = significantPOIs[i + 1];
    const tileA = byKey.get(keyOf(A.q, A.r));
    const tileB = byKey.get(keyOf(B.q, B.r));
    if (!tileA || !tileB) continue;

    const path = deterministicAStar(byKey, width, height, tileA, tileB);
    if (!path || path.length < 2) continue;

    for (let j = 0; j + 1 < path.length; j++) {
      addRoad(mapData, path[j], path[j + 1]);
    }
  }
}

/* ============================================================================
   Rendering: Roads + POIs + Geography outlines
   ============================================================================ */

export function drawLocationsAndRoads() {
  const scene = this;
  const map = this.mapData;
  const size = this.hexSize || 24;

  if (!Array.isArray(map) || !map.length) return;

  // Retrieve deterministic objects (created in HexMap.js)
  const mapObjects = (scene.mapInfo && Array.isArray(scene.mapInfo.objects))
    ? scene.mapInfo.objects
    : [];

  // Apply road generation ONCE per world
  if (!map.__roadsApplied) {
    generateDeterministicRoads(map, scene.mapWidth, scene.mapHeight, mapObjects);
    Object.defineProperty(map, "__roadsApplied", { value: true, enumerable: false });
  }

  // Rebuild geography + layers
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

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));

  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT    = scene?.LIFT_PER_LVL ?? 4;

  /* -------------------------- Draw roads -------------------------- */
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

      roads.lineStyle(4, 0x6b5430, 0.9); // deterministic countryside style
      roads.beginPath();
      roads.moveTo(c1.x + offsetX, y1 + offsetY);
      roads.lineTo(c2.x + offsetX, y2 + offsetY);
      roads.strokePath();
    }
  }

  /* -------------------- Geography overlays ----------------------- */
  drawGeographyOverlay(scene);

  /* ----------------------- POI icons ----------------------------- */
  const biomeName = resolveBiome(scene, map);
  const noPOISet = getNoPOISet(map);

  const addEmoji = (x, y, char, px, depth = 42) => {
    const t = scene.add.text(x, y, char, {
      fontSize: `${px}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    }).setOrigin(0.5).setDepth(depth);
    layer.add(t);
    return t;
  };

  for (const t of map) {
    if (t.type === "water") continue;
    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const c = scene.hexToPixel(t.q, t.r, size);
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(t);

    // Mountain
    if (t.elevation === 4) {
      addEmoji(cx, cy, "⛰️", size * 0.9, 110);
      continue;
    }

    // Forest
    if (t.hasForest) {
      // Deterministic fixed tree triplet pattern
      const offsets = [
        [0, -size * 0.25],
        [-size * 0.22, size * 0.1],
        [size * 0.22, size * 0.1]
      ];
      offsets.forEach(([ox, oy]) => {
        addEmoji(cx + ox, cy + oy, "🌳", size * 0.5, 105);
      });
    }

    if (t.hasRuin)      addEmoji(cx, cy, "🏚️", size * 0.8, 106);
    if (t.hasCrashSite) addEmoji(cx, cy, "🚀", size * 0.8, 106);
    if (t.hasVehicle)   addEmoji(cx, cy, "🚙", size * 0.8, 106);
  }
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads
};
