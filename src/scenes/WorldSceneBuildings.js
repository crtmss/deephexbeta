// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   Buildings & naval/land support (modal UI + harvesting + hauling)
   - Docks (🚢): max 2 per map. Route marker “X”; storageFood with cap=10 and a 🍖×N label.
   - Ships (🚢): water-only, 8 MP/turn; toTarget → harvesting(2 turns on fish) → returning.
                 Deposit into docks (up to cap). MPs regen after movement each End Turn.
   - Hauler (🚚): land-only, 8 MP/turn; from mobile base. “Set Hauler Route” picks a docks hex.
                 Cycle: toDocks → pickup (≤5) → returningToBase → deposit into base store → repeat.
   - All water/land movement uses ODD-R OFFSET neighbors (consistent with your isometric map).
   - Modal menus disable hex-inspect while open; clicking outside closes.
   ======================================================================= */

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
  zBuilding: 2100,     // above terrain
  zOverlay: 2290,      // modal overlay (below menu, above everything else)
  zMenu: 2300,         // building menu
  zCargo: 2101,        // slightly above unit emoji
  zDocksStore: 2101,
};

const DOCKS_STORAGE_CAP = 10;
const HAULER_CARGO_CAP = 5;

export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '🚢',
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t || !_isWater(scene, q, r)) return false;
      const u = scene.selectedUnit; // place relative to selected unit (e.g., mobile base)
      if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return false;
      // prevent duplicate on same hex
      if (Array.isArray(scene.buildings) && scene.buildings.some(b => b.q === q && b.r === r)) return false;
      return true;
    },
  },
};

/* =========================
   PUBLIC API (exports)
   ========================= */

export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Docks: no unit selected.');
    return;
  }

  const count = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (count >= 2) {
    console.warn('[BUILD] Docks: limit reached (2). New docks will not spawn.');
    return;
  }

  const u = scene.selectedUnit;

  // ring-1 water tiles
  const ring1 = _neighbors(u.q, u.r)
    .filter(({ q, r }) => _isWater(scene, q, r))
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

  if (ring1.length) {
    const pick = _getRandom(ring1, scene);
    _placeDocks(scene, pick.q, pick.r, 'ring-1 water');
    return;
  }

  // coastal water
  const coastal = _computeCoastalWater(scene, u.q, u.r)
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

  if (coastal.length) {
    const pick = _getRandom(coastal, scene);
    _placeDocks(scene, pick.q, pick.r, 'coastal water');
    return;
  }

  // nearest water ≤ 3
  const nearest = _nearestWaterWithin(scene, u.q, u.r, 3);
  if (nearest && BUILDINGS.docks.validateTile(scene, nearest.q, nearest.r)) {
    _placeDocks(scene, nearest.q, nearest.r, 'fallback radius≤3');
    return;
  }

  console.warn('[BUILD] Docks: no nearby water found (ring-1/coastal/≤3).');
}

export function cancelPlacement() {
  // kept for compatibility (no-op)
}

export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeDocks(scene, q, r, 'direct place');
}

