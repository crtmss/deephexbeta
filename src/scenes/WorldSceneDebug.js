// src/scenes/WorldSceneDebug.js
//
// Simple top-center debug menu for hydrology controls.
//
// Buttons:
//   - Remove Water        → permanently convert all current water/underwater tiles into sand land (baseElevation ≥ 4)
//   - + Water Level       → worldWaterLevel += 1 (clamped 0..7), then scene.recomputeWaterFromLevel()
//   - - Water Level       → worldWaterLevel -= 1 (clamped 0..7), then scene.recomputeWaterFromLevel()
//   - Fill Water @ 3      → worldWaterLevel = 3, then scene.recomputeWaterFromLevel()
//
// Assumptions (new system):
//   - Each tile has:
//       baseElevation: number (1..7; 1–3 underwater bands, 4–7 land)
//       elevation:     number (kept in sync with baseElevation for now)
//       groundType:    string (terrain type when NOT under water; e.g. 'grassland', 'sand')
//       type:          string (actual rendered type; becomes 'water' when tile is underwater)
//       isUnderWater:  boolean (true if currently flooded at worldWaterLevel)
//   - WorldScene defines:
//       worldWaterLevel: number
//       recomputeWaterFromLevel(): void   // converts tiles to water/non-water based on baseElevation & groundType
//       redrawWorld(): void               // full terrain+POI redraw (called by recomputeWaterFromLevel)

const keyOf = (q, r) => `${q},${r}`;

