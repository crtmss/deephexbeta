// src/scenes/WorldSceneMapLocations.js
// Use scene.hexToPixel directly (it already includes the isometric projection).
// Add only map offsets + elevation lift. No double-iso anymore.

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

function inBounds(q, r, w, h) { return q >= 0 && q < w && r >= 0 && r < h; }
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

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

/* --------------------- Biome-aware tree emoji --------------------- */
function resolveBiome(scene, mapData) {
  // Prefer map’s meta (produced in HexMap); fallback to any attached on tiles.
  return scene?.hexMap?.worldMeta?.biome ||
         mapData?.__worldMeta?.biome ||
         'Temperate Biome';
}
function treeEmojiFor(biome, tileType) {
  // Tile overrides first (keeps visuals coherent if biomes mix):
  if (tileType === 'volcano_ash') return '🌴';
  if (tileType === 'sand')        return '🌴';
  if (tileType === 'swamp')       return '🌳';
  if (tileType === 'ice' || tileType === 'snow') return '🌲';

  // Biome defaults:
  const b = (biome || '').toLowerCase();
  if (b.includes('volcan'))  return '🌴';
  if (b.includes('desert'))  return '🌴';
  if (b.includes('icy'))     return '🌲';
  if (b.includes('swamp'))   return '🌳';
  return '🌳'; // temperate default
}

/* ================= Placement & flags =================
   Enforces peak rule: mountain icon ONLY on elevation === 4
   (No random mountain icons elsewhere) */
function placeLocations(mapData, width, height, rnd) {
  for (const t of mapData) {
    // Always clear POIs on water.
    if (t.type === 'water') {
      t.hasForest = t.hasRuin = t.hasCrashSite = t.hasVehicle = false;
      t.hasMountainIcon = false;
      continue;
    }

    // --- Peaks: icon only if elevation === 4 ---
    const elev = typeof t.elevation === 'number' ? t.elevation : 0;
    t.hasMountainIcon = (elev === 4);

    // Forests (keep stable behavior: explicit forest OR light random growth)
    if (t.type === 'forest') t.hasForest = true;
    else if (!t.hasForest && chance(rnd, 0.06)) t.hasForest = true;

    // Ruins
    if (!t.hasRuin && t.type !== 'mountain' && chance(rnd, 0.010)) t.hasRuin = true;

    // Crash Sites
    if (!t.hasCrashSite && chance(rnd, 0.006)) t.hasCrashSite = true;

    // Vehicles — include 'sand' explicitly
    if (!t.hasVehicle &&
        (t.type === 'plains' || t.type === 'desert' || t.type === 'sand' || t.type === 'grassland' || t.type === '') &&
        chance(rnd, 0.008)) {
      t.hasVehicle = true;
    }
  }

  // Forest spreading (local seed so clusters are deterministic per tile)
  const byKey = new Map(mapData.map(tt => [keyOf(tt.q, tt.r), tt]));
  for (const t of mapData) {
    if (!t.hasForest) continue;
    const localRnd = mulberry32((t.q * 73856093) ^ (t.r * 19349663));
    for (const n of neighborTiles(byKey, width, height, t.q, t.r, true)) {
      if (!n.hasForest && chance(localRnd, 0.15)) n.hasForest = true;
    }
  }
}

