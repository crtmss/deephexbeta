// src/scenes/WorldSceneMapLocations.js
// POI spawning (emojis) + road generation/drawing.
// Fixes: (1) explicit road edges (no hex-lattice), (2) lower road density,
//        (3) roads/POIs never on water, (4) exact isometric placement.

function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rndInt = (rnd, min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (rnd, p) => rnd() < p;
const keyOf = (q, r) => `${q},${r}`;
const inBounds = (q, r, w, h) => q >= 0 && q < w && r >= 0 && r < h;

// axial odd-r neighbors (6)
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

// neighbor list with bounds & non-water filter
function neighborTiles(byKey, width, height, q, r, skipWater = true) {
  const out = [];
  for (const [dq, dr] of neighborsOddR(q, r)) {
    const nq = q + dq, nr = r + dr;
    if (!inBounds(nq, nr, width, height)) continue;
    const t = byKey.get(keyOf(nq, nr));
    if (!t) continue;
    if (skipWater && t.type === 'water') continue;
    out.push(t);
  }
  return out;
}

/* ======================
   SPAWNING (stable-like, never on water)
   ====================== */
function placeLocations(mapData, width, height, rnd) {
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));

  for (const t of mapData) {
    const type = t.type || '';
    if (type === 'water') {
      t.hasForest = false;
      t.hasRuin = false;
      t.hasCrashSite = false;
      t.hasVehicle = false;
      t.hasMountainIcon = false;
      continue;
    }

    // forests
    if (type === 'forest') t.hasForest = true;
    else if (!t.hasForest && chance(rnd, 0.06)) t.hasForest = true;

    // ruins
    if (!t.hasRuin && type !== 'mountain' && chance(rnd, 0.010)) t.hasRuin = true;

    // crash sites
    if (!t.hasCrashSite && chance(rnd, 0.006)) t.hasCrashSite = true;

    // vehicles
    if (!t.hasVehicle && (type === 'plains' || type === 'desert' || type === 'grassland' || type === '') && chance(rnd, 0.008)) {
      t.hasVehicle = true;
    }

    // tall non-mountain marker
    if (!t.hasMountainIcon && type !== 'mountain' && (t.elevation ?? 0) >= 2 && chance(rnd, 0.05)) {
      t.hasMountainIcon = true;
    }
  }

  // soft forest clustering (no water)
  for (const t of mapData) {
    if (!t.hasForest) continue;
    const localRnd = mulberry32((t.q * 73856093) ^ (t.r * 19349663));
    for (const n of neighborTiles(byKey, width, height, t.q, t.r, true)) {
      if (!n.hasForest && chance(localRnd, 0.15)) n.hasForest = true;
    }
  }
}

/* ======================
   ROADS: explicit edge graph (no honeycomb)
   ====================== */

// Marks a bidirectional edge between a and b (same array instance from byKey)
function markRoadEdge(a, b, type = 'countryside') {
  if (!a || !b) return;
  if (a.type === 'water' || b.type === 'water') return;
  a.hasRoad = true; b.hasRoad = true;
  a.roadType = a.roadType === 'asphalt' || type === 'asphalt' ? 'asphalt' : (a.roadType || 'countryside');
  b.roadType = b.roadType === 'asphalt' || type === 'asphalt' ? 'asphalt' : (b.roadType || 'countryside');

  a.roadLinks = a.roadLinks || new Set();
  b.roadLinks = b.roadLinks || new Set();
  a.roadLinks.add(keyOf(b.q, b.r));
  b.roadLinks.add(keyOf(a.q, a.r));
}

