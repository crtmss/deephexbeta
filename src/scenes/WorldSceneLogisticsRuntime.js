// src/scenes/WorldSceneLogisticsRuntime.js
//
// Executes Factorio-style logistics routes for haulers & ships on end turn.
// This file is *pure runtime*: it doesn’t draw UI, it just reads
// hauler.logisticsRoute (built by WorldSceneLogistics.js) and moves cargo.
//
// A "route step" looks like:
// {
//   stationType: 'mobileBase' | 'docks' | 'mine' | 'factory' | 'bunker',
//   stationId: number | null,
//   action: 'load' | 'loadAll' | 'unload' | 'unloadAll' | 'idle',
//   resource: 'food' | 'scrap' | 'money' | 'influence',   // for load/unload (single resource)
//   // loadAll / unloadAll ignore "resource" and operate on all resources.
// }

import {
  moveCarrierOneLeg,
  ensureDocksStoreLabel,
  updateDocksStoreLabel,
} from './WorldSceneHaulers.js';

// Fallback caps (WorldSceneHaulers.js also sets carrier.cargoCap)
const HAULER_CARGO_CAP = 5;
const SHIP_CARGO_CAP = 2;

// All supported logistics resources
const LOGI_RESOURCES = ['food', 'scrap', 'money', 'influence'];

// Mapping from resource key to legacy building storage field name
const STORAGE_FIELD_BY_RESOURCE = {
  food: 'storageFood',
  scrap: 'storageScrap',
  money: 'storageMoney',
  influence: 'storageInfluence',
};

/**
 * Apply logistics routes for all carriers that have them.
 * Called from WorldScene.endTurn().
 */
export function applyLogisticsRoutesOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;

  const haulers = Array.isArray(scene.haulers) ? scene.haulers : [];
  const ships   = Array.isArray(scene.ships)   ? scene.ships   : [];
  const carriers = [...haulers, ...ships];

  for (const carrier of carriers) {
    if (!Array.isArray(carrier.logisticsRoute) || carrier.logisticsRoute.length === 0) {
      continue; // legacy behaviour in WorldSceneHaulers handles non-route haulers
    }

    // Ensure multi-resource cargo bag exists for this runtime
    if (!carrier.cargo || typeof carrier.cargo !== 'object') {
      carrier.cargo = {
        food: carrier.cargoFood || 0,
        scrap: 0,
        money: 0,
        influence: 0,
      };
    } else {
      // Ensure all keys exist
      LOGI_RESOURCES.forEach(k => {
        if (typeof carrier.cargo[k] !== 'number') carrier.cargo[k] = 0;
      });
      // Keep legacy cargoFood in sync with food
      if (typeof carrier.cargoFood !== 'number') {
        carrier.cargoFood = carrier.cargo.food || 0;
      }
    }
    if (typeof carrier.cargoCap !== 'number') {
      carrier.cargoCap = _getCargoCapacity(carrier);
    }

    const steps = carrier.logisticsRoute;
    if (!steps.length) continue;

    if (
      typeof carrier.routeIndex !== 'number' ||
      carrier.routeIndex < 0 ||
      carrier.routeIndex >= steps.length
    ) {
      carrier.routeIndex = 0;
    }

    const step = steps[carrier.routeIndex];
    const station = _resolveStationForStep(scene, step);

    if (!station) {
      console.warn('[LOGI] Station not found for step', step);
      carrier.routeIndex = (carrier.routeIndex + 1) % steps.length;
      continue;
    }

    // 1) Move toward station
    const reached = moveCarrierOneLeg(scene, carrier, station.q, station.r);

    // If we haven't arrived yet, we stop here this turn.
    if (!reached) {
      continue;
    }

    // 2) Execute action at station when standing on it
    _executeStepAtStation(scene, carrier, station, step);

    // 3) Advance to the next step in route
    const len = steps.length;
    carrier.routeIndex = len > 0 ? (carrier.routeIndex + 1) % len : 0;

    // Reset move points for the next step/turn
    if (typeof carrier.maxMovePoints !== 'number') carrier.maxMovePoints = 8;
    carrier.movePoints = carrier.maxMovePoints;
  }
}

