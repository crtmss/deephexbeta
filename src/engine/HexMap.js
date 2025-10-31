// deephexbeta/src/engine/HexMap.js
import { cyrb128, sfc32 } from '../engine/PRNG.js';

const terrainTypes = {
  grassland:   { movementCost: 1, color: '#34a853' },
  sand:        { movementCost: 2, color: '#FFF59D' },
  mud:         { movementCost: 3, color: '#795548' },
  mountain:    { movementCost: Infinity, color: '#9E9E9E', impassable: true },
  water:       { movementCost: Infinity, color: '#4da6ff', impassable: true },
  swamp:       { movementCost: 3, color: '#4E342E' },

  // NEW biomes
  volcano_ash: { movementCost: 2, color: '#9A9A9A' },   // grey, mildly slow
  ice:         { movementCost: 2, color: '#CFEFFF' },   // slippery/light blue
  snow:        { movementCost: 3, color: '#F7FBFF' }    // heavy snow
};

/** Hash a string to a 32-bit int */
function __hx_strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Cheap 2D integer hash → [0,1) */
function __hx_hash2D(q, r, seedStr) {
  const sh = __hx_strHash(seedStr);
  let h = (Math.imul(q, 374761393) ^ Math.imul(r, 668265263) ^ sh) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function __hx_smooth(t) { return t * t * (3 - 2 * t); }
function __hx_valueNoise2D(x, y, seedStr) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1,        y1 = y0 + 1;
  const sx = __hx_smooth(x - x0);
  const sy = __hx_smooth(y - y0);
  const v00 = __hx_hash2D(x0, y0, seedStr);
  const v10 = __hx_hash2D(x1, y0, seedStr);
  const v01 = __hx_hash2D(x0, y1, seedStr);
  const v11 = __hx_hash2D(x1, y1, seedStr);
  const ix0 = v00 + sx * (v10 - v00);
  const ix1 = v01 + sx * (v11 - v01);
  return ix0 + sy * (ix1 - ix0);
}
function __hx_fbm2D(x, y, seedStr, octaves = 4, lac = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1.0, sum = 0.0, ampSum = 0.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * __hx_valueNoise2D(x * freq, y * freq, seedStr);
    ampSum += amp;
    freq *= lac; amp *= gain;
  }
  return sum / (ampSum || 1);
}

/**
 * Compute elevation 0..4 for a tile (visual-only).
 * Water → 0; Mountains biased to 3–4; sand lower; others varied.
 */
function __hx_computeElevation(q, r, cols, rows, rawSeed, terrainType) {
  const seedStr = (typeof rawSeed === 'string' && rawSeed) ? rawSeed : 'defaultseed';
  const x = q * 0.18 + 123.45;
  const y = (q * 0.10 + r * 0.20) + 678.90;
  let n = __hx_fbm2D(x, y, seedStr, 4, 2.0, 0.55);
  const cx = cols / 2, cy = rows / 2;
  const dx = q - cx,   dy = r - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxd = Math.sqrt(cx * cx + cy * cy) || 1;
  const falloff = 1 - (dist / maxd);
  n = 0.75 * n + 0.25 * falloff;

  switch (terrainType) {
    case 'water':     return 0;
    case 'mountain':  n = Math.min(1, n * 0.7 + 0.5); break; // push up
    case 'sand':      n = Math.max(0, n * 0.85 - 0.05); break; // pull down
    case 'swamp':
    case 'mud':       n = Math.max(0, n * 0.9  - 0.02); break; // slightly lower
    case 'volcano_ash':
      n = Math.max(0, n * 0.95 - 0.02); break;
    case 'ice':
    case 'snow':
      n = Math.max(0, n * 0.98 - 0.01); break;
  }
  const e = Math.max(0, Math.min(4, Math.floor(n * 5)));
  return e;
}

function neighbors(q, r, map) {
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  return dirs
    .map(([dq, dr]) => [q + dq, r + dr])
    .filter(([x, y]) => map[y] && map[y][x]);
}