function getTiles(scene) {
  if (Array.isArray(scene?.mapData)) return scene.mapData;
  if (Array.isArray(scene?.mapInfo?.tiles)) return scene.mapInfo.tiles;
  return [];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// -----------------------------------------------------------------------------
// WATER LOGIC
// -----------------------------------------------------------------------------

/**
 * Permanently convert all currently water/underwater tiles into sand land.
 * - Sets baseElevation to at least 4 (shoreline+).
 * - Sets groundType & type to 'sand'.
 * - Clears isUnderWater / water flags.
 * - Then sets worldWaterLevel = 0 and calls scene.recomputeWaterFromLevel().
 */
function removeAllWaterToSand(scene) {
  const tiles = getTiles(scene);

  for (const t of tiles) {
    if (!t) continue;

    const isWaterNow =
      t.type === 'water' ||
      t.isUnderWater === true ||
      (typeof t.baseElevation === 'number' &&
        typeof scene.worldWaterLevel === 'number' &&
        t.baseElevation <= scene.worldWaterLevel);

    if (!isWaterNow) continue;

    // Boost anything that was "sea floor" up to land band
    const currentBase = (typeof t.baseElevation === 'number') ? t.baseElevation : 0;
    const newBase = currentBase > 0 ? Math.max(4, currentBase) : 4;

    t.baseElevation = newBase;
    t.elevation = newBase;

    // Permanently convert to sand land
    t.groundType = 'sand';
    t.type = 'sand';
    t.isUnderWater = false;
    t.isWater = false;
    t.isCoveredByWater = false;
    t.waterDepth = 0;
    t.impassable = false;
    t.movementCost = 2;        // matches terrainTypes.sand

    // Mountain icon only for real high peaks
    t.hasMountainIcon = (newBase >= 7);
  }

  const prev = scene.worldWaterLevel ?? 0;
  scene.worldWaterLevel = 0;

  if (typeof scene.recomputeWaterFromLevel === 'function') {
    scene.recomputeWaterFromLevel();
  } else {
    scene.redrawWorld?.();
  }

  console.log(
    `[WorldSceneDebug] Remove Water: water level reset from ${prev} to 0, all former water converted to sand.`
  );
}

/**
 * Change water level with debug info: logs how many hexes flooded/emerged.
 */
function applyWaterLevelWithDebug(scene, newLevel) {
  const tiles = getTiles(scene);
  if (!tiles.length) {
    console.log('[WorldSceneDebug] No tiles found when trying to change water level.');
    return;
  }

  const prevLevel = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;
  const targetLevel = clamp(newLevel, 0, 7);

  // Snapshot "underwater" before
  const prevUnder = new Set();
  for (const t of tiles) {
    if (!t) continue;
    if (t.isUnderWater) {
      prevUnder.add(keyOf(t.q, t.r));
    }
  }

  scene.worldWaterLevel = targetLevel;

  if (typeof scene.recomputeWaterFromLevel === 'function') {
    scene.recomputeWaterFromLevel();
  } else {
    scene.redrawWorld?.();
  }

  // Snapshot "underwater" after
  const afterUnder = new Set();
  for (const t of tiles) {
    if (!t) continue;
    if (t.isUnderWater) {
      afterUnder.add(keyOf(t.q, t.r));
    }
  }

  // Compute deltas
  let wentUnder = 0;
  let emerged = 0;

  for (const k of afterUnder) {
    if (!prevUnder.has(k)) wentUnder++;
  }
  for (const k of prevUnder) {
    if (!afterUnder.has(k)) emerged++;
  }

  console.log(
    `[WorldSceneDebug] Water level changed ${prevLevel} → ${targetLevel}: ` +
    `${wentUnder} tiles went underwater, ${emerged} tiles emerged from water ` +
    `(total underwater now: ${afterUnder.size}).`
  );

  updateWaterLabel(scene);
}

// -----------------------------------------------------------------------------
// UI HELPERS
// -----------------------------------------------------------------------------

function makeButton(scene, label, onClick) {
  const txt = scene.add.text(0, 0, label, {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e7f7ff',
    backgroundColor: '#0b1a28',
    padding: { x: 8, y: 5 },
  })
    .setOrigin(0.5, 0)
    .setDepth(20000)
    .setInteractive({ useHandCursor: true });

  txt.on('pointerover', () => {
    txt.setStyle({ backgroundColor: '#12324d' });
  });
  txt.on('pointerout', () => {
    txt.setStyle({ backgroundColor: '#0b1a28' });
  });
  txt.on('pointerdown', () => {
    if (scene.uiLocked) return;
    try {
      onClick?.();
    } catch (err) {
      console.error('[WorldSceneDebug] Button error:', err);
    }
  });

  return txt;
}

function updateWaterLabel(scene) {
  if (!scene.__waterLevelLabel) return;
  const wl = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;
  scene.__waterLevelLabel.setText(`Water Lvl: ${wl}`);
}

// -----------------------------------------------------------------------------
// PUBLIC API
// -----------------------------------------------------------------------------

export function initDebugMenu(scene) {
  // Clean up old menu if it exists
  if (scene.__debugMenuContainer) {
    scene.__debugMenuContainer.destroy(true);
    scene.__debugMenuContainer = null;
  }

  // Ensure worldWaterLevel has a sane default
  if (!Number.isFinite(scene.worldWaterLevel)) {
    scene.worldWaterLevel = 3;
  }

  const cam = scene.cameras && scene.cameras.main;
  const screenCenterX = cam ? cam.centerX : 400;
  const screenTopY = 2;

  const container = scene.add.container(screenCenterX, screenTopY).setDepth(19999);
  scene.__debugMenuContainer = container;

  // Badge with current water level
  const badge = scene.add.text(0, 0, '', {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#a6edff',
    backgroundColor: '#062033',
    padding: { x: 8, y: 5 },
  }).setOrigin(0.5, 0).setDepth(20000);

  scene.__waterLevelLabel = badge;
  updateWaterLabel(scene);

  // Buttons
  const btnRemove = makeButton(scene, 'Remove Water', () => {
    removeAllWaterToSand(scene);
    updateWaterLabel(scene);
  });

  const btnInc = makeButton(scene, '+ Water Level', () => {
    const current = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;
    applyWaterLevelWithDebug(scene, current + 1);
  });

  const btnDec = makeButton(scene, '- Water Level', () => {
    const current = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;
    applyWaterLevelWithDebug(scene, current - 1);
  });

  const btnFill3 = makeButton(scene, 'Fill Water @ 3', () => {
    applyWaterLevelWithDebug(scene, 3);
  });

  // Simple manual layout: center row, fixed spacing
  const widgets = [badge, btnRemove, btnInc, btnDec, btnFill3];
  const spacing = 8;
  let totalWidth = 0;

  // First pass: estimate row width
  for (const w of widgets) {
    totalWidth += w.width + spacing;
  }
  totalWidth -= spacing;

  let currentX = -totalWidth / 2;
  for (const w of widgets) {
    w.x = currentX + w.width / 2;
    w.y = 0;
    container.add(w);
    currentX += w.width + spacing;
  }
}

// OPTIONAL helper if you want to tweak water level from other systems.
export function setWaterLevel(scene, level) {
  applyWaterLevelWithDebug(scene, level);
}

export default {
  initDebugMenu,
  setWaterLevel,
};
