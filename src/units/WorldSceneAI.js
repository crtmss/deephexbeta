// src/units/WorldSceneAI.js
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitActions.js';

import { getTile } from '../scenes/WorldSceneWorldMeta.js';

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

function hexDistanceOddR(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
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
    debug: true, // включено для диагностики; выключишь потом
    debugTag: debugTag || `A*:${unitLabel(unit)}@${start.q},${start.r}->${goal.q},${goal.r}`,
  });
}

export async function moveEnemies(scene) {
  if (!scene || !Array.isArray(scene.enemies) || scene.enemies.length === 0) {
    console.log('[AI] No enemies array or empty.');
    return;
  }

  const getUnitAt = (q, r) => {
    const all = []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || []);
    return all.find(u => u && !u.isDead && u.q === q && u.r === r) || null;
  };

  // "Hard" terrain blocking for ground units
  const isTerrainBlocked = (tile) => {
    if (!tile) return true;
    if (
      tile.type === 'water' ||
      tile.type === 'mountain' ||
      tile.isUnderWater === true ||
      tile.isCoveredByWater === true
    ) return true;
    return false;
  };

  // Standard blocking including occupancy (no stacking)
  const isBlocked = (tile, mover) => {
    if (isTerrainBlocked(tile)) return true;

    const occ = getUnitAt(tile.q, tile.r);
    if (occ && occ !== mover) return true;

    return false;
  };

  const playerTargets =
    (scene.units || []).filter(u => u && u.isPlayer && !u.isDead).length
      ? (scene.units || []).filter(u => u && u.isPlayer && !u.isDead)
      : (scene.players || []).filter(u => u && u.isPlayer && !u.isDead);

  console.log(`[AI] moveEnemies(): enemies=${scene.enemies.length}, playerTargets=${playerTargets.length}, turn=${scene.turnNumber}`);

  if (playerTargets.length === 0) {
    console.log('[AI] No player targets found. Check isPlayer flags.');
    return;
  }

  for (const enemy of scene.enemies) {
    if (!enemy || enemy.isDead) continue;
    if (enemy.controller !== 'ai' && !enemy.isEnemy) continue;

    ensureUnitCombatFields(enemy);

    const eName = unitLabel(enemy);
    console.log(`[AI] Enemy ${eName} at (${enemy.q},${enemy.r}) mp=${enemy.mp}/${enemy.mpMax} ap=${enemy.ap}/${enemy.apMax}`);

    // pick nearest target
    let nearest = null;
    let nearestDist = Infinity;
    for (const p of playerTargets) {
      const d = hexDistanceOddR(enemy.q, enemy.r, p.q, p.r);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
    if (!nearest) continue;

    console.log(`[AI] ${eName}: nearest target=${unitLabel(nearest)} at (${nearest.q},${nearest.r}) dist=${nearestDist}`);

    // 1) Attack if possible
    const weapons = enemy.weapons || [];
    const weaponId = weapons[enemy.activeWeaponIndex] || weapons[0] || null;

    if (weaponId && (enemy.ap || 0) > 0) {
      const v = validateAttack(enemy, nearest, weaponId);
      console.log(`[AI] ${eName}: attackCheck weapon=${weaponId} ok=${!!v?.ok} reason=${v?.reason ?? ''}`);

      if (v.ok) {
        spendAp(enemy, 1);

        // keep convention: attacks may reduce MP
        if ((enemy.mp || 0) > 0) enemy.mp = Math.max(0, enemy.mp - 1);
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = enemy.mp;

        ensureUnitCombatFields(nearest);
        const r = resolveAttack(enemy, nearest, weaponId);

        scene.applyCombatEvent?.({
          type: 'combat:attack',
          attackerId: String(enemy.id ?? enemy.unitId ?? enemy.uuid ?? enemy.netId ?? `${enemy.unitName || enemy.name}@${enemy.q},${enemy.r}`),
          defenderId: String(nearest.id ?? nearest.unitId ?? nearest.uuid ?? nearest.netId ?? `${nearest.unitName || nearest.name}@${nearest.q},${nearest.r}`),
          weaponId,
          damage: r.finalDamage,
          distance: r.distance,
          turnNumber: scene.turnNumber,
          timestamp: Date.now(),
        });

        console.log(`[AI] ${eName}: attacked ${unitLabel(nearest)} dmg=${r.finalDamage} dist=${r.distance}`);
        continue;
      }
    }

    // 2) Move (A* only). If path not found -> stay.
    if ((enemy.mp || 0) <= 0) {
      console.log(`[AI] ${eName}: cannot move, mp=${enemy.mp}`);
      continue;
    }

    const goalQ = nearest.q;
    const goalR = nearest.r;

    // KEY FIX:
    // Allow A* to treat the GOAL tile as passable even if occupied by the target unit.
    // Otherwise goalBlocked=true and pathLen=0 forever.
    const blockedForPath = (tile) => {
      if (!tile) return true;

      // Terrain restrictions always apply (even for goal)
      if (isTerrainBlocked(tile)) return true;

      // If this is the goal tile, DO NOT block by occupancy.
      if (tile.q === goalQ && tile.r === goalR) return false;

      // Otherwise apply normal occupancy rules
      const occ = getUnitAt(tile.q, tile.r);
      if (occ && occ !== enemy) return true;

      return false;
    };

    const path = computePathWithAStar(
      enemy,
      { q: goalQ, r: goalR },
      scene.mapData,
      blockedForPath,
      `A*:${eName}@${enemy.q},${enemy.r}->${goalQ},${goalR}`
    );

    console.log(`[AI] ${eName}: A* pathLen=${path.length}`);

    if (!path || path.length < 2) {
      console.log(`[AI] ${eName}: no A* path found -> staying in place.`);
      continue;
    }

    // walk along path as far as MP allows
    let mp = enemy.mp || 0;
    let lastIndex = 0;

    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      const tile = getTile(scene, step.q, step.r);
      const prevTile = getTile(scene, path[i - 1].q, path[i - 1].r);

      const cost = stepMoveCost(prevTile, tile);
      if (!Number.isFinite(cost) || cost === Infinity) break;

      // IMPORTANT: for actual movement we DO NOT allow stepping onto an occupied tile (including goal).
      if (!tile || isBlocked(tile, enemy)) break;
      if (cost > mp) break;

      mp -= cost;
      lastIndex = i;

      // If we reached adjacency, we can stop early
      if (hexDistanceOddR(step.q, step.r, goalQ, goalR) <= 1) break;
    }

    if (lastIndex > 0) {
      enemy.mp = mp;
      if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;

      const pathToMove = path.slice(0, lastIndex + 1);
      const last = pathToMove[pathToMove.length - 1];
      console.log(`[AI] ${eName}: moving by A* steps=${pathToMove.length - 1} last=(${last.q},${last.r}) mpAfter=${mp}`);

      await moveAlongPath(scene, enemy, pathToMove);
    } else {
      console.log(`[AI] ${eName}: A* path exists but first step not affordable/blocked -> staying.`);
    }
  }

  scene.refreshUnitActionPanel?.();
  console.log('[AI] moveEnemies(): done.');
}
