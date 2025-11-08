// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   Building logic (centralized).
   "Docks" spawns automatically on a WATER hex that is adjacent to any LAND
   hex adjacent to the selected unit (base → land neighbor → water).
   This covers both: standing on coast (distance 1 to water) and 1 hex inland
   (distance 2 to water through the coastal land tile).
   ======================================================================= */

const COLORS = {
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  labelText: '#e8f6ff',
};

const UI = {
  labelFontSize: 16,
  boxRadius: 8,
  boxStrokeAlpha: 0.9,
  zBuilding: 900,
};

export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '🚢', // :ship:
    // Valid if it's a water tile that is adjacent to any land tile
    // which itself is adjacent to the selected unit.
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t || t.type !== 'water') return false;

      const u = scene.selectedUnit;
      if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return false;

      // must be adjacent to any land neighbor of the unit
      const landNeighbors = _neighbors(u.q, u.r)
        .map(({q: nq, r: nr}) => _tileAt(scene, nq, nr) ? { q: nq, r: nr, tile: _tileAt(scene, nq, nr) } : null)
        .filter(Boolean)
        .filter(({tile}) => tile.type !== 'water'); // landlike (any non-water)

      for (const ln of landNeighbors) {
        if (_axialDistance(ln.q, ln.r, q, r) === 1) {
          return true;
        }
      }
      return false;
    },
  },
};

/* =========================
   Public API
   ========================= */

export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  if (!scene.selectedUnit) {
    console.warn('[Docks] No unit selected.');
    return;
  }

  const candidates = _computeDockCandidates(scene);

  if (candidates.length === 0) {
    const u = scene.selectedUnit;
    const ring = _neighbors(u.q, u.r)
      .map(({q, r}) => {
        const n = _tileAt(scene, q, r);
        return `(${q},${r}:${n ? n.type : 'off'})`;
      })
      .join(' ');
    console.warn('[Docks] No valid coastal water found. Adjacent ring:', ring);
    return;
  }

  const pick = _getRandom(candidates, scene);
  _placeBuilding(scene, BUILDINGS.docks, pick.q, pick.r);
}

export function cancelPlacement() {} // no-op (kept for compatibility)

export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeBuilding(scene, BUILDINGS.docks, q, r);
}

/* =========================
   Internal helpers
   ========================= */

function _computeDockCandidates(scene) {
  const out = [];
  const u = scene.selectedUnit;
  if (!u) return out;

  // 1) all landlike tiles around the unit (distance 1 that are not water)
  const landNeighbors = _neighbors(u.q, u.r)
    .map(({q, r}) => ({ q, r, tile: _tileAt(scene, q, r) }))
    .filter(({tile}) => tile && tile.type !== 'water');

  // 2) for each such land tile, look at its adjacent water tiles
  const seen = new Set();
  for (const ln of landNeighbors) {
    for (const w of _neighbors(ln.q, ln.r)) {
      const t = _tileAt(scene, w.q, w.r);
      if (!t || t.type !== 'water') continue;

      // must also pass validator (prevents duplicates / future rules)
      if (!BUILDINGS.docks.validateTile(scene, w.q, w.r)) continue;

      const k = `${w.q},${w.r}`;
      // avoid placing on an already occupied building tile
      const occupied = Array.isArray(scene.buildings)
        ? scene.buildings.some(b => b.q === w.q && b.r === w.r)
        : false;
      if (occupied) continue;

      if (!seen.has(k)) {
        seen.add(k);
        out.push({ q: w.q, r: w.r });
      }
    }
  }
  return out;
}

function _placeBuilding(scene, buildingDef, q, r) {
  if (!buildingDef.validateTile(scene, q, r)) {
    console.warn(`[${buildingDef.name}] Invalid placement at (${q},${r}).`);
    return;
  }

  scene.buildings = scene.buildings || [];
  const already = scene.buildings.some(b => b.q === q && b.r === r);
  if (already) {
    console.warn(`[${buildingDef.name}] A building already exists at (${q},${r}).`);
    return;
  }

  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const label = scene.add.text(0, 0, `${buildingDef.emoji}  ${buildingDef.name}`, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText,
  }).setOrigin(0.5);

  const pad = 6;
  const w = Math.max(64, label.width + pad * 2);
  const h = Math.max(26, label.height + pad * 2);

  const box = scene.add.graphics();
  box.fillStyle(COLORS.plate, 0.92);
  box.fillRoundedRect(-w / 2, -h / 2, w, h, UI.boxRadius);
  box.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  box.strokeRoundedRect(-w / 2, -h / 2, w, h, UI.boxRadius);

  container.add([box, label]);

  scene.buildings.push({
    type: buildingDef.key,
    name: buildingDef.name,
    emoji: buildingDef.emoji,
    q, r,
    containerId: container.id,
  });

  console.log(`[${buildingDef.name}] placed at (${q},${r}).`);
}

/* ---------- utilities ---------- */

function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}

function _neighbors(q, r) {
  return AXIAL_DIRS.map(d => ({ q: q + d.dq, r: r + d.dr }));
}

// axial distance (cube)
function _axialDistance(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

const AXIAL_DIRS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];

function _getRandom(arr, scene) {
  if (scene?.game?.renderer && Phaser?.Utils?.Array?.GetRandom) {
    return Phaser.Utils.Array.GetRandom(arr);
  }
  return arr[Math.floor(Math.random() * arr.length)];
}
