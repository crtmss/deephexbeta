import Phaser from 'phaser';
import { HexMap } from '../engine/HexMap.js';
import { generateRuinLoreForTile } from './LoreGeneration.js';
import { preloadWorldSceneUI } from './WorldScenePreload.js';
import { setupCameraControls, setupTurnUI, setupWorldInputUI } from './WorldSceneUI.js';
import { drawHexMap, drawLocationsAndRoads, effectiveElevation, hexToPixel, pixelToHex, roundHex } from './WorldSceneMap.js';
import { spawnUnitsAndEnemies, updateUnitOrientation, subscribeToGameUpdates, buildTransporterAtSelectedUnit, buildRaiderAtSelectedUnit } from './WorldSceneUnits.js';
import { setupHexInfoPanel } from './WorldSceneHexInfo.js';
import { setupWorldMenus, attachSelectionHighlight, setupUnitActionPanel, openHexInspectPanel } from './WorldSceneMenus.js';
import { setupBuildingsUI, refreshBuildingPanelForSelection, updateBuildMenuPosition, updateSelectionForBuilding, refreshBuildMenuForTile, updateBuildRoadButtonState } from './WorldSceneBuildingsUI.js';
import { buildRoadAtSelectedHex } from './WorldSceneActions.js';
import { setupDebugMenu } from './WorldSceneDebug.js';
// import { setupMessageUI } from './WorldSceneMessages.js';
import { addHexTransformMenuButton } from './HexTransformTool.js';
import { placeBuildingAtSelectedHex } from './WorldSceneBuildings.js';
import { setupBridgeButtons } from './WorldSceneBridges.js';
import { initElectricityForScene, applyElectricityOnEndTurn, buildPowerPlantAtSelectedHex, WorldSceneElectricity } from './WorldSceneElectricity.js';
import { setupEnergyPanel } from './WorldSceneEnergyUI.js';
import { spawnFishResources, spawnCrudeOilResources } from './WorldSceneResources.js';
import { setupTradeUI, createTradeOfferPanel, refreshTradeHUD } from './WorldSceneTrade.js';
import { setupLogisticsPanel, applyLogisticsOnEndTurn, updateLogisticsPanelPosition, updateRepairButtonsState } from './WorldSceneLogistics.js';
import { setupHistoryUI } from './WorldSceneHistory.js';
import { worldAstarPath } from './WorldSceneAStar.js';
import { setupEconomyUI, updateResourceUI, refreshResourcesPanel } from './WorldSceneEconomy.js';
import { startBridgePlacementMode, placeBridgeAtSelectedHex } from './WorldSceneBridges.js';
import { startHexTransformTool, transformHexAtSelected } from './HexTransformTool.js';
import { startRaiseLandMode, raiseLandAtSelectedHex, startLowerLandMode, lowerLandAtSelectedHex } from './HexTransformTool.js';
import { moveEnemies } from '../units/WorldSceneAI.js';
import {
  getWorldSummaryForSeed,
  axialToWorld,
  worldToAxial,
  refreshAllIconWorldPositions,
  debugHex,
  getNextPlayer,
  endTurn,
  resetUnitsForNewTurn,
} from './WorldSceneWorldMeta.js';
import { supabase as sharedSupabase } from '../net/SupabaseClient.js';
import { processHaulerTurn, processShipTurn } from './WorldSceneHaulers.js';
import { ensureAttackController } from '../combat/AttackController.js';
import { ensureAbilityController } from '../abilities/AbilityController.js';
import { getAbilityDef } from '../abilities/AbilityDefs.js';
import { resolveAttack, resolveDirectDamage } from '../units/CombatResolver.js';
import { applyCombatEvent } from './WorldSceneCombatRuntime.js';
import {
  TICK_PHASE,
  addUnitEffect,
  placeHexEffect,
  removeHexEffectsAt,
  findHexEffectsAt,
  getUnitEffectStacks,
  ensureHexEffectsState,
  ensureUnitEffectsState,
  ensurePassiveEffects,
  tickUnitEffects,
  tickHexEffects,
  decrementUnitEffectDurations,
  cleanupExpiredUnitEffects,
  decrementHexEffectDurations,
  cleanupExpiredHexEffects,
} from '../effects/EffectEngine.js';
import { ensureUnitCombatFields } from '../units/UnitActions.js';
import { applyRoadPlansToMap } from './WorldSceneMapLocations.js';

/* ──────────────────────────────────────────────────────────────────────────
   Mission helpers / guardrails
   ────────────────────────────────────────────────────────────────────────── */

// Valid mission types in lobby
const MISSION_TYPES = new Set([
  'survival',
  'big_constructor',
  'elimination',
]);

function normMissionType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (MISSION_TYPES.has(s)) return s;
  return 'survival';
}

