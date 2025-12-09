// src/scenes/WorldSceneMap.js
import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

export const LIFT_PER_LVL = 4;

const ISO_SHEAR  = 0.15;
const ISO_YSCALE = 0.95;

// “Default” sea level used when no dynamic waterLevel is set on the scene.
const DEFAULT_SEA_FLOOR = 3;

const pt = (x, y) => ({ x, y });

/* ---------- terrain palette (base colors) ---------- */
export function getColorForTerrain(terrain) {
  switch (terrain) {
    case 'grassland':   return 0x8bd17c; // #8BD17C
    case 'sand':        return 0xF6E7A1; // #F6E7A1
    case 'mud':         return 0xB48A78; // #B48A78
    case 'swamp':       return 0x8AA18A; // #8AA18A
    case 'mountain':    return 0xC9C9C9; // #C9C9C9
    // Deep water now matches camera background (slightly darker blue)
    case 'water':       return 0x6BA9E7; // deep water / camera bg
    case 'volcano_ash': return 0x9A9A9A; // grey
    case 'ice':         return 0xCFEFFF; // light blue
    case 'snow':        return 0xF7FBFF; // very light
    default:            return 0xA7A7A7; // neutral gray
  }
}

/* ---------- global water helpers ---------- */

// unified “is water” predicate, tolerant to old fields.
function isWaterTile(t) {
  if (!t) return false;
  if (t.isWater === true) return true;
  if (typeof t.waterDepth === 'number' && t.waterDepth > 0) return true;
  if (t.type === 'water') return true;
  if (t.isCoveredByWater) return true;
  return false;
}

// read current water level from the scene, with safe fallback
function getCurrentWaterLevel(scene) {
  const wl = scene && typeof scene.waterLevel === 'number'
    ? scene.waterLevel
    : DEFAULT_SEA_FLOOR;
  return wl;
}

/* ---------- elevation helpers ---------- */
/**
 * Effective visual elevation above sea level (used for cliffs & lift).
 */
export function effectiveElevation(tile, waterLevel = DEFAULT_SEA_FLOOR) {
  if (!tile) return 0;

  // if something explicitly set visualElevation, respect it
  if (typeof tile.visualElevation === 'number') {
    const ve = tile.visualElevation | 0;
    return ve > 0 ? ve : 0;
  }

  const base = (typeof tile.baseElevation === 'number')
    ? tile.baseElevation
    : (typeof tile.elevation === 'number' ? tile.elevation : 0);

  // any water tile is visually flat
  if (isWaterTile(tile)) return 0;

  const wl = (typeof waterLevel === 'number') ? waterLevel : DEFAULT_SEA_FLOOR;

  if (typeof tile.baseElevation === 'number') {
    // new model: pure “height above sea level”
    const eff = base - wl;
    return eff > 0 ? eff : 0;
  }

  // --- fallback for old maps (elevation + isCoveredByWater) ---
  const covered = !!tile.isCoveredByWater;
  const eRaw = typeof tile.elevation === 'number' ? tile.elevation : 0;

  // baseline shoreline moves up with waterLevel as well
  const baseline = 4 + (wl - DEFAULT_SEA_FLOOR); // 4 at wl=3, 5 at wl=4, etc.
  if (covered || eRaw <= baseline) return 0;

  return Math.min(3, Math.max(1, eRaw - baseline));
}

function darkenRGBInt(baseInt, factor) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const r = Math.round(c.r * factor);
  const g = Math.round(c.g * factor);
  const b = Math.round(c.b * factor);
  return Phaser.Display.Color.GetColor(r, g, b);
}

// slightly darker walls for better contrast vs. pastel face
function tintWallFromBase(baseInt, amount = 0.72) {
  return darkenRGBInt(baseInt, amount);
}

/* ---------- axial odd-r neighbors (0=NE,1=E,2=SE,3=SW,4=W,5=NW) ---------- */
function neighborBySide(tileAt, q, r, side) {
  const isOdd = (r & 1) === 1;

  // even row deltas
  const evenNE = [0, -1], evenE = [+1, 0], evenSE = [0, +1];
  const evenSW = [-1, +1], evenW = [-1, 0], evenNW = [-1, -1];

  // odd row deltas
  const oddNE = [+1, -1], oddE = [+1, 0], oddSE = [+1, +1];
  const oddSW = [0, +1], oddW = [-1, 0], oddNW = [0, -1];

  const deltas = isOdd
    ? [oddNE, oddE, oddSE, oddSW, oddW, oddNW]
    : [evenNE, evenE, evenSE, evenSW, evenW, evenNW];

  const [dq, dr] = deltas[side];
  return tileAt(q + dq, r + dr);
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
  if (dx > dy && dx > dz)      rx = -ry - rz;
  else if (dy > dz)           ry = -rx - rz;
  else                        rz = -rx - ry;
  return { q: rx, r: rz };
}

