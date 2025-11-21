// src/scenes/WorldSceneBuildings.js
//
// Buildings module (single-hex Docks + extra buildings: Mine, Factory, Bunker)
//
// This file handles:
// - Buildings registry + validation
// - Placement of single-hex buildings (docks, mine, factory, bunker)
// - Docks context menu + overlay (build ship, set route, recall, destroy)
// - Minimal resource helpers used for build costs
// - Destroy building cleanup
// - Per-turn production for mines (1 scrap / turn, cap 10 if on ruins)
//
// Ship/Hauler logic, docks food storage labels, route picking, cyan paths, etc. live in:
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
  mine:    { scrap: 30, money: 40 },
  factory: { scrap: 50, money: 80 },
  bunker:  { scrap: 40, money: 60 },
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

  mine: {
    key: 'mine',
    name: 'Mine',
    emoji: '⛏️',
    /**
     * Mine rule:
     * - Can only be placed on a Ruins POI hex: tile.hasRuin === true
     * - No other building already on that hex.
     */
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;
      if (!t.hasRuin) return false; // must be ruins
      if ((scene.buildings || []).some(b => b.q === q && b.r === r)) return false;
      return true;
    },
    // production: 1 scrap / turn, cap 10, only if on ruins
    production: {
      resource: 'scrap',
      rate: 1,
      cap: 10,
      requireRuin: true,
      storageKey: 'storageScrap',
      labelEmoji: '🛠',
    },
  },

  factory: {
    key: 'factory',
    name: 'Factory',
    emoji: '🏭',
    /**
     * Factory rule:
     * - Can be placed on any land tile (no water, no mountains).
     * - No other building already on that hex.
     */
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t) return false;
      if (_isWater(scene, q, r)) return false;
      if (t.type === 'mountain') return false;
      if ((scene.buildings || []).some(b => b.q === q && b.r === r)) return false;
      return true;
    },
  },

  bunker: {
    key: 'bunker',
    name: 'Bunker',
    emoji: '🛡️',
    /**
     * Bunker rule:
     * - Can be placed on any land tile (no water, no mountains).
     * - No other building already on that hex.
     */
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
// Public API
///////////////////////////////

/**
 * Start docks placement.
 *
 * Supports BOTH call styles:
 *   startDocksPlacement.call(scene, hexOverride?)
 *   startDocksPlacement(scene, hexOverride?)
 *
 * Docks are placed exactly on the selected unit's hex
 * (or on hexOverride if passed), not around it.
 */
export function startDocksPlacement(sceneOrHex, maybeHex) {
  let scene = null;
  let hexOverride = null;

  // Called as method / via .call(scene, ...)
  if (this && this.sys && this.add) {
    scene = /** @type {any} */ (this);
    if (sceneOrHex && typeof sceneOrHex.q === 'number' && typeof sceneOrHex.r === 'number') {
      hexOverride = sceneOrHex;
    }
  } else if (sceneOrHex && sceneOrHex.sys && sceneOrHex.add) {
    // Called as function: startDocksPlacement(scene, hexOverride?)
    scene = /** @type {any} */ (sceneOrHex);
    if (maybeHex && typeof maybeHex.q === 'number' && typeof maybeHex.r === 'number') {
      hexOverride = maybeHex;
    }
  }

  if (!scene) {
    console.warn('[BUILD] startDocksPlacement: no scene provided.');
    return;
  }

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
    // place exactly on the selected unit’s hex
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

/**
 * Direct docks placement (if you already have target q,r).
 *
 * Supports BOTH:
 *   placeDocks.call(scene, qOrHex, r?)
 *   placeDocks(scene, qOrHex, r?)
 */
export function placeDocks(sceneOrQ, qOrHex, rMaybe) {
  let scene = null;
  let q, r;

  // Method style: placeDocks.call(scene, qOrHex, r?)
  if (this && this.sys && this.add) {
    scene = /** @type {any} */ (this);
    if (typeof sceneOrQ === 'object' && sceneOrQ !== null) {
      q = sceneOrQ.q;
      r = sceneOrQ.r;
    } else {
      q = sceneOrQ;
      r = qOrHex;
    }
  } else if (sceneOrQ && sceneOrQ.sys && sceneOrQ.add) {
    // Function style: placeDocks(scene, qOrHex, r?)
    scene = /** @type {any} */ (sceneOrQ);
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

/**
 * Place a Mine on the currently selected hex.
 * Requirements:
 * - There must be a selected unit (mobile base).
 * - There must be a selectedHex on the map.
 * - Tile must be Ruins (tile.hasRuin === true).
 */
export function placeMineAtSelectedHex() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  const def = BUILDINGS.mine;
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Mine: no unit selected.');
    return;
  }
  if (!scene.selectedHex) {
    console.warn('[BUILD] Mine: no target hex selected.');
    return;
  }

  const { q, r } = scene.selectedHex;
  if (!def.validateTile(scene, q, r)) {
    console.warn('[BUILD] Mine: invalid placement (must be on Ruins POI with no other building).');
    return;
  }

  if (!_canAfford(scene, COSTS.mine) || !_spend(scene, COSTS.mine)) return;

  _placeGenericBuilding(scene, def, q, r);
  console.log(`[BUILD] Mine placed at (${q},${r}).`);
}

/**
 * Place a Factory on the selected hex (any land, no mountain).
 */
export function placeFactoryAtSelectedHex() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  const def = BUILDINGS.factory;
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Factory: no unit selected.');
    return;
  }
  if (!scene.selectedHex) {
    console.warn('[BUILD] Factory: no target hex selected.');
    return;
  }

  const { q, r } = scene.selectedHex;
  if (!def.validateTile(scene, q, r)) {
    console.warn('[BUILD] Factory: invalid placement (land only, no mountain, no other building).');
    return;
  }

  if (!_canAfford(scene, COSTS.factory) || !_spend(scene, COSTS.factory)) return;

  _placeGenericBuilding(scene, def, q, r);
  console.log(`[BUILD] Factory placed at (${q},${r}).`);
}

