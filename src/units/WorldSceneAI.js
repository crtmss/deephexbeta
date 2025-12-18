// src/units/WorldSceneAI.js

import { validateAttack, resolveAttack } from './CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from './UnitActions.js';
import { getTile } from '../scenes/WorldSceneWorldMeta.js';

function unitLabel(u) {
  return String(u?.unitName ?? u?.name ?? u?.id ?? u?.unitId ?? u?.uuid ?? u?.netId ?? 'unit');
}

function hexDistanceAxial(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -(dq + dr);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function fallbackAxialNeighbors(q, r) {
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
 * Try to read neighbors from scene.hexMap.
 * Supports:
 * - hexMap.neighbors(q,r)
 * - hexMap.getNeighbors(q,r)
 * - hexMap.getNeighbors({q,r})
 * Normalizes results into [{q,r},...]
 */
function getNeighborsFromScene(scene, q, r) {
  const hm = scene?.hexMap;
  if (!hm) return { neighbors: fallbackAxialNeighbors(q, r), mode: 'fallback-axial' };

  const fn =
    (typeof hm.neighbors === 'function' && hm.neighbors) ||
    (typeof hm.getNeighbors === 'function' && hm.getNeighbors) ||
    null;

  if (!fn) return { neighbors: fallbackAxialNeighbors(q, r), mode: 'fallback-axial' };

  let raw;
  try {
    // Some implementations accept (q,r), others accept ({q,r})
    raw = fn.length >= 2 ? fn.call(hm, q, r) : fn.call(hm, { q, r });
  } catch {
    try {
      raw = fn.call(hm, q, r);
    } catch {
      raw = null;
    }
  }

  const out = [];
  if (Array.isArray(raw)) {
    for (const n of raw) {
      if (!n) continue;
      // allow {q,r} or [q,r]
      if (typeof n.q === 'number' && typeof n.r === 'number') out.push({ q: n.q, r: n.r });
      else if (Array.isArray(n) && n.length >= 2) out.push({ q: Number(n[0]), r: Number(n[1]) });
      else if (typeof n.x === 'number' && typeof n.y === 'number') {
        // sometimes stored as x/y
        out.push({ q: n.x, r: n.y });
      }
    }
  }

  if (out.length === 0) {
    return { neighbors: fallbackAxialNeighbors(q, r), mode: 'fallback-axial(empty-from-hexMap)' };
  }
  return { neighbors: out, mode: fn === hm.neighbors ? 'hexMap.neighbors' : 'hexMap.getNeighbors' };
}

/**
 * A* using scene-provided neighbor function (preferred).
 * Returns path including start and goal. If unreachable: []
 */
function findPath(scene, start, goal, mapData, isBlocked, debugTag = '') {
  const key = (q, r) => `${q},${r}`;
  const startKey = key(start.q, start.r);
  const goalKey = key(goal.q, goal.r);

  // Build tile map for O(1) lookup
  const tileByKey = new Map();
  for (const t of (mapData || [])) {
    if (!t) continue;
    if (typeof t.q !== 'number' || typeof t.r !== 'number') continue;
    tileByKey.set(key(t.q, t.r), t);
  }

  // Debug: verify we have tiles and the start exists
  if (debugTag) {
    console.log(`[AI] ${debugTag}: tileByKey.size=${tileByKey.size} startInMap=${tileByKey.has(startKey)} goalInMap=${tileByKey.has(goalKey)}`);
  }

  const open = new Set([startKey]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, hexDistanceAxial(start.q, start.r, goal.q, goal.r)]]);

  const pickLowestF = () => {
    let best = null;
    let bestF = Infinity;
    for (const k of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < bestF) { bestF = f; best = k; }
    }
    return best;
  };

  const parseKey = (k) => {
    const [qs, rs] = k.split(',');
    return { q: Number(qs), r: Number(rs) };
  };

  let iterations = 0;

  while (open.size > 0) {
    iterations++;
    if (iterations > 20000) {
      if (debugTag) console.warn(`[AI] ${debugTag}: A* bail out (too many iterations)`);
      break;
    }

    const curKey = pickLowestF();
    if (!curKey) break;

    if (curKey === goalKey) {
      const path = [];
      let k = curKey;
      while (k) {
        path.push(parseKey(k));
        k = cameFrom.get(k) || null;
      }
      return path.reverse();
    }

    open.delete(curKey);
    const cur = parseKey(curKey);

    const { neighbors, mode } = getNeighborsFromScene(scene, cur.q, cur.r);
    if (debugTag && iterations === 1) {
      console.log(`[AI] ${debugTag}: neighborMode=${mode} startNeighbors=${neighbors.length}`);
    }

    for (const nb of neighbors) {
      const nbKey = key(nb.q, nb.r);
      const tile = tileByKey.get(nbKey);
      if (!tile) continue;
      if (isBlocked(tile)) continue;

      const moveCost = tile.movementCost || 1;
      const tentative = (gScore.get(curKey) ?? Infinity) + moveCost;

      if (tentative < (gScore.get(nbKey) ?? Infinity)) {
        cameFrom.set(nbKey, curKey);
        gScore.set(nbKey, tentative);
        fScore.set(nbKey, tentative + hexDistanceAxial(nb.q, nb.r, goal.q, goal.r));
        open.add(nbKey);
      }
    }
  }

  return [];
}

