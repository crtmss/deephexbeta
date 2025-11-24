// src/scenes/WorldSceneHaulers.js
// Ships + Haulers module (movement, harvesting, cyan path, labels, route picker)
// Compatible with single-hex Docks (both land & water units can enter docks hex)

///////////////////////////////
// Visual + UI constants (scoped here)
///////////////////////////////
const COLORS = {
  xMarkerPlate: 0x112633,
  xMarkerStroke: 0x3da9fc,
  cargoText: '#ffffff',
  docksStoreText: '#ffffff',
};
const UI = {
  zBuilding: 2100,
  zOverlay: 2290,
  zCargo: 2101,
  zDocksStore: 2101,
};

const DOCKS_STORAGE_CAP = 10;
const SHIP_CARGO_CAP = 2;
const HAULER_CARGO_CAP = 5;

///////////////////////////////
// Public API (named exports)
///////////////////////////////

/** Build a ship at the docks hex. Costs 10 food. */
export function buildShipForDocks(scene, building) {
  _ensureResourceInit(scene);
  if (!_spend(scene, { food: 10 })) {
    console.warn('[SHIP] Not enough 🍖 (need 10).');
    return;
  }

  scene.ships = scene.ships || [];
  const pos = scene.axialToWorld(building.q, building.r);
  const t = scene.add.text(pos.x, pos.y, '🚢', { fontSize: '20px', color: '#ffffff' })
    .setOrigin(0.5).setDepth(UI.zBuilding);

  const ship = {
    type: 'ship',
    name: 'Ship',
    emoji: '🚢',
    isNaval: true,
    q: building.q, r: building.r,   // can sit on docks hex even if land; docks is "both-domain passable"
    docksId: building.id,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,

    // Cargo: can hold multiple resource types, but currently only food is used by ship logic
    cargoFood: 0, // legacy single-resource field (food)
    cargo: {
      food: 0,
      scrap: 0,
      money: 0,
      influence: 0,
    },
    cargoCap: SHIP_CARGO_CAP,
    cargoObj: null,

    mode: 'toTarget',
    harvestTurnsRemaining: 0,
    harvestAt: null,
  };
  scene.ships.push(ship);
  _ensureCargoLabel(scene, ship);
  _repositionCargoLabel(scene, ship);
}

/** Open a click-to-pick route target (water reachability from docks). */
export function openDocksRoutePicker(scene, building) {
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

    // Use scene.worldToAxial (centralized offset logic)
    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const { q, r } = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (q < 0 || r < 0 || q >= scene.mapWidth || r >= scene.mapHeight) {
      console.warn('[DOCKS] Route pick out of bounds — cancelled');
      overlay.destroy(); return;
    }
    if (!_isWater(scene, q, r)) {
      console.warn('[DOCKS] Route must be on water.');
      overlay.destroy(); return;
    }
    // Reachability for ships: allow path from docks hex (even if land) by treating docks as water-passable
    if (!_reachableForShips(scene, building.q, building.r, q, r)) {
      console.warn('[DOCKS] Route water hex is not reachable by water from the docks.');
      overlay.destroy(); return;
    }
    _setRouteMarker(scene, building, q, r);
    overlay.destroy();
  });
}

