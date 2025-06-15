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
      return { q, r, type: 'water' };
    }
    return h;
  });
}

/**
 * Draw the hex grid and scatter scenic sprites
 */
export function drawHexMap() {
  this.objects = this.objects || [];

  this.mapData.forEach(hex => {
    const { q, r, type } = hex;
    const { x, y } = this.hexToPixel(q, r, this.hexSize);
    const color = this.getColorForTerrain(type);
    this.drawHex(q, r, x, y, this.hexSize, color);

    // Random scenic objects
    if (type !== 'water' && Phaser.Math.FloatBetween(0, 1) < 0.08) {
      const key = Phaser.Math.FloatBetween(0, 1) < 0.7 ? 'tree' : 'ruin';
      const sprite = this.add.sprite(x, y, key)
        .setScale(this.hexSize / 32)
        .setDepth(20)
        .setOrigin(0.5, 0.6);
      this.objects.push(sprite);
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
export function drawHex(q, r, x, y, size, color) {
  const gfx = this.add.graphics({ x: 0, y: 0 });
  gfx.lineStyle(1, 0x000000);
  gfx.fillStyle(color, 1);
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const ang = Phaser.Math.DegToRad(60 * i + 30);
    corners.push({ x: x + size * Math.cos(ang), y: y + size * Math.sin(ang) });
  }
  gfx.beginPath();
  gfx.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach(c => gfx.lineTo(c.x, c.y));
  gfx.closePath();
  gfx.fillPath();
  gfx.strokePath();
  this.tileMap[`${q},${r}`] = gfx;
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
