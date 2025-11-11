// deephexbeta/src/scenes/WorldSceneBuildings.js
//
// FULL VERSION — PART 1/4
//
// Features covered across all parts:
// - Dual-hex Docks (1 water + 1 land) with context menu
// - Ships (harvest fish, cyan trace, deposit to docks; cargo cap 2)
// - Haulers (ground logistics, auto to docks/base; cargo cap 5)
// - Player resource system with costs + UI hooks
// - Top-left resource pad updated via scene.updateResourceUI/bumpResource
// - Safe overlay to disable hex inspect while menu/route pickers open
// - Reachability checks (water/land BFS) and cyan route preview
// - Back-compat exported alias: applyHaulerRoutesOnEndTurn -> applyHaulerBehaviorOnEndTurn
//
// NOTE: This file is delivered in 4 chunks. Ensure you paste Parts 1→4 in order.
// All inner helpers use function declarations (hoisted), so cross-order calls are safe.
// Constants/objects that must exist before use (e.g., BUILDINGS) are declared up-front.

///////////////////////////////
// Visual + UI constants
///////////////////////////////
const COLORS = {
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  labelText: '#e8f6ff',
  xMarkerPlate: 0x112633,
  xMarkerStroke: 0x3da9fc,
  cargoText: '#ffffff',
  docksStoreText: '#ffffff',
};

const UI = {
  labelFontSize: 16,
  boxRadius: 8,
  boxStrokeAlpha: 0.9,
  zBuilding: 2100,
  zOverlay: 2290,
  zMenu: 2300,
  zCargo: 2101,
  zDocksStore: 2101,
};

const DOCKS_STORAGE_CAP = 10;
const SHIP_CARGO_CAP = 2;
const HAULER_CARGO_CAP = 5;

///////////////////////////////
// Buildings registry (must precede uses)
///////////////////////////////
export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emojiWater: '🚢',
    emojiLand: '⚓',
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t || !_isWater(scene, q, r)) return false;
      const landAdj = _offsetNeighbors(q, r).some(h => _isLand(scene, h.q, h.r));
      if (!landAdj) return false;
      if ((scene.buildings || []).some(b => b.type === 'docks' && b.q === q && b.r === r)) return false;
      return true;
    },
  },
};

///////////////////////////////
// Public API (part 1)
///////////////////////////////

/** Start automatic docks placement near the selected unit (limit 2 docks total). */
export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  // resource cost check
  if (!_canAfford(scene, { scrap: 20, money: 50 })) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
  }

  const count = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (count >= 2) {
    console.warn('[BUILD] Docks: limit reached (2). New docks will not spawn.');
    return;
  }
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Docks: no unit selected.');
    return;
  }

  const u = scene.selectedUnit;

  // Prefer ring-1 water around the unit
  const ring1 = _neighbors(u.q, u.r)
    .filter(({ q, r }) => _isWater(scene, q, r))
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

  let pick = null;
  if (ring1.length) pick = _getRandom(ring1, scene);

  // Else coastal water near the unit
  if (!pick) {
    const coastal = _computeCoastalWater(scene, u.q, u.r)
      .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));
    if (coastal.length) pick = _getRandom(coastal, scene);
  }

  // Else nearest within radius 3
  if (!pick) {
    const nearest = _nearestWaterWithin(scene, u.q, u.r, 3);
    if (nearest && BUILDINGS.docks.validateTile(scene, nearest.q, nearest.r)) pick = nearest;
  }

  if (!pick) {
    console.warn('[BUILD] Docks: no nearby valid water found.');
    return;
  }

  // spend resources, then place
  if (!_spend(scene, { scrap: 20, money: 50 })) {
    console.warn('[BUILD] Failed to spend resources for Docks.');
    return;
  }
  _placeDocks(scene, pick.q, pick.r, 'spawned from mobile base');
}

export function cancelPlacement() { /* reserved for future */ }

/** Direct placement (if you already have target q,r). */
export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  if (!_canAfford(scene, { scrap: 20, money: 50 })) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
  }
  if (!_spend(scene, { scrap: 20, money: 50 })) return;

  _placeDocks(scene, q, r, 'direct place');
}

/**
 * Ships logic executed on End Turn.
 * - Moves toward route (water BFS), cyan trace
 * - If landing on fish: harvest 2 turns (1 food/turn) up to cap (2)
 * - Return to docks, deposit to docks storage (cap 10)
 * - MPs are reset at end for next turn
 */
