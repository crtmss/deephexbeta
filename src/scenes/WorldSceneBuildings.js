// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   All building logic lives here: constants, placement, drawing, creation.
   Current building implemented: "docks" (emoji 🚢) — water only, radius 1
   from the selected mobile base.
   ======================================================================= */

/* ---------- Visual style (match game UI) ---------- */
const COLORS = {
  glow: 0x6fe3ff,
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  hexFill: 0x6fe3ff,
  labelText: '#e8f6ff',
};

const UI = {
  hexAlpha: 0.10,
  hexStrokeAlpha: 0.85,
  labelFontSize: 16,
  boxRadius: 8,
  boxStrokeAlpha: 0.9,
  zHighlight: 1200,
  zBuilding: 900,
};

/* ---------- Building registry ---------- */
export const BUILDINGS = {
  docks: {
    key: 'Shipyard',
    name: 'Shipyard',
    emoji: '⚓',    // :ship:
    // validation: water tile, within radius 1 of selected mobile_base
    validateTile(scene, q, r) {
      const tile = _tileAt(scene, q, r);
      if (!tile || tile.type !== 'water') return false;
      const base = scene.selectedUnit;
      if (!base || base.type !== 'mobile_base') return false;
      return _axialDistance(base.q, base.r, q, r) === 1;
    },
  },

  // Placeholders for future buildings (extend later):
  // shipyard: { key: 'shipyard', name: 'Ship', emoji: '🚢', validateTile: (...) => true },
  // bridge:   { key: 'bridge',   name: 'Bridge',   emoji: '🌉', validateTile: (...) => true },
};

/* ---------- Public API ---------- */

/** Start placement mode for Docks. Called as startDocksPlacement.call(scene) */
export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  if (!scene.selectedUnit) return;
  if (scene.selectedUnit.type !== 'mobile_base') return; // restrict to mobile base for now

  _enterPlacement(scene, BUILDINGS.docks);
}

/** Cancel any ongoing placement, clearing highlights. */
export function cancelPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _clearHighlight(scene);
  scene.placing = null;
}

/** Place Docks at q,r (only if valid). Called via placeDocks.call(scene, q, r) */
export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeBuilding(scene, BUILDINGS.docks, q, r);
}

/* ---------- Internal helpers ---------- */

function _enterPlacement(scene, buildingDef) {
  // Compute valid set for preview/highlight
  const valid = _computeValidTiles(scene, buildingDef);
  if (valid.size === 0) {
    // nothing placeable; you can show a small toast here if you want
    return;
  }

  // Draw highlight
  _drawHighlight(scene, valid);

  // Hide actions panel while placing (optional)
  scene.hideUnitPanel?.();

  // Set placement mode
  scene.placing = {
    type: buildingDef.key,
    def: buildingDef,
    valid, // Set<string> of "q,r"
  };
}

function _computeValidTiles(scene, buildingDef) {
  const valid = new Set();

  // We only need radius 1 around the selected mobile base (for docks)
  const base = scene.selectedUnit;
  if (!base) return valid;

  for (const dir of AXIAL_DIRS) {
    const q = base.q + dir.dq;
    const r = base.r + dir.dr;
    if (buildingDef.validateTile(scene, q, r)) {
      valid.add(keyOf(q, r));
    }
  }

  // also ensure no existing building already on that tile
  if (Array.isArray(scene.buildings)) {
    [...valid].forEach(k => {
      const [qStr, rStr] = k.split(',');
      const q = +qStr, r = +rStr;
      const already = scene.buildings.some(b => b.q === q && b.r === r);
      if (already) valid.delete(k);
    });
  }

  return valid;
}

function _drawHighlight(scene, valid) {
  _clearHighlight(scene);
  const g = scene.add.graphics().setDepth(UI.zHighlight);
  g.lineStyle(3, COLORS.glow, UI.hexStrokeAlpha);
  g.fillStyle(COLORS.hexFill, UI.hexAlpha);

  valid.forEach(k => {
    const [qStr, rStr] = k.split(',');
    const q = +qStr, r = +rStr;
    const { x, y } = scene.axialToWorld(q, r);
    g.beginPath();
    scene.drawHex(g, x, y, scene.hexSize);
    g.closePath();
    g.strokePath();
    g.fillPath();
  });

  scene.buildHighlight = g;
}

function _clearHighlight(scene) {
  if (scene.buildHighlight) {
    scene.buildHighlight.destroy();
    scene.buildHighlight = null;
  }
}

function _placeBuilding(scene, buildingDef, q, r) {
  // Validate before placing
  if (!buildingDef.validateTile(scene, q, r)) {
    // invalid click during placement => just cancel
    cancelPlacement.call(scene);
    return;
  }

  // Create visual widget at isometric world position
  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  // Label first so we can measure
  const label = scene.add.text(0, 0, `${buildingDef.emoji}  ${buildingDef.name}`, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText,
  }).setOrigin(0.5);

  const pad = 6;
  const w = Math.max(64, label.width + pad * 2);
  const h = Math.max(26, label.height + pad * 2);

  const box = scene.add.graphics();
  box.fillStyle(COLORS.plate, 0.92);
  box.fillRoundedRect(-w / 2, -h / 2, w, h, UI.boxRadius);
  box.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  box.strokeRoundedRect(-w / 2, -h / 2, w, h, UI.boxRadius);

  // Order: box behind, label over
  container.add([box, label]);

  // Persist in scene state (lightweight local list for now)
  scene.buildings = scene.buildings || [];
  scene.buildings.push({
    type: buildingDef.key,
    q, r,
    containerId: container.id,
    name: buildingDef.name,
    emoji: buildingDef.emoji,
  });

  // Clean up placement visuals and mode
  cancelPlacement.call(scene);
}

/* ---------- Utility ---------- */

const AXIAL_DIRS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];

function keyOf(q, r) { return `${q},${r}`; }

function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}

// axial distance in hex grids
function _axialDistance(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}