/** Ship movement/cargo & harvesting resolution (call on End Turn) */
export function applyShipRoutesOnEndTurn(scene) {
  const buildings = scene.buildings || [];
  const ships = scene.ships || [];
  if (ships.length === 0) return;

  let movedAny = false;

  buildings.forEach(b => {
    if (b.type !== 'docks') return;

    // Ensure docks storage + label
    if (typeof b.storageFood !== 'number') b.storageFood = 0;
    _ensureDocksStoreLabel(scene, b);

    const route = b.route || null;
    const docksShips = ships.filter(s => s.docksId === b.id);

    docksShips.forEach(s => {
      if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
      if (typeof s.movePoints !== 'number') s.movePoints = s.maxMovePoints;
      if (typeof s.cargoFood !== 'number') s.cargoFood = 0;
      if (!s.mode) s.mode = 'toTarget'; // toTarget | harvesting | returning
      _ensureCargoLabel(scene, s);

      // If harvesting but route changed, cancel
      if (s.mode === 'harvesting' && route && (s.harvestAt?.q !== route.q || s.harvestAt?.r !== route.r)) {
        s.mode = 'toTarget';
        s.harvestTurnsRemaining = 0;
        s.harvestAt = null;
      }

      // If no route, idle; if carrying cargo with no route, return
      if (!route && s.cargoFood > 0) s.mode = 'returning';

      // current target based on mode
      let targetQ = s.q, targetR = s.r;
      if (s.mode === 'toTarget' && route) { targetQ = route.q; targetR = route.r; }
      else if (s.mode === 'returning') { targetQ = b.q; targetR = b.r; }

      // harvesting: collect, count down, regen MPs and skip move
      if (s.mode === 'harvesting') {
        s.cargoFood += 1;
        s.harvestTurnsRemaining = Math.max(0, (s.harvestTurnsRemaining || 0) - 1);
        _updateCargoLabel(scene, s);
        console.log(`[SHIP] docks#${b.id} harvesting at (${s.q},${s.r}) — cargo 🍖×${s.cargoFood}, turns left ${s.harvestTurnsRemaining}`);

        if (s.harvestTurnsRemaining === 0) s.mode = 'returning';
        s.movePoints = s.maxMovePoints;
        return;
      }

      // already at target hex
      if (s.q === targetQ && s.r === targetR) {
        if (s.mode === 'toTarget') {
          const onFish = _fishAt(scene, s.q, s.r);
          if (onFish) {
            s.mode = 'harvesting';
            s.harvestTurnsRemaining = 2;
            s.harvestAt = { q: s.q, r: s.r };
            console.log(`[SHIP] docks#${b.id} arrived on fish (${s.q},${s.r}). Harvest starts next turn (2 turns).`);
          } else {
            s.mode = 'returning';
            console.log(`[SHIP] docks#${b.id} arrived at route (${s.q},${s.r}) — no fish. Returning next turn.`);
          }
        } else if (s.mode === 'returning') {
          // deposit into docks (cap 10). Any overflow stays on ship.
          if (s.cargoFood > 0) {
            const room = Math.max(0, DOCKS_STORAGE_CAP - b.storageFood);
            const deposit = Math.min(room, s.cargoFood);
            b.storageFood += deposit;
            s.cargoFood -= deposit;
            _updateDocksStoreLabel(scene, b);
            _updateCargoLabel(scene, s);
            console.log(`[DOCKS] docks#${b.id} received 🍖×${deposit} (stored=${b.storageFood}/${DOCKS_STORAGE_CAP}, ship left=${s.cargoFood}).`);
          }
          // if route exists, head out again
          s.mode = route ? 'toTarget' : 'returning';
        }
        s.movePoints = s.maxMovePoints;
        return;
      }

      // no MPs? skip
      if (s.movePoints <= 0) {
        console.log(`[SHIP] docks#${b.id} ship@${s.q},${s.r} has 0 MP — skip`);
        return;
      }

      const path = _waterPath(scene, s.q, s.r, targetQ, targetR);
      if (!path || path.length <= 1) {
        console.warn(`[SHIP] docks#${b.id} ship@${s.q},${s.r} no water path to ${targetQ},${targetR}`);
        return;
      }

      _debugDrawWaterPath(scene, path);
      console.log(`[SHIP] docks#${b.id} path len=${path.length} (${s.mode}) : `, path.map(n => `(${n.q},${n.r})`).join('→'));

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

  // regen MPs at end
  (scene.ships || []).forEach(s => {
    if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
    s.movePoints = s.maxMovePoints;
  });

  if (!movedAny) {
    const dbg = (scene.ships || []).map(s => `ship#${s.docksId}@${s.q},${s.r} mp=${s.movePoints} mode=${s.mode} 🍖${s.cargoFood}`).join(' | ');
    console.log(`[SHIP] No ships moved. Current ships: ${dbg}`);
  }
}

/** Build a land hauler at the currently selected unit (mobile base). */
export function buildHaulerAtSelectedUnit() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  const u = scene.selectedUnit;
  if (!u) { console.warn('[HAULER] No selected unit (mobile base) to build from.'); return; }

  scene.haulers = scene.haulers || [];

  // Create at the base hex
  const pos = scene.axialToWorld(u.q, u.r);
  const t = scene.add.text(pos.x, pos.y, '🚚', {
    fontSize: '20px',
    color: '#ffffff'
  }).setOrigin(0.5).setDepth(UI.zBuilding);

  const hauler = {
    type: 'hauler',
    name: 'Hauler',
    emoji: '🚚',
    isNaval: false,
    q: u.q, r: u.r,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,
    cargoFood: 0,
    cargoObj: null,
    mode: 'idle',            // 'idle' | 'toDocks' | 'returningToBase'
    baseQ: u.q, baseR: u.r,  // where to bring food back
    targetDocksId: null,     // set by route picker
  };

  scene.haulers.push(hauler);
  _ensureCargoLabel(scene, hauler);
  _repositionCargoLabel(scene, hauler);
  console.log(`[HAULER] Built at base (${u.q},${u.r}).`);
}

/** Pick a docks hex for the hauler of the current selection (or first hauler if none). */
export function enterHaulerRoutePicker() {
  const scene = /** @type {Phaser.Scene & any} */ (this);

  // choose which hauler to set: prefer selected unit if it's a hauler
  let targetHauler = null;
  const sel = scene.selectedUnit;
  if (sel && sel.type === 'hauler') {
    targetHauler = sel;
  } else {
    targetHauler = (scene.haulers || [])[0] || null;
  }
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
    0x000000, 0.001
  )
    .setInteractive({ useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(UI.zOverlay);

  console.log('[HAULER] Click a docks to set as pickup point…');

  overlay.once('pointerdown', pointer => {
    const approx = scene.pixelToHex(pointer.worldX - (scene.mapOffsetX || 0),
                                    pointer.worldY - (scene.mapOffsetY || 0),
                                    scene.hexSize);
    const rounded = scene.roundHex(approx.q, approx.r);

    // bounds
    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[HAULER] Route pick out of bounds.');
      overlay.destroy();
      return;
    }

    // find docks at this hex
    const docks = (scene.buildings || []).find(b => b.type === 'docks' && b.q === rounded.q && b.r === rounded.r);
    if (!docks) {
      console.warn('[HAULER] You must select an existing docks hex.');
      overlay.destroy();
      return;
    }

    targetHauler.targetDocksId = docks.id;
    // If currently idle or at base, start heading to docks next turn
    if (targetHauler.mode === 'idle') targetHauler.mode = 'toDocks';

    console.log(`[HAULER] Hauler will pick up from docks#${docks.id} at (${docks.q},${docks.r}).`);
    overlay.destroy();
  });
}

/** Hauler shuttle logic (call on End Turn, after ships ideally). */
export function applyHaulerBehaviorOnEndTurn(scene) {
  const haulers = scene.haulers || [];
  if (haulers.length === 0) return;

  // Ensure scene base storage exists
  if (typeof scene.mobileBaseStorageFood !== 'number') scene.mobileBaseStorageFood = 0;

  // Ensure UI cargo labels
  haulers.forEach(h => _ensureCargoLabel(scene, h));

  let movedAny = false;

  for (const h of haulers) {
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    if (typeof h.movePoints !== 'number') h.movePoints = h.maxMovePoints;

    const docks = (scene.buildings || []).find(b => b.type === 'docks' && b.id === h.targetDocksId) || null;

    // Decide target based on mode & cargo
    if (!docks) {
      // no target docks → idle
      h.mode = 'idle';
      h.movePoints = h.maxMovePoints;
      continue;
    }

    // Ensure docks label exists
    _ensureDocksStoreLabel(scene, docks);

    // if carrying cargo and not heading to base, switch to returning
    if (h.cargoFood > 0 && h.mode !== 'returningToBase') h.mode = 'returningToBase';
    // if no cargo and not heading to docks, go to docks
    if (h.cargoFood === 0 && h.mode === 'idle') h.mode = 'toDocks';

    let targetQ = h.q, targetR = h.r;
    if (h.mode === 'toDocks') { targetQ = docks.q; targetR = docks.r; }
    else if (h.mode === 'returningToBase') { targetQ = h.baseQ; targetR = h.baseR; }

    // arrival handling
    if (h.q === targetQ && h.r === targetR) {
      if (h.mode === 'toDocks') {
        // pick up up to 5, but limited by docks storage and capacity
        const room = Math.max(0, HAULER_CARGO_CAP - h.cargoFood);
        const take = Math.min(room, docks.storageFood || 0);
        docks.storageFood = Math.max(0, (docks.storageFood || 0) - take);
        h.cargoFood += take;
        _updateCargoLabel(scene, h);
        _updateDocksStoreLabel(scene, docks);
        console.log(`[HAULER] Picked up 🍖×${take} from docks#${docks.id}. Hauler cargo=${h.cargoFood}, docks=${docks.storageFood}/${DOCKS_STORAGE_CAP}.`);
        h.mode = 'returningToBase';
      } else if (h.mode === 'returningToBase') {
        // deposit to base storage
        if (h.cargoFood > 0) {
          scene.mobileBaseStorageFood += h.cargoFood;
          console.log(`[BASE] Received 🍖×${h.cargoFood}. Base total=${scene.mobileBaseStorageFood}.`);
          h.cargoFood = 0;
          _updateCargoLabel(scene, h);
        }
        // head back to docks if assigned
        h.mode = 'toDocks';
      }
      h.movePoints = h.maxMovePoints;
      continue;
    }

    // move if MPs
    if (h.movePoints <= 0) continue;

    // Land-only path (blocks water)
    const path = _landPath(scene, h.q, h.r, targetQ, targetR);
    if (!path || path.length <= 1) {
      console.warn(`[HAULER] No land path from (${h.q},${h.r}) to (${targetQ},${targetR}).`);
      continue;
    }

    const steps = Math.min(h.movePoints, path.length - 1);
    const nx = path[steps];
    h.q = nx.q; h.r = nx.r;
    h.movePoints -= steps;

    const p = scene.axialToWorld(h.q, h.r);
    h.obj.setPosition(p.x, p.y);
    _repositionCargoLabel(scene, h);
    movedAny = true;
  }

  // regen MPs at end
  haulers.forEach(h => { h.movePoints = h.maxMovePoints; });

  if (!movedAny) {
    const dbg = haulers.map(h => `hauler@${h.q},${h.r} mode=${h.mode} mp=${h.movePoints} 🍖${h.cargoFood}`).join(' | ');
    console.log(`[HAULER] No haulers moved. ${dbg}`);
  }
}

/* =========================
   Docks placement & menu (unchanged UI + storage label)
   ========================= */

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
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const label = scene.add.text(0, 0, `${BUILDINGS.docks.emoji}  ${BUILDINGS.docks.name}`, {
    fontSize: `${UI.labelFontSize}px`,
    color: COLORS.labelText,
  }).setOrigin(0.5);

  const pad = 6;
  const w = Math.max(64, label.width + pad * 2);
  const h = Math.max(26, label.height + pad * 2);

  const box = scene.add.graphics();
  box.fillStyle(COLORS.plate, 0.92);
  box.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
  box.lineStyle(2, COLORS.stroke, 0.9);
  box.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);

  const hit = scene.add.rectangle(0, 0, w, h, 0x000000, 0)
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  container.add([box, label, hit]);

  const building = {
    id,
    type: BUILDINGS.docks.key,
    name: BUILDINGS.docks.name,
    emoji: BUILDINGS.docks.emoji,
    q, r,
    container,
    routeMarker: null,
    menu: null,
    overlay: null,
    route: null,            // {q,r}
    storageFood: 0,         // 0..10
    storageObj: null,       // 🍖×N label
  };

  scene.buildings.push(building);
  _ensureDocksStoreLabel(scene, building);
  _updateDocksStoreLabel(scene, building);

  hit.on('pointerdown', () => {
    _openBuildingMenu(scene, building);
  });

  console.log(`[BUILD] Docks placed at (${q},${r}) — ${reason}`);
}

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
  overlay.on('pointerdown', () => _closeBuildingMenu(scene, building));
  building.overlay = overlay;

  const pos = scene.axialToWorld(building.q, building.r);
  const menu = scene.add.container(pos.x, pos.y - 56).setDepth(UI.zMenu);
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
  const defs = [
    { text: 'Build a ship', onClick: () => _buildShip(scene, building) },
    { text: 'Set route',    onClick: () => _enterRoutePicker(scene, building) },
    { text: 'Recall ships', onClick: () => _recallShips(scene, building) },
    { text: 'Destroy',      onClick: () => _destroyBuilding(scene, building) },
  ];

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

    hit.on('pointerdown', () => onClick?.());
    menu.add([g, t, hit]);
  };

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

