// src/units/WorldSceneAI.js
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitActions.js';

// NOTE: WorldSceneWorldMeta.js теперь содержит coords helpers
import { getTile } from '../scenes/WorldSceneWorldMeta.js';

export function computePathWithAStar(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = (tile) => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
    // NOTE: AStar.js expects "isBlocked(tile) === true" meaning cannot enter
  };

  return aStarFindPath(start, goal, mapData, isBlocked);
}

function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function moveAlongPath(scene, unit, path) {
  // Use the same movement pipeline as the player (tweens + orientation + q/r update).
  return new Promise((resolve) => {
    if (!scene?.startStepMovement || typeof scene.startStepMovement !== 'function') {
      // Fallback: apply last step immediately (should not happen in normal WorldScene)
      const last = path?.[path.length - 1];
      if (last) {
        unit.q = last.q;
        unit.r = last.r;
        try {
          const pos = scene.axialToWorld?.(last.q, last.r);
          if (pos) unit.setPosition?.(pos.x, pos.y);
        } catch (e) {}
      }
      resolve();
      return;
    }

    scene.startStepMovement(unit, path, () => resolve());
  });
}

/**
 * Enemy AI:
 * - If any player unit in weapon range and has AP -> attack.
 * - Else if has MP -> A* chase the nearest player unit.
 *
 * IMPORTANT:
 * - We move enemies SEQUENTIALLY (await), otherwise multiple parallel tweens fight over
 *   scene.isUnitMoving and can create the illusion of "AI doesn't move" / desync.
 */
export async function moveEnemies(scene) {
  if (!scene || !Array.isArray(scene.enemies) || scene.enemies.length === 0) return;

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

    // terrain blocks
    if (tile.type === 'water' || tile.type === 'mountain') return true;

    // occupancy blocks (except mover itself)
    const occ = getUnitAt(tile.q, tile.r);
    if (occ && occ !== mover) return true;

    return false;
  };

  const playerTargets =
    (scene.units || []).filter(u => u && u.isPlayer && !u.isDead).length
      ? (scene.units || []).filter(u => u && u.isPlayer && !u.isDead)
      : (scene.players || []).filter(u => u && u.isPlayer && !u.isDead);

  if (playerTargets.length === 0) {
    console.log('[AI] No player targets found (isPlayer flags?)');
    return;
  }

  // Sequentially process each enemy to avoid movement-state conflicts.
  for (const enemy of scene.enemies) {
    if (!enemy || enemy.isDead) continue;
    if (enemy.controller !== 'ai' && !enemy.isEnemy) continue;

    ensureUnitCombatFields(enemy);

    // pick nearest target
    let nearest = null;
    let nearestDist = Infinity;
    for (const p of playerTargets) {
      const d = hexDistance(enemy.q, enemy.r, p.q, p.r);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
    if (!nearest) continue;

    // 1) Attack if possible
    const weapons = enemy.weapons || [];
    const weaponId = weapons[enemy.activeWeaponIndex] || weapons[0] || null;

    if (weaponId && (enemy.ap || 0) > 0) {
      const v = validateAttack(enemy, nearest, weaponId);
      if (v.ok) {
        spendAp(enemy, 1);

        // keep your current convention: attacks may reduce MP
        if ((enemy.mp || 0) > 0) enemy.mp = Math.max(0, enemy.mp - 1);
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = enemy.mp;

        ensureUnitCombatFields(nearest);
        const r = resolveAttack(enemy, nearest, weaponId);

        const attackerId = String(
          enemy.id ?? enemy.unitId ?? enemy.uuid ?? enemy.netId ?? `${enemy.unitName || enemy.name}@${enemy.q},${enemy.r}`
        );
        const defenderId = String(
          nearest.id ?? nearest.unitId ?? nearest.uuid ?? nearest.netId ?? `${nearest.unitName || nearest.name}@${nearest.q},${nearest.r}`
        );

        scene.applyCombatEvent?.({
          type: 'combat:attack',
          attackerId,
          defenderId,
          weaponId,
          damage: r.finalDamage,
          distance: r.distance,
          turnNumber: scene.turnNumber,
          timestamp: Date.now(),
        });

        // Move to next enemy
        continue;
      }
    }

    // 2) Move towards target using A*
    if ((enemy.mp || 0) <= 0) continue;

    const path = computePathWithAStar(
      enemy,
      { q: nearest.q, r: nearest.r },
      scene.mapData,
      (t) => isBlocked(t, enemy)
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

      // stop early when close to target (keeps enemies from "overrunning")
      if (hexDistance(step.q, step.r, nearest.q, nearest.r) <= 1) break;
    }

    if (lastIndex > 0) {
      enemy.mp = mp;
      if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;

      const pathToMove = path.slice(0, lastIndex + 1);

      // 🔥 FIX: animate + update using the same movement system as the player
      await moveAlongPath(scene, enemy, pathToMove);
    }
  }

  scene.refreshUnitActionPanel?.();
}
