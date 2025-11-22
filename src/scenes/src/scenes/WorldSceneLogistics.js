// src/scenes/WorldSceneLogistics.js
//
// Central logistics / routing module
//
// - Defines a data model for logistics routes.
// - Treats buildings + mobile base as "stations".
// - Treats haulers + ships as "carriers".
// - Provides helpers to edit routes from UI.
// - Provides applyLogisticsOnEndTurn(scene) that, once wired,
//   will move carriers and perform load/unload actions.
//
// NOTE: By default, carriers are *opt-in* for logistics:
//   a carrier must have `carrier.logisticsEnabled === true`
//   and a non-empty `carrier.route` for this module to affect it.
//

import {
  ensureDocksStoreLabel,
  updateDocksStoreLabel,
} from './WorldSceneHaulers.js';

// -----------------------------
// Public enums / constants
// -----------------------------

export const LOGI_ACTIONS = {
  LOAD: 'load',
  LOAD_ALL: 'loadAll',
  UNLOAD: 'unload',
  UNLOAD_ALL: 'unloadAll',
};

export const LOGI_RESOURCES = ['food', 'scrap', 'money', 'influence'];

// -----------------------------
// Station helpers
// -----------------------------

/**
 * Return an array of all "stations":
 * - All buildings (docks, mine, factory, bunker...)
 * - Mobile Base (special pseudo-station backed by scene.playerResources)
 *
 * Each item: { id, type, name, q, r, ref }
 */
export function getAllStations(scene) {
  const stations = [];

  const buildings = scene.buildings || [];
  buildings.forEach(b => {
    stations.push({
      id: `b:${b.id}`,
      type: b.type,
      name: b.name || b.type,
      q: b.q,
      r: b.r,
      ref: b,
    });
  });

  // Mobile base as a virtual station
  const base =
    (scene.players || []).find(
      u =>
        u.type === 'mobileBase' ||
        u.isMobileBase === true ||
        u.name === 'Mobile Base'
    ) || null;

  if (base) {
    stations.push({
      id: 'base',
      type: 'mobileBase',
      name: 'Mobile Base',
      q: base.q,
      r: base.r,
      ref: base,
    });
  }

  return stations;
}

/**
 * Resolve a station by its ID ("base" or "b:<id>").
 * Returns { id, type, name, q, r, ref } or null.
 */
export function findStationById(scene, stationId) {
  if (!stationId) return null;

  if (stationId === 'base') {
    const base =
      (scene.players || []).find(
        u =>
          u.type === 'mobileBase' ||
          u.isMobileBase === true ||
          u.name === 'Mobile Base'
      ) || null;
    if (!base) return null;
    return {
      id: 'base',
      type: 'mobileBase',
      name: 'Mobile Base',
      q: base.q,
      r: base.r,
      ref: base,
    };
  }

  if (!stationId.startsWith('b:')) return null;
  const idNum = parseInt(stationId.slice(2), 10);
  if (!Number.isFinite(idNum)) return null;

  const b = (scene.buildings || []).find(bb => bb.id === idNum);
  if (!b) return null;

  return {
    id: `b:${b.id}`,
    type: b.type,
    name: b.name || b.type,
    q: b.q,
    r: b.r,
    ref: b,
  };
}

// -----------------------------
// Carrier helpers
// -----------------------------

/**
 * Ensure a carrier has the route fields we expect.
 */
export function ensureCarrierRouteFields(carrier) {
  if (!carrier.route) carrier.route = [];
  if (typeof carrier.routeIndex !== 'number') carrier.routeIndex = 0;
}

/**
 * "Carriers" are haulers and ships.
 */
export function getAllCarriers(scene) {
  const haulers = scene.haulers || [];
  const ships = scene.ships || [];
  return [...haulers, ...ships];
}

/**
 * Replace a carrier's entire route.
 * `stops` is an array of:
 *   { stationId, action, resource }
 */
export function setCarrierRoute(scene, carrier, stops) {
  ensureCarrierRouteFields(carrier);
  carrier.route = Array.isArray(stops) ? stops.slice() : [];
  carrier.routeIndex = 0;
}

/**
 * Append a stop to a carrier's route.
 */
export function addStopToCarrier(scene, carrier, stop) {
  ensureCarrierRouteFields(carrier);
  carrier.route.push({ ...stop });
}

/**
 * Remove a stop at `index` from the carrier's route.
 */
export function removeStopFromCarrier(scene, carrier, index) {
  ensureCarrierRouteFields(carrier);
  if (!carrier.route.length) return;
  if (index < 0 || index >= carrier.route.length) return;

  carrier.route.splice(index, 1);
  if (carrier.routeIndex >= carrier.route.length) {
    carrier.routeIndex = Math.max(0, carrier.route.length - 1);
  }
}

/**
 * Reorder stops in a carrier route.
 */
export function moveStop(scene, carrier, fromIndex, toIndex) {
  ensureCarrierRouteFields(carrier);
  const { route } = carrier;
  if (!route.length) return;
  if (fromIndex < 0 || fromIndex >= route.length) return;
  if (toIndex < 0 || toIndex >= route.length) return;
  if (fromIndex === toIndex) return;

  const [item] = route.splice(fromIndex, 1);
  route.splice(toIndex, 0, item);
}

