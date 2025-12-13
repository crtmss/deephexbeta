// src/scenes/WorldSceneElectricity.js
//
// Simplified electricity simulation + placement API.
//
// NETWORK RULES (simplified):
//  - A "power network" exists only if the connected component contains
//    at least one generator building (solar_panel / fuel_generator).
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

const keyOf = (q, r) => `${q},${r}`;

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
  if (typeof b.q === "number" && typeof b.r === "number") return { q: b.q, r: b.r };
  if (b.tile && typeof b.tile.q === "number" && typeof b.tile.r === "number") return { q: b.tile.q, r: b.tile.r };
  if (b.hex && typeof b.hex.q === "number" && typeof b.hex.r === "number") return { q: b.hex.q, r: b.hex.r };
  if (b.position && typeof b.position.q === "number" && typeof b.position.r === "number") return { q: b.position.q, r: b.position.r };
  return null;
}

function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function buildingEnergyConfig(b) {
  const e = b && b.energy ? b.energy : {};
  const type = String(b?.type || "").toLowerCase();

  if (type === "solar_panel" && !e.productionPerTurn) {
    return { ...e, productionPerTurn: 2, requiresPower: false, pullsFromNetwork: false };
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
    return { ...e, storageCapacity: 20, requiresPower: false, pullsFromNetwork: true };
  }

  return e;
}

function isGeneratorBuilding(b) {
  const type = String(b?.type || "").toLowerCase();
  return type === "solar_panel" || type === "fuel_generator";
}

function isProducerBuilding(b) {
  const e = buildingEnergyConfig(b);
  if (e.productionPerTurn && e.productionPerTurn > 0) return true;
  return isGeneratorBuilding(b);
}

function isStorageBuilding(b) {
  const e = buildingEnergyConfig(b);
  return !!(e.storageCapacity && e.storageCapacity > 0);
}

