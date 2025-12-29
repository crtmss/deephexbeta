// src/units/WorldSceneAI.js
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitActions.js';
import { applyCombatEvent } from '../scenes/WorldSceneCombatRuntime.js';

import { getTile } from '../scenes/WorldSceneWorldMeta.js';
import { spawnEnemyRaiderAt } from '../scenes/WorldSceneUnits.js';

function tileElevation(t) {
  const v = (t && Number.isFinite(t.visualElevation)) ? t.visualElevation
    : (t && Number.isFinite(t.elevation)) ? t.elevation
    : (t && Number.isFinite(t.baseElevation)) ? t.baseElevation
    : 0;
  return v;
}

// Movement rules (ground units):
// - cannot step if |Δelevation| > 1
// - base cost = 1 for land
// - forest adds +1
// - uphill adds +1
function stepMoveCost(fromTile, toTile) {
  if (!fromTile || !toTile) return Infinity;
  const e0 = tileElevation(fromTile);
  const e1 = tileElevation(toTile);
  if (Math.abs(e1 - e0) > 1) return Infinity;
  let cost = 1;
  if (toTile.hasForest) cost += 1;
  if (e1 > e0) cost += 1;
  return cost;
}

function unitLabel(u) {
  return String(u?.unitName ?? u?.name ?? u?.id ?? u?.unitId ?? u?.uuid ?? u?.netId ?? 'unit');
}

function axialDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
}

function moveAlongPath(scene, unit, path) {
  return new Promise((resolve) => {
    if (!scene?.startStepMovement || typeof scene.startStepMovement !== 'function') {
      resolve();
      return;
    }
    scene.startStepMovement(unit, path, () => resolve());
  });
}

export function computePathWithAStar(unit, targetHex, mapData, blockedPred, debugTag = null) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = (tile) => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  return aStarFindPath(start, goal, mapData, isBlocked, {
    getMoveCost: stepMoveCost,
    debug: false, // включай true только при отладке
    debugTag: debugTag || `A*:${unitLabel(unit)}@${start.q},${start.r}->${goal.q},${goal.r}`,
  });
}

function isTerrainBlocked(tile) {
  if (!tile) return true;
  if (
    tile.type === 'water' ||
    tile.type === 'mountain' ||
    tile.isUnderWater === true ||
    tile.isCoveredByWater === true
  ) return true;
  return false;
}

