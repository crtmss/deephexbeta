// src/engine/AStar.js
//
// Pathfinding for hex grids using ODD-R OFFSET layout (pointy-top).
//
// Supports dynamic movement cost via opts.getMoveCost(fromTile, toTile).
// Optional diagnostics via opts.debug === true.

export function findPath(start, goal, mapData, isBlocked, opts) {
  const debug = !!opts?.debug;
  const key = (q, r) => `${q},${r}`;

  if (!start || !goal || !Array.isArray(mapData)) return [];
  if (!Number.isFinite(start.q) || !Number.isFinite(start.r)) return [];
  if (!Number.isFinite(goal.q) || !Number.isFinite(goal.r)) return [];

  if (start.q === goal.q && start.r === goal.r) {
    return [{ q: start.q, r: start.r }];
  }

  // --- Build tile lookup
  const tileByKey = new Map();
  for (const t of mapData) {
    if (!t) continue;
    tileByKey.set(key(t.q, t.r), t);
  }

  const startKey = key(start.q, start.r);
  const goalKey = key(goal.q, goal.r);

  const startTile = tileByKey.get(startKey);
  const goalTile = tileByKey.get(goalKey);

  if (!startTile || !goalTile) {
    if (debug) {
      console.warn('[A*][DEBUG] Start or goal not in mapData', {
        start, goal, hasStart: !!startTile, hasGoal: !!goalTile
      });
    }
    return [];
  }

  if (isBlocked?.(startTile) || isBlocked?.(goalTile)) {
    if (debug) {
      console.warn('[A*][DEBUG] Start or goal blocked', {
        startBlocked: isBlocked?.(startTile),
        goalBlocked: isBlocked?.(goalTile),
      });
    }
    return [];
  }

  // --- odd-r neighbors (pointy-top)
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
    typeof opts?.getMoveCost === 'function'
      ? opts.getMoveCost
      : (_fromTile, toTile) => (toTile?.movementCost || 1);

  // --- Dijkstra
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
      if (isBlocked?.(nextTile)) continue;

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

  // --- Reconstruct
  if (!(goalKey in cameFrom)) {
    if (debug) {
      console.warn(`[A*][DEBUG] No path found from (${start.q},${start.r}) to (${goal.q},${goal.r})`);
      console.log('[A*][DEBUG] Start tile:', startTile);

      console.group('[A*][DEBUG] Neighbors analysis');
      for (const dir of getNeighbors(start.q, start.r)) {
        const nq = start.q + dir.dq;
        const nr = start.r + dir.dr;
        const t = tileByKey.get(key(nq, nr));

        if (!t) {
          console.log(`-> (${nq},${nr}): OUT_OF_MAP`);
          continue;
        }
        if (isBlocked?.(t)) {
          console.log(`-> (${nq},${nr}): BLOCKED`, t.type);
          continue;
        }

        const c = getMoveCost(startTile, t);
        if (!Number.isFinite(c)) {
          console.log(`-> (${nq},${nr}): COST=Infinity`);
        } else {
          console.log(`-> (${nq},${nr}): OK cost=${c}`);
        }
      }
      console.groupEnd();
    }
    return [];
  }

  const path = [];
  let cur = { q: goal.q, r: goal.r };
  while (cur) {
    path.push(cur);
    cur = cameFrom[key(cur.q, cur.r)];
  }
  return path.reverse();
}
