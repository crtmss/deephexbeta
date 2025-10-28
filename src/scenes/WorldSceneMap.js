// src/scenes/WorldSceneMap.js
// Preserves visuals from main (24): colors, frames, cliffs, and isometric lift.
// Now also exports roundHex so WorldScene.js can import it.

import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

// ---- Public constants ----
export const LIFT_PER_LVL = 4;
const ISO_SHEAR  = 0.15;
const ISO_YSCALE = 0.95;

// ---- Helpers to reduce AA seams & keep consistent snapping ----
const SNAP = v => Math.round(v * 2) / 2;
const pt = (x, y) => ({ x: SNAP(x), y: SNAP(y) });

// ---- Terrain palette (kept as in main 24) ----
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

// ---- Elevation helpers ----
export function effectiveElevation(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1); // level 1 treated like baseline (water)
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

// ---- Geometry / axial-odd-r ----
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

// ---- Isometric transforms ----
export function isoOffset(dx, dy) {
  return { x: dx - dy * ISO_SHEAR, y: dy * ISO_YSCALE };
}

// Axial → screen (mild isometric projection)
export function hexToPixel(q, r, size) {
  const x0 = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y0 = size * 1.5 * r;
  const xIso = x0 - y0 * ISO_SHEAR;
  const yIso = y0 * ISO_YSCALE;
  return { x: xIso + size * 2, y: yIso + size * 2 };
}

// Screen → axial (approximate; used for picking)
export function pixelToHex(x, y, size) {
  x -= size * 2;
  y -= size * 2;
  const r = y / (size * 1.5 * ISO_YSCALE);
  const xUnShear = x + (y / ISO_YSCALE) * ISO_SHEAR;
  const q = (xUnShear - ((Math.floor(r) & 1) * size * Math.sqrt(3) / 2)) / (size * Math.sqrt(3));
  return { q, r };
}

// ---- NEW: axial rounding (cube rounding) ----
export function roundHex(qf, rf) {
  // Convert axial (q,r) to cube (x,y,z) with x=q, z=r, y=-x-z
  const x = qf;
  const z = rf;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  // Back to axial
  return { q: rx, r: rz };
}

// ---- Map generation (water border like main 24) ----
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

// ---- Wall (cliff) drawing along edges where neighbor is lower ----
function drawHexWall(scene, xTop, yTop, edgePtsTop, dropPx, wallColor) {
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

  // thin dark separator line at the base to reduce AA seam
  g.lineStyle(1, darkenRGBInt(wallColor, 0.7), 0.9);
  g.beginPath();
  g.moveTo(A2.x, A2.y);
  g.lineTo(B2.x, B2.y);
  g.strokePath();

  return g;
}

// ---- Hex face + frame (kept like main 24) ----
export function drawHex(q, r, x, y, size, fillColor, effElevation, terrain) {
  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;

  const p0 = pt(x, y - size);         // top
  const p1 = pt(x + w, y - h);
  const p2 = pt(x + w, y + h);
  const p3 = pt(x, y + size);
  const p4 = pt(x - w, y + h);
  const p5 = pt(x - w, y - h);
  const ring = [p0, p1, p2, p3, p4, p5];

  // face
  const face = this.add.graphics().setDepth(3);
  face.fillStyle(fillColor, 1);
  face.beginPath();
  face.moveTo(p0.x, p0.y);
  for (let i = 1; i < ring.length; i++) face.lineTo(ring[i].x, ring[i].y);
  face.closePath();
  face.fillPath();

  // rim/frame
  const rim = this.add.graphics().setDepth(4);
  const rimColor = darkenRGBInt(fillColor, 0.75);
  rim.lineStyle(1.5, rimColor, 0.9);
  rim.beginPath();
  rim.moveTo(p0.x, p0.y);
  for (let i = 1; i < ring.length; i++) rim.lineTo(ring[i].x, ring[i].y);
  rim.closePath();
  rim.strokePath();

  // cliffs/walls to lower neighbors
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
    drawHexWall(this, x, y, [A, B], diff * dropPerLvl, wallColor);
  }

  return { face, rim };
}

// ---- Scene-level helpers used by Locations ----
function getFillForTile(tile) {
  const baseColor = getColorForTerrain(tile.type);
  if (tile.type === 'water') return baseColor;
  const elevation = tile.elevation ?? 0;
  const t = Math.max(0, Math.min(1, elevation / 4)) * 0.5;
  const base = Phaser.Display.Color.IntegerToColor(baseColor);
  const r = Math.round(base.r + (255 - base.r) * t);
  const g = Math.round(base.g + (255 - base.g) * t);
  const b = Math.round(base.b + (255 - base.b) * t);
  return Phaser.Display.Color.GetColor(r, g, b);
}

// ---- Public renderer of the whole map (preserves main 24 visuals) ----
export function drawHexMap() {
  this.objects = this.objects || [];

  // camera-based offset for centering
  const cam = this.cameras?.main;
  const camW = cam?.width ?? 800;
  const totalW = this.mapWidth * this.hexSize * Math.sqrt(3) * 0.9;
  const offsetX = Math.floor((camW - totalW) * 0.5);
  const offsetY = 20;

  this.mapOffsetX = offsetX;
  this.mapOffsetY = offsetY;

  // fast lookup for neighbors in drawHex walls
  const byKey = new Map(this.mapData.map(t => [`${t.q},${t.r}`, t]));
  this.tileAt = (q, r) => byKey.get(`${q},${r}`);

  // sort by effective elevation to get proper painter’s order
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
    const { q, r, type } = hex;
    const eff = effectiveElevation(hex);
    const base = hexToPixel(q, r, this.hexSize);
    const x = base.x + offsetX;
    const y = base.y + offsetY - LIFT_PER_LVL * eff;

    const fillColor = getFillForTile(hex);
    drawHex.call(this, q, r, x, y, this.hexSize, fillColor, eff, type);
  }

  // draw locations & roads (locations as emojis)
  drawLocationsAndRoads.call(this);
}

export default {
  LIFT_PER_LVL,
  isoOffset,
  hexToPixel,
  pixelToHex,
  roundHex,          // <-- added
  effectiveElevation,
  getColorForTerrain,
  drawHex,           // exported for WorldScene.js
  drawHexMap,
  generateHexMap,
};