/** Snap all ships of a docks back to the docks hex. */
export function recallShipsToDocks(scene, building) {
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

/** End-turn execution for ships (move/harvest/return, cyan path, deposit). */
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
    ensureDocksStoreLabel(scene, b);
    updateDocksStoreLabel(scene, b);

    const route = b.route || null;
    const docksShips = ships.filter(s => s.docksId === b.id);

    docksShips.forEach(s => {
      if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
      if (typeof s.movePoints !== 'number') s.movePoints = s.maxMovePoints;
      if (typeof s.cargoFood !== 'number') s.cargoFood = 0;
      if (!s.cargo) {
        s.cargo = { food: s.cargoFood || 0, scrap: 0, money: 0, influence: 0 };
      }
      if (typeof s.cargoCap !== 'number') s.cargoCap = SHIP_CARGO_CAP;
      if (!s.mode) s.mode = 'toTarget';
      _ensureCargoLabel(scene, s);

      // Route changed while harvesting → reset
      if (s.mode === 'harvesting' && route && (s.harvestAt?.q !== route.q || s.harvestAt?.r !== route.r)) {
        s.mode = 'toTarget';
        s.harvestTurnsRemaining = 0;
        s.harvestAt = null;
      }
      // No route but carrying → return
      if (!route && _totalCargo(s) > 0) s.mode = 'returning';

      // Harvest turn (no movement)
      if (s.mode === 'harvesting') {
        if (s.harvestTurnsRemaining > 0) {
          const currentTotal = _totalCargo(s);
          const room = Math.max(0, s.cargoCap - currentTotal);
          const take = Math.min(1, room);
          if (take > 0) {
            s.cargoFood += take;
            s.cargo.food = (s.cargo.food || 0) + take;
            _updateCargoLabel(scene, s);
          }
          s.harvestTurnsRemaining -= 1;
        }
        const full = _totalCargo(s) >= s.cargoCap;
        if (s.harvestTurnsRemaining <= 0 || full) {
          s.mode = 'returning';
        }
        s.movePoints = s.maxMovePoints;
        return;
      }

      // Targets
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
          const bag = s.cargo || {};
          const foodAmt = (bag.food ?? s.cargoFood ?? 0);
          if (foodAmt > 0) {
            const room = Math.max(0, DOCKS_STORAGE_CAP - (b.storageFood || 0));
            const deposit = Math.min(room, foodAmt);
            if (deposit > 0) {
              b.storageFood = (b.storageFood || 0) + deposit;
              s.cargoFood = Math.max(0, (s.cargoFood || 0) - deposit);
              bag.food = Math.max(0, (bag.food || 0) - deposit);
              updateDocksStoreLabel(scene, b);
              _updateCargoLabel(scene, s);
            }
          }
          s.mode = route ? 'toTarget' : 'returning';
        }
        s.movePoints = s.maxMovePoints;
        return;
      }

      // Movement leg (water BFS that treats docks as water-passable)
      if (s.movePoints <= 0) return;
      const path = _shipPath(scene, s.q, s.r, targetQ, targetR);
      if (!path || path.length <= 1) return;

      _drawCyanPath(scene, path);
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

  // Reset MPs for next turn
  (scene.ships || []).forEach(s => {
    if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
    s.movePoints = s.maxMovePoints;
  });

  if (!movedAny) {
    const dbg = (scene.ships || []).map(s => `ship#${s.docksId}@${s.q},${s.r} mp=${s.movePoints} mode=${s.mode} cargo=${JSON.stringify(s.cargo || { food: s.cargoFood || 0 })}`).join(' | ');
    console.log(`[SHIP] No ships moved. Current ships: ${dbg}`);
  }
}

/** Build a hauler at the selected mobile base (cost 10 food). */
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
  const t = scene.add.text(pos.x, pos.y, '🚚', { fontSize: '20px', color: '#ffffff' })
    .setOrigin(0.5).setDepth(UI.zBuilding);

  // ID for logistics UI
  scene._haulerIdSeq = (scene._haulerIdSeq || 0) + 1;
  const id = scene._haulerIdSeq;

  const hauler = {
    id,                          // NEW: unique id
    type: 'hauler',
    name: 'Hauler',
    emoji: '🚚',
    q: u.q, r: u.r,
    obj: t,
    maxMovePoints: 4,
    movePoints: 4,

    // Cargo: multi-resource
    cargoFood: 0, // legacy for compatibility (food)
    cargo: {
      food: 0,
      scrap: 0,
      money: 0,
      influence: 0,
    },
    cargoCap: HAULER_CARGO_CAP,
    cargoObj: null,

    mode: 'idle',
    baseRef: u, baseQ: u.q, baseR: u.r,
    targetDocksId: null,

    // Factorio-style logistics
    logisticsRoute: [],
    routeIndex: 0,
  };

  // Auto-assign nearest docks (by distance to docks hex)
  const docksList = (scene.buildings || []).filter(b => b.type === 'docks');
  if (docksList.length > 0) {
    const best = docksList
      .map(b => ({ b, d: _hexManhattan(u.q, u.r, b.q, b.r) }))
      .sort((a, b) => a.d - b.d)[0].b;
    hauler.targetDocksId = best.id;
    hauler.mode = 'toDocks';
    console.log(`[HAULER] Auto-assigned to docks#${best.id} at (${best.q},${best.r}).`);
  } else {
    console.warn('[HAULER] No docks available to assign route.');
  }

  scene.haulers.push(hauler);
  _ensureCargoLabel(scene, hauler);
  _repositionCargoLabel(scene, hauler);
}

