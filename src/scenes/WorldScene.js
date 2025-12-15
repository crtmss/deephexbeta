// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';
import { setupWorldMenus, attachSelectionHighlight } from './WorldSceneMenus.js';
import { startHexTransformTool } from './HexTransformTool.js';
import { setupBuildingsUI } from './WorldSceneBuildingsUI.js';
import { setupEnergyPanel } from './WorldSceneEnergyUI.js';
import { setupHexInfoPanel } from './WorldSceneHexInfo.js';

// Haulers / ships
import {
  applyShipRoutesOnEndTurn,
  applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn,
} from './WorldSceneHaulers.js';

// Logistics (buildings + routes)
import {
  setupLogisticsPanel,
  applyLogisticsOnEndTurn,
} from './WorldSceneLogistics.js';
import { applyLogisticsRoutesOnEndTurn } from './WorldSceneLogisticsRuntime.js';

// UI (HUD, tabs, input)
import { setupTurnUI, updateTurnText, setupWorldInputUI } from './WorldSceneUI.js';

// Units / resources / map
import { spawnUnitsAndEnemies, updateUnitOrientation } from './WorldSceneUnits.js';
import { spawnFishResources, spawnCrudeOilResources } from './WorldSceneResources.js';
import {
  drawHexMap,
  hexToPixel,
  pixelToHex,
  roundHex,
  getColorForTerrain,
  isoOffset,
  LIFT_PER_LVL,
} from './WorldSceneMap.js';

// NEW: elevation helper used by the map renderer (must match visuals)
import { effectiveElevationLocal } from './WorldSceneGeography.js';

// Debug menu (hydrology controls)
import { initDebugMenu } from './WorldSceneDebug.js';

// NEW: History panel UI
import { setupHistoryUI } from './WorldSceneHistory.js';

// NEW: Electricity system (power management)
import ElectricitySystem, {
  initElectricityForScene,
  applyElectricityOnEndTurn,
} from './WorldSceneElectricity.js';

// Combat runtime is applied on the main map (no separate CombatScene).
import { applyCombatEvent } from './WorldSceneCombatRuntime.js';
import { resolveAttack, validateAttack } from '../units/CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from '../units/UnitState.js';

import { supabase as sharedSupabase } from '../net/SupabaseClient.js';

/* =========================
   Deterministic world summary (UI-only)
   ========================= */

function __hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function __xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}
function getWorldSummaryForSeed(seedStr, width, height) {
  const seed = __hashStr32(seedStr);
  const rng = __xorshift32(seed);

  const totalTiles = width * height;
  const waterRatio    = 0.28 + (rng() - 0.5) * 0.08;
  const forestRatio   = 0.25 + (rng() - 0.5) * 0.10;
  const mountainRatio = 0.10 + (rng() - 0.5) * 0.05;

  const roughness    = 0.4 + rng() * 0.4;
  const elevationVar = 0.6 + rng() * 0.4;

  const geography = {
    waterTiles:    Math.round(totalTiles * waterRatio),
    forestTiles:   Math.round(totalTiles * forestRatio),
    mountainTiles: Math.round(totalTiles * mountainRatio),
    roughness:     +roughness.toFixed(2),
    elevationVar:  +elevationVar.toFixed(2),
  };

  const biomes = [];
  if (waterRatio > 0.3)        biomes.push('Archipelago');
  else if (waterRatio < 0.22)  biomes.push('Continental');

  if (forestRatio > 0.28)      biomes.push('Dense Forests');
  else if (forestRatio < 0.20) biomes.push('Sparse Forests');

  if (mountainRatio > 0.12) biomes.push('Mountainous');
  if (roughness > 0.6)      biomes.push('Rugged Terrain');
  if (elevationVar > 0.7)   biomes.push('High Elevation Contrast');

  const biome = biomes.length > 0 ? biomes.join(', ') : 'Mixed Terrain';
  return { geography, biome };
}

/* =========================
   Small axial helpers
   ========================= */
