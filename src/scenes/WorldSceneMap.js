// deephexbeta/src/scenes/WorldSceneMap.js

import HexMap from '../engine/HexMap.js';

// helper: generate map data
export function generateHexMap(width, height, seed) {
    const hexMap = new HexMap(width, height, seed);
    const raw = hexMap.getMap();

    // apply random water buffer at edges
    const border = Phaser.Math.Between(1, 4);
    return raw.map(h => {
        const { q, r } = h;
        if (
            q < border ||
            r < border ||
            q >= width - border ||
            r >= height - border
        ) {
            return { q: h.q, r: h.r, type: 'water' };
        }
        return h;
    });
}

// draw map hexes plus random objects
export function drawHexMap() {
    this.objects = this.objects || [];

    this.mapData.forEach(hex => {
        const { q, r, type } = hex;
        const { x, y } = this.hexToPixel(q, r, this.hexSize);
        const color = this.getColorForTerrain(type);
        this.drawHex(q, r, x, y, this.hexSize, color);

        // spawn random scenery on non-water terrain
        if (type !== 'water' && Phaser.Math.FloatBetween(0, 1) < 0.08) {
            // tree or ruin?
            const obj = Phaser.Math.FloatBetween(0, 1) < 0.7 ? 'tree' : 'ruin';
            const sprite = this.add.sprite(x, y, obj).setScale(this.hexSize/32).setDepth(20);
            this.objects.push(sprite);
        }
    });
}

// coordinate conversions
export function hexToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y = size * 1.5 * r;
  return { x: x + 48, y: y + 48 }; // was +32, bump to +48
}

export function pixelToHex(x, y, size) {
    x -= 32;
    y -= 32;
    const r = y / (size * 1.5);
    const q = (x - (Math.floor(r) & 1) * size * Math.sqrt(3) / 2) / (size * Math.sqrt(3));
    return roundHex(q, r);
}

// rounding logic
export function roundHex(q, r) {
    const x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
}

// keep drawHex unchanged
export function drawHex(q, r, x, y, size, color) {
    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.lineStyle(1, 0x000000);
    graphics.fillStyle(color, 1);
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = Phaser.Math.DegToRad(60 * i + 30);
        corners.push({ x: x + size * Math.cos(angle), y: y + size * Math.sin(angle) });
    }
    graphics.beginPath();
    graphics.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(c => graphics.lineTo(c.x, c.y));
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
    this.tileMap[`${q},${r}`] = graphics;
}

// unchanged terrain colors
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
