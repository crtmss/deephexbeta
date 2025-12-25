// src/scenes/WorldSceneUnits.js
//
// Spawning players & enemies + orientation helpers.
// Bridge between "abstract game state" (lobby / seed)
// and concrete Phaser units on the map.

import { getLobbyState } from '../net/LobbyManager.js';
// Stage A unit stats infrastructure (pure logic + backwards compatible fields)
import { createUnitState, applyUnitStateToPhaserUnit } from '../units/UnitFactory.js';
import { getUnitDef } from '../units/UnitDefs.js';

// Basic visual / model constants
const UNIT_Z = {
  player: 2000,
  enemy:  2000,
  building: 1500, // Raider Camp marker
};

// 4 player colors (slots 0..3)
const PLAYER_COLORS = [
  0xff4b4b, // P1 - red
  0x4bc0ff, // P2 - blue
  0x54ff9b, // P3 - green
  0xffe14b, // P4 - yellow
];

// 2 AI colors (max 2 factions AI)
const AI_COLORS = [
  0xaa66ff, // AI0 - purple
  0x5e5ce6, // AI1 - indigo
];

// Border + neutral
const UNIT_BORDER_COLOR = 0x0b1d2a;
const UNIT_NEUTRAL_BG   = 0x9aa0a6;

/**
 * Owner key normalization:
 * - players are numeric slots 0..3
 * - AI are 'ai0' or 'ai1'
 */
function normalizeOwnerKey(ownerKey, fallback) {
  if (ownerKey === null || ownerKey === undefined) return fallback;
  if (typeof ownerKey === 'number') return ownerKey;
  const s = String(ownerKey).toLowerCase();
  if (s === 'ai0' || s === 'ai1') return s;
  // if someone passes 'ai' -> default ai0
  if (s === 'ai') return 'ai0';
  // fallback to numeric parse if possible
  const n = Number(ownerKey);
  if (Number.isFinite(n)) return n;
  return fallback;
}

/**
 * Resolve badge fill color for units (6 total):
 * - 4 players (0..3)
 * - 2 AI ('ai0','ai1')
 */
