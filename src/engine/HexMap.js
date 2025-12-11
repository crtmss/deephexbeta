// src/engine/HexMap.js
import { cyrb128, sfc32 } from '../engine/PRNG.js';

const terrainTypes = {
  grassland:   { movementCost: 1, color: '#34a853' },
  sand:        { movementCost: 2, color: '#FFF59D' },
  mud:         { movementCost: 3, color: '#795548' },
  mountain:    { movementCost: Infinity, color: '#9E9E9E', impassable: true },
  water:       { movementCost: Infinity, color: '#4da6ff', impassable: true },
  swamp:       { movementCost: 3, color: '#4E342E' },

  // NEW: undersea ground under water (clay / brownish)
  undersea:    { movementCost: 2, color: '#B08B6A' },

  // NEW biomes
  volcano_ash: { movementCost: 2, color: '#9A9A9A' },   // grey, mildly slow
  ice:         { movementCost: 2, color: '#CFEFFF' },   // slippery/light blue
  snow:        { movementCost: 3, color: '#F7FBFF' }    // heavy snow
};

/** Hash helpers / noise (returns float 0..1) */
function __hx_strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function __hx_hash2D(q, r, seedStr) {
  const sh = __hx_strHash(seedStr);
  let h = (Math.imul(q, 374761393) ^ Math.imul(r, 668265263) ^ sh) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function __hx_smooth(t) {
  return t * t * (3 - 2 * t);
}
function __hx_valueNoise2D(x, y, seedStr) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const sx = __hx_smooth(x - x0), sy = __hx_smooth(y - y0);
  const v00 = __hx_hash2D(x0, y0, seedStr), v10 = __hx_hash2D(x1, y0, seedStr);
  const v01 = __hx_hash2D(x0, y1, seedStr), v11 = __hx_hash2D(x1, y1, seedStr);
  const ix0 = v00 + sx * (v10 - v00);
  const ix1 = v01 + sx * (v11 - v01);
  return ix0 + sy * (ix1 - ix0);
}
function __hx_fbm2D(x, y, seedStr, oct = 4, lac = 2.0, gain = 0.5) {
  let amp = 0.5, f = 1.0, sum = 0.0, as = 0.0;
  for (let i = 0; i < oct; i++) {
    sum += amp * __hx_valueNoise2D(x * f, y * f, seedStr);
    as += amp;
    f *= lac;
    amp *= gain;
  }
  return sum / (as || 1);
}

/** Elevation "shape" 0..1 (we'll quantize later to 4..7) */
function __hx_computeElevationShape(q, r, cols, rows, rawSeed, terrainType) {
  const seedStr = (typeof rawSeed === 'string' && rawSeed) ? rawSeed : 'defaultseed';
  const x = q * 0.18 + 123.45;
  const y = (q * 0.10 + r * 0.20) + 678.90;
  let n = __hx_fbm2D(x, y, seedStr, 4, 2.0, 0.55);

  const cx = cols / 2, cy = rows / 2;
  const dx = q - cx, dy = r - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxd = Math.sqrt(cx * cx + cy * cy) || 1;
  const falloff = 1 - (dist / maxd); // 1 at center, 0 at corners
  const centerBias = falloff * falloff; // stronger push toward center

  // Mix noise with center bias – higher toward center, but still noisy
  n = 0.6 * n + 0.4 * centerBias;

  switch (terrainType) {
    case 'water':
      n = Math.min(n, 0.4);
      break;
    case 'mountain':
      n = Math.min(1, n * 0.7 + 0.5);
      break;
    case 'sand':
      n = Math.max(0, n * 0.85 - 0.05);
      break;
    case 'swamp':
    case 'mud':
      n = Math.max(0, n * 0.9  - 0.02);
      break;
    case 'volcano_ash':
      n = Math.max(0, n * 0.95 - 0.02);
      break;
    case 'ice':
    case 'snow':
      n = Math.max(0, n * 0.98 - 0.01);
      break;
  }
  return Math.max(0, Math.min(0.9999, n));
}