/* =========================
   Station resolution
   ========================= */

function _resolveStationForStep(scene, step) {
  if (!step) return null;
  const type = step.stationType;

  if (type === 'mobileBase') {
    const players = scene.players || [];

    // Prefer my own mobile base
    let base = players.find(u =>
      u &&
      (u.type === 'mobile_base' || u.type === 'mobileBase') &&
      u.playerName === scene.playerName
    );

    // Fallback: any mobile_base / mobileBase
    if (!base) {
      base = players.find(u =>
        u && (u.type === 'mobile_base' || u.type === 'mobileBase')
      );
    }

    if (!base) {
      console.warn('[LOGI] No mobile_base unit found for logistics step', step);
      return null;
    }

    return {
      kind: 'mobileBase',
      unitRef: base,
      q: base.q,
      r: base.r,
    };
  }

  // Buildings (docks, mine, factory, etc.)
  const buildings = scene.buildings || [];
  let b = null;

  if (typeof step.stationId === 'number') {
    b = buildings.find(x => x.id === step.stationId);
  }

  if (!b && type) {
    const candidates = buildings.filter(x => x.type === type);
    if (candidates.length > 0) {
      b = candidates[0];
    }
  }

  if (!b) {
    return null;
  }

  return {
    kind: 'building',
    buildingRef: b,
    q: b.q,
    r: b.r,
  };
}

/* =========================
   Step execution
   ========================= */

function _executeStepAtStation(scene, carrier, station, step) {
  const action = step.action || 'idle';
  const resource = step.resource || null; // specific resource for 'load' / 'unload'

  switch (action) {
    case 'loadAll':
      _performLoadAll(scene, carrier, station);
      break;
    case 'load':
      if (resource) _performLoadSingle(scene, carrier, station, resource);
      break;
    case 'unloadAll':
      _performUnloadAll(scene, carrier, station);
      break;
    case 'unload':
      if (resource) _performUnloadSingle(scene, carrier, station, resource);
      break;
    case 'idle':
    default:
      // Idle at mobile base: pin so it "rides along" when base moves
      if (station.kind === 'mobileBase') {
        carrier.pinnedToBase = true;
        carrier.baseRef = station.unitRef;
        carrier.baseQ = station.unitRef.q;
        carrier.baseR = station.unitRef.r;
      }
      break;
  }
}

function _getCargoCapacity(carrier) {
  if (typeof carrier.cargoCap === 'number') return carrier.cargoCap;
  if (carrier.type === 'ship' || carrier.isNaval) return SHIP_CARGO_CAP;
  return HAULER_CARGO_CAP;
}

function _totalCargo(carrier) {
  if (!carrier || !carrier.cargo || typeof carrier.cargo !== 'object') {
    return carrier?.cargoFood || 0;
  }
  return LOGI_RESOURCES.reduce((sum, key) => sum + (carrier.cargo[key] || 0), 0);
}

/* =========================
   Load helpers
   ========================= */

