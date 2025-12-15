// src/units/WorldSceneAI.js
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitState.js';

// NOTE: WorldSceneWorldMeta.js теперь содержит coords helpers
import { getTile, axialToWorld } from '../scenes/WorldSceneWorldMeta.js';

export function computePathWithAStar(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = tile => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
    // NOTE: AStar.js expects "isBlocked(tile) === true" meaning cannot enter
  };

  return aStarFindPath(start, goal, mapData, isBlocked);
}

/**
 * Enemy AI (host): NOT RANDOM.
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
    // terrain blocks
    if (tile.type === 'water' || tile.type === 'mountain') return true;

    // occupancy blocks (except mover itself)
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
    const weaponId = weapons[enemy.activeWeaponIndex] || wea
