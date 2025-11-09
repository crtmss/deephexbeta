// deephexbeta/src/scenes/WorldSceneResources.js

/* =========================================================================
   Resource system (Fish)
   - Places N fish resources (🐟) on random WATER tiles.
   - Ensures a minimum axial hex distance between resources.
   - Stores resources under scene.resources = [{ type:'fish', q, r, obj }]
   - Deterministic if scene.hexMap.rng exists (uses your map RNG).
   ======================================================================= */

const COLORS = {
  fishText: '#ffffff',
};

const Z = {
  resources: 2060, // above terrain, below menus/buildings
};

/** Public API: place N fish with minDist (axial distance) */
export function spawnFishResources(count = 5, minDist = 8) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  if (!scene || !Array.isArray(scene.mapData)) {
    console.warn('[RES] spawnFishResources: scene.mapData missing.');
    return;
  }

  // Prepare resource store once
  scene.resources = scene.resources || [];

  // Gather candidate water tiles
  const waterTiles = scene.mapData.filter(t => _isWater(t?.type));
  if (waterTiles.length === 0) {
    console.warn('[RES] No water tiles on the map to place fish.');
    return;
  }

  const rand = scene?.hexMap?.rng ?? Math.random;
  const chosen = [];
  let attempts = 0;
  const maxAttempts = 5000;

  // Greedy random selection with min axial distance
  while (chosen.length < count && attempts < maxAttempts) {
    attempts++;
    const idx = Math.floor(rand() * waterTiles.length);
    const pick = waterTiles[idx];
    if (!pick) continue;

    const ok = chosen.every(c => axialDistance(c.q, c.r, pick.q, pick.r) >= minDist);
    if (ok) chosen.push({ q: pick.q, r: pick.r });
  }

  if (chosen.length < count) {
    console.warn(`[RES] Only placed ${chosen.length}/${count} fish due to spacing constraints.`);
  }

  // Render the fish and register as resources
  chosen.forEach(({ q, r }) => _placeFish(scene, q, r));
}

/* =========================
   Internal helpers
   ========================= */

function _placeFish(scene, q, r) {
  const pos = scene.axialToWorld(q, r);
  const t = scene.add.text(pos.x, pos.y, '🐟', {
    fontSize: '18px',
    color: COLORS.fishText,
  }).setOrigin(0.5).setDepth(Z.resources);

  scene.resources.push({
    type: 'fish',
    q, r,
    obj: t,
  });

  // Optional: console for debug
  console.log(`[RES] Fish placed at (${q},${r}).`);
}

function _isWater(terrainType) {
  // tolerant to generator variants
  return terrainType === 'water' || terrainType === 'ocean' || terrainType === 'sea';
}

/** Standard axial hex distance (q,r) using cube conversion: x=q, z=r, y=-x-z */
export function axialDistance(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}
