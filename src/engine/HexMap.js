// src/engine/HexMap.js
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

/** Hash helpers / noise (unchanged core, but now returns float 0..1) */
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
  const ix1 = v01 + sx * (v11 - ix0); // minor optimization bug in original, but we keep behaviour
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

/** Elevation "shape" 0..1 (we'll quantize later to 1..7) */
function __hx_computeElevationShape(q, r, cols, rows, rawSeed, terrainType) {
  const seedStr = (typeof rawSeed === 'string' && rawSeed) ? rawSeed : 'defaultseed';
  const x = q * 0.18 + 123.45;
  const y = (q * 0.10 + r * 0.20) + 678.90;
  let n = __hx_fbm2D(x, y, seedStr, 4, 2.0, 0.55);

  const cx = cols / 2, cy = rows / 2;
  const dx = q - cx, dy = r - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxd = Math.sqrt(cx * cx + cy * cy) || 1;
  const falloff = 1 - (dist / maxd);

  n = 0.75 * n + 0.25 * falloff;

  switch (terrainType) {
    case 'water':
      n = Math.min(n, 0.4); // keep low
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
    // elevation & isCoveredByWater will be set in final pass
    hasObject: false,
    hasForest: false,
    hasRuin: false,
    hasCrashSite: false,
    hasVehicle: false,
    hasRoad: false
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

/* ================= Geography presets ================ */
function applyGeography(map, cols, rows, seedStr, rand) {
  const pickF = 2 + Math.floor(rand() * 5); // 2..6
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
    __hx_fbm2D(x * f + 41.2, y * f - 17.9, 'g-' + seedStr, 4, 2.0, 0.5);

  switch (pickF) {
    case 2:
      carveByMask(0.15, 0.35, (q, r) => {
        const X = nx(q), Y = ny(r);
        const r2 = (X * X) / 0.5 + (Y * Y) / 0.25;
        return 1.2 - r2 + 0.4 * fbm(X, Y, 3.0);
      });
      break;
    case 3:
      carveByMask(0.10, 0.20, (q, r) => {
        const X = nx(q), Y = ny(r);
        const d = Math.hypot(X * 0.9, Y * 0.9);
        return 1.0 - d + 0.35 * fbm(X, Y, 2.5);
      });
      break;
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
    case 5:
      carveByMask(0.15, 0.30, (q, r) => {
        const X = nx(q), Y = ny(r);
        const bands = 0.5 + 0.5 * Math.sin(
          (X * 4.0 + Y * 3.0) + 6.28 * fbm(X, Y, 1.2)
        );
        return bands * 0.8 + 0.4 * fbm(X, Y, 2.8);
      });
      break;
    case 6: {
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
function paintBiome(flat, cols, rows, rand) {
  const choices = ['icy', 'volcanic', 'desert', 'temperate', 'swamp'];
  const biome = choices[Math.floor(rand() * choices.length)];

  const land = flat.filter(t => t.type !== 'water' && t.type !== 'mountain');
  for (const t of land) {
    t.type = 'grassland';
    t.movementCost = terrainTypes.grassland.movementCost;
    t.impassable = false;
  }

  const N = land.length;

  if (biome === 'volcanic') {
    const ashN = Math.round(0.50 * N);
    assignExact(land, 'volcano_ash', ashN, rand);
    const remaining = land.filter(t => t.type === 'grassland');
    const remN = remaining.length;
    assignExact(remaining, 'mud',   Math.round(remN * 0.30), rand);
    assignExact(
      remaining.filter(t => t.type === 'grassland'),
      'swamp',
      Math.round(remN * 0.30),
      rand
    );

  } else if (biome === 'desert') {
    const sandN = Math.round(0.50 * N);
    assignExact(land, 'sand', sandN, rand);
    const remaining = land.filter(t => t.type !== 'sand');
    const remN = remaining.length;
    assignExact(remaining, 'mud',   Math.round(remN * 0.30), rand);
    assignExact(
      remaining.filter(t => t.type === 'grassland'),
      'swamp',
      Math.round(remN * 0.30),
      rand
    );

  } else if (biome === 'icy') {
    const frac = 0.60 + 0.10 * rand();
    const coldN = Math.round(frac * N);
    const iceN  = Math.round(coldN * 0.40);
    const snowN = coldN - iceN;
    assignExact(land, 'ice',  iceN, rand);
    assignExact(
      land.filter(t => t.type === 'grassland'),
      'snow',
      snowN,
      rand
    );

  } else if (biome === 'swamp') {
    const mudN  = Math.round(0.40 * N);
    const swpN  = Math.round(0.20 * N);
    assignExact(land, 'mud', mudN, rand);
    assignExact(
      land.filter(t => t.type === 'grassland'),
      'swamp',
      swpN,
      rand
    );

  } else { // temperate
    const mudN  = Math.round(0.15 * N);
    const sandN = Math.round(0.15 * N);
    const swpN  = Math.round(0.15 * N);
    assignExact(land, 'mud', mudN, rand);
    assignExact(
      land.filter(t => t.type === 'grassland'),
      'sand',
      sandN,
      rand
    );
    assignExact(
      land.filter(t => t.type === 'grassland'),
      'swamp',
      swpN,
      rand
    );
  }

  return biome;
}

/* ================ Geo-object helpers ================ */
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
    // Glacier: 9 ICE on coastal/lagoon/lake area
    const coastal = flat.filter(t => isCoastal(map, t.q, t.r));
    const seed = pickClosest(coastal, cols, rows, () => true) ||
                 coastal[Math.floor(rand() * coastal.length)];
    if (seed) {
      const cluster = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 9);
      cluster.forEach(t => {
        t.type = 'ice';
        t.movementCost = terrainTypes.ice.movementCost;
        t.impassable = false;
      });
      const c = pickClosest(cluster, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '❄️', 'Glacier');
    }

  } else if (biome === 'volcanic') {
    // Volcano: peak + adjacent ash
    const mountains = flat.filter(t => t.type === 'mountain');
    let hub = null;
    if (mountains.length) {
      let bestScore = -1;
      for (const m of mountains) {
        const ns = neighbors(m.q, m.r, map).map(([x, y]) => map[y][x]);
        const score = ns.filter(n => n && n.type === 'mountain').length +
                      rand() * 0.1;
        if (score > bestScore) { bestScore = score; hub = m; }
      }
    } else {
      const c = pickClosest(
        flat.filter(t => t.type !== 'water'),
        cols,
        rows,
        () => true
      );
      if (c) {
        hub = c;
        hub.type = 'mountain';
        hub.impassable = true;
      }
    }
    if (hub) {
      hub.type = 'mountain';
      hub.impassable = true;
      for (const [x, y] of neighbors(hub.q, hub.r, map)) {
        const nt = map[y][x];
        if (nt && nt.type !== 'water' && nt.type !== 'mountain') {
          nt.type = 'volcano_ash';
          nt.impassable = false;
          nt.movementCost = terrainTypes.volcano_ash.movementCost;
        }
      }
      labelAndStore(hub.q, hub.r, '🌋', 'Volcano');
    }

  } else if (biome === 'desert') {
    // Desert patch: 9 sand
    const landish = flat.filter(t => t.type !== 'water');
    const seed = pickClosest(landish, cols, rows, () => true) ||
                 landish[Math.floor(rand() * landish.length)];
    if (seed) {
      const cluster = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 9);
      cluster.forEach(t => {
        t.type = 'sand';
        t.impassable = false;
        t.movementCost = terrainTypes.sand.movementCost;
      });
      const c = pickClosest(cluster, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '🌵', 'Dune Field');
    }

  } else if (biome === 'swamp') {
    // Bog: 9 swamp in coastal/lagoon/lake
    const coastal = flat.filter(t => isCoastal(map, t.q, t.r));
    const seed = pickClosest(coastal, cols, rows, () => true) ||
                 coastal[Math.floor(rand() * coastal.length)];
    if (seed) {
      const cluster = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 9);
      cluster.forEach(t => {
        t.type = 'swamp';
        t.impassable = false;
        t.movementCost = terrainTypes.swamp.movementCost;
      });
      const c = pickClosest(cluster, cols, rows, () => true) || seed;
      labelAndStore(c.q, c.r, '🌾', 'Bog');
    }

  } else { // temperate
    // Plateau: 6 grassland core, neighbours lower
    const land = flat.filter(t => t.type !== 'water');
    const seed = pickClosest(land, cols, rows, () => true) ||
                 land[Math.floor(rand() * land.length)];
    if (seed) {
      const core = bfsCluster(seed.q, seed.r, map, (t) => t.type !== 'water', 6);
      for (const t of core) {
        t.type = 'grassland';
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
      movementCost: terrainTypes.grassland.movementCost,
      impassable: false,
      elevation: 4,
      isCoveredByWater: false,
      hasMountainIcon: false,
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
  const MIN_COVER = 0.40;
  if (coverageRatio(flat0) < MIN_COVER) {
    const waters = flat0
      .filter(t => t.type === 'water')
      .map(t => ({ t, d: distToCenter(cols, rows, t.q, t.r) }));
    waters.sort((a, b) => a.d - b.d);
    let i = 0;
    while (i < waters.length && coverageRatio(flat0) < MIN_COVER) {
      const w = waters[i++].t;
      w.type = 'grassland';
      w.movementCost = terrainTypes.grassland.movementCost;
      w.impassable = false;
    }
  }

  // Biome
  const biome = paintBiome(map.flat(), cols, rows, rand);

  // Mountains (chains on land mask)
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
        Object.assign(tile, { type: 'mountain', ...terrainTypes.mountain });
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
  const worldMeta = {
    biome: biome[0].toUpperCase() + biome.slice(1) + ' Biome'
  };
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
  // FINAL ELEVATION + WATER OVERLAY
  // - Elevation levels 1..3 for water tiles
  // - Elevation levels 4..7 for land tiles
  // - isCoveredByWater true ONLY for water tiles at start
  // - Mountains/icons ONLY on elevation 7
  // ============================================================
  const WATER_LEVEL = 3; // future use when you move water up/down

  for (const t of flat) {
    const shape = __hx_computeElevationShape(
      t.q,
      t.r,
      cols,
      rows,
      seedStr,
      t.type
    ); // 0..1

    if (t.type === 'water') {
      // Sea floor depth 1..3
      let lvl;
      if (shape < 0.33)      lvl = 1;  // deep
      else if (shape < 0.66) lvl = 2;  // medium
      else                   lvl = 3;  // shallow

      t.elevation = lvl;
      t.isCoveredByWater = true;
      t.hasMountainIcon = false;

    } else {
      // Land 4..7
      let lvl;
      if (shape < 0.25)      lvl = 4;
      else if (shape < 0.5)  lvl = 5;
      else if (shape < 0.8)  lvl = 6;
      else                   lvl = 7;

      t.elevation = lvl;
      t.isCoveredByWater = false; // land is dry at start

      if (lvl === 7) {
        // Only level-7 tiles are real mountains
        t.type = 'mountain';
        t.impassable = true;
        t.movementCost = Infinity;
        t.hasMountainIcon = true;
      } else {
        // Demote any pre-marked "mountain" tiles that aren't level 7
        if (t.type === 'mountain') {
          t.type = 'grassland';
          t.impassable = false;
          t.movementCost = terrainTypes.grassland.movementCost;
        }
        t.hasMountainIcon = false;
      }
    }
  }

  // Attach meta for scenes (World + Lobby)
  Object.defineProperty(flat, '__worldMeta', { value: worldMeta, enumerable: false });

  return flat;
}

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
