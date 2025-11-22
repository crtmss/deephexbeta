// src/scenes/WorldSceneBuildings.js
//
// Buildings module
//
// This file handles:
// - Building registry & validation (docks, mine, factory, bunker)
// - Placement helpers (using selected unit's hex by default)
// - Visuals for buildings (framed emoji + name label)
// - Docks context menu + overlay (per-docks ship menu)
// - Minimal resource helpers used for build costs
// - Destroy building cleanup
// - Per-turn production for mines
//
// Ship/Hauler logic, docks storage labels, route picking, cyan paths, etc. live in:
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
  docks:   { scrap: 20, money: 50 },
  mine:    { scrap: 30, money: 20 },
  factory: { scrap: 40, money: 60 },
  bunker:  { scrap: 25, money: 40 },
};

///////////////////////////////
// Buildings registry
///////////////////////////////
export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '⚓',
    /**
     * Single-hex coastal rule:
     * - Hex itself must be land (no water)
     * - Must have at least one adjacent WATER and at least one adjacent LAND neighbor
     * - No other building on same hex
     */
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;

      if (_isWater(scene, q, r)) return false;

      if ((scene.buildings || []).some(b => b.q === q && b.r === r)) return false;

      const adj = _offsetNeighbors(q, r)
        .filter(h => h.q >= 0 && h.r >= 0 && h.q < scene.mapWidth && h.r < scene.mapHeight)
        .map(h => ({ ...h, water: _isWater(scene, h.q, h.r) }));

      const hasWaterAdj = adj.some(a => a.water);
      const hasLandAdj  = adj.some(a => !a.water);

      return hasWaterAdj && hasLandAdj;
    },
  },

  // Mine: ONLY on Ruins POIs
  mine: {
    key: 'mine',
    name: 'Mine',
    emoji: '⛏️',
    /**
     * Mine can only be placed on a Ruins POI.
     * We check multiple likely flags + mapInfo.objects.
     */
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;

      if (!_isRuinPOI(scene, q, r, t)) return false;

      if ((scene.buildings || []).some(b => b.q === q && b.r === r)) return false;

      return true;
    },
  },

  // Factory: anywhere on land (non-water, non-mountain), no other building
  factory: {
    key: 'factory',
    name: 'Factory',
    emoji: '🏭',
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;

      if (_isWater(scene, q, r)) return false;
      if (t.type === 'mountain') return false;

      if ((scene.buildings || []).some(b => b.q === q && b.r === r)) return false;

      return true;
    },
  },

  // Bunker: anywhere on land (non-water, non-mountain), no other building
  bunker: {
    key: 'bunker',
    name: 'Bunker',
    emoji: '🛡️',
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;

      if (_isWater(scene, q, r)) return false;
      if (t.type === 'mountain') return false;

      if ((scene.buildings || []).some(b => b.q === q && b.r === r)) return false;

      return true;
    },
  },
};

///////////////////////////////
// Public API – generic placement
///////////////////////////////

/**
 * Resolve scene + key + optional hexOverride.
 * Supports:
 *   startBuildingPlacement.call(scene, 'mine', {q,r}?)
 *   startBuildingPlacement(scene, 'mine', {q,r}?)
 */
function _resolveSceneKeyAndHex(fnThis, arg1, arg2, arg3) {
  let scene = null;
  let key = null;
  let hexOverride = null;

  // Called as method `.call(scene, key, hex?)`
  if (fnThis && fnThis.sys && fnThis.add) {
    scene = fnThis;
    key = arg1;
    if (arg2 && typeof arg2.q === 'number' && typeof arg2.r === 'number') {
      hexOverride = arg2;
    }
  } else if (arg1 && arg1.sys && arg1.add) {
    // Called as function: fn(scene, key, hex?)
    scene = arg1;
    key = arg2;
    if (arg3 && typeof arg3.q === 'number' && typeof arg3.r === 'number') {
      hexOverride = arg3;
    }
  }

  return { scene, key, hexOverride };
}

