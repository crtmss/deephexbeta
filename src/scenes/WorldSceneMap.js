// deephexbeta/src/scenes/WorldSceneMap.js
import HexMap from '../engine/HexMap.js';

/**
 * Generate map with a dynamic water border (1–4 hexes thick per edge)
 */
export function generateHexMap(width, height, seed) {
  const hexMap = new HexMap(width, height, seed);
  const raw = hexMap.getMap();
  const left = Phaser.Math.Between(1, 4);
  const right = Phaser.Math.Between(1, 4);
  const top = Phaser.Math.Between(1, 4);
  const bottom = Phaser.Math.Between(1, 4);

  return raw.map(h => {
    const { q, r } = h;
    if (q < left || q >= width - right || r < top || r >= height - bottom) {
      return { ...h, type: 'water' };
    }
    return h;
  });
}

/**
 * Draw the hex grid and place scenic object sprites based on tile data
 */
export function drawHexMap() {
  this.objects = this.objects || [];

  this.mapData.forEach(hex => {
    const { q, r, type, hasTree, hasRuin } = hex;
    const { x, y } = this.hexToPixel(q, r, this.hexSize);
    const color = this.getColorForTerrain(type);
    this.drawHex(q, r, x, y, this.hexSize, color);

    if (hasTree) {
      const tree = this.add.text(x, y, '🌲', {
        fontSize: `${this.hexSize * 0.9}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(tree);
    }

    if (hasRuin) {
      const ruin = this.add.text(x, y, '🏛️', {
        fontSize: `${this.hexSize * 0.9}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(ruin);
    }
  });
}

/**
 * Hex → pixel conversion (with padding)
 */
export function hexToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y = size * 1.5 * r;
  return { x: x + size * 2, y: y + size * 2 };
}

/**
 * Pixel → hex conversion + round
 */
export function pixelToHex(x, y, size) {
  x -= size * 2;
  y -= size * 2;
  const r = y / (size * 1.5);
  const q = (x - ((Math.floor(r) & 1) * size * Math.sqrt(3) / 2)) / (size * Math.sqrt(3));
  return roundHex(q, r);
}

/**
 * Cube coordinate rounding
 */
export function roundHex(q, r) {
  const x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/**
 * Draw one hexagon (as polygon)
 */
export function drawHexMap() {
  this.objects = this.objects || [];

  this.mapData.forEach(hex => {
    const { q, r, type, hasForest, hasRuin } = hex;
    const { x, y } = this.hexToPixel(q, r, this.hexSize);
    const color = this.getColorForTerrain(type);
    this.drawHex(q, r, x, y, this.hexSize, color);

    // FOREST CLUSTER: 2-4 trees
    if (hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      for (let i = 0; i < treeCount; i++) {
        const angle = Phaser.Math.FloatBetween(0, 2 * Math.PI);
        const radius = Phaser.Math.FloatBetween(2, this.hexSize * 0.3); // within hex
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;

        const sizePercent = 0.45 + Phaser.Math.FloatBetween(-0.05, 0.05); // 40-50% size
        const size = this.hexSize * sizePercent;

        const emoji = this.add.text(x + dx, y + dy, '🌲', {
          fontSize: `${size}px`
        }).setOrigin(0.5).setDepth(2);

        this.objects.push(emoji);
      }
    }

    // SINGLE RUIN ICON
    if (hasRuin) {
      const ruin = this.add.text(x, y, '🏛️', {
        fontSize: `${this.hexSize * 0.9}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(ruin);
    }
  });
}

/**
 * Terrain color map
 */
export function getColorForTerrain(terrain) {
  switch (terrain) {
    case 'grassland': return 0x34a853;
    case 'sand': return 0xFFF59D;
    case 'mud': return 0x795548;
    case 'swamp': return 0x4E342E;
    case 'mountain': return 0x9E9E9E;
    case 'water': return 0x4da6ff;
    default: return 0x888888;
  }
}
