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
 * Return neighboring axial coordinates (odd-r offset layout)
 */
function getHexNeighbors(q, r) {
  const directions = (r % 2 === 0)
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
  return directions.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/**
 * Draw the hex grid and place scenic object sprites based on tile data
 */
export function drawHexMap() {
  this.objects = this.objects || [];

  this.mapData.forEach(hex => {
    const {
      q, r, type,
      hasForest, hasRuin, hasCrashSite, hasVehicle,
      hasRoad, hasMountainIcon
    } = hex;

    const { x, y } = this.hexToPixel(q, r, this.hexSize);
    const color = this.getColorForTerrain(type);
    this.drawHex(q, r, x, y, this.hexSize, color);

    // 🌲 FOREST CLUSTER: 2–4 non-overlapping animated trees
    if (hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;

      while (placed.length < treeCount && attempts < 40) {
        const angle = Phaser.Math.FloatBetween(0, 2 * Math.PI);
        const radius = Phaser.Math.FloatBetween(this.hexSize * 0.35, this.hexSize * 0.65);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const posX = x + dx;
        const posY = y + dy;
        const minDist = this.hexSize * 0.3;

        const tooClose = placed.some(p => {
          const dist = Phaser.Math.Distance.Between(posX, posY, p.x, p.y);
          return dist < minDist;
        });

        if (!tooClose) {
          const sizePercent = 0.45 + Phaser.Math.FloatBetween(-0.05, 0.05);
          const size = this.hexSize * sizePercent;

          const tree = this.add.text(posX, posY, '🌲', {
            fontSize: `${size}px`
          }).setOrigin(0.5).setDepth(2);

          this.tweens.add({
            targets: tree,
            angle: { from: -1.5, to: 1.5 },
            duration: Phaser.Math.Between(2500, 4000),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Phaser.Math.Between(0, 1000)
          });

          this.objects.push(tree);
          placed.push({ x: posX, y: posY });
        }
        attempts++;
      }
    }

    // 🏛️ RUINS
    if (hasRuin) {
      const ruin = this.add.text(x, y, '🏛️', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(ruin);
    }

    // 🚀 CRASHED SPACECRAFT
    if (hasCrashSite) {
      const rocket = this.add.text(x, y, '🚀', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(rocket);
    }

    // 🚙 ABANDONED VEHICLE
    if (hasVehicle) {
      const vehicle = this.add.text(x, y, '🚙', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(vehicle);
    }

    // ⛰️ MOUNTAIN ICON
    if (hasMountainIcon) {
      const mountain = this.add.text(x, y, '⛰️', {
        fontSize: `${this.hexSize * 0.9}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(mountain);
    }

    // 🛣️ Draw connecting lines for ancient roads
    if (hasRoad) {
      const neighbors = getHexNeighbors(q, r)
        .map(n => this.mapData.find(h => h.q === n.q && h.r === n.r && h.hasRoad))
        .filter(Boolean);

      neighbors.forEach(n => {
        const p1 = this.hexToPixel(q, r, this.hexSize);
        const p2 = this.hexToPixel(n.q, n.r, this.hexSize);
        const line = this.add.graphics().setDepth(1);
        line.lineStyle(2, 0x999999, 0.6);
        line.beginPath();
        line.moveTo(p1.x, p1.y);
        line.lineTo(p2.x, p2.y);
        line.strokePath();
        this.objects.push(line);
      });
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