/**
 * Given the scene + optional hexOverride, return the target hex.
 * For now: we always place buildings under the *selected unit* (mobile base),
 * unless an explicit hexOverride is passed.
 */
function _getTargetHexForPlacement(scene, hexOverride) {
  if (hexOverride && typeof hexOverride.q === 'number' && typeof hexOverride.r === 'number') {
    return { q: hexOverride.q, r: hexOverride.r };
  }
  if (scene.selectedUnit && typeof scene.selectedUnit.q === 'number' && typeof scene.selectedUnit.r === 'number') {
    return { q: scene.selectedUnit.q, r: scene.selectedUnit.r };
  }
  return null;
}

/**
 * Generic building placement entry point.
 * - Reads cost from COSTS[key]
 * - Uses BUILDINGS[key].validateTile
 * - Places docks via _placeDocks, others via _placeGenericBuilding
 */
export function startBuildingPlacement(arg1, arg2, arg3) {
  const { scene, key, hexOverride } = _resolveSceneKeyAndHex(this, arg1, arg2, arg3);

  if (!scene) {
    console.warn('[BUILD] startBuildingPlacement: no scene provided.');
    return;
  }
  if (!key || !BUILDINGS[key]) {
    console.warn('[BUILD] Unknown building key:', key);
    return;
  }

  _ensureResourceInit(scene);

  const cost = COSTS[key] || {};
  if (!_canAfford(scene, cost)) {
    console.warn(`[BUILD] Not enough resources for ${BUILDINGS[key].name}.`);
    return;
  }

  const target = _getTargetHexForPlacement(scene, hexOverride);
  if (!target) {
    console.warn(`[BUILD] ${BUILDINGS[key].name}: no target hex (no unit selected?).`);
    return;
  }

  const { q, r } = target;
  if (!BUILDINGS[key].validateTile(scene, q, r)) {
    if (key === 'mine') {
      console.warn('[BUILD] Mine: can only be placed on Ruins POIs.');
    } else if (key === 'docks') {
      console.warn('[BUILD] Docks: invalid coastal placement.');
    } else {
      console.warn(`[BUILD] ${BUILDINGS[key].name}: invalid placement.`);
    }
    return;
  }

  if (!_spend(scene, cost)) {
    console.warn('[BUILD] Failed to spend resources for', BUILDINGS[key].name);
    return;
  }

  if (key === 'docks') {
    _placeDocks(scene, q, r, 'placed via startBuildingPlacement');
  } else if (key === 'mine') {
    _placeGenericBuilding(scene, BUILDINGS.mine, q, r, {
      storageScrap: 0,
      maxScrap: 10,
    });
    console.log(`[BUILD] Mine placed at (${q},${r}).`);
  } else if (key === 'factory') {
    _placeGenericBuilding(scene, BUILDINGS.factory, q, r, {});
    console.log(`[BUILD] Factory placed at (${q},${r}).`);
  } else if (key === 'bunker') {
    _placeGenericBuilding(scene, BUILDINGS.bunker, q, r, {});
    console.log(`[BUILD] Bunker placed at (${q},${r}).`);
  }
}

/**
 * Thin wrappers to keep old imports working.
 * They simply call the generic startBuildingPlacement with the right key.
 */
export function startDocksPlacement(argSceneMaybe) {
  if (this && this.sys && this.add) {
    // method style: startDocksPlacement.call(scene)
    return startBuildingPlacement.call(this, 'docks');
  }
  if (argSceneMaybe && argSceneMaybe.sys && argSceneMaybe.add) {
    // function style: startDocksPlacement(scene)
    return startBuildingPlacement(argSceneMaybe, 'docks');
  }
  console.warn('[BUILD] startDocksPlacement: no scene provided.');
}

export function startMinePlacement(argSceneMaybe) {
  if (this && this.sys && this.add) {
    return startBuildingPlacement.call(this, 'mine');
  }
  if (argSceneMaybe && argSceneMaybe.sys && argSceneMaybe.add) {
    return startBuildingPlacement(argSceneMaybe, 'mine');
  }
  console.warn('[BUILD] startMinePlacement: no scene provided.');
}

