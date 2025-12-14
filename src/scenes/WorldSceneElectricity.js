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
// UI UPDATE RULES (fixed):
//  - UI refreshes on every end turn (if panel open).
//  - UI refreshes whenever an element is placed/removed that may affect networks.
//  - Stored energy persists across recalcNetworks() (no more wipe-to-0 when dirty).
//  - Stored energy is preserved on MERGE (sum) and distributed on SPLIT (proportional).
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
   Type normalization (CRITICAL FIX)
   Many parts of your project use different naming:
   "solar" vs "solar_panel", "cable" vs "power_conduit", etc.
   ========================================================= */

function normType(t) {
  return String(t || "").trim().toLowerCase();
}

function canonicalType(rawType) {
  const t = normType(rawType);

  // generators
  if (t === "solar_panel" || t === "solar" || t === "solarpanel" || t === "panel_solar") return "solar_panel";
  if (t === "fuel_generator" || t === "generator" || t === "fuelgenerator" || t === "fuel_gen") return "fuel_generator";

  // storage
  if (t === "battery" || t === "accumulator" || t === "akku" || t === "storage_battery") return "battery";

  // wires / conduits
  if (t === "power_conduit" || t === "conduit" || t === "cable" || t === "wire" || t === "power_cable" || t === "powerline") {
    return "power_conduit";
  }

  // poles
  if (t === "power_pole" || t === "pole" || t === "pylon" || t === "tower") return "power_pole";

  return t;
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
  if (scene.state && Array.isArray(scene.state.buildings)) addArray(scene.state.buildings);

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
  const type = canonicalType(b?.type);

  if (type === "solar_panel" && !Number.isFinite(e.productionPerTurn)) {
    return { ...e, productionPerTurn: 2, requiresPower: false, pullsFromNetwork: false };
  }
  if (type === "fuel_generator" && !Number.isFinite(e.productionPerTurn)) {
    return {
      ...e,
      productionPerTurn: 5,
      fuelType: "crude_oil",
      fuelPerTurn: 1,
      requiresPower: false,
      pullsFromNetwork: false,
    };
  }
  if (type === "battery" && !Number.isFinite(e.storageCapacity)) {
    return { ...e, storageCapacity: 20, requiresPower: false, pullsFromNetwork: true };
  }

  return e;
}

function isGeneratorBuilding(b) {
  const type = canonicalType(b?.type);
  return type === "solar_panel" || type === "fuel_generator";
}

function isProducerBuilding(b) {
  const type = canonicalType(b?.type);
  const e = buildingEnergyConfig(b);
  if (Number.isFinite(e.productionPerTurn) && e.productionPerTurn > 0) return true;
  return type === "solar_panel" || type === "fuel_generator";
}

function isStorageBuilding(b) {
  const type = canonicalType(b?.type);
  const e = buildingEnergyConfig(b);
  return type === "battery" || !!(Number.isFinite(e.storageCapacity) && e.storageCapacity > 0);
}

function isConsumerBuilding(b) {
  const e = buildingEnergyConfig(b);
  return !!(e.requiresPower && (e.consumptionPerTurn || 0) > 0);
}

function isConduitThing(bOrTileType) {
  return canonicalType(bOrTileType) === "power_conduit";
}

