// src/scenes/WorldSceneMapLocations.js

/**
 * WorldSceneMapLocations
 * ----------------------
 * This module is responsible for:
 *  - Mutating mapData to add "location flags" (forests, ruins, crash sites, etc.)
 *  - Generating simple road networks (asphalt & countryside)
 *  - Rendering those roads and markers onto the WorldScene using Phaser Graphics
 *
 * Exports:
 *   - applyLocationFlags(mapData, width, height, seed?)
 *   - drawLocationsAndRoads()  // must be called with scene context: drawLocationsAndRoads.call(this)
 *
 * Expected properties/methods on the scene (this):
 *   - this.mapData: Array<{ q:number, r:number, type?:string, elevation?:number, ... }>
 *   - this.mapWidth, this.mapHeight: number
 *   - this.hexSize: number (fallback 24)
 *   - this.seed?: number
 *   - this.hexToPixel(q, r, size): { x:number, y:number }
 *   - this.LIFT_PER_LVL?: number (fallback 12) – used to slightly lift icons by elevation
 */

/* =======================
 * Utilities
 * ======================= */

function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rndInt(rnd, min, max) {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

function chance(rnd, p) {
  return rnd() < p;
}

function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function keyOf(q, r) {
  return `${q},${r}`;
}

function inBounds(q, r, width, height) {
  return q >= 0 && q < width && r >= 0 && r < height;
}

// odd-r offset neighbors
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1, 0],[0, -1],[-1, -1],[-1, 0],[-1, +1],[0, +1]]
    : [[+1, 0],[+1, -1],[0, -1],[-1, 0],[0, +1],[+1, +1]];
}

/* =======================
 * Map mutation (flags & roads)
 * ======================= */

/**
 * Place simple points of interest and biome markers on the map.
 * This function is intentionally conservative: if your tiles already carry
 * semantic types (e.g. type === 'forest'), we respect those first and
 * add only small randomized accents.
 */
function placeLocations(mapData, width, height, rnd) {
  const tilesByKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));

  for (const t of mapData) {
    // Prefer pre-tagged types if your generator created them:
    const type = t.type || '';

    // Forests: if tile says forest, mark it. Otherwise light random sprinkle.
    if (type === 'forest') {
      t.hasForest = true;
    } else if (!t.hasForest && chance(rnd, 0.06)) {
      t.hasForest = true;
    }

    // Ruins: rare, avoid mountains/ocean by simple heuristic on type
    if (!t.hasRuin && type !== 'ocean' && type !== 'mountain' && chance(rnd, 0.01)) {
      t.hasRuin = true;
    }

    // Crash sites: very rare
    if (!t.hasCrashSite && type !== 'ocean' && chance(rnd, 0.006)) {
      t.hasCrashSite = true;
    }

    // Vehicles: sprinkle on plains/desert/roadside vibe
    if (!t.hasVehicle && (type === 'plains' || type === 'desert' || type === '') && chance(rnd, 0.008)) {
      t.hasVehicle = true;
    }

    // Optional: mountain icon on tall non-mountain tiles
    if (!t.hasMountainIcon && type !== 'mountain' && (t.elevation ?? 0) >= 2 && chance(rnd, 0.05)) {
      t.hasMountainIcon = true;
    }
  }

  // Slight clustering: if a tile has a forest, maybe spread to a neighbor (soften salt-and-pepper)
  for (const t of mapData) {
    if (!t.hasForest) continue;
    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const q = t.q + dq, r = t.r + dr;
      if (!inBounds(q, r, width, height)) continue;
      const n = tilesByKey.get(keyOf(q, r));
      if (n && !n.hasForest && chance(rnd, 0.15)) n.hasForest = true;
    }
  }
}

/**
 * Simple road generator:
 *  - Starts a handful of "trunks" across the map horizontally or diagonally.
 *  - Connects a few POIs with countryside roads.
 *  - Annotates tiles with: hasRoad = true, roadType = 'asphalt' | 'countryside'
 */
