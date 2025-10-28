import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

/** Generate map with a dynamic water border (1–4 hexes thick per edge) */
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

/** Mild isometry */
const ISO_SHEAR   = 0.15;
const ISO_YSCALE  = 0.95;
export const LIFT_PER_LVL = 4;

/** Overlaps & constants omitted here for brevity — this is the same main (24) content **/
/** ... keep the entire visual hex drawing system from your main (24) file ... **/

/** Darken RGB integer by factor (0..1) */
function darkenRGBInt(baseInt, factor) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const r = Math.max(0, Math.min(255, Math.round(c.r * factor)));
  const g = Math.max(0, Math.min(255, Math.round(c.g * factor)));
  const b = Math.max(0, Math.min(255, Math.round(c.b * factor)));
  return Phaser.Display.Color.GetColor(r, g, b);
}

/** HSV tint: slightly darker than base, never pure black */
function tintWallFromBase(baseInt, darkness = 0.18) {
  const c = Phaser.Display.Color.IntegerToColor(baseInt);
  const hsv = Phaser.Display.Color.RGBToHSV(c.r, c.g, c.b);
  const v = Math.max(0.35, Math.min(1, hsv.v - darkness));
  const rgb = Phaser.Display.Color.HSVToRGB(hsv.h, hsv.s, v);
  return Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
}

/** Overlaps to kill AA seams */
const WALL_TOP_INSET     = 1.0;  // tuck walls under the top face
const WALL_EDGE_OVERLAP  = 1.4;  // extend slightly along edges

/** Half-pixel snapping reduces AA */
const SNAP = v => Math.round(v * 2) / 2;
const pt   = (x, y) => ({ x: SNAP(x), y: SNAP(y) });

/** Iso offset */
export function isoOffset(dx, dy) {
  return { x: dx - dy * ISO_SHEAR, y: dy * ISO_YSCALE };
}

/** Sticky UI button to toggle debug numbers (unchanged) */
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

  this.debugBtn = this.add.rectangle(x, y, 120, 28, 0x000000, 0.35)
    .setOrigin(0, 0).setInteractive().setDepth(10000);
  this.debugBtnLabel = this.add.text(x + 10, y + 6, 'Toggle Debug', {
    fontSize: '14px', color: '#ffffff'
  }).setDepth(10001);

  this.debugBtn.on('pointerdown', () => {
    this.debugMode = !this.debugMode;
    // show/hide all elevation labels
    if (this.objects) {
      for (const obj of this.objects) {
        if (obj.isElevationLabel) obj.setVisible(this.debugMode);
      }
    }
  });
}

/** Visual elevation: water = 0, land level 1 also = 0 (baseline like water) */
export function effectiveElevation(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}

/** Fill color with mild brightening by RAW elevation; water not tinted */
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

function getContrastingTextColors(bgInt) {
  const c = Phaser.Display.Color.IntegerToColor(bgInt);
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  const text = lum > 150 ? '#000000' : '#ffffff';
  const stroke = lum > 150 ? '#ffffff' : '#000000';
  return { text, stroke };
}

/** --- drawHex, wall/cliff, frames, outlines — keep unchanged from main (24) --- */
/** The following methods are exactly as in your main (24) file:
 *  - drawHex(...)
 *  - drawHexWall(...)
 *  - drawHexRim(...)
 *  - etc.
 *  (omitted here only to keep the snippet compact)
 */

/** Draw the map (unchanged visuals) */
export function drawHexMap() {
  ensureDebugToggleButton.call(this);
  this.objects = this.objects || [];

  // camera-dependent offset for the debug toggle button
  const cam = this.cameras?.main;
  const camW = cam?.width ?? 800;
  const offsetX = Math.floor((camW - (this.mapWidth * this.hexSize * Math.sqrt(3))) * 0.5);
  const offsetY = 20;

  this.mapOffsetX = offsetX;
  this.mapOffsetY = offsetY;

  // draw order: lower effective elevation first
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
    const { q, r, type } = hex;

    const eff = effectiveElevation(hex);
    const base = this.hexToPixel(q, r, this.hexSize);
    const x = base.x + offsetX;
    const y = base.y + offsetY - LIFT_PER_LVL * eff;

    const fillColor = getFillForTile(hex);
    this.drawHex(q, r, x, y, this.hexSize, fillColor, eff, type);

    // elevation label (raw), controlled by debug toggle
    const rawElev = typeof hex.elevation === 'number' ? hex.elevation : 0;
    const { text: txtColor, stroke: strokeColor } = getContrastingTextColors(fillColor);
    const elevLabel = this.add.text(x, y, String(rawElev), {
      fontSize: `${Math.max(10, Math.floor(this.hexSize * 0.55))}px`,
      fontStyle: 'bold',
      color: txtColor,
      align: 'center'
    }).setOrigin(0.5).setDepth(4).setVisible(!!this.debugMode);
    elevLabel.setStroke(strokeColor, 2);
    elevLabel.isElevationLabel = true;
    this.objects.push(elevLabel);
  });

  // Render locations & roads (locations as emojis, roads as lines)
  drawLocationsAndRoads.call(this);
}

/** Hex → pixel (mild isometric projection) */
export function hexToPixel(q, r, size) {
  const x0 = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y0 = size * 1.5 * r;
  const xIso = x0 - y0 * ISO_SHEAR;
  const yIso = y0 * ISO_YSCALE;
  return { x: xIso + size * 2, y: yIso + size * 2 };
}

/** Pixel → hex (top-down mapping kept) */
export function pixelToHex(x, y, size) {
  x -= size * 2;
  y -= size * 2;
  const r = y / (size * 1.5);
  const q = (x - ((Math.floor(r) & 1) * size * Math.sqrt(3) / 2)) / (size * Math.sqrt(3));
  return { q, r };
}

/** Terrain color map */
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
