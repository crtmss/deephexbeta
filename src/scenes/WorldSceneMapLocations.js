// src/scenes/WorldSceneMapLocations.js
// Use scene.hexToPixel directly (already isometric). Only add map offsets + elevation lift.

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

/* --------------------- Biome helpers --------------------- */
function resolveBiome(scene, mapData) {
  return scene?.hexMap?.worldMeta?.biome ||
         mapData?.__worldMeta?.biome ||
         'Temperate Biome';
}
function treeEmojiFor(biome, tileType) {
  if (tileType === 'volcano_ash') return '🌴';
  if (tileType === 'sand')        return '🌴';
  if (tileType === 'swamp')       return '🌳';
  if (tileType === 'ice' || tileType === 'snow') return '🌲';
  const b = (biome || '').toLowerCase();
  if (b.includes('volcan'))  return '🌴';
  if (b.includes('desert'))  return '🌴';
  if (b.includes('icy'))     return '🌲';
  if (b.includes('swamp'))   return '🌳';
  return '🌳';
}
function outlineColorFor(biome) {
  const b = (biome || '').toLowerCase();
  if (b.includes('icy'))     return 0x1e88e5; // blue
  if (b.includes('volcan'))  return 0xd32f2f; // red
  if (b.includes('desert'))  return 0xfdd835; // yellow
  if (b.includes('swamp'))   return 0x4e342e; // dark brown
  return 0x43a047; // temperate green
}