function colorForOwner(ownerKey) {
  const k = normalizeOwnerKey(ownerKey, null);
  if (k === null) return UNIT_NEUTRAL_BG;
  if (k === 'ai0') return AI_COLORS[0];
  if (k === 'ai1') return AI_COLORS[1];
  if (typeof k === 'number') return PLAYER_COLORS[((k % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
  return UNIT_NEUTRAL_BG;
}

// NEW: combat unit colors (tint derived from owner slot)
function colorForSlot(slot) {
  return colorForOwner(slot);
}

// Small axial helpers (odd-r)
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
}

function keyOf(q, r) {
  return q + ',' + r;
}

function axialDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function getTile(scene, q, r) {
  return (scene.mapData || []).find(t => t && t.q === q && t.r === r) || null;
}

/**
 * Single source of truth for "land" tiles.
 * Units may spawn ONLY on land:
 * - not water
 * - not mountain
 * - not under water / covered by water flags (some maps keep groundType but are flooded)
 */
function isLandTile(t) {
  if (!t) return false;

  // Primary type check
  if (t.type === 'water' || t.type === 'mountain') return false;

  // Flood flags (important!)
  if (t.isUnderWater === true) return false;
  if (t.isWater === true) return false;
  if (t.isCoveredByWater === true) return false;

  // Some generators keep groundType='mountain' but type differs
  if (t.groundType === 'mountain') return false;

  return true;
}

/**
 * Robust occupancy check across all unit arrays + buildings.
 */
function isOccupied(scene, q, r) {
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || [])
    .concat(scene.haulers || []);

  if (all.find(u => u && !u.isDead && u.q === q && u.r === r)) return true;

  // Buildings occupy a hex too (camp must not overlap)
  const buildings = (scene.buildings || []);
  if (buildings.find(b => b && typeof b.q === 'number' && typeof b.r === 'number' && b.q === q && b.r === r)) return true;

  return false;
}

function isBlockedForUnit(scene, q, r) {
  const t = getTile(scene, q, r);
  if (!isLandTile(t)) return true;

  // No stacking: any unit or building occupying blocks
  return isOccupied(scene, q, r);
}

function findFreeNeighbor(scene, q, r) {
  for (const [dq, dr] of neighborsOddR(q, r)) {
    const nq = q + dq;
    const nr = r + dr;
    if (nq < 0 || nr < 0 || nq >= (scene.mapWidth || 0) || nr >= (scene.mapHeight || 0)) continue;
    if (!isBlockedForUnit(scene, nq, nr)) return { q: nq, r: nr };
  }
  return null;
}

/**
 * Pick up to N reasonably spaced spawn tiles on land.
 * Deterministic (only depends on the map), so all clients
 * with the same seed and map will pick the same positions.
 */
function pickSpawnTiles(scene, count) {
  const map = scene.mapData || [];
  if (!map.length) return [];

  // land = ONLY tiles that pass isLandTile()
  const land = map.filter(isLandTile);
  if (!land.length) return [];

  const w = scene.mapWidth || 25;
  const h = scene.mapHeight || 25;

  const cx = w / 2;
  const cy = h / 2;

  // score tiles by angle sector + distance
  const tilesWithMeta = land.map(t => {
    const dx = t.q - cx;
    const dy = t.r - cy;
    const angle = Math.atan2(dy, dx); // -PI..PI
    const dist2 = dx * dx + dy * dy;
    return { tile: t, angle, dist2 };
  });

  // Split map into angular sectors and pick best from each
  const sectors = Math.max(1, count);
  const buckets = Array.from({ length: sectors }, () => []);

  tilesWithMeta.forEach(entry => {
    let a = entry.angle;
    if (a < 0) a += Math.PI * 2;
    const idx = Math.floor((a / (Math.PI * 2)) * sectors) % sectors;
    buckets[idx].push(entry);
  });

  const result = [];
  for (let i = 0; i < sectors; i++) {
    const bucket = buckets[i];
    if (!bucket.length) continue;
    // prefer tiles a bit away from center (larger dist2)
    bucket.sort((a, b) => b.dist2 - a.dist2);
    result.push(bucket[0].tile);
    if (result.length >= count) break;
  }

  // Fallback if not enough unique buckets
  let idx = 0;
  while (result.length < count && idx < land.length) {
    const candidate = land[idx++];
    if (result.indexOf(candidate) === -1) result.push(candidate);
  }

  return result.slice(0, count);
}

/* ======================================================================
   NEW: Unit badge visuals (directional background + non-rotating icon)
   - Background rotates to show facing
   - Icon NEVER rotates
   - Background fill color = owner color (player slot or ai0/ai1)
   ====================================================================== */

/**
 * Create a "directional badge" (like your unit mock):
 * - smooth teardrop: circle arc + nose (default points RIGHT)
 * Returns:
 *  { cont, bg, icon }
 *
 * Notes:
 * - cont is positioned at hex center
 * - bg is a Graphics object; rotate THIS for facing
 * - icon is Text; do not rotate
 */
function createDirectionalUnitBadge(scene, x, y, ownerKey, iconText, sizePx, depth) {
  const cont = scene.add.container(Math.round(x), Math.round(y)).setDepth(depth ?? UNIT_Z.player);

  const fill = colorForOwner(ownerKey);
  const s = Math.max(18, Math.round(sizePx || 28));

  // Even-ish border for a crisper look
  const borderW = 2;

  const bg = scene.add.graphics();
  bg.fillStyle(fill, 1);
  bg.lineStyle(borderW, UNIT_BORDER_COLOR, 1);

  // --- TRUE TEARDROP (circle + triangular nose), default points RIGHT ---
  // This version avoids the "almost full circle" bug and produces the expected cap shape.
  const radius  = Math.round(s * 0.56);
  const noseLen = Math.round(s * 0.70);

  // Slightly left so the "circle body" is dominant
  const cx = -Math.round(radius * 0.18);
  const cy = 0;

  // Nose join angle: smaller => narrower point
  const theta = Math.PI / 4.2; // ~43° (tweak 35..55°)

  // Join points (on circle rim)
  const jx = cx + radius * Math.cos(theta);
  const jy = radius * Math.sin(theta);

  const ax = Math.round(jx);
  const ay = Math.round(cy - jy);
  const bx = Math.round(jx);
  const by = Math.round(cy + jy);

  // Tip of the teardrop
  const tipX = Math.round(cx + radius + noseLen);
  const tipY = 0;

  // Build one clean path:
  // Start at A -> arc around LEFT side to B -> line to tip -> line back to A.
  bg.beginPath();
  bg.moveTo(ax, ay);

  // Arc around the LEFT side: from -theta to +theta anticlockwise (true)
  // In Phaser Graphics: arc(x,y,r,start,end,anticlockwise)
  bg.arc(cx, cy, radius, -theta, theta, true);

  bg.lineTo(tipX, tipY);
  bg.lineTo(ax, ay);
  bg.closePath();

  bg.fillPath();
  bg.strokePath();

  // Icon should sit on the round body center (not the overall centroid incl. nose)
  const icon = scene.add.text(Math.round(cx * 0.15), 0, iconText, {
    fontFamily: 'Arial',
    fontSize: `${Math.max(12, Math.round(s * 0.55))}px`,
    color: '#ffffff',
    stroke: '#0b0b0b',
    strokeThickness: 3,
  }).setOrigin(0.5);

  cont.add(bg);
  cont.add(icon);

  // Make interactive region stable
  try {
    const estW = (radius * 2) + noseLen;
    const estH = radius * 2;
    cont.setSize(estW, estH);
    cont.setInteractive();
  } catch (_) {}

  // Expose handles for orientation/color updates
  cont._dirBg = bg;
  cont._unitIcon = icon;
  cont._ownerKey = ownerKey;

  // Allow recolor when ownership changes (rebuild same geometry)
  cont.setOwnerKey = (newOwnerKey) => {
    cont._ownerKey = newOwnerKey;
    const newFill = colorForOwner(newOwnerKey);

    bg.clear();
    bg.fillStyle(newFill, 1);
    bg.lineStyle(borderW, UNIT_BORDER_COLOR, 1);

    bg.beginPath();
    bg.moveTo(ax, ay);
    bg.arc(cx, cy, radius, -theta, theta, true);
    bg.lineTo(tipX, tipY);
    bg.lineTo(ax, ay);
    bg.closePath();

    bg.fillPath();
    bg.strokePath();
  };

  return { cont, bg, icon };
}

/**
 * Creates a mobile base unit (player "king" piece).
 *
 * Now uses a directional badge (icon 🏠), with owner color background.
 */
function createMobileBase(scene, spawnTile, player, _color, playerIndex) {
  const pos = scene.axialToWorld(spawnTile.q, spawnTile.r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(26, Math.round(size * 1.35));

  const ownerKey = (typeof playerIndex === 'number') ? playerIndex : 0;

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🏠',
    s,
    UNIT_Z.player
  );

  const unit = cont;

  unit.q = spawnTile.q;
  unit.r = spawnTile.r;

  unit.type = 'mobile_base';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = player.id || null;
  unit.playerName = player.name || 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = playerIndex; // slot index 0..3

  const def = getUnitDef('mobile_base');
  const st = createUnitState({
    type: 'mobile_base',
    ownerId: unit.playerId,
    ownerSlot: playerIndex,
    controller: 'player',
    q: spawnTile.q,
    r: spawnTile.r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  unit.facingAngle = 0;

  // Keep a stable id for selection systems
  if (!unit.id && !unit.unitId) {
    unit.id = `mb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

/**
 * Creates a Raider.
 * If controller='ai', unit is enemy.
 *
 * ✅ NEW: Raider is a badge with a knife icon, icon does not rotate.
 * Background rotates for facing.
 */
function createRaider(scene, q, r, opts = {}) {
  const controller = opts.controller || 'player';
  const pos = scene.axialToWorld(q, r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(24, Math.round(size * 1.20));

  // owner key:
  // - player uses numeric slot
  // - AI uses 'ai0' or 'ai1' (default ai0)
  const ownerKey = (controller === 'ai')
    ? normalizeOwnerKey(opts.ownerKey ?? opts.aiKey ?? 'ai0', 'ai0')
    : normalizeOwnerKey(opts.ownerSlot ?? 0, 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🔪',
    s,
    controller === 'ai' ? UNIT_Z.enemy : UNIT_Z.player
  );

  const unit = cont;

  unit.q = q;
  unit.r = r;
  unit.type = (controller === 'ai') ? 'enemy_raider' : 'raider';
  unit.isEnemy = (controller === 'ai');
  unit.isPlayer = (controller !== 'ai');

  unit.playerId = (controller === 'ai') ? null : (opts.ownerId ?? null);
  unit.playerName = (controller === 'ai') ? 'AI' : (opts.ownerName ?? 'Player');
  unit.name = unit.playerName;
  unit.playerIndex = (controller === 'ai') ? null : (opts.ownerSlot ?? 0);

  const def = getUnitDef('raider');
  const st = createUnitState({
    type: 'raider',
    ownerId: unit.playerId,
    ownerSlot: unit.playerIndex,
    controller: controller,
    q,
    r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  unit.facingAngle = 0;

  if (controller === 'ai') {
    unit.controller = 'ai';
    unit.aiProfile = 'aggressive';
    unit._ownerKey = ownerKey;
  } else {
    unit._ownerKey = ownerKey;
  }

  // Ensure stable id for respawn tracking
  if (!unit.id && !unit.unitId) {
    unit.id = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

/**
 * Creates a simple enemy unit.
 * (kept for compatibility, but we no longer spawn these globally)
 */
function createEnemyUnit(scene, spawnTile) {
  const u = createRaider(scene, spawnTile.q, spawnTile.r, {
    controller: 'ai',
    ownerKey: 'ai0',
  });
  u.type = 'enemy_raider';
  u.isEnemy = true;
  u.isPlayer = false;
  u.controller = 'ai';
  u.aiProfile = 'aggressive';
  return u;
}

/**
 * Exported helper for AI respawn system (Raider Camp).
 */
export function spawnEnemyRaiderAt(scene, q, r) {
  // If you later add a second AI faction, pass ownerKey:'ai1' from camp logic.
  const u = createRaider(scene, q, r, { controller: 'ai', ownerKey: 'ai0' });
  u.type = 'enemy_raider';
  u.isEnemy = true;
  u.isPlayer = false;
  u.controller = 'ai';
  u.aiProfile = 'camp_raider';

  scene.units = scene.units || [];
  scene.enemies = scene.enemies || [];
  scene.units.push(u);
  scene.enemies.push(u);

  return u;
}

/**
 * Creates a player-controlled Transporter.
 * Now uses a directional badge (icon 🚚), icon does not rotate.
 */
function createTransporter(scene, q, r, owner) {
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(22, Math.round(size * 1.10));

  const slot = owner?.playerIndex ?? owner?.ownerSlot ?? 0;
  const ownerKey = normalizeOwnerKey(slot, 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🚚',
    s,
    UNIT_Z.player
  );

  const unit = cont;

  unit.q = q;
  unit.r = r;
  unit.type = 'transporter';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = owner?.playerId ?? owner?.ownerId ?? null;
  unit.playerName = owner?.playerName ?? owner?.name ?? 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = slot;

  const def = getUnitDef('transporter');
  const st = createUnitState({
    type: 'transporter',
    ownerId: unit.playerId,
    ownerSlot: slot,
    controller: 'player',
    q,
    r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  return unit;
}

/* =========================================================
   Raider Camp (spawned at game start by host)
   ========================================================= */

/**
 * Create Raider Camp marker as a building-like container on a specific hex.
 * Stored as scene.raiderCamp = {q,r,radius,container,alertTargetId,respawnQueue}
 *
 * ✅ FIX:
 * - camp is ON a specific hex (q,r)
 * - looks like a building plate, with background color = ownerColor (AI = blue)
 */
function createRaiderCamp(scene, q, r) {
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;

  const ownerSlot = 1; // AI should be blue like P2 in your palette
  const ownerColor = colorForSlot(ownerSlot);

  const cont = scene.add.container(Math.round(pos.x), Math.round(pos.y)).setDepth(UNIT_Z.building);

  const w = Math.max(28, Math.round(size * 1.35));
  const h = Math.max(22, Math.round(size * 1.10));

  const plate = scene.add.graphics();
  plate.fillStyle(ownerColor, 1);
  plate.lineStyle(2, 0x000000, 0.55);
  // rounded rect centered at (0,0)
  const rx = -w / 2;
  const ry = -h / 2;
  plate.fillRoundedRect(rx, ry, w, h, 7);
  plate.strokeRoundedRect(rx, ry, w, h, 7);

  const icon = scene.add.text(0, -1, '⛺', {
    fontFamily: 'Arial',
    fontSize: `${Math.max(14, Math.round(size * 0.75))}px`,
    color: '#ffffff',
    stroke: '#0b0b0b',
    strokeThickness: 3,
  }).setOrigin(0.5);

  cont.add([plate, icon]);

  try {
    cont.setSize(w, h);
    cont.setInteractive();
  } catch (_) {}

  const camp = {
    q, r,
    radius: 4,
    container: cont,
    type: 'raider_camp',
    ownerSlot,
    ownerColor,
    alertTargetId: null,
    respawnQueue: [], // [{dueTurn:number}]
  };

  scene.buildings = scene.buildings || [];
  scene.buildings.push({
    type: 'raider_camp',
    q, r,
    container: cont,
    ownerSlot,
    ownerColor,
    campRef: camp,
  });

  scene.raiderCamp = camp;
  return camp;
}
// src/scenes/WorldSceneUnits.js
//
// Spawning players & enemies + orientation helpers.
// Bridge between "abstract game state" (lobby / seed)
// and concrete Phaser units on the map.

import { getLobbyState } from '../net/LobbyManager.js';
// Stage A unit stats infrastructure (pure logic + backwards compatible fields)
import { createUnitState, applyUnitStateToPhaserUnit } from '../units/UnitFactory.js';
import { getUnitDef } from '../units/UnitDefs.js';

// Basic visual / model constants
const UNIT_Z = {
  player: 2000,
  enemy:  2000,
  building: 1500, // Raider Camp marker
};

// 4 player colors (slots 0..3)
const PLAYER_COLORS = [
  0xff4b4b, // P1 - red
  0x4bc0ff, // P2 - blue
  0x54ff9b, // P3 - green
  0xffe14b, // P4 - yellow
];

// 2 AI colors (max 2 factions AI)
const AI_COLORS = [
  0xaa66ff, // AI0 - purple
  0x5e5ce6, // AI1 - indigo
];

// Border + neutral
const UNIT_BORDER_COLOR = 0x0b1d2a;
const UNIT_NEUTRAL_BG   = 0x9aa0a6;

/**
 * Owner key normalization:
 * - players are numeric slots 0..3
 * - AI are 'ai0' or 'ai1'
 */
function normalizeOwnerKey(ownerKey, fallback) {
  if (ownerKey === null || ownerKey === undefined) return fallback;
  if (typeof ownerKey === 'number') return ownerKey;
  const s = String(ownerKey).toLowerCase();
  if (s === 'ai0' || s === 'ai1') return s;
  // if someone passes 'ai' -> default ai0
  if (s === 'ai') return 'ai0';
  // fallback to numeric parse if possible
  const n = Number(ownerKey);
  if (Number.isFinite(n)) return n;
  return fallback;
}

/**
 * Resolve badge fill color for units (6 total):
 * - 4 players (0..3)
 * - 2 AI ('ai0','ai1')
 */
function colorForOwner(ownerKey) {
  const k = normalizeOwnerKey(ownerKey, null);
  if (k === null) return UNIT_NEUTRAL_BG;
  if (k === 'ai0') return AI_COLORS[0];
  if (k === 'ai1') return AI_COLORS[1];
  if (typeof k === 'number') return PLAYER_COLORS[((k % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
  return UNIT_NEUTRAL_BG;
}

// NEW: combat unit colors (tint derived from owner slot)
function colorForSlot(slot) {
  return colorForOwner(slot);
}

// Small axial helpers (odd-r)
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
}

function keyOf(q, r) {
  return q + ',' + r;
}

function axialDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function getTile(scene, q, r) {
  return (scene.mapData || []).find(t => t && t.q === q && t.r === r) || null;
}

/**
 * Single source of truth for "land" tiles.
 * Units may spawn ONLY on land:
 * - not water
 * - not mountain
 * - not under water / covered by water flags (some maps keep groundType but are flooded)
 */
function isLandTile(t) {
  if (!t) return false;

  // Primary type check
  if (t.type === 'water' || t.type === 'mountain') return false;

  // Flood flags (important!)
  if (t.isUnderWater === true) return false;
  if (t.isWater === true) return false;
  if (t.isCoveredByWater === true) return false;

  // Some generators keep groundType='mountain' but type differs
  if (t.groundType === 'mountain') return false;

  return true;
}

/**
 * Robust occupancy check across all unit arrays + buildings.
 */
function isOccupied(scene, q, r) {
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || [])
    .concat(scene.haulers || []);

  if (all.find(u => u && !u.isDead && u.q === q && u.r === r)) return true;

  // Buildings occupy a hex too (camp must not overlap)
  const buildings = (scene.buildings || []);
  if (buildings.find(b => b && typeof b.q === 'number' && typeof b.r === 'number' && b.q === q && b.r === r)) return true;

  return false;
}

function isBlockedForUnit(scene, q, r) {
  const t = getTile(scene, q, r);
  if (!isLandTile(t)) return true;

  // No stacking: any unit or building occupying blocks
  return isOccupied(scene, q, r);
}

function findFreeNeighbor(scene, q, r) {
  for (const [dq, dr] of neighborsOddR(q, r)) {
    const nq = q + dq;
    const nr = r + dr;
    if (nq < 0 || nr < 0 || nq >= (scene.mapWidth || 0) || nr >= (scene.mapHeight || 0)) continue;
    if (!isBlockedForUnit(scene, nq, nr)) return { q: nq, r: nr };
  }
  return null;
}

/**
 * Pick up to N reasonably spaced spawn tiles on land.
 * Deterministic (only depends on the map), so all clients
 * with the same seed and map will pick the same positions.
 */
function pickSpawnTiles(scene, count) {
  const map = scene.mapData || [];
  if (!map.length) return [];

  // land = ONLY tiles that pass isLandTile()
  const land = map.filter(isLandTile);
  if (!land.length) return [];

  const w = scene.mapWidth || 25;
  const h = scene.mapHeight || 25;

  const cx = w / 2;
  const cy = h / 2;

  // score tiles by angle sector + distance
  const tilesWithMeta = land.map(t => {
    const dx = t.q - cx;
    const dy = t.r - cy;
    const angle = Math.atan2(dy, dx); // -PI..PI
    const dist2 = dx * dx + dy * dy;
    return { tile: t, angle, dist2 };
  });

  // Split map into angular sectors and pick best from each
  const sectors = Math.max(1, count);
  const buckets = Array.from({ length: sectors }, () => []);

  tilesWithMeta.forEach(entry => {
    let a = entry.angle;
    if (a < 0) a += Math.PI * 2;
    const idx = Math.floor((a / (Math.PI * 2)) * sectors) % sectors;
    buckets[idx].push(entry);
  });

  const result = [];
  for (let i = 0; i < sectors; i++) {
    const bucket = buckets[i];
    if (!bucket.length) continue;
    // prefer tiles a bit away from center (larger dist2)
    bucket.sort((a, b) => b.dist2 - a.dist2);
    result.push(bucket[0].tile);
    if (result.length >= count) break;
  }

  // Fallback if not enough unique buckets
  let idx = 0;
  while (result.length < count && idx < land.length) {
    const candidate = land[idx++];
    if (result.indexOf(candidate) === -1) result.push(candidate);
  }

  return result.slice(0, count);
}

/* ======================================================================
   NEW: Unit badge visuals (directional background + non-rotating icon)
   - Background rotates to show facing
   - Icon NEVER rotates
   - Background fill color = owner color (player slot or ai0/ai1)
   ====================================================================== */

/**
 * Create a "directional badge" (like your unit mock):
 * - smooth teardrop: circle arc + nose (default points RIGHT)
 * Returns:
 *  { cont, bg, icon }
 *
 * Notes:
 * - cont is positioned at hex center
 * - bg is a Graphics object; rotate THIS for facing
 * - icon is Text; do not rotate
 */
function createDirectionalUnitBadge(scene, x, y, ownerKey, iconText, sizePx, depth) {
  const cont = scene.add.container(Math.round(x), Math.round(y)).setDepth(depth ?? UNIT_Z.player);

  const fill = colorForOwner(ownerKey);
  const s = Math.max(18, Math.round(sizePx || 28));

  // Even-ish border for a crisper look
  const borderW = 2;

  const bg = scene.add.graphics();
  bg.fillStyle(fill, 1);
  bg.lineStyle(borderW, UNIT_BORDER_COLOR, 1);

  // --- TRUE TEARDROP (circle + triangular nose), default points RIGHT ---
  // This version avoids the "almost full circle" bug and produces the expected cap shape.
  const radius  = Math.round(s * 0.56);
  const noseLen = Math.round(s * 0.70);

  // Slightly left so the "circle body" is dominant
  const cx = -Math.round(radius * 0.18);
  const cy = 0;

  // Nose join angle: smaller => narrower point
  const theta = Math.PI / 4.2; // ~43° (tweak 35..55°)

  // Join points (on circle rim)
  const jx = cx + radius * Math.cos(theta);
  const jy = radius * Math.sin(theta);

  const ax = Math.round(jx);
  const ay = Math.round(cy - jy);
  const bx = Math.round(jx);
  const by = Math.round(cy + jy);

  // Tip of the teardrop
  const tipX = Math.round(cx + radius + noseLen);
  const tipY = 0;

  // Build one clean path:
  // Start at A -> arc around LEFT side to B -> line to tip -> line back to A.
  bg.beginPath();
  bg.moveTo(ax, ay);

  // Arc around the LEFT side: from -theta to +theta anticlockwise (true)
  // In Phaser Graphics: arc(x,y,r,start,end,anticlockwise)
  bg.arc(cx, cy, radius, -theta, theta, true);

  bg.lineTo(tipX, tipY);
  bg.lineTo(ax, ay);
  bg.closePath();

  bg.fillPath();
  bg.strokePath();

  // Icon should sit on the round body center (not the overall centroid incl. nose)
  const icon = scene.add.text(Math.round(cx * 0.15), 0, iconText, {
    fontFamily: 'Arial',
    fontSize: `${Math.max(12, Math.round(s * 0.55))}px`,
    color: '#ffffff',
    stroke: '#0b0b0b',
    strokeThickness: 3,
  }).setOrigin(0.5);

  cont.add(bg);
  cont.add(icon);

  // Make interactive region stable
  try {
    const estW = (radius * 2) + noseLen;
    const estH = radius * 2;
    cont.setSize(estW, estH);
    cont.setInteractive();
  } catch (_) {}

  // Expose handles for orientation/color updates
  cont._dirBg = bg;
  cont._unitIcon = icon;
  cont._ownerKey = ownerKey;

  // Allow recolor when ownership changes (rebuild same geometry)
  cont.setOwnerKey = (newOwnerKey) => {
    cont._ownerKey = newOwnerKey;
    const newFill = colorForOwner(newOwnerKey);

    bg.clear();
    bg.fillStyle(newFill, 1);
    bg.lineStyle(borderW, UNIT_BORDER_COLOR, 1);

    bg.beginPath();
    bg.moveTo(ax, ay);
    bg.arc(cx, cy, radius, -theta, theta, true);
    bg.lineTo(tipX, tipY);
    bg.lineTo(ax, ay);
    bg.closePath();

    bg.fillPath();
    bg.strokePath();
  };

  return { cont, bg, icon };
}

/**
 * Creates a mobile base unit (player "king" piece).
 *
 * Now uses a directional badge (icon 🏠), with owner color background.
 */
function createMobileBase(scene, spawnTile, player, _color, playerIndex) {
  const pos = scene.axialToWorld(spawnTile.q, spawnTile.r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(26, Math.round(size * 1.35));

  const ownerKey = (typeof playerIndex === 'number') ? playerIndex : 0;

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🏠',
    s,
    UNIT_Z.player
  );

  const unit = cont;

  unit.q = spawnTile.q;
  unit.r = spawnTile.r;

  unit.type = 'mobile_base';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = player.id || null;
  unit.playerName = player.name || 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = playerIndex; // slot index 0..3

  const def = getUnitDef('mobile_base');
  const st = createUnitState({
    type: 'mobile_base',
    ownerId: unit.playerId,
    ownerSlot: playerIndex,
    controller: 'player',
    q: spawnTile.q,
    r: spawnTile.r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  unit.facingAngle = 0;

  // Keep a stable id for selection systems
  if (!unit.id && !unit.unitId) {
    unit.id = `mb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

/**
 * Creates a Raider.
 * If controller='ai', unit is enemy.
 *
 * ✅ NEW: Raider is a badge with a knife icon, icon does not rotate.
 * Background rotates for facing.
 */
function createRaider(scene, q, r, opts = {}) {
  const controller = opts.controller || 'player';
  const pos = scene.axialToWorld(q, r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(24, Math.round(size * 1.20));

  // owner key:
  // - player uses numeric slot
  // - AI uses 'ai0' or 'ai1' (default ai0)
  const ownerKey = (controller === 'ai')
    ? normalizeOwnerKey(opts.ownerKey ?? opts.aiKey ?? 'ai0', 'ai0')
    : normalizeOwnerKey(opts.ownerSlot ?? 0, 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🔪',
    s,
    controller === 'ai' ? UNIT_Z.enemy : UNIT_Z.player
  );

  const unit = cont;

  unit.q = q;
  unit.r = r;
  unit.type = (controller === 'ai') ? 'enemy_raider' : 'raider';
  unit.isEnemy = (controller === 'ai');
  unit.isPlayer = (controller !== 'ai');

  unit.playerId = (controller === 'ai') ? null : (opts.ownerId ?? null);
  unit.playerName = (controller === 'ai') ? 'AI' : (opts.ownerName ?? 'Player');
  unit.name = unit.playerName;
  unit.playerIndex = (controller === 'ai') ? null : (opts.ownerSlot ?? 0);

  const def = getUnitDef('raider');
  const st = createUnitState({
    type: 'raider',
    ownerId: unit.playerId,
    ownerSlot: unit.playerIndex,
    controller: controller,
    q,
    r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  unit.facingAngle = 0;

  if (controller === 'ai') {
    unit.controller = 'ai';
    unit.aiProfile = 'aggressive';
    unit._ownerKey = ownerKey;
  } else {
    unit._ownerKey = ownerKey;
  }

  // Ensure stable id for respawn tracking
  if (!unit.id && !unit.unitId) {
    unit.id = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

/**
 * Creates a simple enemy unit.
 * (kept for compatibility, but we no longer spawn these globally)
 */
function createEnemyUnit(scene, spawnTile) {
  const u = createRaider(scene, spawnTile.q, spawnTile.r, {
    controller: 'ai',
    ownerKey: 'ai0',
  });
  u.type = 'enemy_raider';
  u.isEnemy = true;
  u.isPlayer = false;
  u.controller = 'ai';
  u.aiProfile = 'aggressive';
  return u;
}

/**
 * Exported helper for AI respawn system (Raider Camp).
 */
export function spawnEnemyRaiderAt(scene, q, r) {
  // If you later add a second AI faction, pass ownerKey:'ai1' from camp logic.
  const u = createRaider(scene, q, r, { controller: 'ai', ownerKey: 'ai0' });
  u.type = 'enemy_raider';
  u.isEnemy = true;
  u.isPlayer = false;
  u.controller = 'ai';
  u.aiProfile = 'camp_raider';

  scene.units = scene.units || [];
  scene.enemies = scene.enemies || [];
  scene.units.push(u);
  scene.enemies.push(u);

  return u;
}

/**
 * Creates a player-controlled Transporter.
 * Now uses a directional badge (icon 🚚), icon does not rotate.
 */
function createTransporter(scene, q, r, owner) {
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(22, Math.round(size * 1.10));

  const slot = owner?.playerIndex ?? owner?.ownerSlot ?? 0;
  const ownerKey = normalizeOwnerKey(slot, 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🚚',
    s,
    UNIT_Z.player
  );

  const unit = cont;

  unit.q = q;
  unit.r = r;
  unit.type = 'transporter';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = owner?.playerId ?? owner?.ownerId ?? null;
  unit.playerName = owner?.playerName ?? owner?.name ?? 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = slot;

  const def = getUnitDef('transporter');
  const st = createUnitState({
    type: 'transporter',
    ownerId: unit.playerId,
    ownerSlot: slot,
    controller: 'player',
    q,
    r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  return unit;
}

/* =========================================================
   Raider Camp (spawned at game start by host)
   ========================================================= */

/**
 * Create Raider Camp marker as a building-like container on a specific hex.
 * Stored as scene.raiderCamp = {q,r,radius,container,alertTargetId,respawnQueue}
 *
 * ✅ FIX:
 * - camp is ON a specific hex (q,r)
 * - looks like a building plate, with background color = ownerColor (AI = blue)
 */
function createRaiderCamp(scene, q, r) {
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;

  const ownerSlot = 1; // AI should be blue like P2 in your palette
  const ownerColor = colorForSlot(ownerSlot);

  const cont = scene.add.container(Math.round(pos.x), Math.round(pos.y)).setDepth(UNIT_Z.building);

  const w = Math.max(28, Math.round(size * 1.35));
  const h = Math.max(22, Math.round(size * 1.10));

  const plate = scene.add.graphics();
  plate.fillStyle(ownerColor, 1);
  plate.lineStyle(2, 0x000000, 0.55);
  // rounded rect centered at (0,0)
  const rx = -w / 2;
  const ry = -h / 2;
  plate.fillRoundedRect(rx, ry, w, h, 7);
  plate.strokeRoundedRect(rx, ry, w, h, 7);

  const icon = scene.add.text(0, -1, '⛺', {
    fontFamily: 'Arial',
    fontSize: `${Math.max(14, Math.round(size * 0.75))}px`,
    color: '#ffffff',
    stroke: '#0b0b0b',
    strokeThickness: 3,
  }).setOrigin(0.5);

  cont.add([plate, icon]);

  try {
    cont.setSize(w, h);
    cont.setInteractive();
  } catch (_) {}

  const camp = {
    q, r,
    radius: 4,
    container: cont,
    type: 'raider_camp',
    ownerSlot,
    ownerColor,
    alertTargetId: null,
    respawnQueue: [], // [{dueTurn:number}]
  };

  scene.buildings = scene.buildings || [];
  scene.buildings.push({
    type: 'raider_camp',
    q, r,
    container: cont,
    ownerSlot,
    ownerColor,
    campRef: camp,
  });

  scene.raiderCamp = camp;
  return camp;
}
