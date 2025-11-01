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

/* =========================
   Utilities for coverage
   ========================= */
function coverageRatio(flat) {
  const land = flat.filter(t => t.type !== 'water').length;
  return land / flat.length;
}
function distToCenter(cols, rows, q, r) {
  const cx = cols / 2, cy = rows / 2;
  const dx = q - cx, dy = r - cy;
  return Math.hypot(dx, dy);
}

/* ===========================================================
   GEOGRAPHY PRESETS (seeded)
   (preset 1 removed; water carving reduced by 15%)
   =========================================================== */
function applyGeography(map, cols, rows, seedStr, rand) {
  // pick among presets 2..6 only
  const pickF = 2 + Math.floor(rand() * 5); // 2..6
  let geographyName = '';

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
      geographyName = 'Big Lagoon';
      carveByMask(0.15, 0.35, (q, r) => {
        const X = nx(q), Y = ny(r);
        const r2 = (X * X) / 0.5 + (Y * Y) / 0.25;
        return 1.2 - r2 + 0.4 * fbm(X, Y, 3.0);
      });
      break;
    }
    case 3: { // Big center lake
      geographyName = 'Central Lake';
      carveByMask(0.10, 0.20, (q, r) => {
        const X = nx(q), Y = ny(r);
        const d = Math.hypot(X * 0.9, Y * 0.9);
        return 1.0 - d + 0.35 * fbm(X, Y, 2.5);
      });
      break;
    }
    case 4: { // 2–3 bays
      geographyName = 'Small Bays';
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
      geographyName = 'Scattered Terrain';
      carveByMask(0.15, 0.30, (q, r) => {
        const X = nx(q), Y = ny(r);
        const bands = 0.5 + 0.5 * Math.sin((X * 4.0 + Y * 3.0) + 6.28 * fbm(X, Y, 1.2));
        return bands * 0.8 + 0.4 * fbm(X, Y, 2.8);
      });
      break;
    }
    case 6: { // 2–3 big islands
      geographyName = 'Multiple Islands';
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

  return geographyName || 'Unknown';
}

/* =========================
   Biome helpers (seeded)
   ========================= */
function shuffleInPlace(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
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
  // Deterministic pick from seed RNG
  const choices = ['icy', 'volcanic', 'desert', 'temperate', 'swamp'];
  const biome = choices[Math.floor(rand() * choices.length)];

  // Work on land that is not hard water; keep explicit mountains as-is for now
  const land = flat.filter(t => t.type !== 'water' && t.type !== 'mountain');

  const N = land.length;

  // Reset to grassland baseline before painting
  for (const t of land) {
    t.type = 'grassland';
    t.movementCost = terrainTypes.grassland.movementCost;
    t.impassable = false;
  }

  if (biome === 'volcanic') {
    // 50% ash; remaining split mud/swamp/grassland (30/30/40)
    const ashN = Math.round(0.50 * N);
    assignExact(land, 'volcano_ash', ashN, rand);

    const remaining = land.filter(t => t.type === 'grassland'); // unpainted
    const remN = remaining.length;
    assignExact(remaining, 'mud', Math.round(remN * 0.30), rand);
    assignExact(remaining.filter(t => t.type === 'grassland'), 'swamp', Math.round(remN * 0.30), rand);
    // rest stays grassland

  } else if (biome === 'desert') {
    // 50% sand; remaining split mud/swamp/grassland (30/30/40)
    const sandN = Math.round(0.50 * N);
    assignExact(land, 'sand', sandN, rand);

    const remaining = land.filter(t => !['sand'].includes(t.type));
    const remN = remaining.length;
    assignExact(remaining, 'mud', Math.round(remN * 0.30), rand);
    assignExact(remaining.filter(t => t.type === 'grassland'), 'swamp', Math.round(remN * 0.30), rand);

  } else if (biome === 'icy') {
    // 60–70% snow+ice (split ~60/40), rest grassland
    const frac = 0.60 + 0.10 * rand();
    const coldN = Math.round(frac * N);
    const iceN  = Math.round(coldN * 0.40);
    const snowN = coldN - iceN;
    assignExact(land, 'ice',  iceN, rand);
    assignExact(land.filter(t => t.type === 'grassland'), 'snow', snowN, rand);
    // remaining grassland

  } else if (biome === 'swamp') {
    // Mostly mud + grassland, some swamp — no ash/snow/ice
    const mudN  = Math.round(0.40 * N);
    const swpN  = Math.round(0.20 * N);
    assignExact(land, 'mud', mudN, rand);
    assignExact(land.filter(t => t.type === 'grassland'), 'swamp', swpN, rand);
    // remaining grassland

  } else { // temperate
    // classic: mostly grassland, small mud/sand/swamp
    const mudN  = Math.round(0.15 * N);
    const sandN = Math.round(0.15 * N);
    const swpN  = Math.round(0.15 * N);
    assignExact(land, 'mud', mudN, rand);
    assignExact(land.filter(t => t.type === 'grassland'), 'sand', sandN, rand);
    assignExact(land.filter(t => t.type === 'grassland'), 'swamp', swpN, rand);
    // rest grassland
  }

  return biome;
}

