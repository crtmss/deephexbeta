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
//   resource: 'food' | 'scrap' | 'money' | 'influence',
// }

import { moveCarrierOneLeg, ensureDocksStoreLabel, updateDocksStoreLabel } from './WorldSceneHaulers.js';

// These mirror the caps in WorldSceneHaulers.js
const HAULER_CARGO_CAP = 5;
const SHIP_CARGO_CAP = 2;

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

    const steps = carrier.logisticsRoute;
    if (!steps.length) continue;

    if (typeof carrier.routeIndex !== 'number' || carrier.routeIndex < 0 || carrier.routeIndex >= steps.length) {
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
      u.type === 'mobile_base' &&
      u.playerName === scene.playerName
    );

    // Fallback: any mobile_base
    if (!base) {
      base = players.find(u => u && u.type === 'mobile_base');
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
  const resource = step.resource || 'food';

  switch (action) {
    case 'load':
    case 'loadAll':
      _performLoad(scene, carrier, station, resource);
      break;
    case 'unload':
    case 'unloadAll':
      _performUnload(scene, carrier, station, resource);
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
  if (carrier.type === 'ship' || carrier.isNaval) return SHIP_CARGO_CAP;
  return HAULER_CARGO_CAP;
}

/* =========================
   Load / Unload helpers
   ========================= */

function _performLoad(scene, carrier, station, resource) {
  if (resource !== 'food') {
    // For now we only implement food; other resources can be added later.
    return;
  }

  const cap = _getCargoCapacity(carrier);
  const current = carrier.cargoFood || 0;
  const room = Math.max(0, cap - current);
  if (room <= 0) return;

  if (station.kind === 'building') {
    const b = station.buildingRef;
    b.resources = b.resources || {};

    const fromResources = typeof b.resources.food === 'number' ? b.resources.food : 0;
    const fromStorage   = typeof b.storageFood === 'number' ? b.storageFood : 0;
    const available = Math.max(fromResources, fromStorage);

    if (available <= 0) return;

    const take = Math.min(available, room);
    const remaining = available - take;

    b.resources.food = remaining;
    b.storageFood = remaining;

    if (b.type === 'docks') {
      ensureDocksStoreLabel(scene, b);
      updateDocksStoreLabel(scene, b);
    }

    carrier.cargoFood = current + take;
    _syncCarrierCargoLabel(carrier);

  } else if (station.kind === 'mobileBase') {
    // Load from global player resources
    scene.playerResources = scene.playerResources || {};
    const available = scene.playerResources.food || 0;
    if (available <= 0) return;

    const take = Math.min(available, room);
    scene.playerResources.food -= take;
    scene.updateResourceUI?.();

    carrier.cargoFood = current + take;
    _syncCarrierCargoLabel(carrier);
  }
}

function _performUnload(scene, carrier, station, resource) {
  if (resource !== 'food') {
    return;
  }

  const current = carrier.cargoFood || 0;
  if (current <= 0) return;
  const give = current;

  if (station.kind === 'building') {
    const b = station.buildingRef;
    b.resources = b.resources || {};

    const fromResources = typeof b.resources.food === 'number' ? b.resources.food : 0;
    const fromStorage   = typeof b.storageFood === 'number' ? b.storageFood : 0;
    const total = Math.max(fromResources, fromStorage) + give;

    b.resources.food = total;
    b.storageFood = total;

    if (b.type === 'docks') {
      ensureDocksStoreLabel(scene, b);
      updateDocksStoreLabel(scene, b);
    }

    carrier.cargoFood = 0;
    _syncCarrierCargoLabel(carrier);

  } else if (station.kind === 'mobileBase') {
    // Unload into player resources
    scene.playerResources = scene.playerResources || {};
    scene.playerResources.food = (scene.playerResources.food || 0) + give;
    scene.updateResourceUI?.();

    carrier.cargoFood = 0;
    _syncCarrierCargoLabel(carrier);
  }
}

/* =========================
   Tiny label sync (no import from Haulers internals)
   ========================= */

function _syncCarrierCargoLabel(carrier) {
  if (!carrier.cargoObj) return;
  const n = carrier.cargoFood || 0;
  carrier.cargoObj.setText(n > 0 ? `🍖×${n}` : '');
}

export default {
  applyLogisticsRoutesOnEndTurn,
};