/** End-turn execution for haulers (move/pickup/deposit). */
export function applyHaulerBehaviorOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;
  _ensureResourceInit(scene);

  const haulers = scene.haulers || [];
  if (haulers.length === 0) return;

  let movedAny = false;

  for (const h of haulers) {
    // If this hauler has a logistics route, let LogisticsRuntime handle it.
    if (Array.isArray(h.logisticsRoute) && h.logisticsRoute.length > 0) {
      continue;
    }

    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    if (typeof h.movePoints !== 'number') h.movePoints = h.maxMovePoints;
    if (!h.cargo) {
      h.cargo = { food: h.cargoFood || 0, scrap: 0, money: 0, influence: 0 };
    }
    if (typeof h.cargoCap !== 'number') h.cargoCap = HAULER_CARGO_CAP;
    if (!h.cargoObj || h.cargoObj.destroyed) _ensureCargoLabel(scene, h);

    const docks = (scene.buildings || []).find(b => b.type === 'docks' && b.id === h.targetDocksId) || null;
    if (!docks) { h.mode = 'idle'; h.movePoints = h.maxMovePoints; continue; }

    ensureDocksStoreLabel(scene, docks);
    updateDocksStoreLabel(scene, docks);

    const basePos = _getMobileBaseCoords(scene, h);
    const baseQ = basePos.q, baseR = basePos.r;

    const total = _totalCargo(h);
    if (total > 0 && h.mode !== 'returningToBase') h.mode = 'returningToBase';
    if (total === 0 && h.mode === 'idle') h.mode = 'toDocks';

    let targetQ = h.q, targetR = h.r;
    if (h.mode === 'toDocks') { targetQ = docks.q; targetR = docks.r; }
    else if (h.mode === 'returningToBase') { targetQ = baseQ; targetR = baseR; }

    // Arrived?
    if (h.q === targetQ && h.r === targetR) {
      if (h.mode === 'toDocks') {
        const before = _totalCargo(h);
        const room = Math.max(0, h.cargoCap - before);
        const available = docks.storageFood || 0;
        const take = Math.min(room, available);
        docks.storageFood = Math.max(0, available - take);
        h.cargoFood = (h.cargoFood || 0) + take;
        h.cargo.food = (h.cargo.food || 0) + take;
        updateDocksStoreLabel(scene, docks);
        _updateCargoLabel(scene, h);
        h.mode = 'returningToBase';
      } else if (h.mode === 'returningToBase') {
        const foodAmt = h.cargo?.food ?? h.cargoFood ?? 0;
        if (foodAmt > 0) {
          _gain(scene, { food: foodAmt });
          h.cargoFood = 0;
          if (h.cargo) {
            h.cargo.food = 0;
          }
          _updateCargoLabel(scene, h);
        }
        h.mode = 'toDocks';
      }
      h.movePoints = h.maxMovePoints;
      continue;
    }

    // Move (land BFS that treats docks as land-passable)
    if (h.movePoints <= 0) continue;
    const path = _haulerPath(scene, h.q, h.r, targetQ, targetR);
    if (!path || path.length <= 1) continue;

    _drawCyanPath(scene, path);
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
    const dbg = haulers.map(h => `hauler@${h.q},${h.r} mode=${h.mode} mp=${h.movePoints} cargo=${JSON.stringify(h.cargo || { food: h.cargoFood || 0 })}`).join(' | ');
    console.log(`[HAULER] No haulers moved. ${dbg}`);
  }
}

