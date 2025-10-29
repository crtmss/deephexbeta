// src/scenes/WorldSceneMap.js
import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

export const LIFT_PER_LVL = 4;

// Isometry
const ISO_SHEAR  = 0.15;
const ISO_YSCALE = 0.95;

// IMPORTANT: no snapping — keeps shared vertices identical, no micro gaps.
const pt = (x, y) => ({ x, y });

/* ---------- terrain palette ---------- */
export function getColorForTerrain(terrain) {
  switch (terrain) {
    case 'grassland': return 0x3caf5a;
    case 'sand':      return 0xFFF5B8;
    case 'mud':       return 0x7E5A48;
    case 'swamp':     return 0x5B463F;
    case 'mountain':  return 0xA0A0A0;
    case 'water':     return 0x54aafc;
    default:          return 0x8e8e8e;
  }
}

/* ---------- elevation helpers ---------- */
export function effectiveElevation(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}
function darkenRGBInt(baseInt, factor) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const r = Math.round(c.r * factor);
  const g = Math.round(c.g * factor);
  const b = Math.round(c.b * factor);
  return Phaser.Display.Color.GetColor(r, g, b);
}
function tintWallFromBase(baseInt, amount = 0.80) {
  // amount < 1 → darker; 0.80 is ~20% darker
  return darkenRGBInt(baseInt, amount);
}

/* ---------- axial odd-r neighbors ---------- */
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

/* ---------- projection utilities ---------- */
export function hexToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y = size * 1.5 * r;
  const xIso = x - y * ISO_SHEAR;
  const yIso = y * ISO_YSCALE;
  return { x: xIso, y: yIso };
}
export function isoOffset(x, y) {
  return { x: x - y * ISO_SHEAR, y: y * ISO_YSCALE };
}
export function pixelToHex(screenX, screenY, size) {
  const y0 = screenY / ISO_YSCALE;
  const x0 = screenX + y0 * ISO_SHEAR;
  const r = y0 / (size * 1.5);
  const q = (x0 / (Math.sqrt(3) * size)) - 0.5 * (Math.floor(r) & 1);
  return { q, r };
}
export function roundHex(qf, rf) {
  const x = qf, z = rf, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz)       ry = -rx - rz;
  else                    rz = -rx - ry;
  return { q: rx, r: rz };
}

/* ---------- generation ---------- */
export function generateHexMap(width, height, seed) {
  const hexMap = new HexMap(width, height, seed);
  const raw = hexMap.getMap();
  // keep the border-frame behavior you had
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

/* ---------- walls (cliffs) ---------- */
function drawHexWall(scene, edgePtsTop, dropPx, wallColor) {
  const [A, B] = edgePtsTop;
  const A2 = pt(A.x, A.y + dropPx);
  const B2 = pt(B.x, B.y + dropPx);

  const g = scene.add.graphics().setDepth(3); // above face, under rim
  g.fillStyle(wallColor, 1); // OPAQUE
  g.beginPath();
  g.moveTo(A.x, A.y);
  g.lineTo(B.x, B.y);
  g.lineTo(B2.x, B2.y);
  g.lineTo(A2.x, A2.y);
  g.closePath();
  g.fillPath();
  return g;
}

/* ---------- face + frame ---------- */
export function drawHex(q, r, xIso, yIso, size, fillColor, effElevation, terrain) {
  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;

  const d = [
    { dx: 0,  dy: -size }, // 0 top
    { dx: +w, dy: -h    }, // 1 top-right
    { dx: +w, dy: +h    }, // 2 bottom-right (screen-facing)
    { dx: 0,  dy: +size }, // 3 bottom
    { dx: -w, dy: +h    }, // 4 bottom-left  (screen-facing)
    { dx: -w, dy: -h    }, // 5 top-left
  ];

  const ring = d.map(({dx,dy}) => {
    const off = isoOffset(dx, dy);
    return pt(xIso + off.x, yIso + off.y);
  });

  // face
  const face = this.add.graphics().setDepth(2);
  face.fillStyle(fillColor, 1);
  face.beginPath();
  face.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < 6; i++) face.lineTo(ring[i].x, ring[i].y);
  face.closePath();
  face.fillPath();

  // cliffs (opaque, darker) only on edges 2 & 4 if neighbor lower
  const neighborCoords = neighborsOddR(q, r);
  const dropPerLvl = LIFT_PER_LVL;
  const wallColor  = tintWallFromBase(fillColor, 0.80);
  const cliffEdges = [2, 4];

  const walls = [];
  for (const e of cliffEdges) {
    const [dq, dr] = neighborCoords[e];
    const n = this.tileAt?.(q + dq, r + dr);
    if (!n) continue;
    const effN = effectiveElevation(n);
    const diff = effElevation - effN;
    if (diff <= 0) continue;

    const A = ring[e];
    const B = ring[(e + 1) % 6];
    const g = drawHexWall(this, [A, B], diff * dropPerLvl, wallColor);
    walls.push(g);
  }

  // full rim (thin, darker) over everything → no missing edges
  const rim = this.add.graphics().setDepth(4);
  const rimColor = darkenRGBInt(fillColor, 0.75);
  rim.lineStyle(1.25, rimColor, 1);
  rim.beginPath();
  rim.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < 6; i++) rim.lineTo(ring[i].x, ring[i].y);
  rim.closePath();
  rim.strokePath();

  rim._walls = walls;
  return { face, rim, ring };
}

