// src/scenes/WorldSceneMapLocations.js
// Spawns POIs and renders them (as EMOJIS) + draws roads (vector).
// Guarantees: no POI on water tiles. Placement aligns with isometric lift.

function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rndInt = (rnd, min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (rnd, p) => rnd() < p;
const keyOf = (q, r) => `${q},${r}`;
const inBounds = (q, r, w, h) => q >= 0 && q < w && r >= 0 && r < h;

// axial odd-r neighbors
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

/* ======================
   SPAWNING (stable-like)
   ====================== */
// NOTE: never place anything on water.
function placeLocations(mapData, width, height, rnd) {
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));

  for (const t of mapData) {
    const type = t.type || '';
    const isWater = type === 'water';
    if (isWater) {
      // explicitly clear any stale flags on water (if present from older runs)
      t.hasForest = false;
      t.hasRuin = false;
      t.hasCrashSite = false;
      t.hasVehicle = false;
      t.hasMountainIcon = false;
      continue;
    }

    // Forests: respect pre-tagged “forest” tiles; otherwise light sprinkle
    if (type === 'forest') {
      t.hasForest = true;
    } else if (!t.hasForest && chance(rnd, 0.06)) {
      t.hasForest = true;
    }

    // Ruins: rare, avoid mountains
    if (!t.hasRuin && type !== 'mountain' && chance(rnd, 0.010)) {
      t.hasRuin = true;
    }

    // Crash sites: very rare
    if (!t.hasCrashSite && chance(rnd, 0.006)) {
      t.hasCrashSite = true;
    }

    // Vehicles: sprinkle on neutral-ish ground
    if (!t.hasVehicle && (type === 'plains' || type === 'desert' || type === 'grassland' || type === '') && chance(rnd, 0.008)) {
      t.hasVehicle = true;
    }

    // Optional mountain icon on tall non-mountain tiles
    if (!t.hasMountainIcon && type !== 'mountain' && (t.elevation ?? 0) >= 2 && chance(rnd, 0.05)) {
      t.hasMountainIcon = true;
    }
  }

  // Forest clustering: spread softly to neighbors, still avoiding water
  for (const t of mapData) {
    if (!t.hasForest) continue;
    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const q = t.q + dq, r = t.r + dr;
      if (!inBounds(q, r, width, height)) continue;
      const n = byKey.get(keyOf(q, r));
      if (!n || n.type === 'water') continue;
      // per-tile seed for deterministic spread look
      const localRnd = mulberry32((t.q * 73856093) ^ (t.r * 19349663));
      if (!n.hasForest && chance(localRnd, 0.15)) n.hasForest = true;
    }
  }
}

function generateRoads(mapData, width, height, seed) {
  const rnd = mulberry32(seed >>> 0);
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));
  const at = (q, r) => byKey.get(keyOf(q, r));
  const markRoad = (t, type) => {
    if (!t || t.type === 'water') return; // no roads on water
    t.hasRoad = true;
    if (type === 'asphalt') t.roadType = 'asphalt';
    else if (!t.roadType) t.roadType = 'countryside';
  };

  // Asphalt “trunks” along a few rows (skip water)
  const trunks = rndInt(rnd, 2, 4);
  const chosenRows = new Set();
  while (chosenRows.size < trunks) {
    chosenRows.add(rndInt(rnd, Math.floor(height * 0.2), Math.ceil(height * 0.8)));
  }
  for (const r of chosenRows) {
    for (let q = 0; q < width; q++) {
      const t = at(q, r);
      if (!t || t.type === 'water') continue;
      markRoad(t, 'asphalt');
      if (rnd() < 0.35) {
        const even = (r % 2 === 0);
        const nq = q + (even ? 0 : 1);
        const nr = r + (rnd() < 0.5 ? -1 : +1);
        if (inBounds(nq, nr, width, height)) markRoad(at(nq, nr), 'asphalt');
      }
    }
  }

  // Countryside links between a few POIs (avoid water)
  const pois = mapData.filter(t => t.type !== 'water' && (t.hasRuin || t.hasCrashSite || t.hasVehicle));
  for (let i = 0; i + 1 < Math.min(pois.length, 12); i += 2) {
    const a = pois[i], b = pois[i + 1];
    if (!a || !b) break;
    let { q, r } = a;
    const goal = { q: b.q, r: b.r };
    let guard = width * height * 3;

    while ((q !== goal.q || r !== goal.r) && guard-- > 0) {
      const opts = neighborsOddR(q, r)
        .map(([dq, dr]) => ({ q: q + dq, r: r + dr }))
        .filter(p => inBounds(p.q, p.r, width, height) && at(p.q, p.r)?.type !== 'water');

      if (!opts.length) break;

      // Greedy closer step
      let best = null, bestScore = Infinity;
      for (const p of opts) {
        const dq = goal.q - p.q, dr = goal.r - p.r;
        const score = Math.abs(dq) + Math.abs(dr);
        if (score < bestScore) { bestScore = score; best = p; }
      }
      if (!best) break;
      markRoad(at(q, r), 'countryside');
      markRoad(at(best.q, best.r), 'countryside');
      q = best.q; r = best.r;
    }
  }
}

