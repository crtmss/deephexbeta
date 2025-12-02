// src/engine/HexMap.js

// ============================================================
//   Seeded PRNG helpers (deterministic for same seed string)
// ============================================================

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277,
      h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// ============================================================
//   Terrain type presets
// ============================================================

const terrainTypes = {
  water: {
    movementCost: 999,
    defense: 0,
    resource: null,
  },
  plains: {
    movementCost: 1,
    defense: 0,
    resource: null,
  },
  forest: {
    movementCost: 2,
    defense: 1,
    resource: 'wood',
  },
  mountain: {
    movementCost: 999,
    defense: 3,
    resource: 'ore',
  },
  swamp: {
    movementCost: 3,
    defense: -1,
    resource: null,
  },
};

// ============================================================
//   World summary (for lobby preview / badge)
//   (must be defined BEFORE generateMap uses it)
// ============================================================

function computeWorldSummaryFromTiles(tiles, width, height) {
  const total = tiles.length || 1;
  const counts = tiles.reduce((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});

  const pct = (type) => (counts[type] || 0) / total;

  const waterRatio = pct('water');
  const forestRatio = pct('forest');
  const mountainRatio = pct('mountain');

  const roughness = 0.4 + Math.abs(forestRatio - waterRatio);
  const elevationVar = 0.5 + mountainRatio;

  const geography = {
    waterTiles: counts.water || 0,
    forestTiles: counts.forest || 0,
    mountainTiles: counts.mountain || 0,
    roughness: +roughness.toFixed(2),
    elevationVar: +elevationVar.toFixed(2),
  };

  const biomes = [];
  if (waterRatio > 0.3)      biomes.push('Archipelago');
  else if (waterRatio < 0.22) biomes.push('Continental');

  if (forestRatio > 0.28)      biomes.push('Dense Forests');
  else if (forestRatio < 0.20) biomes.push('Sparse Forests');

  if (mountainRatio > 0.12) biomes.push('Mountainous');
  if (roughness > 0.6)      biomes.push('Rugged Terrain');
  if (elevationVar > 0.7)   biomes.push('High Elevation Contrast');

  const biome = biomes.length > 0 ? biomes.join(', ') : 'Mixed Terrain';

  return { geography, biome };
}

// ============================================================
//   Core map generation
// ============================================================