function getTile(scene, q, r) {
  return (scene.mapData || []).find(h => h.q === q && h.r === r);
}

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {}

  async create() {
    // >>> keep 29x29 and hexSize from your previous version <<<
    this.hexSize = 22;
    this.mapWidth = 29;
    this.mapHeight = 29;

    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.isUnitMoving = false;

    // Make elevation lift constant visible to map-location renderer
    this.LIFT_PER_LVL = LIFT_PER_LVL;

    // Hex transform tool (X key edits terrain and then calls scene.redrawWorld())
    startHexTransformTool(this, { defaultType: 'water', defaultLevel: 1 });

    // collections
    this.units = [];
    this.enemies = [];
    this.players = [];
    this.buildings = [];
    this.haulers = [];
    this.ships = [];
    this.resources = [];

    // NEW: history entries list for the History panel
    // Each entry: { year, text, type, q, r }
    this.historyEntries = [];

    // selection state
    this.selectedUnit = null;
    this.selectedHex = null;
    this.pathPreviewTiles = [];
    this.pathPreviewLabels = [];

    this.uiLocked = false;

    const {
      seed,
      playerName,
      roomCode,
      isHost,
      supabase,
      lobbyState,
    } = this.scene.settings.data || {};

    this.seed = seed || '000000';
    this.playerName = playerName || 'Player';
    this.roomCode = roomCode || this.seed;
    this.isHost = !!isHost;

    // Prefer instance passed via scene.start, fallback to global shared supabase
    this.supabase = supabase || sharedSupabase || null;
    this.lobbyState = lobbyState || { units: {}, enemies: [] };

    this.turnOwner = null;
    this.turnNumber = 1;

    // Initial resources (kept in sync with Buildings / Haulers modules)
    this.playerResources = {
      food: 200,
      scrap: 200,
      money: 200,
      influence: 200,
    };

    // Global water level (1..7; tiles with baseElevation <= level are flooded)
    this.worldWaterLevel = 3;
    // keep simple alias used by other parts of the code (e.g. map renderer)
    this.waterLevel      = this.worldWaterLevel || 3;

    /* =========================
       Deterministic map generation
       ========================= */
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);

    // HexMap.generateMap() returns either tiles[] or { tiles, objects }
    let mapInfo = this.hexMap.generateMap && this.hexMap.generateMap();

    if (Array.isArray(mapInfo)) {
      mapInfo = {
        tiles: mapInfo,
        objects: this.hexMap.objects || [],
      };
    } else if (!mapInfo || !Array.isArray(mapInfo.tiles)) {
      const tiles = this.hexMap.getMap ? this.hexMap.getMap() : (this.hexMap.map || []);
      mapInfo = {
        tiles,
        objects: this.hexMap.objects || [],
      };
    } else if (!Array.isArray(mapInfo.objects)) {
      mapInfo.objects = this.hexMap.objects || [];
    }

    // Store mapInfo so other systems (roads, POIs, resources) see the same data
    this.mapInfo = mapInfo;
    this.hexMap.mapInfo = mapInfo;
    this.mapData = mapInfo.tiles;

    // =========================
    // Electricity system: attach module and init networks
    // =========================
    this.electricitySystem = ElectricitySystem || null;
    // create a small namespace for flags if not present
    if (!this.electricity) {
      this.electricity = {};
    }
    try {
      if (typeof initElectricityForScene === 'function') {
        initElectricityForScene(this);
      } else if (
        this.electricitySystem &&
        typeof this.electricitySystem.initElectricityForScene === 'function'
      ) {
        this.electricitySystem.initElectricityForScene(this);
      } else if (
        this.electricitySystem &&
        typeof this.electricitySystem.initElectricity === 'function'
      ) {
        // very old fallback
        this.electricitySystem.initElectricity(this);
        this.electricity.initialized = true;
      } else {
        console.warn('[ENERGY] WorldSceneElectricity.initElectricityForScene not found');
      }
    } catch (err) {
      console.error('[ENERGY] Error during electricity init:', err);
    }

    // expose helpers; offset handling is centralized in axialToWorld/worldToAxial
    this.hexToPixel = (q, r, sizeOverride) =>
      hexToPixel(q, r, sizeOverride ?? this.hexSize);
    this.pixelToHex = (x, y, sizeOverride) =>
      pixelToHex(x, y, sizeOverride ?? this.hexSize);

    // =========================
    // Apply initial water level → sets tile.type from baseElevation/groundType
    // and draws terrain + POIs + roads + resources once.
    // =========================
    this.recomputeWaterFromLevel();

    /* =========================
       UNITS & ENEMIES SPAWN (multiplayer-aware)
       ========================= */
    await spawnUnitsAndEnemies.call(this);

    this.players = this.players && this.players.length
      ? this.players
      : this.units.filter(u => u.isPlayer);
    this.enemies = this.enemies && this.enemies.length
      ? this.enemies
      : this.units.filter(u => u.isEnemy);

    this.turnOwner =
      this.players[0]?.playerName ||
      this.players[0]?.name ||
      null;

    /* =========================
       UI: menus, buildings, logistics, HUD
       ========================= */
    attachSelectionHighlight(this);
    setupWorldMenus(this);
    setupBuildingsUI(this);
    setupTurnUI(this);
    setupLogisticsPanel(this);
    setupEnergyPanel(this);
    setupHexInfoPanel(this);

    // NEW: History UI (panel to the left of resources panel)
    setupHistoryUI(this);

    if (this.turnOwner) {
      updateTurnText(this, this.turnOwner);
    }

    this.addWorldMetaBadge();

    // Input (selection + path preview + movement)
    setupWorldInputUI(this);

    // ---- Debug menu (top-center hydrology controls) ----
    initDebugMenu(this);

    // After everything exists: ensure icons are snapped to correct lifted positions
    this.refreshAllIconWorldPositions();

    // Expose combat event applier on scene (used by AI + net bridge)
    this.applyCombatEvent = (ev) => applyCombatEvent(this, ev);

    /* =========================
       Supabase sync bridge stub
       ========================= */
    if (this.supabase && this.roomCode && this.playerName) {
      this.syncPlayerMove = async unit => {
        try {
          const res = await this.supabase
            .from('lobbies')
            .select('state')
            .eq('room_code', this.roomCode)
            .single();

          if (!res.data || !res.data.state || !Array.isArray(res.data.state.players)) return;

          const state = res.data.state;
          const nextPlayer = this.getNextPlayer(state.players, this.playerName);

          await this.supabase
            .from('lobbies')
            .update({
              state: {
                ...state,
                players: state.players.map(p =>
                  p === this.playerName || p?.name === this.playerName
                    ? { ...(typeof p === 'string' ? { name: p } : p), q: unit.q, r: unit.r }
                    : p
                ),
                currentTurn: nextPlayer,
              },
            })
            .eq('room_code', this.roomCode);
        } catch (err) {
          console.error('[Supabase syncPlayerMove] Error:', err);
        }
      };
    }

    this.printTurnSummary?.();
  }

  getNextPlayer(players, currentName) {
    if (!players || players.length === 0) return null;

    const norm = players.map(p => (typeof p === 'string' ? { name: p } : p));
    const idx = norm.findIndex(p => p.name === currentName);

    if (idx === -1) return norm[0].name;
    return norm[(idx + 1) % norm.length].name;
  }

  addWorldMetaBadge() {
    const { geography, biome } = getWorldSummaryForSeed(
      String(this.seed),
      this.mapWidth,
      this.mapHeight
    );

    const text = `Seed: ${this.seed}
Water: ~${geography.waterTiles}
Forest: ~${geography.forestTiles}
Mountains: ~${geography.mountainTiles}
Roughness: ${geography.roughness}
Elev.Var: ${geography.elevationVar}
Biomes: ${biome}`;

    const pad = { x: 8, y: 6 };

    const x = 320;
    const y = 16;

    const tempText = this.add.text(0, 0, text, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#d0f2ff',
    }).setVisible(false);

    const bounds = tempText.getBounds();
    tempText.destroy();

    const bgWidth = bounds.width + pad.x * 2;
    const bgHeight = bounds.height + pad.y * 2;

    const graphics = this.add.graphics();
    graphics.fillStyle(0x050f1a, 0.85);
    graphics.fillRoundedRect(x, y, bgWidth, bgHeight, 8);
    graphics.lineStyle(1, 0x34d2ff, 0.9);
    graphics.strokeRoundedRect(x, y, bgWidth, bgHeight, 8);
    graphics.setDepth(100);

    const label = this.add.text(
      x + pad.x,
      y + pad.y,
      text,
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d0f2ff',
      }
    );
    label.setDepth(101);
  }

  /**
   * Axial -> world position, WITH elevation lift (must match map renderer).
   */
  axialToWorld(q, r) {
    const size = this.hexSize;
    const base = hexToPixel(q, r, size);

    const ox = this.mapOffsetX || 0;
    const oy = this.mapOffsetY || 0;

    const tile = getTile(this, q, r);
    const liftLvl = (typeof this.LIFT_PER_LVL === 'number') ? this.LIFT_PER_LVL : 4;
    const elev = tile ? effectiveElevationLocal(tile) : 0;

    return { x: base.x + ox, y: (base.y + oy) - liftLvl * elev };
  }

  /**
   * World -> axial, WITH elevation compensation.
   * We do a small iterative refinement: guess hex, read its elevation, re-project.
   */
  worldToAxial(x, y) {
    const size = this.hexSize;
    const ox = this.mapOffsetX || 0;
    const oy = this.mapOffsetY || 0;
    const liftLvl = (typeof this.LIFT_PER_LVL === 'number') ? this.LIFT_PER_LVL : 4;

    // initial guess ignoring elevation
    let px = x - ox;
    let py = y - oy;

    let { q, r } = pixelToHex(px, py, size);
    let rounded = roundHex(q, r);

    // refine 2 iterations (enough for stable pick)
    for (let i = 0; i < 2; i++) {
      const t = getTile(this, rounded.q, rounded.r);
      const elev = t ? effectiveElevationLocal(t) : 0;
      const py2 = (y - oy) + liftLvl * elev;
      const hr = pixelToHex(px, py2, size);
      rounded = roundHex(hr.q, hr.r);
    }

    return rounded;
  }

  /**
   * Re-snap ALL in-world icons/containers to correct elevated positions.
   * Call after water level changes (because effectiveElevationLocal changes).
   */
  refreshAllIconWorldPositions() {
    const scene = this;

    const snapObj = (obj) => {
      if (!obj || typeof obj.q !== 'number' || typeof obj.r !== 'number') return;
      const { x, y } = scene.axialToWorld(obj.q, obj.r);
      if (typeof obj.setPosition === 'function') obj.setPosition(x, y);
      else { obj.x = x; obj.y = y; }
    };

    // Units / enemies / haulers / ships (Phaser GameObjects)
    (this.units || []).forEach(snapObj);
    (this.players || []).forEach(snapObj);
    (this.enemies || []).forEach(snapObj);
    (this.haulers || []).forEach(snapObj);
    (this.ships || []).forEach(snapObj);

    // Buildings: containers + extra labels anchored in world space
    (this.buildings || []).forEach(b => {
      if (!b) return;

      // main visual container
      if (b.container) {
        const { x, y } = scene.axialToWorld(b.q, b.r);
        b.container.setPosition(x, y);

        // mine scrap label (stored as world text)
        if (b.storageScrapLabel) {
          b.storageScrapLabel.setPosition(x + 16, y - 14);
        }
      }

      // some systems store extra world objects
      if (b.storageObj) snapObj(b.storageObj);
      if (b.routeMarker) snapObj(b.routeMarker);

      // docks: menu/overlay are screen-space or relative; ignore
      if (b.menu) {
        // menu container is world-space anchored near docks
        const { x, y } = scene.axialToWorld(b.q, b.r);
        b.menu.setPosition(x, y - 56);
      }
    });

    // Resources: if you store q/r on them (fish/oil)
    (this.resources || []).forEach(snapObj);

    // Path preview should be cleared (otherwise it will float)
    this.clearPathPreview?.();
  }

  debugHex(q, r) {
    const tile = getTile(this, q, r);
    if (!tile) {
      console.log(`Clicked outside map at (${q},${r})`);
      return;
    }
    console.log(
      `Hex (${q},${r}) type=${tile.type}, elev=${tile.elevation}, baseElev=${tile.baseElevation}, groundType=${tile.groundType}, isUnderWater=${tile.isUnderWater}, visualElevation=${tile.visualElevation}`
    );
  }

  clearPathPreview() {
    if (this.pathPreviewTiles) {
      this.pathPreviewTiles.forEach(g => g.destroy());
      this.pathPreviewTiles = [];
    }
    if (this.pathPreviewLabels) {
      this.pathPreviewLabels.forEach(l => l.destroy());
      this.pathPreviewLabels = [];
    }
  }

  startStepMovement(unit, path, onComplete) {
    if (!path || path.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    this.isUnitMoving = true;
    const scene = this;
    let index = 1;

    function stepNext() {
      if (index >= path.length) {
        const last = path[path.length - 1];
        unit.q = last.q;
        unit.r = last.r;
        scene.isUnitMoving = false;
        scene.updateSelectionHighlight?.();
        if (onComplete) onComplete();
        return;
      }

      const step = path[index];
      const { x, y } = scene.axialToWorld(step.q, step.r);

      scene.tweens.add({
        targets: unit,
        x,
        y,
        duration: 160,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          const prevQ = unit.q;
          const prevR = unit.r;

          unit.q = step.q;
          unit.r = step.r;

          updateUnitOrientation(scene, unit, prevQ, prevR, unit.q, unit.r);

          index += 1;
          stepNext();
        }
      });
    }

    stepNext();
  }

  endTurn() {
    if (this.uiLocked) return;
    this.uiLocked = true;

    console.log(`[TURN] Ending turn for ${this.turnOwner} (Turn ${this.turnNumber})`);

    applyShipRoutesOnEndTurn(this);
    applyHaulerRoutesOnEndTurn(this);
    applyLogisticsOnEndTurn(this);
    applyLogisticsRoutesOnEndTurn(this);

    // NEW: per-turn electricity simulation
    try {
      if (typeof applyElectricityOnEndTurn === 'function') {
        applyElectricityOnEndTurn(this);
      } else if (
        this.electricitySystem &&
        typeof this.electricitySystem.applyElectricityOnEndTurn === 'function'
      ) {
        this.electricitySystem.applyElectricityOnEndTurn(this);
      } else if (
        this.electricitySystem &&
        typeof this.electricitySystem.tickElectricity === 'function'
      ) {
        this.electricitySystem.tickElectricity(this);
      }
    } catch (err) {
      console.error('[ENERGY] Error during end-turn electricity tick:', err);
    }

    // Reset points BEFORE AI acts, so AI isn't "stuck" and doesn't look random.
    resetUnitsForNewTurn(this);

    if (this.isHost) {
      this.moveEnemies();
    }

    const idx = this.players.findIndex(p =>
      p.playerName === this.turnOwner ||
      p.name === this.turnOwner
    );

    const nextIdx = idx === -1
      ? 0
      : (idx + 1) % this.players.length;

    const nextOwner =
      this.players[nextIdx].playerName ||
      this.players[nextIdx].name;

    this.turnOwner = nextOwner;
    this.turnNumber += 1;

    console.log(`[TURN] New turn owner: ${this.turnOwner} (Turn ${this.turnNumber})`);

    updateTurnText(this, this.turnOwner);
    this.printTurnSummary?.();

    // Ensure unit panel refreshes each turn
    this.refreshUnitActionPanel?.();

    this.uiLocked = false;
  }

  /**
   * Enemy AI (host): NOT RANDOM.
   * - If any player unit in weapon range and has AP -> attack.
   * - Else if has MP -> A* chase the nearest player unit.
   */
  moveEnemies() {
    const scene = this;
    if (!scene.enemies || scene.enemies.length === 0) return;

    const getUnitAt = (q, r) => {
      const all = []
        .concat(scene.units || [])
        .concat(scene.players || [])
        .concat(scene.enemies || [])
        .concat(scene.haulers || []);
      return all.find(u => u && !u.isDead && u.q === q && u.r === r) || null;
    };

    const isBlocked = (tile, mover) => {
      if (!tile) return true;
      if (tile.type === 'water' || tile.type === 'mountain') return true;
      const occ = getUnitAt(tile.q, tile.r);
      if (occ && occ !== mover) return true; // no stacking
      return false;
    };

    const hexDistance = (q1, r1, q2, r2) => {
      const dq = q2 - q1;
      const dr = r2 - r1;
      const ds = -dq - dr;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
    };

    const playerTargets =
      (scene.units || []).filter(u => u && u.isPlayer && !u.isDead).length
        ? (scene.units || []).filter(u => u && u.isPlayer && !u.isDead)
        : (scene.players || []).filter(u => u && u.isPlayer && !u.isDead);

    if (playerTargets.length === 0) return;

    for (const enemy of scene.enemies) {
      if (!enemy || enemy.isDead) continue;
      if (enemy.controller !== 'ai' && !enemy.isEnemy) continue;

      ensureUnitCombatFields(enemy);

      // Pick nearest target
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of playerTargets) {
        const d = hexDistance(enemy.q, enemy.r, p.q, p.r);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }
      if (!nearest) continue;

      // --- 1) attack if possible ---
      const weapons = enemy.weapons || [];
      const weaponId = weapons[enemy.activeWeaponIndex] || weapons[0] || null;
      if (weaponId && enemy.ap > 0) {
        const v = validateAttack(enemy, nearest, weaponId);
        if (v.ok) {
          // Spend AP + also 1 MP if any left (your rule)
          spendAp(enemy, 1);
          if ((enemy.mp || 0) > 0) enemy.mp = Math.max(0, enemy.mp - 1);
          if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = enemy.mp;

          ensureUnitCombatFields(nearest);
          const r = resolveAttack(enemy, nearest, weaponId);

          const attackerId = String(enemy.id ?? enemy.unitId ?? enemy.uuid ?? enemy.netId ?? `${enemy.unitName || enemy.name}@${enemy.q},${enemy.r}`);
          const defenderId = String(nearest.id ?? nearest.unitId ?? nearest.uuid ?? nearest.netId ?? `${nearest.unitName || nearest.name}@${nearest.q},${nearest.r}`);

          const event = {
            type: 'combat:attack',
            attackerId,
            defenderId,
            weaponId,
            damage: r.finalDamage,
            distance: r.distance,
            turnNumber: scene.turnNumber,
            timestamp: Date.now(),
          };

          scene.applyCombatEvent?.(event);
          continue;
        }
      }

      // --- 2) move towards target using A* ---
      if ((enemy.mp || 0) <= 0) continue;

      const path = computePathWithAStar(enemy, { q: nearest.q, r: nearest.r }, scene.mapData, (t) => isBlocked(t, enemy));
      if (!path || path.length < 2) continue;

      let mp = enemy.mp || 0;
      let lastStep = null;

      for (let i = 1; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;
        if (cost > mp) break;

        // Don't move onto occupied hex
        const occ = getUnitAt(step.q, step.r);
        if (occ && occ !== enemy) break;

        mp -= cost;
        lastStep = step;

        // Stop when adjacent (so can attack next time)
        const d2 = hexDistance(step.q, step.r, nearest.q, nearest.r);
        if (d2 <= 1) break;
      }

      if (lastStep) {
        enemy.mp = mp;
        if (Number.isFinite(enemy.movementPoints)) enemy.movementPoints = mp;
        const { x, y } = scene.axialToWorld(lastStep.q, lastStep.r);
        try { enemy.setPosition?.(x, y); } catch (e) { enemy.x = x; enemy.y = y; }
        enemy.q = lastStep.q;
        enemy.r = lastStep.r;
      }
    }

    scene.refreshUnitActionPanel?.();
  }

  recomputeWaterFromLevel() {
    if (!Array.isArray(this.mapData)) return;

    const lvlRaw = (typeof this.worldWaterLevel === 'number')
      ? this.worldWaterLevel
      : 3;
    const lvl = Math.max(0, Math.min(7, lvlRaw));
    this.worldWaterLevel = lvl;
    this.waterLevel      = lvl;   // keep in sync

    for (const t of this.mapData) {
      if (!t) continue;

      let base = (typeof t.baseElevation === 'number')
        ? t.baseElevation
        : (typeof t.elevation === 'number' ? t.elevation : 0);
      if (base <= 0) base = 1;
      t.baseElevation = base;
      t.elevation = base;

      if (!t.groundType) {
        if (t.type && t.type !== 'water') {
          t.groundType = t.type;
        } else {
          t.groundType = 'grassland';
        }
      }

      const under = (lvl > 0) && (base <= lvl);

      if (under) {
        t.type = 'water';
        t.isUnderWater = true;
        t.isWater = true;
        t.isCoveredByWater = true;

        let depth = base;
        if (depth < 1) depth = 1;
        if (depth > 3) depth = 3;
        t.waterDepth = depth;

        t.visualElevation = 0;
      } else {
        t.type = t.groundType || 'grassland';
        t.isUnderWater = false;
        t.isWater = false;
        t.isCoveredByWater = false;
        t.waterDepth = 0;

        const eff = base - lvl;
        t.visualElevation = eff > 0 ? eff : 0;
      }
    }

    this.redrawWorld();

    // ✅ IMPORTANT: после смены воды пересадить все иконки/контейнеры на новую высоту
    this.refreshAllIconWorldPositions();
  }

  redrawWorld() {
    drawHexMap.call(this);
    drawLocationsAndRoads.call(this);
    spawnFishResources.call(this);
    spawnCrudeOilResources.call(this);
  }
}