/* =========================
   Geography Object helpers
   ========================= */
function inBounds(q, r, cols, rows) {
  return q >= 0 && q < cols && r >= 0 && r < rows;
}
function tileAt(map, q, r) {
  return (map[r] && map[r][q]) || null;
}
function isLand(t) { return t && t.type !== 'water'; }
function isCoastal(map, q, r) {
  const t = tileAt(map, q, r);
  if (!isLand(t)) return false;
  const nbs = neighbors(q, r, map);
  for (const [x, y] of nbs) {
    const nt = tileAt(map, x, y);
    if (nt && nt.type === 'water') return true;
  }
  return false;
}
function bfsCluster(map, start, passFn, maxCount) {
  const cols = map[0].length, rows = map.length;
  const key = (q, r) => `${q},${r}`;
  const seen = new Set([key(start.q, start.r)]);
  const out = [];
  const q = [start];
  while (q.length && out.length < maxCount) {
    const cur = q.shift();
    if (!passFn(cur)) continue;
    out.push(cur);
    for (const [x, y] of neighbors(cur.q, cur.r, map)) {
      if (!inBounds(x, y, cols, rows)) continue;
      const nt = map[y][x];
      const k = key(x, y);
      if (!seen.has(k)) {
        seen.add(k);
        q.push(nt);
      }
    }
  }
  return out;
}
function nearestToCenter(tiles, cols, rows) {
  const cx = cols / 2, cy = rows / 2;
  let best = tiles[0], bd = Infinity;
  for (const t of tiles) {
    const d = Math.hypot(t.q - cx, t.r - cy);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function choose(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

/* Spawn ONE geography object deterministically, based on biome */
function spawnBiomeObject(map, biome, rand) {
  const cols = map[0].length, rows = map.length;
  const flat = map.flat();
  const landTiles = flat.filter(t => t.type !== 'water');

  const meta = {
    type: null,
    label: null,
    emoji: null,
    center: null,    // {q,r}
    tiles: []        // [{q,r}]
  };

  if (!landTiles.length) return meta;

  const makeRecord = (type, label, emoji, tiles) => {
    const center = nearestToCenter(tiles, cols, rows);
    meta.type = type; meta.label = label; meta.emoji = emoji;
    meta.center = { q: center.q, r: center.r };
    meta.tiles = tiles.map(t => ({ q: t.q, r: t.r }));
    return meta;
  };

  // Common predicates
  const passLandNotMountain = (t) => t && t.type !== 'water' && t.type !== 'mountain';
  const passLand = (t) => t && t.type !== 'water';

  // Helpers to find seeds with preference
  const coastalSeeds = landTiles.filter(t => isCoastal(map, t.q, t.r));
  const interiorSeeds = landTiles.filter(t => !isCoastal(map, t.q, t.r));

  if (biome === 'icy') {
    // Glacier: 9 clumped ICE on coastal/lagoon/lake/coast
    const seeds = coastalSeeds.length ? coastalSeeds : landTiles;
    let objectTiles = null;
    for (let tries = 0; tries < 40 && !objectTiles; tries++) {
      const s = choose(seeds, rand);
      const cluster = bfsCluster(map, s, passLandNotMountain, 12);
      if (cluster.length >= 6) {
        objectTiles = cluster.slice(0, 9);
      }
    }
    if (!objectTiles) return meta; // give up quietly
    // Paint
    for (const t of objectTiles) {
      t.type = 'ice';
      t.movementCost = terrainTypes.ice.movementCost;
      t.impassable = !!terrainTypes.ice.impassable;
    }
    return makeRecord('glacier', 'Glacier', '❄️', objectTiles);
  }

  if (biome === 'volcanic') {
    // Volcano: 1 lvl-4 mountain center; adjacents (non water/mountain) -> volcano_ash
    const mountainTiles = flat.filter(t => t.type === 'mountain');
    const seeds = mountainTiles.length ? mountainTiles : landTiles;
    const centerTile = choose(seeds, rand);
    // Center → mountain; elevation will be normalized later to 4 if not yet
    centerTile.type = 'mountain';
    centerTile.impassable = true;
    centerTile.movementCost = Infinity;
    // Adjacent ring → volcano_ash where allowed
    const adj = neighbors(centerTile.q, centerTile.r, map)
      .map(([x, y]) => map[y][x])
      .filter(t => t && t.type !== 'water' && t.type !== 'mountain');
    for (const t of adj) {
      t.type = 'volcano_ash';
      t.movementCost = terrainTypes.volcano_ash.movementCost;
      t.impassable = !!terrainTypes.volcano_ash.impassable;
    }
    const tiles = [centerTile, ...adj];
    return makeRecord('volcano', 'Volcano', '🌋', tiles);
  }

  if (biome === 'desert') {
    // Desert: 9 clumped SAND, remove mountains/water within cluster
    const seeds = interiorSeeds.length ? interiorSeeds : landTiles;
    let objectTiles = null;
    for (let tries = 0; tries < 60 && !objectTiles; tries++) {
      const s = choose(seeds, rand);
      // Allow converting anything to sand inside the cluster (including water/mountain)
      const cluster = bfsCluster(map, s, passLand, 14);
      if (cluster.length >= 6) objectTiles = cluster.slice(0, 9);
    }
    if (!objectTiles) return meta;
    for (const t of objectTiles) {
      t.type = 'sand';
      t.movementCost = terrainTypes.sand.movementCost;
      t.impassable = !!terrainTypes.sand.impassable;
    }
    return makeRecord('desert', 'Desert', '🌵', objectTiles);
  }

  if (biome === 'temperate') {
    // Plateau: 6 clumped grassland level 3, surrounded by ring level 1
    const seeds = interiorSeeds.length ? interiorSeeds : landTiles;
    let core = null;
    for (let tries = 0; tries < 60 && !core; tries++) {
      const s = choose(seeds, rand);
      const cluster = bfsCluster(map, s, (t) => t && t.type !== 'water' && t.type !== 'mountain', 10);
      if (cluster.length >= 6) core = cluster.slice(0, 6);
    }
    if (!core) return meta;
    // Set core elev=3, grassland
    for (const t of core) {
      t.type = 'grassland';
      t.movementCost = terrainTypes.grassland.movementCost;
      t.impassable = false;
      t.elevation = 3; // visual; normalization will keep non-4
    }
    // Ring neighbors elev=1, grassland (don’t overwrite water/mountain)
    const ringSet = new Map();
    for (const t of core) {
      for (const [x, y] of neighbors(t.q, t.r, map)) {
        const n = tileAt(map, x, y);
        if (!n || n.type === 'water' || n.type === 'mountain') continue;
        ringSet.set(`${x},${y}`, n);
      }
    }
    for (const n of ringSet.values()) {
      n.type = 'grassland';
      n.movementCost = terrainTypes.grassland.movementCost;
      n.impassable = false;
      n.elevation = 1;
    }
    const tiles = core; // track only core as object tiles
    return makeRecord('plateau', 'Plateau', '🌄', tiles);
  }

  if (biome === 'swamp') {
    // Bog: 9 clumped SWAMP on coastal/lagoon/lake/coast
    const seeds = coastalSeeds.length ? coastalSeeds : landTiles;
    let objectTiles = null;
    for (let tries = 0; tries < 40 && !objectTiles; tries++) {
      const s = choose(seeds, rand);
      const cluster = bfsCluster(map, s, passLandNotMountain, 12);
      if (cluster.length >= 6) objectTiles = cluster.slice(0, 9);
    }
    if (!objectTiles) return meta;
    for (const t of objectTiles) {
      t.type = 'swamp';
      t.movementCost = terrainTypes.swamp.movementCost;
      t.impassable = !!terrainTypes.swamp.impassable;
    }
    return makeRecord('bog', 'Bog', '🌾', objectTiles);
  }

  return meta;
}

/* =========================
   Map generation
   ========================= */
function generateMap(rows = 25, cols = 25, seedStr = 'defaultseed', rand) {
  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, q) => ({
      q, r,
      type: 'grassland',
      movementCost: terrainTypes.grassland.movementCost,
      impassable: false
    }))
  );

  // Base island mask (boost land slightly)
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

  // Geography presets (reduced ~15% water) + capture label
  const geographyName = applyGeography(map, cols, rows, seedStr, rand) || 'Unknown';

  // === Ensure minimum land coverage (>= 40%) ===
  const flat0 = map.flat();
  const MIN_COVER = 0.40;
  if (coverageRatio(flat0) < MIN_COVER) {
    const waters = flat0
      .filter(t => t.type === 'water')
      .map(t => ({ t, d: distToCenter(cols, rows, t.q, t.r) }));
    waters.sort((a, b) => a.d - b.d); // fill inward first
    let i = 0;
    while (i < waters.length && coverageRatio(flat0) < MIN_COVER) {
      const w = waters[i++].t;
      w.type = 'grassland';
      w.movementCost = terrainTypes.grassland.movementCost;
      w.impassable = false;
    }
  }

  // --- Biomes (seeded, overwrite land composition deterministically) ---
  const flatForBiome = map.flat();
  const biomeName = paintBiome(flatForBiome, cols, rows, rand);

  // --- NEW: Spawn ONE geography object based on biome (seeded) ---
  const geoObject = spawnBiomeObject(map, biomeName, rand);

  // Mountains (chain) — keep shaping, but normalize to level 4 later
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

  // Attach world meta (for UI and rendering of object/labels/trees)
  const worldMeta = {
    geography: geographyName,
    biome: biomeName,
    geoObject
  };

  // Store meta non-enumerably on the array, and also return alongside
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
    const arr = generateMap(this.height, this.width, this.seed, rand);
    this.map = arr;
    // hoist meta for easy access
    this.worldMeta = arr.__worldMeta || null;
  }

  getMap() {
    return this.map;
  }
}
