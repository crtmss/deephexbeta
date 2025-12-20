// src/engine/AStar.js
//
// Pathfinding for hex grids using ODD-R OFFSET layout (pointy-top).
//
// IMPORTANT:
// - Tiles are stored as { q, r } where r is the row (odd-r offset).
// - Neighbors depend on row parity.
//
// Backwards compatible signature:
//   findPath(start, goal, mapData, isBlocked, [opts])
//
// opts can be:
//   {
//     getMoveCost?: (fromTile, toTile) => number,
//     debug?: boolean,                 // if true, prints why path is unreachable
//     debugTag?: string,               // optional tag prefix in logs
//   }
//
// If getMoveCost returns Infinity / non-finite, that edge is treated as impassable.

/**
 * @param {{q:number,r:number}} start
 * @param {{q:number,r:number}} goal
 * @param {Array<any>} mapData
 * @param {(tile:any)=>boolean} isBlocked
 * @param {{getMoveCost?:(fromTile:any,toTile:any)=>number, debug?:boolean, debugTag?:string}|undefined} [opts]
 * @returns {Array<{q:number,r:number}>}
 */
export function findPath(start, goal, mapData, isBlocked, opts) {
  const debug = !!opts?.debug;
  const tag = opts?.debugTag ? String(opts.debugTag) : 'A*';
  const logPfx = `[${tag}][DEBUG]`;

  const key = (q, r) => `${q},${r}`;

  if (!start || !goal || !Array.isArray(mapData)) return [];
  if (!Number.isFinite(start.q) || !Number.isFinite(start.r)) return [];
  if (!Number.isFinite(goal.q) || !Number.isFinite(goal.r)) return [];

  if (start.q === goal.q && start.r === goal.r) {
    return [{ q: start.q, r: start.r }];
  }

  // Fast lookup by coordinate
  const tileByKey = new Map();
  for (const t of mapData) {
    if (!t) continue;
    tileByKey.set(key(t.q, t.r), t);
  }

  const startKey = key(start.q, start.r);
  const goalKey = key(goal.q, goal.r);

  const startTile = tileByKey.get(startKey);
  const goalTile = tileByKey.get(goalKey);

  const getNeighbors = (q, r) => {
    const even = (r % 2) === 0;
    return even
      ? [
          { dq: +1, dr: 0 },
          { dq: 0, dr: -1 },
          { dq: -1, dr: -1 },
          { dq: -1, dr: 0 },
          { dq: -1, dr: +1 },
          { dq: 0, dr: +1 },
        ]
      : [
          { dq: +1, dr: 0 },
          { dq: +1, dr: -1 },
          { dq: 0, dr: -1 },
          { dq: -1, dr: 0 },
          { dq: 0, dr: +1 },
          { dq: +1, dr: +1 },
        ];
  };

  const getMoveCost =
    (opts && typeof opts.getMoveCost === 'function')
      ? opts.getMoveCost
      : (_fromTile, toTile) => (toTile?.movementCost || 1);

  const blocked = (t) => (typeof isBlocked === 'function' ? !!isBlocked(t) : false);

  const debugExplainNoPath = () => {
    if (!debug) return;

    console.warn(
      `${logPfx} No path found from (${start.q},${start.r}) to (${goal.q},${goal.r}).`
    );

    if (!startTile || !goalTile) {
      console.warn(`${logPfx} start/goal missing in mapData`, {
        hasStart: !!startTile,
        hasGoal: !!goalTile,
        tileCount: tileByKey.size,
      });
      return;
    }

    const startBlocked = blocked(startTile);
    const goalBlocked = blocked(goalTile);

    console.log(`${logPfx} startTile=`, startTile);
    console.log(`${logPfx} goalTile=`, goalTile);
    console.log(`${logPfx} startBlocked=${startBlocked} goalBlocked=${goalBlocked}`);

    console.group(`${logPfx} Start neighbors analysis`);
    for (const dir of getNeighbors(start.q, start.r)) {
      const nq = start.q + dir.dq;
      const nr = start.r + dir.dr;
      const nk = key(nq, nr);
      const nt = tileByKey.get(nk);

      if (!nt) {
        console.log(`-> (${nq},${nr}): OUT_OF_MAP`);
        continue;
      }

      const b = blocked(nt);
      if (b) {
        console.log(`-> (${nq},${nr}): BLOCKED`, {
          type: nt.type,
          isUnderWater: nt.isUnderWater,
          isCoveredByWater: nt.isCoveredByWater,
        });
        continue;
      }

      let c;
      try {
        c = getMoveCost(startTile, nt);
      } catch (e) {
        console.log(`-> (${nq},${nr}): COST_THREW_ERROR`, e);
        continue;
      }

      if (!Number.isFinite(c)) {
        console.log(`-> (${nq},${nr}): COST=Infinity/NaN`, { cost: c });
      } else if (c <= 0) {
        console.log(`-> (${nq},${nr}): COST<=0`, { cost: c });
      } else {
        console.log(`-> (${nq},${nr}): OK`, { cost: c });
      }
    }
    console.groupEnd();
  };

  // start/goal validity quick exits
  if (!startTile || !goalTile) {
    debugExplainNoPath();
    return [];
  }
  if (blocked(startTile) || blocked(goalTile)) {
    debugExplainNoPath();
    return [];
  }

  // Dijkstra frontier
  const frontier = [{ q: start.q, r: start.r }];
  const inFrontier = new Set([startKey]);

  const cameFrom = {};
  const costSoFar = {};
  cameFrom[startKey] = null;
  costSoFar[startKey] = 0;

  const popLowest = () => {
    let bestIdx = 0;
    let bestCost = Infinity;
    for (let i = 0; i < frontier.length; i++) {
      const n = frontier[i];
      const c = costSoFar[key(n.q, n.r)] ?? Infinity;
      if (c < bestCost) {
        bestCost = c;
        bestIdx = i;
      }
    }
    const picked = frontier.splice(bestIdx, 1)[0];
    if (picked) inFrontier.delete(key(picked.q, picked.r));
    return picked;
  };

  while (frontier.length > 0) {
    const current = popLowest();
    if (!current) break;

    if (current.q === goal.q && current.r === goal.r) break;

    const currentKey = key(current.q, current.r);
    const currentTile = tileByKey.get(currentKey);
    if (!currentTile) continue;

    const baseCost = costSoFar[currentKey] ?? Infinity;

    for (const dir of getNeighbors(current.q, current.r)) {
      const nq = current.q + dir.dq;
      const nr = current.r + dir.dr;
      const nextKey = key(nq, nr);

      const nextTile = tileByKey.get(nextKey);
      if (!nextTile) continue;
      if (blocked(nextTile)) continue;

      const edgeCost = getMoveCost(currentTile, nextTile);
      if (!Number.isFinite(edgeCost) || edgeCost <= 0) continue;

      const newCost = baseCost + edgeCost;

      if (!(nextKey in costSoFar) || newCost < costSoFar[nextKey]) {
        costSoFar[nextKey] = newCost;
        cameFrom[nextKey] = { q: current.q, r: current.r };

        if (!inFrontier.has(nextKey)) {
          frontier.push({ q: nq, r: nr });
          inFrontier.add(nextKey);
        }
      }
    }
  }

  if (!(goalKey in cameFrom)) {
    debugExplainNoPath();
    return [];
  }

  // Reconstruct
  const path = [];
  let cur = { q: goal.q, r: goal.r };
  while (cur) {
    path.push(cur);
    cur = cameFrom[key(cur.q, cur.r)];
  }
  return path.reverse();
}
