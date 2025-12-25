// src/scenes/WorldSceneResources.js

/* =========================================================================
   Resource spawner & helpers
   - Places 5 🐟 fish resources on random water hexes
   - Places 2 🛢️ crude oil resources on *shallow* water hexes
   - Enforces minimum hex distance of 8 between same-type resources
   - Safe to call multiple times (won’t duplicate on same hex)
   - Fully deterministic per seed (separate RNG stream per resource type)
   - Hard rule: never spawn resources on mountain tiles
   - NEW: resources render as diamond badges with owner-colored background
   ======================================================================= */

import { cyrb128, sfc32 } from '../engine/PRNG.js';

/* ---------------------------------------------------------------
   Owner color helpers (same logic as MapLocations)
   --------------------------------------------------------------- */
const OWNER_COLORS = {
  0: 0xff3b30,
  1: 0x34c759,
  2: 0x0a84ff,
  3: 0xffcc00,
  ai0: 0xaf52de,
  ai1: 0x5e5ce6,
};
const NEUTRAL_GRAY = 0x9aa0a6;
const BADGE_BORDER = 0x0b1d2a;

function getOwnerColor(ownerId) {
  if (ownerId == null) return NEUTRAL_GRAY;
  return OWNER_COLORS[ownerId] ?? NEUTRAL_GRAY;
}

/* ---------------------------------------------------------------
   Badge rendering (diamond)
   --------------------------------------------------------------- */
function createDiamondBadge(scene, x, y, iconChar, ownerId, px, depth = 2050) {
  const badge = scene.add.container(x, y).setDepth(depth);

  const half = Math.max(14, Math.round(px * 0.95));
  const borderW = Math.max(2, Math.round(px * 0.12));
  const fillColor = getOwnerColor(ownerId);

  const g = scene.add.graphics();

  // border
  g.fillStyle(BADGE_BORDER, 1);
  g.beginPath();
  g.moveTo(0, -half);
  g.lineTo(half, 0);
  g.lineTo(0, half);
  g.lineTo(-half, 0);
  g.closePath();
  g.fillPath();

  // inner fill
  const inner = Math.max(4, half - borderW);
  g.fillStyle(fillColor, 1);
  g.beginPath();
  g.moveTo(0, -inner);
  g.lineTo(inner, 0);
  g.lineTo(0, inner);
  g.lineTo(-inner, 0);
  g.closePath();
  g.fillPath();

  const icon = scene.add.text(0, 0, iconChar, {
    fontFamily: 'Arial',
    fontSize: `${Math.max(12, Math.round(px * 0.72))}px`,
    color: '#ffffff',
  }).setOrigin(0.5);

  badge.add(g);
  badge.add(icon);

  return { badge, icon, bg: g };
}

/* ---------------------------------------------------------------
   Fish
   --------------------------------------------------------------- */
export function spawnFishResources() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  if (!scene || !Array.isArray(scene.mapData) || !scene.mapData.length) return;

  scene.resources = scene.resources || [];

  const existing = scene.resources.filter(r => r.type === 'fish');
  if (existing.length >= 5) return;

  const waterTiles = scene.mapData.filter(t => isWaterTile(t) && !isMountainTile(t));
  if (!waterTiles.length) return;

  const placed = existing.map(r => ({ q: r.q, r: r.r }));
  const need = 5 - existing.length;
  const rnd = getFishRng(scene);

  const shuffled = waterTiles.slice();
  shuffleInPlace(shuffled, rnd);

  let created = 0;
  const MIN_DIST = 8;

  for (const tile of shuffled) {
    if (created >= need) break;

    const { q, r } = tile;
    if (!inBounds(scene, q, r)) continue;

    if (placed.some(p => hexDistanceAxial(p.q, p.r, q, r) < MIN_DIST)) continue;
    if (scene.resources.some(o => o.type === 'fish' && o.q === q && o.r === r)) continue;

    const pos = scene.axialToWorld(q, r);
    const px = 18;

    const badgeObj = createDiamondBadge(scene, pos.x, pos.y, '🐟', null, px);

    scene.resources.push({
      type: 'fish',
      q, r,
      ownedByPlayer: null,
      badge: badgeObj.badge,
    });

    placed.push({ q, r });
    created++;
  }
}

/* ---------------------------------------------------------------
   Crude oil (cap = 2)
   --------------------------------------------------------------- */
export function spawnCrudeOilResources() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  if (!scene || !Array.isArray(scene.mapData) || !scene.mapData.length) return;

  scene.resources = scene.resources || [];

  const OIL_CAP = 2;
  const existing = scene.resources.filter(r => r.type === 'crudeOil');
  if (existing.length >= OIL_CAP) return;

  const shallowTiles = scene.mapData.filter(
    t => isShallowWaterTile(t) && !isMountainTile(t)
  );
  if (!shallowTiles.length) return;

  const placed = existing.map(r => ({ q: r.q, r: r.r }));
  const need = OIL_CAP - existing.length;
  const rnd = getOilRng(scene);

  const shuffled = shallowTiles.slice();
  shuffleInPlace(shuffled, rnd);

  let created = 0;
  const MIN_DIST = 8;

  for (const tile of shuffled) {
    if (created >= need) break;

    const { q, r } = tile;
    if (!inBounds(scene, q, r)) continue;

    if (placed.some(p => hexDistanceAxial(p.q, p.r, q, r) < MIN_DIST)) continue;
    if (scene.resources.some(o => o.type === 'crudeOil' && o.q === q && o.r === r)) continue;

    const pos = scene.axialToWorld(q, r);
    const px = 18;

    const badgeObj = createDiamondBadge(scene, pos.x, pos.y, '🛢️', null, px);

    scene.resources.push({
      type: 'crudeOil',
      q, r,
      ownedByPlayer: null,
      badge: badgeObj.badge,
    });

    placed.push({ q, r });
    created++;
  }
}

/* ---------------------------------------------------------------
   Helpers
   --------------------------------------------------------------- */
function isMountainTile(tile) {
  if (!tile) return false;
  const type = (tile.type || '').toLowerCase();
  const g = (tile.groundType || '').toLowerCase();
  if (type === 'mountain') return true;
  if (g === 'mountain') return true;
  if (tile.elevation === 7 && type !== 'water') return true;
  return false;
}

function isWaterTile(tile) {
  if (!tile) return false;
  if (tile.isWater === true) return true;
  if (typeof tile.waterDepth === 'number' && tile.waterDepth > 0) return true;
  const type = (tile.type || '').toLowerCase();
  return type === 'water' || type === 'ocean' || type === 'sea';
}

function isShallowWaterTile(tile) {
  if (!isWaterTile(tile)) return false;
  const d =
    typeof tile.waterDepth === 'number'
      ? tile.waterDepth
      : typeof tile.baseElevation === 'number'
        ? tile.baseElevation
        : tile.elevation ?? 2;
  return Math.max(1, Math.min(3, d)) === 3;
}

function getFishRng(scene) {
  const base = scene.seed || 'defaultseed';
  const s = cyrb128(`${base}|fish`);
  return sfc32(s[0], s[1], s[2], s[3]);
}

function getOilRng(scene) {
  const base = scene.seed || 'defaultseed';
  const s = cyrb128(`${base}|crudeOil`);
  return sfc32(s[0], s[1], s[2], s[3]);
}

function inBounds(scene, q, r) {
  return q >= 0 && r >= 0 && q < scene.mapWidth && r < scene.mapHeight;
}

function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function hexDistanceAxial(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(
    Math.abs(x1 - x2),
    Math.abs(y1 - y2),
    Math.abs(z1 - z2)
  );
}