/** Utilities */
function neighbors(q, r, map) {
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  return dirs
    .map(([dq, dr]) => [q + dq, r + dr])
    .filter(([x, y]) => map[y] && map[y][x]);
}
function markWater(tile) {
  Object.assign(tile, {
    type: 'water',
    ...terrainTypes.water,
    groundType: 'undersea',
    hasObject: false,
    hasForest: false,
    hasRuin: false,
    hasCrashSite: false,
    hasVehicle: false,
    hasRoad: false,
  });
}
function coverageRatio(flat) {
  const land = flat.filter(t => t.type !== 'water').length;
  return land / flat.length;
}
function distToCenter(cols, rows, q, r) {
  const cx = cols / 2, cy = rows / 2;
  return Math.hypot(q - cx, r - cy);
}
const keyOf = (q, r) => `${q},${r}`;

/* ================= RNG helpers ================= */
function shuffleInPlace(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
function randInt(rand, min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

/* =============== Island margin helper (3-hex water gap) =============== */
function enforceIslandMargin(map, cols, rows, marginRings = 3) {
  const flat = map.flat();
  for (const t of flat) {
    const borderDist = Math.min(t.q, t.r, cols - 1 - t.q, rows - 1 - t.r);
    if (borderDist < marginRings) {
      if (t.type !== 'water') {
        markWater(t);
      }
    }
  }
}

/* ================= Geography presets ================ */
function applyGeography(map, cols, rows, seedStr, rand) {

  // Weighted selection of island shapes, keeping donut-ish rare
  let pickF;
  const roll = rand(); // 0..1

  if (roll < 0.05) {
    pickF = 2; // donut-ish
  } else if (roll < 0.10) {
    pickF = 3; // donut-ish
  } else if (roll < 0.40) {
    pickF = 4;
  } else if (roll < 0.70) {
    pickF = 5;
  } else {
    pickF = 6;
  }

  const WATER_SCALE = 0.85;

  function carveByMask(min, max, maskFn) {
    const total = cols * rows;
    const baseTarget = Math.round(total * (min + rand() * (max - min)));
    const target = Math.round(baseTarget * WATER_SCALE);
    const cand = [];

    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const t = map[r][q];
        if (t.type === 'water') continue;
        cand.push({ q, r, m: maskFn(q, r) });
      }
    }

    cand.sort((a, b) => b.m - a.m);
    let carved = 0;

    for (let i = 0; i < cand.length && carved < target; i++) {
      const { q, r } = cand[i];
      const t = map[r][q];
      if (t.type !== 'water') {
        markWater(t);
        carved++;
      }
    }
  }

  const cx = cols / 2, cy = rows / 2;
  const nx = x => (x - cx) / (cols * 0.5);
  const ny = y => (y - cy) / (rows * 0.5);

  const fbm = (x, y, f = 1.0) =>
    __hx_fbm2D(x * f + 41.2, y * f - 17.9, "g-" + seedStr, 4, 2.0, 0.5);

  switch (pickF) {
    // 2 → Roundish island with central depression
    case 2:
      carveByMask(0.15, 0.35, (q, r) => {
        const X = nx(q), Y = ny(r);
        const r2 = (X * X) / 0.5 + (Y * Y) / 0.25;
        return 1.2 - r2 + 0.4 * fbm(X, Y, 3.0);
      });
      break;

    // 3 → Radial falloff with center hollow
    case 3:
      carveByMask(0.10, 0.20, (q, r) => {
        const X = nx(q), Y = ny(r);
        const d = Math.hypot(X * 0.9, Y * 0.9);
        return 1.0 - d + 0.35 * fbm(X, Y, 2.5);
      });
      break;

    // 4 → Bays and inlets carved from edges
    case 4: {
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

    // 5 → Banding / ridges / irregular shapes
    case 5:
      carveByMask(0.15, 0.30, (q, r) => {
        const X = nx(q), Y = ny(r);
        const bands =
          0.5 + 0.5 * Math.sin((X * 4.0 + Y * 3.0) + 6.28 * fbm(X, Y, 1.2));
        return bands * 0.8 + 0.4 * fbm(X, Y, 2.8);
      });
      break;

    // 6 → Multi-island / archipelago
    case 6: {
      const islands = 2 + Math.floor(rand() * 2);
      const centers = [];

      for (let i = 0; i < islands; i++) {
        centers.push({
          x: rand() * 1.6 - 0.8,
          y: rand() * 1.6 - 0.8
        });
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

/* ================= Biome helpers ================= */
function assignExact(pool, type, count, rand) {
  if (count <= 0) return;
  const idxs = pool.map((_, i) => i);
  shuffleInPlace(idxs, rand);
  for (let k = 0; k < idxs.length && count > 0; k++) {
    const t = pool[idxs[k]];
    if (!t) continue;
    t.type = type;
    t.movementCost = terrainTypes[type].movementCost;
    t.impassable = !!terrainTypes[type].impassable;
    count--;
  }
}

/**
 * Paints a global biome onto the map using contiguous patches
 * (4–9 hexes) so land looks like proper blobs instead of noise.
 * Patches are biased to be roughly roundish around their seed.
 */
function paintBiome(map, cols, rows, rand) {
  const flat = map.flat();
  const choices = ['icy', 'volcanic', 'desert', 'temperate', 'swamp'];
  const biome = choices[Math.floor(rand() * choices.length)];

  // All non-water, non-mountain land starts as grassland
  const land = flat.filter(t => t.type !== 'water' && t.type !== 'mountain');
  for (const t of land) {
    t.type = 'grassland';
    t.groundType = 'grassland';
    t.movementCost = terrainTypes.grassland.movementCost;
    t.impassable = false;
  }

  const N = land.length;
  const byKey = new Map(land.map(t => [keyOf(t.q, t.r), t]));
  let unassigned = new Set(land.map(t => keyOf(t.q, t.r)));

  const clusterAssign = (type, targetCount) => {
    if (targetCount <= 0) return;
    targetCount = Math.min(targetCount, unassigned.size);
    if (!terrainTypes[type]) return;

    const minPatch = 4;
    const maxPatch = 9;  // blobs between 4 and 9 hexes

    while (targetCount > 0 && unassigned.size > 0) {
      const keysArr = Array.from(unassigned);
      const seedKey = keysArr[(rand() * keysArr.length) | 0];
      const seedTile = byKey.get(seedKey);
      if (!seedTile) {
        unassigned.delete(seedKey);
        continue;
      }

      let patchSize = randInt(rand, minPatch, maxPatch);
      patchSize = Math.min(patchSize, targetCount);

      const seedQ = seedTile.q;
      const seedR = seedTile.r;
      // approximate radius so blobs look roundish
      const radius = Math.max(1.5, Math.sqrt(patchSize / Math.PI) * 1.25);

      const queue = [seedTile];
      const visitedLocal = new Set();

      while (queue.length && targetCount > 0 && visitedLocal.size < patchSize) {
        const tile = queue.shift();
        if (!tile) continue;
        const k = keyOf(tile.q, tile.r);
        if (!unassigned.has(k) || visitedLocal.has(k)) continue;

        // distance from seed – keep within radius for round-ish shapes
        const dx0 = tile.q - seedQ;
        const dy0 = tile.r - seedR;
        const dist0 = Math.hypot(dx0, dy0);
        if (dist0 > radius) continue;

        // Assign tile to this biome type
        tile.type = type;
        tile.groundType = type;
        tile.movementCost = terrainTypes[type].movementCost;
        tile.impassable = !!terrainTypes[type].impassable;

        unassigned.delete(k);
        visitedLocal.add(k);
        targetCount--;

        for (const [nq, nr] of neighbors(tile.q, tile.r, map)) {
          const nk = keyOf(nq, nr);
          if (!unassigned.has(nk) || visitedLocal.has(nk)) continue;
          const nt = map[nr][nq];
          if (!nt || nt.type === 'water' || nt.type === 'mountain') continue;

          const dx = nq - seedQ;
          const dy = nr - seedR;
          const dist = Math.hypot(dx, dy);
          if (dist > radius + rand() * 0.4) continue;

          queue.push(nt);
        }
      }
    }
  };

  if (N > 0) {
    if (biome === 'volcanic') {
      const ashN = Math.round(0.50 * N);
      clusterAssign('volcano_ash', ashN);
      const remaining = unassigned.size;
      clusterAssign('mud',   Math.round(remaining * 0.35));
      clusterAssign('swamp', Math.round(remaining * 0.35));

    } else if (biome === 'desert') {
      const sandN = Math.round(0.50 * N);
      clusterAssign('sand', sandN);
      const remaining = unassigned.size;
      clusterAssign('mud',   Math.round(remaining * 0.30));
      clusterAssign('swamp', Math.round(remaining * 0.30));

    } else if (biome === 'icy') {
      const frac   = 0.60 + 0.10 * rand();
      const coldN  = Math.round(frac * N);
      const iceN   = Math.round(coldN * 0.40);
      const snowN  = coldN - iceN;
      clusterAssign('ice',  iceN);
      clusterAssign('snow', snowN);

    } else if (biome === 'swamp') {
      const mudN  = Math.round(0.40 * N);
      const swpN  = Math.round(0.20 * N);
      clusterAssign('mud',   mudN);
      clusterAssign('swamp', swpN);

    } else { // temperate
      const mudN  = Math.round(0.15 * N);
      const sandN = Math.round(0.15 * N);
      const swpN  = Math.round(0.15 * N);
      clusterAssign('mud',   mudN);
      clusterAssign('sand',  sandN);
      clusterAssign('swamp', swpN);
    }
  }

  // Any remaining unassigned land stays as grassland
  for (const t of land) {
    if (!t.groundType) t.groundType = t.type || 'grassland';
  }

  return biome;
}

/* ================ Geo-object helpers ================= */
function isCoastal(map, q, r) {
  const t = map[r][q];
  if (!t || t.type === 'water') return false;
  for (const [nq, nr] of neighbors(q, r, map)) {
    const nt = map[nr][nq];
    if (nt && nt.type === 'water') return true;
  }
  return false;
}
function bfsCluster(startQ, startR, map, want, maxCount = 9) {
  const rows = map.length, cols = map[0].length;
  const seen = new Set(), out = [];
  const q = [[startQ, startR]];
  while (q.length && out.length < maxCount) {
    const [x, y] = q.shift();
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
    const t = map[y][x];
    if (!t || !want(t)) continue;
    out.push(t);
    for (const [nx, ny] of neighbors(x, y, map)) q.push([nx, ny]);
  }
  return out;
}
function pickClosest(tiles, cols, rows, pred) {
  const cx = cols / 2, cy = rows / 2;
  let best = null, bestD = Infinity;
  for (const t of tiles) {
    if (!pred(t)) continue;
    const d = (t.q - cx) * (t.q - cx) + (t.r - cy) * (t.r - cy);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

function applyGeoObject(map, cols, rows, rand, biome, worldMeta) {
  const flat = map.flat();
  const byKey = new Map(flat.map(t => [keyOf(t.q, t.r), t]));
  let landmark = null;

  const labelAndStore = (q, r, emoji, label) => {
    landmark = { q, r, emoji, label };
  };

  if (biome === 'icy') {
    const coastal = flat.filter(t => isCoastal(map, t.q, t.r));
    const seed = pickClosest(coastal, cols, rows, () => true) || coastal[Math.floor(rand() * coastal.length)];
    if (seed) {
      const cluster = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 9);
      cluster.forEach(t => {
        t.type = 'ice';
        t.groundType = 'ice';
        t.movementCost = terrainTypes.ice.movementCost;
        t.impassable = false;
      });
      const c = pickClosest(cluster, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '❄️', 'Glacier');
    }

  } else if (biome === 'volcanic') {
    const mountains = flat.filter(t => t.type === 'mountain');
    let hub = null;
    if (mountains.length) {
      let bestScore = -1;
      for (const m of mountains) {
        const ns = neighbors(m.q, m.r, map).map(([x, y]) => map[y][x]);
        const score = ns.filter(n => n && n.type === 'mountain').length + rand() * 0.1;
        if (score > bestScore) { bestScore = score; hub = m; }
      }
    } else {
      const c = pickClosest(flat.filter(t => t.type !== 'water'), cols, rows, () => true);
      if (c) {
        hub = c;
        hub.type = 'mountain';
        hub.groundType = 'mountain';
        hub.impassable = true;
      }
    }
    if (hub) {
      hub.type = 'mountain';
      hub.groundType = 'mountain';
      hub.impassable = true;
      for (const [x, y] of neighbors(hub.q, hub.r, map)) {
        const nt = map[y][x];
        if (nt && nt.type !== 'water' && nt.type !== 'mountain') {
          nt.type = 'volcano_ash';
          nt.groundType = 'volcano_ash';
          nt.impassable = false;
          nt.movementCost = terrainTypes.volcano_ash.movementCost;
        }
      }
      labelAndStore(hub.q, hub.r, '🌋', 'Volcano');
    }

  } else if (biome === 'desert') {
    const landish = flat.filter(t => t.type !== 'water');
    const seed = pickClosest(landish, cols, rows, () => true) ||
                 landish[Math.floor(rand() * landish.length)];
    if (seed) {
      const cluster = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 9);
      cluster.forEach(t => {
        t.type = 'sand';
        t.groundType = 'sand';
        t.impassable = false;
        t.movementCost = terrainTypes.sand.movementCost;
      });
      const c = pickClosest(cluster, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '🌵', 'Dune Field');
    }

  } else if (biome === 'swamp') {
    const coastal = flat.filter(t => isCoastal(map, t.q, t.r));
    const seed = pickClosest(coastal, cols, rows, () => true) ||
                 coastal[Math.floor(rand() * coastal.length)];
    if (seed) {
      const cluster = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 9);
      cluster.forEach(t => {
        t.type = 'swamp';
        t.groundType = 'swamp';
        t.impassable = false;
        t.movementCost = terrainTypes.swamp.movementCost;
      });
      const c = pickClosest(cluster, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '🌾', 'Bog');
    }

  } else { // temperate
    const land = flat.filter(t => t.type !== 'water');
    const seed = pickClosest(land, cols, rows, () => true) ||
                 land[Math.floor(rand() * land.length)];
    if (seed) {
      const core = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 6);
      for (const t of core) {
        t.type = 'grassland';
        t.groundType = 'grassland';
        t.impassable = false;
        t.movementCost = terrainTypes.grassland.movementCost;
      }
      const ringSet = new Set();
      for (const t of core) {
        for (const [x, y] of neighbors(t.q, t.r, map)) {
          const nk = keyOf(x, y);
          if (ringSet.has(nk)) continue;
          const nt = map[y][x];
          if (!nt || nt.type === 'water') continue;
          if (!core.includes(nt)) {
            nt.type = 'grassland';
            nt.groundType = 'grassland';
          }
          ringSet.add(nk);
        }
      }
      const c = pickClosest(core, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '🌄', 'Plateau');
    }
  }

  if (landmark) {
    worldMeta.geoLandmark = landmark;
  }
}

/* ================= Map generation ================= */
function generateMap(rows = 25, cols = 25, seedStr = 'defaultseed', rand) {
  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, q) => ({
      q, r,
      type: 'grassland',
      groundType: 'grassland',
      movementCost: terrainTypes.grassland.movementCost,
      impassable: false,
      // elevation model will be set in the final pass
      elevation: 4,
      baseElevation: 4,
      waterDepth: 0,
      isCoveredByWater: false,
      isUnderWater: false,
    }))
  );

  // Base island "mask": rough island vs outer ocean
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

  // Geography and minimum coverage (still using type=water as mask)
  applyGeography(map, cols, rows, seedStr, rand);
  const flat0 = map.flat();
  const MIN_COVER = 0.30;
  if (coverageRatio(flat0) < MIN_COVER) {
    const waters = flat0
      .filter(t => t.type === 'water')
      .map(t => ({ t, d: distToCenter(cols, rows, t.q, t.r) }));
    waters.sort((a, b) => a.d - b.d);
    let i = 0;
    while (i < waters.length && coverageRatio(flat0) < MIN_COVER) {
      const w = waters[i++].t;
      w.type = 'grassland';
      w.groundType = 'grassland';
      w.movementCost = terrainTypes.grassland.movementCost;
      w.impassable = false;
    }
  }

  // Enforce a 3-hex water margin between land and map edge
  enforceIslandMargin(map, cols, rows, 3);

  // Biome (using contiguous patch painting)
  const biome = paintBiome(map, cols, rows, rand);

  // Mountains (chains on land mask)
  const mountainChains = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < mountainChains; i++) {
    let q = Math.floor(rand() * (cols - 4)) + 2;
    let r = Math.floor(rand() * (rows - 4)) + 2;
    const length = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < length; j++) {
      const tile = map[r][q];
      const distFromP1 = Math.sqrt((q - 2) ** 2 + (r - 2) ** 2);
      const distFromP2 = Math.sqrt((q - cols + 2) ** 2 + (r - rows + 2) ** 2);
      if (tile.type !== 'water' && distFromP1 > 3 && distFromP2 > 3) {
        Object.assign(tile, {
          type: 'mountain',
          groundType: 'mountain',
          ...terrainTypes.mountain
        });
      }
      const nbs = neighbors(q, r, map);
      if (nbs.length) {
        const [nq, nr] = nbs[Math.floor(rand() * nbs.length)];
        q = nq;
        r = nr;
      }
    }
  }

  // === Geo-object (one per map) ===
  const worldMeta = { biome: biome[0].toUpperCase() + biome.slice(1) + ' Biome' };
  applyGeoObject(map, cols, rows, rand, biome, worldMeta);

  // Objects / POIs (forests/ruins/vehicles/roads) — seeded
  const flat = map.flat();
  const markObj = (tile, key) => { tile[key] = true; tile.hasObject = true; };
  const isFree = t => !t.hasObject && !['mountain', 'water'].includes(t.type);

  // Forests
  const forestCandidates = flat.filter(t => ['grassland', 'mud'].includes(t.type));
  shuffleInPlace(forestCandidates, rand);
  forestCandidates.slice(0, 39).forEach(tile => {
    tile.hasForest = true;
  });

  // Ruins
  const ruinCandidates = flat.filter(t =>
    ['sand', 'swamp', 'volcano_ash', 'ice', 'snow'].includes(t.type) && isFree(t)
  );
  shuffleInPlace(ruinCandidates, rand);
  ruinCandidates
    .slice(0, randInt(rand, 2, 3))
    .forEach(t => markObj(t, 'hasRuin'));

  // Crashsites
  const crashCandidates = flat.filter(isFree);
  shuffleInPlace(crashCandidates, rand);
  crashCandidates
    .slice(0, randInt(rand, 2, 3))
    .forEach(t => markObj(t, 'hasCrashSite'));

  // Vehicles
  const vehicleCandidates = flat.filter(t => t.type === 'grassland' && isFree(t));
  shuffleInPlace(vehicleCandidates, rand);
  vehicleCandidates
    .slice(0, randInt(rand, 2, 3))
    .forEach(t => markObj(t, 'hasVehicle'));

  // Roads (simple seeded BFS)
  const roadTiles = flat.filter(t =>
    !['water', 'mountain'].includes(t.type) && !t.hasObject
  );
  shuffleInPlace(roadTiles, rand);

  const roadPaths = randInt(rand, 2, 3);
  let totalRoadLength = randInt(rand, 7, 19);
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
      shuffleInPlace(dirs, rand);

      for (const [dq, dr] of dirs) {
        const nq = current.q + dq;
        const nr = current.r + dr;
        const neighbor = flat.find(t => t.q === nq && t.r === nr);
        if (
          neighbor &&
          !used.has(`${nq},${nr}`) &&
          !['water', 'mountain'].includes(neighbor.type) &&
          !neighbor.hasObject
        ) {
          neighbor.hasRoad = true;
          used.add(`${nq},${nr}`);
          queue.push(neighbor);
          remaining--;
          break;
        }
      }
    }
  }

  // ============================================================
  // FINAL ELEVATION + BASE WATER DEPTH (GLOBAL DISTRIBUTION)
  // ============================================================
  const cx = cols / 2, cy = rows / 2;
  const maxd = Math.hypot(cx, cy) || 1;

  const landTiles = flat.filter(t => t.type !== 'water');
  const waterTiles = flat.filter(t => t.type === 'water');

  // Precompute shape & center factor for land
  for (const t of landTiles) {
    const shape = __hx_computeElevationShape(t.q, t.r, cols, rows, seedStr, t.type);
    const dx = t.q - cx;
    const dy = t.r - cy;
    const dist = Math.hypot(dx, dy);
    const centerFactor = 1 - dist / maxd;
    t.__elevShape = shape;
    t.__centerFactor = Math.max(0, Math.min(1, centerFactor));
  }

  const landCount = landTiles.length;
  if (landCount > 0) {
    // Pick global fractions within requested ranges
    let frac7 = 0.045 + (rand() - 0.5) * 0.05; // ~4.5% ±2.5% => ~2–7%
    frac7 = Math.max(0.03, Math.min(0.08, frac7));

    let frac6 = 0.17 + (rand() - 0.5) * 0.10; // ~17% ±5% => 12–22
    frac6 = Math.max(0.10, Math.min(0.25, frac6));
    
    let target7Total = Math.round(landCount * frac7);
    let target6 = Math.round(landCount * frac6);

    if (target7Total + target6 > landCount) {
      const scale = landCount / (target7Total + target6);
      target7Total = Math.floor(target7Total * scale);
      target6 = Math.floor(target6 * scale);
    }

    const mountainTiles = landTiles.filter(t => t.type === 'mountain');
    const forced7 = mountainTiles.length;
    if (forced7 > target7Total) {
      target7Total = forced7;
    }
    let extra7 = Math.max(0, target7Total - forced7);

    const remainingAfterHigh = Math.max(0, landCount - target7Total - target6);
    let target4 = 0;
    let target5 = 0;
    if (remainingAfterHigh > 0) {
      target4 = Math.round(remainingAfterHigh * 0.60);
      target5 = remainingAfterHigh - target4;
    }

    // High-elevation candidates sorted by score (shape + center bias)
    const nonMountain = landTiles.filter(t => t.type !== 'mountain');
    nonMountain.sort((a, b) => {
      const sa = a.__elevShape ?? 0;
      const sb = b.__elevShape ?? 0;
      const ca = a.__centerFactor ?? 0;
      const cb = b.__centerFactor ?? 0;
      const scoreA = sa * 0.6 + ca * 0.4;
      const scoreB = sb * 0.6 + cb * 0.4;
      return scoreB - scoreA;
    });

    const levelMap = new Map(); // tile -> level

    // Forced mountains as level 7
    for (const t of mountainTiles) {
      levelMap.set(t, 7);
    }

    // Extra lvl 7 (non-mountain tiles with highest score)
    let idx = 0;
    while (extra7 > 0 && idx < nonMountain.length) {
      const t = nonMountain[idx++];
      if (levelMap.has(t)) continue;
      levelMap.set(t, 7);
      extra7--;
    }

    // Lvl 6 assignment
    idx = 0;
    let left6 = target6;
    while (left6 > 0 && idx < nonMountain.length) {
      const t = nonMountain[idx++];
      if (levelMap.has(t)) continue;
      levelMap.set(t, 6);
      left6--;
    }

    // Remaining tiles for 4 and 5 (60/40 split)
    const remainingTiles = landTiles.filter(t => !levelMap.has(t));
    remainingTiles.sort((a, b) => ( (a.__elevShape ?? 0) - (b.__elevShape ?? 0) ));

    let left4 = target4;
    for (const t of remainingTiles) {
      if (left4 > 0) {
        levelMap.set(t, 4);
        left4--;
      } else {
        levelMap.set(t, 5);
      }
    }

    // Apply levels to land tiles
    for (const t of landTiles) {
      const lvl = levelMap.get(t) || 4;
      t.baseElevation = lvl;
      t.elevation = lvl;
      t.isCoveredByWater = false;
      t.isUnderWater = false;

      if (lvl === 7 || t.type === 'mountain') {
        t.type = 'mountain';
        t.groundType = 'mountain';
        t.impassable = true;
        t.movementCost = Infinity;
        t.hasMountainIcon = true;
        t.baseElevation = 7;
        t.elevation = 7;
      } else {
        if (!t.groundType) t.groundType = t.type;
        t.hasMountainIcon = false;
        t.impassable = !!terrainTypes[t.type]?.impassable;
        t.movementCost = terrainTypes[t.type]?.movementCost ?? 1;
      }

      delete t.__elevShape;
      delete t.__centerFactor;
    }
  }

  // Water tiles: start as deep water, shallows handled below
  for (const t of waterTiles) {
    const depth = 1;
    t.baseElevation    = depth;
    t.elevation        = depth;
    t.waterDepth       = depth;
    t.isCoveredByWater = true;
    t.isUnderWater     = true;
    t.groundType       = 'undersea';
  }

  // SECOND PASS: clustered shallow water patches (2–4 stains)
  if (waterTiles.length > 0) {
    const targetShallowRatio = 0.30;
    const targetShallow = Math.floor(waterTiles.length * targetShallowRatio);
    let shallowCount = waterTiles.filter(t => t.baseElevation === 3).length;

    if (shallowCount < targetShallow) {
      const coastalWater = waterTiles.filter(t => {
        const bd = Math.min(t.q, t.r, cols - 1 - t.q, rows - 1 - t.r);
        if (bd <= 1) return false;

        for (const [nq, nr] of neighbors(t.q, t.r, map)) {
          const nt = map[nr][nq];
          if (nt && nt.type !== 'water') return true;
        }
        return false;
      });

      if (coastalWater.length > 0) {
        coastalWater.sort((a, b) => {
          const da = (a.q - cx) ** 2 + (a.r - cy) ** 2;
          const db = (b.q - cx) ** 2 + (b.r - cy) ** 2;
          return da - db;
        });

        const centralCount = Math.max(4, Math.floor(coastalWater.length * 0.33));
        const seedsPool = coastalWater.slice(0, centralCount);
        shuffleInPlace(seedsPool, rand);

        const clusterCount = Math.min(randInt(rand, 2, 4), seedsPool.length);
        const usedSeedKeys = new Set();

        const maxCenterDist2 = (cols * cols + rows * rows) * 0.25;

        const markShallow = (tile) => {
          const bd = Math.min(tile.q, tile.r, cols - 1 - tile.q, rows - 1 - tile.r);
          if (bd <= 1) return;

          const d2 = (tile.q - cx) ** 2 + (tile.r - cy) ** 2;
          if (d2 > maxCenterDist2) return;

          if (tile.type === 'water' && tile.baseElevation !== 3) {
            tile.baseElevation = 3;
            tile.elevation = 3;
            tile.waterDepth = 3;
            shallowCount++;
          }
        };

        for (let si = 0; si < seedsPool.length &&
                        usedSeedKeys.size < clusterCount &&
                        shallowCount < targetShallow; si++) {

          const seed = seedsPool[si];
          const sk = keyOf(seed.q, seed.r);
          if (usedSeedKeys.has(sk)) continue;
          usedSeedKeys.add(sk);

          const queue = [[seed.q, seed.r]];
          const seenCluster = new Set();
          const maxSize = randInt(rand, 8, 24);

          while (queue.length &&
                 seenCluster.size < maxSize &&
                 shallowCount < targetShallow) {

            const [cq, cr] = queue.shift();
            const ck = keyOf(cq, cr);
            if (seenCluster.has(ck)) continue;
            seenCluster.add(ck);

            const tile = map[cr] && map[cr][cq];
            if (!tile || tile.type !== 'water') continue;

            const bd = Math.min(cq, cr, cols - 1 - cq, rows - 1 - cr);
            if (bd <= 1) continue;

            markShallow(tile);

            for (const [nq, nr] of neighbors(cq, cr, map)) {
              const nk = keyOf(nq, nr);
              if (seenCluster.has(nk)) continue;

              const nt = map[nr] && map[nr][nq];
              if (!nt || nt.type !== 'water') continue;

              const nbd = Math.min(nq, nr, cols - 1 - nq, rows - 1 - nr);
              if (nbd <= 1) continue;

              let nearCoast = false;
              for (const [mq, mr] of neighbors(nq, nr, map)) {
                const mt = map[mr] && map[mr][mq];
                if (mt && mt.type !== 'water') {
                  nearCoast = true;
                  break;
                }
              }

              if (!nearCoast && rand() > 0.35) continue;

              queue.push([nq, nr]);
            }
          }
        }
      }
    }
  }

  Object.defineProperty(flat, '__worldMeta', {
    value: worldMeta,
    enumerable: false
  });

  return flat;
}

// ------------------------------------------------------------
//  EXPORT CLASS
// ------------------------------------------------------------
export default class HexMap {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = String(seed ?? 'defaultseed');
    this.map = [];
    this.worldMeta = null;
    this.generateMap();
  }

  generateMap() {
    const rngSeed = cyrb128(this.seed);
    const rand = sfc32(...rngSeed);
    const tiles = generateMap(this.height, this.width, this.seed, rand);
    this.map = tiles;
    this.worldMeta = tiles.__worldMeta || {};
  }

  getMap() {
    return this.map;
  }
}