/* ---------- generation wrapper (used by other scenes/tests) ---------- */
export function generateHexMap(width, height, seed) {
  const hexMap = new HexMap(width, height, seed);
  return hexMap.getMap();
}

/* ---------- wall (cliff) quad ---------- */
function drawEdgeQuad(scene, A, B, dropPx, color, depth = 3) {
  const A2 = pt(A.x, A.y + dropPx);
  const B2 = pt(B.x, B.y + dropPx);
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(color, 1); // opaque
  g.beginPath();
  g.moveTo(A.x, A.y);
  g.lineTo(B.x, B.y);
  g.lineTo(B2.x, B2.y);
  g.lineTo(A2.x, A2.y);
  g.closePath();
  g.fillPath();
  return g;
}

/* ---------- face + cliffs ---------- */
export function drawHex(q, r, xIso, yIso, size, fillColor, effElevationValue, tile) {
  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;

  // vertices (flat-top)
  const d = [
    { dx: 0,  dy: -size }, // 0 top
    { dx: +w, dy: -h    }, // 1 top-right
    { dx: +w, dy: +h    }, // 2 bottom-right
    { dx: 0,  dy: +size }, // 3 bottom
    { dx: -w, dy: +h    }, // 4 bottom-left
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

  const wallColor  = tintWallFromBase(fillColor, 0.72);
  const dropPerLvl = LIFT_PER_LVL;

  const walls = [];

  const baseSelf = (typeof tile?.baseElevation === 'number')
    ? tile.baseElevation
    : (typeof tile?.elevation === 'number' ? tile.elevation : 0);

  const selfIsWater = isWaterTile(tile);

  // local water level for this scene
  const waterLevel = getCurrentWaterLevel(this);

  const maybeCliff = (edgeIndex, neighborTile, isEdge) => {
    let effN;
    let neighborIsWater;
    let baseNeighbor = 0;

    if (!neighborTile && isEdge) {
      // off-map edge: treat like deep water at eff=0 so background is hidden
      effN = 0;
      neighborIsWater = true;
    } else if (!neighborTile) {
      return;
    } else {
      effN = effectiveElevation(neighborTile, waterLevel);
      neighborIsWater = isWaterTile(neighborTile);
      baseNeighbor = (typeof neighborTile.baseElevation === 'number')
        ? neighborTile.baseElevation
        : (typeof neighborTile.elevation === 'number' ? neighborTile.elevation : 0);
    }

    // “Beach” rule: no verticals between level-4 land and adjacent water
    const beachPair =
      (!selfIsWater && baseSelf === 4 && neighborIsWater) ||
      (selfIsWater && !neighborIsWater && baseNeighbor === 4);

    // NEW: remove all cliffs where at least one side is water,
    // except for off-map edges (isEdge=true) which we keep to hide background.
    if (!isEdge && (selfIsWater || neighborIsWater)) return;
    if (beachPair) return;

    const diff = effElevationValue - effN;
    if (diff <= 0) return;

    const A = ring[edgeIndex];
    const B = ring[(edgeIndex + 1) % 6];
    walls.push(drawEdgeQuad(this, A, B, diff * dropPerLvl, wallColor, 3));
  };

  const maybeSkirt = (edgeIndex, neighborTile, isEdge) => {
    let effN;
    let neighborIsWater;
    let baseNeighbor = 0;

    if (!neighborTile && isEdge) {
      effN = 0;
      neighborIsWater = true;
    } else if (!neighborTile) {
      return;
    } else {
      effN = effectiveElevation(neighborTile, waterLevel);
      neighborIsWater = isWaterTile(neighborTile);
      baseNeighbor = (typeof neighborTile.baseElevation === 'number')
        ? neighborTile.baseElevation
        : (typeof neighborTile.elevation === 'number' ? neighborTile.elevation : 0);
    }

    const beachPair =
      (!selfIsWater && baseSelf === 4 && neighborIsWater) ||
      (selfIsWater && !neighborIsWater && baseNeighbor === 4);

    if (!isEdge && (selfIsWater || neighborIsWater)) return;
    if (beachPair) return;

    const diff = effElevationValue - effN;
    if (diff <= 0) return;

    const A = ring[edgeIndex];
    const B = ring[(edgeIndex + 1) % 6];
    const skirt = Math.min(2, Math.max(1.2, diff * 0.8));
    walls.push(drawEdgeQuad(this, A, B, skirt, wallColor, 3));
  };

  // sides: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW
  const n0 = neighborBySide(this.tileAt, q, r, 0);
  const n1 = neighborBySide(this.tileAt, q, r, 1);
  const n2 = neighborBySide(this.tileAt, q, r, 2);
  const n3 = neighborBySide(this.tileAt, q, r, 3);
  const n4 = neighborBySide(this.tileAt, q, r, 4);
  const n5 = neighborBySide(this.tileAt, q, r, 5);

  // Screen-facing edges: 2 & 3 → big cliffs; keep them even vs edge-of-map
  maybeCliff(2, n2, !n2);
  maybeCliff(3, n3, !n3);

  // Thin skirts on other edges for AA seam sealing / map edges
  maybeSkirt(0, n0, !n0);
  maybeSkirt(1, n1, !n1);
  maybeSkirt(4, n4, !n4);
  maybeSkirt(5, n5, !n5);

  // thin rim on top to cover any remaining AA
  const rim = this.add.graphics().setDepth(4);
  const rimColor = darkenRGBInt(fillColor, 0.75);
  rim.lineStyle(1.6, rimColor, 1);
  rim.beginPath();
  rim.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < 6; i++) rim.lineTo(ring[i].x, ring[i].y);
  rim.closePath();
  rim.strokePath();

  rim._walls = walls;
  return { face, rim, ring };
}