function markWater(tile) {
  Object.assign(tile, {
    type: 'water', ...terrainTypes.water, elevation: 0, hasObject: false,
    hasForest:false, hasRuin:false, hasCrashSite:false, hasVehicle:false, hasRoad:false
  });
}

/* ===========================================================
   GEOGRAPHY PRESETS (seeded)
   (using the already-updated version where preset 1 was removed,
    and water carving reduced by 15%)
   =========================================================== */
function applyGeography(map, cols, rows, seedStr, rand) {
  // pick among presets 2..6 only
  const pickF = 2 + Math.floor(rand() * 5); // 2..6

  const WATER_SCALE = 0.85;

  function carveByMask(targetPctMin, targetPctMax, maskFn) {
    const total = cols * rows;
    const baseTarget = Math.round(
      total * (targetPctMin + rand() * (targetPctMax - targetPctMin))
    );
    const target = Math.round(baseTarget * WATER_SCALE);

    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const t = map[r][q];
        if (t.type === 'water') continue;
        const m = maskFn(q, r);
        candidates.push({ q, r, m });
      }
    }
    candidates.sort((a, b) => b.m - a.m);

    let carved = 0;
    for (let i = 0; i < candidates.length && carved < target; i++) {
      const { q, r } = candidates[i];
      const t = map[r][q];
      if (t.type !== 'water') { markWater(t); carved++; }
    }
  }

  const cx = cols / 2, cy = rows / 2;
  const nx = x => (x - cx) / (cols * 0.5);
  const ny = y => (y - cy) / (rows * 0.5);
  const fbm = (x, y, f = 1.0) => __hx_fbm2D(x * f + 41.2, y * f - 17.9, seedStr, 4, 2.0, 0.5);

  switch (pickF) {
    case 2: { // Big lagoon
      carveByMask(0.15, 0.35, (q, r) => {
        const X = nx(q), Y = ny(r);
        const r2 = (X * X) / 0.5 + (Y * Y) / 0.25;
        return 1.2 - r2 + 0.4 * fbm(X, Y, 3.0);
      });
      break;
    }
    case 3: { // Big center lake
      carveByMask(0.10, 0.20, (q, r) => {
        const X = nx(q), Y = ny(r);
        const d = Math.hypot(X * 0.9, Y * 0.9);
        return 1.0 - d + 0.35 * fbm(X, Y, 2.5);
      });
      break;
    }
    case 4: { // 2–3 bays
      const bays = 2 + Math.floor(rand() * 2);
      const bayParams = [];
      for (let i = 0; i < bays; i++) {
        bayParams.push({
          side: Math.floor(rand() * 4),
          t: rand() * 0.6 + 0.2,
          w: rand() * 0.25 + 0.15,
          d: rand() * 0.35 + 0.25
        });
      }
      carveByMask(0.20, 0.30, (q, r) => {
        const X = nx(q), Y = ny(r);
        let m = 0.0;
        for (const b of bayParams) {
          let ax = 0, ay = 0;
          if (b.side === 0) { ax = (b.t - 0.5) * 2; ay = -1; }
          if (b.side === 2) { ax = (b.t - 0.5) * 2; ay = +1; }
          if (b.side === 1) { ax = +1; ay = (b.t - 0.5) * 2; }
          if (b.side === 3) { ax = -1; ay = (b.t - 0.5) * 2; }
          const dx = X - ax * (1 - b.d);
          const dy = Y - ay * (1 - b.d);
          const r2 = (dx * dx) / (b.w * b.w) + (dy * dy) / (b.d * b.d);
          m = Math.max(m, 1.1 - r2);
        }
        return m + 0.25 * fbm(X, Y, 3.5);
      });
      break;
    }
    case 5: { // Scattered terrain via “rivers”
      carveByMask(0.15, 0.30, (q, r) => {
        const X = nx(q), Y = ny(r);
        const bands = 0.5 + 0.5 * Math.sin((X * 4.0 + Y * 3.0) + 6.28 * fbm(X, Y, 1.2));
        return bands * 0.8 + 0.4 * fbm(X, Y, 2.8);
      });
      break;
    }
    case 6: { // 2–3 big islands
      const islands = 2 + Math.floor(rand() * 2);
      const centers = [];
      for (let i = 0; i < islands; i++) {
        centers.push({ x: (rand() * 1.6 - 0.8), y: (rand() * 1.6 - 0.8) });
      }
      carveByMask(0.15, 0.35, (q, r) => {
        const X = nx(q), Y = ny(r);
        let dmin = 10;
        for (const c of centers) {
          const d = Math.hypot(X - c.x, Y - c.y);
          if (d < dmin) dmin = d;
        }
        return dmin + 0.35 * fbm(X, Y, 2.3);
      });
      break;
    }
  }
}

