// src/scenes/WorldSceneBuildings.js
//
// Buildings module (single-hex Docks + menu)
//
// This file only handles:
// - Docks registry + validation (single hex, must be coastal)
// - Docks placement (framed ⚓ + plain "Docks" label underneath)
// - Docks context menu + overlay
// - Minimal resource helpers used for build costs
// - Destroy building cleanup
//
// Ship/Hauler logic, storage labels, route picking, cyan paths, etc. live in:
//   src/scenes/WorldSceneHaulers.js
//
// Required imports from Haulers module:
import {
  buildShipForDocks,
  openDocksRoutePicker,
  recallShipsToDocks,
  ensureDocksStoreLabel,
  updateDocksStoreLabel,
} from './WorldSceneHaulers.js';

///////////////////////////////
// Visual + UI constants
///////////////////////////////
const COLORS = {
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  labelText: '#e8f6ff',
};

const UI = {
  labelFontSize: 16,
  boxStrokeAlpha: 0.9,
  zBuilding: 2100,
  zOverlay: 2290,
  zMenu: 2300,
};

///////////////////////////////
// Costs
///////////////////////////////
const COSTS = {
  docks: { scrap: 20, money: 50 },
};

///////////////////////////////
// Buildings registry (single-hex docks)
///////////////////////////////
export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '⚓',
    /**
     * Single-hex coastal rule:
     * - The hex itself must be land (no water).
     * - It must have at least one adjacent WATER and at least one adjacent LAND neighbor
     *   so both ships and haulers can reach it.
     * - No duplicate docks on the same hex.
     */
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;

      // Docks must be on land (no water tiles)
      if (_isWater(scene, q, r)) return false;

      // Cannot place two docks on the same hex
      if ((scene.buildings || []).some(b => b.type === 'docks' && b.q === q && b.r === r)) return false;

      // Require at least one adjacent WATER and at least one adjacent LAND
      const adj = _offsetNeighbors(q, r)
        .filter(h => h.q >= 0 && h.r >= 0 && h.q < scene.mapWidth && h.r < scene.mapHeight)
        .map(h => ({ ...h, water: _isWater(scene, h.q, h.r) }));

      const hasWaterAdj = adj.some(a => a.water);
      const hasLandAdj  = adj.some(a => !a.water);

      return hasWaterAdj && hasLandAdj;
    },
  },
};

///////////////////////////////
// Public API
///////////////////////////////

/** Place docks on a target hex (limit 2 total).
 *  If hexOverride is omitted, uses the selected unit's hex.
 *  This version is explicit: it always receives the scene as first argument.
 */
export function startDocksPlacement(scene, hexOverride) {
  _ensureResourceInit(scene);

  // resource cost check
  if (!_canAfford(scene, COSTS.docks)) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
  }

  const count = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (count >= 2) {
    console.warn('[BUILD] Docks: limit reached (2). New docks will not spawn.');
    return;
  }

  let target = null;
  if (hexOverride && typeof hexOverride.q === 'number' && typeof hexOverride.r === 'number') {
    target = { q: hexOverride.q, r: hexOverride.r };
  } else if (scene.selectedUnit) {
    target = { q: scene.selectedUnit.q, r: scene.selectedUnit.r };
  }

  if (!target) {
    console.warn('[BUILD] Docks: no valid target hex (no unit selected?).');
    return;
  }

  if (!BUILDINGS.docks.validateTile(scene, target.q, target.r)) {
    console.warn(`[BUILD] Docks: invalid placement at (${target.q},${target.r}).`);
    return;
  }

  if (!_spend(scene, COSTS.docks)) {
    console.warn('[BUILD] Failed to spend resources for Docks.');
    return;
  }

  _placeDocks(scene, target.q, target.r, 'placed via startDocksPlacement');
}

/** Direct placement (if you already have target q,r). */
export function placeDocks(scene, qOrHex, rMaybe) {
  _ensureResourceInit(scene);

  if (!_canAfford(scene, COSTS.docks)) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
  }

  let q, r;
  if (typeof qOrHex === 'object' && qOrHex !== null) {
    q = qOrHex.q;
    r = qOrHex.r;
  } else {
    q = qOrHex;
    r = rMaybe;
  }

  if (typeof q !== 'number' || typeof r !== 'number') {
    console.warn('[BUILD] placeDocks: invalid coordinates', qOrHex, rMaybe);
    return;
  }

  if (!BUILDINGS.docks.validateTile(scene, q, r)) {
    console.warn(`[BUILD] Docks: invalid placement at (${q},${r}).`);
    return;
  }

  if (!_spend(scene, COSTS.docks)) return;

  _placeDocks(scene, q, r, 'direct place');
}

export function cancelPlacement() { /* reserved for future */ }

