// src/scenes/WorldSceneLogisticsRuntime.js
// Runtime for Factorio-style logistics routes (per-hauler stop list)
//
// Assumptions (to keep this incremental & non-destructive):
// - Each land hauler has:
//     hauler.logisticsRoute = [
//       {
//         id: string,
//         station: { kind: 'building', id: number } |
//                  { kind: 'mobileBase' },
//         action: 'LOAD_RESOURCE' | 'LOAD_ALL' |
//                 'UNLOAD_RESOURCE' | 'UNLOAD_ALL',
//         resourceKey: 'food' | ... (for now we only process 'food')
//       },
//       ...
//     ]
//     hauler.routeIndex: current index (int)
// - This file ONLY moves *land haulers* (scene.haulers) that have a non-empty logisticsRoute.
// - Ships continue to be handled by WorldSceneHaulers.applyShipRoutesOnEndTurn.
// - Old hauler behavior is still used for haulers WITHOUT logisticsRoute (we’ll skip
//   logistics ones inside applyHaulerBehaviorOnEndTurn).
//
// NOTE: for now, runtime only actually moves/loads/unloads FOOD ("🍖").
//       Scrap etc. can be added later by extending the resource handling here.

import { updateDocksStoreLabel } from './WorldSceneHaulers.js';

const HAULER_CARGO_CAP = 5;   // must match HAULER_CARGO_CAP in WorldSceneHaulers.js
const DOCKS_STORAGE_CAP = 10; // must match DOCKS_STORAGE_CAP in WorldSceneHaulers.js

/** Main entry: run hauler logistics routes on end turn. */
export function applyLogisticsRoutesOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;

  const haulers = (scene.haulers || []).filter(
    h => Array.isArray(h.logisticsRoute) && h.logisticsRoute.length > 0
  );
  if (haulers.length === 0) return;

  // Ensure basic movement fields
  haulers.forEach(h => {
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    if (typeof h.movePoints !== 'number') h.movePoints = h.maxMovePoints;
    if (!Number.isInteger(h.routeIndex)) h.routeIndex = 0;
  });

  for (const h of haulers) {
    const stops = h.logisticsRoute;
    if (!stops || stops.length === 0) continue;

    const idx = ((h.routeIndex || 0) % stops.length + stops.length) % stops.length;
    const stop = stops[idx];
    if (!stop || !stop.station) continue;

    const stationInfo = resolveStation(scene, stop.station);
    if (!stationInfo) continue;

    const { q: tq, r: tr } = stationInfo;

    // Already at the station → perform one action, then advance to next stop
    if (h.q === tq && h.r === tr) {
      performStopAction(scene, h, stop, stationInfo);
      h.routeIndex = (idx + 1) % stops.length;
      h.movePoints = h.maxMovePoints;
      continue;
    }

    // Otherwise move toward the station
    if (h.movePoints <= 0) continue;

    const path = bfsLandPath(scene, h.q, h.r, tq, tr);
    if (!path || path.length <= 1) continue;

    const steps = Math.min(h.movePoints, path.length - 1);
    const next = path[steps];

    h.q = next.q;
    h.r = next.r;
    h.movePoints -= steps;

    // Move sprite
    const p = scene.axialToWorld(h.q, h.r);
    if (h.obj && typeof h.obj.setPosition === 'function') {
      h.obj.setPosition(p.x, p.y);
    }
    // Move cargo label (if present)
    if (h.cargoObj && !h.cargoObj.destroyed) {
      h.cargoObj.setPosition(p.x + 10, p.y - 6);
    }
  }

  // Reset MPs for next turn
  haulers.forEach(h => {
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    h.movePoints = h.maxMovePoints;
  });
}

/* ------------------------- Station resolution ------------------------- */

function resolveStation(scene, station) {
  if (!station) return null;
  const kind = station.kind || station.type;

  if (kind === 'building') {
    const id = station.id ?? station.buildingId;
    const b = (scene.buildings || []).find(bb => bb.id === id);
    if (!b) return null;
    return { kind: 'building', building: b, q: b.q, r: b.r };
  }

  if (kind === 'mobileBase' || kind === 'base') {
    const mb = (scene.players || []).find(u =>
      u.isMobileBase ||
      u.type === 'mobileBase' ||
      u.name === 'Mobile Base'
    );
    if (!mb) return null;
    return { kind: 'mobileBase', unit: mb, q: mb.q, r: mb.r };
  }

  return null;
}

/* ------------------------ Load / unload actions ----------------------- */

function performStopAction(scene, hauler, stop, stationInfo) {
  const actionRaw = stop.action || stop.type;
  const code = (actionRaw || '').toUpperCase();
  const resourceKey = (stop.resourceKey || stop.resource || 'food').toLowerCase();

  // For now, only FOOD ("🍖") is actually processed.
  if (resourceKey !== 'food') {
    console.log('[LOGISTICS] Runtime only handles food for now. Requested:', resourceKey);
    return;
  }

  switch (code) {
    case 'LOAD_RESOURCE':
    case 'LOAD':
    case 'LOAD_ALL':
      loadFoodAtStation(scene, hauler, stationInfo);
      break;

    case 'UNLOAD_RESOURCE':
    case 'UNLOAD':
    case 'UNLOAD_ALL':
      unloadFoodAtStation(scene, hauler, stationInfo);
      break;

    default:
      console.log('[LOGISTICS] Unknown logistics action:', code);
      break;
  }
}

function ensureHaulerCargoFood(hauler) {
  if (typeof hauler.cargoFood !== 'number') hauler.cargoFood = 0;
}