/** Click UI: assign docks to selected hauler (or first). Bound to scene as `this`. */
export function enterHaulerRoutePicker() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
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
    0x000000, 0.001
  ).setInteractive({ useHandCursor: true })
   .setScrollFactor(0)
   .setDepth(UI.zOverlay);

  console.log('[HAULER] Click a docks (its hex) to set as pickup…');

  overlay.once('pointerdown', (pointer, _lx, _ly, event) => {
    event?.stopPropagation?.();

    // Use worldToAxial here as well
    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const { q, r } = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (q < 0 || r < 0 || q >= scene.mapWidth || r >= scene.mapHeight) {
      console.warn('[HAULER] Route pick out of bounds.');
      overlay.destroy();
      return;
    }

    const docks = (scene.buildings || []).find(b =>
      b.type === 'docks' && (b.q === q && b.r === r)
    );

    if (!docks) {
      console.warn('[HAULER] You must select an existing docks (its hex).');
      overlay.destroy();
      return;
    }

    targetHauler.targetDocksId = docks.id;
    if (targetHauler.mode === 'idle') targetHauler.mode = 'toDocks';
    console.log(`[HAULER] Hauler will pick up from docks#${docks.id} at (${docks.q},${docks.r}).`);
    overlay.destroy();
  });
}

// Back-compat alias (older imports)
export { applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn };

///////////////////////////////
// Docks storage tiny helpers (also used by Buildings after placement)
///////////////////////////////
export function ensureDocksStoreLabel(scene, docks) {
  if (docks.storageObj && !docks.storageObj.destroyed) return;
  const pos = scene.axialToWorld(docks.q, docks.r);
  docks.storageObj = scene.add.text(pos.x + 16, pos.y - 14, '', {
    fontSize: '14px',
    color: COLORS.docksStoreText,
  }).setOrigin(0, 1).setDepth(UI.zDocksStore);
  updateDocksStoreLabel(scene, docks);
}
export function updateDocksStoreLabel(scene, docks) {
  if (!docks.storageObj) return;
  const n = Math.min(DOCKS_STORAGE_CAP, docks.storageFood || 0);
  docks.storageObj.setText(n > 0 ? `🍖×${n}` : '');
}

///////////////////////////////
// Shared logistics helper: move one leg toward a target hex
///////////////////////////////

/**
 * Shared helper for logistics:
 * Move a carrier (ship or hauler) toward (targetQ, targetR) using
 * the existing BFS pathfinders, consume its movePoints, animate,
 * and return true if it is now exactly on the target hex.
 */
export function moveCarrierOneLeg(scene, carrier, targetQ, targetR) {
  if (!scene || !carrier) return false;

  if (typeof carrier.maxMovePoints !== 'number') carrier.maxMovePoints = 8;
  if (typeof carrier.movePoints !== 'number') carrier.movePoints = carrier.maxMovePoints;

  if (carrier.q === targetQ && carrier.r === targetR) {
    return true;
  }

  const isShip = carrier.type === 'ship' || carrier.isNaval;
  const isHauler = carrier.type === 'hauler';

  let path = null;
  if (isShip) {
    path = _shipPath(scene, carrier.q, carrier.r, targetQ, targetR);
  } else if (isHauler) {
    path = _haulerPath(scene, carrier.q, carrier.r, targetQ, targetR);
  } else {
    path = _haulerPath(scene, carrier.q, carrier.r, targetQ, targetR);
  }

  if (!path || path.length <= 1) {
    return carrier.q === targetQ && carrier.r === targetR;
  }

  const steps = Math.min(carrier.movePoints, path.length - 1);
  if (steps <= 0) {
    return carrier.q === targetQ && carrier.r === targetR;
  }

  _drawCyanPath(scene, path.slice(0, steps + 1));

  const nx = path[steps];
  carrier.q = nx.q;
  carrier.r = nx.r;
  carrier.movePoints -= steps;

  const p = scene.axialToWorld(carrier.q, carrier.r);
  carrier.obj?.setPosition(p.x, p.y);
  _repositionCargoLabel(scene, carrier);

  return carrier.q === targetQ && carrier.r === targetR;
}

///////////////////////////////
// Internal helpers (movement, paths, labels, resources, etc.)
///////////////////////////////

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

