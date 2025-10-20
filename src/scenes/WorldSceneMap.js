// deephexbeta/src/scenes/WorldSceneMap.js
import HexMap from '../engine/HexMap.js';

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

  return raw.map(h => {
    const { q, r } = h;
    if (q < left || q >= width - right || r < top || r >= height - bottom) {
      // Keep all other fields (e.g., elevation) but force water type
      return { ...h, type: 'water' };
    }
    return h;
  });
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
 * Axial neighbors in fixed angular order (pointy-top axial), independent of row parity.
 * Index 0..5 correspond to directions: [E, NE, NW, W, SW, SE].
 * We use this stable order to align **edges** with **neighbor directions**.
 */
function getAxialNeighborsFixedOrder(q, r) {
  const dirs = [
    [+1,  0], // 0: E
    [+1, -1], // 1: NE
    [ 0, -1], // 2: NW
    [-1,  0], // 3: W
    [-1, +1], // 4: SW
    [ 0, +1], // 5: SE
  ];
  return dirs.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/**
 * Compute adjusted fill color for elevation shading
 * Higher elevation → brighter tint; water is not tinted.
 */
function getFillForTile(tile) {
  const baseColor = getColorForTerrain(tile.type);
  const elevation = tile.elevation ?? 0;

  // Do not tint water (keeps borders visually coherent)
  if (tile.type === 'water') {
    return baseColor;
  }

  // Linear brighten towards white, up to 50% at elevation 4
  const t = Math.max(0, Math.min(1, elevation / 4)) * 0.5; // 0..0.5
  const base = Phaser.Display.Color.IntegerToColor(baseColor);
  const r = Math.round(base.r + (255 - base.r) * t);
  const g = Math.round(base.g + (255 - base.g) * t);
  const b = Math.round(base.b + (255 - base.b) * t);
  return Phaser.Display.Color.GetColor(r, g, b);
}

/**
 * Choose black or white text for best contrast against a background color
 */
function getContrastingTextColors(bgInt) {
  const c = Phaser.Display.Color.IntegerToColor(bgInt);
  // Perceived luminance
  const luminance = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  const text = luminance > 150 ? '#000000' : '#ffffff';
  const stroke = luminance > 150 ? '#ffffff' : '#000000';
  return { text, stroke };
}

/** Darken a hex color integer by factor (0..1) */
function darkenColor(intColor, factor) {
  const c = Phaser.Display.Color.IntegerToColor(intColor);
  const r = Math.max(0, Math.min(255, Math.round(c.r * factor)));
  const g = Math.max(0, Math.min(255, Math.round(c.g * factor)));
  const b = Math.max(0, Math.min(255, Math.round(c.b * factor)));
  return Phaser.Display.Color.GetColor(r, g, b);
}

/** Constant cliff thickness (in pixels) used for isometric faces */
const CLIFF_THICKNESS = 5;

/** Isometric transform for a local offset relative to hex center */
function isoOffset(dx, dy) {
  // shear X by -0.5 * dy, compress Y by 0.75
  return { x: dx - dy * 0.5, y: dy * 0.75 };
}

/**
 * Draw the hex grid and place scenic object sprites based on tile data.
 * Now renders in a pseudo-isometric projection with controlled cliffs.
 */
export function drawHexMap() {
  this.objects = this.objects || [];

  // Draw lower elevations first, higher last (so 4 over 3 over 2, etc.)
  const sorted = [...this.mapData].sort((a, b) => {
    if ((a.elevation ?? 0) !== (b.elevation ?? 0)) {
      return (a.elevation ?? 0) - (b.elevation ?? 0); // primary: elevation asc
    }
    // then back-to-front to reduce overlaps in iso
    const da = (a.q + a.r) - (b.q + b.r);
    if (da !== 0) return da;
    if (a.r !== b.r) return a.r - b.r;
    return a.q - b.q;
  });

  sorted.forEach(hex => {
    const {
      q, r, type,
      hasForest, hasRuin, hasCrashSite, hasVehicle,
      hasRoad, hasMountainIcon, elevation = 0
    } = hex;

    const base = this.hexToPixel(q, r, this.hexSize); // iso-projected center (no vertical lift)
    const lift = CLIFF_THICKNESS * (elevation || 0);
    const x = base.x;
    const y = base.y - lift; // raise top face according to elevation

    const fillColor = getFillForTile(hex);
    this.drawHex(q, r, x, y, this.hexSize, fillColor, elevation);

    // ░░ Elevation number at the center of each hex ░░
    const { text: txtColor, stroke: strokeColor } = getContrastingTextColors(fillColor);
    const elevLabel = this.add.text(x, y, String(elevation), {
      fontSize: `${Math.max(10, Math.floor(this.hexSize * 0.55))}px`,
      fontStyle: 'bold',
      color: txtColor,
      align: 'center'
    })
      .setOrigin(0.5)
      .setDepth(4);
    elevLabel.setStroke(strokeColor, 2);
    this.objects.push(elevLabel);

    // 🌲 FOREST CLUSTER: 2–4 non-overlapping animated trees
    if (hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;

      while (placed.length < treeCount && attempts < 40) {
        const angle = Phaser.Math.FloatBetween(0, 2 * Math.PI);
        const radius = Phaser.Math.FloatBetween(this.hexSize * 0.35, this.hexSize * 0.65);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const o = isoOffset(dx, dy);
        const posX = x + o.x;
        const posY = y + o.y;
        const minDist = this.hexSize * 0.3;

        const tooClose = placed.some(p => {
          const dist = Phaser.Math.Distance.Between(posX, posY, p.x, p.y);
          return dist < minDist;
        });

        if (!tooClose) {
          const sizePercent = 0.45 + Phaser.Math.FloatBetween(-0.05, 0.05);
          const size = this.hexSize * sizePercent;

          const tree = this.add.text(posX, posY, '🌲', {
            fontSize: `${size}px`
          }).setOrigin(0.5).setDepth(5);

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

    // 🏛️ RUINS
    if (hasRuin) {
      const ruin = this.add.text(x, y, '🏛️', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(5);
      this.objects.push(ruin);
    }

    // 🚀 CRASHED SPACECRAFT
    if (hasCrashSite) {
      const rocket = this.add.text(x, y, '🚀', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(5);
      this.objects.push(rocket);
    }

    // 🚙 ABANDONED VEHICLE
    if (hasVehicle) {
      const vehicle = this.add.text(x, y, '🚙', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(5);
      this.objects.push(vehicle);
    }

    // 🏔️ MOUNTAIN ICON
    if (hasMountainIcon) {
      const mountain = this.add.text(x, y, '🏔️', {
        fontSize: `${this.hexSize * 0.9}px`,
        fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
      }).setOrigin(0.5).setDepth(5);
      this.objects.push(mountain);
    }

    // 🛣️ Ancient roads (connect centers at their elevated iso positions)
    if (hasRoad) {
      const neighbors = getHexNeighbors(q, r)
        .map(n => this.mapData.find(h => h.q === n.q && h.r === n.r && h.hasRoad))
        .filter(Boolean);

      neighbors.forEach(n => {
        const p1 = this.hexToPixel(q, r, this.hexSize);
        const p2 = this.hexToPixel(n.q, n.r, this.hexSize);

        const y1 = p1.y - CLIFF_THICKNESS * (elevation || 0);
        const y2 = p2.y - CLIFF_THICKNESS * (n.elevation || 0);

        const line = this.add.graphics().setDepth(3);

        const brightness = 0.60 + Math.min(4, Math.max(0, elevation)) * 0.05;
        const val = Math.max(0, Math.min(255, Math.round(153 * brightness)));
        const roadColor = Phaser.Display.Color.GetColor(val, val, val);

        line.lineStyle(2, roadColor, 0.7);
        line.beginPath();
        line.moveTo(p1.x, y1);
        line.lineTo(p2.x, y2);
        line.strokePath();
        this.objects.push(line);
      });
    }
  });
}

/**
 * Hex → pixel conversion (with padding) in **isometric projection**
 * Standard pointy-top axial position -> shear/compress to iso.
 */
export function hexToPixel(q, r, size) {
  // pointy-top axial
  const x0 = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y0 = size * 1.5 * r;

  // isometric projection
  const xIso = x0 - y0 * 0.5;
  const yIso = y0 * 0.75;

  // padding
  return { x: xIso + size * 2, y: yIso + size * 2 };
}

/**
 * Pixel → hex conversion + round
 * (kept as original top-down mapping for now; visuals only changed)
 */
export function pixelToHex(x, y, size) {
  x -= size * 2;
  y -= size * 2;
  const r = y / (size * 1.5);
  const q = (x - ((Math.floor(r) & 1) * size * Math.sqrt(3) / 2)) / (size * Math.sqrt(3));
  return roundHex(q, r);
}

/**
 * Cube coordinate rounding
 */
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
 * Draw one hexagon (as polygon)
 * Supports **isometric cliffs** (only on bottom-left & bottom-right edges),
 * and simple contour rings. No shadow rendering.
 */
export function drawHex(q, r, x, y, size, color, elevation = 0) {
  const gfx = this.add.graphics({ x: 0, y: 0 });

  // Compute top-face corners (iso-transformed offsets)
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const ang = Phaser.Math.DegToRad(60 * i + 30);
    const dx = size * Math.cos(ang);
    const dy = size * Math.sin(ang);
    const o = isoOffset(dx, dy);
    corners.push({ x: x + o.x, y: y + o.y });
  }

  // === ISO CLIFFS — ONLY bottom-left (SW, edge 3) & bottom-right (SE, edge 4) ===
  if (elevation > 0) {
    const neighborsFixed = getAxialNeighborsFixedOrder(q, r)
      .map(n => this.mapData.find(t => t.q === n.q && t.r === n.r));

    // map edges to neighbor indices (edges order: [NE, NW, W, SW, SE, E])
    const dirIndexForEdge = [1, 2, 3, 4, 5, 0];

    // process only edges 3 (SW) and 4 (SE)
    [3, 4].forEach(edge => {
      const nb = neighborsFixed[dirIndexForEdge[edge]];
      const nbElev = nb && typeof nb.elevation === 'number' ? nb.elevation : null;
      const diff = nbElev === null ? Infinity : (elevation - nbElev);

      // RULES:
      // - no cliffs when |Δ| == 0 or |Δ| == 1
      // - draw a 5px cliff when elevation - nbElev >= 2
      // - also draw a 5px base thickness at map edges (no neighbor) to simulate iso
      const shouldDraw =
        (nbElev === null) || (diff >= 2);

      if (!shouldDraw) return;

      const h = CLIFF_THICKNESS;

      const a = corners[edge];
      const b = corners[(edge + 1) % 6];

      // Bottom edge points (extruded straight down in screen space)
      const a2 = { x: a.x, y: a.y + h };
      const b2 = { x: b.x, y: b.y + h };

      // Wall shading and outline (simple, consistent)
      const wallFill = darkenColor(color, 0.70);
      const wallStroke = darkenColor(color, 0.55);

      gfx.fillStyle(wallFill, 1);
      gfx.lineStyle(2, wallStroke, 0.95);
      gfx.beginPath();
      gfx.moveTo(a.x, a.y);
      gfx.lineTo(b.x, b.y);
      gfx.lineTo(b2.x, b2.y);
      gfx.lineTo(a2.x, a2.y);
      gfx.closePath();
      gfx.fillPath();
      gfx.strokePath();
    });
  }

  // main hex top fill (drawn above cliffs)
  gfx.lineStyle(1, 0x000000, 0.45);
  gfx.fillStyle(color, 1);
  gfx.beginPath();
  gfx.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach(c => gfx.lineTo(c.x, c.y));
  gfx.closePath();
  gfx.fillPath();
  gfx.strokePath();

  // Simple contour rings (visual only; capped to 3 for clarity)
  const cx = x, cy = y;
  for (let i = 1; i <= Math.min(3, elevation); i++) {
    gfx.lineStyle(0.5, 0x000000, 0.08);
    const scale = 1 - i * 0.1;
    gfx.beginPath();
    corners.forEach(({ x: px, y: py }, idx) => {
      const sx = cx + (px - cx) * scale;
      const sy = cy + (py - cy) * scale;
      if (idx === 0) gfx.moveTo(sx, sy);
      else gfx.lineTo(sx, sy);
    });
    gfx.closePath();
    gfx.strokePath();
  }

  this.tileMap[`${q},${r}`] = gfx;
}

/**
 * Terrain color map
 */
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