function pickRandomPatrolGoal(scene, campQ, campR, radius, getUnitAt, mover) {
  const candidates = [];
  for (const t of (scene.mapData || [])) {
    if (!t) continue;
    if (isTerrainBlocked(t)) continue;
    if (axialDistance(t.q, t.r, campQ, campR) > radius) continue;

    const occ = getUnitAt(t.q, t.r);
    if (occ && occ !== mover) continue;

    candidates.push(t);
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function processCampRespawns(scene, camp) {
  if (!scene.isHost || !camp) return;

  camp.respawnQueue = Array.isArray(camp.respawnQueue) ? camp.respawnQueue : [];

  // current alive camp raiders
  const aliveRaiders = (scene.enemies || []).filter(e => e && !e.isDead && (e.aiProfile === 'camp_raider'));
  const maxUnits = 4;

  // spawn due items
  const due = [];
  const keep = [];
  for (const it of camp.respawnQueue) {
    if (it && Number.isFinite(it.dueTurn) && it.dueTurn <= scene.turnNumber) due.push(it);
    else keep.push(it);
  }
  camp.respawnQueue = keep;

  if (!due.length) return;

  // spawn as many as we can (respect maxUnits)
  let slots = Math.max(0, maxUnits - aliveRaiders.length);
  while (slots > 0 && due.length > 0) {
    due.pop();

    // try spawn on camp itself or nearest free ring
    let spawnSpot = null;

    // ring search increasing distance
    for (let d = 1; d <= camp.radius; d++) {
      for (const t of (scene.mapData || [])) {
        if (!t) continue;
        if (isTerrainBlocked(t)) continue;
        if (axialDistance(t.q, t.r, camp.q, camp.r) !== d) continue;

        const occ = getUnitAt(scene, t.q, t.r);
        if (occ) continue;

        spawnSpot = t;
        break;
      }
      if (spawnSpot) break;
    }

    if (!spawnSpot) break;

    const u = spawnEnemyRaiderAt(scene, spawnSpot.q, spawnSpot.r);
    u.homeQ = camp.q;
    u.homeR = camp.r;
    u.aiProfile = 'camp_raider';

    slots--;
    console.log(`[CAMP] Respawned Raider at (${u.q},${u.r}) on turn ${scene.turnNumber}`);
  }
}

function getUnitAt(scene, q, r) {
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || [])
    .concat(scene.haulers || []);
  return all.find(u => u && !u.isDead && u.q === q && u.r === r) || null;
}

function enqueueRespawn(scene, camp, deadUnit) {
  if (!scene.isHost || !camp) return;

  // max 4 alive + pending
  const aliveRaiders = (scene.enemies || []).filter(e => e && !e.isDead && (e.aiProfile === 'camp_raider'));
  const pending = Array.isArray(camp.respawnQueue) ? camp.respawnQueue.length : 0;

  if (aliveRaiders.length + pending >= 4) return;

  camp.respawnQueue = Array.isArray(camp.respawnQueue) ? camp.respawnQueue : [];
  camp.respawnQueue.push({ dueTurn: scene.turnNumber + 5 });

  console.log(`[CAMP] Raider died (${unitLabel(deadUnit)}). Scheduled respawn at turn ${scene.turnNumber + 5}`);
}

function trackDeathsAndScheduleRespawn(scene, camp) {
  if (!scene.isHost || !camp) return;

  // Track by IDs to detect missing ones (killed/destroyed)
  scene._campPrevRaiderIds = scene._campPrevRaiderIds || new Set();

  const current = new Set();
  for (const e of (scene.enemies || [])) {
    if (!e || e.isDead) continue;
    if (e.aiProfile !== 'camp_raider') continue;
    const id = String(e.id ?? e.unitId ?? e.uuid ?? e.netId ?? `${unitLabel(e)}@${e.q},${e.r}`);
    current.add(id);
  }

  // IDs that disappeared since last tick = died
  for (const prevId of scene._campPrevRaiderIds) {
    if (!current.has(prevId)) {
      enqueueRespawn(scene, camp, { id: prevId });
    }
  }

  scene._campPrevRaiderIds = current;
}

function campDetectIntruder(scene, camp) {
  if (!camp) return null;
  const radius = camp.radius || 4;

  const playerUnits = (scene.units || []).filter(u => u && u.isPlayer && !u.isDead);
  let best = null;
  let bestD = Infinity;

  for (const p of playerUnits) {
    const d = axialDistance(p.q, p.r, camp.q, camp.r);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function setCampTarget(camp, targetUnit) {
  if (!camp || !targetUnit) return;
  const id = String(targetUnit.id ?? targetUnit.unitId ?? targetUnit.uuid ?? targetUnit.netId ?? `${unitLabel(targetUnit)}@${targetUnit.q},${targetUnit.r}`);
  camp.alertTargetId = id;
}

function getCampTargetUnit(scene, camp) {
  if (!camp?.alertTargetId) return null;
  const id = camp.alertTargetId;

  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || [])
    .concat(scene.haulers || []);

  const u = all.find(x => x && !x.isDead && String(x.id ?? x.unitId ?? x.uuid ?? x.netId ?? `${unitLabel(x)}@${x.q},${x.r}`) === id);
  return u || null;
}

export async function moveEnemies(scene) {
  if (!scene || !Array.isArray(scene.enemies) || scene.enemies.length === 0) return;

  const camp = scene.raiderCamp || null;

  // Host-only: respawn logic & death tracking
  if (scene.isHost && camp) {
    trackDeathsAndScheduleRespawn(scene, camp);
    processCampRespawns(scene, camp);
  }

  // Camp detection: if any player enters radius => set target
  if (camp) {
    const intruder = campDetectIntruder(scene, camp);
    if (intruder) {
      setCampTarget(camp, intruder);
    }
  }

  const targetUnit = camp ? getCampTargetUnit(scene, camp) : null;

  // isBlocked for actual movement (no stacking)
  const isBlocked = (tile, mover) => {
    if (!tile) return true;
    if (isTerrainBlocked(tile)) return true;
    const occ = getUnitAt(scene, tile.q, tile.r);
    if (occ && occ !== mover) return true;
    return false;
  };

  const enemies = scene.enemies || [];
  for (const enemy of enemies) {
    if (!enemy || enemy.isDead) continue;
    if (enemy.controller !== 'ai' && !enemy.isEnemy) continue;

    ensureUnitCombatFields(enemy);

    // Ensure ground units have 3 MP as requested
    enemy.mpMax = 3;
    if (!Number.isFinite(enemy.mp)) enemy.mp = enemy.mpMax;
    if (!Number.isFinite(enemy.apMax)) enemy.apMax = 1;
    if (!Number.isFinite(enemy.ap)) enemy.ap = enemy.apMax;

    const eName = unitLabel(enemy);

    // Only camp raiders use the new logic
    const isCampRaider = (enemy.aiProfile === 'camp_raider') && !!camp;
    if (!isCampRaider) {
      // fallback: old behaviour (chase nearest player unit)
      const players = (scene.units || []).filter(u => u && u.isPlayer && !u.isDead);
      if (!players.length) continue;

      let nearest = null, bestD = Infinity;
      for (const p of players) {
        const d = axialDistance(enemy.q, enemy.r, p.q, p.r);
        if (d < bestD) { bestD = d; nearest = p; }
      }
      if (!nearest) continue;

      // attack if possible
      const weapons = enemy.weapons || [];
      const weaponId = weapons[enemy.activeWeaponIndex] || weapons[0] || null;
      if (weaponId && (enemy.ap || 0) > 0) {
        const v = validateAttack(enemy, nearest, weaponId);
        if (v.ok) {
          spendAp(enemy, 1);
          ensureUnitCombatFields(nearest);
          const res = resolveAttack(enemy, nearest, weaponId);
          ensureUnitCombatFields(nearest);
          spendAp(enemy, 1);
          const dmg = Number.isFinite(res?.damage) ? res.damage : (Number.isFinite(res?.finalDamage) ? res.finalDamage : 0);
          // eslint-disable-next-line no-console
          console.log('[AI] attack', { attacker: enemy.unitId ?? enemy.id, defender: nearest.unitId ?? nearest.id, weaponId, dist });
          applyCombatEvent(scene, {
            type: 'combat:attack',
            attackerId: enemy.unitId ?? enemy.id,
            defenderId: nearest.unitId ?? nearest.id,
            damage: dmg,
            weaponId,
          });
          continue;
        }
      }

      // move toward nearest
      if ((enemy.mp || 0) <= 0) continue;

      const goalQ = nearest.q, goalR = nearest.r;
      const blockedForPath = (tile) => {
        if (!tile) return true;
        if (isTerrainBlocked(tile)) return true;
        if (tile.q === goalQ && tile.r === goalR) return false;
        const occ = getUnitAt(scene, tile.q, tile.r);
        if (occ && occ !== enemy) return true;
        return false;
      };

      const path = computePathWithAStar(enemy, { q: goalQ, r: goalR }, scene.mapData, blockedForPath);
      if (!path || path.length < 2) continue;

      let mp = enemy.mp;
      let lastIndex = 0;

      for (let i = 1; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const prevTile = getTile(scene, path[i - 1].q, path[i - 1].r);

        const cost = stepMoveCost(prevTile, tile);
        if (!Number.isFinite(cost) || cost === Infinity) break;
        if (!tile || isBlocked(tile, enemy)) break;
        if (cost > mp) break;

        mp -= cost;
        lastIndex = i;

        if (axialDistance(step.q, step.r, goalQ, goalR) <= 1) break;
      }

      if (lastIndex > 0) {
        enemy.mp = mp;
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;
        await moveAlongPath(scene, enemy, path.slice(0, lastIndex + 1));
      }

      continue;
    }

    // ---- NEW CAMP RAIDER AI ----
    // Modes:
    // - PATROL inside camp radius randomly, if no target
    // - CHASE target if exists
    // - RETURN to camp radius after target lost/dead
    const radius = camp.radius || 4;
    const inCampZone = axialDistance(enemy.q, enemy.r, camp.q, camp.r) <= radius;

    // 1) If we have a valid target -> CHASE
    if (targetUnit) {
      // attack if possible
      const weapons = enemy.weapons || [];
      const weaponId = weapons[enemy.activeWeaponIndex] || weapons[0] || null;

      if (weaponId && (enemy.ap || 0) > 0) {
        const v = validateAttack(enemy, targetUnit, weaponId);
        if (v.ok) {
          spendAp(enemy, 1);
          ensureUnitCombatFields(targetUnit);
          resolveAttack(enemy, targetUnit, weaponId);
          // if target died, clear camp target next tick (getCampTargetUnit will return null)
          continue;
        }
      }

      // move toward target
      if ((enemy.mp || 0) <= 0) continue;

      const goalQ = targetUnit.q, goalR = targetUnit.r;

      const blockedForPath = (tile) => {
        if (!tile) return true;
        if (isTerrainBlocked(tile)) return true;
        // allow goal occupied (target)
        if (tile.q === goalQ && tile.r === goalR) return false;
        const occ = getUnitAt(scene, tile.q, tile.r);
        if (occ && occ !== enemy) return true;
        return false;
      };

      const path = computePathWithAStar(
        enemy,
        { q: goalQ, r: goalR },
        scene.mapData,
        blockedForPath
      );

      if (!path || path.length < 2) {
        // can't reach target => stay (no fallback)
        continue;
      }

      let mp = enemy.mp;
      let lastIndex = 0;

      for (let i = 1; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const prevTile = getTile(scene, path[i - 1].q, path[i - 1].r);

        const cost = stepMoveCost(prevTile, tile);
        if (!Number.isFinite(cost) || cost === Infinity) break;
        if (!tile || isBlocked(tile, enemy)) break;
        if (cost > mp) break;

        mp -= cost;
        lastIndex = i;

        // stop if adjacent
        if (axialDistance(step.q, step.r, goalQ, goalR) <= 1) break;
      }

      if (lastIndex > 0) {
        enemy.mp = mp;
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;
        await moveAlongPath(scene, enemy, path.slice(0, lastIndex + 1));
      }

      continue;
    }

    // 2) No target: if not in camp zone -> RETURN
    if (!inCampZone) {
      if ((enemy.mp || 0) <= 0) continue;

      const goalQ = camp.q;
      const goalR = camp.r;

      // We want to return into zone, not necessarily onto camp tile.
      const blockedForPath = (tile) => {
        if (!tile) return true;
        if (isTerrainBlocked(tile)) return true;
        const occ = getUnitAt(scene, tile.q, tile.r);
        if (occ && occ !== enemy) return true;
        return false;
      };

      const path = computePathWithAStar(enemy, { q: goalQ, r: goalR }, scene.mapData, blockedForPath);
      if (!path || path.length < 2) continue;

      let mp = enemy.mp;
      let lastIndex = 0;

      for (let i = 1; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const prevTile = getTile(scene, path[i - 1].q, path[i - 1].r);

        const cost = stepMoveCost(prevTile, tile);
        if (!Number.isFinite(cost) || cost === Infinity) break;
        if (!tile || isBlocked(tile, enemy)) break;
        if (cost > mp) break;

        mp -= cost;
        lastIndex = i;

        // stop as soon as we are back in camp zone
        if (axialDistance(step.q, step.r, camp.q, camp.r) <= radius) break;
      }

      if (lastIndex > 0) {
        enemy.mp = mp;
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;
        await moveAlongPath(scene, enemy, path.slice(0, lastIndex + 1));
      }

      continue;
    }

    // 3) PATROL random inside camp zone
    if ((enemy.mp || 0) <= 0) continue;

    // choose random goal tile within zone and walk a bit
    const patrolGoal = pickRandomPatrolGoal(scene, camp.q, camp.r, radius, (q,r)=>getUnitAt(scene,q,r), enemy);
    if (!patrolGoal) continue;

    const goalQ = patrolGoal.q;
    const goalR = patrolGoal.r;

    const blockedForPath = (tile) => {
      if (!tile) return true;
      if (isTerrainBlocked(tile)) return true;
      const occ = getUnitAt(scene, tile.q, tile.r);
      if (occ && occ !== enemy) return true;
      // stay within zone for patrol (hard constraint)
      if (axialDistance(tile.q, tile.r, camp.q, camp.r) > radius) return true;
      return false;
    };

    const path = computePathWithAStar(enemy, { q: goalQ, r: goalR }, scene.mapData, blockedForPath);
    if (!path || path.length < 2) continue;

    let mp = enemy.mp;
    let lastIndex = 0;

    // Patrol: we usually want only 1-2 steps to look "random"
    const maxSteps = 2;

    for (let i = 1; i < path.length && i <= maxSteps; i++) {
      const step = path[i];
      const tile = getTile(scene, step.q, step.r);
      const prevTile = getTile(scene, path[i - 1].q, path[i - 1].r);

      const cost = stepMoveCost(prevTile, tile);
      if (!Number.isFinite(cost) || cost === Infinity) break;
      if (!tile || isBlocked(tile, enemy)) break;
      if (cost > mp) break;

      mp -= cost;
      lastIndex = i;
    }

    if (lastIndex > 0) {
      enemy.mp = mp;
      if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;
      await moveAlongPath(scene, enemy, path.slice(0, lastIndex + 1));
    }
  }

  // If camp target disappeared (dead), clear it so raiders return
  if (camp && camp.alertTargetId && !getCampTargetUnit(scene, camp)) {
    camp.alertTargetId = null;
  }

  scene.refreshUnitActionPanel?.();
}
