// src/scenes/WorldSceneElectricity.js
//
// Simplified electricity simulation + placement API.
//
// NETWORK RULES (simplified):
//  - A "power network" exists only if the connected component contains
//    at least one WORKING generator building (solar_panel / fuel_generator).
//  - Adjacent generators automatically connect into the same network (no cables needed).
//  - Cables / poles / batteries / consumers are attached via connectivity rules.
//  - Storage is per-network via batteries.
//
// Highlighting:
//  - scene.electricState.highlightNetworkId controls overlay + building alpha.
//  - UI can call setHighlightedNetwork(scene, id) / clearHighlightedNetwork(scene)
//
// Debugging:
//  - debugElectricity(scene) prints all networks, their nodes, and buildings with coords.
//
// Placement API (required by WorldSceneBuildings.js):
//  - initElectricityForScene(scene) attaches scene.startEnergyBuildingPlacement(kind)
//
// Public API:
//   initElectricity(scene)
//   markElectricDirty(scene)
//   onTileUpdated(scene, tile)
//   onBuildingPlaced(scene, building)
//   onBuildingRemoved(scene, building)
//   recalcNetworks(scene)
//   tickElectricity(scene)
//   isBuildingPowered(scene, building)
//   drawElectricOverlay(scene)
//   recomputeGlobalEnergyStats(scene)
//   debugElectricity(scene)
//   setHighlightedNetwork(scene, id)
//   clearHighlightedNetwork(scene)
//   initElectricityForScene(scene)
//   applyElectricityOnEndTurn(scene)
//   startEnergyBuildingPlacement(scene, kind)

import { effectiveElevationLocal } from "./WorldSceneGeography.js";

const AXIAL_DIRS = [
  [+1, 0],
  [+1, -1],
  [0, -1],
  [-1, 0],
  [-1, +1],
  [0, +1],
];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normQR(q, r) {
  const nq = toNum(q);
  const nr = toNum(r);
  if (nq == null || nr == null) return null;
  return { q: nq, r: nr };
}
const keyOf = (q, r) => `${q},${r}`;

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

/* =========================================================
   Helpers: buildings, positions, resources
   ========================================================= */

function getAllBuildings(scene) {
  const out = [];
  const seen = new Set();

  function addArray(arr) {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b) continue;
      const id = b.id ?? b.uuid ?? b.name ?? b;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(b);
    }
  }

  addArray(scene.buildings);
  addArray(scene.structures);
  addArray(scene.cityBuildings);
  if (scene.state && Array.isArray(scene.state.buildings)) {
    addArray(scene.state.buildings);
  }

  return out;
}

function getBuildingCoords(b) {
  if (!b) return null;

  // Most common
  if (b.q != null && b.r != null) {
    return normQR(b.q, b.r);
  }
  // Common wrappers
  if (b.tile && b.tile.q != null && b.tile.r != null) {
    return normQR(b.tile.q, b.tile.r);
  }
  if (b.hex && b.hex.q != null && b.hex.r != null) {
    return normQR(b.hex.q, b.hex.r);
  }
  if (b.position && b.position.q != null && b.position.r != null) {
    return normQR(b.position.q, b.position.r);
  }

  return null;
}

function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function typeOf(b) {
  return String(b?.type || "").toLowerCase();
}

function isBatteryType(t) {
  return (
    t === "battery" ||
    t === "accumulator" ||
    t === "storage_battery" ||
    t === "battery_storage"
  );
}

