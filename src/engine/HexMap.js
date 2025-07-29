// deephexbeta/src/engine/HexMap.js

// HexMap.js - Generates hex island map with terrain
import { cyrb128, sfc32 } from './PRNG.js';

const terrainTypes = {
  grassland: { movementCost: 1, color: '#34a853' },
  sand: { movementCost: 2, color: '#FFF59D' },
  mud: { movementCost: 3, color: '#795548' },
  mountain: { movementCost: Infinity, color: '#9E9E9E', impassable: true },
  water: { movementCost: Infinity, color: '#4da6ff', impassable: true },
  swamp: { movementCost: 3, color: '#4E342E' }
};

function seededRandom(seed) {
  if (!seed || typeof seed !== 'string') seed = 'defaultseed';
  let x = 0;
  for (let i = 0; i < seed.length; i++) x += seed.charCodeAt(i);
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

function generateMap(rows = 25, cols = 25, seed = 'defaultseed') {
  const rand = seededRandom(seed);
  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, q) => ({
      q,
      r,
      type: 'grassland',
      movementCost: terrainTypes.grassland.movementCost,
      impassable: false
    }))
  );

  // Add water borders
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      if (r < 2 || r >= rows - 2 || q < 2 || q >= cols - 2) {
        const tile = map[r][q];
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
    let placedTotal = 0;
    let attempts = 0;

    for (let i = 0; i < instances; i++) {
      let size = minSize + Math.floor(rand() * (maxSize - minSize + 1));
      let placed = 0;
      attempts = 0;

      while (placed < size && attempts < 500) {
        const q = Math.floor(rand() * cols);
        const r = Math.floor(rand() * rows);
        const tile = map[r][q];

        if (tile.type !== 'grassland') {
          attempts++;
          continue;
        }

        const queue = [[q, r]];
        let count = 0;

        while (queue.length && placed < size) {
          const [x, y] = queue.shift();
          const t = map[y][x];
          if (t.type === 'grassland') {
            Object.assign(t, { type, ...terrainTypes[type] });
            placed++;
            placedTotal++;
            count++;
          }

          if (count < size) {
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

  // Smaller but more frequent biomes
  placeBiome('mud', 5, 9, 4);
  placeBiome('sand', 5, 9, 4);
  placeBiome('swamp', 5, 9, 3);

  // Mountains
  const mountainChains = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < mountainChains; i++) {
    let q = Math.floor(rand() * (cols - 4)) + 2;
    let r = Math.floor(rand() * (rows - 4)) + 2;
    const length = 3 + Math.floor(rand() * 3);

    for (let j = 0; j < length; j++) {
      const tile = map[r][q];

      const distFromP1 = Math.sqrt((q - 2) ** 2 + (r - 2) ** 2);
      const distFromP2 = Math.sqrt((q - cols + 2) ** 2 + (r - rows + 2) ** 2);

      if (tile.type === 'grassland' && distFromP1 > 3 && distFromP2 > 3) {
        Object.assign(tile, { type: 'mountain', ...terrainTypes.mountain });
      }

      const nbs = neighbors(q, r);
      if (nbs.length) {
        const [nq, nr] = nbs[Math.floor(rand() * nbs.length)];
        q = nq;
        r = nr;
      }
    }
  }

  // === ADD TREES AND RUINS ===
  const flatMap = map.flat();

  // Trees on grassland or mud
  const treeCandidates = flatMap.filter(t => ['grassland', 'mud'].includes(t.type));
  Phaser.Utils.Array.Shuffle(treeCandidates);
  treeCandidates.slice(0, 30).forEach(tile => tile.hasTree = true);

  // Ruins on sand or swamp
  const ruinCandidates = flatMap.filter(t => ['sand', 'swamp'].includes(t.type));
  Phaser.Utils.Array.Shuffle(ruinCandidates);
  ruinCandidates.slice(0, 20).forEach(tile => tile.hasRuin = true);

  return flatMap;
}

export default class HexMap {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.map = [];
    this.generateMap();
  }

  generateMap() {
    const randSeed = cyrb128(this.seed);
    const rand = sfc32(...randSeed);
    this.map = generateMap(this.width, this.height, rand);
  }

  getMap() {
    return this.map;
  }
}
