// deephexbeta/src/engine/HexMap.js

import { cyrb128, sfc32 } from './PRNG.js';

const terrainTypes = {
  grassland: { movementCost: 1, color: '#34a853' },
  sand: { movementCost: 2, color: '#FFF59D' },
  mud: { movementCost: 3, color: '#795548' },
  mountain: { movementCost: Infinity, color: '#9E9E9E', impassable: true },
  water: { movementCost: Infinity, color: '#4da6ff', impassable: true },
  swamp: { movementCost: 3, color: '#4E342E' }
};

// Hex directions in odd-r layout (pointy top)
const directions = [
  [+1,  0], [0, -1], [-1, -1],
  [-1,  0], [0, +1], [+1, +1]
];

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
      impassable: false,
      cliffs: [false, false, false, false, false, false]  // 6 directions
    }))
  );

  const centerQ = cols / 2;
  const centerR = rows / 2;
  const maxRadius = Math.min(centerQ, centerR) - 2;

  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const tile = map[r][q];
      const dx = q - centerQ;
      const dy = r - centerR;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const noise = rand() * 2.2;

      if (dist + noise > maxRadius) {
        Object.assign(tile, { type: 'water', ...terrainTypes.water });
      }
    }
  }

  function neighbors(q, r) {
    return directions
      .map(([dq, dr], dir) => ({ dir, q: q + dq, r: r + dr }))
      .filter(({ q, r }) => map[r] && map[r][q])
      .map(({ dir, q, r }) => ({ dir, tile: map[r][q] }));
  }

  function placeBiome(type, minSize, maxSize, instances) {
    for (let i = 0; i < instances; i++) {
      let size = minSize + Math.floor(rand() * (maxSize - minSize + 1));
      let placed = 0;
      let attempts = 0;

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
            count++;
          }

          if (count < size) {
neighbors(x, y).forEach(([nx, ny]) => {
  const nTile = map[ny]?.[nx];
  if (nTile?.type === 'grassland') {
    queue.push([nx, ny]);
  }
});
          }
        }

        break;
      }
    }
  }

  placeBiome('mud', 5, 9, 4);
  placeBiome('sand', 5, 9, 4);
  placeBiome('swamp', 5, 9, 3);

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

      const nbs = neighbors(q, r).map(n => n.tile);
      if (nbs.length) {
        const next = nbs[Math.floor(rand() * nbs.length)];
        q = next.q;
        r = next.r;
      }
    }
  }

  // 🧱 Generate cliffs (30% chance per side)
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const tile = map[r][q];
      directions.forEach(([dq, dr], dir) => {
        const nq = q + dq;
        const nr = r + dr;
        const neighbor = map[nr]?.[nq];
        if (!neighbor) return;

        // Prevent double assignment
        const oppositeDir = (dir + 3) % 6;
        if (!tile.cliffs[dir] && !neighbor.cliffs[oppositeDir] && rand() < 0.12) {
          tile.cliffs[dir] = true;
          neighbor.cliffs[oppositeDir] = true;
        }
      });
    }
  }

  const flatMap = map.flat();

  const mark = (tile, key) => {
    tile[key] = true;
    tile.hasObject = true;
  };

  const isFree = t => !t.hasObject && !['mountain', 'water'].includes(t.type);

  const forestCandidates = flatMap.filter(t => ['grassland', 'mud'].includes(t.type));
  Phaser.Utils.Array.Shuffle(forestCandidates);
  forestCandidates.slice(0, 39).forEach(t => t.hasForest = true);

  const ruinCandidates = flatMap.filter(t => ['sand', 'swamp'].includes(t.type) && isFree(t));
  Phaser.Utils.Array.Shuffle(ruinCandidates);
  ruinCandidates.slice(0, Phaser.Math.Between(2, 3)).forEach(t => mark(t, 'hasRuin'));

  const crashCandidates = flatMap.filter(isFree);
  Phaser.Utils.Array.Shuffle(crashCandidates);
  crashCandidates.slice(0, Phaser.Math.Between(2, 3)).forEach(t => mark(t, 'hasCrashSite'));

  const vehicleCandidates = flatMap.filter(t => t.type === 'grassland' && isFree(t));
  Phaser.Utils.Array.Shuffle(vehicleCandidates);
  vehicleCandidates.slice(0, Phaser.Math.Between(2, 3)).forEach(t => mark(t, 'hasVehicle'));

  const roadTiles = flatMap.filter(t => !['water', 'mountain'].includes(t.type) && !t.hasObject);
  Phaser.Utils.Array.Shuffle(roadTiles);

  const roadPaths = Phaser.Math.Between(2, 3);
  let totalRoadLength = Phaser.Math.Between(7, 19);
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
      const dirs = directions;
      Phaser.Utils.Array.Shuffle(dirs);

      for (const [dq, dr] of dirs) {
        const nq = current.q + dq;
        const nr = current.r + dr;
        const neighbor = flatMap.find(t => t.q === nq && t.r === nr);
        if (neighbor && !usedTiles.has(`${nq},${nr}`) && !['water', 'mountain'].includes(neighbor.type) && !neighbor.hasObject) {
          neighbor.hasRoad = true;
          usedTiles.add(`${nq},${nr}`);
          queue.push(neighbor);
          remaining--;
          break;
        }
      }
    }
  }

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