function buildingEnergyConfig(b) {
  const e = (b && b.energy) ? b.energy : {};
  const t = typeOf(b);

  // Defaults (only if value missing / non-finite)
  if (t === "solar_panel") {
    const prod = Number.isFinite(e.productionPerTurn) ? e.productionPerTurn : 2;
    return { ...e, productionPerTurn: prod, requiresPower: false, pullsFromNetwork: false };
  }

  if (t === "fuel_generator") {
    const prod = Number.isFinite(e.productionPerTurn) ? e.productionPerTurn : 5;
    const fuelPerTurn = Number.isFinite(e.fuelPerTurn) ? e.fuelPerTurn : 1;
    return {
      ...e,
      productionPerTurn: prod,
      fuelType: e.fuelType || "crude_oil",
      fuelPerTurn,
      requiresPower: false,
      pullsFromNetwork: false,
    };
  }

  if (isBatteryType(t)) {
    const cap = Number.isFinite(e.storageCapacity) ? e.storageCapacity : 20;
    return { ...e, storageCapacity: cap, requiresPower: false, pullsFromNetwork: true };
  }

  return e;
}

function isGeneratorBuilding(b) {
  const t = typeOf(b);
  return t === "solar_panel" || t === "fuel_generator";
}

function isProducerBuilding(b) {
  const t = typeOf(b);
  const e = buildingEnergyConfig(b);
  if (t === "solar_panel") return true;
  if (t === "fuel_generator") return true;
  return Number.isFinite(e.productionPerTurn) && e.productionPerTurn > 0;
}

function isStorageBuilding(b) {
  const e = buildingEnergyConfig(b);
  return Number.isFinite(e.storageCapacity) && e.storageCapacity > 0;
}

function isConsumerBuilding(b) {
  const e = buildingEnergyConfig(b);
  return !!(e.requiresPower && (e.consumptionPerTurn || 0) > 0);
}

function getResourceBag(scene) {
  return scene.playerResources || scene.resources || scene.state?.resources || null;
}

function getCrudeOilAmount(scene) {
  const res = getResourceBag(scene);
  if (!res) return 0;
  const keys = ["crudeOil", "crude_oil", "crudeoil", "Crude Oil"];
  for (const k of keys) {
    if (typeof res[k] === "number") return res[k];
  }
  return 0;
}

function canFuelGeneratorRun(scene, gen) {
  const e = buildingEnergyConfig(gen);
  const fuelPerTurn = Math.max(0, e.fuelPerTurn ?? 1);
  if (fuelPerTurn <= 0) return true;
  return getCrudeOilAmount(scene) >= fuelPerTurn;
}

function consumeCrudeOil(scene, amount) {
  if (!scene || !amount || amount <= 0) return false;
  const res = getResourceBag(scene);
  if (!res) return false;

  const keys = ["crudeOil", "crude_oil", "crudeoil", "Crude Oil"];
  for (const k of keys) {
    if (typeof res[k] === "number" && res[k] >= amount) {
      res[k] -= amount;
      return true;
    }
  }
  return false;
}

/* =========================================================
   Electricity state & lifecycle
   ========================================================= */

export function initElectricity(scene) {
  if (!scene) return;

  if (!scene.electricState) {
    scene.electricState = {
      networks: {},
      nextNetworkId: 1,
      dirty: true,
      highlightNetworkId: null,
    };
  }

  const es = scene.electricState;
  if (typeof es.baseCapacity !== "number") es.baseCapacity = 5;
  if (typeof es.baseStored !== "number") es.baseStored = 0;
  if (typeof es.baseProductionPerTurn !== "number") es.baseProductionPerTurn = 1;

  if (!scene.energyStats) {
    scene.energyStats = { current: 0, capacity: es.baseCapacity };
  }
}

export function markElectricDirty(scene) {
  if (!scene || !scene.electricState) return;
  scene.electricState.dirty = true;
}

export function onTileUpdated(scene, _tile) {
  if (!scene) return;
  initElectricity(scene);
  markElectricDirty(scene);
}

export function onBuildingPlaced(scene, _building) {
  if (!scene) return;
  initElectricity(scene);
  markElectricDirty(scene);
}

export function onBuildingRemoved(scene, _building) {
  if (!scene) return;
  initElectricity(scene);
  markElectricDirty(scene);
}

/* =========================================================
   Network building (simplified rules)
   ========================================================= */

function ensureNetworks(scene) {
  if (!scene || !scene.electricState) return;
  if (!scene.electricState.dirty) return;
  recalcNetworks(scene);
}