///////////////////////////////
// Docks placement (single-hex; framed ⚓ + plain text under)
///////////////////////////////
function _placeDocks(scene, q, r, reason = '') {
  const docksCount = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (docksCount >= 2) {
    console.warn('[BUILD] Docks: limit reached (2). New docks will not spawn.');
    return;
  }
  if (!BUILDINGS.docks.validateTile(scene, q, r)) {
    console.warn(`[BUILD] Docks: invalid placement at (${q},${r}).`);
    return;
  }

  scene.buildings = scene.buildings || [];
  scene._buildingIdSeq = (scene._buildingIdSeq || 1) + 1;
  const id = scene._buildingIdSeq;

  const pos = scene.axialToWorld(q, r);
  const cont = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  // --- Framed anchor (background plate + ⚓ on top)
  const plate = scene.add.graphics();
  const plateW = 36, plateH = 36, radius = 8;
  plate.fillStyle(COLORS.plate, 0.92);
  plate.fillRoundedRect(-plateW/2, -plateH/2, plateW, plateH, radius);
  plate.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  plate.strokeRoundedRect(-plateW/2, -plateH/2, plateW, plateH, radius);

  const anchor = scene.add.text(0, 0, '⚓', {
    fontSize: '22px',
    color: '#ffffff'
  }).setOrigin(0.5);

  // --- Plain label under the plate (no background)
  const label = scene.add.text(0, plateH/2 + 10, 'Docks', {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText
  }).setOrigin(0.5, 0);

  // Single hit area (for the building menu)
  const hit = scene.add.rectangle(0, 0, plateW, plateH + 26, 0x000000, 0)
    .setOrigin(0.5).setInteractive({ useHandCursor: true });

  cont.add([plate, anchor, label, hit]);

  const building = {
    id,
    type: BUILDINGS.docks.key,
    name: BUILDINGS.docks.name,
    q, r,
    container: cont,
    routeMarker: null,
    menu: null,
    overlay: null,
    route: null,
    storageFood: 0,
    storageObj: null,
  };

  scene.buildings.push(building);

  // storage label near this hex (delegated to Haulers module)
  ensureDocksStoreLabel(scene, building);
  updateDocksStoreLabel(scene, building);

  const openMenu = (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    _openBuildingMenu(scene, building);
  };
  hit.on('pointerdown', openMenu);

  console.log(`[BUILD] Docks placed at (${q},${r}) — ${reason}`);
}

///////////////////////////////
// Menu (created above the building; overlay disables hex-inspect)
///////////////////////////////
function _openBuildingMenu(scene, building) {
  _closeAnyBuildingMenu(scene, building.id);
  scene.uiLock = 'buildingMenu';

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001
  )
    .setInteractive({ useHandCursor: false })
    .setScrollFactor(0)
    .setDepth(UI.zOverlay);

  overlay.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    _closeBuildingMenu(scene, building);
  });
  building.overlay = overlay;

  // Position menu from the single docks hex
  const midPos = scene.axialToWorld(building.q, building.r);
  const menu = scene.add.container(midPos.x, midPos.y - 56).setDepth(UI.zMenu);
  building.menu = menu;

  const W = 172, H = 172;

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.96);
  bg.fillRoundedRect(-W/2, -H/2, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(-W/2, -H/2, W, H, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  bezel.strokeRect(-W/2 + 16, -H/2 + 16, W - 32, H - 32);
  bezel.strokeRect(-W/2 + 8,  -H/2 + 8,  W - 16, H - 16);

  const btnSize = 70, pad = 8, startX = -W/2 + 12, startY = -H/2 + 12;

  const drawButton = (x, y, label, onClick) => {
    const g = scene.add.graphics();
    g.fillStyle(0x173b52, 1);
    g.fillRoundedRect(x, y, btnSize, btnSize, 8);
    g.lineStyle(2, 0x6fe3ff, 0.7);
    g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
    g.lineStyle(1, 0x6fe3ff, 0.15);
    g.beginPath();
    g.moveTo(x + btnSize/2, y + 6);
    g.lineTo(x + btnSize/2, y + btnSize - 6);
    g.moveTo(x + 6, y + btnSize/2);
    g.lineTo(x + btnSize - 6, y + btnSize/2);
    g.strokePath();

    const t = scene.add.text(x + btnSize/2, y + btnSize/2, label, {
      fontSize: '14px',
      color: '#e8f6ff',
      align: 'center',
      wordWrap: { width: btnSize - 10 }
    }).setOrigin(0.5);

    const hit = scene.add.rectangle(x, y, btnSize, btnSize, 0x000000, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });

    hit.on('pointerover', () => {
      g.clear();
      g.fillStyle(0x1a4764, 1);
      g.fillRoundedRect(x, y, btnSize, btnSize, 8);
      g.lineStyle(2, 0x9be4ff, 1);
      g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
    });
    hit.on('pointerout', () => {
      g.clear();
      g.fillStyle(0x173b52, 1);
      g.fillRoundedRect(x, y, btnSize, btnSize, 8);
      g.lineStyle(2, 0x6fe3ff, 0.7);
      g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
      g.lineStyle(1, 0x6fe3ff, 0.15);
      g.beginPath();
      g.moveTo(x + btnSize/2, y + 6);
      g.lineTo(x + btnSize/2, y + btnSize - 6);
      g.moveTo(x + 6, y + btnSize/2);
      g.lineTo(x + btnSize - 6, y + btnSize/2);
      g.strokePath();
    });

    hit.on('pointerdown', (pointer, lx, ly, event) => {
      event?.stopPropagation?.();
      onClick?.();
    });

    menu.add([g, t, hit]);
  };

  const defs = [
    { text: 'Build a ship', onClick: () => buildShipForDocks(scene, building) },
    { text: 'Set route',    onClick: () => openDocksRoutePicker(scene, building) },
    { text: 'Recall ships', onClick: () => recallShipsToDocks(scene, building) },
    { text: 'Destroy',      onClick: () => _destroyBuilding(scene, building) },
  ];
  for (let i = 0; i < defs.length; i++) {
    const r = Math.floor(i / 2);
    const c = i % 2;
    const x = startX + c * (btnSize + pad);
    const y = startY + r * (btnSize + pad);
    drawButton(x, y, defs[i].text, defs[i].onClick);
  }

  menu.add([bg, bezel]);
  menu.sendToBack(bg); menu.sendToBack(bezel);
  menu.active = true;
}