export function applyShipRoutesOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;
  _ensureResourceInit(scene);

  const buildings = scene.buildings || [];
  const ships = scene.ships || [];
  if (ships.length === 0) return;

  let movedAny = false;

  buildings.forEach(b => {
    if (b.type !== 'docks') return;

    if (typeof b.storageFood !== 'number') b.storageFood = 0;
    _ensureDocksStoreLabel(scene, b);
    _updateDocksStoreLabel(scene, b);

    const route = b.route || null;
    const docksShips = ships.filter(s => s.docksId === b.id);

    docksShips.forEach(s => {
      if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
      if (typeof s.movePoints !== 'number') s.movePoints = s.maxMovePoints;
      if (typeof s.cargoFood !== 'number') s.cargoFood = 0;
      if (!s.mode) s.mode = 'toTarget';
      _ensureCargoLabel(scene, s);

      // If route changed while harvesting, reset
      if (s.mode === 'harvesting' && route && (s.harvestAt?.q !== route.q || s.harvestAt?.r !== route.r)) {
        s.mode = 'toTarget';
        s.harvestTurnsRemaining = 0;
        s.harvestAt = null;
      }

      // If no route but carrying, return home
      if (!route && s.cargoFood > 0) s.mode = 'returning';

      // ---------------- HARVESTING TURN ----------------
      if (s.mode === 'harvesting') {
        if (s.harvestTurnsRemaining > 0) {
          const room = Math.max(0, SHIP_CARGO_CAP - s.cargoFood);
          const take = Math.min(1, room);
          if (take > 0) {
            s.cargoFood += take;
            _updateCargoLabel(scene, s);
          }
          s.harvestTurnsRemaining -= 1;
        }
        if (s.harvestTurnsRemaining <= 0 || s.cargoFood >= SHIP_CARGO_CAP) {
          s.mode = 'returning';
        }
        // stay in place this turn
        s.movePoints = s.maxMovePoints;
        return;
      }

      // Determine target
      let targetQ = s.q, targetR = s.r;
      if (s.mode === 'toTarget' && route) { targetQ = route.q; targetR = route.r; }
      else if (s.mode === 'returning') { targetQ = b.q; targetR = b.r; }

      // Arrived?
      if (s.q === targetQ && s.r === targetR) {
        if (s.mode === 'toTarget') {
          const onFish = _fishAt(scene, s.q, s.r);
          if (onFish) {
            s.mode = 'harvesting';
            s.harvestTurnsRemaining = 2;
            s.harvestAt = { q: s.q, r: s.r };
          } else {
            s.mode = 'returning';
          }
        } else if (s.mode === 'returning') {
          if (s.cargoFood > 0) {
            const room = Math.max(0, DOCKS_STORAGE_CAP - b.storageFood);
            const deposit = Math.min(room, s.cargoFood);
            b.storageFood += deposit;
            s.cargoFood -= deposit;
            _updateDocksStoreLabel(scene, b);
            _updateCargoLabel(scene, s);
          }
          s.mode = route ? 'toTarget' : 'returning';
        }
        s.movePoints = s.maxMovePoints;
        return;
      }

      // Movement leg
      if (s.movePoints <= 0) return;

      const path = _waterPath(scene, s.q, s.r, targetQ, targetR);
      if (!path || path.length <= 1) return;

      // draw cyan trace for this leg
      _debugDrawWaterPath(scene, path);

      const steps = Math.min(s.movePoints, path.length - 1);
      const nx = path[steps];
      s.q = nx.q; s.r = nx.r;
      s.movePoints -= steps;

      const p = scene.axialToWorld(s.q, s.r);
      s.obj.setPosition(p.x, p.y);
      _repositionCargoLabel(scene, s);

      movedAny = true;
    });
  });

  // Regen MPs each end turn (so next turn they can continue)
  (scene.ships || []).forEach(s => {
    if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
    s.movePoints = s.maxMovePoints;
  });

  if (!movedAny) {
    const dbg = (scene.ships || []).map(s => `ship#${s.docksId}@${s.q},${s.r} mp=${s.movePoints} mode=${s.mode} 🍖${s.cargoFood}`).join(' | ');
    console.log(`[SHIP] No ships moved. Current ships: ${dbg}`);
  }
}

