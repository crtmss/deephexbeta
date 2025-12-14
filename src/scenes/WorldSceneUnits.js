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
};

const PLAYER_COLORS = [
  0xff4b4b, // P1 - red
  0x4bc0ff, // P2 - blue
  0x54ff9b, // P3 - green
  0xffe14b, // P4 - yellow
];

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

function isBlockedForUnit(scene, q, r) {
  const t = getTile(scene, q, r);
  if (!t) return true;
  if (t.type === 'water' || t.type === 'mountain') return true;
  // No stacking: any unit occupying blocks
  const occ = (scene.units || []).find(u => u && u.q === q && u.r === r);
  return !!occ;
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

  const land = map.filter(t => t.type !== 'water' && t.type !== 'mountain');
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
 * ✅ FIX: radius scales with hex size so it still "fits" after resizing the grid.
 * Position is taken from scene.axialToWorld(), which now includes elevation lift.
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

  // --- Canonical unit state (HP/Armor/MP/AP) ---
  // We keep legacy fields (movementPoints/maxMovementPoints, hp/maxHp)
  // via applyUnitStateToPhaserUnit().
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
  // Ensure IDs/names remain as before for existing UI/turn logic.
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);

  unit.facingAngle = 0;
  if (typeof unit.setStrokeStyle === 'function') {
    unit.setStrokeStyle(2, 0x000000, 0.7);
  }

  return unit;
}

/**
 * Creates a simple enemy unit.
 *
 * ✅ FIX: triangle size scales with hex size (so it doesn't look tiny/huge after hex resize).
 * Position is taken from scene.axialToWorld(), which now includes elevation lift.
 */
function createEnemyUnit(scene, spawnTile) {
  // Reuse the same Raider def + behavior, but keep the legacy type for compatibility.
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

/**
 * Creates a Raider.
 * If controller='ai', unit is enemy and tinted purple by default.
 */
function createRaider(scene, q, r, opts = {}) {
  const controller = opts.controller || 'player';
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(12, Math.round(size * 0.75));

  const fillColor = (controller === 'ai')
    ? (opts.color ?? ENEMY_COLOR)
    : colorForSlot(opts.ownerSlot ?? 0);

  const unit = scene.add.triangle(
    pos.x, pos.y,
    0, s,
    -Math.round(s * 0.9), -Math.round(s * 0.78),
    Math.round(s * 0.9), -Math.round(s * 0.78),
    fillColor
  ).setDepth(controller === 'ai' ? UNIT_Z.enemy : UNIT_Z.player);

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
    facing: 3,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);
  unit.rotation = Math.PI;
  if (typeof unit.setStrokeStyle === 'function') unit.setStrokeStyle(2, 0x000000, 0.6);

  // AI brain hints
  if (controller === 'ai') {
    unit.controller = 'ai';
    unit.aiProfile = 'aggressive';
  }

  return unit;
}

/**
 * Main entry: called from WorldScene.create().
 *
 * Responsibility in the multiplayer model:
 * - Read the lobby state (if any) from Supabase via LobbyManager
 *   or from scene.lobbyState (passed by LobbyScene).
 * - Infer the list of players (up to 4).
 * - Map that to concrete Phaser units on the map.
 * - Spawn a few neutral enemies (host only).
 */
