// src/scenes/WorldSceneMap.js
//
// Responsible for drawing the hex map (terrain + water + cliffs) in WorldScene.
// Uses elevation from HexMap and a dynamic waterLevel (from worldMeta or scene).
//
// Exports:
//   drawHexMap(scene-bound via .call)
//   hexToPixel, pixelToHex, roundHex
//   getColorForTerrain
//   isoOffset
//   LIFT_PER_LVL
//
// Visual model:
//   elevation 1..3  => sea floor depths (under water at base waterLevel = 3)
//   elevation 4..7  => land
//   waterLevel      => any tile with elevation <= waterLevel is rendered as water.
//   visualHeight    = max(0, elevation - waterLevel)  (used for cliffs & lift)

export const LIFT_PER_LVL = 4;   // vertical lift in pixels per level above water
export const TILE_DEPTH_BASE = 10;
export const TILE_DEPTH_PER_LVL = 5;

// ---------- Axial <-> Pixel helpers (pointy top, odd-r horizontal layout) ----------

export function hexToPixel(q, r, size = 24) {
  const width = Math.sqrt(3) * size;
  const vert = (3 / 2) * size;
  const x = width * (q + 0.5 * (r & 1));
  const y = vert * r;
  return { x, y };
}

export function pixelToHex(x, y, size = 24) {
  const width = Math.sqrt(3) * size;
  const vert = (3 / 2) * size;

  const r = y / vert;
  const q = (x / width) - 0.5 * (r & 1);

  return { q, r };
}

// Standard axial cube rounding
export function roundHex(qf, rf) {
  let xf = qf;
  let zf = rf;
  let yf = -xf - zf;

  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);

  const xDiff = Math.abs(rx - xf);
  const yDiff = Math.abs(ry - yf);
  const zDiff = Math.abs(rz - zf);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

// isoOffset(arg, waterLevel?) – keeps old usages working:
//   isoOffset(tile) OR isoOffset(elevationNumber)
export function isoOffset(arg, waterLevel = 3) {
  let elevation = 0;
  if (typeof arg === 'number') {
    elevation = arg;
  } else if (arg && typeof arg === 'object') {
    elevation = typeof arg.elevation === 'number' ? arg.elevation : 0;
  }
  const wl = (typeof waterLevel === 'number') ? waterLevel : 3;
  const above = Math.max(0, elevation - wl);
  return -LIFT_PER_LVL * above;
}

// ---------- Terrain color helper ----------

// Palette for land types (must stay in sync with HexMap terrainTypes)
const LAND_COLORS = {
  grassland:   0x7ec850,
  sand:        0xffe9a3,
  mud:         0x8d5a3b,
  swamp:       0x4e342e,
  volcano_ash: 0x9a9a9a,
  ice:         0xcfefff,
  snow:        0xf7fbff,
  mountain:    0xffffff, // snow-cap for top; cliffs handle darker sides
};

// Water colors: depth bands by elevation (1..3)
const WATER_COLORS = {
  1: 0x164e8a, // deep
  2: 0x2c72c7, // mid
  3: 0x4da6ff, // shallow
};

export function getColorForTerrain(tile, waterLevel = 3) {
  if (!tile) return 0x000000;

  const elev = (typeof tile.elevation === 'number') ? tile.elevation : 4;
  const wl = (typeof waterLevel === 'number') ? waterLevel : 3;
  const submerged = elev <= wl;

  if (submerged) {
    const band = Math.max(1, Math.min(3, elev)); // 1..3
    return WATER_COLORS[band] || WATER_COLORS[3];
  }

  const type = tile.type || 'grassland';
  return LAND_COLORS[type] || LAND_COLORS.grassland;
}

// ---------- Internal helpers for cliffs ----------

const AXIAL_DIRS = [
  [1, 0],  // edge 0
  [1, -1], // edge 1
  [0, -1], // edge 2
  [-1, 0], // edge 3
  [-1, 1], // edge 4
  [0, 1],  // edge 5
];

function buildHexCorners(cx, cy, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30; // pointy top
    const angleRad = Math.PI / 180 * angleDeg;
    const x = cx + size * Math.cos(angleRad);
    const y = cy + size * Math.sin(angleRad);
    corners.push({ x, y });
  }
  return corners;
}