// ----- Resource system -----
function _ensureResourceInit(scene) {
  // Start the player with 200 of each (synced with Buildings & WorldScene)
  if (!scene.playerResources) {
    scene.playerResources = { food: 200, scrap: 200, money: 200, influence: 200 };
  }
  scene.updateResourceUI?.();
}
function _spend(scene, cost) {
  if (!Object.entries(cost).every(([k, v]) => (scene.playerResources?.[k] ?? 0) >= v)) return false;
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

// ----- Map helpers -----
function _tileAt(scene, q, r) { return scene.mapData?.find?.(t => t.q === q && t.r === r); }
function _isWater(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && (t.type === 'water' || t.type === 'ocean' || t.type === 'sea');
}
function _isLand(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && !_isWater(scene, q, r);
}

// Single-hex docks presence check
function _hasDocksAt(scene, q, r) {
  return (scene.buildings || []).some(b => b.type === 'docks' && b.q === q && b.r === r);
}

// Offsets (odd-r horizontal)
function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0,-1],[+1,0],[0,+1],[-1,+1],[-1,0],[-1,-1]];
  const odd  = [[+1,-1],[+1,0],[+1,+1],[0,+1],[-1,0],[0,-1]];
  const d = isOdd ? odd : even;
  return d.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

function _hexManhattan(q1, r1, q2, r2) {
  return Math.abs(q1 - q2) + Math.abs(r1 - r2);
}

// ----- Passability rules with single-hex docks -----
// For ships (water domain): water tiles are passable; docks hex is also passable (even if underlying tile is land)
function _passableForShip(scene, q, r) {
  return _isWater(scene, q, r) || _hasDocksAt(scene, q, r);
}
// For haulers (land domain): land tiles are passable; docks hex is also passable (even if underlying tile is water)
function _passableForHauler(scene, q, r) {
  return _isLand(scene, q, r) || _hasDocksAt(scene, q, r);
}

// ----- Reachability wrappers -----
function _reachableForShips(scene, fromQ, fromR, toQ, toR) {
  return !!_bfsPath(scene, fromQ, fromR, toQ, toR, _passableForShip);
}
function _reachableForHaulers(scene, fromQ, fromR, toQ, toR) {
  return !!_bfsPath(scene, fromQ, fromR, toQ, toR, _passableForHauler);
}

// ----- Path builders (domain-aware BFS) -----
function _bfsPath(scene, fromQ, fromR, toQ, toR, passableFn) {
  if (fromQ === toQ && fromR === toR) return [{ q: fromQ, r: fromR }];
  const inb = (q, r) => q >= 0 && r >= 0 && q < scene.mapWidth && r < scene.mapHeight;
  const key = (q, r) => `${q},${r}`;
  if (!inb(fromQ, fromR) || !inb(toQ, toR)) return null;

  // Both start and target must be passable
  if (!passableFn(scene, fromQ, fromR) || !passableFn(scene, toQ, toR)) return null;

  const came = new Map();
  const seen = new Set([key(fromQ, fromR)]);
  const qArr = [{ q: fromQ, r: fromR }];

  while (qArr.length) {
    const cur = qArr.shift();
    if (cur.q === toQ && cur.r === toR) {
      // Reconstruct path
      const path = [];
      let node = cur, k = key(cur.q, cur.r);
      while (node) {
        path.push({ q: node.q, r: node.r });
        const prev = came.get(k);
        if (!prev) break;
        k = key(prev.q, prev.r);
        node = prev;
      }
      return path.reverse();
    }
    for (const n of _offsetNeighbors(cur.q, cur.r)) {
      if (!inb(n.q, n.r)) continue;
      if (!passableFn(scene, n.q, n.r)) continue;
      const nk = key(n.q, n.r);
      if (seen.has(nk)) continue;
      seen.add(nk);
      came.set(nk, cur);
      qArr.push(n);
    }
  }
  return null;
}

// Domain-specific wrappers to keep callsites readable
function _shipPath(scene, fromQ, fromR, toQ, toR) {
  return _bfsPath(scene, fromQ, fromR, toQ, toR, _passableForShip);
}
function _haulerPath(scene, fromQ, fromR, toQ, toR) {
  return _bfsPath(scene, fromQ, fromR, toQ, toR, _passableForHauler);
}