function signatureForNodes(nodes) {
  // stable signature to carry storedEnergy across recalcs
  const keys = nodes.map(n => n.key).slice().sort();
  return keys.join("|");
}

export function recalcNetworks(scene) {
  initElectricity(scene);
  const state = scene.electricState;

  const tiles = scene.mapData;
  if (!Array.isArray(tiles) || !tiles.length) {
    state.networks = {};
    state.nextNetworkId = 1;
    state.dirty = false;
    return;
  }

  // Keep old stored energy by signature
  const oldBySig = new Map();
  for (const id in (state.networks || {})) {
    const net = state.networks[id];
    if (!net || !Array.isArray(net.nodes)) continue;
    const sig = signatureForNodes(net.nodes);
    oldBySig.set(sig, {
      storedEnergy: Number.isFinite(net.storedEnergy) ? net.storedEnergy : 0,
    });
  }

  const byKeyTile = new Map();
  for (const t of tiles) {
    if (!t) continue;
    const qr = normQR(t.q, t.r);
    if (!qr) continue;
    byKeyTile.set(keyOf(qr.q, qr.r), t);
  }

  const nodeByKey = new Map();

  function ensureNode(q, r) {
    const qr = normQR(q, r);
    if (!qr) return null;
    const k = keyOf(qr.q, qr.r);

    let node = nodeByKey.get(k);
    if (!node) {
      const tile = byKeyTile.get(k);
      if (!tile) return null;
      node = {
        key: k,
        q: qr.q,
        r: qr.r,
        tile,
        hasConduit: !!tile.hasPowerConduit,
        hasPole: !!tile.hasPowerPole,
        buildings: new Set(),
        neighbors: new Set(),
      };
      nodeByKey.set(k, node);
    }
    return node;
  }

  // 1) tiles with conduits/poles
  for (const t of tiles) {
    if (!t) continue;
    const qr = normQR(t.q, t.r);
    if (!qr) continue;
    if (t.hasPowerConduit || t.hasPowerPole) ensureNode(qr.q, qr.r);
  }

  // 2) buildings participating (generators, storage, consumers, poles, conduits)
  const buildings = getAllBuildings(scene);
  for (const b of buildings) {
    const t = typeOf(b);
    const e = buildingEnergyConfig(b);

    const participates =
      isProducerBuilding(b) ||
      isStorageBuilding(b) ||
      isConsumerBuilding(b) ||
      !!e.pullsFromNetwork ||
      t === "power_pole" ||
      t === "power_conduit";

    if (!participates) continue;

    const pos = getBuildingCoords(b);
    if (!pos) continue;

    const node = ensureNode(pos.q, pos.r);
    if (!node) continue;

    node.buildings.add(b);

    if (t === "power_pole") {
      node.hasPole = true;
      if (node.tile) node.tile.hasPowerPole = true;
    } else if (t === "power_conduit") {
      node.hasConduit = true;
      if (node.tile) node.tile.hasPowerConduit = true;
    }
  }

  // 3) adjacency between existing nodes (axial neighbors)
  for (const node of nodeByKey.values()) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const nk = keyOf(node.q + dq, node.r + dr);
      if (!nodeByKey.has(nk)) continue;
      node.neighbors.add(nk);
      nodeByKey.get(nk).neighbors.add(node.key);
    }
  }

  // 4) pole radius <=2
  for (const node of nodeByKey.values()) {
    const hasPole =
      node.hasPole ||
      Array.from(node.buildings).some((b) => typeOf(b) === "power_pole");
    if (!hasPole) continue;

    for (const other of nodeByKey.values()) {
      if (other.key === node.key) continue;
      if (hexDistance(node.q, node.r, other.q, other.r) <= 2) {
        node.neighbors.add(other.key);
        other.neighbors.add(node.key);
      }
    }
  }

  // 5) flood-fill connected components
  const raw = [];
  const visited = new Set();

  for (const node of nodeByKey.values()) {
    if (visited.has(node.key)) continue;

    const comp = {
      nodes: [],
      producers: [],
      consumers: [],
      storage: [],
      generators: [],
      storageCapacity: 0,
      hasAnyWorkingGenerator: false,
    };

    const queue = [node];
    visited.add(node.key);

    while (queue.length) {
      const cur = queue.shift();
      comp.nodes.push(cur);

      for (const b of cur.buildings) {
        const e = buildingEnergyConfig(b);
        const t = typeOf(b);

        if (isProducerBuilding(b)) comp.producers.push(b);
        if (isConsumerBuilding(b)) comp.consumers.push(b);

        if (isStorageBuilding(b)) {
          comp.storage.push(b);
          comp.storageCapacity += Math.max(0, e.storageCapacity || 0);
        }

        if (isGeneratorBuilding(b)) {
          comp.generators.push(b);

          // WORKING generator rule:
          if (t === "solar_panel") {
            comp.hasAnyWorkingGenerator = true;
          } else if (t === "fuel_generator") {
            if (canFuelGeneratorRun(scene, b)) comp.hasAnyWorkingGenerator = true;
          }
        }
      }

      for (const nk of cur.neighbors) {
        if (visited.has(nk)) continue;
        const n = nodeByKey.get(nk);
        if (!n) continue;
        visited.add(nk);
        queue.push(n);
      }
    }

    raw.push(comp);
  }

  // 6) filter: network exists only if component has >=1 working generator
  const networks = {};
  let nextId = 1;

  for (const comp of raw) {
    if (!comp.hasAnyWorkingGenerator) continue;

    const id = nextId++;
    const net = {
      id,
      nodes: comp.nodes,
      producers: comp.producers,
      consumers: comp.consumers,
      storage: comp.storage,
      generators: comp.generators,
      storageCapacity: comp.storageCapacity,
      storedEnergy: 0,
      lastProduced: 0,
      lastDemand: 0,
      lastWorkingGenerators: 0,
    };

    // carry stored energy (by signature)
    const sig = signatureForNodes(net.nodes);
    const old = oldBySig.get(sig);
    if (old) {
      const cap = Math.max(0, net.storageCapacity || 0);
      net.storedEnergy = cap > 0 ? Math.min(cap, old.storedEnergy) : 0;
    }

    // mark buildings with network id
    for (const n of net.nodes) {
      for (const b of n.buildings) {
        b.powerNetworkId = id;
      }
    }

    networks[id] = net;
  }

  state.networks = networks;
  state.nextNetworkId = nextId;
  state.dirty = false;
}