/**
 * Place a Bunker on the selected hex (any land, no mountain).
 */
export function placeBunkerAtSelectedHex() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  const def = BUILDINGS.bunker;
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Bunker: no unit selected.');
    return;
  }
  if (!scene.selectedHex) {
    console.warn('[BUILD] Bunker: no target hex selected.');
    return;
  }

  const { q, r } = scene.selectedHex;
  if (!def.validateTile(scene, q, r)) {
    console.warn('[BUILD] Bunker: invalid placement (land only, no mountain, no other building).');
    return;
  }

  if (!_canAfford(scene, COSTS.bunker) || !_spend(scene, COSTS.bunker)) return;

  _placeGenericBuilding(scene, def, q, r);
  console.log(`[BUILD] Bunker placed at (${q},${r}).`);
}

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

  const building = _placeGenericBuilding(scene, BUILDINGS.docks, q, r);

  // storage label near this hex (delegated to Haulers module, for food)
  ensureDocksStoreLabel(scene, building);
  updateDocksStoreLabel(scene, building);

  // For now, docks still have their own context menu when clicked
  const hit = building.hitArea;
  if (hit) {
    const openMenu = (pointer, lx, ly, event) => {
      event?.stopPropagation?.();
      _openBuildingMenu(scene, building);
    };
    hit.on('pointerdown', openMenu);
  }

  console.log(`[BUILD] Docks placed at (${q},${r}) — ${reason}`);
}

/**
 * Generic single-hex building placement (frame + emoji + label).
 * Used by Mine, Factory, Bunker and Docks.
 */
function _placeGenericBuilding(scene, def, q, r) {
  scene.buildings = scene.buildings || [];
  scene._buildingIdSeq = (scene._buildingIdSeq || 1) + 1;
  const id = scene._buildingIdSeq;

  const pos = scene.axialToWorld(q, r);
  const cont = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const plate = scene.add.graphics();
  const plateW = 36, plateH = 36, radius = 8;
  plate.fillStyle(COLORS.plate, 0.92);
  plate.fillRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, radius);
  plate.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  plate.strokeRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, radius);

  const icon = scene.add.text(0, 0, def.emoji || '❓', {
    fontSize: '22px',
    color: '#ffffff',
  }).setOrigin(0.5);

  const label = scene.add.text(0, plateH / 2 + 10, def.name, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText,
  }).setOrigin(0.5, 0);

  const hit = scene.add.rectangle(0, 0, plateW, plateH + 26, 0x000000, 0)
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  cont.add([plate, icon, label, hit]);

  const building = {
    id,
    type: def.key,
    name: def.name,
    emoji: def.emoji || '',
    q, r,
    container: cont,
    hitArea: hit,
    routeMarker: null,
    menu: null,
    overlay: null,
    route: null,
    storageFood: 0,
    storageObj: null,
    storageScrap: 0,
  };

  scene.buildings.push(building);

  // Mines get their own scrap storage labels
  if (def.production && def.production.storageKey === 'storageScrap') {
    _ensureMineStoreLabel(scene, building, def.production.labelEmoji);
    _updateMineStoreLabel(scene, building, def.production);
  }

  return building;
}

