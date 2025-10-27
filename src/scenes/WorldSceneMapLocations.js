// deephexbeta/src/scenes/WorldSceneMapLocations.js

/**
 * WorldSceneMapLocations
 * ----------------------
 * Pure data mutators for location flags:
 *  - forests, ruins, crash sites, vehicles, mountain icons
 *  - roads (two types: 'asphalt' and 'countryside') with long, straighter paths
 *
 * Usage:
 *   import { applyLocationFlags } from './WorldSceneMapLocations.js'
 *   const mapData = generateHexMap(...);
 *   applyLocationFlags(mapData, width, height, seed);
 *
 * This file does NOT depend on Phaser. Rendering is handled in WorldSceneMap.js.
 */

// --------------------- Utilities ---------------------

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function idx(width, q, r) {
  return r * width + q;
}

function inBounds(width, height, q, r) {
  return q >= 0 && q < width && r >= 0 && r < height;
}

// odd-r neighbors in fixed order [E, NE, NW, W, SW, SE]
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[q+1,r],[q,r-1],[q-1,r-1],[q-1,r],[q-1,r+1],[q,r+1]]
    : [[q+1,r],[q+1,r-1],[q,r-1],[q-1,r],[q,r+1],[q+1,r+1]];
}

function manhattanLikeDistance(aq, ar, bq, br) {
  // Works well enough for greedy biasing on axial/odd-r offset
  return Math.abs(aq - bq) + Math.abs(ar - br);
}

function tileAt(mapData, width, height, q, r) {
  if (!inBounds(width, height, q, r)) return null;
  return mapData[idx(width, q, r)] || null;
}

function isLand(tile) {
  if (!tile) return false;
  return tile.type !== 'water';
}

function isHardBlocked(tile) {
  if (!tile) return true;
  // treat mountains & water as hard obstacles for roads
  return tile.type === 'water' || tile.type === 'mountain';
}

// --------------------- Location Flags ---------------------

function placeLocations(mapData, width, height, rnd) {
  // Reset flags we own (keep any existing truthy flags intact, but sanitize undefined)
  for (const t of mapData) {
    t.hasForest = !!t.hasForest;
    t.hasRuin = !!t.hasRuin;
    t.hasCrashSite = !!t.hasCrashSite;
    t.hasVehicle = !!t.hasVehicle;
    t.hasMountainIcon = !!t.hasMountainIcon;
    t.hasRoad = !!t.hasRoad;
    if (t.hasRoad && !t.roadType) t.roadType = 'countryside';
  }

  // Forests: prefer grassland/sand, avoid water/mountain
  const forestChanceByType = {
    grassland: 0.20,
    sand: 0.06,
    mud: 0.12,
    swamp: 0.10,
    mountain: 0.00,
    water: 0.00
  };

  for (const t of mapData) {
    if (!isLand(t) || t.type === 'mountain') continue;
    if (!t.hasForest) {
      const p = forestChanceByType[t.type] ?? 0.05;
      if (rnd() < p) t.hasForest = true;
    }
  }

  // Ruins / Crash sites / Vehicles / Mountain icons
  // Try to place a small number of each, spaced out, on land (not mountain/water).
  const wantRuins = 2 + Math.floor(rnd() * 2);       // 2..3
  const wantCrash = 1 + Math.floor(rnd() * 2);       // 1..2
  const wantVehicle = 2 + Math.floor(rnd() * 2);     // 2..3
  const wantMtnIcon = 3 + Math.floor(rnd() * 3);     // 3..5

  const candidates = mapData
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isLand(t) && t.type !== 'mountain');

  const mountainTiles = mapData
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.type === 'mountain');

  const shuffledLand = seededShuffle(candidates, rnd);
  const shuffledMtn = seededShuffle(mountainTiles, rnd);

  const taken = new Set();

  function farEnough(i, minDist) {
    // enforce grid distance spacing by axial-like metric
    const q1 = mapData[i].q, r1 = mapData[i].r;
    for (const j of taken) {
      const q2 = mapData[j].q, r2 = mapData[j].r;
      if (manhattanLikeDistance(q1, r1, q2, r2) < minDist) return false;
    }
    return true;
  }

  let placed = 0;
  for (const { i } of shuffledLand) {
    if (placed >= wantRuins) break;
    if (!mapData[i].hasRuin && farEnough(i, 6)) {
      mapData[i].hasRuin = true;
      taken.add(i);
      placed++;
    }
  }

  placed = 0;
  for (const { i } of shuffledLand) {
    if (placed >= wantCrash) break;
    if (!mapData[i].hasCrashSite && farEnough(i, 8)) {
      mapData[i].hasCrashSite = true;
      taken.add(i);
      placed++;
    }
  }

  placed = 0;
  for (const { i } of shuffledLand) {
    if (placed >= wantVehicle) break;
    if (!mapData[i].hasVehicle && farEnough(i, 5)) {
      mapData[i].hasVehicle = true;
      taken.add(i);
      placed++;
    }
  }

  placed = 0;
  for (const { i } of shuffledMtn) {
    if (placed >= wantMtnIcon) break;
    if (!mapData[i].hasMountainIcon && farEnough(i, 4)) {
      mapData[i].hasMountainIcon = true;
      taken.add(i);
      placed++;
    }
  }
}