function generateMap(rows = 25, cols = 25, seedStr = 'defaultseed', rand) {
  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, q) => ({
      q, r,
      type: 'grassland',
      movementCost: terrainTypes.grassland.movementCost,
      impassable: false
    }))
  );

  // Base island mask (already boosted in your prior step)
  const LAND_RADIUS_BOOST = 1.075;
  const centerQ = cols / 2;
  const centerR = rows / 2;
  const maxRadius = (Math.min(centerQ, centerR) - 2) * LAND_RADIUS_BOOST;

  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const tile = map[r][q];
      const dx = q - centerQ;
      const dy = r - centerR;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const noise = rand() * 2.2;
      if (dist + noise > maxRadius) {
        markWater(tile);
      }
    }
  }

  // Presets carving (reduced 15% water)
  applyGeography(map, cols, rows, seedStr, rand);

  // --- Biomes (existing) ---
  function placeBiome(type, minSize, maxSize, instances) {
    for (let i = 0; i < instances; i++) {
      let size = minSize + Math.floor(rand() * (maxSize - minSize + 1));
      let placed = 0, attempts = 0;
      while (placed < size && attempts < 500) {
        const q = Math.floor(rand() * cols);
        const r = Math.floor(rand() * rows);
        const tile = map[r][q];
        if (tile.type !== 'grassland') { attempts++; continue; }
        const queue = [[q, r]];
        let count = 0;
        while (queue.length && placed < size) {
          const [x, y] = queue.shift();
          const t = map[y][x];
          if (t.type === 'grassland') {
            Object.assign(t, { type, ...terrainTypes[type] });
            placed++; count++;
          }
          if (count < size) {
            neighbors(x, y, map).forEach(([nx, ny]) => {
              const nTile = map[ny][nx];
              if (nTile.type === 'grassland') queue.push([nx, ny]);
            });
          }
        }
        break;
      }
    }
  }

  // Existing
  placeBiome('mud',   5, 9, 4);
  placeBiome('sand',  5, 9, 4);
  placeBiome('swamp', 5, 9, 3);

  // NEW biomes (light instances so they season the map)
  placeBiome('volcano_ash', 5, 10, 2);
  placeBiome('ice',         5, 10, 2);
  placeBiome('snow',        5, 10, 2);

  // Mountains (chain) — keep shaping, but we’ll normalize to level 4 later
  const mountainChains = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < mountainChains; i++) {
    let q = Math.floor(rand() * (cols - 4)) + 2;
    let r = Math.floor(rand() * (rows - 4)) + 2;
    const length = 3 + Math.floor(rand() * 3);

    for (let j = 0; j < length; j++) {
      const tile = map[r][q];
      const distFromP1 = Math.sqrt((q - 2) ** 2 + (r - 2) ** 2);
      const distFromP2 = Math.sqrt((q - cols + 2) ** 2 + (r - rows + 2) ** 2);
      if (tile.type !== 'water' && distFromP1 > 3 && distFromP2 > 3) {
        // temporarily tag as mountain; final pass will enforce lvl 4 or downgrade
        Object.assign(tile, { type: 'mountain', ...terrainTypes.mountain });
      }
      const nbs = neighbors(q, r, map);
      if (nbs.length) {
        const [nq, nr] = nbs[Math.floor(rand() * nbs.length)];
        q = nq; r = nr;
      }
    }
  }

  // Objects placement (respect water/mountain afterwards)
  const flat = map.flat();
  const markObj = (tile, key) => { tile[key] = true; tile.hasObject = true; };
  const isFree = t => !t.hasObject && !['mountain', 'water'].includes(t.type);

  // Forests
  const forestCandidates = flat.filter(t => ['grassland', 'mud'].includes(t.type));
  Phaser.Utils.Array.Shuffle(forestCandidates);
  forestCandidates.slice(0, 39).forEach(tile => tile.hasForest = true);

  // Ruins
  const ruinCandidates = flat.filter(t => ['sand', 'swamp', 'volcano_ash', 'ice', 'snow'].includes(t.type) && isFree(t));
  Phaser.Utils.Array.Shuffle(ruinCandidates);
  ruinCandidates.slice(0, Phaser.Math.Between(2, 3)).forEach(t => markObj(t, 'hasRuin'));

  // Crash Sites
  const crashCandidates = flat.filter(isFree);
  Phaser.Utils.Array.Shuffle(crashCandidates);
  crashCandidates.slice(0, Phaser.Math.Between(2, 3)).forEach(t => markObj(t, 'hasCrashSite'));

  // Vehicles
  const vehicleCandidates = flat.filter(t => t.type === 'grassland' && isFree(t));
  Phaser.Utils.Array.Shuffle(vehicleCandidates);
  vehicleCandidates.slice(0, Phaser.Math.Between(2, 3)).forEach(t => markObj(t, 'hasVehicle'));

  // Roads
  const roadTiles = flat.filter(t => !['water', 'mountain'].includes(t.type) && !t.hasObject);
  Phaser.Utils.Array.Shuffle(roadTiles);
  const roadPaths = Phaser.Math.Between(2, 3);
  let totalRoadLength = Phaser.Math.Between(7, 19);
  const used = new Set();
  for (let i = 0; i < roadPaths; i++) {
    let remaining = Math.floor(totalRoadLength / (roadPaths - i));
    totalRoadLength -= remaining;
    let start = roadTiles.find(t => !used.has(`${t.q},${t.r}`));
    if (!start) continue;
    const queue = [start];
    used.add(`${start.q},${start.r}`);
    start.hasRoad = true;
    while (queue.length && remaining > 0) {
      const current = queue.shift();
      const dirs = [[+1,0],[-1,0],[0,+1],[0,-1],[+1,-1],[-1,+1]];
      Phaser.Utils.Array.Shuffle(dirs);
      for (const [dq, dr] of dirs) {
        const nq = current.q + dq, nr = current.r + dr;
        const neighbor = flat.find(t => t.q === nq && t.r === nr);
        if (neighbor && !used.has(`${nq},${nr}`) &&
            !['water', 'mountain'].includes(neighbor.type) && !neighbor.hasObject) {
          neighbor.hasRoad = true;
          used.add(`${nq},${nr}`); queue.push(neighbor); remaining--; break;
        }
      }
    }
  }

  // Elevation
  for (const t of flat) {
    if (typeof t.elevation !== 'number') {
      t.elevation = __hx_computeElevation(t.q, t.r, cols, rows, seedStr, t.type);
    }
  }

  // === Final normalization: only level-4 tiles are true mountains & impassable ===
  for (const t of flat) {
    if (t.type !== 'water' && t.elevation === 4) {
      // Force to mountain and block
      t.type = 'mountain';
      t.impassable = true;
      t.movementCost = Infinity;
      t.hasMountainIcon = true;
    } else {
      t.hasMountainIcon = false;
      // Any left-over "mountain" tags below level 4 are downgraded to grassland
      if (t.type === 'mountain') {
        t.type = 'grassland';
        t.impassable = false;
        t.movementCost = terrainTypes.grassland.movementCost;
      }
    }
  }

  return flat;
}

export default class HexMap {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = String(seed ?? 'defaultseed');
    this.map = [];
    this.generateMap();
  }

  generateMap() {
    const rngSeed = cyrb128(this.seed);
    const rand = sfc32(...rngSeed);
    this.map = generateMap(this.height, this.width, this.seed, rand);
  }

  getMap() {
    return this.map;
  }
}