function generateRoads(mapData, width, height, seed) {
  const rnd = mulberry32((seed >>> 0));
  const tilesByKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));
  const tileAt = (q, r) => tilesByKey.get(keyOf(q, r));

  // Helpers
  const markRoad = (t, type) => {
    if (!t) return;
    t.hasRoad = true;
    // Prefer asphalt if any step says asphalt
    if (type === 'asphalt') {
      t.roadType = 'asphalt';
    } else if (!t.roadType) {
      t.roadType = 'countryside';
    }
  };

  // Major trunks: 2–4 rows that lay asphalt from west to east
  const trunks = rndInt(rnd, 2, 4);
  const chosenRows = new Set();
  while (chosenRows.size < trunks) {
    chosenRows.add(rndInt(rnd, Math.floor(height * 0.2), Math.ceil(height * 0.8)));
  }
  for (const r of chosenRows) {
    for (let q = 0; q < width; q++) {
      const t = tileAt(q, r);
      if (!t) continue;
      // skip oceans if your map has them marked
      if (t.type === 'ocean') continue;
      markRoad(t, 'asphalt');
      // Wiggle into diagonal neighbor so roads look more "hex-like"
      if (chance(rnd, 0.35)) {
        const even = (r % 2 === 0);
        const nq = q + (even ? 0 : 1);
        const nr = r + (chance(rnd, 0.5) ? -1 : +1);
        if (inBounds(nq, nr, width, height)) markRoad(tileAt(nq, nr), 'asphalt');
      }
    }
  }

  // Collect POIs and connect a subset with countryside roads
  const pois = mapData.filter(t => t.hasRuin || t.hasCrashSite || t.hasVehicle);
  shuffleInPlace(pois, rnd);
  const pairs = Math.min(pois.length >> 1, 6);
  for (let i = 0; i < pairs; i++) {
    const a = pois[i * 2];
    const b = pois[i * 2 + 1];
    if (!a || !b) break;

    // Simple greedy walk from a to b
    let { q, r } = a;
    const goal = { q: b.q, r: b.r };
    let guard = width * height * 3;
    while ((q !== goal.q || r !== goal.r) && guard-- > 0) {
      const opts = neighborsOddR(q, r)
        .map(([dq, dr]) => ({ q: q + dq, r: r + dr }))
        .filter(p => inBounds(p.q, p.r, width, height));

      // choose the neighbor that reduces hex-distance (rough heuristic)
      let best = null, bestScore = Infinity;
      for (const p of opts) {
        const dq = goal.q - p.q;
        const dr = goal.r - p.r;
        const score = Math.abs(dq) + Math.abs(dr) + (tileAt(p.q, p.r)?.type === 'ocean' ? 10 : 0);
        if (score < bestScore) { bestScore = score; best = p; }
      }
      if (!best) break;

      // mark current and step as countryside
      markRoad(tileAt(q, r), 'countryside');
      markRoad(tileAt(best.q, best.r), 'countryside');
      q = best.q; r = best.r;
    }
  }
}

/**
 * Public: apply POI flags and build roads once.
 */
export function applyLocationFlags(mapData, width, height, seed = 1337) {
  const rnd = mulberry32(seed >>> 0);
  placeLocations(mapData, width, height, rnd);
  generateRoads(mapData, width, height, seed ^ 0xA5A5A5A5);
  return mapData;
}

/* =======================
 * Rendering (Phaser)
 * ======================= */

/**
 * Public: render roads + icons. Call with the WorldScene as `this`:
 *   drawLocationsAndRoads.call(this)
 */