/* ================= Roads (graph-based, with A*) ================= */
function markRoadEdge(a, b, type = 'countryside') {
  if (!a || !b) return;
  if (a.type === 'water' || b.type === 'water') return;

  a.hasRoad = b.hasRoad = true;
  a.roadType = a.roadType === 'asphalt' || type === 'asphalt' ? 'asphalt' : (a.roadType || 'countryside');
  b.roadType = b.roadType === 'asphalt' || type === 'asphalt' ? 'asphalt' : (b.roadType || 'countryside');

  a.roadLinks = a.roadLinks || new Set();
  b.roadLinks = b.roadLinks || new Set();
  a.roadLinks.add(keyOf(b.q, b.r));
  b.roadLinks.add(keyOf(a.q, a.r));
}
function astar(byKey, width, height, start, goal) {
  const startK = keyOf(start.q, start.r);
  const goalK  = keyOf(goal.q, goal.r);
  const open = new Map([[startK, {k:startK,q:start.q,r:start.r,g:0,f:0,parent:null}]]);
  const closed = new Set();
  const h = (q, r) => Math.abs(q - goal.q) + Math.abs(r - goal.r);

  while (open.size) {
    let cur = null;
    for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
    open.delete(cur.k);

    if (cur.k === goalK) {
      const path = [];
      for (let n = cur; n; n = n.parent) path.push(byKey.get(keyOf(n.q, n.r)));
      path.reverse();
      return path;
    }

    closed.add(cur.k);
    for (const [dq, dr] of neighborsOddR(0, 0)) {
      const nq = cur.q + dq, nr = cur.r + dr;
      const nk = keyOf(nq, nr);
      if (!byKey.has(nk) || closed.has(nk)) continue;

      const t = byKey.get(nk);
      if (!t || t.type === 'water') continue;

      const g = cur.g + 1;
      const f = g + h(nq, nr);
      const ex = open.get(nk);
      if (!ex || g < ex.g) open.set(nk, {k:nk,q:nq,r:nr,g,f,parent:cur});
    }
  }
  return null;
}
function generateRoads(mapData, width, height, seed) {
  const rnd = mulberry32(seed >>> 0);
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));
  const at = (q, r) => byKey.get(keyOf(q, r));

  // Trunk roads
  const numTrunks = rndInt(rnd, 0, 2);
  const maxLen    = Math.floor(Math.max(width, height) * 1.1);

  function stepDir(cur, prevDir) {
    const dirs = neighborsOddR(0, 0);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 6; i++) {
      if (prevDir !== null && i === ((prevDir + 3) % 6)) continue;
      const [dq, dr] = dirs[i];
      const n = at(cur.q + dq, cur.r + dr);
      if (!n || n.type === 'water') continue;

      // Bias slightly to avoid hexy patterns (keep variety)
      const eastish = (i === 0 || i === 1 || i === 5) ? 0.6 : 0;
      const score = eastish + (rnd() - 0.5) * 0.2;
      if (score > bestScore) { bestScore = score; best = { n, dir: i }; }
    }
    return best;
  }

  for (let t = 0; t < numTrunks; t++) {
    let start = null, guard = 200;
    while (!start && guard-- > 0) {
      const q = rndInt(rnd, 1, Math.max(1, Math.floor(width / 3)));
      const r = rndInt(rnd, 1, height - 2);
      const cand = at(q, r);
      if (cand && cand.type !== 'water') start = cand;
    }
    if (!start) continue;

    let cur = start, prevDir = null, steps = 0;
    while (steps++ < maxLen) {
      const nxt = stepDir(cur, prevDir);
      if (!nxt) break;
      markRoadEdge(cur, nxt.n, 'asphalt');
      prevDir = nxt.dir;
      cur = nxt.n;
      if (rnd() < 0.08) break;
    }
  }

  // POI connectors
  const pois = mapData.filter(t => t.type !== 'water' && (t.hasRuin || t.hasCrashSite || t.hasVehicle));
  const pairs = Math.min(2, Math.floor(pois.length / 2));
  for (let i = 0; i < pairs; i++) {
    const a = pois[rndInt(rnd, 0, pois.length - 1)];
    const b = pois[rndInt(rnd, 0, pois.length - 1)];
    if (!a || !b || a === b) continue;
    const path = astar(byKey, width, height, a, b);
    if (path && path.length > 1) {
      for (let j = 0; j + 1 < path.length; j++) {
        markRoadEdge(path[j], path[j + 1], 'countryside');
      }
    }
  }
}

