// src/scenes/WorldSceneGeography.js
//
// Deterministic geography helpers used by WorldSceneMapLocations.js.
// No randomness here. Everything is derived from mapData + worldMeta.
//
// Responsibilities:
//   - Elevation helper (must match WorldSceneMap.js logic).
//   - Detect simple coastline tiles for a visual outline.
//   - Read geoLandmark from HexMap.worldMeta and draw emoji + label.
//   - Optional overlay drawing (currently: coastline ring).
//
// Geo objects (volcano / plateau / glacier / bog / desert) are
// actually CREATED and MUTATING tiles inside HexMap.js
// (applyGeoObject). Here we only VISUALIZE that landmark.

const keyOf = (q, r) => `${q},${r}`;

/* ==========================================
 * Elevation model (must match WorldSceneMap)
 *
 * Game elevation:
 *   elevation: 1–7
 *   1–3 : underwater levels (sea floor)
 *   4   : shoreline / low land (same visual plane as water)
 *   5–7 : raised land steps
 *
 * effectiveElevationLocal(tile) controls how high
 * the hex is visually lifted (for roads, overlays, etc.).
 * - Any tile that is water OR currently covered by water -> 0
 * - Land 4    -> 0
 * - Land 5    -> 1
 * - Land 6    -> 2
 * - Land 7    -> 3
 * ========================================== */
export function effectiveElevationLocal(tile) {
  if (!tile) return 0;

  const lvl = typeof tile.elevation === 'number' ? tile.elevation : 4;
  const covered = !!tile.isCoveredByWater;

  // Any tile that is water or currently has water on top
  if (tile.type === 'water' || covered) return 0;

  // Shoreline (4) sits on the same plane as water.
  if (lvl <= 4) return 0;

  // 5–7 become 1–3 steps.
  return Math.min(3, Math.max(1, lvl - 4));
}

/* ==========================
 * Simple odd-r neighbors
 * ========================== */
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  const dirs = even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
  return dirs.map(([dq, dr]) => [q + dq, r + dr]);
}

function inBounds(q, r, w, h) {
  return q >= 0 && r >= 0 && q < w && r < h;
}

/* ==========================================
 * Biome helpers
 * ========================================== */
export function resolveBiome(scene, map) {
  // Prefer meta attached to the tiles array
  if (map && map.__worldMeta && map.__worldMeta.biome) {
    return map.__worldMeta.biome;
  }
  // Fallback to hexMap.worldMeta
  if (scene && scene.hexMap && scene.hexMap.worldMeta && scene.hexMap.worldMeta.biome) {
    return scene.hexMap.worldMeta.biome;
  }
  return 'Unknown Biome';
}

export function outlineColorFor(biome) {
  const b = (biome || '').toLowerCase();
  if (b.includes('icy'))     return 0x1e88e5; // blue
  if (b.includes('volcan'))  return 0xd32f2f; // red
  if (b.includes('desert'))  return 0xfdd835; // yellow
  if (b.includes('swamp'))   return 0x4e342e; // dark brown
  return 0x43a047; // temperate green
}

/* ==========================================
 * initOrUpdateGeography(scene, map)
 *
 * Precomputes:
 *   - byKey: quick q,r → tile lookup
 *   - coastSet: set of land tiles adjacent to water
 *
 * Geo landmark (emoji + label + q,r) is already stored
 * in worldMeta.geoLandmark by HexMap.applyGeoObject.
 * We do NOT mutate tiles here.
 * ========================================== */