function isPoleThing(bOrTileType) {
  return canonicalType(bOrTileType) === "power_pole";
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

      // watcher
      _lastSig: "",
      _inNotify: false,
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

function notifyElectricityChanged(scene, reason = "") {
  if (!scene?.electricState) return;
  const es = scene.electricState;

  if (es._inNotify) return;
  es._inNotify = true;

  try {
    if (es.dirty) {
      try { recalcNetworks(scene); } catch (e) {}
    }

    try { recomputeGlobalEnergyStats(scene); } catch (e) {}

    if (scene.energyUI?.isOpen && typeof scene.refreshEnergyPanel === "function") {
      try { scene.refreshEnergyPanel(); } catch (e) {}
    }

    if (typeof scene.drawElectricityOverlay === "function") {
      try { scene.drawElectricityOverlay(); } catch (e) {}
    }

    // (optional) debug log:
    // if (reason) console.log("[ENERGY] changed:", reason);
  } finally {
    es._inNotify = false;
  }
}

export function markElectricDirty(scene, reason = "") {
  if (!scene) return;
  initElectricity(scene);
  scene.electricState.dirty = true;
  notifyElectricityChanged(scene, reason || "markElectricDirty");
}

export function onTileUpdated(scene, _tile) {
  if (!scene) return;
  initElectricity(scene);
  markElectricDirty(scene, "tileUpdated");
}

export function onBuildingPlaced(scene, _building) {
  if (!scene) return;
  initElectricity(scene);
  markElectricDirty(scene, "buildingPlaced");
}

export function onBuildingRemoved(scene, _building) {
  if (!scene) return;
  initElectricity(scene);
  markElectricDirty(scene, "buildingRemoved");
}

/* =========================================================
   Watcher: detect appearance/destruction even if caller forgot hooks
   ========================================================= */

function isEnergyRelevantBuilding(b) {
  if (!b) return false;
  const t = canonicalType(b.type);
  if (t === "solar_panel" || t === "fuel_generator" || t === "battery") return true;
  if (t === "power_conduit" || t === "power_pole") return true;

  const e = buildingEnergyConfig(b);
  if (e?.pullsFromNetwork) return true;
  if (isConsumerBuilding(b)) return true;
  if (isProducerBuilding(b)) return true;
  return false;
}

function computeEnergySignature(scene) {
  const items = [];
  for (const b of getAllBuildings(scene)) {
    if (!isEnergyRelevantBuilding(b)) continue;
    const pos = getBuildingCoords(b);
    if (!pos) continue;
    const id = b.id ?? `${b.type}:${pos.q},${pos.r}`;
    items.push(`${String(id)}@${pos.q},${pos.r}:${canonicalType(b.type)}`);
  }
  items.sort();
  return items.join("|");
}

function ensureWatched(scene) {
  initElectricity(scene);
  const es = scene.electricState;

  const sig = computeEnergySignature(scene);
  if (sig !== es._lastSig) {
    es._lastSig = sig;
    es.dirty = true;
  }
}

/* =========================================================
   Network building (simplified rules + storedEnergy persistence)
   ========================================================= */

function ensureNetworks(scene) {
  if (!scene || !scene.electricState) return;

  ensureWatched(scene);

  if (!scene.electricState.dirty) return;
  recalcNetworks(scene);
}

function overlapScore(oldNet, newKeysSet) {
  if (!oldNet?.nodes || !Array.isArray(oldNet.nodes)) return 0;
  let hit = 0;
  for (const n of oldNet.nodes) {
    if (newKeysSet.has(n.key)) hit++;
  }
  return hit;
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

  /* ---------------------------------------------
     Preserve old networks for energy transfer
     --------------------------------------------- */
  const oldNetworks = state.networks || {};
  const oldList = Object.values(oldNetworks);

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

  /* ---------------------------------------------
     Tiles with conduits / poles
     --------------------------------------------- */
  for (const t of tiles) {
    if (!t) continue;
    if (t.hasPowerConduit || t.hasPowerPole) {
      ensureNode(t.q, t.r);
    }
  }

  /* ---------------------------------------------
     Buildings that participate in electricity
     --------------------------------------------- */
  const buildings = getAllBuildings(scene);
  for (const b of buildings) {
    const type = canonicalType(b?.type);
    const e = buildingEnergyConfig(b);

    const participates =
      isProducerBuilding(b) ||
      isStorageBuilding(b) ||
      isConsumerBuilding(b) ||
      !!e.pullsFromNetwork ||
      isPoleThing(type) ||
      isConduitThing(type);

    if (!participates) continue;

    const pos = getBuildingCoords(b);
    if (!pos) continue;

    const node = ensureNode(pos.q, pos.r);
    if (!node) continue;

    node.buildings.add(b);

    if (isPoleThing(type)) {
      node.hasPole = true;
      if (node.tile) node.tile.hasPowerPole = true;
    } else if (isConduitThing(type)) {
      node.hasConduit = true;
      if (node.tile) node.tile.hasPowerConduit = true;
    }
  }

  /* ---------------------------------------------
     Adjacency: axial neighbors
     (this connects adjacent generators automatically)
     --------------------------------------------- */
  for (const node of nodeByKey.values()) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const nk = keyOf(node.q + dq, node.r + dr);
      if (!nodeByKey.has(nk)) continue;
      node.neighbors.add(nk);
      nodeByKey.get(nk).neighbors.add(node.key);
    }
  }

  /* ---------------------------------------------
     Power pole radius (<= 2 hexes)
     --------------------------------------------- */
  for (const node of nodeByKey.values()) {
    const hasPole =
      node.hasPole ||
      Array.from(node.buildings).some(b => isPoleThing(b?.type));

    if (!hasPole) continue;

    for (const other of nodeByKey.values()) {
      if (other.key === node.key) continue;
      if (hexDistance(node.q, node.r, other.q, other.r) <= 2) {
        node.neighbors.add(other.key);
        other.neighbors.add(node.key);
      }
    }
  }

  /* ---------------------------------------------
     Flood fill connected components
     --------------------------------------------- */
  const rawComponents = [];
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

    const queue = [node];
    visited.add(node.key);

    while (queue.length) {
      const cur = queue.shift();
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
        queue.push(n);
      }
    }

    rawComponents.push(comp);
  }

  /* ---------------------------------------------
     Build final networks
     --------------------------------------------- */
  const networks = {};
  let nextId = 1;

  for (const comp of rawComponents) {
    // network exists ONLY if at least one generator
    if (!comp.hasAnyGenerator) continue;

    const id = nextId++;

    const newKeysSet = new Set(comp.nodes.map(n => n.key));

    /* -----------------------------------------
       ENERGY PRESERVATION (MERGE + SPLIT)
       ----------------------------------------- */
    let carriedEnergy = 0;
    let totalOverlap = 0;

    for (const oldNet of oldList) {
      if (!oldNet?.nodes) continue;
      const overlap = overlapScore(oldNet, newKeysSet);
      if (overlap > 0) {
        totalOverlap += overlap;
        carriedEnergy += (oldNet.storedEnergy || 0) * overlap;
      }
    }

    if (totalOverlap > 0) {
      carriedEnergy = carriedEnergy / totalOverlap;
    } else {
      carriedEnergy = 0;
    }

    const net = {
      id,
      nodes: comp.nodes,
      producers: comp.producers,
      consumers: comp.consumers,
      storage: comp.storage,
      generators: comp.generators,
      storageCapacity: comp.storageCapacity,

      // ✅ FIX: stored energy survives recalc + merges
      storedEnergy: Math.min(
        comp.storageCapacity || Infinity,
        Math.max(0, Math.round(carriedEnergy))
      ),

      lastProduced: 0,
      lastDemand: 0,
      lastWorkingGenerators: 0,
    };

    /* -----------------------------------------
       Mark buildings with network id
       ----------------------------------------- */
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

  ensureWatched(scene);

  // Base energy
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
    notifyElectricityChanged(scene, "tick:noNetworks");
    return;
  }

  for (const idStr of ids) {
    const net = nets[idStr];
    if (!net) continue;

    let produced = 0;
    let demand = 0;
    let workingGenerators = 0;

    /* ---------- production ---------- */
    for (const b of net.producers) {
      if (!b) continue;
      const type = canonicalType(b.type);
      const e = buildingEnergyConfig(b);

      let p = 0;

      if (type === "solar_panel") {
        p = e.productionPerTurn ?? 2;
        b.powerOnline = p > 0;
        if (b.powerOnline) workingGenerators++;
      } else if (type === "fuel_generator") {
        const ok = consumeCrudeOil(scene, e.fuelPerTurn ?? 1);
        if (ok) {
          p = e.productionPerTurn ?? 5;
          b.powerOnline = true;
          workingGenerators++;
        } else {
          b.powerOnline = false;
          b.powerOfflineReason = "no_fuel";
        }
      }

      produced += Math.max(0, p);
    }

    /* ---------- no generators ---------- */
    if (workingGenerators <= 0) {
      net.lastProduced = 0;
      net.lastDemand = 0;
      net.lastWorkingGenerators = 0;

      for (const c of net.consumers) {
        c.powerOnline = false;
        c.powerOfflineReason = "no_power_source";
      }

      net.storedEnergy = Math.min(
        Math.max(0, net.storedEnergy || 0),
        net.storageCapacity || 0
      );
      continue;
    }

    /* ---------- storage ---------- */
    const cap = Math.max(0, net.storageCapacity || 0);
    if (cap > 0) {
      net.storedEnergy = Math.min(cap, (net.storedEnergy || 0) + produced);
    } else {
      net.storedEnergy = 0;
    }

    /* ---------- demand ---------- */
    for (const c of net.consumers) {
      const e = buildingEnergyConfig(c);
      demand += Math.max(0, e.consumptionPerTurn || 0);
    }

    if (demand > 0) {
      if (net.storedEnergy >= demand) {
        net.storedEnergy -= demand;
        for (const c of net.consumers) {
          c.powerOnline = true;
          c.powerOfflineReason = null;
        }
      } else {
        for (const c of net.consumers) {
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
  notifyElectricityChanged(scene, "tick");
}

/* =========================================================
   Overlay rendering
   ========================================================= */

export function drawElectricOverlay(scene) {
  if (!scene || !Array.isArray(scene.mapData)) return;

  ensureNetworks(scene);

  if (scene.powerGraphics) scene.powerGraphics.destroy();
  if (scene.powerPoleGraphics) scene.powerPoleGraphics.destroy();

  const gLines = scene.add.graphics().setDepth(38);
  const gPoles = scene.add.graphics().setDepth(39);
  scene.powerGraphics = gLines;
  scene.powerPoleGraphics = gPoles;

  const size = scene.hexSize || 24;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;

  const byKeyTile = new Map();
  for (const t of scene.mapData) {
    if (!t) continue;
    byKeyTile.set(keyOf(t.q, t.r), t);
  }

  function hexCenter(t) {
    const pos = scene.hexToPixel(t.q, t.r, size);
    return {
      x: pos.x,
      y: pos.y - LIFT * effectiveElevationLocal(t),
    };
  }

  const active = scene.electricState?.highlightNetworkId ?? null;
  const highlightKeys = new Set();

  if (active != null) {
    const net = scene.electricState.networks?.[active];
    if (net) {
      for (const n of net.nodes) highlightKeys.add(n.key);
    }
  }

  const alphaForKey = (k) =>
    active == null ? 1 : highlightKeys.has(k) ? 1 : 0.15;

  /* ---------- conduits ---------- */
  for (const t of scene.mapData) {
    if (!t?.hasPowerConduit) continue;

    const c = hexCenter(t);
    const k1 = keyOf(t.q, t.r);
    const a1 = alphaForKey(k1);

    for (const [dq, dr] of AXIAL_DIRS) {
      const nt = byKeyTile.get(keyOf(t.q + dq, t.r + dr));
      if (!nt || (!nt.hasPowerConduit && !nt.hasPowerPole)) continue;

      const c2 = hexCenter(nt);
      const a2 = alphaForKey(keyOf(nt.q, nt.r));

      gLines.lineStyle(3, 0x777777, Math.min(a1, a2));
      gLines.beginPath();
      gLines.moveTo(c.x, c.y);
      gLines.lineTo(c2.x, c2.y);
      gLines.strokePath();
    }
  }

  /* ---------- poles ---------- */
  for (const t of scene.mapData) {
    if (!t?.hasPowerPole) continue;
    const c = hexCenter(t);
    const a = alphaForKey(keyOf(t.q, t.r));

    gPoles.lineStyle(2, 0xfff58a, a);
    gPoles.strokeCircle(c.x, c.y, size * 0.45);
    gPoles.fillStyle(0xfff58a, a);
    gPoles.fillCircle(c.x, c.y, size * 0.12);
  }
}

/* =========================================================
   Highlighting API (needed by default export)
   ========================================================= */

export function setHighlightedNetwork(scene, id) {
  if (!scene) return;
  initElectricity(scene);
  scene.electricState.highlightNetworkId = id ?? null;

  // Refresh visuals/UI if present
  try { scene.drawElectricityOverlay?.(); } catch (e) {}
  try { scene.refreshEnergyPanel?.(); } catch (e) {}
}

export function clearHighlightedNetwork(scene) {
  return setHighlightedNetwork(scene, null);
}

/* =========================================================
   Debugging API (needed by default export)
   ========================================================= */

export function debugElectricity(scene) {
  if (!scene) {
    console.log("[ENERGY] debugElectricity: no scene");
    return;
  }
  initElectricity(scene);

  try {
    if (scene.electricState?.dirty) recalcNetworks(scene);
  } catch (e) {
    console.warn("[ENERGY] debugElectricity: recalcNetworks failed:", e);
  }

  const es = scene.electricState || {};
  const nets = es.networks || {};
  const ids = Object.keys(nets);

  console.groupCollapsed(
    `[ENERGY] Debug | networks=${ids.length} | baseStored=${es.baseStored ?? "?"}/${es.baseCapacity ?? "?"} | totalStored=${es.totalStored ?? "?"}/${es.totalCapacity ?? "?"}`
  );

  for (const id of ids) {
    const net = nets[id];
    if (!net) continue;

    const nodes = Array.isArray(net.nodes) ? net.nodes : [];
    const nodeList = nodes.map((n) => `(${n.q},${n.r})`).join(" ");

    const producers = (net.producers || []).map((b) => {
      const p = getBuildingCoords(b);
      return `${canonicalType(b?.type)}@${p ? `${p.q},${p.r}` : "?"}`;
    });

    const consumers = (net.consumers || []).map((b) => {
      const p = getBuildingCoords(b);
      return `${canonicalType(b?.type)}@${p ? `${p.q},${p.r}` : "?"}`;
    });

    const storage = (net.storage || []).map((b) => {
      const p = getBuildingCoords(b);
      return `${canonicalType(b?.type)}@${p ? `${p.q},${p.r}` : "?"}`;
    });

    console.groupCollapsed(
      `Network #${id} | stored=${net.storedEnergy ?? 0}/${net.storageCapacity ?? 0} | produced(last)=${net.lastProduced ?? 0} | demand(last)=${net.lastDemand ?? 0} | gensWorking(last)=${net.lastWorkingGenerators ?? 0}`
    );
    console.log("nodes:", nodeList);
    console.log("producers:", producers);
    console.log("consumers:", consumers);
    console.log("storage:", storage);
    console.groupEnd();
  }

  console.groupEnd();
}

/* =========================================================
   Building spawn helper (called by placement)
   - This is defensive: it tries to use existing scene APIs first.
   ========================================================= */

function spawnEnergyBuilding(scene, kind, q, r) {
  // Try to call the game's existing placement/build APIs if they exist.
  const tile = scene.mapData?.find((t) => t?.q === q && t?.r === r) || null;

  // Common patterns in Phaser strategy projects
  const candidates = [
    scene.spawnBuilding,
    scene.placeBuilding,
    scene.createBuilding,
    scene.addBuilding,
    scene.buildBuilding,
  ].filter((fn) => typeof fn === "function");

  for (const fn of candidates) {
    try {
      // Some implementations expect (type, q, r), others (type, tile), etc.
      const res =
        fn.length >= 3 ? fn.call(scene, kind, q, r)
        : fn.length === 2 ? fn.call(scene, kind, { q, r })
        : fn.call(scene, kind);

      if (res) return res;
    } catch (e) {
      // keep trying fallbacks
    }
  }

  // Fallback: create a minimal building object and push to known arrays
  const b = {
    id: `energy:${kind}:${q},${r}:${Date.now()}`,
    type: kind,
    q,
    r,
    tile: tile || undefined,
    energy: buildingEnergyConfig({ type: kind, energy: {} }),
  };

  if (!Array.isArray(scene.buildings)) scene.buildings = [];
  scene.buildings.push(b);

  // If it's a conduit/pole, mark the tile flags so recalcNetworks sees it even if buildings are not tracked elsewhere
  if (tile) {
    if (kind === "power_conduit") tile.hasPowerConduit = true;
    if (kind === "power_pole") tile.hasPowerPole = true;
  }

  // If the game has a renderer hook, try to let it render the new building
  try { scene.renderBuilding?.(b); } catch (e) {}
  try { scene.refreshMap?.(); } catch (e) {}

  return b;
}

/* =========================================================
   PLACEMENT API (🔥 FIXED, NOT UNDEFINED)
   ========================================================= */

export function startEnergyBuildingPlacement(scene, kindRaw) {
  if (!scene) return;
  initElectricity(scene);

  const kind = canonicalType(kindRaw);

  const hex =
    scene.selectedHex ||
    (scene.selectedUnit
      ? { q: scene.selectedUnit.q, r: scene.selectedUnit.r }
      : null);

  if (!hex) {
    console.warn("[ENERGY] No placement hex");
    return;
  }

  const tile = scene.mapData?.find((t) => t.q === hex.q && t.r === hex.r);
  if (!tile) return;

  if (
    (kind === "solar_panel" ||
      kind === "fuel_generator" ||
      kind === "battery") &&
    tile.type === "water"
  ) {
    console.warn("[ENERGY] Cannot place on water");
    return;
  }

  spawnEnergyBuilding(scene, kind, hex.q, hex.r);

  markElectricDirty(scene, `placed:${kind}`);
  drawElectricOverlay(scene);
  recomputeGlobalEnergyStats(scene);
  notifyElectricityChanged(scene, `placed:${kind}`);
}

/* =========================================================
   Scene integration
   ========================================================= */

export function initElectricityForScene(scene) {
  if (!scene) return;
  initElectricity(scene);

  if (!scene.electricity) scene.electricity = {};
  scene.electricity.initialized = true;

  // 🔥 THIS FIXES YOUR ERROR
  scene.startEnergyBuildingPlacement = function (kind) {
    return startEnergyBuildingPlacement(scene, kind);
  };

  scene.electricity.startEnergyBuildingPlacement =
    scene.startEnergyBuildingPlacement;

  scene.drawElectricityOverlay = () => drawElectricOverlay(scene);

  notifyElectricityChanged(scene, "initForScene");
}

export function applyElectricityOnEndTurn(scene) {
  tickElectricity(scene);
  notifyElectricityChanged(scene, "endTurn");
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
  recomputeGlobalEnergyStats,
  drawElectricOverlay,
  debugElectricity,
  setHighlightedNetwork,
  clearHighlightedNetwork,
  initElectricityForScene,
  applyElectricityOnEndTurn,
  startEnergyBuildingPlacement,
};
