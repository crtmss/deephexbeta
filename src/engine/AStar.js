// deephexbeta/src/engine/AStar.js

function getNeighbors(tile, mapData) {
  const directions = [
    { dq: +1, dr: 0 },   // E (0)
    { dq: +1, dr: -1 },  // NE (1)
    { dq: 0, dr: -1 },   // NW (2)
    { dq: -1, dr: 0 },   // W (3)
    { dq: -1, dr: +1 },  // SW (4)
    { dq: 0, dr: +1 }    // SE (5)
  ];

  const results = [];

  for (let dir = 0; dir < 6; dir++) {
    const { dq, dr } = directions[dir];
    const neighborQ = tile.q + dq;
    const neighborR = tile.r + dr;

    const neighbor = mapData.find(t => t.q === neighborQ && t.r === neighborR);
    if (!neighbor) continue;

    // Prevent movement across cliffs
    const hasCliffHere = tile.cliffs?.[dir];
    const reverseDir = (dir + 3) % 6;
    const hasCliffThere = neighbor.cliffs?.[reverseDir];
    if (hasCliffHere || hasCliffThere) continue;

    results.push(neighbor);
  }

  return results;
}

function heuristic(a, b) {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  return dq + dr;
}

export function findPath(start, goal, mapData, isBlocked) {
  const frontier = [];
  frontier.push(start);

  const cameFrom = {};
  const costSoFar = {};
  const key = (t) => `${t.q},${t.r}`;

  cameFrom[key(start)] = null;
  costSoFar[key(start)] = 0;

  while (frontier.length > 0) {
    frontier.sort((a, b) =>
      (costSoFar[key(a)] + heuristic(a, goal)) -
      (costSoFar[key(b)] + heuristic(b, goal))
    );

    const current = frontier.shift();
    if (current.q === goal.q && current.r === goal.r) break;

    for (const neighbor of getNeighbors(current, mapData)) {
      if (isBlocked(neighbor)) continue;

      const moveCost = neighbor.movementCost || 1;
      const newCost = costSoFar[key(current)] + moveCost;

      if (!(key(neighbor) in costSoFar) || newCost < costSoFar[key(neighbor)]) {
        costSoFar[key(neighbor)] = newCost;
        cameFrom[key(neighbor)] = current;
        frontier.push(neighbor);
      }
    }
  }

  // Reconstruct path
  const path = [];
  let current = goal;
  while (current && key(current) !== key(start)) {
    path.unshift(current);
    current = cameFrom[key(current)];
  }

  if (current) path.unshift(start);
  return path.length > 1 ? path : null;
}