// -----------------------------
// Per-turn logistics execution
// -----------------------------

// We import this symbol, which you will implement in WorldSceneHaulers.js:
//   export function moveCarrierOneLeg(scene, carrier, targetQ, targetR)
// It should:
//   - Move the carrier toward target hex using your existing path logic
//   - Update carrier.q / carrier.r and Phaser object position
//   - Return true if the carrier is now exactly at (targetQ, targetR)
import { moveCarrierOneLeg } from './WorldSceneHaulers.js';

/**
 * Get the currently active stop for a carrier.
 * Returns { stop, station, index } or null.
 */
function getCurrentStop(scene, carrier) {
  ensureCarrierRouteFields(carrier);
  const { route, routeIndex } = carrier;
  if (!route || route.length === 0) return null;

  // Phaser.Math.Wrap uses global Phaser; fallback if not present
  const wrap = (v, min, max) =>
    (typeof Phaser !== 'undefined' && Phaser.Math && Phaser.Math.Wrap)
      ? Phaser.Math.Wrap(v, min, max)
      : ((v - min) % (max - min) + (max - min)) % (max - min) + min;

  const idx = wrap(routeIndex, 0, route.length);
  const stop = route[idx];
  if (!stop) return null;

  const station = findStationById(scene, stop.stationId);
  if (!station) return null;

  return { stop, station, index: idx };
}

/**
 * Main entry point: evaluated once per end-turn.
 *
 * IMPORTANT:
 * - This will *only* act on carriers that have:
 *     carrier.logisticsEnabled === true
 *   and a non-empty `carrier.route`.
 * - That way, existing ship/hauler behavior is unaffected until
 *   you explicitly enable logistics for a carrier in your UI.
 */
export function applyLogisticsOnEndTurn(scene) {
  const carriers = getAllCarriers(scene);
  if (!carriers.length) return;

  carriers.forEach(carrier => {
    ensureCarrierRouteFields(carrier);

    if (!carrier.logisticsEnabled) return;       // opt-in flag
    if (!carrier.route || carrier.route.length === 0) return;

    // Basic movementPoints management (safe defaults)
    if (typeof carrier.maxMovePoints !== 'number') {
      carrier.maxMovePoints = 8;
    }
    if (typeof carrier.movePoints !== 'number') {
      carrier.movePoints = carrier.maxMovePoints;
    }

    // No movement points left: skip this carrier this turn
    if (carrier.movePoints <= 0) return;

    const current = getCurrentStop(scene, carrier);
    if (!current) return;

    const { stop, station, index } = current;

    // 1) Move towards station (at most one leg per turn for now)
    const reached = moveCarrierOneLeg(scene, carrier, station.q, station.r);

    // 2) If we arrived at the station hex, perform the stop action
    if (reached && carrier.q === station.q && carrier.r === station.r) {
      applyStopAction(scene, carrier, station, stop);

      // Advance to next stop (loop)
      if (carrier.route.length > 0) {
        carrier.routeIndex = (index + 1) % carrier.route.length;
      }
    }

    // Reset MPs for next turn; if you want accumulated MP, change this
    carrier.movePoints = carrier.maxMovePoints;
  });
}

// -----------------------------
// Load / Unload logic
// -----------------------------

/**
 * Apply a single stop's action when a carrier is *at* a station.
 */
function applyStopAction(scene, carrier, station, stop) {
  const resourceKey = stop.resource || null;

  switch (stop.action) {
    case LOGI_ACTIONS.LOAD:
      if (!resourceKey) return;
      stationGiveToCarrier(scene, station, carrier, resourceKey, 1);
      break;

    case LOGI_ACTIONS.LOAD_ALL:
      if (resourceKey) {
        stationGiveToCarrier(scene, station, carrier, resourceKey, Infinity);
      } else {
        LOGI_RESOURCES.forEach(k =>
          stationGiveToCarrier(scene, station, carrier, k, Infinity)
        );
      }
      break;

    case LOGI_ACTIONS.UNLOAD:
      if (!resourceKey) return;
      carrierGiveToStation(scene, carrier, station, resourceKey, 1);
      break;

    case LOGI_ACTIONS.UNLOAD_ALL:
      if (resourceKey) {
        carrierGiveToStation(scene, carrier, station, resourceKey, Infinity);
      } else {
        LOGI_RESOURCES.forEach(k =>
          carrierGiveToStation(scene, carrier, station, k, Infinity)
        );
      }
      break;

    default:
      console.warn('[LOGI] Unknown logistics action:', stop.action);
  }

  // Update any special labels (docks storage, cargo, etc.)
  refreshVisualsAfterTransfer(scene, carrier, station);
}

/**
 * Station → Carrier transfer; obey capacity on carrier side.
 */
