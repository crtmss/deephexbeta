// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   Centralized building logic.
   Button "Docks" => auto-places 🚢 Docks on a nearby water hex.
   Search order:
     1) Direct ring-1 water around selected unit.
     2) Coastal water adjacent to any ring-1 land tile.
     3) Nearest water within radius 3 (fallback).
   Always prints a console message with building type and hex placed.
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
  zBuilding: 2100, // over terrain/roads
};

export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '🚢', // :ship:
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t || t.type !== 'water') return false;
      const u = scene.selectedUnit;
      if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return false;
      if (Array.isArray(scene.buildings) && scene.buildings.some(b => b.q === q && b.r === r)) return false;
      return true;
    },
  },
};

/* =========================
   Public API
   ========================= */

export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  const u = scene.selectedUnit;
  if (!u) {
    console.warn('[BUILD] Docks: no unit selected.');
    return;
  }

  // 1) Direct ring-1 water
  const ring1Water = _neighbors(u.q, u.r)
    .filter(({ q, r }) => _isWater(scene, q, r))
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

  if (ring1Water.length > 0) {
    const pick = _getRandom(ring1Water, scene);
    _placeBuilding(scene, BUILDINGS.docks, pick.q, pick.r, 'ring-1 water');
    return;
  }

  // 2) Coastal water adjacent to any ring-1 land tile
  const coastal = _computeCoastalWater(scene, u.q, u.r);
  if (coastal.length > 0) {
    const pick = _getRandom(coastal, scene);
    _placeBuilding(scene, BUILDINGS.docks, pick.q, pick.r, 'coastal water');
    return;
  }

  // 3) Fallback: nearest water within radius 3
  const nearest = _nearestWaterWithin(scene, u.q, u.r, 3);
  if (nearest) {
    _placeBuilding(scene, BUILDINGS.docks, nearest.q, nearest.r, 'fallback radius≤3');
    return;
  }

  // Debug help
  const ringReport = _neighbors(u.q, u.r)
    .map(({ q, r }) => {
      const t = _tileAt(scene, q, r);
      return `(${q},${r}:${t ? t.type : 'off'})`;
    })
    .join(' ');
  console.warn('[BUILD] Docks: no nearby water. Adjacent ring:', ringReport);
}

export function cancelPlacement() {} // no-op (kept for compatibility)

export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeBuilding(scene, BUILDINGS.docks, q, r, 'direct place');
}

/* =========================
   Internal helpers
   ========================= */

function _placeBuilding(scene, buildingDef, q, r, reason = '') {
  if (!buildingDef.validateTile(scene, q, r)) {
    console.warn(`[BUILD] ${buildingDef.name}: invalid placement at (${q},${r}).`);
    return;
  }

  scene.buildings = scene.buildings || [];
  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  // Label first so we can size the textbox
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

  // REQUIRED LOG:
  console.log(`[BUILD] ${buildingDef.name} placed at (${q},${r}) ${reason ? `— ${reason}` : ''}`);
}

function _computeCoastalWater(scene, uq, ur) {
  const out = [];
  const seen = new Set();

  const landNeighbors = _neighbors(uq, ur)
    .filter(({ q, r }) => {
      const t = _tileAt(scene, q, r);
      return t && t.type !== 'water';
    });

  for (const ln of landNeighbors) {
    const aroundLand = _neighbors(ln.q, ln.r)
      .filter(({ q, r }) => _isWater(scene, q, r))
      .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

    for (const w of aroundLand) {
      const k = `${w.q},${w.r}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(w);
      }
    }
  }
  return out;
}

function _nearestWaterWithin(scene, uq, ur, radius = 3) {
  for (let r = 1; r <= radius; r++) {
    const ring = _ring(uq, ur, r).filter(({ q, r }) => _isWater(scene, q, r));
    const valid = ring.filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));
    if (valid.length > 0) return valid[0];
  }
  return null;
}

/* ---------- geometry / grid utils ---------- */

function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}
function _isWater(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && t.type === 'water';
}
function _neighbors(q, r) {
  return AXIAL_DIRS.map(d => ({ q: q + d.dq, r: r + d.dr }));
}
function _ring(q, r, radius) {
  if (radius <= 0) return [{ q, r }];
  const results = [];
  let cq = q + AXIAL_DIRS[4].dq * radius;
  let cr = r + AXIAL_DIRS[4].dr * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push({ q: cq, r: cr });
      cq += AXIAL_DIRS[side].dq;
      cr += AXIAL_DIRS[side].dr;
    }
  }
  return results;
}
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
