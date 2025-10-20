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
 * Return neighboring axial coordinates (odd-r offset layout)
 */
function getHexNeighbors(q, r) {
  const directions = (r % 2 === 0)
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
  return directions.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
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

/**
 * Draw the hex grid and place scenic object sprites based on tile data
 * Includes elevation shading, subtle shadows/contours, edge highlights,
 * center elevation numbers, and **isometric cliffs** along edges where
 * this tile is higher than its neighbor (visual 3D step effect).
 */
export function drawHexMap() {
  this.objects = this.objects || [];

  this.mapData.forEach(hex => {
    const {
      q, r, type,
      hasForest, hasRuin, hasCrashSite, hasVehicle,
      hasRoad, hasMountainIcon, elevation = 0
    } = hex;

    const { x, y } = this.hexToPixel(q, r, this.hexSize);
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
      .setDepth(3);
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
        const posX = x + dx;
        const posY = y + dy;
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
          }).setOrigin(0.5).setDepth(2);

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
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(ruin);
    }

    // 🚀 CRASHED SPACECRAFT
    if (hasCrashSite) {
      const rocket = this.add.text(x, y, '🚀', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(rocket);
    }

    // 🚙 ABANDONED VEHICLE
    if (hasVehicle) {
      const vehicle = this.add.text(x, y, '🚙', {
        fontSize: `${this.hexSize * 0.8}px`
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(vehicle);
    }

    // 🏔️ MOUNTAIN ICON
    if (hasMountainIcon) {
      const mountain = this.add.text(x, y, '🏔️', {
        fontSize: `${this.hexSize * 0.9}px`,
        fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
      }).setOrigin(0.5).setDepth(2);
      this.objects.push(mountain);
    }

    // 🛣️ Draw connecting lines for ancient roads
    if (hasRoad) {
      const neighbors = getHexNeighbors(q, r)
        .map(n => this.mapData.find(h => h.q === n.q && h.r === n.r && h.hasRoad))
        .filter(Boolean);

      neighbors.forEach(n => {
        const p1 = this.hexToPixel(q, r, this.hexSize);
        const p2 = this.hexToPixel(n.q, n.r, this.hexSize);
        const line = this.add.graphics().setDepth(1);

        // Adjust road brightness by elevation for contrast (clamped)
        const brightness = 0.60 + Math.min(4, Math.max(0, elevation)) * 0.05;
        const val = Math.max(0, Math.min(255, Math.round(153 * brightness)));
        const roadColor = Phaser.Display.Color.GetColor(val, val, val);

        line.lineStyle(2, roadColor, 0.7);
        line.beginPath();
        line.moveTo(p1.x, p1.y);
        line.lineTo(p2.x, p2.y);
        line.strokePath();
        this.objects.push(line);
      });
    }

    // 🔍 If debugMode is enabled, repurpose the center label to include a prefix
    if (this.debugMode && elevLabel && elevLabel.setText) {
      elevLabel.setText(`E:${elevation}`);
    }
  });
}

/**
 * Hex → pixel conversion (with padding)
 */
export function hexToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
  const y = size * 1.5 * r;
  return { x: x + size * 2, y: y + size * 2 };
}

/**
 * Pixel → hex conversion + round
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
 * Supports elevation shadows, **isometric cliffs**, contour rings, and edge highlights.
 */