/* ---------- Ships (build, route, recall) ---------- */
function _buildShip(scene, building) {
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
    mode: 'toTarget',         // 'toTarget' | 'harvesting' | 'returning'
    harvestTurnsRemaining: 0,
    harvestAt: null,
  };
  scene.ships.push(ship);

  _ensureCargoLabel(scene, ship);
  _repositionCargoLabel(scene, ship);
  console.log(`[DOCKS] Built Ship at (${ship.q},${ship.r}) for docks#${building.id}`);
}

function _enterRoutePicker(scene, building) {
  const ships = (scene.ships || []).filter(s => s.docksId === building.id);
  if (ships.length === 0) { console.log(`[DOCKS] Set route: no ships for docks#${building.id}`); return; }

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001
  )
    .setInteractive({ useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(UI.zOverlay);

  console.log('[DOCKS] Click a reachable water hex to set route…');

  overlay.once('pointerdown', pointer => {
    const approx = scene.pixelToHex(pointer.worldX - (scene.mapOffsetX || 0),
                                    pointer.worldY - (scene.mapOffsetY || 0),
                                    scene.hexSize);
    const rounded = scene.roundHex(approx.q, approx.r);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[DOCKS] Route pick out of bounds — cancelled');
      overlay.destroy();
      return;
    }

    if (!_isWater(scene, rounded.q, rounded.r)) {
      console.warn('[DOCKS] Route must be on water.');
      overlay.destroy();
      return;
    }
    if (!_reachableOnWater(scene, building.q, building.r, rounded.q, rounded.r)) {
      console.warn('[DOCKS] Route water hex is not reachable by water.');
      overlay.destroy();
      return;
    }

    _setRouteMarker(scene, building, rounded.q, rounded.r);
    console.log(`[DOCKS] Route set for docks#${building.id} at (${rounded.q},${rounded.r}).`);
    overlay.destroy();
  });
}

