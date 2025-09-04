// deephexbeta/src/engine/AStar.js

// A* pathfinding for hex grids using odd-r offset layout (pointy-top)
export function findPath(start, goal, mapData, isBlocked) {
  const frontier = [start];
  const cameFrom = {};
  const costSoFar = {};
  const key = (q, r) => `${q},${r}`;

  cameFrom[key(start.q, start.r)] = null;
  costSoFar[key(start.q, start.r)] = 0;

  const getNeighbors = (q, r) => {
    const even = r % 2 === 0;
    return even ? [
      { dq: +1, dr: 0 }, { dq: 0, dr: -1 }, { dq: -1, dr: -1 },
      { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 }
    ] : [
      { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
      { dq: -1, dr: 0 }, { dq: 0, dr: +1 }, { dq: +1, dr: +1 }
    ];
  };

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current.q === goal.q && current.r === goal.r) break;

    for (const dir of getNeighbors(current.q, current.r)) {
      const nq = current.q + dir.dq;
      const nr = current.r + dir.dr;
      const nextKey = key(nq, nr);
      const next = { q: nq, r: nr };
      const tile = mapData.find(t => t.q === nq && t.r === nr);
      if (!tile || isBlocked(tile)) continue;

      const moveCost = tile.movementCost || 1;
      const newCost = costSoFar[key(current.q, current.r)] + moveCost;

      if (!(nextKey in costSoFar) || newCost < costSoFar[nextKey]) {
        costSoFar[nextKey] = newCost;
        frontier.push(next);
        cameFrom[nextKey] = current;
      }
    }
  }

  const path = [];
  let current = goal;
  while (current) {
    path.push(current);
    current = cameFrom[key(current.q, current.r)];
  }

  if (!cameFrom[key(goal.q, goal.r)]) return []; // unreachable
  return path.reverse();
}
