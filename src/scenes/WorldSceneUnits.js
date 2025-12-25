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