function generateRoads(mapData, width, height, seed) {
  const rnd = mulberry32(seed >>> 0);
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));
  const at = (q, r) => byKey.get(keyOf(q, r));

  // Helper: choose next step for a meandering trunk
  function nextStep(cur, prevDir) {
    const dirs = neighborsOddR(0, 0); // six dirs as vectors
    // bias slightly to the "east-ish" directions to get left->right feel
    const eastish = [0, 1, 5]; // (+1,0), (+1,-1) or (+1,+1)
    const weights = [1, 1, 1, 0.7, 0.7, 1];
    // avoid immediate backtracking
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = dirs[i];
      if (prevDir !== null && i === ((prevDir + 3) % 6)) continue; // opposite
      const nq = cur.q + dq, nr = cur.r + dr;
      const n = at(nq, nr);
      if (!n || n.type === 'water') continue;
      // simple scoring: eastish bonus + small random + stay roughly in-band vertically
      const eastBonus = eastish.includes(i) ? 0.7 : 0;
      const bandBonus = -Math.abs(nr - cur.r) * 0.05;
      const score = eastBonus + bandBonus + rnd() * 0.2;
      if (score > bestScore) { bestScore = score; best = { n, dir: i }; }
    }
    return best;
  }

  // --- Trunk walks (few, limited length) ---
  const numTrunks = rndInt(rnd, 1, 2);          // fewer trunks than before
  const maxLen    = Math.floor(Math.max(width, height) * 1.2); // moderate length
  for (let t = 0; t < numTrunks; t++) {
    // pick a non-water start somewhere on the west third
    let start = null, guard = 200;
    while (!start && guard-- > 0) {
      const q = rndInt(rnd, 1, Math.max(1, Math.floor(width / 3)));
      const r = rndInt(rnd, 1, height - 2);
      const cand = at(q, r);
      if (cand && cand.type !== 'water') start = cand;
    }
    if (!start) continue;

    let cur = start;
    let prevDir = null;
    let steps = 0;
    // Asphalt trunks
    while (steps++ < maxLen) {
      const step = nextStep(cur, prevDir);
      if (!step) break;
      markRoadEdge(cur, step.n, 'asphalt');
      prevDir = step.dir;
      cur = step.n;
      // stop sometimes to avoid full map bands
      if (rnd() < 0.05) break;
    }
  }

  // --- Country paths connecting some POIs (A*) ---
  const pois = mapData.filter(t => t.type !== 'water' && (t.hasRuin || t.hasCrashSite || t.hasVehicle));
  if (pois.length >= 2) {
    // pick at most 3 random pairs
    const pairs = Math.min(3, Math.floor(pois.length / 2));
    for (let k = 0; k < pairs; k++) {
      const a = pois[rndInt(rnd, 0, pois.length - 1)];
      const b = pois[rndInt(rnd, 0, pois.length - 1)];
      if (!a || !b || a === b) continue;
      const path = astar(byKey, width, height, a, b);
      if (path && path.length > 1) {
        for (let i = 0; i + 1 < path.length; i++) {
          markRoadEdge(path[i], path[i + 1], 'countryside');
        }
      }
    }
  }
}

// Simple A* on axial grid (odd-r neighbors), skipping water
function astar(byKey, width, height, start, goal) {
  const startK = keyOf(start.q, start.r);
  const goalK = keyOf(goal.q, goal.r);

  const open = new Map([[startK, { k: startK, q: start.q, r: start.r, g: 0, f: 0, parent: null }]]);
  const closed = new Set();

  function h(q, r) {
    // axial distance approximation
    const dq = Math.abs(q - goal.q);
    const dr = Math.abs(r - goal.r);
    return dq + dr;
  }

  while (open.size) {
    // get node with lowest f
    let current = null;
    for (const n of open.values()) if (!current || n.f < current.f) current = n;
    open.delete(current.k);
    const curK = current.k;
    if (curK === goalK) {
      const path = [];
      let n = current;
      while (n) {
        path.push(byKey.get(keyOf(n.q, n.r)));
        n = n.parent;
      }
      path.reverse();
      return path;
    }
    closed.add(curK);

    for (const [dq, dr] of neighborsOddR(0, 0)) {
      const nq = current.q + dq, nr = current.r + dr;
      if (!inBounds(nq, nr, width, height)) continue;
      const t = byKey.get(keyOf(nq, nr));
      if (!t || t.type === 'water') continue;
      const nk = keyOf(nq, nr);
      if (closed.has(nk)) continue;

      const g = current.g + 1;
      const f = g + h(nq, nr);
      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        open.set(nk, { k: nk, q: nq, r: nr, g, f, parent: current });
      }
    }
  }
  return null;
}

export function applyLocationFlags(mapData, width, height, seed = 1337) {
  const rnd = mulberry32(seed >>> 0);
  placeLocations(mapData, width, height, rnd);
  generateRoads(mapData, width, height, seed ^ 0xA5A5A5A5);
  return mapData;
}

/* ======================
   RENDERING
   ====================== */

function effectiveElevationLocal(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}