///////////////////////////////
// Docks placement (dual-hex)
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

  // pick first adjacent land hex as ground part
  const landAdj = _offsetNeighbors(q, r).filter(h => _isLand(scene, h.q, h.r));
  if (landAdj.length === 0) {
    console.warn(`[BUILD] Docks: no adjacent land at (${q},${r}).`);
    return;
  }
  const ground = landAdj[0];

  scene.buildings = scene.buildings || [];
  scene._buildingIdSeq = (scene._buildingIdSeq || 1) + 1;
  const id = scene._buildingIdSeq;

  // Water label/container
  const posW = scene.axialToWorld(q, r);
  const contWater = scene.add.container(posW.x, posW.y).setDepth(UI.zBuilding);
  const labelW = scene.add.text(0, 0, `${BUILDINGS.docks.emojiWater}  ${BUILDINGS.docks.name}`, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText,
  }).setOrigin(0.5);
  const wW = Math.max(64, labelW.width + 12), hW = Math.max(26, labelW.height + 12);
  const boxW = scene.add.graphics();
  boxW.fillStyle(COLORS.plate, 0.92);
  boxW.fillRoundedRect(-wW/2, -hW/2, wW, hW, 8);
  boxW.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  boxW.strokeRoundedRect(-wW/2, -hW/2, wW, hW, 8);
  const hitW = scene.add.rectangle(0, 0, wW, hW, 0x000000, 0).setOrigin(0.5).setInteractive({ useHandCursor: true });
  contWater.add([boxW, labelW, hitW]);

  // Ground label/container
  const posG = scene.axialToWorld(ground.q, ground.r);
  const contLand = scene.add.container(posG.x, posG.y).setDepth(UI.zBuilding);
  const labelG = scene.add.text(0, 0, `${BUILDINGS.docks.emojiLand}  ${BUILDINGS.docks.name}`, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText,
  }).setOrigin(0.5);
  const wG = Math.max(64, labelG.width + 12), hG = Math.max(26, labelG.height + 12);
  const boxG = scene.add.graphics();
  boxG.fillStyle(COLORS.plate, 0.92);
  boxG.fillRoundedRect(-wG/2, -hG/2, wG, hG, 8);
  boxG.lineStyle(2, COLORS.stroke, UI.boxStrokeAlpha);
  boxG.strokeRoundedRect(-wG/2, -hG/2, wG, hG, 8);
  const hitG = scene.add.rectangle(0, 0, wG, hG, 0x000000, 0).setOrigin(0.5).setInteractive({ useHandCursor: true });
  contLand.add([boxG, labelG, hitG]);

  const building = {
    id,
    type: BUILDINGS.docks.key,
    name: BUILDINGS.docks.name,
    q, r, // WATER hex
    container: contWater,
    gq: ground.q, gr: ground.r, // GROUND hex
    containerLand: contLand,
    routeMarker: null,
    menu: null,
    overlay: null,
    route: null,
    storageFood: 0,
    storageObj: null,
  };

  scene.buildings.push(building);
  _ensureDocksStoreLabel(scene, building);
  _updateDocksStoreLabel(scene, building);

  const openMenu = (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    _openBuildingMenu(scene, building);
  };
  hitW.on('pointerdown', openMenu);
  hitG.on('pointerdown', openMenu);

  console.log(`[BUILD] Docks placed at WATER(${q},${r}) + GROUND(${ground.q},${ground.r}) — ${reason}`);
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

  const midX = (scene.axialToWorld(building.q, building.r).x + scene.axialToWorld(building.gq, building.gr).x) / 2;
  const midY = (scene.axialToWorld(building.q, building.r).y + scene.axialToWorld(building.gq, building.gr).y) / 2;

  const menu = scene.add.container(midX, midY - 56).setDepth(UI.zMenu);
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
    { text: 'Build a ship', onClick: () => _buildShip(scene, building) },
    { text: 'Set route',    onClick: () => _enterRoutePicker(scene, building) },
    { text: 'Recall ships', onClick: () => _recallShips(scene, building) },
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
  if (building.menu) { building.menu.destroy(true); building.menu = null; }
  if (building.overlay) { building.overlay.destroy(true); building.overlay = null; }
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null;
}

// ===== Part 1/4 ends here =====
// deephexbeta/src/scenes/WorldSceneBuildings.js
// FULL VERSION — PART 2/4
// Covers: Ship builder, Route picker, Hauler builder + end-turn behavior,
// Resource helpers, cargo/docks store labels, pathfinding utils, RNG helpers.

