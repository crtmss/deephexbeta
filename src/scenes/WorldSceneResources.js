// deephexbeta/src/scenes/WorldSceneResources.js

/* =========================================================================
   Resource spawner & helpers
   - Places 5 🐟 fish resources on random water hexes
   - Enforces minimum hex distance of 8 between fish
   - Safe to call multiple times (won’t duplicate existing fish at same hex)
   ======================================================================= */

export function spawnFishResources() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  // collect or init holder
  scene.resources = scene.resources || [];

  // Already have 5+ fish? do nothing.
  const existingFish = scene.resources.filter(r => r.type === 'fish');
  if (existingFish.length >= 5) return;

  // Build list of candidate water tiles
  const waterTiles = (scene.mapData || []).filter(t => _isWater(t.type));
  if (waterTiles.length === 0) return;

  // Gather already-placed fish coordinates to respect min distance
  const placed = existingFish.map(f => ({ q: f.q, r: f.r }));

  // We’ll try to place up to (5 - existing) new fish
  const need = 5 - existingFish.length;
  const rnd = _rng(scene);

  // Shuffle candidates for variety
  const shuffled = [...waterTiles].sort(() => rnd() - 0.5);

  for (const tile of shuffled) {
    if (placed.length >= existingFish.length + need) break;

    const { q, r } = tile;
    // Enforce bounds (0..mapWidth-1 / 0..mapHeight-1) just in case
    if (!_inBounds(scene, q, r)) continue;

    // Enforce minimum hex distance to all already placed fish
    const ok = placed.every(p => _hexDistanceAxial(p.q, p.r, q, r) >= 8);
    if (!ok) continue;

    // Avoid duplicates on same hex if something already placed there
    const already = scene.resources.find(o => o.type === 'fish' && o.q === q && o.r === r);
    if (already) continue;

    // Create visible emoji
    const pos = scene.axialToWorld
      ? scene.axialToWorld(q, r)
      : _fallbackAxialToWorld(scene, q, r); // fallback includes offset

    const obj = scene.add.text(pos.x, pos.y, '🐟', {
      fontSize: '18px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(2050);

    scene.resources.push({ type: 'fish', q, r, obj });
    placed.push({ q, r });
  }
}

/* =========================
   Helpers
   ========================= */

function _isWater(terrainType) {
  const t = String(terrainType || '').toLowerCase();
  return t === 'water' || t === 'ocean' || t === 'sea';
}

function _rng(scene) {
  if (scene?.hexMap && typeof scene.hexMap.rand === 'function') return scene.hexMap.rand;
  return Math.random;
}

function _inBounds(scene, q, r) {
  const W = scene.mapWidth ?? 25;
  const H = scene.mapHeight ?? 25;
  return q >= 0 && r >= 0 && q < W && r < H;
}

// Axial distance using cube conversion
function _hexDistanceAxial(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

// Only used if scene.axialToWorld isn’t bound yet
function _fallbackAxialToWorld(scene, q, r) {
  const p = scene.hexToPixel
    ? scene.hexToPixel(q, r, scene.hexSize || 24)
    : { x: q * 24, y: r * 24 };

  // include map offset here so behaviour matches axialToWorld
  return {
    x: p.x + (scene.mapOffsetX || 0),
    y: p.y + (scene.mapOffsetY || 0),
  };
}
