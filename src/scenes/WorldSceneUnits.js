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
 * - circular/rounded body
 * - sharp nose indicating direction (default points RIGHT)
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
  const r = Math.round(s * 0.55);       // head radius
  const tail = Math.round(s * 0.55);    // point length
  const borderW = 3;

  const bg = scene.add.graphics();
  bg.fillStyle(fill, 1);
  bg.lineStyle(borderW, UNIT_BORDER_COLOR, 0.9);

  // “Drop / pin” silhouette (like your reference image), pointing RIGHT by default.
  // We rotate bg for facing, so the point acts as a direction indicator.
  // Implementation: circle head + smooth tapered point.
  const cx = -Math.round(r * 0.20);           // circle center X (slightly left)
  const cy = 0;
  const tipX = cx + r + tail;                 // tip of the drop
  const theta = 0.95;                         // join angle (~54°)
  const joinX = cx + r * Math.cos(theta);
  const joinY = r * Math.sin(theta);

  // Bounding box (used for interaction)
  const left = cx - r;
  const right = tipX;
  const top = -r;
  const bottom = r;
  const bodyW = Math.round(right - left);
  const bodyH = Math.round(bottom - top);

  // Draw drop path
  const drawDrop = () => {
    bg.beginPath();
    bg.moveTo(tipX, 0);

    // Tip -> upper join (smooth)
    // Phaser Graphics uses quadraticBezierTo (not quadraticCurveTo)
    bg.quadraticBezierTo(
      tipX - Math.max(6, Math.round(tail * 0.35)),
      -Math.max(6, Math.round(r * 0.60)),
      joinX,
      -joinY
    );

    // Circle arc from -theta to +theta, going the long way around (through the left side)
    bg.arc(cx, cy, r, -theta, Math.PI * 2 + theta, false);

    // Lower join -> tip (smooth)
    bg.quadraticBezierTo(
      tipX - Math.max(6, Math.round(tail * 0.35)),
      Math.max(6, Math.round(r * 0.60)),
      tipX,
      0
    );

    bg.closePath();
    bg.fillPath();
    bg.strokePath();
  };

  drawDrop();

  // Icon (does not rotate)
  const icon = scene.add.text(0, 0, iconText, {
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
    cont.setSize(bodyW, bodyH);
    cont.setInteractive();
  } catch (_) {}

  // Expose handles for orientation/color updates
  cont._dirBg = bg;
  cont._unitIcon = icon;
  cont._ownerKey = ownerKey;

  // Allow recolor when ownership changes
  cont.setOwnerKey = (newOwnerKey) => {
    cont._ownerKey = newOwnerKey;
    const newFill = colorForOwner(newOwnerKey);
    bg.clear();

    bg.fillStyle(newFill, 1);
    bg.lineStyle(borderW, UNIT_BORDER_COLOR, 0.9);

    drawDrop();
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
// ==============================
// WorldSceneUnits.js (PART 2/2)
// ==============================

function pickRandomFreeLandTile(scene) {
  const land = (scene.mapData || []).filter(isLandTile);
  if (!land.length) return null;

  for (let i = 0; i < 250; i++) {
    const t = land[Math.floor(Math.random() * land.length)];
    if (!t) continue;
    if (isOccupied(scene, t.q, t.r)) continue;
    return t;
  }

  for (const t of land) {
    if (!t) continue;
    if (!isOccupied(scene, t.q, t.r)) return t;
  }

  return null;
}

function spawnInitialRaidersAroundCamp(scene, camp, maxUnits = 3) {
  if (!camp) return;

  const candidates = [];
  const map = scene.mapData || [];

  // prefer near ring 1..2 first
  for (let rr = 1; rr <= 2; rr++) {
    for (const t of map) {
      if (!t || !isLandTile(t)) continue;
      if (axialDistance(t.q, t.r, camp.q, camp.r) !== rr) continue;
      if (isBlockedForUnit(scene, t.q, t.r)) continue;
      candidates.push(t);
    }
  }

  // then any within camp radius
  if (candidates.length < maxUnits) {
    for (const t of map) {
      if (!t || !isLandTile(t)) continue;
      const d = axialDistance(t.q, t.r, camp.q, camp.r);
      if (d < 1 || d > camp.radius) continue;
      if (isBlockedForUnit(scene, t.q, t.r)) continue;
      candidates.push(t);
    }
  }

  // shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let spawned = 0;
  for (const t of candidates) {
    if (spawned >= maxUnits) break;
    if (isBlockedForUnit(scene, t.q, t.r)) continue;

    const u = spawnEnemyRaiderAt(scene, t.q, t.r);
    u.homeQ = camp.q;
    u.homeR = camp.r;
    u.aiProfile = 'camp_raider';

    spawned++;
  }
}

/**
 * Main entry: called from WorldScene.create().
 */
export async function spawnUnitsAndEnemies() {
  const scene = /** @type {any} */ (this);

  scene.units   = scene.units   || [];
  scene.players = scene.players || [];
  scene.enemies = scene.enemies || [];
  scene.buildings = scene.buildings || [];

  let lobbyPlayers = null;

  if (scene.lobbyState && Array.isArray(scene.lobbyState.players)) {
    lobbyPlayers = scene.lobbyState.players;
  } else if (scene.roomCode) {
    try {
      const { data, error } = await getLobbyState(scene.roomCode);
      if (!error && data && data.state && Array.isArray(data.state.players)) {
        lobbyPlayers = data.state.players;
      }
    } catch (err) {
      console.error('[Units] Failed to fetch lobby state for spawns:', err);
    }
  }

  const localPlayerId = scene.playerId || null;
  const localName = scene.playerName || (scene.isHost ? 'Host' : 'Player');

  if (!Array.isArray(lobbyPlayers) || lobbyPlayers.length === 0) {
    lobbyPlayers = [{
      id: 'p1',
      name: localName,
      slot: 0,
      isHost: !!scene.isHost,
      isConnected: true,
    }];
  }

  const lobbyMaxPlayers = 4;
  const sortedPlayers = lobbyPlayers
    .slice()
    .sort((a, b) => {
      const sa = (typeof a.slot === 'number') ? a.slot : 999;
      const sb = (typeof b.slot === 'number') ? b.slot : 999;
      return sa - sb;
    })
    .slice(0, lobbyMaxPlayers);

  if (sortedPlayers.length === 0) {
    console.warn('[Units] No players found after sorting.');
    return;
  }

  const spawnTiles = pickSpawnTiles(scene, sortedPlayers.length);
  if (spawnTiles.length === 0) {
    console.warn('[Units] No valid land spawn tiles found (all blocked/flooded?).');
    return;
  }

  scene.players.length = 0;

  const connectedPlayers = [];
  const aiSlots = [];

  sortedPlayers.forEach((player, idx) => {
    const isAI = (player?.controller === 'ai') || (player?.isAI === true) || (String(player?.name || '').toLowerCase().includes('ai'));
    const isConnected = (player?.isConnected !== false);
    if (!isAI && isConnected) connectedPlayers.push({ player, idx });
    else aiSlots.push({ player, idx });
  });

  connectedPlayers.forEach(({ player, idx }) => {
    const tile = spawnTiles[idx] || spawnTiles[spawnTiles.length - 1];
    const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];

    // hard safety
    if (!isLandTile(tile)) {
      console.warn('[Units] Picked spawn tile is not land, searching neighbor/fallback…', tile);
      const fallback = (scene.mapData || []).find(isLandTile);
      if (!fallback) return;
      tile.q = fallback.q; tile.r = fallback.r;
    }

    const unit = createMobileBase(scene, tile, player, color, idx);

    unit.isLocalPlayer =
      (localPlayerId && player.id === localPlayerId) ||
      (!localPlayerId && player.name === localName);

    scene.units.push(unit);
    scene.players.push(unit);
  });

  // =========================================================
  // ✅ PATCH: Enemy spawning logic changed:
  // - NO aiSlots spawning
  // - NO neutral enemies spawning
  // - ONLY Raider Camp + exactly 3 raiders around it (host only)
  // =========================================================
  if (scene.isHost) {
    // remove any old enemies that might exist from previous runs
    scene.enemies.length = 0;
    scene.units = (scene.units || []).filter(u => !(u && (u.isEnemy || u.controller === 'ai')));

    if (!scene.raiderCamp) {
      const campTile = pickRandomFreeLandTile(scene);
      if (campTile) {
        const camp = createRaiderCamp(scene, campTile.q, campTile.r);
        spawnInitialRaidersAroundCamp(scene, camp, 3);
        console.log(`[CAMP] Raider Camp created at (${camp.q},${camp.r}) radius=${camp.radius}`);
      } else {
        console.warn('[CAMP] Could not find free land tile for Raider Camp.');
      }
    }
  }

  console.log(
    '[Units] Spawn complete: ' +
    scene.players.length + ' players, ' +
    scene.enemies.length + ' enemies.'
  );
}

/* =========================================================
   Mobile Base production (Stage A extension)
   ========================================================= */

const UNIT_COSTS = {
  transporter: { scrap: 15, money: 10 },
  raider:      { scrap: 10, money: 5 },
};

function trySpendResources(scene, cost) {
  const res = scene.playerResources || scene.resources || scene.state?.resources;
  if (!res || !cost) return false;
  for (const k of Object.keys(cost)) {
    if (!Number.isFinite(res[k]) || res[k] < cost[k]) return false;
  }
  for (const k of Object.keys(cost)) {
    res[k] -= cost[k];
  }
  return true;
}

function selectedMobileBase(scene) {
  const u = scene.menuContextSelection || scene.selectedUnit || null;
  if (u && (u.type === 'mobile_base' || u.unitType === 'mobile_base')) return u;
  const mb = (scene.players || []).find(p => p && (p.type === 'mobile_base' || p.unitType === 'mobile_base'));
  return mb || null;
}

function spawnUnitNearBase(scene, base, unitType) {
  if (!scene || !base) return null;
  const spot = findFreeNeighbor(scene, base.q, base.r);
  if (!spot) {
    console.warn('[UNITS] No free adjacent LAND hex to spawn unit near base.');
    return null;
  }

  let unit = null;
  if (unitType === 'transporter') unit = createTransporter(scene, spot.q, spot.r, base);
  else if (unitType === 'raider') unit = createRaider(scene, spot.q, spot.r, {
    controller: 'player',
    ownerId: base.playerId,
    ownerSlot: base.playerIndex ?? base.ownerSlot ?? 0,
    ownerName: base.playerName || base.name
  });

  if (!unit) return null;

  if (!unit.id && !unit.unitId) {
    unit.id = unit.unitId || `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  scene.units = scene.units || [];
  scene.players = scene.players || [];
  scene.units.push(unit);
  scene.players.push(unit);
  return unit;
}

export function buildTransporterAtSelectedUnit() {
  const scene = /** @type {any} */ (this);
  const base = selectedMobileBase(scene);
  if (!base) {
    console.warn('[UNITS] buildTransporter: no mobile base selected');
    return null;
  }

  const ownerName = base.playerName || base.name;
  if (scene.turnOwner && ownerName !== scene.turnOwner) return null;

  const cost = UNIT_COSTS.transporter;
  if (!trySpendResources(scene, cost)) {
    console.warn('[UNITS] Not enough resources for Transporter', cost);
    return null;
  }

  const unit = spawnUnitNearBase(scene, base, 'transporter');
  scene.updateResourceUI?.();
  scene.refreshResourcesPanel?.();
  return unit;
}

export function buildRaiderAtSelectedUnit() {
  const scene = /** @type {any} */ (this);
  const base = selectedMobileBase(scene);
  if (!base) {
    console.warn('[UNITS] buildRaider: no mobile base selected');
    return null;
  }

  const ownerName = base.playerName || base.name;
  if (scene.turnOwner && ownerName !== scene.turnOwner) return null;

  const cost = UNIT_COSTS.raider;
  if (!trySpendResources(scene, cost)) {
    console.warn('[UNITS] Not enough resources for Raider', cost);
    return null;
  }

  const unit = spawnUnitNearBase(scene, base, 'raider');
  scene.updateResourceUI?.();
  scene.refreshResourcesPanel?.();
  scene.refreshUnitActionPanel?.();
  return unit;
}

/* =========================================================
   AI (very simple, host-authoritative)
   ========================================================= */

const WEAPONS = {
  hmg: { id: 'hmg', name: 'HMG', damage: 10, range: 3, vs: { LIGHT: 1.0, MEDIUM: 1.25, HEAVY: 0.75, NONE: 1.0 } },
  lmg: { id: 'lmg', name: 'LMG', damage: 4, range: 2, vs: { LIGHT: 1.25, MEDIUM: 0.75, HEAVY: 0.5, NONE: 1.0 } },
  smg: { id: 'smg', name: 'SMG', damage: 3, range: 2, vs: { LIGHT: 1.25, MEDIUM: 0.75, HEAVY: 0.5, NONE: 1.0 } },
  cutter: { id: 'cutter', name: 'Cutter', damage: 6, range: 1, vs: { LIGHT: 0.5, MEDIUM: 1.0, HEAVY: 1.25, NONE: 1.0 } },
};

function armorClassOf(u) {
  const c = String(u?.armorClass || 'NONE').toUpperCase();
  return (c === 'LIGHT' || c === 'MEDIUM' || c === 'HEAVY') ? c : 'NONE';
}

function resolveDamage(attacker, defender, weaponId, dist) {
  const w = WEAPONS[weaponId] || WEAPONS.smg;
  const ac = armorClassOf(defender);
  const multAC = (w.vs && w.vs[ac] != null) ? w.vs[ac] : 1.0;

  let multDist = 1.0;
  if (weaponId === 'smg') {
    if (dist <= 1) multDist = 1.25;
    else if (dist >= 2) multDist = 0.75;
  }

  const armorPts = Math.max(0, Number(defender?.armorPoints || 0));
  const multArmorPts = Math.max(0, 1.0 - 0.05 * armorPts);

  const raw = w.damage * multAC * multDist * multArmorPts;
  const final = Math.max(1, Math.round(raw));
  return {
    weapon: w,
    dist,
    multAC,
    multDist,
    multArmorPts,
    damage: final,
  };
}

function applyDamageToUnit(scene, defender, dmg) {
  defender.hp = Math.max(0, (defender.hp || 0) - dmg);
  if (defender.status) defender.status.defending = false;

  if (defender.hp <= 0) {
    defender.isDead = true;
    scene.units = (scene.units || []).filter(u => u !== defender);
    scene.players = (scene.players || []).filter(u => u !== defender);
    scene.enemies = (scene.enemies || []).filter(u => u !== defender);
    try { defender.destroy?.(); } catch (e) {}
    try { defender.container?.destroy?.(); } catch (e) {}
  }
}

function getAttackableTargets(scene, attacker) {
  const targets = [];
  const enemies = (attacker.isEnemy || attacker.controller === 'ai')
    ? (scene.players || [])
    : (scene.enemies || []);

  const aq = attacker.q, ar = attacker.r;

  for (const t of enemies) {
    if (!t || t.isDead) continue;
    const d = axialDistance(aq, ar, t.q, t.r);
    targets.push({ unit: t, dist: d });
  }
  targets.sort((a, b) => a.dist - b.dist);
  return targets;
}

function pickBestWeapon(attacker, dist) {
  const wlist = Array.isArray(attacker.weapons) ? attacker.weapons : [];
  let best = null;
  for (const wid of wlist) {
    const w = WEAPONS[wid];
    if (!w) continue;
    if (dist <= w.range) {
      if (!best || w.damage > best.damage) best = w;
    }
  }
  return best ? best.id : null;
}

function tryAttack(scene, attacker) {
  const targets = getAttackableTargets(scene, attacker);
  if (!targets.length) return false;

  for (const { unit: defender, dist } of targets) {
    const wid = pickBestWeapon(attacker, dist);
    if (!wid) continue;
    const r = resolveDamage(attacker, defender, wid, dist);
    applyDamageToUnit(scene, defender, r.damage);
    console.log(`[AI] ${attacker.unitName || attacker.type} attacks ${defender.unitName || defender.type} with ${wid} for ${r.damage} (dist=${dist})`);
    return true;
  }

  return false;
}

function stepTowards(scene, unit, targetQ, targetR) {
  const neigh = neighborsOddR(unit.q, unit.r);
  let best = null;
  let bestD = Infinity;

  for (const [dq, dr] of neigh) {
    const nq = unit.q + dq;
    const nr = unit.r + dr;
    if (nq < 0 || nr < 0 || nq >= (scene.mapWidth || 0) || nr >= (scene.mapHeight || 0)) continue;
    if (isBlockedForUnit(scene, nq, nr)) continue;

    const t = getTile(scene, nq, nr);
    if (!isLandTile(t)) continue;

    const d = axialDistance(nq, nr, targetQ, targetR);
    if (d < bestD) {
      bestD = d;
      best = { q: nq, r: nr };
    }
  }

  if (!best) return false;

  // ✅ IMPORTANT: Face the tile BEFORE we "teleport" / setPosition
  updateUnitOrientation(scene, unit, unit.q, unit.r, best.q, best.r);

  unit.q = best.q;
  unit.r = best.r;
  unit.mp = Math.max(0, (unit.mp || unit.movementPoints || 0) - 1);
  unit.movementPoints = unit.mp;

  const pos = scene.axialToWorld(best.q, best.r);
  try { unit.setPosition?.(Math.round(pos.x), Math.round(pos.y)); } catch (e) { unit.x = Math.round(pos.x); unit.y = Math.round(pos.y); }
  return true;
}

export function applyEnemyAIOnEndTurn(scene) {
  if (!scene || !scene.isHost) return;
  const enemies = scene.enemies || [];
  const players = scene.players || [];
  if (!enemies.length || !players.length) return;

  for (const e of enemies.slice()) {
    if (!e || e.isDead) continue;

    if (Number.isFinite(e.mpMax)) e.mp = e.mpMax;
    if (Number.isFinite(e.apMax)) e.ap = e.apMax;
    e.movementPoints = e.mp;

    const didAttack = tryAttack(scene, e);
    if (didAttack) continue;

    const targets = getAttackableTargets(scene, e);
    const nearest = targets[0];
    if (!nearest) continue;

    let steps = Math.max(0, Math.floor(e.mp || e.movementPoints || 0));
    while (steps-- > 0) {
      const moved = stepTowards(scene, e, nearest.unit.q, nearest.unit.r);
      if (!moved) break;
      if (tryAttack(scene, e)) break;
    }
  }
}

/**
 * Update unit orientation based on movement direction.
 *
 * Your grid uses ODD-R neighbors (see neighborsOddR).
 * Phaser's rotation is clockwise-positive because Y grows downward.
 *
 * What was wrong before:
 * - We assumed "dir index * 60°" would map to NE/NW/...
 *   but on screen, +60° from east points DOWN-RIGHT (SE), not UP-RIGHT (NE).
 * - That makes diagonal turns appear mirrored:
 *     right-up ↔ right-down, left-up ↔ left-down.
 *
 * Fix:
 * - We still identify the direction index by matching (dq,dr) against neighborsOddR(fromR parity)
 * - But we map those 6 dirs to SCREEN angles with a lookup that swaps the vertical diagonals:
 *     logical order from neighborsOddR: [E, NE, NW, W, SW, SE]
 *     screen rotation steps (clockwise): [0, 5, 4, 3, 2, 1] * 60°
 *   This exactly swaps NE<->SE and NW<->SW, matching your request.
 *
 * NEW:
 * - If unit has a directional background (unit._dirBg), we rotate ONLY that bg.
 * - Icon (unit._unitIcon) remains unrotated.
 */
export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  const dq = toQ - fromQ;
  const dr = toR - fromR;
  if (dq === 0 && dr === 0) return;

  // Match against odd-r neighbor deltas for THIS row parity
  const neigh = neighborsOddR(fromQ, fromR);
  let dir = -1;
  for (let i = 0; i < neigh.length; i++) {
    const [ndq, ndr] = neigh[i];
    if (ndq === dq && ndr === dr) {
      dir = i;
      break;
    }
  }

  // If somehow not a direct neighbor (teleport), fall back to "closest axial-ish angle"
  if (dir === -1) {
    if (Math.abs(dq) >= Math.abs(dr)) dir = (dq >= 0) ? 0 : 3;
    else dir = (dr >= 0) ? 5 : 2;
  }

  // ✅ Screen-correct angle mapping (fixes mirrored diagonals)
  // neighborsOddR dir order: 0:E, 1:NE, 2:NW, 3:W, 4:SW, 5:SE
  // screen clockwise steps:  0,   5,    4,    3,    2,    1
  const STEP_BY_DIR = [0, 5, 4, 3, 2, 1];
  const step = STEP_BY_DIR[dir] ?? 0;
  const angle = step * (Math.PI / 3);

  // Rotate ONLY directional bg when present
  if (unit._dirBg && typeof unit._dirBg.rotation === 'number') {
    unit._dirBg.rotation = angle;
    // keep icon stable
    if (unit._unitIcon && typeof unit._unitIcon.rotation === 'number') {
      unit._unitIcon.rotation = 0;
    }
  } else if (typeof unit.rotation === 'number') {
    // fallback for legacy objects (circles, etc.)
    unit.rotation = angle;
  }

  // Optional flip for sprite-based units (if any) — keep behavior
  if (typeof unit.setFlipX === 'function') {
    const westish = (dir === 3 || dir === 2 || dir === 4);
    unit.setFlipX(westish);
  }

  unit.facing = dir;
  unit.facingAngle = angle;
}

/**
 * Placeholder for future real-time sync subscription.
 */
export async function subscribeToGameUpdates(_scene, _roomCode) {
  return {
    unsubscribe() { /* no-op for now */ }
  };
}