// Load random resources until full or station empty
function _performLoadAll(scene, carrier, station) {
  const cap = _getCargoCapacity(carrier);
  const cargo = carrier.cargo || (carrier.cargo = { food: 0, scrap: 0, money: 0, influence: 0 });
  let room = Math.max(0, cap - _totalCargo(carrier));
  if (room <= 0) return;

  if (station.kind === 'building') {
    const b = station.buildingRef;
    b.resources = b.resources || {};

    while (room > 0) {
      const availableList = LOGI_RESOURCES
        .map(key => ({ key, amount: _buildingGetAvailable(b, key) }))
        .filter(entry => entry.amount > 0);

      if (availableList.length === 0) break;

      const idx = Math.floor(Math.random() * availableList.length);
      const choice = availableList[idx];
      const take = Math.min(choice.amount, room);

      _buildingAdjust(b, choice.key, -take);

      cargo[choice.key] = (cargo[choice.key] || 0) + take;
      if (choice.key === 'food') {
        carrier.cargoFood = (carrier.cargoFood || 0) + take;
      }

      room -= take;
    }

    if (b.type === 'docks') {
      ensureDocksStoreLabel(scene, b);
      updateDocksStoreLabel(scene, b);
    }

    _syncCarrierCargoLabel(carrier);

  } else if (station.kind === 'mobileBase') {
    scene.playerResources = scene.playerResources || {};

    while (room > 0) {
      const availableList = LOGI_RESOURCES
        .map(key => ({ key, amount: scene.playerResources[key] || 0 }))
        .filter(entry => entry.amount > 0);

      if (availableList.length === 0) break;

      const idx = Math.floor(Math.random() * availableList.length);
      const choice = availableList[idx];
      const take = Math.min(choice.amount, room);

      scene.playerResources[choice.key] -= take;
      cargo[choice.key] = (cargo[choice.key] || 0) + take;
      if (choice.key === 'food') {
        carrier.cargoFood = (carrier.cargoFood || 0) + take;
      }

      room -= take;
    }

    scene.updateResourceUI?.();
    _syncCarrierCargoLabel(carrier);
  }
}

// Load a specific resource
function _performLoadSingle(scene, carrier, station, resource) {
  if (!LOGI_RESOURCES.includes(resource)) return;

  const cap = _getCargoCapacity(carrier);
  const cargo = carrier.cargo || (carrier.cargo = { food: 0, scrap: 0, money: 0, influence: 0 });
  const room = Math.max(0, cap - _totalCargo(carrier));
  if (room <= 0) return;

  if (station.kind === 'building') {
    const b = station.buildingRef;
    b.resources = b.resources || {};

    const available = _buildingGetAvailable(b, resource);
    if (available <= 0) return;

    const take = Math.min(available, room);
    _buildingAdjust(b, resource, -take);

    cargo[resource] = (cargo[resource] || 0) + take;
    if (resource === 'food') {
      carrier.cargoFood = (carrier.cargoFood || 0) + take;
    }

    if (b.type === 'docks' && resource === 'food') {
      ensureDocksStoreLabel(scene, b);
      updateDocksStoreLabel(scene, b);
    }

    _syncCarrierCargoLabel(carrier);

  } else if (station.kind === 'mobileBase') {
    scene.playerResources = scene.playerResources || {};
    const available = scene.playerResources[resource] || 0;
    if (available <= 0) return;

    const take = Math.min(available, room);
    scene.playerResources[resource] -= take;

    cargo[resource] = (cargo[resource] || 0) + take;
    if (resource === 'food') {
      carrier.cargoFood = (carrier.cargoFood || 0) + take;
    }

    scene.updateResourceUI?.();
    _syncCarrierCargoLabel(carrier);
  }
}

/* =========================
   Unload helpers
   ========================= */

// Unload all cargo resources from carrier into station
function _performUnloadAll(scene, carrier, station) {
  const cargo = carrier.cargo || (carrier.cargo = { food: 0, scrap: 0, money: 0, influence: 0 });

  if (_totalCargo(carrier) <= 0) return;

  if (station.kind === 'building') {
    const b = station.buildingRef;
    b.resources = b.resources || {};

    LOGI_RESOURCES.forEach(resource => {
      const amt = cargo[resource] || 0;
      if (amt <= 0) return;

      _buildingAdjust(b, resource, amt); // add to building

      if (resource === 'food') {
        carrier.cargoFood = Math.max(0, (carrier.cargoFood || 0) - amt);
      }
      cargo[resource] = 0;
    });

    if (b.type === 'docks') {
      ensureDocksStoreLabel(scene, b);
      updateDocksStoreLabel(scene, b);
    }

    _syncCarrierCargoLabel(carrier);

  } else if (station.kind === 'mobileBase') {
    scene.playerResources = scene.playerResources || {};

    LOGI_RESOURCES.forEach(resource => {
      const amt = cargo[resource] || 0;
      if (amt <= 0) return;

      scene.playerResources[resource] = (scene.playerResources[resource] || 0) + amt;

      if (resource === 'food') {
        carrier.cargoFood = Math.max(0, (carrier.cargoFood || 0) - amt);
      }
      cargo[resource] = 0;
    });

    scene.updateResourceUI?.();
    _syncCarrierCargoLabel(carrier);
  }
}