function moveAlongPath(scene, unit, path) {
  return new Promise((resolve) => {
    if (!scene?.startStepMovement || typeof scene.startStepMovement !== 'function') {
      const last = path?.[path.length - 1];
      if (last) {
        unit.q = last.q;
        unit.r = last.r;
        try {
          const pos = scene.axialToWorld?.(last.q, last.r);
          if (pos) unit.setPosition?.(pos.x, pos.y);
        } catch {}
      }
      resolve();
      return;
    }
    scene.startStepMovement(unit, path, () => resolve());
  });
}

export function computePathWithAStar(scene, unit, targetHex, mapData, blockedPred, debugTag = '') {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = (tile) => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  return findPath(scene, start, goal, mapData, isBlocked, debugTag);
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

  const isBlocked = (tile, mover) => {
    if (!tile) return true;

    // terrain blocks
    if (tile.type === 'water' || tile.type === 'mountain' || tile.isUnderWater) return true;

    // occupancy blocks
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
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
    if (!nearest) continue;

    console.log(`[AI] ${eName}: nearest target=${unitLabel(nearest)} at (${nearest.q},${nearest.r}) dist=${nearestDist}`);

    // Attack
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
    }

    // Move
    if ((enemy.mp || 0) <= 0) {
      console.log(`[AI] ${eName}: cannot move, mp=${enemy.mp}`);
      continue;
    }

    const debugTag = `${eName}@${enemy.q},${enemy.r}->${nearest.q},${nearest.r}`;
    const path = computePathWithAStar(
      scene,
      enemy,
      { q: nearest.q, r: nearest.r },
      scene.mapData,
      (t) => isBlocked(t, enemy),
      debugTag
    );

    console.log(`[AI] ${eName}: pathLen=${path.length} start=(${path[0]?.q},${path[0]?.r}) goal=(${nearest.q},${nearest.r})`);

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

      console.log(`[AI] ${eName}: step#${i} -> (${step.q},${step.r}) cost=${cost} mpLeft=${mp} blocked=${blocked} occ=${occ ? unitLabel(occ) : 'none'} tileType=${tile?.type ?? 'n/a'}`);

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

    await moveAlongPath(scene, enemy, path.slice(0, lastIndex + 1));
    console.log(`[AI] ${eName}: move complete now at (${enemy.q},${enemy.r})`);
  }

  scene.refreshUnitActionPanel?.();
  console.log('[AI] moveEnemies(): done.');
}