///////////////////////////////
// Ship builder (from Docks menu)
///////////////////////////////
function _buildShip(scene, building) {
  _ensureResourceInit(scene);
  if (!_spend(scene, { food: 10 })) {
    console.warn('[SHIP] Not enough 🍖 (need 10).');
    return;
  }

  scene.ships = scene.ships || [];
  const pos = scene.axialToWorld(building.q, building.r);
  const t = scene.add.text(pos.x, pos.y, '🚢', {
    fontSize: '20px',
    color: '#ffffff'
  }).setOrigin(0.5).setDepth(UI.zBuilding);

  const ship = {
    type: 'ship',
    name: 'Ship',
    emoji: '🚢',
    isNaval: true,
    q: building.q, r: building.r,
    docksId: building.id,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,
    cargoFood: 0,
    cargoObj: null,
    mode: 'toTarget',
    harvestTurnsRemaining: 0,
    harvestAt: null,
  };
  scene.ships.push(ship);
  _ensureCargoLabel(scene, ship);
  _repositionCargoLabel(scene, ship);
}

///////////////////////////////
// Route picker + recall for ships
///////////////////////////////
function _enterRoutePicker(scene, building) {
  const ships = (scene.ships || []).filter(s => s.docksId === building.id);
  if (ships.length === 0) {
    console.log(`[DOCKS] Set route: no ships for docks#${building.id}`);
    return;
  }

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001
  ).setInteractive({ useHandCursor: true })
   .setScrollFactor(0)
   .setDepth(UI.zOverlay);

  console.log('[DOCKS] Click a reachable water hex to set route…');

  overlay.once('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    const approx = scene.pixelToHex(
      pointer.worldX - (scene.mapOffsetX || 0),
      pointer.worldY - (scene.mapOffsetY || 0),
      scene.hexSize
    );
    const rounded = scene.roundHex(approx.q, approx.r);
    if (rounded.q < 0 || rounded.r < 0 ||
        rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[DOCKS] Route pick out of bounds — cancelled');
      overlay.destroy(); return;
    }
    if (!_isWater(scene, rounded.q, rounded.r)) {
      console.warn('[DOCKS] Route must be on water.');
      overlay.destroy(); return;
    }
    if (!_reachableOnWater(scene, building.q, building.r, rounded.q, rounded.r)) {
      console.warn('[DOCKS] Route water hex is not reachable by water.');
      overlay.destroy(); return;
    }
    _setRouteMarker(scene, building, rounded.q, rounded.r);
    overlay.destroy();
  });
}

function _setRouteMarker(scene, building, q, r) {
  if (building.routeMarker) building.routeMarker.destroy(true);
  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);
  const t = scene.add.text(0, 0, 'X', { fontSize: '18px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
  const pad = 4;
  const w = Math.max(18, t.width + pad * 2);
  const h = Math.max(18, t.height + pad * 2);
  const box = scene.add.graphics();
  box.fillStyle(COLORS.xMarkerPlate, 0.93);
  box.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
  box.lineStyle(2, COLORS.xMarkerStroke, 0.9);
  box.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  container.add([box, t]);
  building.routeMarker = container;
  building.route = { q, r };
}

function _recallShips(scene, building) {
  const ships = (scene.ships || []).filter(s => s.docksId === building.id);
  if (ships.length === 0) {
    console.log(`[DOCKS] Recall: no ships for docks#${building.id}`);
    return;
  }
  ships.forEach(s => {
    s.q = building.q; s.r = building.r;
    const p = scene.axialToWorld(s.q, s.r);
    s.obj.setPosition(p.x, p.y);
    _repositionCargoLabel(scene, s);
  });
}

///////////////////////////////
// Docks storage label helpers
///////////////////////////////
function _ensureDocksStoreLabel(scene, docks) {
  if (docks.storageObj && !docks.storageObj.destroyed) return;
  const pos = scene.axialToWorld(docks.gq ?? docks.q, docks.gr ?? docks.r);
  docks.storageObj = scene.add.text(pos.x + 16, pos.y - 14, '', {
    fontSize: '14px',
    color: COLORS.docksStoreText,
  }).setOrigin(0, 1).setDepth(UI.zDocksStore);
  _updateDocksStoreLabel(scene, docks);
}
function _updateDocksStoreLabel(scene, docks) {
  if (!docks.storageObj) return;
  const n = Math.min(DOCKS_STORAGE_CAP, docks.storageFood || 0);
  docks.storageObj.setText(n > 0 ? `🍖×${n}` : '');
}

///////////////////////////////
// Hauler builder (from mobile base)
///////////////////////////////
export function buildHaulerAtSelectedUnit() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);
  if (!_spend(scene, { food: 10 })) {
    console.warn('[HAULER] Not enough 🍖 (need 10).');
    return;
  }
  const u = scene.selectedUnit;
  if (!u) { console.warn('[HAULER] No selected unit (mobile base).'); return; }

  scene.haulers = scene.haulers || [];
  const pos = scene.axialToWorld(u.q, u.r);
  const t = scene.add.text(pos.x, pos.y, '🚚', {
    fontSize: '20px', color: '#ffffff'
  }).setOrigin(0.5).setDepth(UI.zBuilding);

  const hauler = {
    type: 'hauler',
    name: 'Hauler',
    emoji: '🚚',
    q: u.q, r: u.r,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,
    cargoFood: 0,
    cargoObj: null,
    mode: 'idle',
    baseRef: u, baseQ: u.q, baseR: u.r,
    targetDocksId: null,
  };

  // Auto-assign to nearest docks
  const docksList = (scene.buildings || []).filter(b => b.type === 'docks');
  if (docksList.length > 0) {
    const best = docksList
      .map(b => ({ b, d: _hexManhattan(u.q, u.r, b.gq ?? b.q, b.gr ?? b.r) }))
      .sort((a, b) => a.d - b.d)[0].b;
    hauler.targetDocksId = best.id;
    hauler.mode = 'toDocks';
    console.log(`[HAULER] Auto-assigned to docks#${best.id} at (${best.gq},${best.gr}).`);
  } else {
    console.warn('[HAULER] No docks available to assign route.');
  }

  scene.haulers.push(hauler);
  _ensureCargoLabel(scene, hauler);
  _repositionCargoLabel(scene, hauler);
}

