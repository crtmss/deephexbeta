// src/engine/AStar.js
//
// Pathfinding for hex grids using AXIAL coordinates (q,r) (pointy-top).
//
// IMPORTANT:
// - The rest of the project stores hexes as axial coordinates: {q, r}.
// - Therefore neighbors MUST be computed in axial space (no odd-r/even-r offset parity).
//
// Backwards compatibility:
// - Historically this behaved like Dijkstra (no heuristic) and used tile.movementCost.
// - We keep that, but also support dynamic movement rules depending on fromTile->toTile.
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
  if (!Number.isFinite(start.q) || !Number.isFinite(start.r)) return [];
  if (!Number.isFinite(goal.q) || !Number.isFinite(goal.r)) return [];

  if (start.q === goal.q && start.r === goal.r) {
    return [{ q: start.q, r: start.r }];
  }

  // Fast lookup by coordinate (mapData can be up to ~29x29 = 841).
  const tileByKey = new Map();
  for (const t of mapData) {
    if (!t) continue;
    tileByKey.set(key(t.q, t.r), t);
  }

  // AXIAL neighbors (pointy-top):
  // (+1,0), (+1,-1), (0,-1), (-1,0), (-1,+1), (0,+1)
  const neighborDirs = [
    { dq: +1, dr: 0 },
    { dq: +1, dr: -1 },
    { dq: 0, dr: -1 },
    { dq: -1, dr: 0 },
    { dq: -1, dr: +1 },
    { dq: 0, dr: +1 },
  ];

  const getMoveCost =
    (opts && typeof opts.getMoveCost === 'function')
      ? opts.getMoveCost
      : (_fromTile, toTile) => (toTile?.movementCost || 1);

  // Dijkstra frontier (small maps: linear scan is OK).
  const startKey = key(start.q, start.r);

  const frontier = [{ q: start.q, r: start.r }];
  const inFrontier = new Set([startKey]); // prevent duplicate pushes (safe optimization)

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

    for (const dir of neighborDirs) {
      const nq = current.q + dir.dq;
      const nr = current.r + dir.dr;
      const nextKey = key(nq, nr);

      const nextTile = tileByKey.get(nextKey);
      if (!nextTile) continue;

      if (isBlocked && isBlocked(nextTile)) continue;

      const edgeCost = getMoveCost(currentTile, nextTile);
      // Infinity / NaN / <=0 = impassable
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
