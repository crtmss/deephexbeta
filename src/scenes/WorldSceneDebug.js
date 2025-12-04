// src/scenes/WorldSceneDebug.js
//
// Simple top-center debug menu for hydrology controls.
//
// Buttons:
//   - Remove Water        → convert all type:"water" tiles to sand (lvl 4), no water overlay
//   - + Water Level       → worldWaterLevel += 1   (clamped 0..7), reapply isCoveredByWater
//   - - Water Level       → worldWaterLevel -= 1   (clamped 0..7), reapply isCoveredByWater
//   - Fill Water @ 3      → worldWaterLevel = 3    (baseline flooding)
//
/**
 * We assume:
 *  - scene.mapData is an array of tiles { q, r, type, elevation, isCoveredByWater, ... }
 *  - scene.redrawWorld() exists and re-renders the map/locations/resources
 *  - Mountains are tiles with elevation === 7 (these get hasMountainIcon = true)
 */

function getTiles(scene) {
  if (Array.isArray(scene?.mapData)) return scene.mapData;
  if (Array.isArray(scene?.mapInfo?.tiles)) return scene.mapInfo.tiles;
  return [];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// --- WATER LOGIC ------------------------------------------------------------

// Option A: permanently convert "real" water tiles into land (sand, level 4).
function removeAllWaterToSand(scene) {
  const tiles = getTiles(scene);

  for (const t of tiles) {
    if (!t) continue;

    if (t.type === 'water') {
      // Convert to sand shoreline
      t.type = 'sand';
      t.elevation = 4;
      t.isCoveredByWater = false;
      t.impassable = false;
      t.movementCost = 2; // same as terrainTypes.sand in HexMap
    }

    // Recompute mountain icon: only for lvl 7
    t.hasMountainIcon = (t.elevation === 7);
  }

  // After removing all ocean, treat overlay water as turned off
  scene.worldWaterLevel = 0;
}

// Re-apply overlay flooding based on worldWaterLevel and elevation.
function reapplyWaterOverlay(scene) {
  const tiles = getTiles(scene);
  const wl = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;

  for (const t of tiles) {
    if (!t) continue;

    const elev = typeof t.elevation === 'number' ? t.elevation : 4;

    if (t.type === 'water') {
      // "True" water tiles are always covered by water
      t.isCoveredByWater = true;
    } else {
      // Land tiles can be flooded if low enough
      t.isCoveredByWater = elev <= wl;
    }

    // Only elevation 7 should show mountain icon
    t.hasMountainIcon = (elev === 7);
  }
}

// --- UI HELPERS -------------------------------------------------------------

function makeButton(scene, label, onClick) {
  const txt = scene.add.text(0, 0, label, {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e7f7ff',
    backgroundColor: '#0b1a28',
    padding: { x: 8, y: 5 }
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

// --- PUBLIC API -------------------------------------------------------------

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
    padding: { x: 8, y: 5 }
  }).setOrigin(0.5, 0).setDepth(20000);

  scene.__waterLevelLabel = badge;
  updateWaterLabel(scene);

  // Buttons
  const btnRemove = makeButton(scene, 'Remove Water', () => {
    removeAllWaterToSand(scene);
    updateWaterLabel(scene);
    scene.redrawWorld?.();
  });

  const btnInc = makeButton(scene, '+ Water Level', () => {
    scene.worldWaterLevel = clamp((scene.worldWaterLevel ?? 3) + 1, 0, 7);
    reapplyWaterOverlay(scene);
    updateWaterLabel(scene);
    scene.redrawWorld?.();
  });

  const btnDec = makeButton(scene, '- Water Level', () => {
    scene.worldWaterLevel = clamp((scene.worldWaterLevel ?? 3) - 1, 0, 7);
    reapplyWaterOverlay(scene);
    updateWaterLabel(scene);
    scene.redrawWorld?.();
  });

  const btnFill3 = makeButton(scene, 'Fill Water @ 3', () => {
    scene.worldWaterLevel = 3;
    reapplyWaterOverlay(scene);
    updateWaterLabel(scene);
    scene.redrawWorld?.();
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
  scene.worldWaterLevel = clamp(level, 0, 7);
  reapplyWaterOverlay(scene);
  updateWaterLabel(scene);
  scene.redrawWorld?.();
}