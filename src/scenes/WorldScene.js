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

    // ----- FIX: initial turn reset so freshly spawned units start with valid mp/ap -----
    try {
      resetUnitsForNewTurn(this);
    } catch (e) {
      console.warn('[TURN] Initial resetUnitsForNewTurn failed:', e);
    }
    // -------------------------------------------------------------------------------

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

        if (unitHasEffect(unit, 'CorrosiveCorrosivebial') || unitHasEffect(unit, 'CORROSIVE_BIAL')) {
          const before = Number.isFinite(unit.hp) ? unit.hp : 0;
          const dmg = 2;
          unit.hp = Math.max(0, before - dmg);
          scene.refreshUnitActionPanel?.();
        }

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

            if (unitHasEffect(unit, 'CorrosiveCorrosivebial') || unitHasEffect(unit, 'CORROSIVE_BIAL')) {
              const before = Number.isFinite(unit.hp) ? unit.hp : 0;
              const dmg = 2;
              unit.hp = Math.max(0, before - dmg);
              scene.refreshUnitActionPanel?.();
            }

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

  /* ======================================================================
     Auto move
     ====================================================================== */

  runAutoMovesForTurnOwner() {
    const owner = this.turnOwner;
    if (!owner) return;

    const all = this.getAllRuntimeUnits();

    const controllable = all.filter(u =>
      u &&
      !u.isDead &&
      !u.isEnemy &&
      (u.playerName || u.name) === owner &&
      u.autoMove?.active &&
      u.autoMove?.target
    );

    for (const unit of controllable) {
      const target = unit.autoMove.target;
      if (!target) continue;
      if (unit.q === target.q && unit.r === target.r) {
        unit.autoMove.active = false;
        continue;
      }

      const path = aStarFindPath(
        { q: unit.q, r: unit.r },
        { q: target.q, r: target.r },
        this.mapData || [],
        (tile) => {
          if (!tile) return true;
          if (tile.type === 'water' || tile.type === 'mountain') return true;
          const occ = this.getUnitAtHexRuntime(tile.q, tile.r);
          return !!occ && occ !== unit;
        },
        { getMoveCost: (a, b) => this.getMoveCostRuntime(a, b) }
      );

      if (!path || path.length <= 1) {
        unit.autoMove.active = false;
        continue;
      }

      const mp =
        Number.isFinite(unit.movementPoints) ? unit.movementPoints :
        Number.isFinite(unit.mp) ? unit.mp :
        0;

      let cost = 0;
      const usable = [path[0]];

      for (let i = 1; i < path.length; i++) {
        const prev = this.getTileAtRuntime(path[i - 1].q, path[i - 1].r);
        const cur = this.getTileAtRuntime(path[i].q, path[i].r);
        const stepCost = this.getMoveCostRuntime(prev, cur);
        if (!Number.isFinite(stepCost) || stepCost === Infinity) break;
        if (cost + stepCost > mp) break;
        usable.push(path[i]);
        cost += stepCost;
      }

      if (usable.length <= 1) continue;

      this.startStepMovement(unit, usable, () => {
        if (Number.isFinite(unit.movementPoints)) unit.movementPoints = Math.max(0, unit.movementPoints - cost);
        if (Number.isFinite(unit.mp)) unit.mp = Math.max(0, unit.mp - cost);

        if (unit.q === target.q && unit.r === target.r) {
          unit.autoMove.active = false;
        }

        this.syncPlayerMove?.(unit);
        this.refreshUnitActionPanel?.();
      });
    }
  }

  /* ======================================================================
     Ability / effects runtime
     ====================================================================== */

  initEffectsRuntime() {
    if (!this.lobbyState) this.lobbyState = {};
    ensureHexEffectsState(this);

    this.getAllRuntimeUnits().forEach(u => {
      ensureStatusArray(u);
      ensureEffectsArray(u);
      ensureUnitEffectsState(u);
    });

    this.getAllRuntimeUnits().forEach(u => {
      try {
        ensurePassiveEffects(u, getAbilityDef);
      } catch (e) {
        console.warn('[EFF] ensurePassiveEffects failed for unit', u?.id, e);
      }
    });
  }

  runEffectPhase(phase, ctx = {}) {
    const units = this.getAllRuntimeUnits();

    for (const u of units) {
      try {
        ensureUnitEffectsState(u);
        tickUnitEffects(u, phase, { scene: this, ...ctx });
      } catch (e) {
        console.warn('[EFF] tickUnitEffects failed', { phase, unitId: u?.id }, e);
      }
    }

    try {
      tickHexEffects(this, phase, { scene: this, ...ctx });
    } catch (e) {
      console.warn('[EFF] tickHexEffects failed', { phase }, e);
    }
  }

  advanceEffectsOnTurnEnd() {
    const units = this.getAllRuntimeUnits();
    for (const u of units) {
      try {
        decrementUnitEffectDurations(u);
        cleanupExpiredUnitEffects(u);
      } catch (e) {
        console.warn('[EFF] decrement/cleanup unit failed', u?.id, e);
      }
    }

    try {
      decrementHexEffectDurations(this);
      cleanupExpiredHexEffects(this);
    } catch (e) {
      console.warn('[EFF] decrement/cleanup hex failed', e);
    }
  }

  applyCombatEvent(ev) {
    const res = applyCombatEvent(this, ev);

    try {
      const defender = ev?.defenderId
        ? this.getAllRuntimeUnits().find(u => (u.id ?? u.unitId) === ev.defenderId)
        : null;

      if (defender && (unitHasEffect(defender, 'CryoShatter') || unitHasEffect(defender, 'CRYO_SHATTER'))) {
        const before = Number.isFinite(defender.hp) ? defender.hp : 0;
        const bonus = 4;
        defender.hp = Math.max(0, before - bonus);

        if (Array.isArray(defender.effects)) {
          const idx = defender.effects.findIndex(e =>
            e && (e.defId === 'CryoShatter' || e.defId === 'CRYO_SHATTER')
          );
          if (idx >= 0) defender.effects.splice(idx, 1);
        }
      }

              if (defender && (unitHasEffect(defender, 'CryoShatter') || unitHasEffect(defender, 'CRYO_SHATTER'))) {
          const before = Number.isFinite(defender.hp) ? defender.hp : 0;
          const bonus = 4;
          defender.hp = Math.max(0, before - bonus);
          // remove one instance by defId (best-effort)
          if (Array.isArray(defender.effects)) {
            const idx = defender.effects.findIndex(e => e && (e.defId === 'CryoShatter' || e.defId === 'CRYO_SHATTER'));
            if (idx >= 0) defender.effects.splice(idx, 1);
          }
          console.log('[STATUS] Shatter bonus dmg', { defenderId: defender.id, bonus, hpBefore: before, hpAfter: defender.hp });
        }

        // STATUS HOOK: Radiation Irradiated — on death, apply effects to adjacent units.
        // Table: "On death, apply 'Mutant stress' and 'Irradiated' to adjacent units".
        // We'll re-apply Irradiated; MutantStress will be a no-op until EffectDefs defines it.
        const all = this.getAllRuntimeUnits();
        for (const u of all) {
          if (!u || u.isDead) continue;
          if (Number.isFinite(u.hp) && u.hp <= 0) {
            // Mark as dead in a compatible way (if the runtime didn't already)
            u.isDead = true;

            if (unitHasEffect(u, 'RadiationIrradiated') || unitHasEffect(u, 'RADIATION_IRRADIATED') || unitHasEffect(u, 'IRRADIATED')) {
              const neigh = this.getHexesInRadius(u.q, u.r, 1).filter(h => !(h.q === u.q && h.r === u.r));
              for (const h of neigh) {
                const v = (this.units || []).find(x => x && x.q === h.q && x.r === h.r) ||
                          (this.players || []).find(x => x && x.q === h.q && x.r === h.r) ||
                          (this.enemies || []).find(x => x && x.q === h.q && x.r === h.r) ||
                          (this.haulers || []).find(x => x && x.q === h.q && x.r === h.r) ||
                          (this.ships || []).find(x => x && x.q === h.q && x.r === h.r) ||
                          null;
                if (!v || v.isDead) continue;

                ensureUnitEffectsState(v);
                // Best-effort: add by id string; actual def must exist in EffectDefs.
                addUnitEffect(v, 'RadiationIrradiated', { duration: 2, stacks: 1, sourceUnitId: u.id, sourceFaction: u.faction });
                addUnitEffect(v, 'MutantStress', { duration: 2, stacks: 1, sourceUnitId: u.id, sourceFaction: u.faction });
              }
            }
          }
        }
      } catch (e) {
        console.warn('[COMBAT] post-status hooks failed:', e);
      }

      return res;
    };
    this.moveEnemies = () => moveEnemiesImpl(this);

    // Wrap endTurn so that we can:
    // 1) tick effects at end of the current turn
    // 2) advance turn owner + reset (endTurnImpl)
    // 3) tick effects at start of the next turn
    // 4) run auto-moves for the new active side
    this.endTurn = () => {
      // Effect END phase (before ownership changes)
      try {
        this.runEffectPhase?.(TICK_PHASE.TURN_END);
        this.advanceEffectsOnTurnEnd?.();
      } catch (e) {
        console.warn('[EFF] endTurn phase failed:', e);
      }

      endTurnImpl(this);

      // If endTurnImpl early-returned due to lock, don't do anything.
      if (this.uiLocked) return;

      // Effect START phase (after reset, for new owner)
      try {
        this.runEffectPhase?.(TICK_PHASE.TURN_START);
      } catch (e) {
        console.warn('[EFF] startTurn phase failed:', e);
      }

      this.runAutoMovesForTurnOwner?.();
    };

    this.getNextPlayer = (players, currentName) => getNextPlayerImpl(players, currentName);

    // ✅ IMPORTANT CHANGE:
    // We need water-level recompute BEFORE lore (so "water"/land is final),
    // but we must NOT redraw until AFTER we apply lore road plans.
    if (!this.isEliminationMission) {
      this.recomputeWaterFromLevel({ skipRedraw: true });
    }

    // ✅ Generate lore/POI now that water is correct
    if (!this.isEliminationMission) {
      this.ensureLoreReadyBeforeFirstDraw();
    }

    // ✅ Apply road plans from lore (roads now exist ONLY if there were secondary road events)
    if (!this.isEliminationMission) {
      applyRoadPlansToMap(this);
    }

    // ✅ Now draw world once (hexmap + locations/roads + resources)
    this.redrawWorld();
    this.refreshAllIconWorldPositions();

    // Spawn
    await spawnUnitsAndEnemies.call(this);

    this.players = this.players && this.players.length ? this.players : this.units.filter(u => u.isPlayer);
    this.enemies = this.enemies && this.enemies.length ? this.enemies : this.units.filter(u => u.isEnemy);

    // Effects runtime (must run after units exist)
    this.initEffectsRuntime?.();

    // If players array is empty, still allow singleplayer turnOwner
    this.turnOwner = this.players[0]?.playerName || this.players[0]?.name || this.playerName || null;

    // UI setup
    attachSelectionHighlight(this);
    setupWorldMenus(this);

    // ✅ CRITICAL: without this, openUnitActionPanel/refreshUnitActionPanel never exist
    setupUnitActionPanel(this);

    setupBuildingsUI(this);

    setupTurnUI(this);
    setupLogisticsPanel(this);
    setupEnergyPanel(this);
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

      const nextStep = path[index];

      // ✅ turn BEFORE moving
      try {
        updateUnitOrientation(scene, unit, unit.q, unit.r, nextStep.q, nextStep.r);
      } catch (e) {}

      const { x, y } = scene.axialToWorld(nextStep.q, nextStep.r);

      scene.tweens.add({
        targets: unit,
        x,
        y,
        duration: 160,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          unit.q = nextStep.q;
          unit.r = nextStep.r;

          // STATUS HOOK: Corrosive bial — takes corrosive damage when moving
          if (unitHasEffect(unit, 'CorrosiveCorrosivebial') || unitHasEffect(unit, 'CORROSIVE_BIAL')) {
            const before = Number.isFinite(unit.hp) ? unit.hp : 0;
            const dmg = 2;
            unit.hp = Math.max(0, before - dmg);
            // Optional: mark for UI refresh
            this.refreshUnitActionPanel?.();
            if (typeof console !== 'undefined') {
              console.log('[STATUS] Corrosive bial move dmg', { unitId: unit.id, dmg, hpBefore: before, hpAfter: unit.hp });
            }
          }

          index += 1;
          stepNext();
        }
      });
    }

    stepNext();
  }

  /**
   * Civ-style auto move:
   * any controllable object with unit.autoMove = { active:true, target:{q,r} }
   * will move up to its MP at the start of its owner's turn.
   *
   * Runs sequentially to avoid tween overlap.
   */
  runAutoMovesForTurnOwner() {
    if (this.uiLocked) return;
    if (this.isUnitMoving) return;

    const owner = this.turnOwner || null;
    if (!owner) return;

    // Include *all* potentially controllable collections
    const all = []
      .concat(this.units || [])
      .concat(this.players || [])
      .concat(this.haulers || [])
      .concat(this.ships || []);

    const queue = all.filter(u => {
      if (!isControllable(u)) return false;

      const uOwner = getOwnerName(this, u);
      if (!uOwner) return false;

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
      if (!isControllable(unit)) return runNext();

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
        const mpBefore = getMP(unit);
        setMP(unit, mpBefore - costSum);

        // If you sync per-unit in multiplayer, keep it here.
        this.syncPlayerMove?.(unit);

        if (unit.q === target.q && unit.r === target.r) {
          unit.autoMove.active = false;
        }

        runNext();
      });
    };

    runNext();
  }

  recomputeWaterFromLevel(opts = null) {
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

    // IMPORTANT:
    // During initial create() we call this with {skipRedraw:true}
    // so lore + road plans can be applied before first draw.
    if (opts && opts.skipRedraw) return;

    this.redrawWorld();
    this.refreshAllIconWorldPositions();
  }

  redrawWorld() {
    // ✅ Safety: any external redraw (water-level changes etc.)
    // must not happen before lore exists, otherwise POIs/history can desync.
    if (!this.isEliminationMission) {
      this.ensureLoreReadyBeforeFirstDraw();
    }

    // Ensure roads are applied (safe if already applied)
    if (!this.__roadsAppliedFromLore) {
      if (!this.isEliminationMission) {
        applyRoadPlansToMap(this);
      }
    }

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
    (this.ships || []).find(s => s.q === q && s.r === r) ||
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

/* =========================================================
   ✅ NEW: Select hex from History (no camera pan)
   Used by WorldSceneHistory.js (and any future UI).
   ========================================================= */

WorldScene.prototype.selectHexFromHistory = function (q, r) {
  // 1) clear hover highlight (if exists)
  try {
    if (this.historyHoverGraphics) {
      this.historyHoverGraphics.clear();
      this.historyHoverGraphics.visible = false;
    }
  } catch (_e) {}

  // 2) deselect unit so the hex-inspect is allowed
  this.setSelectedUnit?.(null);

  // 3) set selected hex & open the same panel used for units (read-only)
  this.selectedHex = { q, r };
  this.selectedBuilding = null;

  this.clearPathPreview?.();
  this.openHexInspectPanel?.(q, r);

  // 4) refresh highlight visuals
  this.updateSelectionHighlight?.();
  this.debugHex?.(q, r);

  // 5) close history panel
  this.closeHistoryPanel?.();
};
