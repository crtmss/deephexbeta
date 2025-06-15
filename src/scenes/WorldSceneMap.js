import HexMap from '../engine/HexMap.js';

export function generateHexMap(width, height, seed) {
    const hexMap = new HexMap(width, height, seed);
    return hexMap.getMap();
}

export function drawHexMap() {
    this.mapData.forEach(hex => {
        const { q, r, type } = hex;
        const { x, y } = this.hexToPixel(q, r, this.hexSize);
        const color = this.getColorForTerrain(type);
        this.drawHex(q, r, x, y, this.hexSize, color);
    });
}

export function hexToPixel(q, r, size) {
    const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
    const y = size * 1.5 * r;
    // Add padding to ensure the full map fits inside bounds
    return { x: x + 32, y: y + 32 };
}

export function pixelToHex(x, y, size) {
    // Match the offset from hexToPixel
    x -= 32;
    y -= 32;
    const r = y / (size * 1.5);
    const q = (x - (r & 1) * size * Math.sqrt(3) / 2) / (size * Math.sqrt(3));
    return roundHex(q, r);
}

export function roundHex(q, r) {
    const x = q;
    const z = r;
    const y = -x - z;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
}

export function drawHex(q, r, x, y, size, color) {
    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.lineStyle(1, 0x000000);
    graphics.fillStyle(color, 1);
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = Phaser.Math.DegToRad(60 * i + 30);
        const px = x + size * Math.cos(angle);
        const py = y + size * Math.sin(angle);
        corners.push({ x: px, y: py });
    }
    graphics.beginPath();
    graphics.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
        graphics.lineTo(corners[i].x, corners[i].y);
    }
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
    this.tileMap[`${q},${r}`] = graphics;
}

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
