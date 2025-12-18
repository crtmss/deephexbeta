// src/units/WorldSceneAI.js

import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitActions.js';

// NOTE: WorldSceneWorldMeta.js теперь содержит coords helpers
import { getTile } from '../scenes/WorldSceneWorldMeta.js';

function unitLabel(u) {
  return String(
    u?.unitName ?? u?.name ?? u?.id ?? u?.unitId ?? u?.uuid ?? u?.netId ?? 'unit'
  );
}

function hexDistanceAxial(q1, r1, q2, r2) {
  // axial distance
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -(dq + dr);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function axialNeighbors(q, r) {
  // axial directions (same as your HexMap.neighbors)
  return [
    { q: q + 1, r: r + 0 },
    { q: q + 1, r: r - 1 },
    { q: q + 0, r: r - 1 },
    { q: q - 1, r: r + 0 },
    { q: q - 1, r: r + 1 },
    { q: q + 0, r: r + 1 },
  ];
}

/**
 * A* for AXIAL coordinates.
 * Returns path as [{q,r}, ...] including start and goal.
 * If unreachable: []
 */
function findPathAxial(start, goal, mapData, isBlocked) {
  const key = (q, r) => `${q},${r}`;

  // Fast tile lookup
  const tileByKey = new Map();
  for (const t of (mapData || [])) {
    if (!t) continue;
    tileByKey.set(key(t.q, t.r), t);
  }

  const startKey = key(start.q, start.r);
  const goalKey = key(goal.q, goal.r);

  const open = new Set([startKey]);
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  gScore.set(startKey, 0);
  fScore.set(startKey, hexDistanceAxial(start.q, start.r, goal.q, goal.r));

  const getLowestF = () => {
    let bestK = null;
    let bestF = Infinity;
    for (const k of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestK = k;
      }
    }
    return bestK;
  };

  const parseKey = (k) => {
    const [qs, rs] = k.split(',');
    return { q: Number(qs), r: Number(rs) };
  };

  while (open.size > 0) {
    const currentK = getLowestF();
    if (!currentK) break;

    if (currentK === goalKey) {
      // reconstruct
      const path = [];
      let k = currentK;
      while (k) {
        const { q, r } = parseKey(k);
        path.push({ q, r });
        k = cameFrom.get(k) || null;
      }
      return path.reverse();
    }

    open.delete(currentK);
    const cur = parseKey(currentK);

    for (const nb of axialNeighbors(cur.q, cur.r)) {
      const nbK = key(nb.q, nb.r);
      const tile = tileByKey.get(nbK);

      if (!tile) continue;
      if (isBlocked(tile)) continue;

      const moveCost = tile.movementCost || 1;
      const tentativeG = (gScore.get(currentK) ?? Infinity) + moveCost;

      if (tentativeG < (gScore.get(nbK) ?? Infinity)) {
        cameFrom.set(nbK, currentK);
        gScore.set(nbK, tentativeG);
        fScore.set(nbK, tentativeG + hexDistanceAxial(nb.q, nb.r, goal.q, goal.r));
        open.add(nbK);
      }
    }
  }

  return [];
}

function moveAlongPath(scene, unit, path) {
  return new Promise((resolve) => {
    if (!scene?.startStepMovement || typeof scene.startStepMovement !== 'function') {
      // fallback: snap to last
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

export function computePathWithAStar(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = (tile) => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  // 🔥 FIX: use AXIAL pathfinding (engine/AStar.js is odd-r offset and mismatches your world)
  return findPathAxial(start, goal, mapData, isBlocked);
}

/**
 * Enemy AI:
 * - If any player unit in weapon range and has AP -> attack.
 * - Else if has MP -> A* chase the nearest player unit.
 *
 * Movement is sequential to avoid tween conflicts.
 */
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

  console.log(
    `[AI] moveEnemies(): enemies=${scene.enemies.length}, playerTargets=${playerTargets.length}, turn=${scene.turnNumber}`
  );

  if (playerTargets.length === 0) {
    console.log('[AI] No player targets found. Check isPlayer flags on your player units.');
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
      const d = hexDistanceAxial(enemy.q, enemy.r, p.q, p.r);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
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
    } else {
      console.log(`[AI] ${eName}: no attack (weaponId=${weaponId}, ap=${enemy.ap})`);
    }

    // 2) Move
    if ((enemy.mp || 0) <= 0) {
      console.log(`[AI] ${eName}: cannot move, mp=${enemy.mp}`);
      continue;
    }

    const path = computePathWithAStar(
      enemy,
      { q: nearest.q, r: nearest.r },
      scene.mapData,
      (t) => isBlocked(t, enemy)
    );

    console.log(
      `[AI] ${eName}: pathLen=${path.length} start=(${path[0]?.q},${path[0]?.r}) goal=(${nearest.q},${nearest.r})`
    );

    if (!path || path.length < 2) {
      console.log(`[AI] ${eName}: path too short/unreachable.`);
      continue;
    }

    let mp = enemy.mp || 0;
    let lastIndex = 0;

    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      const tile = getTile(scene, step.q, step.r);
      const cost = tile?.movementCost || 1;

      const occ = getUnitAt(step.q, step.r);
      const blocked = isBlocked(tile, enemy);

      console.log(
        `[AI] ${eName}: step#${i} -> (${step.q},${step.r}) cost=${cost} mpLeft=${mp} blocked=${blocked} occ=${occ ? unitLabel(occ) : 'none'} tileType=${tile?.type ?? 'n/a'}`
      );

      if (blocked) break;
      if (cost > mp) break;
      if (occ && occ !== enemy) break;

      mp -= cost;
      lastIndex = i;

      if (hexDistanceAxial(step.q, step.r, nearest.q, nearest.r) <= 1) {
        console.log(`[AI] ${eName}: stopping early near target.`);
        break;
      }
    }

    if (lastIndex <= 0) {
      console.log(`[AI] ${eName}: no valid movement step found (lastIndex=${lastIndex}).`);
      continue;
    }

    const lastStep = path[lastIndex];
    console.log(`[AI] ${eName}: moving pathLen=${lastIndex + 1}, lastStep=(${lastStep.q},${lastStep.r}), mpAfter=${mp}`);

    enemy.mp = mp;
    if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;

    const pathToMove = path.slice(0, lastIndex + 1);
    await moveAlongPath(scene, enemy, pathToMove);

    console.log(`[AI] ${eName}: move complete now at (${enemy.q},${enemy.r})`);
  }

  scene.refreshUnitActionPanel?.();
  console.log('[AI] moveEnemies(): done.');
}