// --------------------- Road Generation ---------------------

/**
 * Generate longer, straighter roads with two types:
 *  - asphalt:   thicker, gray, prefers crossing center / long spans
 *  - countryside: thinner, brown, allows more curvature
 *
 * We:
 *  - pick 2–3 origins near edges on land
 *  - pick distant targets near opposite edges
 *  - greedy-biased walk with inertia, distance-to-target attraction,
 *    avoidance of water/mountains, and spacing penalty vs existing roads
 *  - mark tiles: hasRoad=true, roadType='asphalt'|'countryside'
 */
function generateRoads(mapData, width, height, seed) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);

  const desiredRoads = 2 + Math.floor(rnd() * 2); // 2..3
  const typesPool = ['asphalt', 'countryside', 'countryside'];

  // Helper to score "straightness" / inertia
  function dirIndex(prev, cur, next) {
    // Return which neighbor index 'next' is relative to 'cur' in odd-r order.
    const ns = neighborsOddR(cur.q, cur.r);
    for (let i = 0; i < 6; i++) {
      const [qq, rr] = ns[i];
      if (qq === next.q && rr === next.r) return i;
    }
    return -1;
  }

  function pickEdgeLand(rnd, preferHorizontal = true) {
    // Choose a land tile near a random edge; bias to be on land
    for (let tries = 0; tries < 200; tries++) {
      let q, r;
      if (preferHorizontal) {
        r = (rnd() < 0.5) ? 0 : (height - 1);
        q = Math.floor(rnd() * width);
      } else {
        q = (rnd() < 0.5) ? 0 : (width - 1);
        r = Math.floor(rnd() * height);
      }
      const t = tileAt(mapData, width, height, q, r);
      if (t && isLand(t) && !isHardBlocked(t)) return { q, r };
    }
    // fallback: any land
    const pool = mapData.filter(t => isLand(t) && !isHardBlocked(t));
    if (pool.length === 0) return null;
    const pick = pool[Math.floor(rnd() * pool.length)];
    return { q: pick.q, r: pick.r };
  }

  function pickOppositeEdgeTarget(from, rnd, preferHorizontal = true) {
    // Pick something far away near opposite edge (land & not blocked)
    const candidates = [];
    const band = Math.max(2, Math.floor((preferHorizontal ? width : height) * 0.10));
    if (preferHorizontal) {
      // opposite edge in r
      const targetR = (from.r < height / 2) ? height - 1 : 0;
      for (let q = 0; q < width; q++) {
        for (let k = -band; k <= band; k++) {
          const r = Math.max(0, Math.min(height - 1, targetR + k));
          const t = tileAt(mapData, width, height, q, r);
          if (t && isLand(t) && !isHardBlocked(t)) {
            candidates.push(t);
          }
        }
      }
    } else {
      // opposite edge in q
      const targetQ = (from.q < width / 2) ? width - 1 : 0;
      for (let r = 0; r < height; r++) {
        for (let k = -band; k <= band; k++) {
          const q = Math.max(0, Math.min(width - 1, targetQ + k));
          const t = tileAt(mapData, width, height, q, r);
          if (t && isLand(t) && !isHardBlocked(t)) {
            candidates.push(t);
          }
        }
      }
    }
    if (candidates.length === 0) return null;
    // Pick the farthest to encourage long path
    candidates.sort((a, b) => {
      const da = manhattanLikeDistance(from.q, from.r, a.q, a.r);
      const db = manhattanLikeDistance(from.q, from.r, b.q, b.r);
      return db - da; // farthest first
    });
    const top = Math.max(1, Math.floor(candidates.length * 0.15));
    return candidates[Math.floor(rnd() * top)];
  }

  function nearbyRoadPenalty(q, r) {
    // discourage hugging other roads (avoid clumping)
    const ns = neighborsOddR(q, r);
    let count = 0;
    for (const [qq, rr] of ns) {
      const t = tileAt(mapData, width, height, qq, rr);
      if (t && t.hasRoad) count++;
    }
    return count * 1.2; // each adjacent road increases penalty
  }

  function walkRoad(from, to, roadType, maxSteps) {
    const path = [];
    let cur = { q: from.q, r: from.r };
    let lastDir = -1;

    for (let step = 0; step < maxSteps; step++) {
      const t = tileAt(mapData, width, height, cur.q, cur.r);
      if (!t) break;
      path.push({ q: cur.q, r: cur.r });

      // Reached close enough
      if (manhattanLikeDistance(cur.q, cur.r, to.q, to.r) <= 1) break;

      const options = neighborsOddR(cur.q, cur.r)
        .map(([qq, rr]) => ({ q: qq, r: rr }))
        .filter(n => inBounds(width, height, n.q, n.r));

      // Score candidates
      let best = null;
      for (const n of options) {
        const nt = tileAt(mapData, width, height, n.q, n.r);
        if (!nt || isHardBlocked(nt)) continue;

        // distance term
        const d = manhattanLikeDistance(n.q, n.r, to.q, to.r);

        // inertia term (prefer not to turn)
        const dirIdx = dirIndex(null, cur, n);
        const turnCost = (lastDir < 0 || dirIdx < 0) ? 0 : (dirIdx === lastDir ? 0 : 0.8);

        // road spacing penalty
        const crowd = nearbyRoadPenalty(n.q, n.r);

        // light curvature: countryside allows slightly more turn
        const curveBias = (roadType === 'asphalt') ? 0.6 : 0.3;

        // final score: lower is better
        const score = d + turnCost * (1.0 - curveBias) + crowd;

        if (!best || score < best.score) {
          best = { n, score, dirIdx };
        }
      }

      if (!best) break;
      lastDir = best.dirIdx;
      cur = best.n;
    }

    // Mark tiles
    for (const p of path) {
      const t = tileAt(mapData, width, height, p.q, p.r);
      if (!t) continue;
      t.hasRoad = true;
      // If a road already exists, prefer asphalt as "dominant"
      if (!t.roadType) t.roadType = roadType;
      else if (t.roadType !== 'asphalt') t.roadType = roadType;
    }
  }

  for (let k = 0; k < desiredRoads; k++) {
    const preferHorizontal = rnd() < 0.5;
    const start = pickEdgeLand(rnd, preferHorizontal);
    if (!start) continue;
    const goal = pickOppositeEdgeTarget(start, rnd, preferHorizontal);
    if (!goal) continue;

    const roadType = typesPool[Math.floor(rnd() * typesPool.length)]; // biased: more countryside
    const maxSteps = Math.floor((width + height) * (roadType === 'asphalt' ? 1.2 : 1.0));
    walkRoad(start, goal, roadType, maxSteps);
  }
}

// --------------------- Public API ---------------------

/**
 * Mutates mapData in place to add:
 *  - location flags (forests, ruins, crash sites, vehicles, mountain icons)
 *  - roads (hasRoad + roadType)
 */
export function applyLocationFlags(mapData, width, height, seed = 1337) {
  const rnd = mulberry32(seed >>> 0);

  // 1) Place landmarks & points of interest
  placeLocations(mapData, width, height, rnd);

  // 2) Generate roads (two types) after locations so roads can route around them if needed
  generateRoads(mapData, width, height, seed ^ 0xA5A5A5A5);

  return mapData;
}