// Unload a single specific resource
function _performUnloadSingle(scene, carrier, station, resource) {
  if (!LOGI_RESOURCES.includes(resource)) return;

  const cargo = carrier.cargo || (carrier.cargo = { food: 0, scrap: 0, money: 0, influence: 0 });
  const amt = cargo[resource] || 0;
  if (amt <= 0) return;

  if (station.kind === 'building') {
    const b = station.buildingRef;
    b.resources = b.resources || {};

    _buildingAdjust(b, resource, amt);

    if (resource === 'food') {
      carrier.cargoFood = Math.max(0, (carrier.cargoFood || 0) - amt);
    }
    cargo[resource] = 0;

    if (b.type === 'docks' && resource === 'food') {
      ensureDocksStoreLabel(scene, b);
      updateDocksStoreLabel(scene, b);
    }

    _syncCarrierCargoLabel(carrier);

  } else if (station.kind === 'mobileBase') {
    scene.playerResources = scene.playerResources || {};
    scene.playerResources[resource] = (scene.playerResources[resource] || 0) + amt;

    if (resource === 'food') {
      carrier.cargoFood = Math.max(0, (carrier.cargoFood || 0) - amt);
    }
    cargo[resource] = 0;

    scene.updateResourceUI?.();
    _syncCarrierCargoLabel(carrier);
  }
}

/* =========================
   Building resource helpers
   ========================= */

// Read total amount of a resource from building (resources bag + legacy storage)
function _buildingGetAvailable(building, resource) {
  if (!LOGI_RESOURCES.includes(resource)) return 0;

  building.resources = building.resources || {};
  const fromResources = typeof building.resources[resource] === 'number'
    ? building.resources[resource]
    : 0;

  const field = STORAGE_FIELD_BY_RESOURCE[resource];
  const fromStorage = field && typeof building[field] === 'number'
    ? building[field]
    : 0;

  return Math.max(fromResources, fromStorage);
}

// Adjust building resource by delta and write back to both bag + legacy field
function _buildingAdjust(building, resource, delta) {
  if (!LOGI_RESOURCES.includes(resource)) return;

  building.resources = building.resources || {};
  const field = STORAGE_FIELD_BY_RESOURCE[resource];

  const available = _buildingGetAvailable(building, resource);
  const next = Math.max(0, available + delta);

  building.resources[resource] = next;
  if (field) {
    building[field] = next;
  }
}

/* =========================
   Tiny label sync (no import from Haulers internals)
   ========================= */

function _syncCarrierCargoLabel(carrier) {
  if (!carrier.cargoObj) return;

  const cargo = carrier.cargo || {};
  const parts = [];

  const emoji = {
    food: '🍖',
    scrap: '🛠',
    money: '💰',
    influence: '⭐',
  };

  LOGI_RESOURCES.forEach(key => {
    const v = cargo[key] || 0;
    if (v > 0) parts.push(`${emoji[key]}×${v}`);
  });

  // Fallback to legacy cargoFood if bag is empty
  if (parts.length === 0 && typeof carrier.cargoFood === 'number' && carrier.cargoFood > 0) {
    parts.push(`🍖×${carrier.cargoFood}`);
  }

  carrier.cargoObj.setText(parts.join(' '));
}

export default {
  applyLogisticsRoutesOnEndTurn,
};
