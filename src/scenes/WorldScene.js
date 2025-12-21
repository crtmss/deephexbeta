// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';

import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';
import { setupWorldMenus, attachSelectionHighlight } from './WorldSceneMenus.js';
import { setupUnitActionPanel } from './WorldSceneUnitPanel.js';
import { startHexTransformTool } from './HexTransformTool.js';
import { setupBuildingsUI } from './WorldSceneBuildingsUI.js';
import { setupEnergyPanel } from './WorldSceneEnergyUI.js';
import { setupHexInfoPanel } from './WorldSceneHexInfo.js';

import { setupLogisticsPanel } from './WorldSceneLogistics.js';

// UI (HUD, tabs, input)
import { setupTurnUI, updateTurnText, setupWorldInputUI } from './WorldSceneUI.js';

// Units / resources / map
import { spawnUnitsAndEnemies, updateUnitOrientation } from './WorldSceneUnits.js';
import { spawnFishResources, spawnCrudeOilResources } from './WorldSceneResources.js';
import { drawHexMap, hexToPixel, pixelToHex, LIFT_PER_LVL } from './WorldSceneMap.js';

// Debug menu
import { initDebugMenu } from './WorldSceneDebug.js';

// History UI
import { setupHistoryUI } from './WorldSceneHistory.js';

// Electricity
import ElectricitySystem, { initElectricityForScene } from './WorldSceneElectricity.js';

// Combat runtime on main map
import { applyCombatEvent } from './WorldSceneCombatRuntime.js';

import { supabase as sharedSupabase } from '../net/SupabaseClient.js';

// merged world meta + coords + turn
import {
  getWorldSummaryForSeed,
  axialToWorld,
  worldToAxial,
  refreshAllIconWorldPositions,
  endTurn as endTurnImpl,
  getNextPlayer as getNextPlayerImpl,
} from './WorldSceneWorldMeta.js';

// AI moved to units folder
import { moveEnemies as moveEnemiesImpl } from '../units/WorldSceneAI.js';

/* ---------------------------
   Auto-move helpers (Civ-style)
   --------------------------- */

function getTile(scene, q, r) {
  return (scene.mapData || []).find(h => h.q === q && h.r === r);
}

function getUnitAtHex(scene, q, r) {
  const units = scene.units || [];
  const players = scene.players || [];
  const enemies = scene.enemies || [];
  const haulers = scene.haulers || [];
  return (
    units.find(u => u && u.q === q && u.r === r) ||
    players.find(u => u && u.q === q && u.r === r) ||
    enemies.find(e => e && e.q === q && e.r === r) ||
    haulers.find(h => h && h.q === q && h.r === r) ||
    null
  );
}

function tileElevation(t) {
  if (!t) return 0;
  if (Number.isFinite(t.visualElevation)) return t.visualElevation;
  if (Number.isFinite(t.elevation)) return t.elevation;
  if (Number.isFinite(t.baseElevation)) return t.baseElevation;
  return 0;
}

// Must match WorldSceneUI.js rules
function stepMoveCost(fromTile, toTile) {
  if (!fromTile || !toTile) return Infinity;

  const e0 = tileElevation(fromTile);
  const e1 = tileElevation(toTile);

  if (Math.abs(e1 - e0) > 1) return Infinity;

  let cost = 1;
  if (toTile.hasForest) cost += 1;
  if (e1 > e0) cost += 1;
  return cost;
}

function getMP(unit) {
  const mpA = Number.isFinite(unit.movementPoints) ? unit.movementPoints : null;
  const mpB = Number.isFinite(unit.mp) ? unit.mp : null;
  return (mpB != null) ? mpB : (mpA != null ? mpA : 0);
}

function setMP(unit, val) {
  const v = Math.max(0, Number.isFinite(val) ? val : 0);
  unit.mp = v;
  if (Number.isFinite(unit.movementPoints)) unit.movementPoints = v;
}

function computePath(scene, unit, target, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: target.q, r: target.r };
  if (start.q === goal.q && start.r === goal.r) return [start];

  const isBlocked = (tile) => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  // If AStar ignores options, OK — we still validate cost in split.
  return aStarFindPath(start, goal, scene.mapData, isBlocked, { getMoveCost: stepMoveCost });
}

/**
 * Validates the full path (stops at first illegal/blocked/occupied step) and
 * returns a segment that fits in current MP.
 */