function generateMap(height, width, seedStr, rand) {
  const tiles = [];

  // --- base grid
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      tiles.push({
        q,
        r,
        type: 'plains',
        elevation: 0,
        movementCost: terrainTypes.plains.movementCost,
        defense: terrainTypes.plains.defense,
        resource: null,
        feature: null,
        hasRuin: false,
        hasCrashSite: false,
        hasVehicle: false,
        hasForest: false,
        hasRoad: false,
      });
    }
  }

  const keyOf = (q, r) => `${q},${r}`;
  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const inBounds = (q, r) => q >= 0 && q < width && r >= 0 && r < height;

  function neighborsOddR(q, r) {
    const even = (r % 2 === 0);
    return even
      ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
      : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
  }

  function markWater(tile) {
    Object.assign(tile, {
      type: 'water',
      ...terrainTypes.water,
      elevation: 0,
      hasObject: false,
      hasForest: false,
      hasRuin: false,
      hasCrashSite: false,
      hasVehicle: false,
      hasRoad: false,
    });
  }

  function markMountain(tile, elev = 2) {
    Object.assign(tile, {
      type: 'mountain',
      ...terrainTypes.mountain,
      elevation: elev,
    });
  }

  function markForest(tile) {
    tile.hasForest = true;
    if (tile.type === 'plains') {
      tile.type = 'forest';
      tile.movementCost = terrainTypes.forest.movementCost;
      tile.defense = terrainTypes.forest.defense;
      tile.resource = terrainTypes.forest.resource;
    }
  }

  // ------------------------------------------------------------
  // Elevation field (simple value noise / blobs)
  // ------------------------------------------------------------
  const elevField = [];
  for (let r = 0; r < height; r++) {
    elevField[r] = [];
    for (let q = 0; q < width; q++) {
      const nx = q / width;
      const ny = r / height;
      const base = (rand() + rand() + rand()) / 3; // 0..1
      const ridge = Math.abs(0.5 - base) * 2;
      const centerBias = 1 - Math.hypot(nx - 0.5, ny - 0.5);
      let val = 0.3 * base + 0.4 * ridge + 0.3 * centerBias;
      elevField[r][q] = val;
    }
  }

  // Normalize & classify
  let minE = +Infinity, maxE = -Infinity;
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const v = elevField[r][q];
      if (v < minE) minE = v;
      if (v > maxE) maxE = v;
    }
  }
  const rangeE = Math.max(1e-6, maxE - minE);

  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const t = byKey.get(keyOf(q, r));
      let v = (elevField[r][q] - minE) / rangeE; // 0..1

      if (v < 0.25) {
        // deep water / sea
        markWater(t);
      } else if (v < 0.35) {
        // coastal plains
        Object.assign(t, { type: 'plains', ...terrainTypes.plains, elevation: 0 });
      } else if (v < 0.75) {
        // interior plains/forests
        Object.assign(t, { type: 'plains', ...terrainTypes.plains, elevation: 1 });
      } else if (v < 0.9) {
        // hills / highlands
        Object.assign(t, { type: 'plains', ...terrainTypes.plains, elevation: 2 });
      } else {
        // mountains
        markMountain(t, 3);
      }
    }
  }

  // ------------------------------------------------------------
  // Add a main river / lakes (seeded)
  // ------------------------------------------------------------

  // Find a "mountain hub" as a source
  const landTiles = tiles.filter(t => t.type !== 'water');
  const mountainTiles = tiles.filter(t => t.type === 'mountain');

  let hub = null;
  if (mountainTiles.length > 0) {
    let candidate = mountainTiles[Math.floor(rand() * mountainTiles.length)];
    if (!candidate) candidate = mountainTiles[0];
    hub = candidate;
  } else if (landTiles.length > 0) {
    // fallback: any land tile, but still seeded
    const center = landTiles[Math.floor(rand() * landTiles.length)];
    hub = center;
  }

  if (hub) {
    const steps = 40 + Math.floor(rand() * 40);
    let current = hub;

    for (let i = 0; i < steps; i++) {
      const nbs = neighborsOddR(current.q, current.r)
        .map(([dq, dr]) => [current.q + dq, current.r + dr])
        .filter(([qq, rr]) => inBounds(qq, rr));

      if (!nbs.length) break;

      // bias flow roughly "down-hill" with small seeded jitter
      const downhill = [];
      let best = null;
      let bestVal = Infinity;

      for (const [qq, rr] of nbs) {
        const candidate = byKey.get(keyOf(qq, rr));
        if (!candidate) continue;
        const elev = candidate.elevation ?? 0;
        const jitter = rand() * 0.1;
        const score = elev + jitter;
        if (score < bestVal) {
          bestVal = score;
          best = candidate;
        }
        if (elev <= (current.elevation ?? 0)) {
          downhill.push(candidate);
        }
      }

      const next = (downhill.length > 0)
        ? downhill[Math.floor(rand() * downhill.length)]
        : best;

      if (!next) break;
      if (next.type === 'water') {
        current = next;
        continue;
      }

      // mark current → river / lake
      if (current.type !== 'water') {
        markWater(current);
      }
      current = next;
    }
  }

  // ------------------------------------------------------------
  // Forest patches
  // ------------------------------------------------------------
  const forestCandidates = tiles.filter(t =>
    t.type === 'plains' && !['water', 'mountain'].includes(t.type)
  );
  const forestPatchCount = Math.floor(4 + rand() * 6);

  for (let i = 0; i < forestPatchCount; i++) {
    if (!forestCandidates.length) break;
    const idx = Math.floor(rand() * forestCandidates.length);
    const center = forestCandidates[idx];
    if (!center) continue;

    // small blob
    const blobSize = 4 + Math.floor(rand() * 6);
    const queue = [center];
    const seen = new Set([keyOf(center.q, center.r)]);

    for (let j = 0; j < blobSize && queue.length; j++) {
      const cur = queue.shift();
      if (!cur) break;

      markForest(cur);

      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const qq = cur.q + dq, rr = cur.r + dr;
        if (!inBounds(qq, rr)) continue;
        const k = keyOf(qq, rr);
        if (seen.has(k)) continue;
        const n = byKey.get(k);
        if (!n || n.type !== 'plains') continue;
        if (rand() < 0.6) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
  }

  // ------------------------------------------------------------
  // Roads & world objects (delegated, but still seeded)
  // ------------------------------------------------------------
  const { objects, roads } = generateWorldObjectsForSeed(tiles, width, height, rand);

  // Attach helper so callers can access objects/roads
  tiles.__worldObjects = objects;
  tiles.__roads = roads;

  // Summarize world meta (for lobby preview)
  const worldMeta = computeWorldSummaryFromTiles(tiles, width, height);
  Object.defineProperty(tiles, '__worldMeta', { value: worldMeta, enumerable: false });

  return tiles;
}

