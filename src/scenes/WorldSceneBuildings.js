// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   All building logic lives here: constants, creation, and helpers.
   CURRENT: "docks" (emoji 🚢) — spawns on a random WATER hex within radius 1
   of the selected mobile base when the Docks button is pressed.
   ======================================================================= */

/* ---------- Visual style (match game UI) ---------- */
const COLORS = {
  glow: 0x6fe3ff,
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  labelText: '#e8f6ff',
};

const UI = {
  labelFontSize: 16,
  boxRadius: 8,
  boxStrokeAlpha: 0.9,
  zBuilding: 900,
};

/* ---------- Building registry (extend here later) ---------- */
export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '🚢', // :ship:
    validateTile(scene, q, r) {
      // Must be water
      const tile = _tileAt(scene, q, r);
      if (!tile || tile.type !== 'water') return false;

      // Must be within radius 1 of the selected mobile base
      const base = scene.selectedUnit;
      if (!base) return false;

      // Try to robustly detect "mobile base" role in current project data
      const isMobileBase =
        base.type === 'mobile_base' ||
        base.role === 'mobile_base' ||
        base.isBase === true ||
        /base/i.test(base.name || '');

      if (!isMobileBase) return false;

      return _axialDistance(base.q, base.r, q, r) === 1;
    },
  },
};

/* =========================
   Public API
   ========================= */

/**
 * Pressing the UI "Docks" button calls this (bound as .call(scene)).
 * It finds all valid water neighbors (radius 1) around the selected base,
 * picks one at random, and places a 🚢 Docks building there.
 */
export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  if (!scene.selectedUnit) {
    console.warn('[Docks] No unit selected.');
    return;
  }

  // Compute valid tiles (radius 1, water, adjacent to base)
  const valid = _computeValidTiles(scene, BUILDINGS.docks);
  if (valid.length === 0) {
    console.warn('[Docks] No valid water hex adjacent to the base.');
    return;
  }

  // Pick a random tile
  const pick = _getRandom(valid, scene);
  _placeBuilding(scene, BUILDINGS.docks, pick.q, pick.r);
}

/** Provided for completeness; not used by the auto-place flow. */
export function cancelPlacement() {
  // No-op for auto-place version (kept to match imports).
}

/** Provided for completeness; not used directly by UI (auto uses startDocksPlacement). */
export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeBuilding(scene, BUILDINGS.docks, q, r);
}

/* =========================
   Internal helpers
   ========================= */

function _placeBuilding(scene, buildingDef, q, r) {
  // Validate before placing to keep it robust
  if (!buildingDef.validateTile(scene, q, r)) {
    console.warn(`[${buildingDef.name}] Invalid placement at (${q},${r}).`);
    return;
  }

  // Prevent duplicate building on same hex
  scene.buildings = scene.buildings || [];
  const already = scene.buildings.some(b => b.q === q && b.r === r);
  if (already) {
    console.warn(`[${buildingDef.name}] A building already exists at (${q},${r}).`);
    return;
  }

  // Create visual widget at isometric world position
  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  // Label first so we can size the textbox
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

  container.add([box, label]);

  // Persist in scene state
  scene.buildings.push({
    type: buildingDef.key,
    name: buildingDef.name,
    emoji: buildingDef.emoji,
    q, r,
    containerId: container.id,
  });
}

/**
 * Compute all valid tiles for a building around the selected unit.
 * For Docks: radius-1 neighbors that are water and pass validation.
 * Returns an array of {q, r}.
 */
function _computeValidTiles(scene, buildingDef) {
  const out = [];
  const base = scene.selectedUnit;
  if (!base) return out;

  for (const dir of AXIAL_DIRS) {
    const q = base.q + dir.dq;
    const r = base.r + dir.dr;

    // Ensure inside map
    const tile = _tileAt(scene, q, r);
    if (!tile) continue;

    // No duplicate building on that tile
    const occupied = Array.isArray(scene.buildings)
      ? scene.buildings.some(b => b.q === q && b.r === r)
      : false;
    if (occupied) continue;

    if (buildingDef.validateTile(scene, q, r)) {
      out.push({ q, r });
    }
  }

  return out;
}

function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}

// axial distance (cube) in hex grids
function _axialDistance(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(
    Math.abs(x1 - x2),
    Math.abs(y1 - y2),
    Math.abs(z1 - z2)
  );
}

const AXIAL_DIRS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];

function _getRandom(arr, scene) {
  if (scene?.game?.renderer && Phaser?.Utils?.Array?.GetRandom) {
    return Phaser.Utils.Array.GetRandom(arr);
  }
  const i = Math.floor(Math.random() * arr.length);
  return arr[i];
}