export function drawHex(q, r, x, y, size, color, elevation = 0) {
  const gfx = this.add.graphics({ x: 0, y: 0 });

  // elevation shadow (draw first, soft offset downward)
  if (elevation > 0) {
    gfx.fillStyle(0x000000, 0.12 * elevation); // a bit stronger so it reads
    const cornersShadow = [];
    for (let i = 0; i < 6; i++) {
      const ang = Phaser.Math.DegToRad(60 * i + 30);
      cornersShadow.push({
        x: x + size * Math.cos(ang),
        y: y + size * Math.sin(ang) + elevation * (size * 0.10)
      });
    }
    gfx.beginPath();
    gfx.moveTo(cornersShadow[0].x, cornersShadow[0].y);
    cornersShadow.slice(1).forEach(c => gfx.lineTo(c.x, c.y));
    gfx.closePath();
    gfx.fillPath();
  }

  // Compute top-face corners once
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const ang = Phaser.Math.DegToRad(60 * i + 30);
    corners.push({ x: x + size * Math.cos(ang), y: y + size * Math.sin(ang) });
  }

  // === ISO CLIFFS: strong, visible side walls on drop edges ===
  if (elevation > 0) {
    // Tall enough to see: around 0.28 * size per elevation level
    const cliffPerLevel = Math.max(4, Math.round(size * 0.28));
    const neighbors = getHexNeighbors(q, r).map(n =>
      this.mapData.find(t => t.q === n.q && t.r === n.r)
    );

    for (let i = 0; i < 6; i++) {
      const nb = neighbors[i];
      const nbElev = nb && typeof nb.elevation === 'number' ? nb.elevation : 0;
      const diff = elevation - nbElev;
      if (diff <= 0) continue; // only when this tile is higher

      const h = diff * cliffPerLevel;

      // Edge from corner i to i+1
      const a = corners[i];
      const b = corners[(i + 1) % 6];

      // Bottom edge points (extruded downwards by +y)
      const a2 = { x: a.x, y: a.y + h };
      const b2 = { x: b.x, y: b.y + h };

      // Wall fill and outline — darker with stronger drop
      // Slight directional lighting: darker on SE/S edges (2..4)
      const dirFactor = (i === 2 || i === 3 || i === 4) ? 0.55 : 0.65;
      const wallBase = darkenColor(color, dirFactor);
      const wallFill = darkenColor(wallBase, 0.85);
      const wallStroke = darkenColor(wallBase, 0.6);

      // Fill wall quad
      gfx.fillStyle(wallFill, 1);
      gfx.lineStyle(2, wallStroke, 0.9);
      gfx.beginPath();
      gfx.moveTo(a.x, a.y);
      gfx.lineTo(b.x, b.y);
      gfx.lineTo(b2.x, b2.y);
      gfx.lineTo(a2.x, a2.y);
      gfx.closePath();
      gfx.fillPath();
      gfx.strokePath();

      // Add AO (ambient occlusion) rim at the top of the drop edge
      gfx.lineStyle(3, darkenColor(0x000000, 0.6), 0.25 + 0.05 * diff);
      gfx.beginPath();
      gfx.moveTo(a.x, a.y);
      gfx.lineTo(b.x, b.y);
      gfx.strokePath();

      // Optional: subtle vertical hatch lines inside the wall for texture
      const hatchStep = Math.max(4, Math.round(size * 0.12));
      const edgeDx = (b.x - a.x);
      const edgeDy = (b.y - a.y);
      const edgeLen = Math.max(1, Math.hypot(edgeDx, edgeDy));
      const ux = edgeDx / edgeLen, uy = edgeDy / edgeLen; // unit along edge
      // perpendicular "down" is (0, +1), so hatch just vertical segments
      gfx.lineStyle(1, darkenColor(wallFill, 0.8), 0.35);
      for (let t = hatchStep; t < edgeLen; t += hatchStep) {
        const hx = a.x + ux * t;
        const hy = a.y + uy * t;
        gfx.beginPath();
        gfx.moveTo(hx, hy + 1);
        gfx.lineTo(hx, hy + h - 1);
        gfx.strokePath();
      }
    }
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

  // subtle directional highlight along top-right edges for elevated tiles
  if (elevation >= 2) {
    // Assume light comes from top-left; highlight edges facing that direction.
    const highlightAlpha = 0.10 + 0.03 * (elevation - 2);
    gfx.lineStyle(2, 0xffffff, highlightAlpha);
    // Edges: from corner 0→1 and 1→2 (roughly top-right on pointy-top hexes)
    gfx.beginPath();
    gfx.moveTo(corners[0].x, corners[0].y);
    gfx.lineTo(corners[1].x, corners[1].y);
    gfx.moveTo(corners[1].x, corners[1].y);
    gfx.lineTo(corners[2].x, corners[2].y);
    gfx.strokePath();
  }

  // contour rings (visual only; capped to 3 for clarity)
  const cx = x, cy = y;
  for (let i = 1; i <= Math.min(3, elevation); i++) {
    gfx.lineStyle(0.5, 0x000000, 0.10);
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
