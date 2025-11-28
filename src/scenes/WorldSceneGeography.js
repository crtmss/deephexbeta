// src/scenes/WorldSceneGeography.js
// Geo objects (volcano / plateau / glacier / bog/desert) + their UI/overlay
// This module mutates map tiles for the chosen landmark, stores private
// metadata on the map object, draws an emoji+label once, and draws a
// per-frame outline (highlight) of the bound tiles.
//
// It is imported and invoked from WorldSceneMapLocations.js.

///////////////////////////////
// Small utils (duplicate of neighborsOddR to avoid circular deps)
///////////////////////////////
const keyOf = (q, r) => `${q},${r}`;
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

///////////////////////////////
// Biome helpers (exported where useful)
///////////////////////////////
export function resolveBiome(scene, mapData) {
  return scene?.hexMap?.worldMeta?.biome ||
         mapData?.__worldMeta?.biome ||
         'Temperate Biome';
}
export function outlineColorFor(biome) {
  const b = (biome || '').toLowerCase();
  if (b.includes('icy'))     return 0x1e88e5; // blue
  if (b.includes('volcan'))  return 0xd32f2f; // red
  if (b.includes('desert'))  return 0xfdd835; // yellow
  if (b.includes('swamp'))   return 0x4e342e; // dark brown
  return 0x43a047; // temperate green
}

// Lift helper used by both roads and geo overlay
export function effectiveElevationLocal(tile) {
  if (!tile || tile.type === 'water') return 0;
  const e = typeof tile.elevation === 'number' ? tile.elevation : 0;
  return Math.max(0, e - 1);
}

