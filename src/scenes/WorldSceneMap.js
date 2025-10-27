// deephexbeta/src/scenes/WorldSceneMap.js
import HexMap from '../engine/HexMap.js';
import { populateLocationFlags } from './WorldSceneMapLocations.js';

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

  // Border water mask (preserve other fields)
  const withBorders = raw.map(h => {
    const { q, r } = h;
    if (q < left || q >= width - right || r < top || r >= height - bottom) {
      return { ...h, type: 'water' };
    }
    return h;
  });

  // Populate location flags (moved out)
  return populateLocationFlags(withBorders, seed);
}

/**
 * Return neighboring axial coordinates (odd-r offset layout) — used by roads
 */
function getHexNeighbors(q, r) {
  const directions = (r % 2 === 0)
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
  return directions.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/**
 * Odd-r neighbor tiles in fixed order [E, NE, NW, W, SW, SE]
 * (matches pointy-top corner order we build)
 */
function getNeighborsOffsetOrderTiles(q, r, mapData) {
  const even = (r % 2 === 0);
  const offs = even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
  return offs.map(([dq, dr]) => mapData.find(t => t.q === q + dq && t.r === r + dr) || null);
}

/** Effective visual elevation:
 *  - water => 0
 *  - land  => max(0, elevation - 1)  (level 1 is baseline like water)
 */
function effectiveElevation(tile) {
  if (!tile) return 0;
  if (tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}

/**
 * Fill color with mild brightening by RAW elevation; water not tinted.
 */
function getFillForTile(tile) {
  const baseColor = getColorForTerrain(tile.type);
  const elevation = tile.elevation ?? 0;
  if (tile.type === 'water') return baseColor;

  const t = Math.max(0, Math.min(1, elevation / 4)) * 0.5; // up to +50% toward white
  const base = Phaser.Display.Color.IntegerToColor(baseColor);
  const r = Math.round(base.r + (255 - base.r) * t);
  const g = Math.round(base.g + (255 - base.g) * t);
  const b = Math.round(base.b + (255 - base.b) * t);
  return Phaser.Display.Color.GetColor(r, g, b);
}

/** Contrast helpers for elevation labels (debug) */
function getContrastingTextColors(bgInt) {
  const c = Phaser.Display.Color.IntegerToColor(bgInt);
  const luminance = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  const text = luminance > 150 ? '#000000' : '#ffffff';
  const stroke = luminance > 150 ? '#ffffff' : '#000000';
  return { text, stroke };
}

/** Utility: darken integer color by factor (0..1) */
function darkenColor(intColor, factor) {
  const c = Phaser.Display.Color.IntegerToColor(intColor);
  const r = Math.max(0, Math.min(255, Math.round(c.r * factor)));
  const g = Math.max(0, Math.min(255, Math.round(c.g * factor)));
  const b = Math.max(0, Math.min(255, Math.round(c.b * factor)));
  return Phaser.Display.Color.GetColor(r, g, b);
}

/**
 * Slightly-darkened wall tint derived from the tile color without ever going black.
 * We reduce value (V) in HSV space by 10–28% depending on drop, then clamp to a floor.
 */
function tintWallFromBase(baseInt, dropLevels) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const hsv = Phaser.Display.Color.RGBToHSV(c.r, c.g, c.b);
  const drop05 = Math.max(0, Math.min(1, (dropLevels || 0) / 4)); // 0..1
  const reduce = 0.10 + drop05 * 0.18; // 10%..28%
  const v = Math.max(0.28, hsv.v * (1 - reduce)); // never below 0.28
  const rgb = Phaser.Display.Color.HSVToRGB(hsv.h, hsv.s, v);
  return Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
}

/** Mild isometry */
const ISO_SHEAR   = 0.15;
const ISO_YSCALE  = 0.95;
const LIFT_PER_LVL = 4;             // vertical lift per *effective* level (px)

/** Visual walls/slabs */
const BASE_SLAB_THICKNESS = 2;      // thin slab when no drop
const SEAL_THICKNESS      = 1.6;    // hairline seam-filler for any positive drop on non-bottom edges

/** AA seam helpers */
const WALL_TOP_INSET     = 1.0;     // tuck wall under top face
const WALL_EDGE_OVERLAP  = 1.4;     // extend along edge to overlap neighbors
const DEPTH_EPSILON      = 1.0;     // ensure positive-drop walls always cover

/** Half-pixel snapping to fight subpixel AA */
const SNAP = v => Math.round(v * 2) / 2;
const pt   = (x, y) => ({ x: SNAP(x), y: SNAP(y) });

/** Iso offset (shear + compress) from hex center */
function isoOffset(dx, dy) {
  return { x: dx - dy * ISO_SHEAR, y: dy * ISO_YSCALE };
}

/** Sticky UI button top-right to toggle debug numbers */
function ensureDebugToggleButton() {
  if (typeof this.debugMode !== 'boolean') this.debugMode = false;

  if (this.debugBtn && this.debugBtnLabel) {
    const cam = this.cameras?.main;
    if (cam) {
      const x = cam.scrollX + cam.width - 130;
      const y = cam.scrollY + 12;
      this.debugBtn.setPosition(x, y);
      this.debugBtnLabel.setPosition(x + 10, y + 6);
    }
    return;
  }

  const cam = this.cameras?.main;
  const x = (cam ? cam.scrollX + cam.width : 800) - 130;
  const y = (cam ? cam.scrollY : 0) + 12;

  const g = this.add.graphics().setScrollFactor(0).setDepth(1000);
  g.fillStyle(0x1e1e1e, 0.85);
  g.fillRoundedRect(x, y, 120, 34, 8);
  g.lineStyle(1, 0xffffff, 0.25);
  g.strokeRoundedRect(x, y, 120, 34, 8);
  g.setInteractive(new Phaser.Geom.Rectangle(x, y, 120, 34), Phaser.Geom.Rectangle.Contains);

  const label = this.add.text(x + 10, y + 6, `Debug: ${this.debugMode ? 'ON' : 'OFF'}`, {
    fontSize: '16px',
    color: '#ffffff'
  }).setScrollFactor(0).setDepth(1001);

  g.on('pointerover', () => { g.clear(); g.fillStyle(0x2a2a2a, 0.9); g.fillRoundedRect(x, y, 120, 34, 8); g.lineStyle(1, 0xffffff, 0.35); g.strokeRoundedRect(x, y, 120, 34, 8); });
  g.on('pointerout',  () => { g.clear(); g.fillStyle(0x1e1e1e, 0.85); g.fillRoundedRect(x, y, 120, 34, 8); g.lineStyle(1, 0xffffff, 0.25); g.strokeRoundedRect(x, y, 120, 34, 8); });
  g.on('pointerdown', () => {
    this.debugMode = !this.debugMode;
    label.setText(`Debug: ${this.debugMode ? 'ON' : 'OFF'}`);
    if (this.objects) {
      this.objects.forEach(o => { if (o && o.isElevationLabel) o.setVisible(this.debugMode); });
    }
  });

  this.debugBtn = g;
  this.debugBtnLabel = label;

  this.events?.on('postupdate', () => {
    const c = this.cameras?.main;
    if (!c) return;
    const nx = c.scrollX + c.width - 130;
    const ny = c.scrollY + 12;
    g.setPosition(nx, ny);
    label.setPosition(nx + 10, ny + 6);
  });
}

/**
 * Draw the hex grid with cylindrical walls down to neighbor height,
 * centered in the camera view.
 */
export function drawHexMap() {
  this.objects = this.objects || [];
  ensureDebugToggleButton.call(this);

  // Center the map (based on iso centers without lift)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  this.mapData.forEach(t => {
    const p = this.hexToPixel(t.q, t.r, this.hexSize);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });

  let offsetX = 0, offsetY = 0;
  const cam = this.cameras && this.cameras.main;
  if (cam) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    offsetX = cam.centerX - cx;
    offsetY = cam.centerY - cy;
  }

  // Draw order: lower effective elevation first
  const sorted = [...this.mapData].sort((a, b) => {
    const ea = effectiveElevation(a);
    const eb = effectiveElevation(b);
    if (ea !== eb) return ea - eb;
    const da = (a.q + a.r) - (b.q + b.r);
    if (da !== 0) return da;
    if (a.r !== b.r) return a.r - b.r;
    return a.q - b.q;
  });

  sorted.forEach(hex => {
    const {
      q, r, type,
      hasForest, hasRuin, hasCrashSite, hasVehicle,
      hasRoad, hasMountainIcon
    } = hex;

    const effElev = effectiveElevation(hex); // water=0, level1=0
    const base = this.hexToPixel(q, r, this.hexSize);
    const x = base.x + offsetX;
    const y = base.y + offsetY - LIFT_PER_LVL * effElev;

    const fillColor = getFillForTile(hex);
    this.drawHex(q, r, x, y, this.hexSize, fillColor, effElev, type);

    // Elevation number (raw), tied to debug toggle
    const rawElev = typeof hex.elevation === 'number' ? hex.elevation : 0;
    const { text: txtColor, stroke: strokeColor } = getContrastingTextColors(fillColor);
    const elevLabel = this.add.text(x, y, String(rawElev), {
      fontSize: `${Math.max(10, Math.floor(this.hexSize * 0.55))}px`,
      fontStyle: 'bold',
      color: txtColor,
      align: 'center'
    })
      .setOrigin(0.5)
      .setDepth(4)
      .setVisible(!!this.debugMode);
    elevLabel.setStroke(strokeColor, 2);
    elevLabel.isElevationLabel = true;
    this.objects.push(elevLabel);

    // Scenic objects (render from flags)
    if (hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;

      while (placed.length < treeCount && attempts < 40) {
        const angle = Phaser.Math.FloatBetween(0, 2 * Math.PI);
        const radius = Phaser.Math.FloatBetween(this.hexSize * 0.35, 0.65 * this.hexSize);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const o = isoOffset(dx, dy);
        const posX = x + o.x;
        const posY = y + o.y;
        const minDist = this.hexSize * 0.3;

        const tooClose = placed.some(p => Phaser.Math.Distance.Between(posX, posY, p.x, p.y) < minDist);
        if (!tooClose) {
          const sizePercent = 0.45 + Phaser.Math.FloatBetween(-0.05, 0.05);
          const size = this.hexSize * sizePercent;

          const tree = this.add.text(posX, posY, '🌲', { fontSize: `${size}px` })
            .setOrigin(0.5)
            .setDepth(5);

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

    if (hasRuin)
      this.objects.push(this.add.text(x, y, '🏛️', { fontSize: `${this.hexSize * 0.8}px` }).setOrigin(0.5).setDepth(5));
    if (hasCrashSite)
      this.objects.push(this.add.text(x, y, '🚀', { fontSize: `${this.hexSize * 0.8}px` }).setOrigin(0.5).setDepth(5));
    if (hasVehicle)
      this.objects.push(this.add.text(x, y, '🚙', { fontSize: `${this.hexSize * 0.8}px` }).setOrigin(0.5).setDepth(5));
    if (hasMountainIcon)
      this.objects.push(this.add.text(x, y, '🏔️', {
        fontSize: `${this.hexSize * 0.9}px`,
        fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
      }).setOrigin(0.5).setDepth(5));

    // Roads across elevated centers (effective elevation)
    if (hasRoad) {
      const neighbors = getHexNeighbors(q, r)
        .map(n => this.mapData.find(h => h.q === n.q && h.r === n.r && h.hasRoad))
        .filter(Boolean);

      neighbors.forEach(n => {
        const p1 = this.hexToPixel(q, r, this.hexSize);
        const p2 = this.hexToPixel(n.q, n.r, this.hexSize);

        const e1 = effectiveElevation(hex);
        const e2 = effectiveElevation(n);

        const y1 = p1.y + offsetY - LIFT_PER_LVL * e1;
        const y2 = p2.y + offsetY - LIFT_PER_LVL * e2;

        const line = this.add.graphics().setDepth(3);
        line.lineStyle(2, 0x999999, 0.7);
        line.beginPath();
        line.moveTo(p1.x + offsetX, y1);
        line.lineTo(p2.x + offsetX, y2);
        line.strokePath();
        this.objects.push(line);
      });
    }
  });
}

/**
 * Hex → pixel in mild isometric projection
 */
export function hexToPixel(q, r, size) {
  const x0 = size * Math.sqrt(3) * (q + 0.5 * (r & 1)); // axial pointy-top
  const y0 = size * 1.5 * r;

  const xIso = x0 - y0 * ISO_SHEAR;
  const yIso = y0 * ISO_YSCALE;

  return { x: xIso + size * 2, y: yIso + size * 2 };
}

/**
 * Pixel → hex (top-down math retained)
 */
export function pixelToHex(x, y, size) {
  x -= size * 2;
  y -= size * 2;
  const r = y / (size * 1.5);
  const q = (x - ((Math.floor(r) & 1) * size * Math.sqrt(3) / 2)) / (size * Math.sqrt(3));
  return roundHex(q, r);
}

/** Cube rounding */
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
 * Draw one hex:
 * - Pick the two visually lowest edges and draw proper faces there (like your current look).
 * - PLUS: draw a thin “seal” on *every* edge that has a height step to guarantee no black seams.
 * - Walls/seals are tinted from the top tile’s color (slightly darker), never pure black.
 */
export function drawHex(q, r, x, y, size, color, effElevation = 0, type = 'grassland') {
  const gfx = this.add.graphics({ x: 0, y: 0 });

  // top-face corners (iso)
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const ang = Phaser.Math.DegToRad(60 * i + 30);
    const dx = size * Math.cos(ang);
    const dy = size * Math.sin(ang);
    const o = isoOffset(dx, dy);
    corners.push(pt(x + o.x, y + o.y));
  }

  // edge midpoints (to find the two lowest)
  const midY = [];
  for (let e = 0; e < 6; e++) {
    const a = corners[e], b = corners[(e + 1) % 6];
    midY.push((a.y + b.y) / 2);
  }
  let bottomEdges = [0,1,2,3,4,5].sort((i,j) => midY[j] - midY[i]).slice(0,2);
  // keep local order
  bottomEdges.sort((a,b) => (a - b + 6) % 6 === 1 ? -1 : (b - a + 6) % 6 === 1 ? 1 : a - b);

  const neighbors = getNeighborsOffsetOrderTiles(q, r, this.mapData);
  const thisFill = color;

  // helper to draw a quad wall
  const drawWall = (a, b, depth, fillInt) => {
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.max(1, Math.hypot(ex, ey));
    const ux = ex / len,  uy = ey / len;

    const topA = pt(a.x - ux * WALL_EDGE_OVERLAP, a.y - uy * WALL_EDGE_OVERLAP - WALL_TOP_INSET);
    const topB = pt(b.x + ux * WALL_EDGE_OVERLAP, b.y + uy * WALL_EDGE_OVERLAP - WALL_TOP_INSET);
    const a2   = pt(a.x - ux * WALL_EDGE_OVERLAP, a.y + depth);
    const b2   = pt(b.x + ux * WALL_EDGE_OVERLAP, b.y + depth);

    gfx.fillStyle(fillInt, 1);
    gfx.beginPath();
    gfx.moveTo(topA.x, topA.y);
    gfx.lineTo(topB.x, topB.y);
    gfx.lineTo(b2.x, b2.y);
    gfx.lineTo(a2.x, a2.y);
    gfx.closePath();
    gfx.fillPath();
  };

  if (type !== 'water') {
    for (let edge = 0; edge < 6; edge++) {
      const nb   = neighbors[edge];
      const nbEff = effectiveElevation(nb);
      const dropFromThis = Math.max(0, effElevation - nbEff); // this is higher than neighbor
      const dropFromNb   = Math.max(0, nbEff - effElevation); // neighbor is higher than this

      const a = corners[edge];
      const b = corners[(edge + 1) % 6];

      // A) THIN “SEAL” if neighbor is higher (prevents black crack from below)
      if (dropFromNb > 0) {
        const nbFill = nb ? getFillForTile(nb) : thisFill;
        const sealColor = tintWallFromBase(nbFill, 1);
        drawWall(a, b, Math.min(SEAL_THICKNESS, dropFromNb * LIFT_PER_LVL + DEPTH_EPSILON), sealColor);
      }

      // B) THIN “SEAL” if this is higher BUT the edge is not one of the two bottom ones
      if (dropFromThis > 0 && bottomEdges.indexOf(edge) === -1) {
        const sealColor = tintWallFromBase(thisFill, 1);
        drawWall(a, b, Math.min(SEAL_THICKNESS, dropFromThis * LIFT_PER_LVL + DEPTH_EPSILON), sealColor);
      }
    }

    // C) REAL faces only on the two visually lowest edges (your intended look)
    bottomEdges.forEach(edge => {
      const nb   = neighbors[edge];
      const nbEff = effectiveElevation(nb);
      const drop = Math.max(0, effElevation - nbEff);

      const a = corners[edge];
      const b = corners[(edge + 1) % 6];

      const depth = (drop > 0)
        ? (drop * LIFT_PER_LVL + DEPTH_EPSILON)
        : BASE_SLAB_THICKNESS;

      const wallColor = tintWallFromBase(thisFill, Math.max(1, drop));
      drawWall(a, b, depth, wallColor);
    });
  }

  // top face (no stroke on land; faint on water only)
  const topStrokeAlpha = (type === 'water') ? 0.12 : 0.0;
  const topStrokeColor = darkenColor(thisFill, 0.85);

  if (topStrokeAlpha > 0) {
    gfx.lineStyle(1, topStrokeColor, topStrokeAlpha);
  } else {
    gfx.lineStyle(0, 0x000000, 0);
  }

  gfx.fillStyle(thisFill, 1);
  gfx.beginPath();
  gfx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i++) gfx.lineTo(corners[i].x, corners[i].y);
  gfx.closePath();
  gfx.fillPath();
  if (topStrokeAlpha > 0) gfx.strokePath();

  this.tileMap[`${q},${r}`] = gfx;
}

/** Terrain color map */
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