function darkenColor(rgb, factor = 0.6) {
  const r = ((rgb >> 16) & 0xff) * factor;
  const g = ((rgb >> 8) & 0xff) * factor;
  const b = (rgb & 0xff) * factor;
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

// ---------- Main draw function ----------

export function drawHexMap() {
  const scene = /** @type {Phaser.Scene & { mapData: any[], mapWidth: number, mapHeight: number }} */ (this);

  const map = scene.mapData;
  if (!Array.isArray(map) || !map.length) return;

  const size = scene.hexSize || 24;

  // worldMeta is attached to the flat tiles array by HexMap
  const worldMeta = map.__worldMeta || scene.hexMap?.worldMeta || {};
  const baseWL = (typeof worldMeta.waterLevel === 'number')
    ? worldMeta.waterLevel
    : (typeof worldMeta.baseWaterLevel === 'number' ? worldMeta.baseWaterLevel : 3);

  // currentWaterLevel can be overridden by Debug menu
  const waterLevel = (typeof scene.currentWaterLevel === 'number')
    ? scene.currentWaterLevel
    : baseWL;

  // cache on scene so other systems (cliffs, isoOffset callers) can see it
  scene.currentWaterLevel = waterLevel;

  // Destroy old graphics layers if they exist
  if (scene.hexTerrainGraphics) scene.hexTerrainGraphics.destroy();
  if (scene.hexCliffGraphics)   scene.hexCliffGraphics.destroy();
  if (scene.hexWaterGraphics)   scene.hexWaterGraphics.destroy();

  const waterG  = scene.add.graphics().setDepth(0);
  const cliffG  = scene.add.graphics().setDepth(5);
  const landG   = scene.add.graphics().setDepth(20);

  scene.hexWaterGraphics  = waterG;
  scene.hexCliffGraphics  = cliffG;
  scene.hexTerrainGraphics = landG;

  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;

  // Build a quick lookup by q,r
  const byKey = new Map(map.map(t => [`${t.q},${t.r}`, t]));

  // Helper to get surface height above water
  const surfaceHeight = (tile) => {
    if (!tile) return 0;
    const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
    return Math.max(0, e - waterLevel);
  };

  // -------- Pass 1: draw water (all tiles with elevation <= waterLevel) --------
  for (const tile of map) {
    const elev = (typeof tile.elevation === 'number') ? tile.elevation : 4;
    const submerged = elev <= waterLevel;
    if (!submerged) continue;

    const { x, y } = hexToPixel(tile.q, tile.r, size);
    const cx = x + offsetX;
    const cy = y + offsetY;

    const color = getColorForTerrain(tile, waterLevel);
    waterG.fillStyle(color, 1.0);

    const corners = buildHexCorners(cx, cy, size);
    waterG.beginPath();
    waterG.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      waterG.lineTo(corners[i].x, corners[i].y);
    }
    waterG.closePath();
    waterG.fillPath();
  }

  // -------- Pass 2: land + cliffs --------
  for (const tile of map) {
    const elev = (typeof tile.elevation === 'number') ? tile.elevation : 4;
    if (elev <= waterLevel) continue; // already drawn as water

    const h = surfaceHeight(tile); // >= 1 for any land
    const { x, y } = hexToPixel(tile.q, tile.r, size);
    const baseY = y + offsetY;
    const topY  = baseY + isoOffset(elev, waterLevel); // negative offset => lifted

    const cx = x + offsetX;
    const cy = topY;

    const tileColor = getColorForTerrain(tile, waterLevel);
    const cornersTop = buildHexCorners(cx, cy, size);

    // --- cliffs: compare to neighbours ---
    for (let dir = 0; dir < 6; dir++) {
      const [dq, dr] = AXIAL_DIRS[dir];
      const nKey = `${tile.q + dq},${tile.r + dr}`;
      const nTile = byKey.get(nKey);
      const nh = surfaceHeight(nTile);

      if (nh >= h) continue; // neighbour is same or higher; no cliff

      const diff = h - nh; // height difference in levels
      const v1 = cornersTop[dir];
      const v2 = cornersTop[(dir + 1) % 6];

      // bottom edge a bit lower by diff * LIFT_PER_LVL
      const v1b = { x: v1.x, y: v1.y + diff * LIFT_PER_LVL };
      const v2b = { x: v2.x, y: v2.y + diff * LIFT_PER_LVL };

      const cliffColor = darkenColor(tileColor, 0.45);

      const depth = TILE_DEPTH_BASE + TILE_DEPTH_PER_LVL * (waterLevel + nh); // lower sides slightly "in front"
      cliffG.fillStyle(cliffColor, 1.0);
      cliffG.beginPath();
      cliffG.moveTo(v1.x, v1.y);
      cliffG.lineTo(v2.x, v2.y);
      cliffG.lineTo(v2b.x, v2b.y);
      cliffG.lineTo(v1b.x, v1b.y);
      cliffG.closePath();
      cliffG.fillPath();
      cliffG.setDepth(depth);
    }

    // --- top face of land hex ---
    landG.fillStyle(tileColor, 1.0);
    landG.beginPath();
    landG.moveTo(cornersTop[0].x, cornersTop[0].y);
    for (let i = 1; i < cornersTop.length; i++) {
      landG.lineTo(cornersTop[i].x, cornersTop[i].y);
    }
    landG.closePath();
    landG.fillPath();
  }
}

export default {
  drawHexMap,
  hexToPixel,
  pixelToHex,
  roundHex,
  getColorForTerrain,
  isoOffset,
  LIFT_PER_LVL,
};