export async function spawnUnitsAndEnemies() {
  const scene = /** @type {any} */ (this);

  scene.units   = scene.units   || [];
  scene.players = scene.players || [];
  scene.enemies = scene.enemies || [];

  let lobbyPlayers = null;

  // 1) Prefer already-fetched lobby state from scene data
  if (scene.lobbyState && Array.isArray(scene.lobbyState.players)) {
    lobbyPlayers = scene.lobbyState.players;
  } else if (scene.roomCode) {
    // 2) Fallback: fetch from Supabase
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

  // 3) Singleplayer fallback: no lobby or empty players array
  if (!Array.isArray(lobbyPlayers) || lobbyPlayers.length === 0) {
    lobbyPlayers = [{
      id: 'p1',
      name: localName,
      slot: 0,
      isHost: !!scene.isHost,
      isConnected: true,
    }];
  }

  // 4) Sort players by slot for deterministic colors / spawn order
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
    console.warn('[Units] No valid spawn tiles found – map may be all water.');
    return;
  }

  // --- Spawn players (connected humans only) ---
  // If the lobby contains placeholder slots (e.g. blue unit) that are not connected,
  // we spawn AI Raiders instead of extra player mobile bases.
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

    const unit = createMobileBase(scene, tile, player, color, idx);

    // Mark which unit belongs to the local player
    unit.isLocalPlayer =
      (localPlayerId && player.id === localPlayerId) ||
      (!localPlayerId && player.name === localName);

    scene.units.push(unit);
    scene.players.push(unit);
  });

  // --- Spawn AI Raiders in place of disconnected/AI lobby slots ---
  // Host-authoritative: only host spawns AI units.
  if (scene.isHost) {
    scene.enemies.length = 0;
    aiSlots.forEach(({ idx }) => {
      const tile = spawnTiles[idx] || spawnTiles[spawnTiles.length - 1];
      if (!tile) return;
      // If the tile is occupied by a player base, try a neighbor.
      let q = tile.q;
      let r = tile.r;
      if (isBlockedForUnit(scene, q, r)) {
        const free = findFreeNeighbor(scene, q, r);
        if (!free) return;
        q = free.q; r = free.r;
      }
      const enemy = createEnemyUnit(scene, { q, r });
      scene.units.push(enemy);
      scene.enemies.push(enemy);
    });
  }

  // --- Spawn neutral enemies (host only, so they don't multiply across clients) ---
  // Keep a few extra raiders around the center if there are no AI slots.
  if (scene.isHost && (scene.enemies.length === 0)) {
    const map = scene.mapData || [];
    if (map.length > 0) {
      const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
      const centerQ = Math.floor(scene.mapWidth / 2);
      const centerR = Math.floor(scene.mapHeight / 2);

      const originTile = byKey.get(keyOf(centerQ, centerR)) || map[0];
      if (originTile) {
        const enemySpawnCandidates = [];

        // simple BFS from center, looking for non-water/non-mountain
        const seen = new Set();
        const qd = [originTile];
        seen.add(keyOf(originTile.q, originTile.r));

        while (qd.length && enemySpawnCandidates.length < 6) {
          const cur = qd.shift();
          if (cur.type !== 'water' && cur.type !== 'mountain') {
            enemySpawnCandidates.push(cur);
          }
          for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
            const nq = cur.q + dq;
            const nr = cur.r + dr;
            const k = keyOf(nq, nr);
            if (seen.has(k)) continue;
            const nt = byKey.get(k);
            if (!nt) continue;
            seen.add(k);
            qd.push(nt);
          }
        }

        enemySpawnCandidates.slice(0, 3).forEach(tile => {
          const enemy = createEnemyUnit(scene, tile);
          scene.units.push(enemy);
          scene.enemies.push(enemy);
        });
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
   - Creates Transporter / Raider adjacent to selected Mobile Base
   - Keeps existing menu system integration (WorldSceneMenus.js)
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
  // fallback: local player's mobile base
  const mb = (scene.players || []).find(p => p && (p.type === 'mobile_base' || p.unitType === 'mobile_base'));
  return mb || null;
}

function spawnUnitNearBase(scene, base, unitType) {
  if (!scene || !base) return null;
  const spot = findFreeNeighbor(scene, base.q, base.r);
  if (!spot) {
    console.warn('[UNITS] No free adjacent hex to spawn unit near base.');
    return null;
  }

  let unit = null;
  if (unitType === 'transporter') unit = createTransporter(scene, spot.q, spot.r, base);
  else if (unitType === 'raider') unit = createRaider(scene, spot.q, spot.r, { controller: 'player', ownerId: base.playerId, ownerSlot: base.playerIndex ?? base.ownerSlot ?? 0, ownerName: base.playerName || base.name });

  if (!unit) return null;

  // ensure IDs exist and are stable-ish
  if (!unit.id && !unit.unitId) {
    // applyUnitStateToPhaserUnit should already have unit.unitId
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

  // Only allow producing on your turn (safe default)
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
  return unit;
}

/* =========================================================
   AI (very simple, host-authoritative)
   - Shoot if any player unit is in range
   - Otherwise move towards closest player unit
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
  if (defender.status) {
    defender.status.defending = false;
  }
  // Keep UnitFactory canonical field in sync if present
  if (Number.isFinite(defender.hp)) {
    // ok
  }
  if (defender.hp <= 0) {
    defender.isDead = true;
    // Remove from arrays
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
      // prefer higher base damage
      if (!best || w.damage > best.damage) best = w;
    }
  }
  return best ? best.id : null;
}

function tryAttack(scene, attacker) {
  const targets = getAttackableTargets(scene, attacker);
  if (!targets.length) return false;

  // Find closest in any weapon range
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
    if (!t || t.type === 'water' || t.type === 'mountain') continue;
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

  // Simple: each enemy tries to attack, else moves towards nearest player unit.
  for (const e of enemies.slice()) {
    if (!e || e.isDead) continue;
    // reset MP/AP each turn if available
    if (Number.isFinite(e.mpMax)) e.mp = e.mpMax;
    if (Number.isFinite(e.apMax)) e.ap = e.apMax;
    e.movementPoints = e.mp;

    // Attack if possible
    const didAttack = tryAttack(scene, e);
    if (didAttack) continue;

    // Move towards closest target
    const targets = getAttackableTargets(scene, e);
    const nearest = targets[0];
    if (!nearest) continue;

    let steps = Math.max(0, Math.floor(e.mp || e.movementPoints || 0));
    while (steps-- > 0) {
      const moved = stepTowards(scene, e, nearest.unit.q, nearest.unit.r);
      if (!moved) break;
      // If after moving we can shoot, do it and stop.
      if (tryAttack(scene, e)) break;
    }
  }
}

/**
 * Update unit orientation based on movement direction.
 * Called from WorldScene.startStepMovement().
 *
 * Keeps the rule:
 * - "Facing along the path" and flipping / rotating accordingly.
 */
export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  const dq = toQ - fromQ;
  const dr = toR - fromR;

  if (dq === 0 && dr === 0) return;

  const key = dq + ',' + dr;
  const ANGLES = {
    '1,0':   0,
    '1,-1':  -Math.PI / 3,
    '0,-1':  -2 * Math.PI / 3,
    '-1,0':  Math.PI,
    '-1,1':  2 * Math.PI / 3,
    '0,1':   Math.PI / 3,
  };

  const angle = ANGLES[key] !== undefined ? ANGLES[key] : 0;

  if (typeof unit.rotation === 'number') {
    unit.rotation = angle;
  }

  if (typeof unit.setFlipX === 'function') {
    const goingLeft = (dq < 0);
    unit.setFlipX(goingLeft);
  }

  unit.facingAngle = angle;
}

/**
 * Placeholder for future real-time sync subscription.
 * For now this is a no-op so imports are safe.
 */
export async function subscribeToGameUpdates(_scene, _roomCode) {
  return {
    unsubscribe() { /* no-op for now */ }
  };
}
