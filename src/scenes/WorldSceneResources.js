// src/scenes/WorldSceneResources.js

/* =========================================================================
   Resource spawner & helpers
   - Places 5 🐟 fish resources on random water hexes
   - Enforces minimum hex distance of 8 between fish
   - Safe to call multiple times (won’t duplicate existing fish at same hex)
   - Fully deterministic for a given seed (derives its own PRNG from seed)
   ======================================================================= */

import { cyrb128, sfc32 } from '../engine/PRNG.js';

export function spawnFishResources() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  if (!scene || !Array.isArray(scene.mapData) || !scene.mapData.length) {
    console.warn('[Resources] spawnFishResources(): no mapData on scene.');
    return;
  }

  // init holder
  scene.resources = scene.resources || [];

  // Already have 5+ fish? do nothing.
  const existingFish = scene.resources.filter(r => r.type === 'fish');
  if (existingFish.length >= 5) return;

  // Build list of candidate *water* tiles
  const waterTiles = (scene.mapData || []).filter(isWaterTile);
  if (!waterTiles.length) {
    console.warn('[Resources] spawnFishResources(): no water tiles found.');
    return;
  }

  // Gather already-placed fish coordinates to respect min distance
  const placed = existingFish.map(f => ({ q: f.q, r: f.r }));

  // We’ll try to place up to (5 - existing) new fish
  const need = 5 - existingFish.length;
  const rnd = getRng(scene);

  // Shuffle candidates for variety (but deterministic with seed RNG)
  const shuffled = [...waterTiles];
  shuffleInPlace(shuffled, rnd);

  let created = 0;

  for (const tile of shuffled) {
    if (created >= need) break;

    const { q, r } = tile;
    if (!inBounds(scene, q, r)) continue;

    // Enforce minimum hex distance to all already placed fish
    const ok = placed.every(p => hexDistanceAxial(p.q, p.r, q, r) >= 8);
    if (!ok) continue;

    // Avoid duplicates on same hex if something already placed there
    const already = scene.resources.find(o => o.type === 'fish' && o.q === q && o.r === r);
    if (already) continue;

    // Create visible emoji
    const pos = scene.axialToWorld
      ? scene.axialToWorld(q, r)
      : fallbackAxialToWorld(scene, q, r); // fallback includes offset

    const obj = scene.add.text(pos.x, pos.y, '🐟', {
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5).setDepth(2050);

    scene.resources.push({ type: 'fish', q, r, obj });
    placed.push({ q, r });
    created += 1;
  }

  console.log(
    `[Resources] spawnFishResources(): waterTiles=${waterTiles.length}, existing=${existingFish.length}, createdNow=${created}`
  );
}

/* =========================
   Helpers
   ========================= */

// Robust water check: takes a *tile* object.
function isWaterTile(tile) {
  if (!tile) return false;
  const type = (tile.type || '').toString().toLowerCase();
  // support future variants like 'ocean', 'sea'
  return type === 'water' || type === 'ocean' || type === 'sea';
}

/**
 * Deterministic RNG for fish, derived from map seed.
 * This avoids depending on the *current* state of hexMap.rand,
 * so different call orders on different clients don't desync fish.
 */
function getRng(scene) {
  const baseSeed =
    (scene && scene.seed) ||
    (scene && scene.hexMap && scene.hexMap.seed) ||
    'defaultseed';

  const state = cyrb128(String(baseSeed) + '|fish');
  return sfc32(state[0], state[1], state[2], state[3]);
}

function inBounds(scene, q, r) {
  const W = scene.mapWidth ?? 25;
  const H = scene.mapHeight ?? 25;
  return q >= 0 && r >= 0 && q < W && r < H;
}

// Fisher–Yates, but with injectable RNG for determinism
function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Axial distance using cube conversion
function hexDistanceAxial(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

// Only used if scene.axialToWorld isn’t bound yet
function fallbackAxialToWorld(scene, q, r) {
  const size = scene.hexSize || 24;
  const p = scene.hexToPixel
    ? scene.hexToPixel(q, r, size)
    : { x: q * size, y: r * size };

  // include map offset here so behaviour matches axialToWorld
  return {
    x: p.x + (scene.mapOffsetX || 0),
    y: p.y + (scene.mapOffsetY || 0),
  };
}