function isWaterTile(tile) {
  if (!tile) return true;
  const type = String(tile.type || '').toLowerCase();
  const gt = String(tile.groundType || '').toLowerCase();
  return (
    type === 'water' ||
    gt === 'water' ||
    tile.isWater === true ||
    tile.isCoveredByWater === true ||
    tile.isUnderWater === true
  );
}

function isMountainTile(tile) {
  if (!tile) return false;
  const type = String(tile.type || '').toLowerCase();
  const gt = String(tile.groundType || '').toLowerCase();
  return type === 'mountain' || gt === 'mountain';
}

function isLandTile(tile) {
  return !!tile && !isWaterTile(tile) && !isMountainTile(tile);
}

/**
 * Elimination map: a circular stone arena surrounded by deep water.
 * Keeps map size, but rewrites tiles deterministically.
 */
function applyEliminationArenaMap(scene) {
  const map = scene.mapData || [];
  if (!map.length) return;

  const w = scene.mapWidth || 25;
  const h = scene.mapHeight || 25;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Big circular platform with a 1-2 tile water border.
  const radius = Math.max(6, Math.floor(Math.min(w, h) * 0.34));

  for (const t of map) {
    if (!t) continue;

    const dx = t.q - cx;
    const dy = t.r - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clear all location/resource flags no matter what
    t.isLocation = false;
    t.locationType = null;
    t.locationName = null;
    t.resourceType = null;
    t.hasFish = false;
    t.hasCrudeOil = false;
    t.hasRoad = false;
    t.roadType = null;
    t.objectType = null;

    if (dist <= radius) {
      // Stone platform
      t.type = 'stone';
      t.groundType = 'stone';

      t.baseElevation = 2;
      t.elevation = 2;
      t.visualElevation = 2;

      t.isWater = false;
      t.isCoveredByWater = false;
      t.isUnderWater = false;
      t.waterDepth = 0;

      t.hasForest = false;
    } else {
      // Deep water ring
      t.type = 'water';
      t.groundType = 'water';

      t.baseElevation = 0;
      t.elevation = 0;
      t.visualElevation = 0;

      t.isWater = true;
      t.isCoveredByWater = true;
      t.isUnderWater = true;
      t.waterDepth = 3;

      t.hasForest = false;
    }
  }

  // Lock water level to this arena setup
  scene.worldWaterLevel = 0;
  scene.waterLevel = 0;
}

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldScene' });

    this.mapWidth = 25;
    this.mapHeight = 25;
    this.hexSize = 24;

    this.units = [];
    this.players = [];
    this.enemies = [];
    this.resources = [];
    this.haulers = [];
    this.ships = [];
    this.selectedUnit = null;
    this.selectedBuilding = null;
    this.selectedHex = null;
    this.pathPreviewTiles = [];
    this.pathPreviewLabels = [];
    this.isDragging = false;
    this.isUnitMoving = false;

    this.supabase = sharedSupabase;
    this.roomCode = null;
    this.playerName = null;
    this.playerId = null;
    this.isHost = false;
    this.lobbyState = null;

    this.uiLocked = false;
    this.turnNumber = 1;
    this.turnOwner = null;

    this.worldWaterLevel = 3;
    this.waterLevel = 3;
  }

  async create(data = {}) {
    this.roomCode   = data.roomCode   || null;
    this.playerName = data.playerName || null;
    this.playerId   = data.playerId   || null;
    this.isHost     = !!data.isHost;
    this.lobbyState = data.lobbyState || null;

    // Mission type from lobby / launch data
    this.missionType = normMissionType(
      data.missionType ??
      this.lobbyState?.missionType ??
      'survival'
    );
    this.isEliminationMission = this.missionType === 'elimination';

    // Map seed
    const seed = data.seed || this.lobbyState?.seed || 'deephex-default-seed';
    this.seed = seed;

    // World offsets
    this.mapOffsetX = Math.round(this.scale.width * 0.5);
    this.mapOffsetY = Math.round(this.scale.height * 0.35);

    // Build hex map
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, seed);
    const mapInfo = this.hexMap.generateMap();
    this.mapData = this.hexMap.tiles || [];
    this.mapInfo = mapInfo || null;

    // Mission override: elimination arena
    if (this.isEliminationMission) {
      applyEliminationArenaMap(this);
    }

    // Electricity
    initElectricityForScene(this);

    // Generate lore/POI before draw (skip for elimination)
    if (!this.isEliminationMission) {
      this.ensureLoreReadyBeforeFirstDraw();
      applyRoadPlansToMap(this);
    }

    // Initial draw
    drawHexMap.call(this);
    drawLocationsAndRoads.call(this);

    // Spawn resource overlays only for non-elimination maps
    if (!this.isEliminationMission) {
      spawnFishResources.call(this);
      spawnCrudeOilResources.call(this);
    }

    // Spawn units
    await spawnUnitsAndEnemies.call(this);

    // Default turn owner
    if (Array.isArray(this.players) && this.players.length > 0) {
      const p0 = this.players[0];
      this.turnOwner = (typeof p0 === 'string') ? p0 : (p0.playerName || p0.name || null);
    } else {
      this.turnOwner = this.playerName || 'Player';
    }

    // FIX: initial turn reset so fresh units start with valid MP/AP
    try {
      resetUnitsForNewTurn(this);
    } catch (e) {
      console.warn('[TURN] Initial resetUnitsForNewTurn failed:', e);
    }

    // Effects runtime init
    this.initEffectsRuntime();

    // Scene helpers
    this.axialToWorld = (q, r) => axialToWorld(this, q, r);
    this.worldToAxial = (x, y) => worldToAxial(this, x, y);
    this.refreshAllIconWorldPositions = () => refreshAllIconWorldPositions(this);
    this.debugHex = (q, r) => debugHex(this, q, r);
    this.getNextPlayer = (players, currentName) => getNextPlayer(players, currentName);
    this.endTurn = () => endTurn(this);
    this.moveEnemies = () => moveEnemies(this);

    // Panels / HUD / Menus
    setupHexInfoPanel(this);
    setupWorldMenus(this);
    setupBuildingsUI(this);
    setupEnergyPanel(this);
    setupLogisticsPanel(this);
    setupTurnUI(this);
    setupHistoryUI(this);
    setupEconomyUI(this);

    // Unit selection/action UI
    attachSelectionHighlight(this);
    setupUnitActionPanel(this);

    // World input / camera
    setupCameraControls(this);
    setupWorldInputUI(this);

    // Build/bridge/transform UI
    setupBridgeButtons?.(this);
    addHexTransformMenuButton?.(this);

    // Debug
    setupDebugMenu?.(this);

    // Turn label
    updateTurnText(this, this.turnNumber);

    // World summary
    this.addWorldMetaBadge();

    // Net sync
    if (this.roomCode) {
      subscribeToGameUpdates(this, this.roomCode);
    }

    // Keep all visuals snapped to elevated world positions
    this.refreshAllIconWorldPositions();
  }

  /* ======================================================================
     Lore bootstrap
     ====================================================================== */
  ensureLoreReadyBeforeFirstDraw() {
    if (this.__worldLoreGenerated) return;
    if (!Array.isArray(this.mapData) || this.mapData.length === 0) return;

    const firstLand = this.mapData.find(t => t && isLandTile(t));
    if (!firstLand) return;

    try {
      generateRuinLoreForTile(this, firstLand);
    } catch (e) {
      console.warn('[LORE] Failed to generate lore before draw:', e);
    }
  }

  /* ======================================================================
     Basic world helpers
     ====================================================================== */

  addWorldMetaBadge() {
    const { geography, biome } = getWorldSummaryForSeed(this.seed, this.mapWidth, this.mapHeight);

    const lines = [
      `Seed: ${this.seed}`,
      `Biome: ${biome}`,
      `Water: ${geography.waterTiles}`,
      `Forest: ${geography.forestTiles}`,
      `Mountains: ${geography.mountainTiles}`,
    ];

    this.metaBadgeBg = this.add.rectangle(
      18, 18,
      260, 110,
      0x092033, 0.82
    ).setOrigin(0, 0).setScrollFactor(0).setDepth(300);

    this.metaBadgeText = this.add.text(28, 24, lines.join('\n'), {
      fontFamily: 'Arial',
      fontSize: '13px',
      color: '#d7ecff',
      lineSpacing: 4,
    }).setScrollFactor(0).setDepth(301);
  }

  getAllRuntimeUnits() {
    return []
      .concat(this.units || [])
      .concat(this.players || [])
      .concat(this.enemies || [])
      .concat(this.haulers || [])
      .concat(this.ships || []);
  }

  getHexesInRadius(q, r, radius) {
    const results = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const nq = q + dq;
        const nr = r + dr;
        if (nq < 0 || nr < 0 || nq >= this.mapWidth || nr >= this.mapHeight) continue;
        results.push({ q: nq, r: nr });
      }
    }
    return results;
  }

  getTileAtRuntime(q, r) {
    return (this.mapData || []).find(t => t && t.q === q && t.r === r) || null;
  }

  getUnitAtHexRuntime(q, r) {
    return this.getAllRuntimeUnits().find(u => u && !u.isDead && u.q === q && u.r === r) || null;
  }

  getMoveCostRuntime(fromTile, toTile) {
    if (!fromTile || !toTile) return Infinity;

    const e0 = Number.isFinite(fromTile.visualElevation) ? fromTile.visualElevation
      : Number.isFinite(fromTile.elevation) ? fromTile.elevation
      : Number.isFinite(fromTile.baseElevation) ? fromTile.baseElevation : 0;

    const e1 = Number.isFinite(toTile.visualElevation) ? toTile.visualElevation
      : Number.isFinite(toTile.elevation) ? toTile.elevation
      : Number.isFinite(toTile.baseElevation) ? toTile.baseElevation : 0;

    if (Math.abs(e1 - e0) > 1) return Infinity;

    let cost = 1;
    if (toTile.hasForest) cost += 1;
    if (e1 > e0) cost += 1;
    return cost;
  }

  /* ======================================================================
     Path preview drawing
     ====================================================================== */

  drawPathPreview(within = [], beyond = []) {
    this.clearPathPreview();

    const drawSegment = (path, color, alpha) => {
      if (!Array.isArray(path) || path.length < 2) return;

      const g = this.add.graphics();
      g.lineStyle(3, color, alpha);

      for (let i = 0; i < path.length - 1; i++) {
        const a = this.axialToWorld(path[i].q, path[i].r);
        const b = this.axialToWorld(path[i + 1].q, path[i + 1].r);

        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.strokePath();
      }

      g.setDepth(100);
      this.pathPreviewTiles.push(g);
    };

    drawSegment(within, 0x00ffff, 0.95);
    drawSegment(beyond, 0x8a8a8a, 0.85);

    const makeLabel = (hex, text, reachable = true) => {
      const { x, y } = this.axialToWorld(hex.q, hex.r);
      const lbl = this.add.text(x, y - 10, String(text), {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: reachable ? '#00ffff' : '#b0b0b0',
        fontStyle: 'bold',
        backgroundColor: 'rgba(0,0,0,0.35)',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(101);
      this.pathPreviewLabels.push(lbl);
    };

    if (within.length > 1) makeLabel(within[within.length - 1], 1, true);
    if (beyond.length > 1) makeLabel(beyond[beyond.length - 1], 2, false);
  }

  clearPathPreview() {
    if (this.pathPreviewTiles) {
      this.pathPreviewTiles.forEach(g => g?.destroy?.());
      this.pathPreviewTiles = [];
    }
    if (this.pathPreviewLabels) {
      this.pathPreviewLabels.forEach(t => t?.destroy?.());
      this.pathPreviewLabels = [];
    }
  }

  /* ======================================================================
     Step movement
     ====================================================================== */

  startStepMovement(unit, path, onComplete) {
    if (!unit || !Array.isArray(path) || path.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    // Sync aliases before first move step
    if (!Number.isFinite(unit.mp) && Number.isFinite(unit.movementPoints)) unit.mp = unit.movementPoints;
    if (!Number.isFinite(unit.movementPoints) && Number.isFinite(unit.mp)) unit.movementPoints = unit.mp;
    if (!Number.isFinite(unit.mpMax) && Number.isFinite(unit.maxMovementPoints)) unit.mpMax = unit.maxMovementPoints;
    if (!Number.isFinite(unit.maxMovementPoints) && Number.isFinite(unit.mpMax)) unit.maxMovementPoints = unit.mpMax;
    if (!Number.isFinite(unit.movementPointsMax) && Number.isFinite(unit.mpMax)) unit.movementPointsMax = unit.mpMax;

    this.isUnitMoving = true;

    const scene = this;
    let index = 1;

    const finishMove = () => {
      scene.isUnitMoving = false;
      scene.updateSelectionHighlight?.();
      scene.refreshUnitActionPanel?.();
      if (onComplete) onComplete();
    };

    const stepNext = () => {
      if (index >= path.length) {
        const last = path[path.length - 1];
        unit.q = last.q;
        unit.r = last.r;
        finishMove();
        return;
      }

      const nextStep = path[index];

      try {
        updateUnitOrientation(scene, unit, unit.q, unit.r, nextStep.q, nextStep.r);
      } catch (_) {}

      const { x, y } = scene.axialToWorld(nextStep.q, nextStep.r);

      const moveInstantly = () => {
        if (typeof unit.setPosition === 'function') unit.setPosition(x, y);
        else { unit.x = x; unit.y = y; }

        unit.q = nextStep.q;
        unit.r = nextStep.r;

        index += 1;
        stepNext();
      };

      try {
        scene.tweens.add({
          targets: unit,
          x,
          y,
          duration: 160,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            unit.q = nextStep.q;
            unit.r = nextStep.r;

            index += 1;
            stepNext();
          },
          onStop: moveInstantly,
        });
      } catch (e) {
        console.warn('[MOVE] Tween failed, fallback to instant step:', e);
        moveInstantly();
      }
    };

    stepNext();
  }