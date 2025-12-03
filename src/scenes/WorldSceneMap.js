// deephexbeta/src/scenes/WorldSceneMap.js
import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

export const LIFT_PER_LVL = 4;

const ISO_SHEAR  = 0.15;
const ISO_YSCALE = 0.95;

const pt = (x, y) => ({ x, y });

/* ---------- terrain palette (pastel + new) ---------- */
export function getColorForTerrain(terrain) {
  switch (terrain) {
    case 'grassland':   return 0x8bd17c; // #8BD17C
    case 'sand':        return 0xF6E7A1; // #F6E7A1
    case 'mud':         return 0xB48A78; // #B48A78
    case 'swamp':       return 0x8AA18A; // #8AA18A
    case 'mountain':    return 0xC9C9C9; // #C9C9C9
    case 'water':       return 0x7CC4FF; // #7CC4FF
    case 'volcano_ash': return 0x9A9A9A; // grey
    case 'ice':         return 0xCFEFFF; // light blue
    case 'snow':        return 0xF7FBFF; // very light
    default:            return 0xA7A7A7; // neutral gray
  }
}

/* ---------- elevation helpers ---------- */
/**
 * Game elevation model:
 *   elevation 1–3 : water levels (isCoveredByWater = true)
 *   elevation 4   : shoreline land (no vertical step vs water)
 *   elevation 5–7 : raised land (terrain cliffs)
 *
 * effectiveElevation() controls visual extrusion:
 *   - water + level 4 land => 0 (flat)
 *   - level 5,6,7 land     => 1,2,3 respectively
 */