export function startFactoryPlacement(argSceneMaybe) {
  if (this && this.sys && this.add) {
    return startBuildingPlacement.call(this, 'factory');
  }
  if (argSceneMaybe && argSceneMaybe.sys && argSceneMaybe.add) {
    return startBuildingPlacement(argSceneMaybe, 'factory');
  }
  console.warn('[BUILD] startFactoryPlacement: no scene provided.');
}

export function startBunkerPlacement(argSceneMaybe) {
  if (this && this.sys && this.add) {
    return startBuildingPlacement.call(this, 'bunker');
  }
  if (argSceneMaybe && argSceneMaybe.sys && argSceneMaybe.add) {
    return startBuildingPlacement(argSceneMaybe, 'bunker');
  }
  console.warn('[BUILD] startBunkerPlacement: no scene provided.');
}

/**
 * Direct placement for docks (legacy, rarely used).
 */
export function placeDocks(sceneOrQ, qOrHex, rMaybe) {
  let scene = null;
  let q, r;

  if (this && this.sys && this.add) {
    scene = this;
    if (typeof sceneOrQ === 'object' && sceneOrQ !== null) {
      q = sceneOrQ.q;
      r = sceneOrQ.r;
    } else {
      q = sceneOrQ;
      r = qOrHex;
    }
  } else if (sceneOrQ && sceneOrQ.sys && sceneOrQ.add) {
    scene = sceneOrQ;
    if (typeof qOrHex === 'object' && qOrHex !== null) {
      q = qOrHex.q;
      r = qOrHex.r;
    } else {
      q = qOrHex;
      r = rMaybe;
    }
  }

  if (!scene) {
    console.warn('[BUILD] placeDocks: no scene provided.');
    return;
  }

  _ensureResourceInit(scene);

  if (!_canAfford(scene, COSTS.docks)) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
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
// Docks placement (special visual)
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

  // Single hit area (for the docks-specific menu)
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
    _openDocksMenu(scene, building);
  };
  hit.on('pointerdown', openMenu);

  console.log(`[BUILD] Docks placed at (${q},${r}) — ${reason}`);
}

///////////////////////////////
// Generic building placement (mine/factory/bunker)
///////////////////////////////
function _placeGenericBuilding(scene, def, q, r, extraProps = {}) {
  if (!def) return;

  scene.buildings = scene.buildings || [];
  scene._buildingIdSeq = (scene._buildingIdSeq || 1) + 1;
  const id = scene._buildingIdSeq;

  const pos = scene.axialToWorld(q, r);
  const cont = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const plate = scene.add.graphics();
  const plateW = 36, plateH = 36, radius = 8;
  plate.fillStyle(COLORS.plate, 0.92);
  plate.fillRoundedRect(-plateW/2, -plateH/2, plateW, plateH, radius);
  plate.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  plate.strokeRoundedRect(-plateW/2, -plateH/2, plateW, plateH, radius);

  const emojiText = scene.add.text(0, 0, def.emoji || '🏗️', {
    fontSize: '22px',
    color: '#ffffff'
  }).setOrigin(0.5);

  const label = scene.add.text(0, plateH/2 + 10, def.name, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText
  }).setOrigin(0.5, 0);

  cont.add([plate, emojiText, label]);

  const building = {
    id,
    type: def.key,
    name: def.name,
    q, r,
    container: cont,
    ...extraProps,
  };

  // For mines: create a small scrap storage label
  if (def.key === 'mine') {
    building.storageScrap = building.storageScrap ?? 0;
    building.maxScrap = building.maxScrap ?? 10;
    building.storageScrapLabel = scene.add.text(pos.x + 16, pos.y - 14, '', {
      fontSize: '14px',
      color: '#ffd27f',
    }).setOrigin(0, 1).setDepth(UI.zBuilding + 1);
    _updateMineScrapLabel(building);
  }

  scene.buildings.push(building);
}