/** Take food FROM station → INTO hauler (up to HAULER_CARGO_CAP). */
function loadFoodAtStation(scene, hauler, stationInfo) {
  ensureHaulerCargoFood(hauler);
  const room = HAULER_CARGO_CAP - hauler.cargoFood;
  if (room <= 0) return;

  if (stationInfo.kind === 'building') {
    const b = stationInfo.building;
    b.resources = b.resources || {};

    const fromStore = (b.resources.food ?? b.storageFood ?? 0);
    if (fromStore <= 0) return;

    const amount = Math.min(room, fromStore);
    hauler.cargoFood += amount;

    b.resources.food = fromStore - amount;
    if (typeof b.storageFood === 'number') {
      b.storageFood = Math.max(0, b.storageFood - amount);
      if (b.type === 'docks') {
        updateDocksStoreLabel(scene, b);
      }
    }

    if (hauler.cargoObj && !hauler.cargoObj.destroyed) {
      hauler.cargoObj.setText(hauler.cargoFood > 0 ? `🍖×${hauler.cargoFood}` : '');
    }
    return;
  }

  if (stationInfo.kind === 'mobileBase') {
    // usually we don't "load" from base; you can extend this if you want
    return;
  }
}

/** Take food FROM hauler → INTO station (building or mobile base). */
function unloadFoodAtStation(scene, hauler, stationInfo) {
  ensureHaulerCargoFood(hauler);
  if (hauler.cargoFood <= 0) return;

  let amount = hauler.cargoFood;

  if (stationInfo.kind === 'building') {
    const b = stationInfo.building;

    b.resources = b.resources || {};
    const current = (b.resources.food ?? b.storageFood ?? 0);

    let cap = Infinity;
    if (b.type === 'docks') cap = DOCKS_STORAGE_CAP;

    const room = cap - current;
    if (room <= 0) return;

    const deposit = Math.min(room, amount);
    b.resources.food = current + deposit;

    if (typeof b.storageFood === 'number') {
      b.storageFood = (b.storageFood || 0) + deposit;
      if (b.type === 'docks') {
        updateDocksStoreLabel(scene, b);
      }
    }

    hauler.cargoFood -= deposit;
    amount -= deposit;
  } else if (stationInfo.kind === 'mobileBase') {
    const res = scene.playerResources || (scene.playerResources = {});
    res.food = (res.food || 0) + amount;
    hauler.cargoFood = 0;
    amount = 0;

    if (scene.updateResourceUI) scene.updateResourceUI();
    if (scene.bumpResource) scene.bumpResource('food');
  }

  if (hauler.cargoObj && !hauler.cargoObj.destroyed) {
    hauler.cargoObj.setText(hauler.cargoFood > 0 ? `🍖×${hauler.cargoFood}` : '');
  }
}

/* -------------------- Land BFS (hauler-style passability) ------------------- */

function bfsLandPath(scene, fromQ, fromR, toQ, toR) {
  if (fromQ === toQ && fromR === toR) return [{ q: fromQ, r: fromR }];

  const inb = (q, r) =>
    q >= 0 && r >= 0 && q < scene.mapWidth && r < scene.mapHeight;
  const key = (q, r) => `${q},${r}`;

  if (!inb(fromQ, fromR) || !inb(toQ, toR)) return null;
  if (!isLandPassable(scene, fromQ, fromR) || !isLandPassable(scene, toQ, toR)) return null;

  const came = new Map();
  const seen = new Set([key(fromQ, fromR)]);
  const queue = [{ q: fromQ, r: fromR }];

  while (queue.length) {
    const cur = queue.shift();
    if (cur.q === toQ && cur.r === toR) {
      const path = [];
      let n = cur;
      let k = key(cur.q, cur.r);
      while (n) {
        path.push({ q: n.q, r: n.r });
        const prev = came.get(k);
        if (!prev) break;
        k = key(prev.q, prev.r);
        n = prev;
      }
      return path.reverse();
    }

    for (const n of neighbors(cur.q, cur.r)) {
      if (!inb(n.q, n.r)) continue;
      if (!isLandPassable(scene, n.q, n.r)) continue;
      const nk = key(n.q, n.r);
      if (seen.has(nk)) continue;
      seen.add(nk);
      came.set(nk, cur);
      queue.push(n);
    }
  }

  return null;
}

function neighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0, -1], [+1, 0], [0, +1], [-1, +1], [-1, 0], [-1, -1]];
  const odd  = [[+1, -1], [+1, 0], [+1, +1], [0, +1], [-1, 0], [0, -1]];
  const d = isOdd ? odd : even;
  return d.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

function tileAt(scene, q, r) {
  return (scene.mapData || []).find(t => t.q === q && t.r === r);
}
function isWater(scene, q, r) {
  const t = tileAt(scene, q, r);
  if (!t) return false;
  return t.type === 'water' || t.type === 'ocean' || t.type === 'sea';
}
function hasDocksAt(scene, q, r) {
  return (scene.buildings || []).some(b => b.type === 'docks' && b.q === q && b.r === r);
}
function isLandPassable(scene, q, r) {
  const t = tileAt(scene, q, r);
  if (!t) return hasDocksAt(scene, q, r); // treat docks as passable fallback

  if (isWater(scene, q, r)) {
    // docks tile is passable even if underlying tile is water
    return hasDocksAt(scene, q, r);
  }
  if (t.type === 'mountain') return false;
  return true;
}

export default {
  applyLogisticsRoutesOnEndTurn,
};