/* =========================================================
   Global energy stats
   ========================================================= */

export function recomputeGlobalEnergyStats(scene) {
  if (!scene || !scene.electricState) return;
  ensureNetworks(scene);

  const es = scene.electricState;
  let totalCapacity = es.baseCapacity || 0;
  let totalStored = es.baseStored || 0;

  for (const id in es.networks || {}) {
    const net = es.networks[id];
    if (!net) continue;
    totalCapacity += net.storageCapacity || 0;
    totalStored += net.storedEnergy || 0;
  }

  es.totalCapacity = totalCapacity;
  es.totalStored = totalStored;

  if (!scene.energyStats) scene.energyStats = { current: 0, capacity: 0 };
  scene.energyStats.current = totalStored;
  scene.energyStats.capacity = Math.max(totalCapacity, 5);

  scene.updateResourceUI?.();
  scene.refreshResourcesPanel?.();
}

/* =========================================================
   Simulation per turn
   ========================================================= */

export function tickElectricity(scene) {
  if (!scene) return;
  initElectricity(scene);

  // Base: +1 per turn, max 5
  const es = scene.electricState;
  if (!Number.isFinite(es.baseStored)) es.baseStored = 0;
  const baseCap = es.baseCapacity ?? 0;
  const baseProd = es.baseProductionPerTurn ?? 0;
  if (baseProd > 0 && baseCap > 0) {
    es.baseStored = Math.min(baseCap, es.baseStored + baseProd);
  }

  ensureNetworks(scene);

  const nets = es.networks || {};
  const ids = Object.keys(nets);
  if (!ids.length) {
    recomputeGlobalEnergyStats(scene);
    return;
  }

  for (const idStr of ids) {
    const net = nets[idStr];
    if (!net) continue;

    let produced = 0;
    let demand = 0;
    let workingGenerators = 0;

    // production
    for (const b of safeArr(net.producers)) {
      if (!b) continue;
      const t = typeOf(b);
      const e = buildingEnergyConfig(b);

      let p = 0;

      if (t === "solar_panel") {
        p = e.productionPerTurn ?? 2;
        b.powerOnline = p > 0;
        if (b.powerOnline) workingGenerators += 1;
      } else if (t === "fuel_generator") {
        const fuelPerTurn = e.fuelPerTurn ?? 1;
        const ok = consumeCrudeOil(scene, fuelPerTurn);
        if (ok) {
          p = e.productionPerTurn ?? 5;
          b.powerOnline = p > 0;
          if (b.powerOnline) workingGenerators += 1;
          b.powerOfflineReason = null;
        } else {
          p = 0;
          b.powerOnline = false;
          b.powerOfflineReason = "no_fuel";
        }
      } else {
        p = e.productionPerTurn || 0;
        b.powerOnline = p > 0;
      }

      produced += Math.max(0, p);
    }

    // if no working generators -> consumers offline, only clamp storage
    if (workingGenerators <= 0) {
      net.lastProduced = 0;
      net.lastDemand = 0;
      net.lastWorkingGenerators = 0;

      for (const c of safeArr(net.consumers)) {
        if (!c) continue;
        c.powerOnline = false;
        c.powerOfflineReason = "no_power_source";
      }

      const cap = Math.max(0, net.storageCapacity || 0);
      net.storedEnergy = Math.min(Math.max(0, net.storedEnergy || 0), cap);
      continue;
    }

    // storage update: only if capacity > 0 (no batteries -> wasted)
    const cap = Math.max(0, net.storageCapacity || 0);
    if (cap > 0) {
      net.storedEnergy = Math.min(cap, (net.storedEnergy || 0) + produced);
    } else {
      net.storedEnergy = 0;
    }

    // demand
    for (const c of safeArr(net.consumers)) {
      if (!c) continue;
      const e = buildingEnergyConfig(c);
      demand += Math.max(0, e.consumptionPerTurn || 0);
    }

    // satisfy demand (all-or-nothing)
    if (demand > 0) {
      if ((net.storedEnergy || 0) >= demand) {
        net.storedEnergy -= demand;
        for (const c of safeArr(net.consumers)) {
          if (!c) continue;
          c.powerOnline = true;
          c.powerOfflineReason = null;
        }
      } else {
        for (const c of safeArr(net.consumers)) {
          if (!c) continue;
          c.powerOnline = false;
          c.powerOfflineReason = "no_power";
        }
      }
    }

    net.lastProduced = produced;
    net.lastDemand = demand;
    net.lastWorkingGenerators = workingGenerators;
  }

  recomputeGlobalEnergyStats(scene);
}

