// AStar.js — Hex-based A* pathfinding algorithm

export function findPath(start, goal, mapData, isBlocked) {
    const frontier = [start];
    const cameFrom = {};
    const costSoFar = {};

    const key = (q, r) => `${q},${r}`;
    cameFrom[key(start.q, start.r)] = null;
    costSoFar[key(start.q, start.r)] = 0;

    const directions = [
        { dq: +1, dr: 0 }, { dq: -1, dr: 0 }, { dq: 0, dr: +1 },
        { dq: 0, dr: -1 }, { dq: +1, dr: -1 }, { dq: -1, dr: +1 }
    ];

    while (frontier.length > 0) {
        const current = frontier.shift();
        if (current.q === goal.q && current.r === goal.r) break;

        for (let dir of directions) {
            const nq = current.q + dir.dq;
            const nr = current.r + dir.dr;
            const next = { q: nq, r: nr };
            const nextKey = key(nq, nr);
            const tile = mapData.find(t => t.q === nq && t.r === nr);
            if (!tile || isBlocked(tile)) continue;

            const newCost = costSoFar[key(current.q, current.r)] + 1;
            if (!(nextKey in costSoFar) || newCost < costSoFar[nextKey]) {
                costSoFar[nextKey] = newCost;
                frontier.push(next);
                cameFrom[nextKey] = current;
            }
        }
    }

    // Reconstruct path
    const path = [];
    let current = goal;
    while (current) {
        path.push(current);
        current = cameFrom[key(current.q, current.r)];
    }
    return path.reverse();
}
