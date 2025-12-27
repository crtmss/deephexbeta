// src/scenes/WorldSceneResources.js

/* =========================================================================
   Resource spawner & helpers
   - Places 5 🐟 fish resources on random water hexes
   - Places 2 🛢️ crude oil resources on *shallow* water hexes   ✅ (was 5)
   - Enforces minimum hex distance of 8 between same-type resources
   - Safe to call multiple times (won’t duplicate on same hex)
   - Fully deterministic per seed (separate RNG stream per resource type)
   - Hard rule: never spawn resources on mountain tiles (extra safety)
   - NEW: resources render as "badge" icons with background + border
          (neutral gray until ownedByPlayer is set)
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

    // Create visible emoji (NOW as badge)
    const pos = scene.axialToWorld
      ? scene.axialToWorld(q, r)
      : fallbackAxialToWorld(scene, q, r); // fallback includes offset

    // Keep original visual scale intent (was 18px)
    const px = 18;
    const { badge, icon, bg } = createDiamondBadge(scene, pos.x, pos.y, '🐟', {
      fontSizePx: px,
      ownedByPlayer: null,
      depth: 2050,
      tileRef: tile,
    });

    // Backwards compatibility:
    // - 'obj' used to be a Text; now we store the badge container in 'obj'
    // - also store refs for later recolor when claimed
    scene.resources.push({
      type: 'fish',
      q,
      r,
      obj: badge,
      badge,
      icon,
      bg,
      ownedByPlayer: null,
    });

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

    // Create visible emoji (NOW as badge)
    const px = 18;
    const { badge, icon, bg } = createDiamondBadge(scene, pos.x, pos.y, '🛢️', {
      fontSizePx: px,
      ownedByPlayer: null,
      depth: 2050,
      tileRef: tile,
    });

    scene.resources.push({
      type: 'crudeOil',
      q,
      r,
      obj: badge,
      badge,
      icon,
      bg,
      ownedByPlayer: null,
    });

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

/* =========================================================================
   NEW: Badge rendering helpers (diamond background + border)
   - Neutral gray if ownedByPlayer is null/undefined
   - If scene provides getOwnerColor(ownerId), we respect it
   - Otherwise fallback palette (6 colors: 4 players + 2 AI)
   ========================================================================= */

const RES_NEUTRAL_GRAY = 0x9aa0a6;
const RES_BADGE_BORDER = 0x0b1d2a;

const RES_DEFAULT_OWNER_COLORS = {
  0: 0xff3b30, // P0 red
  1: 0x34c759, // P1 green
  2: 0x0a84ff, // P2 blue
  3: 0xffcc00, // P3 yellow
  ai0: 0xaf52de, // AI0 purple
  ai1: 0x5e5ce6, // AI1 indigo
};

function resolveOwnerColor(scene, ownerId) {
  if (ownerId === null || ownerId === undefined) return RES_NEUTRAL_GRAY;

  // Prefer scene helper if present
  try {
    if (scene && typeof scene.getOwnerColor === 'function') {
      const c = scene.getOwnerColor(ownerId);
      if (Number.isFinite(c)) return c;
    }
  } catch (_) {}

  // Prefer scene palette if present
  const pal =
    scene?.ownerColors ||
    scene?.playerColors ||
    scene?.colorsByOwner ||
    null;

  if (pal) {
    if (Array.isArray(pal) && typeof ownerId === 'number' && pal[ownerId] != null) {
      return pal[ownerId];
    }
    if (typeof pal === 'object' && pal[ownerId] != null) {
      return pal[ownerId];
    }
  }

  if (RES_DEFAULT_OWNER_COLORS[ownerId] != null) return RES_DEFAULT_OWNER_COLORS[ownerId];
  if (typeof ownerId === 'number' && RES_DEFAULT_OWNER_COLORS[ownerId] != null) return RES_DEFAULT_OWNER_COLORS[ownerId];
  return RES_NEUTRAL_GRAY;
}

