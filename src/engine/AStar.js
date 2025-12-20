// src/engine/AStar.js
//
// Pathfinding for hex grids using odd-r offset layout (pointy-top).
//
// IMPORTANT:
// - Historically this file behaved like a simple Dijkstra (no heuristic) and used tile.movementCost.
// - We keep backwards compatibility, but also support dynamic movement rules that depend on
//   both the current tile and the neighbor tile (e.g. elevation climb cost / climb limits).
//
// Signature (backwards compatible):
//   findPath(start, goal, mapData, isBlocked, [opts])
//
// Where opts can be:
//   {
//     getMoveCost?: (fromTile, toTile) => number,
//   }
//
// If getMoveCost returns Infinity / non-finite, that edge is treated as impassable.

/**
 * @param {{q:number,r:number}} start
 * @param {{q:number,r:number}} goal
 * @param {Array<any>} mapData
 * @param {(tile:any)=>boolean} isBlocked
 * @param {{getMoveCost?:(fromTile:any,toTile:any)=>number}|undefined} [opts]
 * @returns {Array<{q:number,r:number}>}
 */
export function findPath(start, goal, mapData, isBlocked, opts) {
  const key = (q, r) => `${q},${r}`;

  if (!start || !goal || !Array.isArray(mapData)) return [];
  if (start.q === goal.q && start.r === goal.r) return [{ q: start.q, r: start.r }];

  // Fast lookup by coordinate (mapData can be up to 29x29 ~ 841).
  const tileByKey = new Map();
  for (const t of mapData) {
    if (!t) continue;
    tileByKey.set(key(t.q, t.r), t);
  }

  const getNeighbors = (q, r) => {
    const even = r % 2 === 0;
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
      : (fromTile, toTile) => (toTile?.movementCost || 1);

  // Dijkstra frontier (small maps: linear scan is OK).
  const frontier = [{ q: start.q, r: start.r }];
  const cameFrom = {};
  const costSoFar = {};
  cameFrom[key(start.q, start.r)] = null;
  costSoFar[key(start.q, start.r)] = 0;

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
    return frontier.splice(bestIdx, 1)[0];
  };

  while (frontier.length > 0) {
    const current = popLowest();
    if (!current) break;
    if (current.q === goal.q && current.r === goal.r) break;

    const currentTile = tileByKey.get(key(current.q, current.r));
    if (!currentTile) continue;

    for (const dir of getNeighbors(current.q, current.r)) {
      const nq = current.q + dir.dq;
      const nr = current.r + dir.dr;
      const nextKey = key(nq, nr);
      const nextTile = tileByKey.get(nextKey);
      if (!nextTile) continue;
      if (isBlocked && isBlocked(nextTile)) continue;

      const edgeCost = getMoveCost(currentTile, nextTile);
      if (!Number.isFinite(edgeCost) || edgeCost <= 0) continue;

      const newCost = (costSoFar[key(current.q, current.r)] ?? 0) + edgeCost;
      if (!(nextKey in costSoFar) || newCost < costSoFar[nextKey]) {
        costSoFar[nextKey] = newCost;
        cameFrom[nextKey] = { q: current.q, r: current.r };
        frontier.push({ q: nq, r: nr });
      }
    }
  }

  // Reconstruct
  const goalKey = key(goal.q, goal.r);
  if (!(goalKey in cameFrom)) return []; // unreachable

  const path = [];
  let cur = { q: goal.q, r: goal.r };
  while (cur) {
    path.push(cur);
    cur = cameFrom[key(cur.q, cur.r)];
  }
  return path.reverse();
}
