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
// + high-level helpers used by WorldScene / WorldSceneBuildings:
//   initElectricityForScene(scene)          – one-time scene setup, attaches placement API
//   applyElectricityOnEndTurn(scene)       – shorthand for per-turn tick
//   startEnergyBuildingPlacement(scene, kind)
//   recomputeGlobalEnergyStats(scene)      – total energy / capacity (base + all networks)
//
// + debug:
//   debugElectricity(scene, opts)

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
 * + default configs for energy buildings.
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
    // батарея хранит до 20
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
      networks: {}, // id -> network object
      nextNetworkId: 1,
      dirty: true,
    };
  }

  // базовый блок для мобильной базы: 5 ёмкость, 1 производство/ход
  const es = scene.electricState;
  if (typeof es.baseCapacity !== "number") es.baseCapacity = 5;
  if (typeof es.baseStored !== "number") es.baseStored = 0;
  if (typeof es.baseProductionPerTurn !== "number") es.baseProductionPerTurn = 1;

  // глобальные статы, которые читает HUD (WorldSceneEconomy)
  if (!scene.energyStats) {
    scene.energyStats = {
      current: 0,
      capacity: es.baseCapacity,
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
      isProducerBuilding(b) ||
      isStorageBuilding(b) ||
      isConsumerBuilding(b) ||
      e.pullsFromNetwork ||
      type === "power_pole" ||
      type === "power_conduit";

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
  // 1) axial neighbors (direct adjacency)
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
    const hasPole =
      node.hasPole ||
      Array.from(node.buildings).some(
        (b) => String(b?.type || "").toLowerCase() === "power_pole"
      );

    if (!hasPole) continue;

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

  // IMPORTANT RULES:
  // - Energy cannot exist in a network without storage (battery).
  //   So if network has no storage capacity, clamp storedEnergy to 0.
  for (const idStr of Object.keys(state.networks)) {
    const net = state.networks[idStr];
    if (!net) continue;
    if (!(net.storageCapacity > 0)) net.storedEnergy = 0;
  }

  state.dirty = false;
}

/* =========================================================
   Global energy stats (base + all networks)
   ========================================================= */

/**
 * Пересчитать суммарную энергию/ёмкость:
 *  - база: baseStored / baseCapacity
 *  - сети: Σ net.storedEnergy / Σ net.storageCapacity
 *
 * Результат записывается в scene.energyStats.current / capacity,
 * а HUD обновляется через updateResourceUI / refreshResourcesPanel.
 */
export function recomputeGlobalEnergyStats(scene) {
  if (!scene || !scene.electricState) return;
  ensureNetworks(scene);

  const es = scene.electricState;
  let totalCapacity = es.baseCapacity || 0;
  let totalStored = es.baseStored || 0;

  const nets = es.networks || {};
  for (const id in nets) {
    const net = nets[id];
    if (!net) continue;
    totalCapacity += net.storageCapacity || 0;

    // rule: no energy if no storage
    if ((net.storageCapacity || 0) > 0) {
      totalStored += net.storedEnergy || 0;
    }
  }

  es.totalCapacity = totalCapacity;
  es.totalStored = totalStored;

  if (!scene.energyStats) {
    scene.energyStats = { current: 0, capacity: 0 };
  }
  scene.energyStats.current = totalStored;
  // хотя capacity теоретически может быть 0, HUD минимум 5
  scene.energyStats.capacity = Math.max(totalCapacity, 5);

  // Обновить UI (HUD + правая панель)
  scene.updateResourceUI?.();
  scene.refreshResourcesPanel?.();
}

/* =========================================================
   Simulation per turn
   ========================================================= */

export function tickElectricity(scene) {
  if (!scene || !scene.electricState) return;
  initElectricity(scene);

  // 0) Мобильная база: +1 энергии в ход, максимум 5.
  const es = scene.electricState;
  if (!Number.isFinite(es.baseStored)) es.baseStored = 0;
  const baseCap = es.baseCapacity ?? 0;
  const baseProd = es.baseProductionPerTurn ?? 0;
  if (baseProd > 0 && baseCap > 0) {
    es.baseStored = Math.min(baseCap, es.baseStored + baseProd);
  }

  ensureNetworks(scene);

  const nets = es.networks || {};
  const netIds = Object.keys(nets);
  if (!netIds.length) {
    recomputeGlobalEnergyStats(scene);
    return;
  }

  for (const idStr of netIds) {
    const net = nets[idStr];
    if (!net) continue;

    const hasStorage = (net.storageCapacity || 0) > 0;
    if (!hasStorage) {
      // RULE: A power network must include a battery.
      // No battery => no stored energy, producers are effectively "offline".
      net.storedEnergy = 0;

      for (const b of (net.producers || [])) {
        if (!b) continue;
        b.powerOnline = false;
        b.powerOfflineReason = "no_battery";
      }
      for (const c of (net.consumers || [])) {
        if (!c) continue;
        c.powerOnline = false;
        c.powerOfflineReason = "no_power";
      }

      net.lastProduced = 0;
      net.lastDemand = (net.consumers || []).reduce((s, c) => {
        const e = buildingEnergyConfig(c);
        return s + Math.max(0, e.consumptionPerTurn || 0);
      }, 0);

      continue;
    }

    let produced = 0;
    let demand = 0;

    // 1) Production (only meaningful if network has storage)
    for (const b of net.producers) {
      if (!b) continue;
      const type = String(b.type || "").toLowerCase();
      const e = buildingEnergyConfig(b);
      let p = 0;

      if (type === "solar_panel") {
        p = e.productionPerTurn ?? 2;
        b.powerOnline = true;
        b.powerOfflineReason = null;
      } else if (type === "fuel_generator") {
        const fuelPerTurn = e.fuelPerTurn ?? 1;
        const ok = consumeCrudeOil(scene, fuelPerTurn);
        if (ok) {
          p = e.productionPerTurn ?? 5;
          b.powerOnline = true;
          b.powerOfflineReason = null;
        } else {
          p = 0;
          b.powerOnline = false;
          b.powerOfflineReason = "no_fuel";
        }
      } else {
        // Generic producer
        p = e.productionPerTurn || 0;
        b.powerOnline = p > 0;
        b.powerOfflineReason = p > 0 ? null : "no_output";
      }

      produced += Math.max(0, p);
    }

    // 2) Storage update: add produced to storedEnergy (clamped)
    if (!Number.isFinite(net.storedEnergy)) net.storedEnergy = 0;
    if (produced > 0) {
      net.storedEnergy = Math.min(
        net.storageCapacity,
        net.storedEnergy + produced
      );
    } else {
      // still clamp in case something set it too high elsewhere
      net.storedEnergy = Math.min(net.storageCapacity, net.storedEnergy);
    }

    // 3) Demand
    for (const c of net.consumers) {
      if (!c) continue;
      const e = buildingEnergyConfig(c);
      demand += Math.max(0, e.consumptionPerTurn || 0);
    }

    // 4) Satisfy demand: simple "all-or-nothing" scheme
    if (demand > 0) {
      if (net.storedEnergy >= demand) {
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
    } else {
      // if no demand, consumers (if any) aren't forced off
      for (const c of net.consumers) {
        if (!c) continue;
        c.powerOnline = true;
        c.powerOfflineReason = null;
      }
    }

    net.lastProduced = produced;
    net.lastDemand = demand;
  }

  recomputeGlobalEnergyStats(scene);
}

/**
 * Public helper: check if building currently has power.
 */
export function isBuildingPowered(scene, building) {
  if (!building) return false;
  if (typeof building.powerOnline === "boolean") {
    return building.powerOnline;
  }
  // Fallback: если не требует энергию, считаем "есть питание".
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
   Scene-level integration + placement API
   ========================================================= */

/**
 * Called from WorldScene.create().
 * - Ensures electricState exists and base defaults are set.
 * - Attaches scene.startEnergyBuildingPlacement used by WorldSceneBuildings.
 */
export function initElectricityForScene(scene) {
  if (!scene) return;
  initElectricity(scene);

  if (!scene.electricity) {
    scene.electricity = {};
  }

  scene.electricity.initialized = true;

  // Attach placement API once per scene
  if (typeof scene.startEnergyBuildingPlacement !== "function") {
    scene.startEnergyBuildingPlacement = function (kind) {
      return startEnergyBuildingPlacement(scene, kind);
    };
  }
  scene.electricity.startEnergyBuildingPlacement =
    scene.startEnergyBuildingPlacement;

  // сразу посчитать стартовое 0/5
  recomputeGlobalEnergyStats(scene);
}

/**
 * Simple wrapper used from WorldScene.endTurn().
 */
export function applyElectricityOnEndTurn(scene) {
  tickElectricity(scene);
}

/**
 * Decide target hex for placement:
 * - prefer selectedUnit
 * - fallback to selectedHex
 */
function getEnergyPlacementHex(scene) {
  if (
    scene.selectedUnit &&
    typeof scene.selectedUnit.q === "number" &&
    typeof scene.selectedUnit.r === "number"
  ) {
    return { q: scene.selectedUnit.q, r: scene.selectedUnit.r };
  }
  if (
    scene.selectedHex &&
    typeof scene.selectedHex.q === "number" &&
    typeof scene.selectedHex.r === "number"
  ) {
    return { q: scene.selectedHex.q, r: scene.selectedHex.r };
  }
  return null;
}

/**
 * Create a simple framed-emoji building like other buildings.
 */
function spawnEnergyBuilding(scene, kind, q, r) {
  const pos = scene.axialToWorld(q, r);
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
  if (kind === "solar_panel") {
    emoji = "🔆";
    name = "Solar";
  } else if (kind === "fuel_generator") {
    emoji = "⛽";
    name = "Generator";
  } else if (kind === "battery") {
    emoji = "🔋";
    name = "Battery";
  } else if (kind === "power_pole") {
    emoji = "🗼";
    name = "Pole";
  } else if (kind === "power_conduit") {
    emoji = "•";
    name = "Conduit";
  }

  const emojiText = scene.add
    .text(0, 0, emoji, {
      fontSize: "22px",
      color: "#ffffff",
    })
    .setOrigin(0.5);

  const label = scene.add
    .text(0, plateH / 2 + 10, name, {
      fontSize: "14px",
      color: "#e8f6ff",
    })
    .setOrigin(0.5, 0);

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

  // Default energy configs (these get merged in buildingEnergyConfig)
  if (kind === "solar_panel") {
    building.energy.productionPerTurn = 2;
  } else if (kind === "fuel_generator") {
    building.energy.productionPerTurn = 5;
    building.energy.fuelType = "crude_oil";
    building.energy.fuelPerTurn = 1;
  } else if (kind === "battery") {
    building.energy.storageCapacity = 20;
    building.energy.pullsFromNetwork = true;
  }

  scene.buildings.push(building);

  // Notify electricity system
  onBuildingPlaced(scene, building);

  return building;
}

/**
 * Placement entry point used by WorldSceneBuildings._startEnergyPlacement().
 * kind: "solar_panel" | "fuel_generator" | "battery" | "power_pole" | "power_conduit"
 */
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

  // Basic placement rules (можно усложнить позже)
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
  try {
    drawElectricOverlay(scene);
  } catch (err) {
    console.error("[ENERGY] Error while drawing electric overlay after placement:", err);
  }

  recomputeGlobalEnergyStats(scene);
}

/* =========================================================
   Debug: print networks composition
   ========================================================= */

function safeType(b) {
  return String(b?.type || b?.name || "unknown").toLowerCase();
}
function safeId(b) {
  return b?.id ?? b?.uuid ?? b?.name ?? "(no-id)";
}
function getBuildingEnergySummary(b) {
  const e = buildingEnergyConfig(b) || {};
  const out = {};
  if (Number.isFinite(e.productionPerTurn) && e.productionPerTurn) out.prod = e.productionPerTurn;
  if (Number.isFinite(e.consumptionPerTurn) && e.consumptionPerTurn) out.cons = e.consumptionPerTurn;
  if (Number.isFinite(e.storageCapacity) && e.storageCapacity) out.cap = e.storageCapacity;
  if (e.requiresPower) out.requiresPower = true;
  if (e.pullsFromNetwork) out.pullsFromNetwork = true;
  if (e.fuelType) out.fuelType = e.fuelType;
  if (Number.isFinite(e.fuelPerTurn) && e.fuelPerTurn) out.fuelPerTurn = e.fuelPerTurn;
  return out;
}

/**
 * Debug helper: prints electricity state + networks composition to console.
 *
 * Usage:
 *   debugElectricity(this);
 *   debugElectricity(this, { verboseNodes: true });
 */
export function debugElectricity(scene, opts = {}) {
  if (!scene) {
    console.warn("[ENERGY][DBG] No scene");
    return;
  }

  initElectricity(scene);
  ensureNetworks(scene);

  const es = scene.electricState;
  const nets = es.networks || {};
  const ids = Object.keys(nets).map((n) => Number(n)).sort((a, b) => a - b);

  const title = `[ENERGY][DBG] Networks=${ids.length} | Base=${Math.floor(es.baseStored || 0)}/${Math.floor(es.baseCapacity || 0)} (+${Math.floor(es.baseProductionPerTurn || 0)}/turn)`;
  console.groupCollapsed(title);

  console.log("[ENERGY][DBG] Base bucket (Mobile Base):", {
    baseStored: es.baseStored,
    baseCapacity: es.baseCapacity,
    baseProductionPerTurn: es.baseProductionPerTurn,
  });

  if (ids.length === 0) {
    console.warn("[ENERGY][DBG] No power networks were built. Likely causes:");
    console.warn(" - buildings not found by getAllBuildings(scene)");
    console.warn(" - buildings have no q/r (getBuildingCoords fails)");
    console.warn(' - building.type mismatch (expected: "solar_panel", "battery", "fuel_generator", "power_pole", "power_conduit")');
    console.groupEnd();
    return;
  }

  for (const id of ids) {
    const net = nets[id];
    if (!net) continue;

    const stored = Math.floor(net.storedEnergy || 0);
    const cap = Math.floor(net.storageCapacity || 0);
    const lastProd = Math.floor(net.lastProduced || 0);
    const lastDem = Math.floor(net.lastDemand || 0);

    console.groupCollapsed(
      `[ENERGY][DBG] Network #${id} | stored ${stored}/${cap} | last +${lastProd} | last demand -${lastDem} | nodes=${net.nodes?.length || 0}`
    );

    if (Array.isArray(net.nodes)) {
      const nodeSummary = net.nodes.map((n) => ({
        q: n.q,
        r: n.r,
        conduit: !!n.hasConduit,
        pole: !!n.hasPole,
        buildings: n.buildings ? n.buildings.size : 0,
        neighbors: n.neighbors ? n.neighbors.size : 0,
      }));
      console.table(nodeSummary);

      if (opts.verboseNodes) {
        for (const n of net.nodes) {
          console.log(`[ENERGY][DBG] node ${n.q},${n.r}`, {
            hasConduit: !!n.hasConduit,
            hasPole: !!n.hasPole,
            neighborKeys: Array.from(n.neighbors || []),
          });
        }
      }
    }

    const allB = [];
    for (const n of net.nodes || []) {
      for (const b of n.buildings || []) {
        if (!b) continue;
        const pos = getBuildingCoords(b);
        allB.push({
          id: safeId(b),
          type: safeType(b),
          q: pos?.q,
          r: pos?.r,
          powerNetworkId: b.powerNetworkId,
          powerOnline: b.powerOnline,
          powerOfflineReason: b.powerOfflineReason,
          energy: getBuildingEnergySummary(b),
        });
      }
    }

    const seen = new Set();
    const uniq = [];
    for (const row of allB) {
      const k = `${row.id}:${row.type}:${row.q},${row.r}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(row);
    }

    if (uniq.length === 0) {
      const fallback = [];
      (net.producers || []).forEach((b) => {
        const pos = getBuildingCoords(b);
        fallback.push({
          id: safeId(b),
          type: safeType(b),
          q: pos?.q,
          r: pos?.r,
          role: "producer",
          energy: getBuildingEnergySummary(b),
        });
      });
      (net.storage || []).forEach((b) => {
        const pos = getBuildingCoords(b);
        fallback.push({
          id: safeId(b),
          type: safeType(b),
          q: pos?.q,
          r: pos?.r,
          role: "storage",
          energy: getBuildingEnergySummary(b),
        });
      });
      (net.consumers || []).forEach((b) => {
        const pos = getBuildingCoords(b);
        fallback.push({
          id: safeId(b),
          type: safeType(b),
          q: pos?.q,
          r: pos?.r,
          role: "consumer",
          energy: getBuildingEnergySummary(b),
        });
      });

      console.warn("[ENERGY][DBG] No buildings found on nodes; showing fallback role lists.");
      console.table(fallback);
    } else {
      console.table(uniq);
    }

    console.log("[ENERGY][DBG] roles:", {
      producers: (net.producers || []).length,
      consumers: (net.consumers || []).length,
      storage: (net.storage || []).length,
      storageCapacity: net.storageCapacity || 0,
    });

    console.groupEnd();
  }

  console.groupEnd();
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
  // high-level helpers
  initElectricityForScene,
  applyElectricityOnEndTurn,
  startEnergyBuildingPlacement,
  // global stats (для UI)
  recomputeGlobalEnergyStats,
  // debug
  debugElectricity,
};
