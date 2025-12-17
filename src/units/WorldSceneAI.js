// src/units/WorldSceneAI.js
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitActions.js';

// NOTE: WorldSceneWorldMeta.js содержит coords helpers
import { getTile } from '../scenes/WorldSceneWorldMeta.js';

export function computePathWithAStar(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = tile => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  return aStarFindPath(start, goal, mapData, isBlocked);
}

/**
 * Enemy AI (NOT RANDOM).
 * - If any player unit in weapon range and has AP -> attack.
 * - Else if has MP -> A* chase the nearest player unit.
 */
export function moveEnemies(scene) {
  if (!scene || !scene.enemies || scene.enemies.length === 0) return;

  const getUnitAt = (q, r) => {
    const all = []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || []);
    return all.find(u => u && !u.isDead && u.q === q && u.r === r) || null;
  };

  const isBlocked = (tile, mover) => {
    if (!tile) return true;
    if (tile.type === 'water' || tile.type === 'mountain') return true;

    const occ = getUnitAt(tile.q, tile.r);
    if (occ && occ !== mover) return true;

    return false;
  };

  const hexDistance = (q1, r1, q2, r2) => {
    const dq = q2 - q1;
    const dr = r2 - r1;
    const ds = -dq - dr;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
  };

  const playerTargets =
    (scene.units || []).filter(u => u && u.isPlayer && !u.isDead).length
      ? (scene.units || []).filter(u => u && u.isPlayer && !u.isDead)
      : (scene.players || []).filter(u => u && u.isPlayer && !u.isDead);

  if (playerTargets.length === 0) return;

  for (const enemy of scene.enemies) {
    if (!enemy || enemy.isDead) continue;
    if (enemy.controller !== 'ai' && !enemy.isEnemy) continue;

    ensureUnitCombatFields(enemy);

    // === pick nearest target ===
    let nearest = null;
    let nearestDist = Infinity;
    for (const p of playerTargets) {
      const d = hexDistance(enemy.q, enemy.r, p.q, p.r);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }
    if (!nearest) continue;

    // === 1) ATTACK if possible ===
    const weapons = enemy.weapons || [];
    const weaponId = weapons[enemy.activeWeaponIndex] || weapons[0] || null;

    if (weaponId && enemy.ap > 0) {
      const v = validateAttack(enemy, nearest, weaponId);
      if (v.ok) {
        spendAp(enemy, 1);

        if ((enemy.mp || 0) > 0) enemy.mp = Math.max(0, enemy.mp - 1);
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = enemy.mp;

        ensureUnitCombatFields(nearest);
        const r = resolveAttack(enemy, nearest, weaponId);

        const event = {
          type: 'combat:attack',
          attackerId: String(enemy.id ?? enemy.name),
          defenderId: String(nearest.id ?? nearest.name),
          weaponId,
          damage: r.finalDamage,
          distance: r.distance,
          turnNumber: scene.turnNumber,
          timestamp: Date.now(),
        };

        scene.applyCombatEvent?.(event);
        continue;
      }
    }

    // === 2) MOVE towards target using A* ===
    if ((enemy.mp || 0) <= 0) continue;

    const path = computePathWithAStar(
      enemy,
      { q: nearest.q, r: nearest.r },
      scene.mapData,
      t => isBlocked(t, enemy)
    );

    if (!path || path.length < 2) continue;

    let mp = enemy.mp || 0;
    let lastIndex = 0;

    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      const tile = getTile(scene, step.q, step.r);
      const cost = tile?.movementCost || 1;

      if (cost > mp) break;

      const occ = getUnitAt(step.q, step.r);
      if (occ && occ !== enemy) break;

      mp -= cost;
      lastIndex = i;

      const d2 = hexDistance(step.q, step.r, nearest.q, nearest.r);
      if (d2 <= 1) break;
    }

    if (lastIndex > 0) {
      const pathToMove = path.slice(0, lastIndex + 1);

      enemy.mp = mp;
      if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;

      // 🔥 FIX: move using the SAME pipeline as player units
      scene.startStepMovement(enemy, pathToMove);
    }
  }

  scene.refreshUnitActionPanel?.();
}