///////////////////////////////
// Menu (docks context menu; overlay disables hex-inspect)
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
  bg.fillRoundedRect(-W / 2, -H / 2, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  bezel.strokeRect(-W / 2 + 16, -H / 2 + 16, W - 32, H - 32);
  bezel.strokeRect(-W / 2 + 8,  -H / 2 + 8,  W - 16, H - 16);

  const btnSize = 70, pad = 8, startX = -W / 2 + 12, startY = -H / 2 + 12;

  const drawButton = (x, y, label, onClick) => {
    const g = scene.add.graphics();
    g.fillStyle(0x173b52, 1);
    g.fillRoundedRect(x, y, btnSize, btnSize, 8);
    g.lineStyle(2, 0x6fe3ff, 0.7);
    g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
    g.lineStyle(1, 0x6fe3ff, 0.15);
    g.beginPath();
    g.moveTo(x + btnSize / 2, y + 6);
    g.lineTo(x + btnSize / 2, y + btnSize - 6);
    g.moveTo(x + 6, y + btnSize / 2);
    g.lineTo(x + btnSize - 6, y + btnSize / 2);
    g.strokePath();

    const t = scene.add.text(x + btnSize / 2, y + btnSize / 2, label, {
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
      g.moveTo(x + btnSize / 2, y + 6);
      g.lineTo(x + btnSize / 2, y + btnSize - 6);
      g.moveTo(x + 6, y + btnSize / 2);
      g.lineTo(x + btnSize - 6, y + btnSize / 2);
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
  console.log(`[BUILD] Building destroyed (id=${building.id}, type=${building.type}).`);
}

///////////////////////////////
// Per-turn production (mines)
///////////////////////////////
export function applyBuildingProductionOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;
  _ensureResourceInit(scene);

  (scene.buildings || []).forEach(b => {
    const def = BUILDINGS[b.type];
    if (!def || !def.production) return;

    const prod = def.production;
    const key  = prod.storageKey || (prod.resource === 'scrap' ? 'storageScrap' : null);
    if (!key) return;

    // Require ruins if configured
    if (prod.requireRuin) {
      const t = _tileAt(scene, b.q, b.r);
      if (!t || !t.hasRuin) return;
    }

    const current = b[key] || 0;
    if (current >= prod.cap) return;

    b[key] = Math.min(prod.cap, current + prod.rate);

    // Only mines currently use this system, but keep it generic-ish
    if (b.type === 'mine') {
      _ensureMineStoreLabel(scene, b, prod.labelEmoji);
      _updateMineStoreLabel(scene, b, prod);
    }
  });
}

///////////////////////////////
// Minimal resource helpers
///////////////////////////////
function _ensureResourceInit(scene) {
  if (!scene.playerResources) {
    // Fallback default if nothing set elsewhere
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
// Mine storage label helpers
///////////////////////////////
function _ensureMineStoreLabel(scene, mine, emoji = '🛠') {
  if (mine.storageObj && !mine.storageObj.destroyed) return;
  const pos = scene.axialToWorld(mine.q, mine.r);
  mine.storageObj = scene.add.text(pos.x + 16, pos.y - 14, '', {
    fontSize: '14px',
    color: COLORS.labelText,
  }).setOrigin(0, 1).setDepth(UI.zBuilding + 1);
}
function _updateMineStoreLabel(scene, mine, prodDef) {
  if (!mine.storageObj) return;
  const key = prodDef.storageKey || 'storageScrap';
  const emoji = prodDef.labelEmoji || '🛠';
  const n = Math.min(prodDef.cap, mine[key] || 0);
  mine.storageObj.setText(n > 0 ? `${emoji}×${n}` : '');
}

///////////////////////////////
// RNG helpers (local to buildings)
/////////////////////////////////
function _rand(scene) {
  // Use HexMap RNG if available for determinism, else fallback
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
  startDocksPlacement,
  placeDocks,
  cancelPlacement,
  placeMineAtSelectedHex,
  placeFactoryAtSelectedHex,
  placeBunkerAtSelectedHex,
  applyBuildingProductionOnEndTurn,
};