/**
 * Create a diamond badge at x,y with an emoji icon centered.
 * Returns { badge, icon, bg } where:
 * - badge: Phaser.Container
 * - icon: Phaser.Text
 * - bg: Phaser.Graphics (background + border)
 *
 * Note: we store bg so other systems can recolor it later on claim.
 */

function createDiamondBadge(scene, x, y, emoji, opts) {
  const o = opts || {};
  const depth = o.depth != null ? o.depth : 120;
  const px = (o.px != null ? o.px : (o.fontSizePx != null ? o.fontSizePx : 28));

  const ROMB_KEY = "rombFrameForObjects";

  const ensureRombTexture = () => {
    if (scene.textures && scene.textures.exists(ROMB_KEY)) return true;
    if (!scene._rombFrameQueued && scene.load && typeof scene.load.image === "function") {
      scene._rombFrameQueued = true;
      // IMPORTANT: do NOT import PNG as a module; load by URL string to avoid MIME module errors
      scene.load.image(ROMB_KEY, "src/assets/sprites/RombFrameForObjects.png");
      scene.load.once("complete", () => scene.events.emit("rombFrameLoaded"));
      if (typeof scene.load.start === "function") scene.load.start();
    }
    return false;
  };

  if (!scene._rombBadgesResources) scene._rombBadgesResources = [];
  if (!scene._rombBadgeUpdaterInstalled) {
    scene._rombBadgeUpdaterInstalled = true;
    scene.events.on("postupdate", () => {
      const players = scene.players || [];
      if (!players.length) return;

      for (const u of players) {
        if (!u || u.isDead) continue;
        const q = u.q, r = u.r;
        if (!Number.isFinite(q) || !Number.isFinite(r)) continue;

        for (const b of scene._rombBadgesResources) {
          if (!b || !b._tile) continue;
          if (b._tile.q === q && b._tile.r === r) {
            const slot = (Number.isFinite(u.playerIndex) ? u.playerIndex : u.ownedByPlayer);
            if (slot == null) continue;
            if (b._tile.lastSteppedBy !== slot) {
              b._tile.lastSteppedBy = slot;
              const tint = getOwnerColor(scene, slot);
              if (b._bg && typeof b._bg.setTint === "function") b._bg.setTint(tint);
            }
          }
        }
      }
    });
  }

  const badge = scene.add.container(x, y).setDepth(depth);

  // Square size around emoji. Keep it square to avoid stretching.
  const half = Math.max(14, Math.round(px * 0.95));
  const size = half * 2;

  const hasTex = ensureRombTexture();
  const bg = scene.add.image(0, 0, ROMB_KEY).setOrigin(0.5);
  bg.setDisplaySize(size, size);

  // Start neutral gray; recolor when a player steps on it
  bg.setTint(RES_NEUTRAL_GRAY);

  const icon = scene.add
    .text(0, 0, emoji, {
      fontFamily: "Arial",
      fontSize: `${Math.max(12, Math.round(px * 0.72))}px`,
      color: "#ffffff",
    })
    .setOrigin(0.5);

  // Background behind icon
  badge.add(bg);
  badge.add(icon);

  // Track + apply persisted tint if present
  const tileRef = o.tileRef || null;
  badge._bg = bg;
  badge._tile = tileRef;
  scene._rombBadgesResources.push(badge);

  if (tileRef && tileRef.lastSteppedBy != null) {
    const tint = getOwnerColor(scene, tileRef.lastSteppedBy);
    if (typeof bg.setTint === "function") bg.setTint(tint);
  }

  if (!hasTex) {
    scene.events.once("rombFrameLoaded", () => {
      if (!badge.scene) return;
      if (!(scene.textures && scene.textures.exists(ROMB_KEY))) return;
      bg.setTexture(ROMB_KEY);
    });
  }

  return { badge, icon, bg };
}
