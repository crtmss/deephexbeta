// deephexbeta/src/engine/HexMap.js

import { cyrb128, sfc32 } from './PRNG.js';

const terrainTypes = {
  grassland: { movementCost: 1, color: '#34a853' },
  sand:      { movementCost: 2, color: '#FFF59D' },
  mud:       { movementCost: 3, color: '#795548' },
  mountain:  { movementCost: Infinity, color: '#9E9E9E', impassable: true },
  water:     { movementCost: Infinity, color: '#4da6ff', impassable: true },
  swamp:     { movementCost: 3, color: '#4E342E' } // ← fixed stray 'a'
};

/* =============== Seed / RNG utilities (deterministic) =============== */

// When you need a string→RNG quickly (kept for compatibility)
function seededRandom(seed) {
  const s = (typeof seed === 'string' && seed.length) ? seed : 'defaultseed';
  let x = 0;
  for (let i = 0; i < s.length; i++) x += s.charCodeAt(i);
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

// Uniform int in [min,max]
function rngInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// In-place Fisher–Yates shuffle with provided rng()
function rngShuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* =============== Hash & Noise for elevation (your original logic) =============== */

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

/** Smoothstep */
function __hx_smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Value-noise style interpolation of 4 corner hashes */
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

/** Simple fBm (sum of octaves) → ~[0,1] */
function __hx_fbm2D(x, y, seedStr, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1.0, sum = 0.0, ampSum = 0.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * __hx_valueNoise2D(x * freq, y * freq, seedStr);
    ampSum += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / (ampSum || 1);
}

/**
 * Compute elevation 0..4 for a tile (visual-only).
 * Water → 0; Mountains biased to 3–4; sand lower; others varied.
 */
function __hx_computeElevation(q, r, cols, rows, rawSeed, terrainType) {
  const seedStr = (typeof rawSeed === 'string' && rawSeed) ? rawSeed : 'defaultseed';

  // Rotate/scale axial-ish coords for nicer patterns
  const x = q * 0.18 + 123.45;
  const y = (q * 0.10 + r * 0.20) + 678.90;

  let n = __hx_fbm2D(x, y, seedStr, 4, 2.0, 0.55); // [0,1]

  // Gentle radial falloff from map center to keep edges lower on average
  const cx = cols / 2, cy = rows / 2;
  const dx = q - cx,   dy = r - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxd = Math.sqrt(cx * cx + cy * cy) || 1;
  const falloff = 1 - (dist / maxd); // [0..1]
  n = 0.75 * n + 0.25 * falloff;

  // Terrain biasing
  switch (terrainType) {
    case 'water':     return 0;
    case 'mountain':  n = Math.min(1, n * 0.7 + 0.5); break; // push up
    case 'sand':      n = Math.max(0, n * 0.85 - 0.05); break; // pull down
    case 'swamp':
    case 'mud':       n = Math.max(0, n * 0.9  - 0.02); break; // slightly lower
    default:          /* grassland etc. */ break;
  }

  // Quantize into 5 bands (0..4)
  const e = Math.max(0, Math.min(4, Math.floor(n * 5)));
  return e;
}

/* =============== Map Generation (fully seeded) =============== */
/**
 * @param {number} rows
 * @param {number} cols
 * @param {string} seedStr  - the numeric 6-digit seed string
 * @param {function} rng    - a function () => [0,1) (sfc32/cyrb128 based)
 * @returns {Array} flat array of tiles {q,r,type,elevation,movementCost,flags...}
 */
function generateMap(rows = 25, cols = 25, seedStr = 'defaultseed', rng = null) {
  // Provide a deterministic rng if none passed (kept compatibility)
  const localRng = typeof rng === 'function' ? rng : seededRandom(seedStr);

  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, q) => ({
      q,
      r,
      type: 'grassland',
      movementCost: terrainTypes.grassland.movementCost,
      impassable: false
    }))
  );

  // 🌊 Irregular island shape using radial falloff + seeded randomness
  const centerQ = cols / 2;
  const centerR = rows / 2;
  const maxRadius = Math.min(centerQ, centerR) - 2;

  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const tile = map[r][q];
      const dx = q - centerQ;
      const dy = r - centerR;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const noise = localRng() * 2.2;

      if (dist + noise > maxRadius) {
        Object.assign(tile, { type: 'water', ...terrainTypes.water });
      }
    }
  }

  function neighbors(q, r) {
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return dirs
      .map(([dq, dr]) => [q + dq, r + dr])
      .filter(([x, y]) => map[y] && map[y][x]);
  }

  function placeBiome(type, minSize, maxSize, instances) {
    for (let i = 0; i < instances; i++) {
      const sizeTarget = rngInt(localRng, minSize, maxSize);
      let placed = 0;
      let attempts = 0;

      while (placed < sizeTarget && attempts < 500) {
        const q = rngInt(localRng, 0, cols - 1);
        const r = rngInt(localRng, 0, rows - 1);
        const tile = map[r][q];

        if (tile.type !== 'grassland') {
          attempts++;
          continue;
        }

        const queue = [[q, r]];
        let count = 0;

        while (queue.length && placed < sizeTarget) {
          const [x, y] = queue.shift();
          const t = map[y][x];
          if (t.type === 'grassland') {
            Object.assign(t, { type, ...terrainTypes[type] });
            placed++;
            count++;
          }

          if (count < sizeTarget) {
            neighbors(x, y).forEach(([nx, ny]) => {
              const nTile = map[ny][nx];
              if (nTile.type === 'grassland') queue.push([nx, ny]);
            });
          }
        }

        break;
      }
    }
  }

  // 🌱 Biomes
  placeBiome('mud',   5, 9, 4);
  placeBiome('sand',  5, 9, 4);
  placeBiome('swamp', 5, 9, 3);

  // 🏔️ Mountains (seeded)
  const mountainChains = 6 + rngInt(localRng, 0, 2);
  for (let i = 0; i < mountainChains; i++) {
    let q = rngInt(localRng, 2, cols - 3);
    let r = rngInt(localRng, 2, rows - 3);
    const length = 3 + rngInt(localRng, 0, 2);

    for (let j = 0; j < length; j++) {
      const tile = map[r][q];
      const distFromP1 = Math.sqrt((q - 2) ** 2 + (r - 2) ** 2);
      const distFromP2 = Math.sqrt((q - cols + 2) ** 2 + (r - rows + 2) ** 2);

      if (tile.type === 'grassland' && distFromP1 > 3 && distFromP2 > 3) {
        Object.assign(tile, { type: 'mountain', ...terrainTypes.mountain });
      }

      const nbs = neighbors(q, r);
      if (nbs.length) {
        const [nq, nr] = nbs[rngInt(localRng, 0, nbs.length - 1)];
        q = nq;
        r = nr;
      }
    }
  }

  // === 🌳 Object Placement ===
  const flatMap = map.flat();

  const mark = (tile, key) => {
    tile[key] = true;
    tile.hasObject = true;
  };

  const isFree = t =>
    !t.hasObject &&
    !['mountain', 'water'].includes(t.type);

  // 🌲 Forests (can coexist with 1 object)
  const forestCandidates = flatMap.filter(t =>
    ['grassland', 'mud'].includes(t.type)
  );
  rngShuffle(forestCandidates, localRng);
  forestCandidates.slice(0, 39).forEach(tile => tile.hasForest = true);

  // 🏛️ Ruins
  const ruinCandidates = flatMap.filter(t =>
    ['sand', 'swamp'].includes(t.type) && isFree(t)
  );
  rngShuffle(ruinCandidates, localRng);
  ruinCandidates
    .slice(0, rngInt(localRng, 2, 3))
    .forEach(t => mark(t, 'hasRuin'));

  // 🚀 Crash Sites
  const crashCandidates = flatMap.filter(isFree);
  rngShuffle(crashCandidates, localRng);
  crashCandidates
    .slice(0, rngInt(localRng, 2, 3))
    .forEach(t => mark(t, 'hasCrashSite'));

  // 🚙 Abandoned Vehicles
  const vehicleCandidates = flatMap.filter(t =>
    t.type === 'grassland' && isFree(t)
  );
  rngShuffle(vehicleCandidates, localRng);
  vehicleCandidates
    .slice(0, rngInt(localRng, 2, 3))
    .forEach(t => mark(t, 'hasVehicle'));

  // === 🛣️ Ancient Roads ===
  const roadTiles = flatMap.filter(t =>
    !['water', 'mountain'].includes(t.type) &&
    !t.hasObject
  );
  rngShuffle(roadTiles, localRng);

  const roadPaths = rngInt(localRng, 2, 3);
  let totalRoadLength = rngInt(localRng, 7, 19);
  let usedTiles = new Set();

  for (let i = 0; i < roadPaths; i++) {
    let remaining = Math.floor(totalRoadLength / (roadPaths - i));
    totalRoadLength -= remaining;

    let start = roadTiles.find(t => !usedTiles.has(`${t.q},${t.r}`));
    if (!start) continue;

    const queue = [start];
    usedTiles.add(`${start.q},${start.r}`);
    start.hasRoad = true;

    while (queue.length && remaining > 0) {
      const current = queue.shift();
      const dirs = [
        [+1, 0], [-1, 0], [0, +1], [0, -1], [+1, -1], [-1, +1]
      ];
      rngShuffle(dirs, localRng);

      for (const [dq, dr] of dirs) {
        const nq = current.q + dq;
        const nr = current.r + dr;
        const neighbor = flatMap.find(t => t.q === nq && t.r === nr);
        if (
          neighbor &&
          !usedTiles.has(`${nq},${nr}`) &&
          !['water', 'mountain'].includes(neighbor.type) &&
          !neighbor.hasObject
        ) {
          neighbor.hasRoad = true;
          usedTiles.add(`${nq},${nr}`);
          queue.push(neighbor);
          remaining--;
          break;
        }
      }
    }
  }

  // Elevation (visual) — seeded by the **seed string**
  const seedForElevation = (typeof seedStr === 'string' && seedStr) ? seedStr : 'defaultseed';
  for (let i = 0; i < flatMap.length; i++) {
    const t = flatMap[i];
    // Don’t overwrite if elevation already exists (idempotent)
    if (typeof t.elevation !== 'number') {
      t.elevation = __hx_computeElevation(t.q, t.r, cols, rows, seedForElevation, t.type);
    }
  }

  return flatMap;
}

/* =============== Public Class (unchanged API) =============== */

export default class HexMap {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = (typeof seed === 'string') ? seed : String(seed ?? '000000');
    this.map = [];
    this.generateMap();
  }

  generateMap() {
    // Build a strong deterministic RNG from your 6-digit seed
    const seedVec = cyrb128(this.seed);    // [a,b,c,d]
    const rng = sfc32(...seedVec);         // function () => [0,1)

    // IMPORTANT: your original generateMap signature was (rows, cols, seed)
    // and you were calling it as (this.width, this.height, rand) — wrong order & wrong type.
    // Correct order: (rows, cols, seedString, rngFunction)
    this.map = generateMap(this.height, this.width, this.seed, rng);
  }

  getMap() {
    return this.map;
  }
}