export function initOrUpdateGeography(scene, map) {
  if (!Array.isArray(map) || !map.length) return;

  const width  = scene.mapWidth;
  const height = scene.mapHeight;

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const coastSet = new Set();

  for (const t of map) {
    const isWater = (t.type === 'water') || !!t.isCoveredByWater;
    if (isWater) continue; // only land can be "coast"

    const q = t.q;
    const r = t.r;
    const neigh = neighborsOddR(q, r);

    for (const [nq, nr] of neigh) {
      if (!inBounds(nq, nr, width, height)) continue;
      const nk = keyOf(nq, nr);
      const nt = byKey.get(nk);
      if (!nt) continue;

      const nIsWater = (nt.type === 'water') || !!nt.isCoveredByWater;
      if (nIsWater) {
        coastSet.add(keyOf(q, r));
        break;
      }
    }
  }

  // Cache on scene (non-enumerable)
  Object.defineProperty(scene, '__geoMapByKey', {
    value: byKey,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(scene, '__geoCoastTiles', {
    value: coastSet,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/* ==========================================
 * drawGeographyOverlay(scene)
 *
 * Uses:
 *   - scene.geoOutlineGraphics (created by WorldSceneMapLocations)
 *   - scene.locationsLayer (for emojis + labels)
 *
 * Draws:
 *   - A simple coastline ring around coast tiles.
 *   - One landmark emoji + label for geoLandmark
 *     (spawned deterministically in HexMap.applyGeoObject).
 * ========================================== */
export function drawGeographyOverlay(scene) {
  const map = scene.mapData;
  if (!Array.isArray(map) || !map.length) return;

  const g = scene.geoOutlineGraphics;
  if (!g) return;

  const coastSet = scene.__geoCoastTiles;
  const byKey    = scene.__geoMapByKey;
  if (!coastSet || !byKey) return;

  const size    = scene.hexSize || 24;
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT    = scene?.LIFT_PER_LVL ?? 4;

  // Clear previous overlay
  g.clear();

  const biomeName = resolveBiome(scene, map);
  const coastColor = outlineColorFor(biomeName);

  // -----------------------------
  // Coastline rings
  // -----------------------------
  g.lineStyle(1.5, coastColor, 0.85);

  for (const key of coastSet) {
    const tile = byKey.get(key);
    if (!tile) continue;

    const c  = scene.hexToPixel(tile.q, tile.r, size);
    const eff = effectiveElevationLocal(tile);

    const x = c.x + offsetX;
    const y = c.y + offsetY - eff * LIFT;

    g.strokeCircle(x, y, size * 0.82);
  }

  // -----------------------------
  // Geo landmark emoji + label
  // -----------------------------
  const worldMeta = map.__worldMeta || scene.hexMap?.worldMeta || {};
  const lm = worldMeta.geoLandmark;

  if (!lm || lm.q == null || lm.r == null) return;

  // Only draw once; keep references so we can destroy later if needed
  if (!scene.__geoLandmarkIcon || !scene.__geoLandmarkLabel) {
    const centerTile = byKey.get(keyOf(lm.q, lm.r)) ||
      map.find(t => t.q === lm.q && t.r === lm.r);

    if (!centerTile) return;

    const centerPoint = scene.axialToWorld
      ? scene.axialToWorld(centerTile.q, centerTile.r)
      : (() => {
          const p = scene.hexToPixel(centerTile.q, centerTile.r, size);
          const eff = effectiveElevationLocal(centerTile);
          return {
            x: p.x + offsetX,
            y: p.y + offsetY - eff * LIFT,
          };
        })();

    const emoji = lm.emoji || '🌄';
    const label = lm.label || biomeName || 'Landmark';

    const icon = scene.add.text(centerPoint.x, centerPoint.y, emoji, {
      fontSize: `${Math.max(16, size * 0.95)}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    }).setOrigin(0.5).setDepth(200);

    const txt = scene.add.text(centerPoint.x, centerPoint.y + size * 0.9, label, {
      fontSize: `${Math.max(12, size * 0.55)}px`,
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.35)',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    }).setOrigin(0.5).setDepth(200);

    // Add label to locations layer so it scrolls with the world
    if (scene.locationsLayer) {
      scene.locationsLayer.add(txt);
    }

    Object.defineProperty(scene, '__geoLandmarkIcon', {
      value: icon,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(scene, '__geoLandmarkLabel', {
      value: txt,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

/* ==========================================
 * POI blocking: getNoPOISet(map)
 *
 * For now we don't block POIs anywhere. If you
 * later decide "no POIs inside the landmark
 * footprint", we can store a Set(keyOf(q,r))
 * from HexMap or compute it here.
 * ========================================== */
export function getNoPOISet(map) {
  // No exclusions by default.
  return null;
}

export default {
  effectiveElevationLocal,
  initOrUpdateGeography,
  drawGeographyOverlay,
  getNoPOISet,
  resolveBiome,
  outlineColorFor,
};