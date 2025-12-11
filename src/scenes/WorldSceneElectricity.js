// src/scenes/WorldSceneElectricity.js
//
// Centralized electricity simulation:
//
//  - Tracks power networks built from power conduits + power poles + buildings.
//  - Each network can have producers, consumers and storage (batteries).
//  - Energy is stored per-network and consumed each turn.
//  - Buildings get flags: building.powerNetworkId, building.powerOnline.
//
// Public API (to be used by other scenes):
//   initElectricity(scene)
//   markElectricDirty(scene)
//   onTileUpdated(scene, tile)
//   onBuildingPlaced(scene, building)
//   onBuildingRemoved(scene, building)
//   recalcNetworks(scene)
//   tickElectricity(scene)
//   isBuildingPowered(scene, building)
//   drawElectricOverlay(scene)
//
import { effectiveElevationLocal } from "./WorldSceneGeography.js";

const AXIAL_DIRS = [
  [+1, 0],
  [+1, -1],
  [0, -1],
  [-1, 0],
  [-1, +1],
  [0, +1],
];

const keyOf = (q, r) => `${q},${r}`;

/* =========================================================
   Helpers: buildings, positions, resources
   ========================================================= */

/**
 * Try to collect all building-like entities on the scene.
 * This is intentionally defensive: если чего-то нет — просто возвращаем меньше.
 */
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

/**
 * Extract integer q,r from a building object.
 */
function getBuildingCoords(b) {
  if (!b) return null;
  if (typeof b.q === "number" && typeof b.r === "number") {
    return { q: b.q, r: b.r };
  }
  if (b.tile && typeof b.tile.q === "number" && typeof b.tile.r === "number") {
    return { q: b.tile.q, r: b.tile.r };
  }
  if (b.hex && typeof b.hex.q === "number" && typeof b.hex.r === "number") {
    return { q: b.hex.q, r: b.hex.r };
  }
  if (b.position && typeof b.position.q === "number" && typeof b.position.r === "number") {
    return { q: b.position.q, r: b.position.r };
  }
  return null;
}

/**
 * Simple axial hex distance.
 */
function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * Very defensive check whether building participates in electricity system.
 */
function buildingEnergyConfig(b) {
  const e = b && b.energy ? b.energy : {};
  const type = String(b?.type || "").toLowerCase();

  // Default templates if energy block is missing:
  if (type === "solar_panel" && !e.productionPerTurn) {
    return {
      ...e,
      productionPerTurn: 2,
      requiresPower: false,
      pullsFromNetwork: false,
    };
  }
  if (type === "fuel_generator" && !e.productionPerTurn) {
    return {
      ...e,
      productionPerTurn: 5,
      fuelType: "crude_oil",
      fuelPerTurn: 1,
      requiresPower: false,
      pullsFromNetwork: false,
    };
  }
  if (type === "battery" && !e.storageCapacity) {
    return {
      ...e,
      storageCapacity: 20,
      requiresPower: false,
      pullsFromNetwork: true,
    };
  }

  return e;
}

function isProducerBuilding(b) {
  const type = String(b?.type || "").toLowerCase();
  const e = buildingEnergyConfig(b);
  if (e.productionPerTurn && e.productionPerTurn > 0) return true;
  if (type === "solar_panel" || type === "fuel_generator") return true;
  return false;
}

function isStorageBuilding(b) {
  const e = buildingEnergyConfig(b);
  return !!(e.storageCapacity && e.storageCapacity > 0);
}

function isConsumerBuilding(b) {
  const e = buildingEnergyConfig(b);
  if (e.requiresPower && e.consumptionPerTurn > 0) return true;
  // Fallback: если явно не указано, не трогаем.
  return false;
}

/**
 * Try to consume crude oil from scene-level resources.
 * Returns true if enough oil was available and consumed.
 */
function consumeCrudeOil(scene, amount) {
  if (!scene || !amount || amount <= 0) return false;
  const res = scene.playerResources || scene.resources || scene.state?.resources;
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
      networks: {},    // id -> network object
      nextNetworkId: 1,
      dirty: true,
    };
  }
}

/**
 * Mark electricity networks as needing a rebuild.
 */
