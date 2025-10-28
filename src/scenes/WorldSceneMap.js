// src/scenes/WorldSceneMap.js
// Keeps main (24) tile visuals. Adds reliable containerized draw (no duplicates)
// and hover hex outline. (No change to visuals; roads drawn from Locations module.)

import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

export const LIFT_PER_LVL = 4;
const ISO_SHEAR  = 0.15;
const ISO_YSCALE = 0.95;

const SNAP = v => Math.round(v * 2) / 2;
const pt   = (x, y) => ({ x: SNAP(x), y: SNAP(y) });

/* palette (unchanged) */
export function getColorForTerrain(terrain) {
  switch (terrain) {
    case 'grassland': return 0x34a853;
    case 'sand':      return 0xFFF59D;
    case 'mud':       return 0x795548;
    case 'swamp':     return 0x4E342E;
    case 'mountain':  return 0x9E9E9E;
    case 'water':     return 0x4da6ff;
    default:          return 0x888888;
  }
}

/* elevation */
export function effectiveElevation(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}

function darkenRGBInt(baseInt, factor) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const r = Math.max(0, Math.min(255, Math.round(c.r * factor)));
  const g = Math.max(0, Math.min(255, Math.round(c.g * factor)));
  const b = Math.max(0, Math.min(255, Math.round(c.b * factor)));
  return Phaser.Display.Color.GetColor(r, g, b);
}

function tintWallFromBase(baseInt, darkness = 0.18) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const hsv = Phaser.Display.Color.RGBToHSV(c.r, c.g, c.b);
  const v = Math.max(0.35, Math.min(1, hsv.v - darkness));
  const rgb = Phaser.Display.Color.HSVToRGB(hsv.h, hsv.s, v);
  return Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
}

/* axial odd-r */
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

/* isometric transforms */
export function isoOffset(dx, dy) {
  return { x: dx - dy * ISO_SHEAR, y: dy * ISO_YSCALE };
}

export function hexToPixel(q, r, size) {
  const x0 = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y0 = size * 1.5 * r;
  const xIso = x0 - y0 * ISO_SHEAR;
  const yIso = y0 * ISO_YSCALE;
  return { x: xIso + size * 2, y: yIso + size * 2 };
}

export function pixelToHex(x, y, size) {
  x -= size * 2;
  y -= size * 2;
  const r = y / (size * 1.5 * ISO_YSCALE);
  const xUnShear = x + (y / ISO_YSCALE) * ISO_SHEAR;
  const q = (xUnShear - ((Math.floor(r) & 1) * size * Math.sqrt(3) / 2)) / (size * Math.sqrt(3));
  return { q, r };
}

// axial rounding via cube rounding
export function roundHex(qf, rf) {
  const x = qf, z = rf, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz)       ry = -rx - rz;
  else                    rz = -rx - ry;
  return { q: rx, r: rz };
}

/* generation (same water frame) */
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

/* walls */
function drawHexWall(scene, edgePtsTop, dropPx, wallColor) {
  const [A, B] = edgePtsTop;
  const A2 = pt(A.x, A.y + dropPx);
  const B2 = pt(B.x, B.y + dropPx);
  const g = scene.add.graphics().setDepth(2);
  g.fillStyle(wallColor, 1);
  g.beginPath();
  g.moveTo(A.x, A.y);
  g.lineTo(B.x, B.y);
  g.lineTo(B2.x, B2.y);
  g.lineTo(A2.x, A2.y);
  g.closePath();
  g.fillPath();
  g.lineStyle(1, darkenRGBInt(wallColor, 0.7), 0.9);
  g.beginPath();
  g.moveTo(A2.x, A2.y);
  g.lineTo(B2.x, B2.y);
  g.strokePath();
  return g;
}

