// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   Centralized building logic and building UI.
   - Docks (🚢): auto-placed from the unit panel button.
   - Max 2 docks total.
   - Click a docks to open its 4-option menu:
       Build a ship, Set route, Recall ships, Destroy building
   - Ships: simple unselectable emoji sprites tied to a docks by id.
   - Set route: world overlay to pick a hex, mark with "X" box, teleport ships.
   ======================================================================= */

const COLORS = {
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  labelText: '#e8f6ff',
  xMarkerPlate: 0x112633,
  xMarkerStroke: 0x3da9fc,
};

const UI = {
  labelFontSize: 16,
  boxRadius: 8,
  boxStrokeAlpha: 0.9,
  zBuilding: 2100,     // above map / path previews / meta badge
  zOverlay: 2200,      // overlay to capture route clicks
  zMenu: 2300,         // building menu depth above everything
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
      // disallow duplicate at exact hex
      if (Array.isArray(scene.buildings) && scene.buildings.some(b => b.q === q && b.r === r)) return false;
      return true;
    },
  },
};

/* =========================
   Public API
   ========================= */

/** Called from unit panel "Docks" button */
export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Docks: no unit selected.');
    return;
  }

  // Enforce at most 2 docks in the world
  const count = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (count >= 2) {
    console.warn('[BUILD] Docks: limit reached (2). New docks will not spawn.');
    return;
  }

  const u = scene.selectedUnit;

  // 1) Direct ring-1 water
  const ring1 = _neighbors(u.q, u.r)
    .filter(({ q, r }) => _isWater(scene, q, r))
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

  if (ring1.length) {
    const pick = _getRandom(ring1, scene);
    _placeDocks(scene, pick.q, pick.r, 'ring-1 water');
    return;
  }

  // 2) Coastal water: land neighbor's water
  const coastal = _computeCoastalWater(scene, u.q, u.r)
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));
  if (coastal.length) {
    const pick = _getRandom(coastal, scene);
    _placeDocks(scene, pick.q, pick.r, 'coastal water');
    return;
  }

  // 3) Fallback: nearest water ≤ 3
  const nearest = _nearestWaterWithin(scene, u.q, u.r, 3);
  if (nearest && BUILDINGS.docks.validateTile(scene, nearest.q, nearest.r)) {
    _placeDocks(scene, nearest.q, nearest.r, 'fallback radius≤3');
    return;
  }

  console.warn('[BUILD] Docks: no nearby water found (ring-1/coastal/≤3).');
}

export function cancelPlacement() {} // no-op (kept for compatibility)
export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeDocks(scene, q, r, 'direct place');
}

/* =========================
   Internal: Docks placement & UI
   ========================= */

function _placeDocks(scene, q, r, reason = '') {
  // Limit check again here for safety
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

  // label
  const label = scene.add.text(0, 0, `${BUILDINGS.docks.emoji}  ${BUILDINGS.docks.name}`, {
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

  // hit zone to open building menu
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
    containerId: container.id,
    routeMarker: null,      // text container for "X"
    menu: null,             // building menu container
  };
  scene.buildings.push(building);

  // open menu on click
  hit.on('pointerdown', () => {
    _toggleBuildingMenu(scene, building);
  });

  console.log(`[BUILD] Docks placed at (${q},${r}) — ${reason}`);
}

/* ---------- Building menu (4 options) ---------- */
function _toggleBuildingMenu(scene, building) {
  // close any other open building menu
  _closeAnyBuildingMenu(scene, building.id);

  if (building.menu && building.menu.active) {
    _closeBuildingMenu(scene, building);
    return;
  }

  const pos = scene.axialToWorld(building.q, building.r);
  const menu = scene.add.container(pos.x, pos.y - 48).setDepth(UI.zMenu);
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

  // 2x2 grid
  const btnSize = 70, pad = 8;
  const startX = -W/2 + 12, startY = -H/2 + 12;

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

    hit.on('pointerdown', () => {
      onClick?.();
    });

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
  menu.sendToBack(bg);
  menu.sendToBack(bezel);
  menu.active = true;
}

function _closeAnyBuildingMenu(scene, exceptId) {
  (scene.buildings || []).forEach(b => {
    if (b.menu && b.id !== exceptId) _closeBuildingMenu(scene, b);
  });
}
function _closeBuildingMenu(scene, building) {
  if (building.menu) {
    building.menu.destroy(true);
    building.menu = null;
  }
}

/* ---------- Ships ---------- */
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
    q: building.q,
    r: building.r,
    docksId: building.id,
    obj: t,
  };
  scene.ships.push(ship);

  console.log(`[DOCKS] Built Ship at (${ship.q},${ship.r}) for docks#${building.id}`);
}