export function markElectricDirty(scene) {
  if (!scene || !scene.electricState) return;
  scene.electricState.dirty = true;
}

export function onTileUpdated(scene, tile) {
  if (!scene || !tile) return;
  initElectricity(scene);
  markElectricDirty(scene);
}

export function onBuildingPlaced(scene, building) {
  if (!scene || !building) return;
  initElectricity(scene);
  markElectricDirty(scene);
}

export function onBuildingRemoved(scene, building) {
  if (!scene || !building) return;
  initElectricity(scene);
  markElectricDirty(scene);
}

/* =========================================================
   Network building
   ========================================================= */

function ensureNetworks(scene) {
  if (!scene || !scene.electricState) return;
  if (!scene.electricState.dirty) return;
  recalcNetworks(scene);
}

/**
 * Rebuild all electricity networks from tile + building data.
 * Safe to call часто – но обычно мы вызываем только если dirty=true.
 */
export function recalcNetworks(scene) {
  initElectricity(scene);
  const state = scene.electricState;
  if (!Array.isArray(scene.mapData) || !scene.mapData.length) {
    state.networks = {};
    state.nextNetworkId = 1;
    state.dirty = false;
    return;
  }

  const tiles = scene.mapData;
  const byKeyTile = new Map();
  for (const t of tiles) {
    if (!t) continue;
    byKeyTile.set(keyOf(t.q, t.r), t);
  }

  // ---------- Build nodes ----------
  // Node = tile that has conduit / pole / relevant building.
  const nodeByKey = new Map();

  function ensureNode(q, r) {
    const k = keyOf(q, r);
    let node = nodeByKey.get(k);
    if (!node) {
      const tile = byKeyTile.get(k);
      if (!tile) return null;
      node = {
        key: k,
        q,
        r,
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
    if (t.hasPowerConduit || t.hasPowerPole) {
      ensureNode(t.q, t.r);
    }
  }

  // 2) buildings with energy config
  const buildings = getAllBuildings(scene);
  for (const b of buildings) {
    const e = buildingEnergyConfig(b);
    const type = String(b?.type || "").toLowerCase();
    const participates =
      isProducerBuilding(b) || isStorageBuilding(b) || isConsumerBuilding(b) ||
      e.pullsFromNetwork ||
      type === "power_pole" || type === "power_conduit";

    if (!participates) continue;

    const pos = getBuildingCoords(b);
    if (!pos) continue;

    const node = ensureNode(pos.q, pos.r);
    if (!node) continue;
    node.buildings.add(b);

    // If a building is actually a pole / conduit, mirror flags to tile
    if (type === "power_pole") {
      node.hasPole = true;
      if (node.tile) node.tile.hasPowerPole = true;
    } else if (type === "power_conduit") {
      node.hasConduit = true;
      if (node.tile) node.tile.hasPowerConduit = true;
    }
  }

  // ---------- Build adjacency (edges) ----------
  // 1) axial neighbors
  for (const node of nodeByKey.values()) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const nq = node.q + dq;
      const nr = node.r + dr;
      const nk = keyOf(nq, nr);
      if (!nodeByKey.has(nk)) continue;
      node.neighbors.add(nk);
      const n = nodeByKey.get(nk);
      n.neighbors.add(node.key);
    }
  }

  // 2) power pole radius (q,r within distance <= 2)
  for (const node of nodeByKey.values()) {
    if (!node.hasPole && !Array.from(node.buildings).some(
      (b) => String(b?.type || "").toLowerCase() === "power_pole"
    )) {
      continue;
    }

    for (const other of nodeByKey.values()) {
      if (other.key === node.key) continue;
      const dist = hexDistance(node.q, node.r, other.q, other.r);
      if (dist <= 2) {
        node.neighbors.add(other.key);
        other.neighbors.add(node.key);
      }
    }
  }

  // ---------- Flood-fill into networks ----------
  const networks = {};
  const visited = new Set();
  let nextId = 1;

  for (const node of nodeByKey.values()) {
    if (visited.has(node.key)) continue;

    const id = nextId++;
    const net = {
      id,
      nodes: [],
      producers: [],
      consumers: [],
      storage: [],
      storageCapacity: 0,
      storedEnergy: 0,
      lastProduced: 0,
      lastDemand: 0,
    };

    const queue = [node];
    visited.add(node.key);

    while (queue.length) {
      const cur = queue.shift();
      net.nodes.push(cur);

      for (const b of cur.buildings) {
        const e = buildingEnergyConfig(b);

        // Remember network id on building
        b.powerNetworkId = id;

        if (isProducerBuilding(b)) {
          net.producers.push(b);
        }
        if (isConsumerBuilding(b)) {
          net.consumers.push(b);
        }
        if (isStorageBuilding(b)) {
          net.storage.push(b);
          net.storageCapacity += Math.max(0, e.storageCapacity || 0);
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

    networks[id] = net;
  }

  state.networks = networks;
  state.nextNetworkId = nextId;
  // NOTE: мы пока не переносим старую storedEnergy при пересборке — можно добавить позже.
  state.dirty = false;
}

/* =========================================================
   Simulation per turn
   ========================================================= */

export function tickElectricity(scene) {
  if (!scene || !scene.electricState) return;
  ensureNetworks(scene);

  const state = scene.electricState;
  const nets = state.networks || {};
  const netIds = Object.keys(nets);
  if (!netIds.length) return;

  for (const idStr of netIds) {
    const net = nets[idStr];
    if (!net) continue;

    let produced = 0;
    let demand = 0;

    // 1) Production
    for (const b of net.producers) {
      if (!b) continue;
      const type = String(b.type || "").toLowerCase();
      const e = buildingEnergyConfig(b);
      let p = 0;

      if (type === "solar_panel") {
        p = e.productionPerTurn ?? 2;
        b.powerOnline = true;
      } else if (type === "fuel_generator") {
        const fuelPerTurn = e.fuelPerTurn ?? 1;
        const ok = consumeCrudeOil(scene, fuelPerTurn);
        if (ok) {
          p = e.productionPerTurn ?? 5;
          b.powerOnline = true;
        } else {
          p = 0;
          b.powerOnline = false;
          b.powerOfflineReason = "no_fuel";
        }
      } else {
        // Generic producer
        p = e.productionPerTurn || 0;
        b.powerOnline = true;
      }

      produced += Math.max(0, p);
    }

    // 2) Storage update: add produced to storedEnergy
    if (produced > 0) {
      if (net.storageCapacity > 0) {
        net.storedEnergy = Math.min(
          net.storageCapacity,
          (net.storedEnergy || 0) + produced
        );
      } else {
        // If there is no storage at all, we still allow transient energy:
        net.storedEnergy = (net.storedEnergy || 0) + produced;
      }
    }

    // 3) Demand
    for (const c of net.consumers) {
      if (!c) continue;
      const e = buildingEnergyConfig(c);
      demand += Math.max(0, e.consumptionPerTurn || 0);
    }

    // 4) Satisfy demand: simple "all-or-nothing" scheme
    if (demand > 0) {
      if ((net.storedEnergy || 0) >= demand) {
        // Enough power for everyone
        net.storedEnergy -= demand;
        for (const c of net.consumers) {
          if (!c) continue;
          c.powerOnline = true;
          c.powerOfflineReason = null;
        }
      } else {
        // Not enough power -> all consumers offline (for now)
        for (const c of net.consumers) {
          if (!c) continue;
          c.powerOnline = false;
          c.powerOfflineReason = "no_power";
        }
      }
    }

    net.lastProduced = produced;
    net.lastDemand = demand;
  }
}

/**
 * Public helper: check if building currently has power.
 */
export function isBuildingPowered(scene, building) {
  if (!building) return false;
  if (typeof building.powerOnline === "boolean") {
    return building.powerOnline;
  }
  // Fallback: if it doesn't require power, consider it "powered".
  const e = buildingEnergyConfig(building);
  if (!e.requiresPower) return true;
  return false;
}

/* =========================================================
   Rendering: overlay for conduits & poles
   ========================================================= */

/**
 * Draw electric overlay (cables + poles) on top of the map.
 * Should be called from WorldSceneMapLocations after roads/POIs.
 */
export function drawElectricOverlay(scene) {
  if (!scene || !Array.isArray(scene.mapData)) return;

  ensureNetworks(scene);

  const tiles = scene.mapData;
  const size = scene.hexSize || 24;
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;

  // Clear previous graphics
  if (scene.powerGraphics) {
    scene.powerGraphics.destroy();
  }
  if (scene.powerPoleGraphics) {
    scene.powerPoleGraphics.destroy();
  }

  const gLines = scene.add.graphics().setDepth(38);
  const gPoles = scene.add.graphics().setDepth(39);

  scene.powerGraphics = gLines;
  scene.powerPoleGraphics = gPoles;

  // Tiles indexed for neighbor checks
  const byKeyTile = new Map();
  for (const t of tiles) {
    if (!t) continue;
    byKeyTile.set(keyOf(t.q, t.r), t);
  }

  function hexCenter(t) {
    const pos = scene.hexToPixel(t.q, t.r, size);
    const y = pos.y - LIFT * effectiveElevationLocal(t);
    return { x: pos.x + offsetX, y: y + offsetY };
  }

  // --- Draw conduits as short fat segments between neighbors ---
  for (const t of tiles) {
    if (!t || !t.hasPowerConduit) continue;

    const c = hexCenter(t);

    // check neighbors that also have conduit or pole or building
    for (const [dq, dr] of AXIAL_DIRS) {
      const nq = t.q + dq;
      const nr = t.r + dr;
      const nk = keyOf(nq, nr);
      const nt = byKeyTile.get(nk);
      if (!nt) continue;
      if (!nt.hasPowerConduit && !nt.hasPowerPole) continue;

      const c2 = hexCenter(nt);

      gLines.lineStyle(3, 0x777777, 1);
      gLines.beginPath();
      gLines.moveTo(c.x, c.y);
      gLines.lineTo(c2.x, c2.y);
      gLines.strokePath();
    }

    // if isolated (no neighbor conduits/poles) – draw a big dot
    let hasNeighbor = false;
    for (const [dq, dr] of AXIAL_DIRS) {
      const nq = t.q + dq;
      const nr = t.r + dr;
      const nt = byKeyTile.get(keyOf(nq, nr));
      if (!nt) continue;
      if (nt.hasPowerConduit || nt.hasPowerPole) {
        hasNeighbor = true;
        break;
      }
    }
    if (!hasNeighbor) {
      gLines.fillStyle(0x777777, 1);
      gLines.fillCircle(c.x, c.y, size * 0.2);
    }
  }

  // --- Draw poles as icons / markers ---
  for (const t of tiles) {
    if (!t || !t.hasPowerPole) continue;
    const c = hexCenter(t);

    gPoles.lineStyle(2, 0xfff58a, 1);
    gPoles.strokeCircle(c.x, c.y, size * 0.45);
    gPoles.fillStyle(0xfff58a, 1);
    gPoles.fillCircle(c.x, c.y, size * 0.12);
  }
}

/* =========================================================
   Adapters for WorldScene.js (compat layer)
   ========================================================= */

/**
 * Wrapper для старого API:
 * WorldScene ожидает ElectricitySystem.initElectricityForScene(scene)
 */
export function initElectricityForScene(scene) {
  // твоя основная инициализация
  initElectricity(scene);

  // совместимость с проверками вида
  // if (!scene.electricity || !scene.electricity.initialized) ...
  if (!scene.electricity) {
    scene.electricity = {};
  }
  scene.electricity.initialized = true;
}

/**
 * Wrapper для старого API:
 * WorldScene ожидает ElectricitySystem.applyElectricityOnEndTurn(scene)
 */
export function applyElectricityOnEndTurn(scene) {
  tickElectricity(scene);
}

/* =========================================================
   Default export
   ========================================================= */

export default {
  initElectricity,
  initElectricityForScene,
  markElectricDirty,
  onTileUpdated,
  onBuildingPlaced,
  onBuildingRemoved,
  recalcNetworks,
  tickElectricity,
  applyElectricityOnEndTurn,
  isBuildingPowered,
  drawElectricOverlay,
};
