// deephexbeta/src/scenes/WorldSceneBuildings.js

/* =========================================================================
   Building logic and UI (modal menu).
   - Docks (🚢): At most 2 docks on the map.
   - Click docks: shows 4-option menu (modal; locks hex inspect & clicks).
       Build a ship • Set route • Recall ships • Destroy
   - Set route: pick only reachable water hex (water-only BFS). Marks hex with "X".
   - End turn: ships MOVE along water path (8 MP/turn). MPs regen AFTER end turn.
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
  zBuilding: 2100,     // above terrain
  zOverlay: 2290,      // modal overlay (below menu, above everything else)
  zMenu: 2300,         // building menu
};

const AXIAL_DIRS = [
  { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
];

export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emoji: '🚢', // :ship:
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t || !_isWater(scene, q, r)) return false;
      const u = scene.selectedUnit; // anchor placement to a selected unit
      if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return false;
      // disallow duplicate at exact hex
      if (Array.isArray(scene.buildings) && scene.buildings.some(b => b.q === q && b.r === r)) return false;
      return true;
    },
  },
};

/* =========================
   Public API (named exports)
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

export function cancelPlacement() {
  // kept for compatibility; nothing to cancel in auto-placement version
}

/** Direct place (kept for internal calls) */
export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _placeDocks(scene, q, r, 'direct place');
}

/** Called from WorldScene.endTurn() */
export function applyShipRoutesOnEndTurn(scene) {
  const buildings = scene.buildings || [];
  const ships = scene.ships || [];
  if (ships.length === 0) {
    // nothing to do
    return;
  }

  let movedAny = false;

  buildings.forEach(b => {
    if (b.type !== 'docks' || !b.route) return;
    const target = b.route;

    ships.forEach(s => {
      if (s.docksId !== b.id) return;

      // Initialize MPs if missing
      if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
      if (typeof s.movePoints !== 'number') s.movePoints = s.maxMovePoints;

      // Already at target
      if (s.q === target.q && s.r === target.r) {
        return;
      }

      // No MPs? skip movement this turn
      if (s.movePoints <= 0) {
        console.log(`[SHIP] docks#${b.id} ship@${s.q},${s.r} has 0 MP — skip`);
        return;
      }

      // Path from current ship pos to target (water-only)
      const path = _waterPath(scene, s.q, s.r, target.q, target.r);
      if (!path || path.length <= 1) {
        console.warn(`[SHIP] docks#${b.id} ship@${s.q},${s.r} no water path to ${target.q},${target.r}`);
        return;
      }

      // NEW: draw + verbose log
      _debugDrawWaterPath(scene, path);
      console.log(
        `[SHIP] docks#${b.id} water path len=${path.length}: `,
        path.map(n => `(${n.q},${n.r})`).join('→')
      );

      const stepsAvailable = Math.min(s.movePoints, path.length - 1);
      const nextHex = path[stepsAvailable];

      console.log(
        `[SHIP] docks#${b.id} ship@${s.q},${s.r} → target ${target.q},${target.r} | ` +
        `mp=${s.movePoints} | steps=${stepsAvailable} | new=${nextHex.q},${nextHex.r}`
      );

      // Apply move
      s.q = nextHex.q;
      s.r = nextHex.r;
      s.movePoints -= stepsAvailable;

      const p = scene.axialToWorld(s.q, s.r);
      s.obj.setPosition(p.x, p.y);

      movedAny = true;
    });
  });

  // MPs regenerate AFTER the end-turn move resolution so next turn they can move again
  (scene.ships || []).forEach(s => {
    if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
    s.movePoints = s.maxMovePoints;
  });

  if (!movedAny) {
    const dbg = (scene.ships || []).map(s => `ship(docks#${s.docksId})@${s.q},${s.r} mp=${s.movePoints}`).join(' | ');
    console.log(`[SHIP] No ships moved. Current ships: ${dbg}`);
  }
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
    container,           // store the actual container object
    routeMarker: null,   // text container for "X"
    menu: null,          // building menu container
    overlay: null,       // modal overlay container
    route: null,         // {q,r}
  };
  scene.buildings.push(building);

  // open menu on click
  hit.on('pointerdown', () => {
    _openBuildingMenu(scene, building);
  });

  console.log(`[BUILD] Docks placed at (${q},${r}) — ${reason}`);
}

/* ---------- Modal building menu (4 options) ---------- */
function _openBuildingMenu(scene, building) {
  _closeAnyBuildingMenu(scene, building.id); // close others

  // Lock hex inspect & map clicks
  scene.uiLock = 'buildingMenu';

  // Create a full-screen dismiss overlay (captures outside clicks)
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

  overlay.on('pointerdown', () => {
    // click outside: close menu
    _closeBuildingMenu(scene, building);
  });
  building.overlay = overlay;

  // Menu appears above the building
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
  if (building.overlay) {
    building.overlay.destroy(true);
    building.overlay = null;
  }
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null; // release lock
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
    isNaval: true,        // <— mark as naval
    q: building.q,
    r: building.r,
    docksId: building.id,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,
  };
  scene.ships.push(ship);

  console.log(`[DOCKS] Built Ship at (${ship.q},${ship.r}) for docks#${building.id}`);
}