export function applyLocationFlags(mapData, width, height, seed = 1337) {
  const rnd = mulberry32(seed >>> 0);
  placeLocations(mapData, width, height, rnd);
  generateRoads(mapData, width, height, seed ^ 0xA5A5A5A5);
  return mapData;
}

/* ======================
   RENDERING
   ====================== */

function effectiveElevationLocal(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}

export function drawLocationsAndRoads() {
  const scene = this;
  const map = this.mapData;
  const size = this.hexSize || 24;
  if (!Array.isArray(map) || !map.length) return;

  // Ensure flags/roads applied once
  if (!map.__locationsApplied) {
    try { applyLocationFlags(map, this.mapWidth, this.mapHeight, this.seed ?? 1337); } catch {}
    Object.defineProperty(map, '__locationsApplied', { value: true, enumerable: false });
  }

  // Clean old layers
  if (scene.roadsGraphics) scene.roadsGraphics.destroy();
  if (scene.locationsLayer) scene.locationsLayer.destroy();
  const roads = scene.add.graphics({ x: 0, y: 0 }).setDepth(30);
  const layer = scene.add.container(0, 0).setDepth(40);
  scene.roadsGraphics = roads;
  scene.locationsLayer = layer;

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const at = (q, r) => byKey.get(keyOf(q, r));
  const centerCache = new Map();
  const centerOf = (q, r) => {
    const k = keyOf(q, r);
    let p = centerCache.get(k);
    if (!p) { p = scene.hexToPixel(q, r, size); centerCache.set(k, p); }
    return p;
  };

  const offsetX = this.mapOffsetX || 0;
  const offsetY = this.mapOffsetY || 0;
  const LIFT = this?.LIFT_PER_LVL ?? 4;

  // ---- Roads (vector) ----
  for (const t of map) {
    if (!t.hasRoad) continue;
    const eff1 = effectiveElevationLocal(t);
    const p1 = centerOf(t.q, t.r);
    const x1 = p1.x + offsetX;
    const y1 = p1.y + offsetY - LIFT * eff1;

    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const q2 = t.q + dq, r2 = t.r + dr;
      // draw each undirected edge once
      if (q2 < t.q || (q2 === t.q && r2 <= t.r)) continue;
      const n = at(q2, r2);
      if (!n || !n.hasRoad) continue;

      const eff2 = effectiveElevationLocal(n);
      const p2 = centerOf(q2, r2);
      const x2 = p2.x + offsetX;
      const y2 = p2.y + offsetY - LIFT * eff2;

      const asphalt = (t.roadType === 'asphalt') || (n.roadType === 'asphalt');
      const width = asphalt ? 6 : 3;
      const color = asphalt ? 0x4a4a4a : 0x8b6b39;

      roads.lineStyle(width, color, 0.95);
      roads.beginPath();
      roads.moveTo(x1, y1);
      roads.lineTo(x2, y2);
      roads.strokePath();
    }
  }

  // ---- Locations (emojis; never on water) ----
  const addEmoji = (x, y, char, fontPx, depth = 42) => {
    const t = scene.add.text(x, y, char, {
      fontSize: `${fontPx}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    }).setOrigin(0.5).setDepth(depth);
    layer.add(t);
    return t;
  };

  for (const t of map) {
    if (t.type === 'water') continue; // safety
    const base = centerOf(t.q, t.r);
    const eff = effectiveElevationLocal(t);
    const cx = base.x + offsetX;
    const cy = base.y + offsetY - LIFT * eff;

    // 🌲 clustered trees (stable behavior)
    if (t.hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;
      while (placed.length < treeCount && attempts < 40) {
        attempts++;
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const radius = Phaser.Math.FloatBetween(size * 0.35, size * 0.65);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const posX = cx + dx, posY = cy + dy;
        const minDist = size * 0.3;
        const tooClose = placed.some(p => Phaser.Math.Distance.Between(posX, posY, p.x, p.y) < minDist);
        if (!tooClose) {
          const fontPx = size * (0.45 + Phaser.Math.FloatBetween(-0.05, 0.05));
          const tree = addEmoji(posX, posY, '🌲', fontPx, 43);
          scene.tweens.add({
            targets: tree,
            angle: { from: -1.5, to: 1.5 },
            duration: Phaser.Math.Between(2500, 4000),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Phaser.Math.Between(0, 1000)
          });
          placed.push({ x: posX, y: posY });
        }
      }
    }

    if (t.hasRuin)        addEmoji(cx, cy, '🏚️', size * 0.8);
    if (t.hasCrashSite)   addEmoji(cx, cy, '🚀', size * 0.8);
    if (t.hasVehicle)     addEmoji(cx, cy, '🚙', size * 0.8);
    if (t.hasMountainIcon && t.type !== 'mountain')
                          addEmoji(cx, cy, '🏔️', size * 0.9);
  }
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
};