export function drawLocationsAndRoads() {
  const scene = this; // Phaser.Scene
  const map = this.mapData;
  const size = this.hexSize || 24;

  if (!map || !Array.isArray(map)) return;

  // Ensure flags/roads are applied once
  if (!map.__locationsApplied) {
    try {
      applyLocationFlags(map, this.mapWidth, this.mapHeight, this.seed ?? 1337);
    } catch (_) { /* tolerate double-apply */ }
    Object.defineProperty(map, '__locationsApplied', { value: true, enumerable: false });
  }

  // Cleanup previous layers (hot reload / re-enter)
  if (scene.roadsGraphics) scene.roadsGraphics.destroy();
  if (scene.locationsLayer) scene.locationsLayer.destroy();

  const roads = scene.add.graphics({ x: 0, y: 0 }).setDepth(30);
  const layer = scene.add.container(0, 0).setDepth(40);
  scene.roadsGraphics = roads;
  scene.locationsLayer = layer;

  // Caches & helpers
  const centerCache = new Map();
  const centerOf = (q, r) => {
    const k = keyOf(q, r);
    let p = centerCache.get(k);
    if (!p) {
      const { x, y } = scene.hexToPixel(q, r, size);
      p = { x, y };
      centerCache.set(k, p);
    }
    return p;
  };

  // Build quick lookup for tiles
  const tilesByKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const tileAt = (q, r) => tilesByKey.get(keyOf(q, r));

  /* ----- Draw roads as edges between neighboring road tiles (draw once per edge) ----- */
  for (const t of map) {
    if (!t.hasRoad) continue;
    const p1 = centerOf(t.q, t.r);

    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const q2 = t.q + dq, r2 = t.r + dr;
      // draw each undirected edge once
      if (q2 < t.q || (q2 === t.q && r2 <= t.r)) continue;

      const n = tileAt(q2, r2);
      if (!n || !n.hasRoad) continue;

      const asphalt = (t.roadType === 'asphalt') || (n.roadType === 'asphalt');
      const width = asphalt ? 6 : 3;
      const color = asphalt ? 0x4a4a4a : 0x8b6b39;

      roads.lineStyle(width, color, 0.95);
      roads.beginPath();
      const p2 = centerOf(q2, r2);
      roads.moveTo(p1.x, p1.y);
      roads.lineTo(p2.x, p2.y);
      roads.strokePath();
    }
  }

  /* ----- Icon drawing (vector graphics; no assets required) ----- */
  const icon = (drawFn, x, y, depth = 41) => {
    const g = scene.add.graphics({ x: 0, y: 0 }).setDepth(depth);
    drawFn(g, x, y);
    layer.add(g);
    return g;
  };

  const forestIcon = (g, x, y) => {
    const h = size * 0.65;
    g.fillStyle(0x1f7a1f, 1);
    g.fillTriangle(x, y - h, x - h * 0.5, y, x + h * 0.5, y);
    g.fillStyle(0x5a3a17, 1);
    g.fillRect(x - h * 0.08, y, h * 0.16, h * 0.35);
  };

  const ruinIcon = (g, x, y) => {
    const s = size * 0.45;
    g.lineStyle(3, 0x5a4a3d, 1);
    g.strokeRect(x - s, y - s * 0.8, s * 2, s * 1.2);
    g.lineBetween(x - s, y - s * 0.8, x + s, y + s * 0.4);
    g.lineBetween(x + s, y - s * 0.8, x - s, y + s * 0.4);
  };

  const crashIcon = (g, x, y) => {
    const s = size * 0.5;
    g.lineStyle(4, 0xbb2222, 1);
    g.strokeCircle(x, y, s * 0.5);
    g.lineBetween(x - s, y - s, x + s, y + s);
    g.lineBetween(x - s, y + s, x + s, y - s);
  };

  const vehicleIcon = (g, x, y) => {
    const w = size * 0.9, h = size * 0.45;
    g.fillStyle(0x334455, 1);
    g.fillRoundedRect(x - w * 0.5, y - h * 0.5, w, h, 6);
    g.fillStyle(0x111111, 1);
    g.fillCircle(x - w * 0.25, y + h * 0.5, h * 0.28);
    g.fillCircle(x + w * 0.25, y + h * 0.5, h * 0.28);
  };

  const mountainIcon = (g, x, y) => {
    const s = size * 0.7;
    g.fillStyle(0x777777, 1);
    g.fillTriangle(x - s, y + s * 0.4, x, y - s * 0.8, x + s, y + s * 0.4);
    g.fillStyle(0xdddddd, 1);
    g.fillTriangle(x - s * 0.25, y, x, y - s * 0.55, x + s * 0.25, y);
  };

  const liftPerLvl = this?.LIFT_PER_LVL ?? 12;

  for (const t of map) {
    const p = centerOf(t.q, t.r);
    const y = p.y - ((t.elevation ?? 0) * liftPerLvl);

    if (t.hasForest)      icon(forestIcon,   p.x, y);
    if (t.hasRuin)        icon(ruinIcon,     p.x, y);
    if (t.hasCrashSite)   icon(crashIcon,    p.x, y);
    if (t.hasVehicle)     icon(vehicleIcon,  p.x, y);
    if (t.hasMountainIcon && t.type !== 'mountain')
                          icon(mountainIcon, p.x, y);
  }
}

// (Optional) default export if your bundler expects it
export default {
  applyLocationFlags,
  drawLocationsAndRoads,
};