/* ---------- elevation + water tint ---------- */
/**
 * Water shades:
 *   waterDepth 1 => deep, darkest (camera color)
 *   waterDepth 2 => medium
 *   waterDepth 3 => shallow, lightest
 */
function getFillForTile(tile, waterLevel) {
  const water = isWaterTile(tile);

  if (water) {
    const base = getColorForTerrain('water');

    let depth = 0;
    if (typeof tile.waterDepth === 'number') {
      depth = tile.waterDepth;
    } else if (typeof tile.baseElevation === 'number') {
      depth = tile.baseElevation;
    } else if (typeof tile.elevation === 'number') {
      depth = tile.elevation;
    }

    const d = Math.max(1, Math.min(3, depth || 2));

    // Deep = base camera color, medium slightly lighter, shallow clearly pale
    let factor;
    if (d === 1)      factor = 1.00; // deep
    else if (d === 2) factor = 1.08; // mid
    else              factor = 1.22; // shallow, easy to distinguish

    const c = Phaser.Display.Color.IntegerToColor(base);
    const r = Math.max(0, Math.min(255, Math.round(c.r * factor)));
    const g = Math.max(0, Math.min(255, Math.round(c.g * factor)));
    const b = Math.max(0, Math.min(255, Math.round(c.b * factor)));
    return Phaser.Display.Color.GetColor(r, g, b);
  }

  // Land
  const baseColor = getColorForTerrain(tile.type);
  const eff = effectiveElevation(tile, waterLevel); // 0..4 for land

  // Clear per-level stepping toward white (0..4)
  const LEVEL_TINTS = [0.00, 0.18, 0.34, 0.50, 0.66]; // index = eff 0..4
  const idx = Math.max(0, Math.min(LEVEL_TINTS.length - 1, eff));
  const t   = LEVEL_TINTS[idx];

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

/* ---------- renderer ---------- */
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

  const waterLevel = getCurrentWaterLevel(this);

  // Sort by effectiveElevation so lower tiles draw first (proper stacking).
  const sorted = [...this.mapData].sort((a, b) => {
    const ea = effectiveElevation(a, waterLevel);
    const eb = effectiveElevation(b, waterLevel);
    if (ea !== eb) return ea - eb;
    const da = (a.q + a.r) - (b.q + b.r);
    if (da !== 0) return da;
    if (a.r !== b.r) return a.r - b.r;
    return a.q - b.q;
  });

  for (const hex of sorted) {
    const { q, r } = hex;
    const eff = effectiveElevation(hex, waterLevel);
    const p  = hexToPixel(q, r, this.hexSize);
    const x  = p.x + offsetX;
    const y  = p.y + offsetY - LIFT_PER_LVL * eff;

    const fillColor = getFillForTile(hex, waterLevel);
    const { face, rim } = drawHex.call(this, q, r, x, y, this.hexSize, fillColor, eff, hex);
    this.mapContainer.add(face);                   // face
    if (rim._walls) rim._walls.forEach(w => this.mapContainer.add(w)); // cliffs/skirts
    this.mapContainer.add(rim);                    // rim on top
  }

  // Draw locations & roads on top (emojis)
  drawLocationsAndRoads.call(this);

  // Hover highlight
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

    const eff = effectiveElevation(tile, waterLevel);
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

export { getFillForTile };

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