export function isBuildingPowered(_scene, building) {
  if (!building) return false;
  if (typeof building.powerOnline === "boolean") return building.powerOnline;
  const e = buildingEnergyConfig(building);
  if (!e.requiresPower) return true;
  return false;
}

/* =========================================================
   Highlight API
   ========================================================= */

export function setHighlightedNetwork(scene, networkId) {
  if (!scene) return;
  initElectricity(scene);

  scene.electricState.highlightNetworkId = (networkId == null) ? null : Number(networkId);

  const active = scene.electricState.highlightNetworkId;
  const all = getAllBuildings(scene);

  for (const b of all) {
    if (!b) continue;
    const cont = b.container;
    if (!cont || typeof cont.setAlpha !== "function") continue;

    if (active == null) {
      cont.setAlpha(1);
      continue;
    }

    cont.setAlpha(b.powerNetworkId === active ? 1 : 0.25);
  }
}

export function clearHighlightedNetwork(scene) {
  setHighlightedNetwork(scene, null);
}

/* =========================================================
   Debugging
   ========================================================= */

export function debugElectricity(scene) {
  if (!scene) return;
  initElectricity(scene);
  ensureNetworks(scene);

  const es = scene.electricState;
  const nets = es.networks || {};

  console.log("=== [ENERGY DEBUG] Networks ===");
  console.log("base:", {
    baseStored: es.baseStored,
    baseCapacity: es.baseCapacity,
    baseProductionPerTurn: es.baseProductionPerTurn,
  });

  const ids = Object.keys(nets);
  if (!ids.length) {
    console.log("No WORKING-generator networks found (no connected component with working generators).");
    return;
  }

  for (const id of ids) {
    const net = nets[id];
    if (!net) continue;

    const buildings = [];
    for (const node of safeArr(net.nodes)) {
      for (const b of node.buildings || []) {
        const pos = getBuildingCoords(b);
        buildings.push({
          type: b?.type,
          id: b?.id,
          q: pos?.q,
          r: pos?.r,
          energy: b?.energy || null,
        });
      }
    }

    console.log(`[Network ${net.id}]`, {
      nodes: net.nodes.length,
      generators: net.generators.length,
      storageBuildings: net.storage.length,
      storageCapacity: net.storageCapacity,
      storedEnergy: net.storedEnergy,
      lastProduced: net.lastProduced,
      lastDemand: net.lastDemand,
      lastWorkingGenerators: net.lastWorkingGenerators,
      buildings,
    });
  }
}