/* =========================================================
   Helpers defined outside the class
   ========================================================= */

function computePathWithAStar(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) {
    return [start];
  }

  const isBlocked = tile => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  return aStarFindPath(start, goal, mapData, isBlocked);
}

function resetUnitsForNewTurn(scene) {
  const owner = scene.turnOwner || null;
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || []);

  for (const u of all) {
    if (!u || u.isDead) continue;
    ensureUnitCombatFields(u);

    const uOwner = u.playerName || u.name || null;

    if (u.isEnemy || u.controller === 'ai') {
      // AI/enemy always refreshes on its own “turn slice”
      u.mp = u.mpMax;
      u.ap = u.apMax;
      u.tempArmorBonus = 0;
      if (u.status) {
        u.status.defending = false;
        u.status.attackedThisTurn = false;
      }
      if (Number.isFinite(u.movementPoints)) u.movementPoints = u.mp;
      continue;
    }

    // Player units refresh only when it's their owner's turn
    if (owner && uOwner === owner) {
      u.mp = u.mpMax;
      u.ap = u.apMax;
      u.tempArmorBonus = 0;
      if (u.status) {
        u.status.defending = false;
        u.status.attackedThisTurn = false;
      }
      if (Number.isFinite(u.movementPoints)) u.movementPoints = u.mp;
    }
  }

  // If unit panel is open, force refresh (HP/MP/AP can change at turn switch)
  scene.refreshUnitActionPanel?.();
}

