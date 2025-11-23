// src/scenes/WorldSceneLogisticsRuntime.js
//
// Executes logistics routes (Factorio-style) on end turn.
// Consumes hauler.logisticsRoute populated by WorldSceneLogistics.js.
//
// A "route step" has shape:
//
// {
//   stationType: 'mobileBase' | 'docks' | 'mine' | 'factory' | 'bunker' | ...,
//   stationId: number | null,
//   action: 'load' | 'loadAll' | 'unload' | 'unloadAll' | 'idle',
//   resource: 'food' | 'scrap' | 'money' | 'influence',
// }
//
// Currently only 'food' is actively moved for docks <-> buildings,
// but the helpers are ready for more resources.

import {
  moveCarrierOneLeg,
  ensureDocksStoreLabel,
  updateDocksStoreLabel,
} from './WorldSceneHaulers.js';

/**
 * Main entry: called from WorldScene.endTurn().
 * Moves haulers with logisticsRoute and performs load/unload/idle at stations.
 */
export function applyLogisticsRoutesOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;

  const haulers = Array.isArray(scene.haulers) ? scene.haulers : [];
  if (!haulers.length) return;

  // Keep "pinned" haulers snapped to their mobile base position
  _syncPinnedHaulersToMobileBase(scene);

  const routeHaulers = haulers.filter(
    h => Array.isArray(h.logisticsRoute) && h.logisticsRoute.length > 0
  );
  if (!routeHaulers.length) {
    return;
  }

  for (const h of routeHaulers) {
    // ensure basic movement stats
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    if (typeof h.movePoints !== 'number') h.movePoints = h.maxMovePoints;

    const route = h.logisticsRoute;
    if (!route || route.length === 0) continue;

    if (typeof h.routeIndex !== 'number' || h.routeIndex < 0) {
      h.routeIndex = 0;
    }
    if (h.routeIndex >= route.length) {
      h.routeIndex = 0;
    }

    const step = route[h.routeIndex];
    if (!step) {
      h.routeIndex = 0;
      continue;
    }

    const stationInfo = _resolveStation(scene, step);
    if (!stationInfo) {
      console.warn('[LOGI] Station not found for step', step);
      // skip this broken step and advance to next one
      h.routeIndex = (h.routeIndex + 1) % route.length;
      continue;
    }

    const { q: targetQ, r: targetR, stationRef } = stationInfo;

    // If hauler is not yet on the station hex, move it towards it
    if (h.q !== targetQ || h.r !== targetR) {
      const arrived = moveCarrierOneLeg(scene, h, targetQ, targetR);
      // movement only this turn; cargo actions happen when we actually arrive
      if (!arrived) continue;
    }

    // At the station: perform the action
    const action = step.action || 'idle';
    const resKey = step.resource || 'food';

    switch (action) {
      case 'load':
      case 'loadAll':
        _doLoadAll(scene, h, stationRef, resKey);
        break;
      case 'unload':
      case 'unloadAll':
        _doUnloadAll(scene, h, stationRef, resKey);
        break;
      case 'idle':
      default:
        // no cargo change, just stay here
        break;
    }

    // Advance to next step in route (looping)
    h.routeIndex = (h.routeIndex + 1) % route.length;
  }

  // Reset move points for next turn so moveCarrierOneLeg has full MPs again
  for (const h of haulers) {
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    h.movePoints = h.maxMovePoints;
  }
}

export default {
  applyLogisticsRoutesOnEndTurn,
};

///////////////////////////////
// Internal helpers
///////////////////////////////

/**
 * Keep haulers that are "pinned" to a Mobile Base riding along with it.
 * This runs at end of turn; so after you move the mobile base,
 * pinned haulers will be teleported onto its hex.
 */
function _syncPinnedHaulersToMobileBase(scene) {
  const players = scene.players || [];
  const haulers = scene.haulers || [];

  for (const h of haulers) {
    if (!h.pinnedToBase) continue;
    if (!h.baseRef) continue;

    const base = players.find(u => u === h.baseRef);
    if (!base || typeof base.q !== 'number' || typeof base.r !== 'number') continue;

    h.q = base.q;
    h.r = base.r;
    const p = scene.axialToWorld(base.q, base.r);
    h.obj?.setPosition(p.x, p.y);
    _updateHaulerCargoLabel(scene, h);
  }
}

/**
 * Resolve station and its hex from a route step.
 * Returns { q, r, stationRef } or null.
 */