///////////////////////////////
// Hauler End-Turn behavior
///////////////////////////////
export function applyHaulerBehaviorOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;
  _ensureResourceInit(scene);
  const haulers = scene.haulers || [];
  if (haulers.length === 0) return;

  let movedAny = false;
  for (const h of haulers) {
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    if (typeof h.movePoints !== 'number') h.movePoints = h.maxMovePoints;
    if (!h.cargoObj || h.cargoObj.destroyed) _ensureCargoLabel(scene, h);

    const docks = (scene.buildings || []).find(b => b.type === 'docks' && b.id === h.targetDocksId) || null;
    if (!docks) { h.mode = 'idle'; h.movePoints = h.maxMovePoints; continue; }

    _ensureDocksStoreLabel(scene, docks);
    _updateDocksStoreLabel(scene, docks);

    const targetGroundQ = docks.gq ?? docks.q;
    const targetGroundR = docks.gr ?? docks.r;
    const basePos = _getMobileBaseCoords(scene, h);
    const baseQ = basePos.q, baseR = basePos.r;

    if (h.cargoFood > 0 && h.mode !== 'returningToBase') h.mode = 'returningToBase';
    if (h.cargoFood === 0 && h.mode === 'idle') h.mode = 'toDocks';

    let targetQ = h.q, targetR = h.r;
    if (h.mode === 'toDocks') { targetQ = targetGroundQ; targetR = targetGroundR; }
    else if (h.mode === 'returningToBase') { targetQ = baseQ; targetR = baseR; }

    // Arrived?
    if (h.q === targetQ && h.r === targetR) {
      if (h.mode === 'toDocks') {
        const room = Math.max(0, HAULER_CARGO_CAP - h.cargoFood);
        const take = Math.min(room, docks.storageFood || 0);
        docks.storageFood = Math.max(0, (docks.storageFood || 0) - take);
        h.cargoFood += take;
        _updateDocksStoreLabel(scene, docks);
        _updateCargoLabel(scene, h);
        h.mode = 'returningToBase';
      } else if (h.mode === 'returningToBase') {
        if (h.cargoFood > 0) {
          _gain(scene, { food: h.cargoFood });
          h.cargoFood = 0;
          _updateCargoLabel(scene, h);
        }
        h.mode = 'toDocks';
      }
      h.movePoints = h.maxMovePoints;
      continue;
    }

    if (h.movePoints <= 0) continue;
    const path = _landPath(scene, h.q, h.r, targetQ, targetR);
    if (!path || path.length <= 1) continue;
    _debugDrawLandPath(scene, path);
    const steps = Math.min(h.movePoints, path.length - 1);
    const nx = path[steps];
    h.q = nx.q; h.r = nx.r;
    h.movePoints -= steps;
    const p = scene.axialToWorld(h.q, h.r);
    h.obj.setPosition(p.x, p.y);
    _repositionCargoLabel(scene, h);
    movedAny = true;
  }

  haulers.forEach(h => { h.movePoints = h.maxMovePoints; });
  if (!movedAny) {
    const dbg = haulers.map(h => `hauler@${h.q},${h.r} mode=${h.mode} mp=${h.movePoints} 🍖${h.cargoFood}`).join(' | ');
    console.log(`[HAULER] No haulers moved. ${dbg}`);
  }
}

