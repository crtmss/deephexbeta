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

const PLAYER_COLORS = [
  0xff4b4b, // P1 - red
  0x4bc0ff, // P2 - blue
  0x54ff9b, // P3 - green
  0xffe14b, // P4 - yellow
];

// Enemy color still used as fallback tint
const ENEMY_COLOR = 0xaa66ff;

// NEW: combat unit colors (tint derived from owner slot)
function colorForSlot(slot) {
  const idx = (typeof slot === 'number' && slot >= 0) ? slot : 0;
  return PLAYER_COLORS[idx % PLAYER_COLORS.length];
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

/**
 * Creates a mobile base unit (player "king" piece).
 *
 * radius scales with hex size so it still "fits" after resizing the grid.
 * Position is taken from scene.axialToWorld(), which includes elevation lift.
 */
function createMobileBase(scene, spawnTile, player, color, playerIndex) {
  const pos = scene.axialToWorld(spawnTile.q, spawnTile.r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const radius = Math.max(10, Math.round(size * 0.72)); // ~16 at hexSize=22

  const unit = scene.add.circle(pos.x, pos.y, radius, color).setDepth(UNIT_Z.player);

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
  if (typeof unit.setStrokeStyle === 'function') {
    unit.setStrokeStyle(2, 0x000000, 0.7);
  }

  return unit;
}

/**
 * Creates a Raider.
 * If controller='ai', unit is enemy.
 *
 * ✅ FIX: Raider is a Container centered on hex.
 * The triangle is drawn around (0,0), so it NEVER drifts into 6 offset positions.
 * Orientation uses unit.rotation exactly like before.
 */
function createRaider(scene, q, r, opts = {}) {
  const controller = opts.controller || 'player';
  const pos0 = scene.axialToWorld(q, r);

  // Pixel-snapping helps avoid "blurry" strokes on canvas
  const pos = { x: Math.round(pos0.x), y: Math.round(pos0.y) };

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(12, Math.round(size * 0.75));

  const fillColor = (controller === 'ai')
    ? (opts.color ?? ENEMY_COLOR)
    : colorForSlot(opts.ownerSlot ?? 0);

  // Container anchored at hex center
  const unit = scene.add.container(pos.x, pos.y)
    .setDepth(controller === 'ai' ? UNIT_Z.enemy : UNIT_Z.player);

  // === Directional "teardrop" background ===
  // Geometry: circle on the left + point on the right (default pointing EAST).
  const bg = scene.add.graphics();
  bg.fillStyle(fillColor, 1);
  bg.lineStyle(3, 0x000000, 0.85);

  const cx = -s * 0.20;
  const cy = 0;
  const r = s * 0.80;
  const tipX = +s * 0.98;

  bg.beginPath();
  // Start at bottom of circle, sweep up via LEFT side to make a smooth rounded back.
  bg.moveTo(cx, cy + r);
  bg.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2, true);
  // Connect to tip and close.
  bg.lineTo(tipX, 0);
  bg.closePath();
  bg.fillPath();
  bg.strokePath();

  unit.add(bg);

  // === Raider icon (does NOT rotate) ===
  // We keep the icon itself fixed; only the background rotates to indicate facing.
  const icon = scene.add.text(cx + r * 0.15, 0, '🔪', {
    fontSize: Math.max(14, Math.round(s * 0.85)) + 'px',
    color: '#ffffff',
  }).setOrigin(0.5);

  icon.rotation = 0;
  unit.add(icon);

  // Keep compatibility with click-selection logic that expects interactive objects
  try {
    const w = Math.max(28, Math.round((r + (tipX - cx)) * 1.05));
    const h = Math.max(28, Math.round(r * 2.05));
    unit.setSize(w, h);
    unit.setInteractive();
  } catch (_) {}

  // Pointers used by updateUnitOrientation() and owner-color changes later.
  unit._dirBg = bg;
  unit._unitIcon = icon;

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

  // Default orientation: pointing east
  unit.facingAngle = 0;
  bg.rotation = 0;
  unit.rotation = 0;

  if (controller === 'ai') {
    unit.controller = 'ai';
    unit.aiProfile = 'aggressive';
  }

  // Ensure stable id for respawn tracking
  if (!unit.id && !unit.unitId) {
    unit.id = `ai_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
    color: ENEMY_COLOR,
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
  const u = createRaider(scene, q, r, { controller: 'ai', color: ENEMY_COLOR });
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
 * Creates a player-controlled Transporter (circle).
 */
function createTransporter(scene, q, r, owner) {
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const radius = Math.max(8, Math.round(size * 0.52));

  const slot = owner?.playerIndex ?? owner?.ownerSlot ?? 0;
  const color = colorForSlot(slot);

  const unit = scene.add.circle(pos.x, pos.y, radius, color).setDepth(UNIT_Z.player);
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
  if (typeof unit.setStrokeStyle === 'function') unit.setStrokeStyle(2, 0x000000, 0.6);

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

  const cont = scene.add.container(pos.x, pos.y).setDepth(UNIT_Z.building);

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

  unit.q = best.q;
  unit.r = best.r;
  unit.mp = Math.max(0, (unit.mp || unit.movementPoints || 0) - 1);
  unit.movementPoints = unit.mp;

  const pos = scene.axialToWorld(best.q, best.r);
  try { unit.setPosition?.(pos.x, pos.y); } catch (e) { unit.x = pos.x; unit.y = pos.y; }
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
 * Called from WorldScene.startStepMovement().
 */
export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  if (toQ === fromQ && toR === fromR) return;

  // Parity-aware direction: odd-r neighbors differ by row parity.
  const nbrs = neighborsOddR(fromQ, fromR);
  let dirIdx = -1;
  for (let i = 0; i < nbrs.length; i++) {
    const [dq, dr] = nbrs[i];
    if (fromQ + dq === toQ && fromR + dr === toR) {
      dirIdx = i;
      break;
    }
  }

  // Default to "east" if we can't classify (shouldn't happen, but safe).
  // Direction order from neighborsOddR():
  // 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE
  const ANGLES_BY_DIR = [
    0,                 // E
    -Math.PI / 3,      // NE
    -2 * Math.PI / 3,  // NW
    Math.PI,           // W
    2 * Math.PI / 3,   // SW
    Math.PI / 3,       // SE
  ];

  const angle = (dirIdx >= 0) ? ANGLES_BY_DIR[dirIdx] : 0;

  // NEW: for "icon-in-frame" units we rotate the background only,
  // keeping the icon upright (no weird rotated knife).
  if (unit._dirBg && typeof unit._dirBg.rotation === 'number') {
    unit._dirBg.rotation = angle;
    unit.rotation = 0;
  } else if (typeof unit.rotation === 'number') {
    unit.rotation = angle;
  }

  // Don't flip containers that use icons.
  if (!unit._unitIcon && typeof unit.setFlipX === 'function') {
    const dq = toQ - fromQ;
    unit.setFlipX(dq < 0);
  }

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