function _enterRoutePicker(scene, building) {
  // if no ships at all for this docks, do nothing
  const ships = (scene.ships || []).filter(s => s.docksId === building.id);
  if (ships.length === 0) {
    console.log(`[DOCKS] Set route: no ships for docks#${building.id} — nothing to do`);
    return;
  }

  // WORLD OVERLAY to capture next click without moving units
  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001 // almost transparent, but catches input
  )
    .setInteractive({ useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(UI.zOverlay);

  console.log('[DOCKS] Click a hex to set route…');

  const once = (pointer) => {
    // compute hex from world coords
    const approx = scene.pixelToHex(pointer.worldX - (scene.mapOffsetX || 0),
                                    pointer.worldY - (scene.mapOffsetY || 0),
                                    scene.hexSize);
    const rounded = scene.roundHex(approx.q, approx.r);

    // bounds guard (use 25x25 map default)
    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[DOCKS] Route pick out of bounds — cancelled');
      overlay.destroy();
      return;
    }

    // place/update "X" marker for this docks
    _setRouteMarker(scene, building, rounded.q, rounded.r);

    // teleport all ships of this docks to the route hex
    (scene.ships || []).forEach(s => {
      if (s.docksId !== building.id) return;
      s.q = rounded.q; s.r = rounded.r;
      const p = scene.axialToWorld(s.q, s.r);
      s.obj.setPosition(p.x, p.y);
    });

    console.log(`[DOCKS] Route set for docks#${building.id} at (${rounded.q},${rounded.r}); ships teleported.`);
    overlay.destroy();
  };

  overlay.once('pointerdown', once);
}

function _setRouteMarker(scene, building, q, r) {
  // remove prior marker
  if (building.routeMarker) {
    building.routeMarker.destroy(true);
    building.routeMarker = null;
  }

  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const t = scene.add.text(0, 0, 'X', {
    fontSize: '18px',
    color: '#ffffff',
    fontStyle: 'bold',
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
  if (ships.length === 0) {
    console.log(`[DOCKS] Recall: no ships for docks#${building.id} — nothing to do`);
    return;
  }

  ships.forEach(s => {
    s.q = building.q; s.r = building.r;
    const p = scene.axialToWorld(s.q, s.r);
    s.obj.setPosition(p.x, p.y);
  });

  console.log(`[DOCKS] Ships recalled to docks#${building.id} at (${building.q},${building.r}).`);
}

function _destroyBuilding(scene, building) {
  // remove visual container
  const cont = scene.children.getByID?.(building.containerId);
  if (cont) cont.destroy(true);

  // remove marker and menu if any
  if (building.routeMarker) {
    building.routeMarker.destroy(true);
    building.routeMarker = null;
  }
  _closeBuildingMenu(scene, building);

  // remove from array
  scene.buildings = (scene.buildings || []).filter(b => b !== building);

  console.log(`[BUILD] Docks at (${building.q},${building.r}) destroyed.`);
}

/* =========================
   Finder / geometry helpers
   ========================= */

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
function _nearestWaterWithin(scene, uq, ur, radius = 3) {
  for (let rr = 1; rr <= radius; rr++) {
    const ring = _ring(uq, ur, rr).filter(({ q, r }) => _isWater(scene, q, r));
    const valid = ring.filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));
    if (valid.length > 0) return valid[0];
  }
  return null;
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