// ----- Visual cyan path (shared for both) -----
function _drawCyanPath(scene, path) {
  try {
    if (!path || path.length < 2) return;
    if (scene._cyanPathGfx) scene._cyanPathGfx.destroy();
    const g = scene.add.graphics().setDepth(2400);
    scene._cyanPathGfx = g; g.lineStyle(2, 0x6fe3ff, 0.9);
    let p0 = scene.axialToWorld(path[0].q, path[0].r);
    for (let i = 1; i < path.length; i++) {
      const p1 = scene.axialToWorld(path[i].q, path[i].r);
      g.strokeLineShape(new Phaser.Geom.Line(p0.x, p0.y, p1.x, p1.y)); p0 = p1;
    }
    scene.tweens.add({ targets: g, alpha: 0, duration: 900, delay: 600, onComplete: () => g.destroy() });
  } catch { /* ignore */ }
}

// ----- Misc helpers -----
function _fishAt(scene, q, r) {
  return !!(scene.resources || []).find(o => o.type === 'fish' && o.q === q && o.r === r);
}
function _ensureCargoLabel(scene, unit) {
  if (unit.cargoObj && !unit.cargoObj.destroyed) return;
  unit.cargoObj = scene.add.text(0, 0, '', { fontSize: '14px', color: COLORS.cargoText })
    .setOrigin(0, 1).setDepth(UI.zCargo);
  _updateCargoLabel(scene, unit); _repositionCargoLabel(scene, unit);
}
function _updateCargoLabel(scene, unit) {
  if (!unit.cargoObj) return;

  let text = '';

  if (unit.cargo && typeof unit.cargo === 'object') {
    const parts = [];
    const bag = unit.cargo;
    const keys = ['food', 'scrap', 'money', 'influence'];
    const emoji = { food: '🍖', scrap: '🛠', money: '💰', influence: '⭐' };
    keys.forEach(k => {
      const v = bag[k] || 0;
      if (v > 0) parts.push(`${emoji[k]}×${v}`);
    });
    text = parts.join(' ');
  } else if (typeof unit.cargoFood === 'number') {
    const n = unit.cargoFood;
    text = n > 0 ? `🍖×${n}` : '';
  }

  unit.cargoObj.setText(text);
}
function _repositionCargoLabel(scene, unit) {
  if (!unit.cargoObj) return;
  const p = scene.axialToWorld(unit.q, unit.r);
  unit.cargoObj.setPosition(p.x + 10, p.y - 6);
}

/** Sum of all cargo resources on a ship/hauler. */
function _totalCargo(unit) {
  if (unit && unit.cargo && typeof unit.cargo === 'object') {
    return Object.values(unit.cargo).reduce((sum, v) => sum + (v || 0), 0);
  }
  if (unit && typeof unit.cargoFood === 'number') {
    return unit.cargoFood;
  }
  return 0;
}

function _getMobileBaseCoords(scene, hauler) {
  if (hauler?.baseRef && typeof hauler.baseRef.q === 'number' && typeof hauler.baseRef.r === 'number') {
    return { q: hauler.baseRef.q, r: hauler.baseRef.r };
  }
  if (Array.isArray(scene.players)) {
    const mb = scene.players.find(u =>
      u?.type === 'mobile_base' ||
      u?.type === 'mobileBase' ||
      u?.isMobileBase === true ||
      u?.name === 'Mobile Base' ||
      u?.emoji === '🏕️' || u?.emoji === '🚚'
    );
    if (mb && typeof mb.q === 'number' && typeof mb.r === 'number') {
      return { q: mb.q, r: mb.r };
    }
  }
  return { q: hauler.baseQ ?? 0, r: hauler.baseR ?? 0 };
}

export default {
  buildShipForDocks,
  openDocksRoutePicker,
  recallShipsToDocks,
  ensureDocksStoreLabel,
  updateDocksStoreLabel,
  applyShipRoutesOnEndTurn,
  buildHaulerAtSelectedUnit,
  applyHaulerBehaviorOnEndTurn,
  enterHaulerRoutePicker,
  moveCarrierOneLeg,
};