function _setRouteMarker(scene, building, q, r) {
  if (building.routeMarker) { building.routeMarker.destroy(true); building.routeMarker = null; }
  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const t = scene.add.text(0, 0, 'X', {
    fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);

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
  if (ships.length === 0) { console.log(`[DOCKS] Recall: no ships for docks#${building.id}`); return; }

  ships.forEach(s => {
    s.q = building.q; s.r = building.r;
    const p = scene.axialToWorld(s.q, s.r);
    s.obj.setPosition(p.x, p.y);
    _repositionCargoLabel(scene, s);
  });

  console.log(`[DOCKS] Ships recalled to docks#${building.id} at (${building.q},${building.r}).`);
}

/* =========================
   Docks storage label
   ========================= */
function _ensureDocksStoreLabel(scene, docks) {
  if (docks.storageObj && !docks.storageObj.destroyed) return;
  const pos = scene.axialToWorld(docks.q, docks.r);
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

/* =========================
   Helpers: map, neighbors, paths (ODD-R OFFSET)
   ========================= */

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

function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const evenNE = [0, -1], evenE = [+1, 0], evenSE = [0, +1];
  const evenSW = [-1, +1], evenW = [-1, 0], evenNW = [-1, -1];
  const oddNE  = [+1, -1], oddE  = [+1, 0], oddSE  = [+1, +1];
  const oddSW  = [0, +1],  oddW  = [-1, 0], oddNW  = [0, -1];
  const deltas = isOdd
    ? [oddNE, oddE, oddSE, oddSW, oddW, oddNW]
    : [evenNE, evenE, evenSE, evenSW, evenW, evenNW];
  return deltas.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}
function _neighbors(q, r) { return _offsetNeighbors(q, r); }

/* nearest water within radius (BFS) */
function _nearestWaterWithin(scene, uq, ur, maxRadius = 3) {
  const key = (q, r) => `${q},${r}`;
  const seen = new Set([key(uq, ur)]);
  const qArr = [{ q: uq, r: ur, dist: 0 }];

  while (qArr.length) {
    const cur = qArr.shift();
    if (cur.dist > maxRadius) break;

    if (_isWater(scene, cur.q, cur.r) && BUILDINGS.docks.validateTile(scene, cur.q, cur.r)) {
      if (!(cur.q === uq && cur.r === ur)) return { q: cur.q, r: cur.r };
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

/* coastal water: land neighbor → its water neighbors */
function _computeCoastalWater(scene, uq, ur) {
  const set = new Set(), out = [];
  const add = (q, r) => { const k = `${q},${r}`; if (!set.has(k)) { set.add(k); out.push({ q, r }); } };

  for (const h of _offsetNeighbors(uq, ur)) {
    if (h.q < 0 || h.r < 0 || h.q >= scene.mapWidth || h.r >= scene.mapHeight) continue;
    if (_isLand(scene, h.q, h.r)) {
      for (const n of _offsetNeighbors(h.q, h.r)) {
        if (n.q < 0 || n.r < 0 || n.q >= scene.mapWidth || n.r >= scene.mapHeight) continue;
        if (_isWater(scene, n.q, n.r)) add(n.q, n.r);
      }
    }
  }
  return out;
}

/* water-only reachability */
function _reachableOnWater(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene, fromQ, fromR) || !_isWater(scene, toQ, toR)) return false;
  if (fromQ === toQ && fromR === toR) return true;
  return !!_waterPath(scene, fromQ, fromR, toQ, toR);
}

/* BFS water shortest path */
function _waterPath(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene, toQ, toR) || !_isWater(scene, fromQ, fromR)) return null;

  const key = (q, r) => `${q},${r}`;
  const cameFrom = new Map();
  const seen = new Set([key(fromQ, fromR)]);
  const qArr = [{ q: fromQ, r: fromR }];

  while (qArr.length) {
    const cur = qArr.shift();
    if (cur.q === toQ && cur.r === toR) {
      const path = [];
      let node = cur, k = key(cur.q, cur.r);
      while (node) {
        path.push({ q: node.q, r: node.r });
        const prev = cameFrom.get(k);
        if (!prev) break;
        k = key(prev.q, prev.r);
        node = prev;
      }
      return path.reverse();
    }

    for (const n of _offsetNeighbors(cur.q, cur.r)) {
      if (n.q < 0 || n.r < 0 || n.q >= scene.mapWidth || n.r >= scene.mapHeight) continue;
      if (!_isWater(scene, n.q, n.r)) continue;
      const nk = key(n.q, n.r);
      if (seen.has(nk)) continue;
      seen.add(nk);
      cameFrom.set(nk, cur);
      qArr.push(n);
    }
  }
  return null;
}