function stationGiveToCarrier(scene, station, carrier, key, maxAmount) {
  if (!maxAmount || maxAmount <= 0) return;

  const available = getStationResourceAmount(scene, station, key);
  if (available <= 0) return;

  const carrierFree = getCarrierFreeCapacity(carrier, key);
  if (carrierFree <= 0) return;

  const delta = Math.min(
    available,
    carrierFree,
    maxAmount === Infinity ? available : maxAmount
  );
  if (delta <= 0) return;

  setStationResourceAmount(scene, station, key, available - delta);
  addToCarrierCargo(carrier, key, delta);

  // If station is mobile base: also sync HUD
  if (station.type === 'mobileBase') {
    scene.updateResourceUI?.();
  }
}

/**
 * Carrier → Station transfer.
 */
function carrierGiveToStation(scene, carrier, station, key, maxAmount) {
  if (!maxAmount || maxAmount <= 0) return;

  const available = getCarrierCargoAmount(carrier, key);
  if (available <= 0) return;

  const delta = Math.min(
    available,
    maxAmount === Infinity ? available : maxAmount
  );
  if (delta <= 0) return;

  addToStationResource(scene, station, key, delta * 1);
  setCarrierCargoAmount(carrier, key, available - delta);

  if (station.type === 'mobileBase') {
    scene.updateResourceUI?.();
  }
}

// -----------------------------
// Resource field helpers
// -----------------------------

// Map "food" → "Food", etc.
function _capKey(key) {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Read resource amount from a station (building or mobile base).
 */
function getStationResourceAmount(scene, station, key) {
  if (!station || !key) return 0;

  // Mobile base: backed by scene.playerResources
  if (station.type === 'mobileBase') {
    const res = scene.playerResources || {};
    return res[key] ?? 0;
  }

  // Buildings: storageX fields
  const obj = station.ref;
  if (!obj) return 0;
  const prop = 'storage' + _capKey(key);
  return obj[prop] ?? 0;
}

/**
 * Write resource amount to a station (building or base).
 * Overwrites the stored value (no clamping here).
 */
function setStationResourceAmount(scene, station, key, amount) {
  if (!station || !key) return;

  // Mobile base → scene.playerResources
  if (station.type === 'mobileBase') {
    if (!scene.playerResources) scene.playerResources = {};
    scene.playerResources[key] = Math.max(0, amount);
    scene.bumpResource?.(key);
    return;
  }

  const obj = station.ref;
  if (!obj) return;
  const prop = 'storage' + _capKey(key);
  obj[prop] = Math.max(0, amount);

  // Special case: docks visual label handled separately
}

/**
 * Add `delta` to a station's resource.
 */
function addToStationResource(scene, station, key, delta) {
  const cur = getStationResourceAmount(scene, station, key);
  setStationResourceAmount(scene, station, key, cur + delta);
}

/**
 * For carriers (haulers/ships) we use cargoX fields.
 */
function getCarrierCargoAmount(carrier, key) {
  const prop = 'cargo' + _capKey(key);
  return carrier[prop] ?? 0;
}

function setCarrierCargoAmount(carrier, key, amount) {
  const prop = 'cargo' + _capKey(key);
  carrier[prop] = Math.max(0, amount);
}

function addToCarrierCargo(carrier, key, delta) {
  const cur = getCarrierCargoAmount(carrier, key);
  setCarrierCargoAmount(carrier, key, cur + delta);
}

/**
 * Rough capacity model:
 * - ships: 2 units total (for now)
 * - haulers: 5 units total (for now)
 * - other: infinite
 *
 * You can later replace this with per-carrier fields (e.g. cargoCap).
 */
function getCarrierFreeCapacity(carrier, key) {
  const isShip = carrier.type === 'ship';
  const isHauler = carrier.type === 'hauler';

  let cap;
  if (typeof carrier.cargoCap === 'number') {
    cap = carrier.cargoCap;
  } else if (isShip) {
    cap = 2;
  } else if (isHauler) {
    cap = 5;
  } else {
    cap = Infinity;
  }

  // For now: treat all resources as sharing the same capacity pool
  // by summing all cargoX fields.
  let used = 0;
  LOGI_RESOURCES.forEach(k => {
    used += getCarrierCargoAmount(carrier, k);
  });

  const free = cap - used;
  return free > 0 ? free : 0;
}

// -----------------------------
// Visual refresh after transfers
// -----------------------------

function refreshVisualsAfterTransfer(scene, carrier, station) {
  // Docks: update storage label
  if (station.type === 'docks' && station.ref) {
    ensureDocksStoreLabel(scene, station.ref);
    updateDocksStoreLabel(scene, station.ref);
  }

  // Carrier: if it has cargoObj text, update that via existing hauler logic
  // We can't directly call _updateCargoLabel here (it's internal),
  // but the next movement / turn cycle will normally refresh it.
  // If you later export a "refreshCargoLabel" from WorldSceneHaulers,
  // you can call it from here.
}

export default {
  LOGI_ACTIONS,
  LOGI_RESOURCES,
  getAllStations,
  findStationById,
  getAllCarriers,
  ensureCarrierRouteFields,
  setCarrierRoute,
  addStopToCarrier,
  removeStopFromCarrier,
  moveStop,
  applyLogisticsOnEndTurn,
};
