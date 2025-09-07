// deephexbeta/src/engine/AStar.js

function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

function getNeighbors(current, map) {
  const directions = [
    { dq: +1, dr: 0, dir: 0 },
    { dq: +1, dr: -1, dir: 1 },
    { dq: 0, dr: -1, dir: 2 },
    { dq: -1, dr: 0, dir: 3 },
    { dq: -1, dr: +1, dir: 4 },
    { dq: 0, dr: +1, dir: 5 }
  ];

  const results = [];

  for (const { dq, dr, dir } of directions) {
    const neighborQ = current.q + dq;
    const neighborR = current.r + dr;

    const fromTile = map.find(t => t.q === current.q && t.r === current.r);
    const toTile = map.find(t => t.q === neighborQ && t.r === neighborR);

    if (!fromTile || !toTile) continue;

    // Skip impassable tiles
    if (toTile.impassable) continue;

    // Skip if a cliff blocks this direction
    const fromCliffs = fromTile.cliffs || [];
    const toCliffs = toTile.cliffs || [];
    const oppositeDir = (dir + 3) % 6;

    if (fromCliffs.includes(dir) || toCliffs.includes(oppositeDir)) continue;

    results.push(toTile);
  }

  return results;
}

export function findPath(start, goal, map, isBlocked = () => false) {
  const openSet = [];
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  const key = (tile) => `${tile.q},${tile.r}`;

  openSet.push(start);
  gScore.set(key(start), 0);
  fScore.set(key(start), hexDistance(start, goal));

  while (openSet.length > 0) {
    openSet.sort((a, b) => fScore.get(key(a)) - fScore.get(key(b)));
    const current = openSet.shift();
    if (current.q === goal.q && current.r === goal.r) {
      const path = [];
      let temp = key(current);
      while (cameFrom.has(temp)) {
        path.unshift(current);
        current = cameFrom.get(temp);
        temp = key(current);
      }
      path.unshift(start);
      return path;
    }

    const neighbors = getNeighbors(current, map);
    for (const neighbor of neighbors) {
      if (isBlocked(neighbor)) continue;

      const tentativeG = gScore.get(key(current)) + (neighbor.movementCost || 1);
      const neighborKey = key(neighbor);

      if (tentativeG < (gScore.get(neighborKey) || Infinity)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        fScore.set(neighborKey, tentativeG + hexDistance(neighbor, goal));
        if (!openSet.find(t => t.q === neighbor.q && t.r === neighbor.r)) {
          openSet.push(neighbor);
        }
      }
    }
  }

  return null; // No path found
}