/* ---------- Route picking (only reachable water) ---------- */
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
    0x000000, 0.001 // almost transparent
  )
    .setInteractive({ useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(UI.zOverlay);

  console.log('[DOCKS] Click a reachable water hex to set route…');

  const once = (pointer) => {
    // compute hex from world coords
    const approx = scene.pixelToHex(pointer.worldX - (scene.mapOffsetX || 0),
                                    pointer.worldY - (scene.mapOffsetY || 0),
                                    scene.hexSize);
    const rounded = scene.roundHex(approx.q, approx.r);

    // bounds guard
    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[DOCKS] Route pick out of bounds — cancelled');
      overlay.destroy();
      return;
    }

    // must be water and reachable from docks via water connections
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

    // place/update "X" marker for this docks
    _setRouteMarker(scene, building, rounded.q, rounded.r);

    console.log(`[DOCKS] Route set for docks#${building.id} at (${rounded.q},${rounded.r}).`);
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
    // Keep their remaining MPs (don’t refill on arrival)
  });

  console.log(`[DOCKS] Ships recalled to docks#${building.id} at (${building.q},${building.r}).`);
}

function _destroyBuilding(scene, building) {
  // remove visual container
  if (building.container) {
    building.container.destroy(true);
    building.container = null;
  }

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
  // tolerant to generator variants
  return !!t && (t.type === 'water' || t.type === 'ocean' || t.type === 'sea');
}
function _isLand(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && !_isWater(scene, q, r);
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

/** find “coastal” water hexes adjacent to land neighbors within radius 1 of (uq,ur) */
function _computeCoastalWater(scene, uq, ur) {
  const set = new Set();
  const out = [];
  const add = (q, r) => {
    const k = `${q},${r}`;
    if (!set.has(k)) { set.add(k); out.push({ q, r }); }
  };
  // check ring-1 around the unit; if that hex is land, push its water neighbors
  const around = _neighbors(uq, ur);
  for (const h of around) {
    if (h.q < 0 || h.r < 0 || h.q >= scene.mapWidth || h.r >= scene.mapHeight) continue;
    if (_isLand(scene, h.q, h.r)) {
      for (const n of _neighbors(h.q, h.r)) {
        if (n.q < 0 || n.r < 0 || n.q >= scene.mapWidth || n.r >= scene.mapHeight) continue;
        if (_isWater(scene, n.q, n.r)) add(n.q, n.r);
      }
    }
  }
  return out;
}

/* ---------- water-only reachability (BFS) ---------- */
function _reachableOnWater(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene, fromQ, fromR) || !_isWater(scene, toQ, toR)) return false;
  if (fromQ === toQ && fromR === toR) return true;
  return !!_waterPath(scene, fromQ, fromR, toQ, toR);
}

/* ---------- water-only shortest path (BFS) ---------- */
function _waterPath(scene, fromQ, fromR, toQ, toR) {
  // bounds & type checks
  if (!_isWater(scene, toQ, toR)) return null;
  if (!_isWater(scene, fromQ, fromR)) return null;

  const key = (q, r) => `${q},${r}`;
  const cameFrom = new Map();
  const seen = new Set([key(fromQ, fromR)]);
  const qArr = [{ q: fromQ, r: fromR }];

  while (qArr.length) {
    const cur = qArr.shift();
    if (cur.q === toQ && cur.r === toR) {
      // reconstruct path
      const path = [];
      let k = key(cur.q, cur.r);
      let node = cur;
      while (node) {
        path.push({ q: node.q, r: node.r });
        const prev = cameFrom.get(k);
        if (!prev) break;
        k = key(prev.q, prev.r);
        node = prev;
      }
      path.reverse();
      return path;
    }

    for (const n of _neighbors(cur.q, cur.r)) {
      if (n.q < 0 || n.r < 0 || n.q >= scene.mapWidth || n.r >= scene.mapHeight) continue;
      if (!_isWater(scene, n.q, n.r)) continue;
      const nk = key(n.q, n.r);
      if (seen.has(nk)) continue;
      seen.add(nk);
      cameFrom.set(nk, cur);
      qArr.push(n);
    }
  }
  return null; // unreachable
}

/* ---------- Debug draw for ship water paths ---------- */
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

    // auto-fade
    scene.tweens.add({
      targets: g, alpha: 0, duration: 900, delay: 600,
      onComplete: () => g.destroy()
    });
  } catch {}
}

function _getRandom(arr, scene) {
  if (!arr || arr.length === 0) return null;
  // prefer Phaser RNG if available
  const rnd = scene?.rng || scene?.hexMap?.rng || Math.random;
  const i = Math.floor(rnd() * arr.length);
  return arr[i];
}