// ===== Part 2/4 ends here =====
// deephexbeta/src/scenes/WorldSceneBuildings.js
// FULL VERSION — PART 3/4
// Covers: Resource helpers, tile/water/land utils, BFS pathfinding,
// debug path traces, RNG helpers, cargo label system, and destroy building.

///////////////////////////////
// Resource system
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
function _gain(scene, gains) {
  Object.entries(gains).forEach(([k, v]) => {
    scene.playerResources[k] = (scene.playerResources[k] ?? 0) + v;
    scene.bumpResource?.(k);
  });
  scene.updateResourceUI?.();
}

///////////////////////////////
// Tile access helpers
///////////////////////////////
function _tileAt(scene, q, r) {
  return scene.mapData?.find?.(t => t.q === q && t.r === r);
}
function _isWater(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && (t.type === 'water' || t.type === 'ocean' || t.type === 'sea');
}
function _isLand(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && !_isWater(scene, q, r);
}

///////////////////////////////
// Neighbor + coastal + nearest logic
///////////////////////////////
function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0, -1],[+1,0],[0,+1],[-1,+1],[-1,0],[-1,-1]];
  const odd  = [[+1,-1],[+1,0],[+1,+1],[0,+1],[-1,0],[0,-1]];
  const deltas = isOdd ? odd : even;
  return deltas.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}
function _neighbors(q, r) { return _offsetNeighbors(q, r); }

function _nearestWaterWithin(scene, uq, ur, maxRadius=3) {
  const key = (q,r)=>`${q},${r}`;
  const seen=new Set([key(uq,ur)]), qArr=[{q:uq,r:ur,dist:0}];
  while(qArr.length){
    const cur=qArr.shift();
    if(cur.dist>maxRadius) break;
    if(_isWater(scene,cur.q,cur.r)&&BUILDINGS.docks.validateTile(scene,cur.q,cur.r)){
      if(!(cur.q===uq&&cur.r===ur)) return {q:cur.q,r:cur.r};
    }
    for(const n of _offsetNeighbors(cur.q,cur.r)){
      if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
      const k=key(n.q,n.r); if(seen.has(k))continue;
      seen.add(k); qArr.push({q:n.q,r:n.r,dist:cur.dist+1});
    }
  }
  return null;
}

function _computeCoastalWater(scene,uq,ur){
  const set=new Set(),out=[];
  const add=(q,r)=>{const k=`${q},${r}`;if(!set.has(k)){set.add(k);out.push({q,r});}};
  for(const h of _offsetNeighbors(uq,ur)){
    if(h.q<0||h.r<0||h.q>=scene.mapWidth||h.r>=scene.mapHeight)continue;
    if(_isLand(scene,h.q,h.r)){
      for(const n of _offsetNeighbors(h.q,h.r)){
        if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
        if(_isWater(scene,n.q,n.r))add(n.q,n.r);
      }
    }
  }
  return out;
}

///////////////////////////////
// Pathfinding: water + land BFS
///////////////////////////////
function _reachableOnWater(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene, fromQ, fromR) || !_isWater(scene, toQ, toR)) return false;
  if (fromQ === toQ && fromR === toR) return true;
  return !!_waterPath(scene, fromQ, fromR, toQ, toR);
}

function _waterPath(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene,toQ,toR)||!_isWater(scene,fromQ,fromR)) return null;
  const key=(q,r)=>`${q},${r}`; const came=new Map(),seen=new Set([key(fromQ,fromR)]);
  const qArr=[{q:fromQ,r:fromR}];
  while(qArr.length){
    const cur=qArr.shift();
    if(cur.q===toQ&&cur.r===toR){
      const path=[]; let node=cur,k=key(cur.q,cur.r);
      while(node){path.push({q:node.q,r:node.r});const prev=came.get(k);if(!prev)break;k=key(prev.q,prev.r);node=prev;}
      return path.reverse();
    }
    for(const n of _offsetNeighbors(cur.q,cur.r)){
      if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
      if(!_isWater(scene,n.q,n.r))continue;
      const nk=key(n.q,n.r); if(seen.has(nk))continue;
      seen.add(nk); came.set(nk,cur); qArr.push(n);
    }
  } return null;
}