/* =========================================================
   Rendering: overlay for conduits & poles (with highlight)
   ========================================================= */

export function drawElectricOverlay(scene) {
  if (!scene || !Array.isArray(scene.mapData)) return;

  ensureNetworks(scene);

  const tiles = scene.mapData;
  const size = scene.hexSize || 24;
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;

  if (scene.powerGraphics) scene.powerGraphics.destroy();
  if (scene.powerPoleGraphics) scene.powerPoleGraphics.destroy();

  const gLines = scene.add.graphics().setDepth(38);
  const gPoles = scene.add.graphics().setDepth(39);
  scene.powerGraphics = gLines;
  scene.powerPoleGraphics = gPoles;

  const byKeyTile = new Map();
  for (const t of tiles) {
    if (!t) continue;
    const qr = normQR(t.q, t.r);
    if (!qr) continue;
    byKeyTile.set(keyOf(qr.q, qr.r), t);
  }

  function hexCenter(t) {
    const qr = normQR(t.q, t.r);
    if (!qr) return { x: 0, y: 0 };
    const pos = scene.hexToPixel(qr.q, qr.r, size);
    const y = pos.y - LIFT * effectiveElevationLocal(t);
    return { x: pos.x + offsetX, y: y + offsetY };
  }

  const active = scene.electricState?.highlightNetworkId ?? null;
  const highlightKeys = new Set();

  if (active != null) {
    const net = scene.electricState?.networks?.[active];
    if (net) {
      for (const n of safeArr(net.nodes)) highlightKeys.add(n.key);
    }
  }

  const alphaForKey = (k) => {
    if (active == null) return 1;
    return highlightKeys.has(k) ? 1 : 0.15;
  };

  // conduits
  for (const t of tiles) {
    if (!t || !t.hasPowerConduit) continue;
    const qr = normQR(t.q, t.r);
    if (!qr) continue;

    const k1 = keyOf(qr.q, qr.r);
    const c = hexCenter(t);
    const a1 = alphaForKey(k1);

    for (const [dq, dr] of AXIAL_DIRS) {
      const nk = keyOf(qr.q + dq, qr.r + dr);
      const nt = byKeyTile.get(nk);
      if (!nt) continue;
      if (!nt.hasPowerConduit && !nt.hasPowerPole) continue;

      const c2 = hexCenter(nt);
      const a2 = alphaForKey(nk);
      const a = Math.min(a1, a2);

      gLines.lineStyle(3, 0x777777, a);
      gLines.beginPath();
      gLines.moveTo(c.x, c.y);
      gLines.lineTo(c2.x, c2.y);
      gLines.strokePath();
    }

    let hasNeighbor = false;
    for (const [dq, dr] of AXIAL_DIRS) {
      const nt = byKeyTile.get(keyOf(qr.q + dq, qr.r + dr));
      if (!nt) continue;
      if (nt.hasPowerConduit || nt.hasPowerPole) {
        hasNeighbor = true;
        break;
      }
    }
    if (!hasNeighbor) {
      gLines.fillStyle(0x777777, a1);
      gLines.fillCircle(c.x, c.y, size * 0.2);
    }
  }

  // poles
  for (const t of tiles) {
    if (!t || !t.hasPowerPole) continue;
    const qr = normQR(t.q, t.r);
    if (!qr) continue;

    const k = keyOf(qr.q, qr.r);
    const a = alphaForKey(k);
    const c = hexCenter(t);

    gPoles.lineStyle(2, 0xfff58a, a);
    gPoles.strokeCircle(c.x, c.y, size * 0.45);
    gPoles.fillStyle(0xfff58a, a);
    gPoles.fillCircle(c.x, c.y, size * 0.12);
  }
}