export function effectiveElevation(tile) {
  if (!tile) return 0;

  const eRaw = typeof tile.elevation === 'number' ? tile.elevation : 0;
  const covered = !!tile.isCoveredByWater;

  // Water (1–3) and shoreline (4) are on the same visual plane.
  if (covered || eRaw <= 4) return 0;

  // Levels 5–7 become 1–3 visually.
  return Math.min(3, Math.max(1, eRaw - 4));
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

/** Simple odd-r neighbor list for BFS / water distance */
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

/* ---------- small hash for deterministic per-tile noise ---------- */
function hash32FromQR(q, r) {
  let x = (q * 374761393) ^ (r * 668265263);
  x |= 0;
  x ^= x >>> 13;
  x = (x * 1274126177) | 0;
  x ^= x >>> 16;
  return x >>> 0;
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

/* ---------- generation wrapper ---------- */
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
export function drawHex(q, r, xIso, yIso, size, fillColor, effElevation, tile) {
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

  const selfRawElev = typeof tile?.elevation === 'number' ? tile.elevation : 0;

  // Helper to draw cliff if neighbor lower
  const maybeCliff = (edgeIndex, neighborTile) => {
    if (!neighborTile) return;

    const effN = effectiveElevation(neighborTile);
    const diff = effElevation - effN;

    // HARD RULE: level-4 terrain should NOT have cliffs vs water.
    const neighborIsWater = neighborTile.type === 'water' || neighborTile.isCoveredByWater;
    if (selfRawElev === 4 && neighborIsWater) return;

    if (diff <= 0) return;
    const A = ring[edgeIndex];
    const B = ring[(edgeIndex + 1) % 6];
    walls.push(drawEdgeQuad(this, A, B, diff * dropPerLvl, wallColor, 3));
  };

  // Helper to draw micro-skirt (thin) for other edges if neighbor lower
  const maybeSkirt = (edgeIndex, neighborTile) => {
    if (!neighborTile) return;

    const effN = effectiveElevation(neighborTile);
    const diff = effElevation - effN;

    // Same rule as above: level-4 vs water => no skirt either.
    const neighborIsWater = neighborTile.type === 'water' || neighborTile.isCoveredByWater;
    if (selfRawElev === 4 && neighborIsWater) return;

    if (diff <= 0) return;
    const A = ring[edgeIndex];
    const B = ring[(edgeIndex + 1) % 6];
    const skirt = Math.min(2, Math.max(1.2, diff * 0.8));
    walls.push(drawEdgeQuad(this, A, B, skirt, wallColor, 3));
  };

  // === Neighbors by your side numbering ===
  // sides: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW
  const n0 = neighborBySide(this.tileAt, q, r, 0);
  const n1 = neighborBySide(this.tileAt, q, r, 1);
  const n2 = neighborBySide(this.tileAt, q, r, 2);
  const n3 = neighborBySide(this.tileAt, q, r, 3);
  const n4 = neighborBySide(this.tileAt, q, r, 4);
  const n5 = neighborBySide(this.tileAt, q, r, 5);

  // Screen-facing edges: 2 (SE) & 3 (SW bottom)
  if (n2) maybeCliff(2, n2);
  if (n3) maybeCliff(3, n3);

  // (optional thin skirts to seal AA seams elsewhere)
  if (n0) maybeSkirt(0, n0);
  if (n1) maybeSkirt(1, n1);
  if (n4) maybeSkirt(4, n4);
  if (n5) maybeSkirt(5, n5);

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
 * waterDistance:
 *   0 for land tiles (we don't use it there)
 *   1 => shallow (light)
 *   2–3 => medium
 *   4+ => deep (dark)
 *
 * Plus per-tile deterministic noise so water bands aren’t too perfect.
 */
function getFillForTile(tile, waterDistance) {
  const isWater = tile.type === 'water' || tile.isCoveredByWater;
  const baseColor = getColorForTerrain(isWater ? 'water' : tile.type);

  if (isWater) {
    const d = Number.isFinite(waterDistance) ? waterDistance : 999;

    // Base factor by ring
    let factor;
    if (d <= 1)      factor = 1.05; // shallow
    else if (d <= 3) factor = 1.0;  // medium
    else             factor = 0.75; // deep

    // Deterministic per-tile noise: +/- up to ~8%
    const h = hash32FromQR(tile.q, tile.r);
    const noise = ((h & 0xffff) / 65535) * 0.16 - 0.08; // -0.08..+0.08
    factor *= (1 + noise);
    // clamp factor to avoid weird extremes
    factor = Math.max(0.6, Math.min(1.15, factor));

    const base = Phaser.Display.Color.IntegerToColor(baseColor);
    const r = Math.max(0, Math.min(255, Math.round(base.r * factor)));
    const g = Math.max(0, Math.min(255, Math.round(base.g * factor)));
    const b = Math.max(0, Math.min(255, Math.round(base.b * factor)));
    return Phaser.Display.Color.GetColor(r, g, b);
  }

  // --- Land tinting by *effective* elevation (above water plane) ---
  const eff = effectiveElevation(tile);

  // Clear per-level stepping toward white (stronger contrast)
  const LEVEL_TINTS = [0.00, 0.18, 0.34, 0.50]; // 0,1,2,3

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

  /* --- compute water distance for shading (shallow/medium/deep) --- */
  const waterDistance = new Map(); // key -> int distance (for water); 0 for land

  // multi-source BFS from land tiles into water
  const queue = [];
  for (const t of this.mapData) {
    const key = `${t.q},${t.r}`;
    const isWater = t.type === 'water' || t.isCoveredByWater;
    if (!isWater) {
      waterDistance.set(key, 0);
      queue.push(t);
    }
  }

  while (queue.length) {
    const cur = queue.shift();
    const ck = `${cur.q},${cur.r}`;
    const d  = waterDistance.get(ck) ?? 0;

    for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
      const nq = cur.q + dq;
      const nr = cur.r + dr;
      const nk = `${nq},${nr}`;
      if (waterDistance.has(nk)) continue;
      const nt = byKey.get(nk);
      if (!nt) continue;

      const isWater = nt.type === 'water' || nt.isCoveredByWater;
      if (!isWater) continue;

      const nd = d + 1;
      waterDistance.set(nk, nd);
      queue.push(nt);
    }
  }

  const sorted = [...this.mapData].sort((a, b) => {
    const ea = effectiveElevation(a);
    const eb = effectiveElevation(b);
    if (ea !== eb) return ea - eb;

    const da = (a.q + a.r) - (b.q + b.r); // ✅ fixed (was b.q + b.q)
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

    const key = `${q},${r}`;
    const dist = waterDistance.get(key);
    const fillColor = getFillForTile(hex, dist);

    const { face, rim } = drawHex.call(this, q, r, x, y, this.hexSize, fillColor, eff, hex);
    this.mapContainer.add(face);                               // face
    if (rim._walls) rim._walls.forEach(w => this.mapContainer.add(w)); // cliffs/skirts
    this.mapContainer.add(rim);                                // rim on top
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