/* ================= Placement & flags (POIs) ================= */
function placeLocations(mapData, width, height, rnd) {
  for (const t of mapData) {
    if (t.type === 'water') {
      t.hasForest = t.hasRuin = t.hasCrashSite = t.hasVehicle = false;
      t.hasMountainIcon = false;
      continue;
    }
    const elev = typeof t.elevation === 'number' ? t.elevation : 0;
    t.hasMountainIcon = (elev === 4);

    if (t.type === 'forest') t.hasForest = true;
    else if (!t.hasForest && chance(rnd, 0.06)) t.hasForest = true;

    if (!t.hasRuin && t.type !== 'mountain' && chance(rnd, 0.010)) t.hasRuin = true;
    if (!t.hasCrashSite && chance(rnd, 0.006)) t.hasCrashSite = true;

    if (!t.hasVehicle &&
        (t.type === 'plains' || t.type === 'desert' || t.type === 'sand' || t.type === 'grassland' || t.type === '') &&
        chance(rnd, 0.008)) {
      t.hasVehicle = true;
    }
  }

  // forest spreading
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
      const eastish = (i === 0 || i === 1 || i === 5) ? 0.6 : 0;
      const score = eastish + (rnd() - 0.5) * 0.2;
      if (score > bestScore) { best = { n, dir: i }; bestScore = score; }
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

/* ----------------- geo-object helpers (renderer-side) ----------------- */
function buildCellsIfMissing(meta, map, width, height) {
  if (Array.isArray(meta.geoCells) && meta.geoCells.length) return meta.geoCells.slice();

  const type = meta.geoLandmark?.type || '';
  const center = meta.geoLandmark ? map.find(t => t.q === meta.geoLandmark.q && t.r === meta.geoLandmark.r) : null;
  if (!center) return [];

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const want = (type === 'plateau') ? 6 : 9;

  const pred = (t) => {
    if (!t) return false;
    if (type === 'glacier') return (t.type !== 'mountain'); // allow water; convert later
    if (type === 'desert')  return (t.type !== 'water');
    if (type === 'bog')     return (t.type !== 'mountain');
    if (type === 'plateau') return true;
    if (type === 'volcano') return true;
    return true;
  };

  const q = [center];
  const seen = new Set([keyOf(center.q, center.r)]);
  const cells = [];
  while (q.length && cells.length < want) {
    const cur = q.shift();
    if (pred(cur)) cells.push({ q: cur.q, r: cur.r });
    for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
      const nq = cur.q + dq, nr = cur.r + dr, k = keyOf(nq, nr);
      if (seen.has(k) || !byKey.has(k)) continue;
      seen.add(k); q.push(byKey.get(k));
    }
  }
  return cells;
}
function centroidOf(cells) {
  if (!cells || !cells.length) return null;
  const sx = cells.reduce((s, c) => s + c.q, 0);
  const sy = cells.reduce((s, c) => s + c.r, 0);
  return { q: sx / cells.length, r: sy / cells.length };
}
function closestTileTo(map, target, predicate = () => true) {
  let best = null, bd = Infinity;
  for (const t of map) {
    if (!predicate(t)) continue;
    const d = (t.q - target.q) * (t.q - target.q) + (t.r - target.r) * (t.r - target.r);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/* ---- recompute highlight tiles every draw, based on current map ---- */
function computeHighlightCells(map, lm, geoCells) {
  const out = [];
  if (!lm) return out;
  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const add = (q, r) => out.push({ q, r });

  if (lm.type === 'volcano') {
    const center = byKey.get(keyOf(lm.q, lm.r));
    if (center) {
      for (const [dq, dr] of neighborsOddR(center.q, center.r)) {
        const n = byKey.get(keyOf(center.q + dq, center.r + dr));
        if (n && n.type === 'volcano_ash') add(n.q, n.r);
      }
    }
  } else if (lm.type === 'plateau') {
    for (const c of geoCells) {
      const t = byKey.get(keyOf(c.q, c.r));
      if (t && t.elevation === 3) add(c.q, c.r);
    }
  } else if (lm.type === 'desert') {
    for (const c of geoCells) {
      const t = byKey.get(keyOf(c.q, c.r));
      if (t && t.type === 'sand') add(c.q, c.r);
    }
  } else if (lm.type === 'bog') {
    for (const c of geoCells) {
      const t = byKey.get(keyOf(c.q, c.r));
      if (t && t.type === 'swamp') add(c.q, c.r);
    }
  } else if (lm.type === 'glacier') {
    for (const c of geoCells) {
      const t = byKey.get(keyOf(c.q, c.r));
      if (t && t.type === 'ice') add(c.q, c.r);
    }
  }
  return out;
}

/* ------------------------- rendering core ------------------------- */

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
  if (scene.geoOutlineGraphics) scene.geoOutlineGraphics.destroy();

  const roads = scene.add.graphics({ x: 0, y: 0 }).setDepth(30);
  const layer = scene.add.container(0, 0).setDepth(40);

  // High depth so outlines sit above tiles/roads/icons
  const geoOutline = scene.add.graphics({ x: 0, y: 0 }).setDepth(120);
  geoOutline.clear();
  geoOutline.lineStyle(4, 0xffffff, 1); // temp; real color set below

  scene.roadsGraphics = roads;
  scene.locationsLayer = layer;
  scene.geoOutlineGraphics = geoOutline;

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));

  const offsetX = this.mapOffsetX || 0;
  const offsetY = this.mapOffsetY || 0;
  const LIFT    = this?.LIFT_PER_LVL ?? 4;

  // ---- Roads
  for (const t of map) {
    if (!t.roadLinks || !t.roadLinks.size) continue;
    const c1 = scene.hexToPixel(t.q, t.r, size);
    const y1 = c1.y - LIFT * effectiveElevationLocal(t);
    for (const target of t.roadLinks) {
      if (target <= keyOf(t.q, t.r)) continue;
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

  const biomeName = resolveBiome(scene, map);
  const meta = scene?.hexMap?.worldMeta || map.__worldMeta || {};

  // ----- Build/Mutate geo object ONCE -----
  if (!map.__geoBuilt) {
    let lm = meta.geoLandmark;
    if (!lm) {
      const any = map.find(t => t.type !== 'water') || map[0];
      lm = any ? { q:any.q, r:any.r, emoji:'🌄', type:'plateau', label:'Plateau' } : null;
    }

    // Start with base footprint (9 or 6 cells)
    const baseCells = buildCellsIfMissing({ geoLandmark: lm, geoCells: meta.geoCells }, map, this.mapWidth, this.mapHeight);
    const byKeyLocal = new Map(map.map(t => [keyOf(t.q, t.r), t]));
    const baseSet = new Set(baseCells.map(c => keyOf(c.q, c.r)));

    // Set that will suppress POIs (actual affected tiles)
    const noPOISet = new Set();

    // Volcano: ensure level-4 mountain center & neighbors -> ash
    if (lm && lm.type === 'volcano') {
      let center = map.find(t => t.q === lm.q && t.r === lm.r);
      const isPeak = (t) => t && (t.type === 'mountain' || t.hasMountainIcon || t.elevation === 4);
      if (!isPeak(center)) {
        const target = closestTileTo(
          map,
          center || { q: (this.mapWidth||25)/2, r:(this.mapHeight||25)/2 },
          t => t.type === 'mountain' || t.elevation === 4
        );
        center = target || center;
      }
      if (center) {
        center.type = 'mountain';
        center.elevation = 4;
        center.hasMountainIcon = false; // suppress mountain icon, show 🌋 instead
        lm.q = center.q; lm.r = center.r;
        noPOISet.add(keyOf(center.q, center.r));
        for (const [dq, dr] of neighborsOddR(center.q, center.r)) {
          const n = byKeyLocal.get(keyOf(center.q + dq, center.r + dr));
          if (!n) continue;
          if (n.type !== 'water' && n.type !== 'mountain') n.type = 'volcano_ash';
          n.hasForest = n.hasRuin = n.hasCrashSite = n.hasVehicle = false;
          n.hasMountainIcon = false;
          noPOISet.add(keyOf(n.q, n.r));
        }
      }
    }

    // Glacier: convert footprint (including water) to ice
    if (lm && lm.type === 'glacier') {
      for (const c of baseCells) {
        const t = byKeyLocal.get(keyOf(c.q, c.r));
        if (!t) continue;
        t.type = 'ice';
        t.hasForest = t.hasRuin = t.hasCrashSite = t.hasVehicle = false;
        t.hasMountainIcon = false;
        noPOISet.add(keyOf(t.q, t.r));
      }
    }

    // Plateau: 6 tiles elevation 3; (ring lowering left out of footprint)
    if (lm && lm.type === 'plateau') {
      for (const c of baseCells) {
        const t = byKeyLocal.get(keyOf(c.q, c.r));
        if (!t) continue;
        t.type = 'grassland';
        t.elevation = 3;
        t.hasMountainIcon = false;
        t.hasForest = t.hasRuin = t.hasCrashSite = t.hasVehicle = false;
        noPOISet.add(keyOf(t.q, t.r));
      }
    }

    // Desert / Bog
    if (lm && (lm.type === 'desert' || lm.type === 'bog')) {
      const target = lm.type === 'desert' ? 'sand' : 'swamp';
      for (const c of baseCells) {
        const t = byKeyLocal.get(keyOf(c.q, c.r));
        if (!t) continue;
        t.type = target;
        t.hasForest = t.hasRuin = t.hasCrashSite = t.hasVehicle = false;
        t.hasMountainIcon = false;
        noPOISet.add(keyOf(t.q, t.r));
      }
    }

    // Center for label/emoji: volcano uses peak; others use centroid of base footprint
    const centerAxial = (lm && lm.type === 'volcano')
      ? { q: lm.q, r: lm.r }
      : centroidOf(baseCells);
    const centerTile = centerAxial
      ? closestTileTo(map, centerAxial, tt => tt.type !== 'water')
      : map.find(t => t.q === lm.q && t.r === lm.r);

    Object.defineProperty(map, '__geoLandmark',   { value: lm,           enumerable: false });
    Object.defineProperty(map, '__geoCells',      { value: baseCells,    enumerable: false }); // keep original footprint
    Object.defineProperty(map, '__geoNoPOISet',   { value: noPOISet,     enumerable: false }); // tiles to suppress icons
    Object.defineProperty(map, '__geoCenterTile', { value: centerTile||null, enumerable: false });
    Object.defineProperty(map, '__geoBuilt',      { value: true,         enumerable: false });
  }

  // ---- Landmark emoji + label once
  if (!map.__geoDecorAdded && map.__geoLandmark && map.__geoCenterTile) {
    const lm = map.__geoLandmark;
    const ct = map.__geoCenterTile;
    const p = this.hexToPixel(ct.q, ct.r, size);
    const px = p.x + offsetX;
    const py = p.y + offsetY - LIFT * effectiveElevationLocal(ct);
    const emoji = lm.emoji || (
      lm.type === 'volcano' ? '🌋' :
      lm.type === 'glacier' ? '❄️' :
      lm.type === 'desert'  ? '🌵' :
      lm.type === 'bog'     ? '🌾' :
      '🌄'
    );
    const label = lm.label || (
      lm.type === 'volcano' ? 'Volcano' :
      lm.type === 'glacier' ? 'Glacier' :
      lm.type === 'desert'  ? 'Dune Field' :
      lm.type === 'bog'     ? 'Bog' :
      'Plateau'
    );

    addEmoji(px, py, emoji, Math.max(16, size * 0.95), 200);
    const txt = scene.add.text(px, py + size * 0.9, label, {
      fontSize: `${Math.max(12, size * 0.55)}px`,
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.35)',
      padding: { left: 4, right: 4, top: 2, bottom: 2 }
    }).setOrigin(0.5).setDepth(200);
    scene.locationsLayer.add(txt);

    Object.defineProperty(map, '__geoDecorAdded', { value: true, enumerable: false });
  }

  // ---- Draw outlines each frame from current state
  {
    geoOutline.clear();
    const lm   = map.__geoLandmark;
    const base = map.__geoCells || [];
    const col  = outlineColorFor(biomeName);

    const highlightCells = computeHighlightCells(map, lm, base);
    geoOutline.lineStyle(4, col, 0.98);

    for (const c of highlightCells) {
      const t = byKey.get(keyOf(c.q, c.r)); if (!t) continue;
      const center = this.hexToPixel(t.q, t.r, size);
      const cx = center.x + offsetX;
      const cy = center.y + offsetY - LIFT * effectiveElevationLocal(t);
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const ang = Phaser.Math.DegToRad(60 * i - 30);
        pts.push({ x: cx + size * Math.cos(ang), y: cy + size * Math.sin(ang) });
      }
      geoOutline.beginPath();
      geoOutline.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 6; i++) geoOutline.lineTo(pts[i].x, pts[i].y);
      geoOutline.closePath();
      geoOutline.strokePath();
    }
  }

  const noPOISet = map.__geoNoPOISet;

  // ---- Per-tile POIs (skip geo-object affected tiles entirely)
  for (const t of map) {
    if (t.type === 'water') continue;
    if (noPOISet && noPOISet.has(keyOf(t.q, t.r))) continue;

    const c = scene.hexToPixel(t.q, t.r, size);
    const cx = c.x + offsetX;
    const cy = c.y + offsetY - LIFT * effectiveElevationLocal(t);

    if (!t.hasMountainIcon) {
      const elev = typeof t.elevation === 'number' ? t.elevation : 0;
      if (elev === 4) t.hasMountainIcon = true;
    }
    if (t.hasMountainIcon) {
      addEmoji(cx, cy, '⛰️', size * 0.9, 110);
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
        const tree = addEmoji(posX, posY, treeGlyph, fontPx, 105);
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

    if (t.hasRuin)      addEmoji(cx, cy, '🏚️', size * 0.8, 106);
    if (t.hasCrashSite) addEmoji(cx, cy, '🚀', size * 0.8, 106);
    if (t.hasVehicle)   addEmoji(cx, cy, '🚙', size * 0.8, 106);
  }
}

export default {
  applyLocationFlags,
  drawLocationsAndRoads,
};
