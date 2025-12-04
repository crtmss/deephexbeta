// src/scenes/WorldSceneDebug.js
//
// Debug/top-center menu for hydrology controls.
// Actions:
//   - Remove Water            → convert all type:"water" tiles to sand (lvl 4), clear overlays
//   - Increase Water Level    → worldWaterLevel += 1, reapply isCoveredByWater
//   - Decrease Water Level    → worldWaterLevel -= 1, reapply isCoveredByWater
//   - Fill Water at Level 3   → worldWaterLevel = 3, reapply isCoveredByWater
//
// Assumptions:
//   - scene.mapData is an array of tile objects { q,r,type,elevation,isCoveredByWater,... }
//   - scene.redrawWorld() exists and re-renders the map and layers
//   - Mountains are tiles with elevation === 7 (impassable)
//   - Level semantics: 1–3 water bands, 4 shoreline, 5–6 land, 7 mountains
//
// NOTE: We keep "ocean" hexes encoded as type:"water". The “Remove Water” action
//       is *destructive* by design: it converts those to land (sand lvl 4).
//       Overlay water (isCoveredByWater on land tiles) is controlled by worldWaterLevel.

const keyOf = (q, r) => `${q},${r}`;

// ---- helpers ---------------------------------------------------------------

function getAllTiles(scene) {
  // Prefer mapInfo.tiles if present to stay in sync with other systems
  const tiles = scene?.mapInfo?.tiles || scene?.mapData || [];
  return Array.isArray(tiles) ? tiles : [];
}

function setToSandLevel4(tile) {
  tile.type = 'sand';
  tile.elevation = 4;
  tile.isCoveredByWater = false;
  tile.impassable = false;
  tile.movementCost = 2; // same as terrainTypes.sand
  // clear any "hard" water flags that renderer may check
  tile.hasMountainIcon = false;
}

function reapplyWaterOverlay(scene) {
  const tiles = getAllTiles(scene);
  const wl = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;

  for (const t of tiles) {
    // Overlay only affects NON-water tiles. "type:'water'" is hard water/ocean.
    if (t.type !== 'water') {
      const elev = typeof t.elevation === 'number' ? t.elevation : 4;
      t.isCoveredByWater = elev <= wl;
    } else {
      // Ocean stays covered by water regardless of worldWaterLevel
      t.isCoveredByWater = true;
    }

    // Mountain icon only for elevation 7
    t.hasMountainIcon = (t.elevation === 7);
  }
}

function removeAllWaterToSand(scene) {
  const tiles = getAllTiles(scene);

  // 1) Convert every ocean/water tile into sand lvl 4
  for (const t of tiles) {
    if (t.type === 'water') {
      setToSandLevel4(t);
    }
  }

  // 2) Disable overlay water everywhere
  scene.worldWaterLevel = 0;
  for (const t of tiles) {
    t.isCoveredByWater = false;
    // keep elevation & movement as-is (except we changed true water to sand lvl 4)
    t.hasMountainIcon = (t.elevation === 7);
  }
}

function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

// ---- UI creation -----------------------------------------------------------

function makeButton(scene, x, y, label, onClick) {
  const btn = scene.add.text(x, y, label, {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e7f7ff',
    backgroundColor: '#0b1a28',
    padding: { x: 8, y: 6 }
  })
    .setOrigin(0.5, 0)
    .setDepth(20000)
    .setInteractive({ useHandCursor: true });

  btn.on('pointerover', () => {
    btn.setStyle({ backgroundColor: '#12324d' });
  });
  btn.on('pointerout', () => {
    btn.setStyle({ backgroundColor: '#0b1a28' });
  });
  btn.on('pointerdown', () => {
    // Guard UI spam
    if (scene.uiLocked) return;
    onClick?.();
  });

  return btn;
}

function updateWaterBadge(scene) {
  if (!scene.__waterLevelText) return;
  const wl = Number.isFinite(scene.worldWaterLevel) ? scene.worldWaterLevel : 3;
  scene.__waterLevelText.setText(`Water Lvl: ${wl}`);
}

// ---- public API ------------------------------------------------------------

export function initDebugMenu(scene) {
  // Create once; safely rebuild if camera size changes
  if (scene.__debugMenu) {
    scene.__debugMenu.destroy(true);
    scene.__debugMenu = null;
  }

  // Ensure we have a world water level
  if (!Number.isFinite(scene.worldWaterLevel)) {
    scene.worldWaterLevel = 3; // default requested model
  }

  const cam = scene.cameras?.main;
  const centerX = cam ? cam.centerX : 400;
  const topY = 2;

  const row = scene.add.container(centerX, topY).setDepth(19999);
  scene.__debugMenu = row;

  const gap = 8;
  let x = 0;

  const badge = scene.add.text(0, 0, '', {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#a6edff',
    backgroundColor: '#062033',
    padding: { x: 8, y: 6 }
  }).setOrigin(0.5, 0).setDepth(20000);
  scene.__waterLevelText = badge;
  updateWaterBadge(scene);

  const btnRemove = makeButton(scene, 0, 0, 'Remove Water', () => {
    removeAllWaterToSand(scene);
    updateWaterBadge(scene);
    scene.redrawWorld?.();
  });

  const btnInc = makeButton(scene, 0, 0, '+ Water Level', () => {
    scene.worldWaterLevel = clamp((scene.worldWaterLevel ?? 3) + 1, 0, 7);
    reapplyWaterOverlay(scene);
    updateWaterBadge(scene);
    scene.redrawWorld?.();
  });

  const btnDec = makeButton(scene, 0, 0, '- Water Level', () => {
    scene.worldWaterLevel = clamp((scene.worldWaterLevel ?? 3) - 1, 0, 7);
    reapplyWaterOverlay(scene);
    updateWaterBadge(scene);
    scene.redrawWorld?.();
  });

  const btnFill3 = makeButton(scene, 0, 0, 'Fill Water @ 3', () => {
    scene.worldWaterLevel = 3;
    reapplyWaterOverlay(scene);
    updateWaterBadge(scene);
    scene.redrawWorld?.();
  });

  // layout horizontally, centered on top
  const nodes = [badge, btnRemove, btnInc, btnDec, btnFill3];
  nodes.forEach((n, i) => {
    const w = n.width;
    n.setX(x + w / 2);
    row.add(n);
    x += w + gap;
  });

  // center container so the row is centered
  row.setX(centerX - x / 2 + (gap / 2));
}

// Utility for other systems (optional export)
export function setWaterLevel(scene, level /* 0..7 */) {
  scene.worldWaterLevel = clamp(level, 0, 7);
  reapplyWaterOverlay(scene);
  updateWaterBadge(scene);
  scene.redrawWorld?.();
}