export function drawLocationsAndRoads() {
  const scene = this;
  const map = this.mapData;
  const size = this.hexSize || 24;
  if (!Array.isArray(map) || !map.length) return;

  if (!map.__locationsApplied) {
    try { applyLocationFlags(map, this.mapWidth, this.mapHeight, this.seed ?? 1337); } catch {}
    Object.defineProperty(map, '__locationsApplied', { value: true, enumerable: false });
  }

  // Clean previous layers
  if (scene.roadsGraphics) scene.roadsGraphics.destroy();
  if (scene.locationsLayer) scene.locationsLayer.destroy();
  const roads = scene.add.graphics({ x: 0, y: 0 }).setDepth(30);
  const layer = scene.add.container(0, 0).setDepth(40);
  scene.roadsGraphics = roads;
  scene.locationsLayer = layer;

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const centerCache = new Map();
  const centerOf = (q, r) => {
    const k = keyOf(q, r);
    let p = centerCache.get(k);
    if (!p) { p = scene.hexToPixel(q, r, size); centerCache.set(k, p); }
    return p;
  };

  const offsetX = this.mapOffsetX || 0;
  const offsetY = this.mapOffsetY || 0;
  const LIFT = this?.LIFT_PER_LVL ?? 4;

  // ---- ROAD RENDER: use explicit edges in roadLinks only ----
  for (const t of map) {
    if (!t.roadLinks || !t.roadLinks.size) continue;

    const p1 = centerOf(t.q, t.r);
    const eff1 = effectiveElevationLocal(t);
    const x1 = p1.x + offsetX;
    const y1 = p1.y + offsetY - LIFT * eff1;

    for (const targetKey of t.roadLinks) {
      // draw each undirected edge once (lexicographic key ordering)
      if (targetKey <= keyOf(t.q, t.r)) continue;
      const n = byKey.get(targetKey);
      if (!n) continue;

      const p2 = centerOf(n.q, n.r);
      const eff2 = effectiveElevationLocal(n);
      const x2 = p2.x + offsetX;
      const y2 = p2.y + offsetY - LIFT * eff2;

      const asphalt = (t.roadType === 'asphalt' && n.roadType === 'asphalt');
      const width = asphalt ? 5 : 3;
      const color = asphalt ? 0x4a4a4a : 0x8b6b39;

      roads.lineStyle(width, color, 0.95);
      roads.beginPath();
      roads.moveTo(x1, y1);
      roads.lineTo(x2, y2);
      roads.strokePath();
    }
  }

  // ---- POIs (emojis; never on water) ----
  const addEmoji = (x, y, char, fontPx, depth = 42) => {
    const t = scene.add.text(x, y, char, {
      fontSize: `${fontPx}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    }).setOrigin(0.5).setDepth(depth);
    layer.add(t);
    return t;
  };

  for (const t of map) {
    if (t.type === 'water') continue;
    const base = centerOf(t.q, t.r);
    const eff = effectiveElevationLocal(t);
    const cx = base.x + offsetX;
    const cy = base.y + offsetY - LIFT * eff;

    // clustered trees (stable)
    if (t.hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;
      while (placed.length < treeCount && attempts < 40) {
        attempts++;
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const radius = Phaser.Math.FloatBetween(size * 0.35, size * 0.65);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const posX = cx + dx, posY = cy + dy;
        const minDist = size * 0.3;
        const tooClose = placed.some(p => Phaser.Math.Distance.Between(posX, posY, p.x, p.y) < minDist);
        if (!tooClose) {
          const fontPx = size * (0.45 + Phaser.Math.FloatBetween(-0.05, 0.05));
          const tree = addEmoji(posX, posY, '🌲', fontPx, 43);
          scene.tweens.add({
            targets: tree,
            angle: { from: -1.5, to: 1.5 },
            duration: Phaser.Math.Between(2500, 4000),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Phaser.Math.Between(0, 1000)
          });
          placed.push({ x: posX, y: posY });
        }
      }
    }

    if (t.hasRuin)        addEmoji(cx, cy, '🏚️', size * 0.8);
    if (t.hasCrashSite)   addEmoji(cx, cy, '🚀', size * 0.8);
    if (t.hasVehicle)     addEmoji(cx, cy, '🚙', size * 0.8);
    if (t.hasMountainIcon && t.type !== 'mountain')
                          addEmoji(cx, cy, '🏔️', size * 0.9);
  }
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
};