///////////////////////////////
// Footprint builders
///////////////////////////////
function buildCellsIfMissing(meta, map, width, height) {
  if (Array.isArray(meta.geoCells) && meta.geoCells.length) return meta.geoCells.slice();

  const type = meta.geoLandmark?.type || '';
  let center = null;

  // If q/r present, use them
  if (Number.isInteger(meta.geoLandmark?.q) && Number.isInteger(meta.geoLandmark?.r)) {
    center = map.find(t => t.q === meta.geoLandmark.q && t.r === meta.geoLandmark.r);
  }

  // Otherwise pick a sensible land-ish center
  if (!center) {
    const land = map.filter(t => t.type !== 'water');
    const cx = land.reduce((s, t) => s + t.q, 0) / Math.max(1, land.length);
    const cy = land.reduce((s, t) => s + t.r, 0) / Math.max(1, land.length);

    const prefer = (pred) => {
      let best = null, bd = Infinity;
      for (const t of map) {
        if (!pred(t)) continue;
        const d = (t.q - cx) * (t.q - cx) + (t.r - cy) * (t.r - cy);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    };

    if (type === 'volcano') {
      center = prefer(t => t.type === 'mountain' || t.elevation === 4) || prefer(t => t.type !== 'water');
    } else if (type === 'glacier') {
      center = prefer(t => t.type !== 'mountain');
    } else if (type === 'desert') {
      center = prefer(t => t.type !== 'water');
    } else if (type === 'bog') {
      center = prefer(t => t.type !== 'mountain');
    } else {
      center = prefer(t => t.type !== 'water');
    }
    if (!center) return [];
    meta.geoLandmark.q = center.q;
    meta.geoLandmark.r = center.r;
  }

  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const want = (type === 'plateau') ? 6 : 9;

  const pred = (t) => {
    if (!t) return false;
    if (type === 'glacier') return (t.type !== 'mountain'); // can include water, will be converted
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

///////////////////////////////
// Landmark creation + mutation
///////////////////////////////
function landmarkFromBiome(biome) {
  const b = (biome || '').toLowerCase();
  if (b.includes('icy'))     return { type: 'glacier', emoji: '❄️', label: 'Glacier' };
  if (b.includes('volcan'))  return { type: 'volcano', emoji: '🌋', label: 'Volcano' };
  if (b.includes('desert'))  return { type: 'desert',  emoji: '🌵', label: 'Dune Field' };
  if (b.includes('swamp'))   return { type: 'bog',     emoji: '🌾', label: 'Bog' };
  return { type: 'plateau',   emoji: '🌄', label: 'Plateau' };
}

/**
 * Initializes (or reuses) the geo landmark on the map and mutates tiles accordingly.
 * Stores private metadata on the map:
 *   __geoLandmark, __geoCells, __geoNoPOISet, __geoCenterTile, __geoBuilt
 */
export function initOrUpdateGeography(scene, map) {
  if (!Array.isArray(map) || !map.length) return;

  const meta = scene?.hexMap?.worldMeta || map.__worldMeta || {};
  const biomeName = resolveBiome(scene, map);

  if (!map.__geoBuilt) {
    let lm = meta.geoLandmark;
    if (!lm || !lm.type) lm = { ...landmarkFromBiome(biomeName) };

    // Ensure center q/r
    if (!Number.isInteger(lm.q) || !Number.isInteger(lm.r)) {
      const proxyMeta = { geoLandmark: { ...lm } };
      const tmp = buildCellsIfMissing(proxyMeta, map, scene.mapWidth, scene.mapHeight);
      lm.q = proxyMeta.geoLandmark.q;
      lm.r = proxyMeta.geoLandmark.r;
    }

    // Base footprint
    const baseCells = buildCellsIfMissing({ geoLandmark: lm, geoCells: meta.geoCells }, map, scene.mapWidth, scene.mapHeight);
    const byKeyLocal = new Map(map.map(t => [keyOf(t.q, t.r), t]));
    const noPOISet = new Set();

    // Volcano: force peak + surrounding ash
    if (lm && lm.type === 'volcano') {
      let center = map.find(t => t.q === lm.q && t.r === lm.r);
      const isPeak = (t) => t && (t.type === 'mountain' || t.elevation === 4);
      if (!isPeak(center)) {
        const target = closestTileTo(
          map,
          center || { q: (scene.mapWidth||25)/2, r:(scene.mapHeight||25)/2 },
          t => t.type === 'mountain' || t.elevation === 4
        );
        center = target || center;
      }
      if (center) {
        center.type = 'mountain';
        center.elevation = 4;
        center.hasMountainIcon = false;
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

    // Glacier: convert footprint to ice
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

    // Plateau: elevation 3 grassland footprint
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

    // Center for emoji/label
    const centerAxial = (lm && lm.type === 'volcano')
      ? { q: lm.q, r: lm.r }
      : centroidOf(baseCells);
    const centerTile = centerAxial
      ? closestTileTo(map, centerAxial, tt => tt.type !== 'water')
      : map.find(t => t.q === lm.q && t.r === lm.r);

    Object.defineProperty(map, '__geoLandmark',   { value: lm,        enumerable: false });
    Object.defineProperty(map, '__geoCells',      { value: baseCells, enumerable: false });
    Object.defineProperty(map, '__geoNoPOISet',   { value: noPOISet,  enumerable: false });
    Object.defineProperty(map, '__geoCenterTile', { value: centerTile || null, enumerable: false });
    Object.defineProperty(map, '__geoBuilt',      { value: true,      enumerable: false });
  }
}

/** Pick cells to outline based on current tile states. */
export function computeHighlightCells(map, lm, geoCells) {
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

/** Draw (or update) emoji+label once and per-frame hex outlines. */
export function drawGeographyOverlay(scene) {
  const map = scene.mapData;
  if (!Array.isArray(map) || !map.length) return;

  const size    = scene.hexSize || 24;
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT    = scene?.LIFT_PER_LVL ?? 4;

  const biomeName = resolveBiome(scene, map);

  // -----------------------------
  // Emoji + label (once)
  // -----------------------------
  if (!map.__geoDecorAdded && map.__geoLandmark && map.__geoCenterTile) {
    const lm = map.__geoLandmark;
    const ct = map.__geoCenterTile;

    // Use same transform as tiles: axialToWorld if available, else fallback
    let px, py;
    if (scene.axialToWorld) {
      const p = scene.axialToWorld(ct.q, ct.r);
      px = p.x;
      py = p.y;
    } else {
      const p = scene.hexToPixel(ct.q, ct.r, size);
      px = p.x + offsetX;
      py = p.y + offsetY - LIFT * effectiveElevationLocal(ct);
    }

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

    const icon = scene.add.text(px, py, emoji, {
      fontSize: `${Math.max(16, size * 0.95)}px`,
      fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    }).setOrigin(0.5).setDepth(200);

    const txt = scene.add.text(px, py + size * 0.9, label, {
      fontSize: `${Math.max(12, size * 0.55)}px`,
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.35)',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    }).setOrigin(0.5).setDepth(200);

    scene.locationsLayer?.add(txt);

    // Click → hex-inspect
    const sendHexInspect = (header, bodyLines) => {
      const text = `[HEX INSPECT] ${header}\n` +
        (Array.isArray(bodyLines) ? bodyLines.join('\n') : '');
      if (scene?.events && typeof scene.events.emit === 'function') {
        scene.events.emit('hex-inspect', text);
      } else {
        console.log(text);
      }
    };

    icon.setInteractive({ useHandCursor: true });
    icon.on('pointerdown', () => {
      const base = map.__geoCells || [];
      const highlight = computeHighlightCells(map, lm, base);
      const listed = highlight.map(c => {
        const t = map.find(tt => tt.q === c.q && tt.r === c.r);
        const lvl = (t && typeof t.elevation === 'number') ? t.elevation : 0;
        const tp  = t ? t.type : '?';
        return `(${c.q},${c.r}) — ${tp}, lvl ${lvl}`;
      });
      const header = `${label} @ (${ct.q},${ct.r}) — bound tiles: ${listed.length}`;
      sendHexInspect(header, listed);
    });

    Object.defineProperty(map, '__geoDecorAdded', { value: true, enumerable: false });
  }

  // -----------------------------
  // Hex outlines (each frame)
  // -----------------------------
  if (scene.geoOutlineGraphics) scene.geoOutlineGraphics.clear();
  const col = outlineColorFor(biomeName);
  const g   = scene.geoOutlineGraphics || scene.add.graphics({ x: 0, y: 0 }).setDepth(120);
  if (!scene.geoOutlineGraphics) scene.geoOutlineGraphics = g;

  const lm    = map.__geoLandmark;
  const base  = map.__geoCells || [];
  const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
  const highlightCells = computeHighlightCells(map, lm, base);

  g.clear();
  g.lineStyle(4, col, 0.98);

  for (const c of highlightCells) {
    const t = byKey.get(keyOf(c.q, c.r));
    if (!t) continue;

    // Center of hex in world space: prefer axialToWorld
    let cx, cy;
    if (scene.axialToWorld) {
      const p = scene.axialToWorld(t.q, t.r);
      cx = p.x;
      cy = p.y;
    } else {
      const center = scene.hexToPixel(t.q, t.r, size);
      cx = center.x + offsetX;
      cy = center.y + offsetY - LIFT * effectiveElevationLocal(t);
    }

    const pts = [];
    for (let i = 0; i < 6; i++) {
      const ang = Phaser.Math.DegToRad(60 * i - 30); // pointy-top
      pts.push({
        x: cx + size * Math.cos(ang),
        y: cy + size * Math.sin(ang),
      });
    }

    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.strokePath();
  }
}

/** Returns the set of tiles suppressed for POIs (bound to the geo footprint). */
export function getNoPOISet(map) {
  return map?.__geoNoPOISet || null;
}

export default {
  resolveBiome,
  outlineColorFor,
  effectiveElevationLocal,
  initOrUpdateGeography,
  drawGeographyOverlay,
  computeHighlightCells,
  getNoPOISet,
};
