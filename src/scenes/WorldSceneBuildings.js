// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   All building logic lives here: constants, creation, and helpers.
   CURRENT: "docks" (emoji 🚢) — spawns on a random WATER hex within radius 1
   of the SELECTED UNIT when the Docks button is pressed.
   ======================================================================= */

/* ---------- Visual style (match game UI) ---------- */
const COLORS = {
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
      // Must be a water tile
      const tile = _tileAt(scene, q, r);
      if (!tile || tile.type !== 'water') return false;

      // Need a selected unit (we don't enforce a specific "mobile base" type here,
      // to be compatible with your current unit objects)
      const u = scene.selectedUnit;
      if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return false;

      // Must be adjacent (radius 1) to the selected unit
      return _axialDistance(u.q, u.r, q, r) === 1;
    },
  },
};

/* =========================
   Public API
   ========================= */

/**
 * Pressing the UI "Docks" button should call this (bound as .call(scene)).
 * It finds all valid water neighbors (radius 1) around the SELECTED unit,
 * picks one at random, and places a 🚢 Docks building there.
 */
export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  if (!scene.selectedUnit) {
    console.warn('[Docks] No unit selected.');
    return;
  }

  // Gather valid candidates
  const candidates = _computeValidTiles(scene, BUILDINGS.docks);

  if (candidates.length === 0) {
    // Helpful debug so you can see what the neighbors look like
    const u = scene.selectedUnit;
    const neighborReport = AXIAL_DIRS.map(d => {
      const q = u.q + d.dq, r = u.r + d.dr;
      const t = _tileAt(scene, q, r);
      return `(${q},${r}) -> ${t ? t.type : 'off-map'}`;
    }).join(' | ');
    console.warn('[Docks] No valid adjacent water hex found. Neighbors:', neighborReport);
    return;
  }

  const pick = _getRandom(candidates, scene);
  _placeBuilding(scene, BUILDINGS.docks, pick.q, pick.r);
}

/** No-op kept for compatibility with existing imports. */
export function cancelPlacement() {}

/** Optional direct placement (validates again). */
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

  console.log(`[${buildingDef.name}] placed at (${q},${r}).`);
}

/**
 * Compute all valid tiles for a building around the selected unit.
 * For Docks: radius-1 neighbors that are water and pass validation.
 * Returns an array of {q, r}.
 */
function _computeValidTiles(scene, buildingDef) {
  const out = [];
  const u = scene.selectedUnit;
  if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return out;

  for (const dir of AXIAL_DIRS) {
    const q = u.q + dir.dq;
    const r = u.r + dir.dr;

    const tile = _tileAt(scene, q, r);
    if (!tile) continue; // off-map

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