function _landPath(scene,fromQ,fromR,toQ,toR){
  if(!_isLand(scene,fromQ,fromR)||!_isLand(scene,toQ,toR))return null;
  const key=(q,r)=>`${q},${r}`;const came=new Map(),seen=new Set([key(fromQ,fromR)]);
  const qArr=[{q:fromQ,r:fromR}];
  while(qArr.length){
    const cur=qArr.shift();
    if(cur.q===toQ&&cur.r===toR){
      const path=[];let node=cur,k=key(cur.q,cur.r);
      while(node){path.push({q:node.q,r:node.r});const prev=came.get(k);if(!prev)break;k=key(prev.q,prev.r);node=prev;}
      return path.reverse();
    }
    for(const n of _offsetNeighbors(cur.q,cur.r)){
      if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
      if(!_isLand(scene,n.q,n.r))continue;
      const nk=key(n.q,n.r); if(seen.has(nk))continue;
      seen.add(nk); came.set(nk,cur); qArr.push(n);
    }
  } return null;
}

///////////////////////////////
// Utility + Debug
///////////////////////////////
function _hexManhattan(q1,r1,q2,r2){return Math.abs(q1-q2)+Math.abs(r1-r2);}

function _debugDrawWaterPath(scene,path){
  try{
    if(!path||path.length<2)return;
    if(scene._shipPathGfx)scene._shipPathGfx.destroy();
    const g=scene.add.graphics().setDepth(2400);
    scene._shipPathGfx=g; g.lineStyle(2,0x6fe3ff,0.9);
    let p0=scene.axialToWorld(path[0].q,path[0].r);
    for(let i=1;i<path.length;i++){
      const p1=scene.axialToWorld(path[i].q,path[i].r);
      g.strokeLineShape(new Phaser.Geom.Line(p0.x,p0.y,p1.x,p1.y)); p0=p1;
    }
    scene.tweens.add({targets:g,alpha:0,duration:900,delay:600,onComplete:()=>g.destroy()});
  }catch{}
}
function _debugDrawLandPath(scene,path){
  try{
    if(!path||path.length<2)return;
    if(scene._haulerPathGfx)scene._haulerPathGfx.destroy();
    const g=scene.add.graphics().setDepth(2400);
    scene._haulerPathGfx=g; g.lineStyle(2,0x6fe3ff,0.9);
    let p0=scene.axialToWorld(path[0].q,path[0].r);
    for(let i=1;i<path.length;i++){
      const p1=scene.axialToWorld(path[i].q,path[i].r);
      g.strokeLineShape(new Phaser.Geom.Line(p0.x,p0.y,p1.x,p1.y)); p0=p1;
    }
    scene.tweens.add({targets:g,alpha:0,duration:900,delay:600,onComplete:()=>g.destroy()});
  }catch{}
}

///////////////////////////////
// RNG + resource object helpers
///////////////////////////////
function _rand(scene){
  return (scene?.hexMap && typeof scene.hexMap.rand==='function')
    ? scene.hexMap.rand() : Math.random();
}
function _getRandom(list,scene){
  if(!list||list.length===0)return null;
  const i=Math.floor(_rand(scene)*list.length);
  return list[i];
}
function _fishAt(scene,q,r){
  return !!(scene.resources||[]).find(o=>o.type==='fish'&&o.q===q&&o.r===r);
}

///////////////////////////////
// Cargo labels
///////////////////////////////
function _ensureCargoLabel(scene,unit){
  if(unit.cargoObj && !unit.cargoObj.destroyed)return;
  unit.cargoObj=scene.add.text(0,0,'',{fontSize:'14px',color:COLORS.cargoText})
    .setOrigin(0,1).setDepth(UI.zCargo);
  _updateCargoLabel(scene,unit); _repositionCargoLabel(scene,unit);
}
function _updateCargoLabel(scene,unit){
  if(!unit.cargoObj)return;
  const n=unit.cargoFood||0;
  unit.cargoObj.setText(n>0?`🍖×${n}`:'');
}
function _repositionCargoLabel(scene,unit){
  if(!unit.cargoObj)return;
  const p=scene.axialToWorld(unit.q,unit.r);
  unit.cargoObj.setPosition(p.x+10,p.y-6);
}

///////////////////////////////
// Destroy building
///////////////////////////////
function _destroyBuilding(scene,building){
  building.container?.destroy(true);
  building.containerLand?.destroy(true);
  building.menu?.destroy(true);
  building.overlay?.destroy(true);
  building.storageObj?.destroy(true);
  building.routeMarker?.destroy(true);
  (scene.ships||[]).forEach(s=>{if(s.docksId===building.id)s.docksId=null;});
  (scene.haulers||[]).forEach(h=>{if(h.targetDocksId===building.id)h.targetDocksId=null;});
  scene.buildings=(scene.buildings||[]).filter(b=>b!==building);
  if(scene.uiLock==='buildingMenu')scene.uiLock=null;
  console.log(`[BUILD] Docks destroyed (id=${building.id}).`);
}