WorldScene.prototype.setSelectedUnit = function (unit) {
  this.selectedUnit = unit;
  this.updateSelectionHighlight?.();

  if (unit) {
    // Stage C: always show the bottom-center unit panel (players + enemies)
    this.openUnitActionPanel?.(unit);

    // Keep legacy mobile-base radial menu for production/build actions
    // (do not show it for enemies).
    if (!(unit.isEnemy || unit.controller === 'ai')) {
      this.openRootUnitMenu?.(unit);
    }
  } else {
    this.closeUnitActionPanel?.();
    this.closeAllMenus?.();
  }
};

WorldScene.prototype.toggleSelectedUnitAtHex = function (q, r) {
  if (this.selectedUnit && this.selectedUnit.q === q && this.selectedUnit.r === r) {
    this.setSelectedUnit(null);
    return;
  }

  // ✅ include enemies so clicking them opens info panel
  const unit =
    (this.units || []).find(u => u.q === q && u.r === r) ||
    (this.players || []).find(u => u.q === q && u.r === r) ||
    (this.enemies || []).find(u => u.q === q && u.r === r) ||
    (this.haulers || []).find(h => h.q === q && h.r === r) ||
    null;

  this.setSelectedUnit(unit || null);
};

WorldScene.prototype.printTurnSummary = function () {
  console.log(`[WORLD] Turn ${this.turnNumber} – Current player: ${this.turnOwner}`);
};

// NEW: add a history entry (ruins, etc.) and keep chronological order
WorldScene.prototype.addHistoryEntry = function (entry) {
  if (!this.historyEntries) this.historyEntries = [];
  this.historyEntries.push(entry);
  this.historyEntries.sort((a, b) => a.year - b.year);
  // If the History panel is open, let it refresh itself
  this.refreshHistoryPanel?.();
};

// NEW: simple year progression helper, starting at 5000
WorldScene.prototype.getNextHistoryYear = function () {
  const baseYear = 5000;
  if (!this.historyEntries || this.historyEntries.length === 0) {
    return baseYear;
  }
  const last = this.historyEntries[this.historyEntries.length - 1];
  return (typeof last.year === 'number' ? last.year : baseYear) + 3;
};