/* =========================================================
   Placement API (required by WorldSceneBuildings.js)
   ========================================================= */

function getEnergyPlacementHex(scene) {
  if (scene.selectedUnit && scene.selectedUnit.q != null && scene.selectedUnit.r != null) {
    return normQR(scene.selectedUnit.q, scene.selectedUnit.r);
  }
  if (scene.selectedHex && scene.selectedHex.q != null && scene.selectedHex.r != null) {
    return normQR(scene.selectedHex.q, scene.selectedHex.r);
  }
  return null;
}

function spawnEnergyBuilding(scene, kind, q, r) {
  const pos = (typeof scene.axialToWorld === "function")
    ? scene.axialToWorld(q, r)
    : scene.hexToPixel(q, r, scene.hexSize || 24);

  const plateW = 36;
  const plateH = 36;
  const radius = 8;

  const cont = scene.add.container(pos.x, pos.y).setDepth(2100);

  const plate = scene.add.graphics();
  plate.fillStyle(0x0f2233, 0.92);
  plate.fillRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, radius);
  plate.lineStyle(2, 0x3da9fc, 0.9);
  plate.strokeRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, radius);

  let emoji = "⚡";
  let name = "Power";
  if (kind === "solar_panel") { emoji = "🔆"; name = "Solar"; }
  else if (kind === "fuel_generator") { emoji = "⛽"; name = "Generator"; }
  else if (kind === "battery" || kind === "accumulator") { emoji = "🔋"; name = "Battery"; }
  else if (kind === "power_pole") { emoji = "🗼"; name = "Pole"; }
  else if (kind === "power_conduit") { emoji = "•"; name = "Conduit"; }

  const emojiText = scene.add.text(0, 0, emoji, {
    fontSize: "22px",
    color: "#ffffff",
  }).setOrigin(0.5);

  const label = scene.add.text(0, plateH / 2 + 10, name, {
    fontSize: "14px",
    color: "#e8f6ff",
  }).setOrigin(0.5, 0);

  cont.add([plate, emojiText, label]);

  scene.buildings = scene.buildings || [];
  scene._buildingIdSeq = (scene._buildingIdSeq || 1) + 1;
  const id = scene._buildingIdSeq;

  const building = {
    id,
    type: kind,
    name,
    q,
    r,
    container: cont,
    energy: {},
  };

  if (kind === "solar_panel") building.energy.productionPerTurn = 2;
  else if (kind === "fuel_generator") {
    building.energy.productionPerTurn = 5;
    building.energy.fuelType = "crude_oil";
    building.energy.fuelPerTurn = 1;
  } else if (kind === "battery" || kind === "accumulator") {
    building.energy.storageCapacity = 20;
  }

  scene.buildings.push(building);

  onBuildingPlaced(scene, building);
  return building;
}