function _closeAnyBuildingMenu(scene, exceptId) {
  (scene.buildings || []).forEach(b => {
    if (b.menu && b.id !== exceptId) _closeBuildingMenu(scene, b);
  });
}
function _closeBuildingMenu(scene, building) {
  if (building.menu)   { building.menu.destroy(true);   building.menu = null; }
  if (building.overlay){ building.overlay.destroy(true);building.overlay = null; }
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null;
}

///////////////////////////////
// Destroy building
///////////////////////////////
function _destroyBuilding(scene, building) {
  building.container?.destroy(true);
  building.menu?.destroy(true);
  building.overlay?.destroy(true);
  building.storageObj?.destroy(true);
  building.routeMarker?.destroy(true);

  // Detach ships / haulers that referenced this docks
  (scene.ships   || []).forEach(s => { if (s.docksId === building.id)   s.docksId = null; });
  (scene.haulers || []).forEach(h => { if (h.targetDocksId === building.id) h.targetDocksId = null; });

  scene.buildings = (scene.buildings || []).filter(b => b !== building);
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null;
  console.log(`[BUILD] Docks destroyed (id=${building.id}).`);
}

///////////////////////////////
// Minimal resource helpers
///////////////////////////////
function _ensureResourceInit(scene) {
  if (!scene.playerResources) {
    scene.playerResources = { food: 20, scrap: 20, money: 100, influence: 0 };
  }
  scene.updateResourceUI?.();
}
function _canAfford(scene, cost) {
  const r = scene.playerResources || {};
  return Object.entries(cost).every(([k, v]) => (r[k] ?? 0) >= v);
}
function _spend(scene, cost) {
  if (!_canAfford(scene, cost)) return false;
  Object.entries(cost).forEach(([k, v]) => {
    scene.playerResources[k] = (scene.playerResources[k] ?? 0) - v;
    scene.bumpResource?.(k);
  });
  scene.updateResourceUI?.();
  return true;
}

///////////////////////////////
// Tile + neighbor helpers
///////////////////////////////
function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}
function _isWater(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && (t.type === 'water' || t.type === 'ocean' || t.type === 'sea');
}
function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0,-1],[+1,0],[0,+1],[-1,+1],[-1,0],[-1,-1]];
  const odd  = [[+1,-1],[+1,0],[+1,+1],[0,+1],[-1,0],[0,-1]];
  const deltas = isOdd ? odd : even;
  return deltas.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}
function _neighbors(q, r) { return _offsetNeighbors(q, r); }

function _nearestValidWithin(scene, uq, ur, maxRadius, isValid) {
  const key = (q, r) => `${q},${r}`;
  const seen = new Set([key(uq, ur)]);
  const qArr = [{ q: uq, r: ur, dist: 0 }];
  while (qArr.length) {
    const cur = qArr.shift();
    if (cur.dist > maxRadius) break;
    if (!(cur.q === uq && cur.r === ur) && isValid(cur.q, cur.r)) {
      return { q: cur.q, r: cur.r };
    }
    for (const n of _offsetNeighbors(cur.q, cur.r)) {
      if (n.q < 0 || n.r < 0 || n.q >= scene.mapWidth || n.r >= scene.mapHeight) continue;
      const k = key(n.q, n.r);
      if (seen.has(k)) continue;
      seen.add(k);
      qArr.push({ q: n.q, r: n.r, dist: cur.dist + 1 });
    }
  }
  return null;
}

///////////////////////////////
// RNG helpers (local to buildings)
/////////////////////////////////
function _rand(scene) {
  // Use HexMap RNG if available for determinism, else fallback
  return (scene?.hexMap && typeof scene.hexMap.rand === 'function')
    ? scene.hexMap.rand()
    : Math.random;
}

function _getRandom(list, scene) {
  if (!list || list.length === 0) return null;
  const i = Math.floor(_rand(scene) * list.length);
  return list[i];
}

export default {
  BUILDINGS,
  startDocksPlacement,
  placeDocks,
  cancelPlacement,
};