function _resolveStation(scene, step) {
  if (!step) return null;

  const type = step.stationType;
  const id   = step.stationId;

  // Mobile base as station
  if (type === 'mobileBase') {
    const players = scene.players || [];
    const base = players.find(u =>
      (u.type === 'mobileBase' ||
       u.isMobileBase === true ||
       u.name === 'Mobile Base') &&
      (id == null || u.id === id)
    );
    if (!base || typeof base.q !== 'number' || typeof base.r !== 'number') return null;
    return { q: base.q, r: base.r, stationRef: base };
  }

  // Building as station
  const buildings = scene.buildings || [];
  const b = buildings.find(x =>
    x.type === type &&
    (id == null || x.id === id)
  );

  if (!b || typeof b.q !== 'number' || typeof b.r !== 'number') return null;
  return { q: b.q, r: b.r, stationRef: b };
}

/**
 * Load as much of resource from station into hauler as possible (respecting hauler capacity).
 * Currently only "food" is actually wired for docks, but this is generic.
 */
function _doLoadAll(scene, hauler, station, resKey) {
  if (!hauler || !station) return;

  // Ensure cargo counters exist
  if (typeof hauler.cargoFood !== 'number') hauler.cargoFood = 0;

  // For now, we treat 'food' as the moved resource (UI always sets resource: 'food')
  if (resKey !== 'food') {
    // stub for future resources
    return;
  }

  const capacity = typeof hauler.maxCargoFood === 'number' ? hauler.maxCargoFood : 5;
  const currentCargo = hauler.cargoFood || 0;
  const space = Math.max(0, capacity - currentCargo);
  if (space <= 0) return;

  const available = _getStationAmount(station, 'food');
  if (available <= 0) return;

  const take = Math.min(space, available);
  const nextCargo = currentCargo + take;
  const nextStation = available - take;

  hauler.cargoFood = nextCargo;
  _setStationAmount(station, 'food', nextStation);

  _updateHaulerCargoLabel(scene, hauler);
  _updateStationVisuals(scene, station);
}

/**
 * Unload all of resource from hauler into station.
 */
function _doUnloadAll(scene, hauler, station, resKey) {
  if (!hauler || !station) return;

  if (resKey !== 'food') {
    // stub for future resources
    return;
  }

  const currentCargo = hauler.cargoFood || 0;
  if (currentCargo <= 0) return;

  const stationAmount = _getStationAmount(station, 'food');
  const nextStation = stationAmount + currentCargo;

  hauler.cargoFood = 0;
  _setStationAmount(station, 'food', nextStation);

  _updateHaulerCargoLabel(scene, hauler);
  _updateStationVisuals(scene, station);
}

/**
 * Read a resource amount from a station, taking into account both `resources.*`
 * and any legacy `storage*` fields.
 */
function _getStationAmount(station, resKey) {
  if (!station) return 0;

  let v = 0;
  if (station.resources && typeof station.resources[resKey] === 'number') {
    v = station.resources[resKey];
  }

  const storageProp = _storagePropForRes(resKey);
  if (storageProp && typeof station[storageProp] === 'number') {
    v = Math.max(v, station[storageProp]);
  }
  return v;
}

/**
 * Write a resource amount back to a station, syncing both `resources.*`
 * and any legacy `storage*` field if present.
 */
function _setStationAmount(station, resKey, value) {
  if (!station) return;
  if (!station.resources) station.resources = {};

  const v = Math.max(0, value | 0);

  station.resources[resKey] = v;

  const storageProp = _storagePropForRes(resKey);
  if (storageProp && storageProp in station) {
    station[storageProp] = v;
  }
}

function _storagePropForRes(resKey) {
  switch (resKey) {
    case 'food':      return 'storageFood';
    case 'scrap':     return 'storageScrap';
    case 'money':     return 'storageMoney';
    case 'influence': return 'storageInfluence';
    default:          return null;
  }
}

/**
 * Update any visuals associated with a station after load/unload.
 * Right now this mainly covers docks' little 🍖 label.
 */
function _updateStationVisuals(scene, station) {
  if (!station) return;
  if (station.type === 'docks') {
    ensureDocksStoreLabel(scene, station);
    updateDocksStoreLabel(scene, station);
  }
}

/**
 * Minimal cargo label updater without depending on Haulers' private helpers.
 */
function _updateHaulerCargoLabel(scene, hauler) {
  if (!hauler) return;
  const txt = hauler.cargoObj;
  if (!txt) return;

  const n = hauler.cargoFood || 0;
  txt.setText(n > 0 ? `🍖×${n}` : '');

  // keep label positioned correctly if we know the hex
  if (typeof hauler.q === 'number' && typeof hauler.r === 'number') {
    const p = scene.axialToWorld(hauler.q, hauler.r);
    txt.setPosition(p.x + 10, p.y - 6);
  }
}