export function applyLocationFlags(mapData, width, height, seed = 1337) {
  const rnd = mulberry32(seed >>> 0);
  placeLocations(mapData, width, height, rnd);
  generateRoads(mapData, width, height, seed ^ 0xA5A5A5A5);
  return mapData;
}

/* ------------- rendering (aligned with tile centers) ------------- */

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

  // Apply placement once per map build
  if (!map.__locationsApplied) {
    try { applyLocationFlags(map, this.mapWidth, this.mapHeight, this.seed ?? 1337); } catch {}
    Object.defineProperty(map, '__locationsApplied', { value: true, enumerable: false });
  }

  // Reset layers
  if (scene.roadsGraphics) scene.roadsGraphics.destroy();
  if (scene.locationsLayer) scene.locationsLayer.destroy();
  const roads = scene.add.graphics({ x: 0, y: 0 }).setDepth(30);
  const layer = scene.add.container(0, 0).setDepth(40);
  scene.roadsGraphics = roads;
  scene.locationsLayer = layer;

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));

  const offsetX = this.mapOffsetX || 0;
  const offsetY = this.mapOffsetY || 0;
  const LIFT    = this?.LIFT_PER_LVL ?? 4;

  // ---- Roads: draw ONLY explicit edges
  for (const t of map) {
    if (!t.roadLinks || !t.roadLinks.size) continue;

    const c1 = scene.hexToPixel(t.q, t.r, size); // already ISO
    const y1 = c1.y - LIFT * effectiveElevationLocal(t);

    for (const target of t.roadLinks) {
      if (target <= keyOf(t.q, t.r)) continue; // undirected once
      const n = byKey.get(target);
      if (!n) continue;

      const c2 = scene.hexToPixel(n.q, n.r, size);
      const y2 = c2.y - LIFT * effectiveElevationLocal(n);

      const asphalt = (t.roadType === 'asphalt' && n.roadType === 'asphalt');
      const width   = asphalt ? 5 : 3;
      const color   = asphalt ? 0x4a4a4a : 0x8b6b39;

      roads.lineStyle(width, color, 0.95);
      roads.beginPath();
      roads.moveTo(c1.x + offsetX, y1 + offsetY);
      roads.lineTo(c2.x + offsetX, y2 + offsetY);
      roads.strokePath();
    }
  }

  // ---- POIs (emojis; never on water)
  const addEmoji = (x, y, char, fontPx, depth = 42) => {
    const t = scene.add.text(x, y, char, {
      fontSize: `${fontPx}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    }).setOrigin(0.5).setDepth(depth);
    layer.add(t);
    return t;
  };

  // Resolve biome once for tree selection
  const biomeName = resolveBiome(scene, map);

  // ---- Landmark (geo object) drawing — explicit meta or heuristic fallback
  const meta = scene?.hexMap?.worldMeta || map.__worldMeta || {};
  if (!map.__geoDrawn) {
    let lm = meta.geoLandmark; // { q, r, emoji, type, label } if provided by generator

    if (!lm) {
      // Fallback: derive one icon position from current biome
      const tiles = map.filter(t => t.type !== 'water');
      const center = {
        q: (this.mapWidth ?? 25) / 2,
        r: (this.mapHeight ?? 25) / 2
      };
      const dist = (t) => (t.q - center.q) * (t.q - center.q) + (t.r - center.r) * (t.r - center.r);

      const pickClosest = (predicate) => {
        let best = null, bestD = Infinity;
        for (const t of tiles) {
          if (!predicate(t)) continue;
          const d = dist(t);
          if (d < bestD) { best = t; bestD = d; }
        }
        return best;
      };

      const b = (biomeName || '').toLowerCase();
      if (b.includes('icy')) {
        const t = pickClosest(tt => tt.type === 'ice' || tt.type === 'snow');
        if (t) lm = { q: t.q, r: t.r, emoji: '❄️', type: 'glacier', label: 'Glacier' };
      } else if (b.includes('volcan')) {
        const t = pickClosest(tt => tt.type === 'mountain' || (typeof tt.elevation === 'number' && tt.elevation === 4));
        if (t) lm = { q: t.q, r: t.r, emoji: '🌋', type: 'volcano', label: 'Volcano' };
      } else if (b.includes('desert')) {
        const t = pickClosest(tt => tt.type === 'sand');
        if (t) lm = { q: t.q, r: t.r, emoji: '🌵', type: 'desert', label: 'Desert' };
      } else if (b.includes('swamp')) {
        const t = pickClosest(tt => tt.type === 'swamp');
        if (t) lm = { q: t.q, r: t.r, emoji: '🌾', type: 'bog', label: 'Bog' };
      } else {
        // temperate
        const t = pickClosest(tt => tt.type !== 'water');
        if (t) lm = { q: t.q, r: t.r, emoji: '🌄', type: 'plateau', label: 'Plateau' };
      }
    }

    if (lm) {
      // Draw emoji
      const tile = map.find(tt => tt.q === lm.q && tt.r === lm.r);
      const p = this.hexToPixel(lm.q, lm.r, size);
      const px = p.x + offsetX;
      const py = p.y + offsetY - LIFT * effectiveElevationLocal(tile);
      addEmoji(px, py, lm.emoji, Math.max(16, size * 0.95), 47);

      // Draw label under it (simple text label)
      const label = lm.label || (lm.type ? lm.type[0].toUpperCase() + lm.type.slice(1) : 'Landmark');
      const txt = scene.add.text(px, py + size * 0.9, label, {
        fontSize: `${Math.max(12, size * 0.55)}px`,
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.35)',
        padding: { left: 4, right: 4, top: 2, bottom: 2 }
      }).setOrigin(0.5).setDepth(47);
      layer.add(txt);

      // Store for volcano suppression
      Object.defineProperty(map, '__geoLandmark', { value: lm, enumerable: false });
    }
    Object.defineProperty(map, '__geoDrawn', { value: true, enumerable: false });
  }

  const activeLM = map.__geoLandmark;
  const volcanoKey = (activeLM && (activeLM.type === 'volcano')) ? keyOf(activeLM.q, activeLM.r) : null;

  // ---- Per-tile POIs
  for (const t of map) {
    if (t.type === 'water') continue;

    const c = scene.hexToPixel(t.q, t.r, size); // already ISO
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(t);

    // Fallback: ensure peaks show even if placement pass didn't set the flag
    if (!t.hasMountainIcon) {
      const elev = typeof t.elevation === 'number' ? t.elevation : 0;
      if (elev === 4) t.hasMountainIcon = true;
    }

    // Peaks first — but NEVER draw on the volcano landmark tile
    if (t.hasMountainIcon) {
      if (!volcanoKey || keyOf(t.q, t.r) !== volcanoKey) {
        addEmoji(cx, cy, '⛰️', size * 0.9, 46);
      }
      // Skip other POIs on peaks
      continue;
    }

    if (t.hasForest) {
      const treeGlyph = treeEmojiFor(biomeName, t.type);
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let tries = 0;
      while (placed.length < treeCount && tries++ < 40) {
        const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const rad = Phaser.Math.FloatBetween(size * 0.35, size * 0.65);
        const posX = cx + Math.cos(ang) * rad;
        const posY = cy + Math.sin(ang) * rad;
        if (placed.some(p => Phaser.Math.Distance.Between(posX, posY, p.x, p.y) < size * 0.3)) continue;
        const fontPx = size * (0.45 + Phaser.Math.FloatBetween(-0.05, 0.05));
        const tree = addEmoji(posX, posY, treeGlyph, fontPx, 43);
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

    if (t.hasRuin)        addEmoji(cx, cy, '🏚️', size * 0.8, 44);
    if (t.hasCrashSite)   addEmoji(cx, cy, '🚀', size * 0.8, 44);
    if (t.hasVehicle)     addEmoji(cx, cy, '🚙', size * 0.8, 44);
  }
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
};