// ===== Part 3/4 ends here =====
// deephexbeta/src/scenes/WorldSceneBuildings.js
// FULL VERSION — PART 4/4
// Covers: Mobile base resolver, Hauler route picker (public),
// export aliases and named exports.

// ---------------------------------------------------------
// Mobile Base resolver (used by haulers to return to base)
// ---------------------------------------------------------
function _getMobileBaseCoords(scene, hauler) {
  // If we were given a live reference, use it.
  if (hauler?.baseRef && typeof hauler.baseRef.q === 'number' && typeof hauler.baseRef.r === 'number') {
    return { q: hauler.baseRef.q, r: hauler.baseRef.r };
  }

  // Otherwise, try to find a "mobile base" among players.
  if (Array.isArray(scene.players)) {
    const mb = scene.players.find(u =>
      u?.type === 'mobileBase' ||
      u?.isMobileBase === true ||
      u?.name === 'Mobile Base' ||
      u?.emoji === '🏕️' ||
      u?.emoji === '🚚' // (fallback if your base is text-based)
    );
    if (mb && typeof mb.q === 'number' && typeof mb.r === 'number') {
      return { q: mb.q, r: mb.r };
    }
  }

  // Fallback to the remembered spawn tile.
  return {
    q: (typeof hauler?.baseQ === 'number') ? hauler.baseQ : (scene.players?.[0]?.q ?? 0),
    r: (typeof hauler?.baseR === 'number') ? hauler.baseR : (scene.players?.[0]?.r ?? 0),
  };
}

// ---------------------------------------------------------
// PUBLIC: Hauler route picker UI
// Lets the user click a docks (water or ground) to assign
// the chosen docks as pickup point for the selected hauler.
// ---------------------------------------------------------
export function enterHaulerRoutePicker() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  // Choose the target hauler: prefer selected hauler, else first hauler.
  const sel = scene.selectedUnit;
  let targetHauler = null;
  if (sel && sel.type === 'hauler') targetHauler = sel;
  else targetHauler = (scene.haulers || [])[0] || null;

  if (!targetHauler) {
    console.warn('[HAULER] No hauler available to set a route for.');
    return;
  }

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000,
    0.001
  )
    .setInteractive({ useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(UI.zOverlay);

  console.log('[HAULER] Click a docks (water or land part) to set as pickup…');

  overlay.once('pointerdown', (pointer, _lx, _ly, event) => {
    event?.stopPropagation?.();

    const approx = scene.pixelToHex(
      pointer.worldX - (scene.mapOffsetX || 0),
      pointer.worldY - (scene.mapOffsetY || 0),
      scene.hexSize
    );
    const rounded = scene.roundHex(approx.q, approx.r);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[HAULER] Route pick out of bounds.');
      overlay.destroy();
      return;
    }

    const docks = (scene.buildings || []).find(b =>
      b.type === 'docks' && (
        (b.q === rounded.q && b.r === rounded.r) || // water part
        (b.gq === rounded.q && b.gr === rounded.r)  // ground part
      )
    );

    if (!docks) {
      console.warn('[HAULER] You must select an existing docks (water or land).');
      overlay.destroy();
      return;
    }

    targetHauler.targetDocksId = docks.id;
    if (targetHauler.mode === 'idle') targetHauler.mode = 'toDocks';
    console.log(`[HAULER] Hauler will pick up from docks#${docks.id} ground(${docks.gq},${docks.gr}).`);

    overlay.destroy();
  });
}

// ---------------------------------------------------------
// Back-compat export alias for older imports in WorldScene.js
// ---------------------------------------------------------
export { applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn };

// ---------------------------------------------------------
// Named exports (explicit list for clarity)
// ---------------------------------------------------------
// NOTE: most functions are already exported at declaration site.
// This final block is only for clarity and tooling friendliness.
// If your bundler complains about re-exports, you can remove this block.
export {
  // BUILDINGS registry + public API
  BUILDINGS,
  startDocksPlacement,
  cancelPlacement,
  placeDocks,
  buildHaulerAtSelectedUnit,
};
// ===== End of WorldSceneBuildings.js (Part 4/4, FINAL) =====
