// Spawns locations (forest/ruin/crash/vehicle/mountainIcon)
// and procedurally generates/draws ROADS (asphalt + countryside).
//
// Called automatically by drawHexMap() in WorldSceneMap.js

import {
  getHexNeighbors,
  effectiveElevation,
  isoOffset,
  LIFT_PER_LVL,
} from './WorldSceneMap.js';

/* ----------------------------- helpers ---------------------------------- */

function getTile(mapData, q, r) {
  return mapData.find(t => t.q === q && t.r === r) || null;
}

// axial directions in fixed angular order [E, NE, NW, W, SW, SE]
const DIRS = [
  [+1,  0], // E
  [+1, -1], // NE
  [ 0, -1], // NW
  [-1,  0], // W
  [-1, +1], // SW
  [ 0, +1], // SE
];
function stepDir({ q, r }, dir) {
  const [dq, dr] = DIRS[(dir + 6) % 6];
  return { q: q + dq, r: r + dr };
}
function axialDist(a, b) {
  // cube distance for axial coords
  const x1 = a.q, z1 = a.r, y1 = -x1 - z1;
  const x2 = b.q, z2 = b.r, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

function isRoadPassable(tile) {
  if (!tile) return false;
  if (tile.type === 'water') return false;
  // avoid sheer mountains for roads (icons still allowed)
  if (tile.type === 'mountain') return false;
  return true;
}

function edgeKey(a, b) {
  // undirected normalized edge key
  const k1 = `${a.q},${a.r}`;
  const k2 = `${b.q},${b.r}`;
  return (k1 < k2) ? `${k1}|${k2}` : `${k2}|${k1}`;
}

/* -------------------------- road generation ------------------------------ */

/**
 * Build a straighter, longer road network.
 * - asphalt (arterials): few, longer, straighter lines across the island
 * - countryside: more meandering, shorter spurs feeding from arterials or inland
 *
 * Returns: { asphalt: Set<string>, country: Set<string> } of undirected edges
 */
function generateRoadNetwork(scene) {
  const { mapData } = scene;

  const edgesAsphalt = new Set();
  const edgesCountry = new Set();

  // Land tiles only
  const land = mapData.filter(t => isRoadPassable(t));
  if (land.length === 0) return { asphalt: edgesAsphalt, country: edgesCountry };

  // rough map bounds (in axial r/q)
  const qs = land.map(t => t.q);
  const rs = land.map(t => t.r);
  const qMin = Math.min(...qs), qMax = Math.max(...qs);
  const rMin = Math.min(...rs), rMax = Math.max(...rs);
  const center = { q: Math.round((qMin + qMax) / 2), r: Math.round((rMin + rMax) / 2) };

  const nearExistingEdge = (pt) => {
    // discourage clumping: if any road edge's endpoints lie near this tile, treat as near
    for (const set of [edgesAsphalt, edgesCountry]) {
      for (const e of set) {
        const [a, b] = e.split('|').map(s => {
          const [q, r] = s.split(',').map(Number);
          return { q, r };
        });
        if (axialDist(pt, a) <= 2 || axialDist(pt, b) <= 2) return true;
      }
    }
    return false;
  };

  // choose starts that are on land and not too close to existing roads
  function pickStart(nearCenterBias = false) {
    const attempts = 60;
    for (let i = 0; i < attempts; i++) {
      const t = land[Phaser.Math.Between(0, land.length - 1)];
      if (nearCenterBias && axialDist(t, center) > Math.max(6, (qMax - qMin + rMax - rMin) / 6)) continue;
      if (!nearExistingEdge(t)) return t;
    }
    return land[0];
  }

  // grow one road; returns last position so branches can attach
  function growRoad(startTile, dir, maxLen, turnProb, edgeSet, preferStraight = true) {
    let current = { q: startTile.q, r: startTile.r };
    let curDir = dir;
    let length = 0;

    // mark visited to avoid loops
    const visited = new Set([`${current.q},${current.r}`]);

    while (length < maxLen) {
      // try straight first
      let next = stepDir(current, curDir);
      let tileNext = getTile(mapData, next.q, next.r);

      // if straight invalid, try gentle turns ±1
      if (!isRoadPassable(tileNext)) {
        const dirs = [curDir + 1, curDir - 1];
        let found = false;
        for (const d of dirs) {
          const cand = stepDir(current, d);
          const t2 = getTile(mapData, cand.q, cand.r);
          if (isRoadPassable(t2)) {
            curDir = (d + 6) % 6;
            next = cand;
            tileNext = t2;
            found = true;
            break;
          }
        }
        if (!found) break; // dead end
      }

      const k = edgeKey(current, next);
      if (!edgeSet.has(k)) edgeSet.add(k);

      current = next;
      visited.add(`${current.q},${current.r}`);
      length++;

      // probabilistic gentle turn
      if (Math.random() < turnProb) {
        const delta = Phaser.Math.Between(0, 1) === 0 ? -1 : +1;
        curDir = (curDir + delta + 6) % 6;
      } else if (preferStraight && Math.random() < 0.1) {
        // tiny nudge to keep consistent heading
        // no-op, keeps it straight
      }
    }
    return current;
  }

  /* -------- Asphalt arterials (2–3 long, straight-ish) -------- */
  const numAsphalt = Phaser.Math.Between(2, 3);
  for (let i = 0; i < numAsphalt; i++) {
    const start = pickStart(true); // bias near center
    // bias directions to main compass routes for straighter lines
    const preferredDirs = [0, 3, 1, 4]; // E/W & the two diagonals
    let dir = preferredDirs[Phaser.Math.Between(0, preferredDirs.length - 1)];
    const len = Phaser.Math.Between(12, 22);
    const end = growRoad(start, dir, len, 0.12, edgesAsphalt, true);

    // small branch from each arterial end to avoid abrupt stop
    const branchDir = (dir + (Phaser.Math.Between(0, 1) ? +1 : -1) + 6) % 6;
    growRoad(getTile(mapData, end.q, end.r), branchDir, Phaser.Math.Between(4, 8), 0.18, edgesAsphalt, true);
  }

  /* -------- Countryside roads (3–5, attach to arterials or meander) -------- */
  const numCountry = Phaser.Math.Between(3, 5);
  for (let i = 0; i < numCountry; i++) {
    // either start near an asphalt edge, or random inland
    let start;
    if (edgesAsphalt.size && Math.random() < 0.65) {
      const choice = Array.from(edgesAsphalt)[Phaser.Math.Between(0, edgesAsphalt.size - 1)];
      const [a, b] = choice.split('|');
      const [q, r] = (Math.random() < 0.5 ? a : b).split(',').map(Number);
      start = getTile(mapData, q, r) || pickStart(false);
    } else {
      start = pickStart(false);
    }
    let dir = Phaser.Math.Between(0, 5);
    const len = Phaser.Math.Between(8, 16);
    growRoad(start, dir, len, 0.28, edgesCountry, false);
  }

  return { asphalt: edgesAsphalt, country: edgesCountry };
}

/* ------------------------------- drawing --------------------------------- */

function drawRoadEdges(scene, edges, width, colorInt, depth = 3) {
  const offX = scene.mapOffsetX ?? 0;
  const offY = scene.mapOffsetY ?? 0;

  for (const e of edges) {
    const [aStr, bStr] = e.split('|');
    const [q1, r1] = aStr.split(',').map(Number);
    const [q2, r2] = bStr.split(',').map(Number);

    const t1 = getTile(scene.mapData, q1, r1);
    const t2 = getTile(scene.mapData, q2, r2);
    if (!t1 || !t2) continue;

    const e1 = effectiveElevation(t1);
    const e2 = effectiveElevation(t2);

    const p1 = scene.hexToPixel(q1, r1, scene.hexSize);
    const p2 = scene.hexToPixel(q2, r2, scene.hexSize);

    const y1 = p1.y + offY - LIFT_PER_LVL * e1;
    const y2 = p2.y + offY - LIFT_PER_LVL * e2;

    const g = scene.add.graphics().setDepth(depth);
    g.lineStyle(width, colorInt, 0.9);
    g.beginPath();
    g.moveTo(p1.x + offX, y1);
    g.lineTo(p2.x + offX, y2);
    g.strokePath();
    scene.objects.push(g);
  }
}

/* ---------------------- locations + road renderer ------------------------- */

export function drawLocationsAndRoads() {
  const offX = this.mapOffsetX ?? 0;
  const offY = this.mapOffsetY ?? 0;

  // ----- Decorative locations on tiles -----
  this.mapData.forEach(hex => {
    const { q, r, hasForest, hasRuin, hasCrashSite, hasVehicle, hasMountainIcon } = hex;

    const eff = effectiveElevation(hex);
    const base = this.hexToPixel(q, r, this.hexSize);
    const x = base.x + offX;
    const y = base.y + offY - LIFT_PER_LVL * eff;

    // Forest
    if (hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;

      while (placed.length < treeCount && attempts < 40) {
        const angle = Phaser.Math.FloatBetween(0, 2 * Math.PI);
        const radius = Phaser.Math.FloatBetween(this.hexSize * 0.35, 0.65 * this.hexSize);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const o = isoOffset(dx, dy);
        const posX = x + o.x;
        const posY = y + o.y;
        const minDist = this.hexSize * 0.3;

        const tooClose = placed.some(p => Phaser.Math.Distance.Between(posX, posY, p.x, p.y) < minDist);
        if (!tooClose) {
          const sizePercent = 0.45 + Phaser.Math.FloatBetween(-0.05, 0.05);
          const size = this.hexSize * sizePercent;

          const tree = this.add.text(posX, posY, '🌲', { fontSize: `${size}px` })
            .setOrigin(0.5)
            .setDepth(5);

          this.tweens.add({
            targets: tree,
            angle: { from: -1.5, to: 1.5 },
            duration: Phaser.Math.Between(2500, 4000),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Phaser.Math.Between(0, 1000)
          });

          this.objects.push(tree);
          placed.push({ x: posX, y: posY });
        }
        attempts++;
      }
    }

    if (hasRuin)
      this.objects.push(this.add.text(x, y, '🏛️', { fontSize: `${this.hexSize * 0.8}px` }).setOrigin(0.5).setDepth(5));
    if (hasCrashSite)
      this.objects.push(this.add.text(x, y, '🚀', { fontSize: `${this.hexSize * 0.8}px` }).setOrigin(0.5).setDepth(5));
    if (hasVehicle)
      this.objects.push(this.add.text(x, y, '🚙', { fontSize: `${this.hexSize * 0.8}px` }).setOrigin(0.5).setDepth(5));
    if (hasMountainIcon)
      this.objects.push(this.add.text(x, y, '🏔️', {
        fontSize: `${this.hexSize * 0.9}px`,
        fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
      }).setOrigin(0.5).setDepth(5));
  });

  // ----- Procedural road network (asphalt + countryside) -----
  const network = generateRoadNetwork(this);

  // Colors/widths
  const ASPHALT_COLOR = 0x6f6f6f;   // darker grey
  const ASPHALT_WIDTH = Math.max(2, Math.round(this.hexSize * 0.18));

  const COUNTRY_COLOR = 0xb8a889;  // warmer, lighter countryside tone
  const COUNTRY_WIDTH = Math.max(1, Math.round(this.hexSize * 0.12));

  // Draw asphalt under countryside so smaller roads can sit on top when crossing
  drawRoadEdges(this, network.asphalt, ASPHALT_WIDTH, ASPHALT_COLOR, 3);
  drawRoadEdges(this, network.country, COUNTRY_WIDTH, COUNTRY_COLOR, 4);
}
