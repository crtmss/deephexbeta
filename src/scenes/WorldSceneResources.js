// src/scenes/WorldSceneResources.js

/* =========================================================================
   Resource spawner & helpers
   - Places 5 🐟 fish resources on random water hexes
   - Places 2 🛢️ crude oil resources on *shallow* water hexes   ✅ (was 5)
   - Enforces minimum hex distance of 8 between same-type resources
   - Safe to call multiple times (won’t duplicate on same hex)
   - Fully deterministic per seed (separate RNG stream per resource type)
   - Hard rule: never spawn resources on mountain tiles (extra safety)
   ======================================================================= */

import { cyrb128, sfc32 } from '../engine/PRNG.js';

/**
 * Spawn up to 5 fish on water tiles.
 * Deterministic per world seed; uses its own PRNG stream.
 */
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

  // Build list of candidate *water* tiles (and not mountain just in case)
  const waterTiles = (scene.mapData || []).filter(t => isWaterTile(t) && !isMountainTile(t));
  if (!waterTiles.length) {
    console.warn('[Resources] spawnFishResources(): no water tiles found.');
    return;
  }

  // Gather already-placed fish coordinates to respect min distance
  const placed = existingFish.map(f => ({ q: f.q, r: f.r }));

  const need = 5 - existingFish.length;
  const rnd  = getFishRng(scene);

  // Shuffle for variety, but deterministically
  const shuffled = waterTiles.slice();
  shuffleInPlace(shuffled, rnd);

  const MIN_DIST = 8;
  let created = 0;

  for (const tile of shuffled) {
    if (created >= need) break;

    const { q, r } = tile;
    if (!inBounds(scene, q, r)) continue;

    // Enforce minimum hex distance to all already placed fish
    let tooClose = false;
    for (const p of placed) {
      if (hexDistanceAxial(p.q, p.r, q, r) < MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Avoid duplicates on same hex if something already placed there
    const already = scene.resources.find(
      o => o.type === 'fish' && o.q === q && o.r === r
    );
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

/**
 * Spawn up to 2 crude oil resources on *shallow* water tiles.
 * Uses a separate deterministic RNG stream from fish.
 */
export function spawnCrudeOilResources() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  if (!scene || !Array.isArray(scene.mapData) || !scene.mapData.length) {
    console.warn('[Resources] spawnCrudeOilResources(): no mapData on scene.');
    return;
  }

  scene.resources = scene.resources || [];

  // ✅ Oil cap: 2 total
  const OIL_CAP = 2;

  // Already have 2+ oil? do nothing.
  const existingOil = scene.resources.filter(r => r.type === 'crudeOil');
  if (existingOil.length >= OIL_CAP) return;

  // Shallow water candidates only (and not mountain just in case)
  const shallowTiles = (scene.mapData || []).filter(t => isShallowWaterTile(t) && !isMountainTile(t));
  if (!shallowTiles.length) {
    console.warn('[Resources] spawnCrudeOilResources(): no shallow water tiles found.');
    return;
  }

  const placed = existingOil.map(o => ({ q: o.q, r: o.r }));
  const need   = OIL_CAP - existingOil.length;
  const rnd    = getOilRng(scene);

  const shuffled = shallowTiles.slice();
  shuffleInPlace(shuffled, rnd);

  const MIN_DIST = 8;
  let created = 0;

  for (const tile of shuffled) {
    if (created >= need) break;

    const { q, r } = tile;
    if (!inBounds(scene, q, r)) continue;

    // Minimum distance to other oil nodes
    let tooClose = false;
    for (const p of placed) {
      if (hexDistanceAxial(p.q, p.r, q, r) < MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Avoid duplicates on same hex
    const already = scene.resources.find(
      o => o.type === 'crudeOil' && o.q === q && o.r === r
    );
    if (already) continue;

    const pos = scene.axialToWorld
      ? scene.axialToWorld(q, r)
      : fallbackAxialToWorld(scene, q, r);

    const obj = scene.add.text(pos.x, pos.y, '🛢️', {
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5).setDepth(2050);

    scene.resources.push({ type: 'crudeOil', q, r, obj });
    placed.push({ q, r });
    created += 1;
  }

  console.log(
    `[Resources] spawnCrudeOilResources(): shallowTiles=${shallowTiles.length}, existing=${existingOil.length}, createdNow=${created}`
  );
}

/* =========================
   Helpers
   ========================= */

/**
 * Hard rule helper: treat explicit mountains (or elevation==7 legacy) as mountain.
 * Resources should not spawn there even if other predicates misfire.
 */
function isMountainTile(tile) {
  if (!tile) return false;
  const type = (tile.type || '').toString().toLowerCase();
  const g = (tile.groundType || '').toString().toLowerCase();
  if (type === 'mountain') return true;
  if (g === 'mountain') return true;
  if (tile.elevation === 7 && type !== 'water') return true;
  return false;
}

// unified “is water” predicate, tolerant to old fields.
function isWaterTile(tile) {
  if (!tile) return false;
  if (tile.isWater === true) return true;
  if (typeof tile.waterDepth === 'number' && tile.waterDepth > 0) return true;

  const type = (tile.type || '').toString().toLowerCase();
  if (type === 'water' || type === 'ocean' || type === 'sea') return true;

  // Future-proof: treat any explicit groundType of water as water
  const g = (tile.groundType || '').toString().toLowerCase();
  if (g === 'water') return true;

  return false;
}

/**
 * Shallow water = waterDepth 3 (or equivalent elevation fallback).
 * Uses same semantics as WorldSceneMap water coloring.
 */
function isShallowWaterTile(tile) {
  if (!isWaterTile(tile)) return false;

  let depth = 0;
  if (typeof tile.waterDepth === 'number') {
    depth = tile.waterDepth;
  } else if (typeof tile.baseElevation === 'number') {
    depth = tile.baseElevation;
  } else if (typeof tile.elevation === 'number') {
    depth = tile.elevation;
  }

  if (!depth) depth = 2;
  const d = Math.max(1, Math.min(3, depth));
  return d === 3; // 1=deep, 2=medium, 3=shallow
}

/**
 * Separate deterministic RNG stream for fish.
 * Uses world seed + "|fish".
 */
function getFishRng(scene) {
  const baseSeed =
    (scene && scene.seed) ||
    (scene && scene.hexMap && scene.hexMap.seed) ||
    'defaultseed';

  const state = cyrb128(String(baseSeed) + '|fish');
  return sfc32(state[0], state[1], state[2], state[3]);
}

/**
 * Separate deterministic RNG stream for crude oil.
 * Uses world seed + "|crudeOil".
 */
function getOilRng(scene) {
  const baseSeed =
    (scene && scene.seed) ||
    (scene && scene.hexMap && scene.hexMap.seed) ||
    'defaultseed';

  const state = cyrb128(String(baseSeed) + '|crudeOil');
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
  const dx = Math.abs(x1 - x2);
  const dy = Math.abs(y1 - y2);
  const dz = Math.abs(z1 - z2);
  return Math.max(dx, dy, dz);
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