function buildMoveSegmentForThisTurn(scene, unit, fullPath, blockedPred) {
  const mp = getMP(unit);
  if (!Array.isArray(fullPath) || fullPath.length < 2) {
    return { segment: [], costSum: 0 };
  }

  const usable = [fullPath[0]];
  let sum = 0;

  for (let i = 1; i < fullPath.length; i++) {
    const prev = usable[usable.length - 1];
    const cur = fullPath[i];

    const prevTile = getTile(scene, prev.q, prev.r);
    const curTile = getTile(scene, cur.q, cur.r);

    if (blockedPred && blockedPred(curTile)) break;

    const stepCost = stepMoveCost(prevTile, curTile);
    if (!Number.isFinite(stepCost) || stepCost === Infinity) break;

    const occ = getUnitAtHex(scene, cur.q, cur.r);
    if (occ && occ !== unit) break;

    if (sum + stepCost > mp) break;

    sum += stepCost;
    usable.push(cur);
  }

  if (usable.length < 2) return { segment: [], costSum: 0 };
  return { segment: usable, costSum: sum };
}

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {}

  async create() {
    this.hexSize = 22;
    this.mapWidth = 29;
    this.mapHeight = 29;

    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.isUnitMoving = false;

    this.LIFT_PER_LVL = LIFT_PER_LVL;

    startHexTransformTool(this, { defaultType: 'water', defaultLevel: 1 });

    this.units = [];
    this.enemies = [];
    this.players = [];
    this.buildings = [];
    this.haulers = [];
    this.ships = [];
    this.resources = [];

    this.historyEntries = [];

    this.selectedUnit = null;
    this.selectedHex = null;
    this.pathPreviewTiles = [];
    this.pathPreviewLabels = [];

    this.uiLocked = false;

    const { seed, playerName, roomCode, isHost, supabase, lobbyState } =
      this.scene.settings.data || {};

    this.seed = seed || '000000';
    this.playerName = playerName || 'Player';
    this.roomCode = roomCode || this.seed;

    // local/dev: if not provided, act as host so AI runs.
    this.isHost = (typeof isHost === 'undefined') ? true : !!isHost;

    this.supabase = supabase || sharedSupabase || null;
    this.lobbyState = lobbyState || { units: {}, enemies: [] };

    this.turnOwner = null;
    this.turnNumber = 1;

    this.playerResources = { food: 200, scrap: 200, money: 200, influence: 200 };

    this.worldWaterLevel = 3;
    this.waterLevel = this.worldWaterLevel || 3;

    // Map generation
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);

    let mapInfo = this.hexMap.generateMap && this.hexMap.generateMap();
    if (Array.isArray(mapInfo)) {
      mapInfo = { tiles: mapInfo, objects: this.hexMap.objects || [] };
    } else if (!mapInfo || !Array.isArray(mapInfo.tiles)) {
      const tiles = this.hexMap.getMap ? this.hexMap.getMap() : (this.hexMap.map || []);
      mapInfo = { tiles, objects: this.hexMap.objects || [] };
    } else if (!Array.isArray(mapInfo.objects)) {
      mapInfo.objects = this.hexMap.objects || [];
    }

    this.mapInfo = mapInfo;
    this.hexMap.mapInfo = mapInfo;
    this.mapData = mapInfo.tiles;

    // Electricity init
    this.electricitySystem = ElectricitySystem || null;
    if (!this.electricity) this.electricity = {};
    try {
      if (typeof initElectricityForScene === 'function') initElectricityForScene(this);
      else if (this.electricitySystem?.initElectricityForScene) this.electricitySystem.initElectricityForScene(this);
      else if (this.electricitySystem?.initElectricity) { this.electricitySystem.initElectricity(this); this.electricity.initialized = true; }
      else console.warn('[ENERGY] WorldSceneElectricity.initElectricityForScene not found');
    } catch (err) {
      console.error('[ENERGY] Error during electricity init:', err);
    }

    // Keep compatibility helpers
    this.hexToPixel = (q, r, sizeOverride) => hexToPixel(q, r, sizeOverride ?? this.hexSize);
    this.pixelToHex = (x, y, sizeOverride) => pixelToHex(x, y, sizeOverride ?? this.hexSize);

    // coordinate helpers (from merged file)
    this.axialToWorld = (q, r) => axialToWorld(this, q, r);
    this.worldToAxial = (x, y) => worldToAxial(this, x, y);
    this.refreshAllIconWorldPositions = () => refreshAllIconWorldPositions(this);

    // bind these BEFORE UI/input setup
    this.applyCombatEvent = (ev) => applyCombatEvent(this, ev);
    this.moveEnemies = () => moveEnemiesImpl(this);

    // Wrap endTurn so that AFTER advancing to the next owner + reset,
    // we can run auto-moves for the new active side.
    this.endTurn = () => {
      endTurnImpl(this);
      // If endTurnImpl early-returned due to lock, don't do anything.
      if (this.uiLocked) return;
      this.runAutoMovesForTurnOwner?.();
    };

    this.getNextPlayer = (players, currentName) => getNextPlayerImpl(players, currentName);

    // Apply water level & draw world once
    this.recomputeWaterFromLevel();

    // Spawn
    await spawnUnitsAndEnemies.call(this);

    this.players = this.players && this.players.length ? this.players : this.units.filter(u => u.isPlayer);
    this.enemies = this.enemies && this.enemies.length ? this.enemies : this.units.filter(u => u.isEnemy);

    this.turnOwner = this.players[0]?.playerName || this.players[0]?.name || null;

    // UI setup
    attachSelectionHighlight(this);
    setupWorldMenus(this);

    // ✅ CRITICAL: without this, openUnitActionPanel/refreshUnitActionPanel never exist
    setupUnitActionPanel(this);

    setupBuildingsUI(this);

    setupTurnUI(this);
    setupLogisticsPanel(this);
    setupEnergyPanel(this);
    setupHexInfoPanel(this);
    setupHistoryUI(this);

    updateTurnText(this, this.turnNumber);

    this.addWorldMetaBadge();

    setupWorldInputUI(this);
    initDebugMenu(this);

    this.refreshAllIconWorldPositions();

    /* Supabase sync bridge stub */
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

    // If you start a turn already having queued auto-moves (e.g. loaded state), run them:
    this.runAutoMovesForTurnOwner?.();
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

    const label = this.add.text(x + pad.x, y + pad.y, text, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#d0f2ff',
    });
    label.setDepth(101);
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

  /**
   * Civ-style auto move: units with unit.autoMove = { active:true, target:{q,r} }
   * will move up to their MP at the start of their owner's turn.
   *
   * Runs sequentially to avoid tween overlap and keep logic deterministic.
   */
  runAutoMovesForTurnOwner() {
    if (this.uiLocked) return;
    if (this.isUnitMoving) return;

    const owner = this.turnOwner || null;
    if (!owner) return;

    // Only process player units of current owner (enemies act via moveEnemies)
    const all = []
      .concat(this.units || [])
      .concat(this.players || []);

    const queue = all.filter(u => {
      if (!u || u.isDead) return false;
      if (!u.isPlayer) return false;
      const uOwner = u.playerName || u.name || null;
      if (uOwner !== owner) return false;

      const am = u.autoMove;
      return !!(am && am.active && am.target && Number.isFinite(am.target.q) && Number.isFinite(am.target.r));
    });

    const runNext = () => {
      if (queue.length === 0) {
        this.refreshUnitActionPanel?.();
        return;
      }

      const unit = queue.shift();
      if (!unit || unit.isDead) return runNext();

      // If unit spent its MP already (e.g., moved manually), skip until next turn
      const mp = getMP(unit);
      if (mp <= 0) return runNext();

      const target = unit.autoMove.target;
      if (unit.q === target.q && unit.r === target.r) {
        unit.autoMove.active = false;
        return runNext();
      }

      const blocked = (t) => {
        if (!t) return true;
        if (t.type === 'water' || t.type === 'mountain') return true;
        const occ = getUnitAtHex(this, t.q, t.r);
        if (occ && occ !== unit) return true;
        return false;
      };

      const fullPath = computePath(this, unit, target, blocked);
      if (!fullPath || fullPath.length < 2) {
        // No path: cancel auto-move to avoid infinite attempts
        unit.autoMove.active = false;
        return runNext();
      }

      const { segment, costSum } = buildMoveSegmentForThisTurn(this, unit, fullPath, blocked);
      if (!segment || segment.length < 2) {
        // Can't advance this turn (blocked or not enough MP)
        return runNext();
      }

      this.startStepMovement(unit, segment, () => {
        // Spend MP
        const mpBefore = getMP(unit);
        setMP(unit, mpBefore - costSum);

        // Sync final position (same as manual move)
        this.syncPlayerMove?.(unit);

        // Arrived?
        if (unit.q === target.q && unit.r === target.r) {
          unit.autoMove.active = false;
        }

        // Continue with next unit
        runNext();
      });
    };

    runNext();
  }

  recomputeWaterFromLevel() {
    if (!Array.isArray(this.mapData)) return;

    const lvlRaw = (typeof this.worldWaterLevel === 'number') ? this.worldWaterLevel : 3;
    const lvl = Math.max(0, Math.min(7, lvlRaw));
    this.worldWaterLevel = lvl;
    this.waterLevel = lvl;

    for (const t of this.mapData) {
      if (!t) continue;

      let base = (typeof t.baseElevation === 'number')
        ? t.baseElevation
        : (typeof t.elevation === 'number' ? t.elevation : 0);
      if (base <= 0) base = 1;
      t.baseElevation = base;
      t.elevation = base;

      if (!t.groundType) {
        if (t.type && t.type !== 'water') t.groundType = t.type;
        else t.groundType = 'grassland';
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
    this.refreshAllIconWorldPositions();
  }

  redrawWorld() {
    drawHexMap.call(this);
    drawLocationsAndRoads.call(this);
    spawnFishResources.call(this);
    spawnCrudeOilResources.call(this);
  }
}

/* ===== prototypes left as-is ===== */

WorldScene.prototype.setSelectedUnit = function (unit) {
  this.selectedUnit = unit;
  this.updateSelectionHighlight?.();

  if (unit) {
    this.openUnitActionPanel?.(unit);
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

WorldScene.prototype.addHistoryEntry = function (entry) {
  if (!this.historyEntries) this.historyEntries = [];
  this.historyEntries.push(entry);
  this.historyEntries.sort((a, b) => a.year - b.year);
  this.refreshHistoryPanel?.();
};

WorldScene.prototype.getNextHistoryYear = function () {
  const baseYear = 5000;
  if (!this.historyEntries || this.historyEntries.length === 0) return baseYear;
  const last = this.historyEntries[this.historyEntries.length - 1];
  return (typeof last.year === 'number' ? last.year : baseYear) + 3;
};