/* hex face + frame + cliffs (visuals unchanged) */
export function drawHex(q, r, x, y, size, fillColor, effElevation, terrain) {
  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;
  const p0 = pt(x, y - size);
  const p1 = pt(x + w, y - h);
  const p2 = pt(x + w, y + h);
  const p3 = pt(x, y + size);
  const p4 = pt(x - w, y + h);
  const p5 = pt(x - w, y - h);
  const ring = [p0, p1, p2, p3, p4, p5];

  const face = this.add.graphics().setDepth(3);
  face.fillStyle(fillColor, 1);
  face.beginPath();
  face.moveTo(p0.x, p0.y);
  for (let i = 1; i < ring.length; i++) face.lineTo(ring[i].x, ring[i].y);
  face.closePath();
  face.fillPath();

  const rim = this.add.graphics().setDepth(4);
  const rimColor = darkenRGBInt(fillColor, 0.75);
  rim.lineStyle(1.5, rimColor, 0.9);
  rim.beginPath();
  rim.moveTo(p0.x, p0.y);
  for (let i = 1; i < ring.length; i++) rim.lineTo(ring[i].x, ring[i].y);
  rim.closePath();
  rim.strokePath();

  // cliffs toward lower neighbors
  const dropPerLvl = LIFT_PER_LVL;
  const wallColor = tintWallFromBase(fillColor, 0.22);
  const neighborCoords = neighborsOddR(q, r);
  for (let e = 0; e < 6; e++) {
    const [dq, dr] = neighborCoords[e];
    const Nq = q + dq, Nr = r + dr;
    const neighbor = this.tileAt?.(Nq, Nr);
    if (!neighbor) continue;
    const effN = effectiveElevation(neighbor);
    const diff = effElevation - effN;
    if (diff <= 0) continue;
    const A = ring[e];
    const B = ring[(e + 1) % 6];
    const g = drawHexWall(this, [A, B], diff * dropPerLvl, wallColor);
    rim._walls = rim._walls || [];
    rim._walls.push(g);
  }

  return { face, rim, ring };
}

/* outline for hover */
function drawHexOutline(scene, x, y, size, color = 0xffffff) {
  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;
  const p0 = pt(x, y - size);
  const p1 = pt(x + w, y - h);
  const p2 = pt(x + w, y + h);
  const p3 = pt(x, y + size);
  const p4 = pt(x - w, y + h);
  const p5 = pt(x - w, y - h);
  const g = scene.add.graphics().setDepth(10002);
  g.lineStyle(3, color, 1);
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.lineTo(p1.x, p1.y);
  g.lineTo(p2.x, p2.y);
  g.lineTo(p3.x, p3.y);
  g.lineTo(p4.x, p4.y);
  g.lineTo(p5.x, p5.y);
  g.closePath();
  g.strokePath();
  return g;
}

/* draw whole map (single container; aligned) */
export function drawHexMap() {
  this.objects = this.objects || [];

  if (this.mapContainer) { this.mapContainer.destroy(true); this.mapContainer = null; }
  this.mapContainer = this.add.container(0, 0).setDepth(1);

  const cam = this.cameras?.main;
  const camW = cam?.width ?? 800;
  const totalW = this.mapWidth * this.hexSize * Math.sqrt(3) * 0.9;
  const offsetX = Math.floor((camW - totalW) * 0.5);
  const offsetY = 20;

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
    const base = hexToPixel(q, r, this.hexSize);
    const x = base.x + offsetX;
    const y = base.y + offsetY - LIFT_PER_LVL * eff;

    const fillColor = getColorForTerrain(hex.type);
    const { face, rim } = drawHex.call(this, q, r, x, y, this.hexSize, fillColor, eff, hex.type);
    this.mapContainer.add(face);
    this.mapContainer.add(rim);
    if (rim._walls) rim._walls.forEach(w => this.mapContainer.add(w));
  }

  // locations (emojis) + roads (edges)
  drawLocationsAndRoads.call(this);

  // hover
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
    const p = hexToPixel(axial.q, axial.r, this.hexSize);
    const x = p.x + this.mapOffsetX;
    const y = p.y + this.mapOffsetY - LIFT_PER_LVL * eff;

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