/* ---------- fill color with elevation lift ---------- */
function getFillForTile(tile) {
  const baseColor = getColorForTerrain(tile.type);
  if (tile.type === 'water') return baseColor;
  const elevation = tile.elevation ?? 0;
  const t = Math.min(0.55, Math.max(0, elevation) * 0.08);
  const base = Phaser.Display.Color.IntegerToColor(baseColor);
  const r = Math.round(base.r + (255 - base.r) * t);
  const g = Math.round(base.g + (255 - base.g) * t);
  const b = Math.round(base.b + (255 - base.b) * t);
  return Phaser.Display.Color.GetColor(r, g, b);
}

/* ---------- hover outline ---------- */
function drawHexOutline(scene, xIso, yIso, size, color = 0xffffff) {
  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;
  const d = [
    { dx: 0,  dy: -size },
    { dx: +w, dy: -h    },
    { dx: +w, dy: +h    },
    { dx: 0,  dy: +size },
    { dx: -w, dy: +h    },
    { dx: -w, dy: -h    },
  ];
  const ring = d.map(({dx,dy}) => {
    const off = isoOffset(dx, dy);
    return pt(xIso + off.x, yIso + off.y);
  });
  const g = scene.add.graphics().setDepth(10002);
  g.lineStyle(3, color, 1);
  g.beginPath();
  g.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < 6; i++) g.lineTo(ring[i].x, ring[i].y);
  g.closePath();
  g.strokePath();
  return g;
}

/* ---------- main renderer ---------- */
export function drawHexMap() {
  this.objects = this.objects || [];
  if (this.mapContainer) { this.mapContainer.destroy(true); this.mapContainer = null; }
  this.mapContainer = this.add.container(0, 0).setDepth(1);

  const padX = this.hexSize * 2;
  const padY = this.hexSize * 2;

  const cam = this.cameras?.main;
  const camW = cam?.width ?? 800;
  const gridW = this.mapWidth * this.hexSize * Math.sqrt(3);
  const isoW  = gridW + (this.mapHeight * this.hexSize * 1.5) * ISO_SHEAR;
  const offsetX = Math.floor((camW - isoW) * 0.5) + padX;
  const offsetY = 20 + padY;

  this.mapOffsetX = offsetX;
  this.mapOffsetY = offsetY;

  const byKey = new Map(this.mapData.map(t => [`${t.q},${t.r}`, t]));
  this.tileAt = (q, r) => byKey.get(`${q},${r}`);

  const sorted = [...this.mapData].sort((a, b) => {
    const ea = effectiveElevation(a);
    const eb = effectiveElevation(b);
    if (ea !== eb) return ea - eb;
    const da = (a.q + a.r) - (b.q + b.r);
    if (da !== 0) return da;
    if (a.r !== b.r) return a.r - b.r;
    return a.q - b.q;
  });

  for (const hex of sorted) {
    const { q, r } = hex;
    const eff = effectiveElevation(hex);
    const p  = hexToPixel(q, r, this.hexSize);
    const x  = p.x + offsetX;
    const y  = p.y + offsetY - LIFT_PER_LVL * eff;

    const fillColor = getFillForTile(hex);
    const { face, rim } = drawHex.call(this, q, r, x, y, this.hexSize, fillColor, eff, hex.type);
    this.mapContainer.add(face);
    if (rim._walls) rim._walls.forEach(w => this.mapContainer.add(w)); // cliffs above face
    this.mapContainer.add(rim); // rim on top to cover seams
  }

  drawLocationsAndRoads.call(this);

  if (this.hoverOutline) { this.hoverOutline.destroy(); this.hoverOutline = null; }
  this.input?.on('pointermove', (pointer) => {
    const worldX = pointer.worldX - this.mapOffsetX;
    const worldY = pointer.worldY - this.mapOffsetY;

    const frac = pixelToHex(worldX, worldY, this.hexSize);
    const axial = roundHex(frac.q, frac.r);
    const tile = this.tileAt(axial.q, axial.r);
    if (!tile) {
      if (this.hoverOutline) { this.hoverOutline.destroy(); this.hoverOutline = null; }
      return;
    }

    const eff = effectiveElevation(tile);
    const p   = hexToPixel(axial.q, axial.r, this.hexSize);
    const x   = p.x + this.mapOffsetX;
    const y   = p.y + this.mapOffsetY - LIFT_PER_LVL * eff;

    if (this.hoverOutline) this.hoverOutline.destroy();
    this.hoverOutline = drawHexOutline(this, x, y, this.hexSize, 0xffffff);
    this.tweens.add({
      targets: this.hoverOutline,
      alpha: { from: 1, to: 0.25 },
      duration: 160,
      ease: 'Sine.easeOut'
    });
  });
}

export default {
  LIFT_PER_LVL,
  isoOffset,
  hexToPixel,
  pixelToHex,
  roundHex,
  effectiveElevation,
  getColorForTerrain,
  drawHex,
  drawHexMap,
  generateHexMap,
};