function isConsumerBuilding(b) {
  const e = buildingEnergyConfig(b);
  return !!(e.requiresPower && (e.consumptionPerTurn || 0) > 0);
}

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

  const byKeyTile = new Map();
  for (const t of tiles) {
    if (!t) continue;
    byKeyTile.set(keyOf(t.q, t.r), t);
  }

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

  // tiles with conduits/poles
  for (const t of tiles) {
    if (!t) continue;
    if (t.hasPowerConduit || t.hasPowerPole) ensureNode(t.q, t.r);
  }

  // buildings participating
  const buildings = getAllBuildings(scene);
  for (const b of buildings) {
    const type = String(b?.type || "").toLowerCase();
    const e = buildingEnergyConfig(b);

    const participates =
      isProducerBuilding(b) ||
      isStorageBuilding(b) ||
      isConsumerBuilding(b) ||
      !!e.pullsFromNetwork ||
      type === "power_pole" ||
      type === "power_conduit";

    if (!participates) continue;

    const pos = getBuildingCoords(b);
    if (!pos) continue;

    const node = ensureNode(pos.q, pos.r);
    if (!node) continue;
    node.buildings.add(b);

    if (type === "power_pole") {
      node.hasPole = true;
      if (node.tile) node.tile.hasPowerPole = true;
    } else if (type === "power_conduit") {
      node.hasConduit = true;
      if (node.tile) node.tile.hasPowerConduit = true;
    }
  }

  // adjacency: axial neighbors (this connects adjacent generators automatically)
  for (const node of nodeByKey.values()) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const nk = keyOf(node.q + dq, node.r + dr);
      if (!nodeByKey.has(nk)) continue;
      node.neighbors.add(nk);
      nodeByKey.get(nk).neighbors.add(node.key);
    }
  }

  // pole radius <=2
  for (const node of nodeByKey.values()) {
    const hasPole =
      node.hasPole ||
      Array.from(node.buildings).some((b) => String(b?.type || "").toLowerCase() === "power_pole");
    if (!hasPole) continue;

    for (const other of nodeByKey.values()) {
      if (other.key === node.key) continue;
      if (hexDistance(node.q, node.r, other.q, other.r) <= 2) {
        node.neighbors.add(other.key);
        other.neighbors.add(node.key);
      }
    }
  }

  // flood-fill components
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
      hasAnyGenerator: false,
    };

    const q = [node];
    visited.add(node.key);

    while (q.length) {
      const cur = q.shift();
      comp.nodes.push(cur);

      for (const b of cur.buildings) {
        const e = buildingEnergyConfig(b);

        if (isProducerBuilding(b)) comp.producers.push(b);
        if (isConsumerBuilding(b)) comp.consumers.push(b);
        if (isStorageBuilding(b)) {
          comp.storage.push(b);
          comp.storageCapacity += Math.max(0, e.storageCapacity || 0);
        }
        if (isGeneratorBuilding(b)) {
          comp.generators.push(b);
          comp.hasAnyGenerator = true;
        }
      }

      for (const nk of cur.neighbors) {
        if (visited.has(nk)) continue;
        const n = nodeByKey.get(nk);
        if (!n) continue;
        visited.add(nk);
        q.push(n);
      }
    }

    raw.push(comp);
  }

  // filter: network exists only if component has generator(s)
  const networks = {};
  let nextId = 1;

  for (const comp of raw) {
    if (!comp.hasAnyGenerator) continue;

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

    // mark buildings with network id
    for (const node of net.nodes) {
      for (const b of node.buildings) {
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
    for (const b of net.producers) {
      if (!b) continue;
      const type = String(b.type || "").toLowerCase();
      const e = buildingEnergyConfig(b);

      let p = 0;

      if (type === "solar_panel") {
        p = e.productionPerTurn ?? 2;
        b.powerOnline = p > 0;
        if (b.powerOnline) workingGenerators += 1;
      } else if (type === "fuel_generator") {
        const fuelPerTurn = e.fuelPerTurn ?? 1;
        const ok = consumeCrudeOil(scene, fuelPerTurn);
        if (ok) {
          p = e.productionPerTurn ?? 5;
          b.powerOnline = p > 0;
          if (b.powerOnline) workingGenerators += 1;
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

      for (const c of net.consumers) {
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
    for (const c of net.consumers) {
      if (!c) continue;
      const e = buildingEnergyConfig(c);
      demand += Math.max(0, e.consumptionPerTurn || 0);
    }

    // satisfy demand (all-or-nothing)
    if (demand > 0) {
      if ((net.storedEnergy || 0) >= demand) {
        net.storedEnergy -= demand;
        for (const c of net.consumers) {
          if (!c) continue;
          c.powerOnline = true;
          c.powerOfflineReason = null;
        }
      } else {
        for (const c of net.consumers) {
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
    console.log("No generator-networks found (no components with generators).");
    return;
  }

  for (const id of ids) {
    const net = nets[id];
    if (!net) continue;

    const buildings = [];
    for (const node of net.nodes) {
      for (const b of node.buildings) {
        const pos = getBuildingCoords(b);
        buildings.push({
          type: b?.type,
          id: b?.id,
          q: pos?.q,
          r: pos?.r,
        });
      }
    }

    console.log(`[Network ${net.id}]`, {
      nodes: net.nodes.length,
      generators: net.generators.length,
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
    byKeyTile.set(keyOf(t.q, t.r), t);
  }

  function hexCenter(t) {
    const pos = scene.hexToPixel(t.q, t.r, size);
    const y = pos.y - LIFT * effectiveElevationLocal(t);
    return { x: pos.x + offsetX, y: y + offsetY };
  }

  const active = scene.electricState?.highlightNetworkId ?? null;
  const highlightKeys = new Set();

  if (active != null) {
    const net = scene.electricState?.networks?.[active];
    if (net) {
      for (const n of net.nodes) highlightKeys.add(n.key);
    }
  }

  const alphaForKey = (k) => {
    if (active == null) return 1;
    return highlightKeys.has(k) ? 1 : 0.15;
  };

  // conduits
  for (const t of tiles) {
    if (!t || !t.hasPowerConduit) continue;

    const k1 = keyOf(t.q, t.r);
    const c = hexCenter(t);
    const a1 = alphaForKey(k1);

    for (const [dq, dr] of AXIAL_DIRS) {
      const nk = keyOf(t.q + dq, t.r + dr);
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
      const nt = byKeyTile.get(keyOf(t.q + dq, t.r + dr));
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

    const k = keyOf(t.q, t.r);
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
  if (scene.selectedUnit && typeof scene.selectedUnit.q === "number" && typeof scene.selectedUnit.r === "number") {
    return { q: scene.selectedUnit.q, r: scene.selectedUnit.r };
  }
  if (scene.selectedHex && typeof scene.selectedHex.q === "number" && typeof scene.selectedHex.r === "number") {
    return { q: scene.selectedHex.q, r: scene.selectedHex.r };
  }
  return null;
}

function spawnEnergyBuilding(scene, kind, q, r) {
  // Prefer scene.axialToWorld if exists (it already includes elevation in your patched WorldScene.js)
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
  else if (kind === "battery") { emoji = "🔋"; name = "Battery"; }
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
  } else if (kind === "battery") building.energy.storageCapacity = 20;

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
  const tile = mapData.find((t) => t.q === q && t.r === r);
  if (!tile) {
    console.warn("[ENERGY] Target tile not found for", kind, "at", q, r);
    return;
  }

  if (kind === "solar_panel" || kind === "fuel_generator" || kind === "battery") {
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