/* BFS land shortest path (blocks water) */
function _landPath(scene, fromQ, fromR, toQ, toR) {
  if (!_isLand(scene, toQ, toR) || !_isLand(scene, fromQ, fromR)) {
    // allow the hauler to path to docks hex even if docks is water-adjacent?
    // Docks are placed on water; hauler must stop on adjacent land and then “arrive”
    // But per spec, the hauler should reach docks hex. We’ll allow target to be docks hex
    // if it’s the docks location, by converting target to nearest land neighbor.
    const docks = (scene.buildings || []).find(b => b.type === 'docks' && b.q === toQ && b.r === toR);
    if (docks) {
      // try any adjacent land as final node
      const adjLand = _offsetNeighbors(toQ, toR).filter(n => _isLand(scene, n.q, n.r));
      if (adjLand.length) {
        // change target to a reachable land neighbor of docks
        const best = adjLand[0];
        toQ = best.q; toR = best.r;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const key = (q, r) => `${q},${r}`;
  const cameFrom = new Map();
  const seen = new Set([key(fromQ, fromR)]);
  const qArr = [{ q: fromQ, r: fromR }];

  while (qArr.length) {
    const cur = qArr.shift();
    if (cur.q === toQ && cur.r === toR) {
      const path = [];
      let node = cur, k = key(cur.q, cur.r);
      while (node) {
        path.push({ q: node.q, r: node.r });
        const prev = cameFrom.get(k);
        if (!prev) break;
        k = key(prev.q, prev.r);
        node = prev;
      }
      return path.reverse();
    }

    for (const n of _offsetNeighbors(cur.q, cur.r)) {
      if (n.q < 0 || n.r < 0 || n.q >= scene.mapWidth || n.r >= scene.mapHeight) continue;
      if (!_isLand(scene, n.q, n.r)) continue;
      const nk = key(n.q, n.r);
      if (seen.has(nk)) continue;
      seen.add(nk);
      cameFrom.set(nk, cur);
      qArr.push(n);
    }
  }
  return null;
}

/* =========================
   Debug path polyline (cyan)
   ========================= */
function _debugDrawWaterPath(scene, path) {
  try {
    if (!path || path.length < 2) return;
    if (scene._shipPathGfx) scene._shipPathGfx.destroy();
    const g = scene.add.graphics().setDepth(2400);
    scene._shipPathGfx = g;

    g.lineStyle(2, 0x6fe3ff, 0.9);
    let p0 = scene.axialToWorld(path[0].q, path[0].r);
    for (let i = 1; i < path.length; i++) {
      const p1 = scene.axialToWorld(path[i].q, path[i].r);
      g.strokeLineShape(new Phaser.Geom.Line(p0.x, p0.y, p1.x, p1.y));
      p0 = p1;
    }
    scene.tweens.add({ targets: g, alpha: 0, duration: 900, delay: 600, onComplete: () => g.destroy() });
  } catch {}
}

/* =========================
   Resource helpers (fish) + cargo labels
   ========================= */
function _fishAt(scene, q, r) {
  const res = (scene.resources || []).find(o => o.type === 'fish' && o.q === q && o.r === r);
  return !!res;
}

function _ensureCargoLabel(scene, unit) {
  if (unit.cargoObj && !unit.cargoObj.destroyed) return;
  unit.cargoObj = scene.add.text(0, 0, '', {
    fontSize: '14px',
    color: COLORS.cargoText,
  }).setOrigin(0, 1).setDepth(UI.zCargo);
  _updateCargoLabel(scene, unit);
  _repositionCargoLabel(scene, unit);
}
function _updateCargoLabel(scene, unit) {
  if (!unit.cargoObj) return;
  const n = unit.cargoFood || 0;
  unit.cargoObj.setText(n > 0 ? `🍖×${n}` : '');
}
function _repositionCargoLabel(scene, unit) {
  if (!unit.cargoObj) return;
  const p = scene.axialToWorld(unit.q, unit.r);
  unit.cargoObj.setPosition(p.x + 10, p.y - 6);
}

/* =========================
   Misc
   ========================= */
function _getRandom(arr, scene) {
  if (!arr || arr.length === 0) return null;
  const rnd = scene?.rng || scene?.hexMap?.rng || Math.random;
  const i = Math.floor(rnd() * arr.length);
  return arr[i];
}