export function startEnergyBuildingPlacement(scene, kind) {
  if (!scene) return;

  initElectricity(scene);

  const hex = getEnergyPlacementHex(scene);
  if (!hex) {
    console.warn("[ENERGY] No target hex for", kind, "(no unit / selected hex)");
    return;
  }

  const { q, r } = hex;
  const mapData = scene.mapData || [];
  const tile = mapData.find((t) => Number(t?.q) === q && Number(t?.r) === r);
  if (!tile) {
    console.warn("[ENERGY] Target tile not found for", kind, "at", q, r);
    return;
  }

  if (kind === "solar_panel" || kind === "fuel_generator" || kind === "battery" || kind === "accumulator") {
    if (tile.type === "water" || tile.type === "ocean" || tile.type === "sea") {
      console.warn("[ENERGY] Cannot place", kind, "on water.");
      return;
    }
    spawnEnergyBuilding(scene, kind, q, r);
  } else if (kind === "power_pole") {
    tile.hasPowerPole = true;
    spawnEnergyBuilding(scene, kind, q, r);
  } else if (kind === "power_conduit") {
    tile.hasPowerConduit = true;
    spawnEnergyBuilding(scene, kind, q, r);
  } else {
    console.warn("[ENERGY] Unknown energy kind:", kind);
    return;
  }

  markElectricDirty(scene);

  try { drawElectricOverlay(scene); } catch (err) {
    console.error("[ENERGY] Error while drawing electric overlay after placement:", err);
  }

  recomputeGlobalEnergyStats(scene);
}

/* =========================================================
   Scene-level integration
   ========================================================= */

export function initElectricityForScene(scene) {
  if (!scene) return;
  initElectricity(scene);

  // Ensure scene.electricitySystem exists for UI calls (refreshEnergyPanel checks this)
  if (!scene.electricitySystem) {
    scene.electricitySystem = {
      initElectricityForScene,
      initElectricity,
      markElectricDirty,
      onTileUpdated,
      onBuildingPlaced,
      onBuildingRemoved,
      recalcNetworks,
      tickElectricity,
      isBuildingPowered,
      drawElectricOverlay,
      recomputeGlobalEnergyStats,
      debugElectricity,
      setHighlightedNetwork,
      clearHighlightedNetwork,
      startEnergyBuildingPlacement,
      applyElectricityOnEndTurn,
    };
  }

  if (!scene.electricity) scene.electricity = {};
  scene.electricity.initialized = true;

  // IMPORTANT: WorldSceneBuildings.js expects this to exist
  if (typeof scene.startEnergyBuildingPlacement !== "function") {
    scene.startEnergyBuildingPlacement = function (kind) {
      return startEnergyBuildingPlacement(scene, kind);
    };
  }
  scene.electricity.startEnergyBuildingPlacement = scene.startEnergyBuildingPlacement;

  // Convenience overlay hook
  scene.drawElectricityOverlay = () => drawElectricOverlay(scene);

  recomputeGlobalEnergyStats(scene);
}

export function applyElectricityOnEndTurn(scene) {
  tickElectricity(scene);
}

/* =========================================================
   Default export
   ========================================================= */

export default {
  initElectricity,
  markElectricDirty,
  onTileUpdated,
  onBuildingPlaced,
  onBuildingRemoved,
  recalcNetworks,
  tickElectricity,
  isBuildingPowered,
  drawElectricOverlay,
  recomputeGlobalEnergyStats,
  debugElectricity,
  setHighlightedNetwork,
  clearHighlightedNetwork,
  initElectricityForScene,
  applyElectricityOnEndTurn,
  startEnergyBuildingPlacement,
};