function _updateMineScrapLabel(building) {
  if (!building.storageScrapLabel) return;
  const n = building.storageScrap || 0;
  building.storageScrapLabel.setText(n > 0 ? `🛠×${n}` : '');
}

///////////////////////////////
// Docks menu (per-building ship menu)
///////////////////////////////
function _openDocksMenu(scene, building) {
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
  building.storageScrapLabel?.destroy(true);

  (scene.ships   || []).forEach(s => { if (s.docksId === building.id)         s.docksId = null; });
  (scene.haulers || []).forEach(h => { if (h.targetDocksId === building.id)   h.targetDocksId = null; });

  scene.buildings = (scene.buildings || []).filter(b => b !== building);
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null;
  console.log(`[BUILD] Building destroyed (id=${building.id}, type=${building.type}).`);
}

///////////////////////////////
// Per-turn building production
///////////////////////////////
export function applyBuildingProductionOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;

  const buildings = scene.buildings || [];
  if (buildings.length === 0) return;

  for (const b of buildings) {
    // Mines generate 1 scrap per turn, up to 10 (or b.maxScrap)
    if (b.type === 'mine') {
      const max = typeof b.maxScrap === 'number' ? b.maxScrap : 10;
      if (typeof b.storageScrap !== 'number') b.storageScrap = 0;
      if (b.storageScrap < max) {
        b.storageScrap += 1;
        _updateMineScrapLabel(b);
      }
    }
  }
}

///////////////////////////////
// Minimal resource helpers
///////////////////////////////
function _ensureResourceInit(scene) {
  if (!scene.playerResources) {
    // Start with +200 of everything as requested
    scene.playerResources = { food: 200, scrap: 200, money: 200, influence: 200 };
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
// Tile + POI + neighbor helpers
///////////////////////////////
function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}

function _isWater(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && (t.type === 'water' || t.type === 'ocean' || t.type === 'sea');
}

/**
 * Try to detect "Ruins" POIs in a tolerant way.
 * We check tile flags & mapInfo.objects.
 */
function _isRuinPOI(scene, q, r, tileMaybe) {
  const t = tileMaybe || _tileAt(scene, q, r);
  if (!t) return false;

  const strVals = [
    t.locationType,
    t.feature,
    t.poiType,
    t.poi,
    t.tag,
    t.type,
  ].filter(v => typeof v === 'string').map(v => v.toLowerCase());

  if (t.hasRuin === true || t.ruin === true) return true;
  if (strVals.some(v => v === 'ruin' || v === 'ruins')) return true;

  // Also check mapInfo.objects if present
  const objs = scene.mapInfo?.objects || [];
  const hasObj = objs.some(o =>
    o &&
    o.q === q && o.r === r &&
    typeof o.type === 'string' &&
    o.type.toLowerCase().includes('ruin')
  );
  if (hasObj) return true;

  return false;
}

function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0,-1],[+1,0],[0,+1],[-1,+1],[-1,0],[-1,-1]];
  const odd  = [[+1,-1],[+1,0],[+1,+1],[0,+1],[-1,0],[0,-1]];
  const deltas = isOdd ? odd : even;
  return deltas.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

///////////////////////////////
// RNG helper (local to buildings, kept if needed later)
///////////////////////////////
function _rand(scene) {
  if (scene?.hexMap && typeof scene.hexMap.rand === 'function') {
    return scene.hexMap.rand();
  }
  return Math.random();
}

function _getRandom(list, scene) {
  if (!list || list.length === 0) return null;
  const i = Math.floor(_rand(scene) * list.length);
  return list[i];
}

export default {
  BUILDINGS,
  startBuildingPlacement,
  startDocksPlacement,
  startMinePlacement,
  startFactoryPlacement,
  startBunkerPlacement,
  placeDocks,
  applyBuildingProductionOnEndTurn,
  cancelPlacement,
};