// ============================================================
//   Objects / POIs (forests/ruins/vehicles/roads)
//   All seeded via the `rand` passed from generateMap.
// ============================================================

function generateWorldObjectsForSeed(tiles, width, height, rand) {
  const keyOf = (q, r) => `${q},${r}`;
  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const inBounds = (q, r) => q >= 0 && q < width && r >= 0 && r < height;

  function neighborsOddR(q, r) {
    const even = (r % 2 === 0);
    return even
      ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
      : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
  }

  const objects = [];
  const roads = [];

  // --- Example: ruins / crashsites / vehicles, all seeded via rand() ---
  const landTiles = tiles.filter(t => t.type !== 'water' && t.type !== 'mountain');
  const ruinCount = Math.min(5, Math.max(2, Math.floor(rand() * 6)));
  const crashCount = Math.min(4, Math.max(1, Math.floor(rand() * 5)));
  const vehicleCount = Math.min(3, Math.max(1, Math.floor(rand() * 4)));

  function pickRandomLandTile() {
    if (!landTiles.length) return null;
    const idx = Math.floor(rand() * landTiles.length);
    return landTiles[idx] || null;
  }

  // Ruins
  for (let i = 0; i < ruinCount; i++) {
    const tile = pickRandomLandTile();
    if (!tile) break;
    tile.hasRuin = true;
    objects.push({
      type: 'ruin',
      q: tile.q,
      r: tile.r,
    });
  }

  // Crash sites
  for (let i = 0; i < crashCount; i++) {
    const tile = pickRandomLandTile();
    if (!tile) break;
    tile.hasCrashSite = true;
    objects.push({
      type: 'crash_site',
      q: tile.q,
      r: tile.r,
    });
  }

  // Vehicles
  for (let i = 0; i < vehicleCount; i++) {
    const tile = pickRandomLandTile();
    if (!tile) break;
    tile.hasVehicle = true;
    objects.push({
      type: 'vehicle_wreck',
      q: tile.q,
      r: tile.r,
    });
  }

  // --- Road stubs / connections — seeded ---
  function addRoadSegment(q, r) {
    const t = byKey.get(keyOf(q, r));
    if (!t) return;
    t.hasRoad = true;
    roads.push({ q, r });
  }

  // simple radial roads from center
  if (landTiles.length > 0) {
    const centerIdx = Math.floor(rand() * landTiles.length);
    const center = landTiles[centerIdx] || landTiles[0];

    const queue = [center];
    const seen = new Set([keyOf(center.q, center.r)]);
    const maxRoads = 80 + Math.floor(rand() * 40);

    while (queue.length && roads.length < maxRoads) {
      const cur = queue.shift();
      addRoadSegment(cur.q, cur.r);

      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const qq = cur.q + dq, rr = cur.r + dr;
        if (!inBounds(qq, rr)) continue;
        const k = keyOf(qq, rr);
        if (seen.has(k)) continue;
        const tt = byKey.get(k);
        if (!tt || tt.type === 'water' || tt.type === 'mountain') continue;

        if (rand() < 0.5) {
          seen.add(k);
          queue.push(tt);
        }
      }
    }
  }

  return { objects, roads };
}

// ============================================================
//   HexMap class wrapper
// ============================================================

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
