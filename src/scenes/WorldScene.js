// src/scenes/WorldScene.js
import Phaser from 'phaser';

// Menus / panels
import { setupWorldMenus, attachSelectionHighlight, setupUnitActionPanel } from './WorldSceneMenus.js';
import { setupHexInfoPanel } from './WorldSceneHexInfo.js';
import { setupBuildingsUI } from './WorldSceneBuildingsUI.js';
import { setupEnergyPanel } from './WorldSceneEnergyUI.js';
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
  resetUnitsForNewTurn,
  endTurn as endTurnImpl,
  getNextPlayer as getNextPlayerImpl,
} from './WorldSceneWorldMeta.js';

// AI moved to units folder
import { moveEnemies as moveEnemiesImpl } from '../units/WorldSceneAI.js';

// ✅ NEW: ensure lore/POI exists before first draw
import { generateRuinLoreForTile } from './LoreGeneration.js';

// Abilities + Effects runtime (data-driven)
import { getAbilityDef } from '../abilities/AbilityDefs.js';
import { resolveDirectDamage } from '../units/CombatResolver.js';
import {
  addUnitEffect,
  placeHexEffect,
  tickHexEffects,
  tickUnitEffects,
  decrementUnitEffectDurations,
  decrementHexEffectDurations,
  cleanupExpiredUnitEffects,
  cleanupExpiredHexEffects,
  ensureUnitEffectsState,
  ensurePassiveEffects,
  findHexEffectsAt,
  removeHexEffectsAt,
  getUnitEffectStacks,
  hexKey,
  TICK_PHASE,
} from '../effects/EffectEngine.js';

// ✅ NEW: roads are lore-driven now
import { applyRoadPlansToMap } from './WorldSceneMapLocations.js';
import { preloadWorldSceneUI } from './WorldScenePreload.js';

// ✅ NEW: turn-combat helpers for STATUS checks
import { ensureUnitCombatFields } from '../units/UnitActions.js';

// Buildings / map transform
import { placeBuildingAtSelectedHex } from './WorldSceneBuildings.js';
import { startBridgePlacementMode, placeBridgeAtSelectedHex } from './WorldSceneBridges.js';
import { startHexTransformTool, transformHexAtSelected } from './HexTransformTool.js';

// Map gen
import { HexMap } from '../engine/HexMap.js';

// Utility: if missing statuses array / effects array on a unit, init it
function ensureUnitStatusState(u) {
  if (!u) return;
  if (!Array.isArray(u.statuses)) u.statuses = [];
  if (!Array.isArray(u.effects)) u.effects = [];
}

// Utility: check if unit has effect by id (case-insensitive-ish)
function unitHasEffect(u, effectId) {
  if (!u || !Array.isArray(u.effects)) return false;
  return u.effects.some(e => {
    const id = (e?.defId ?? e?.id ?? '').toString().toLowerCase();
    return id === String(effectId).toLowerCase();
  });
}

// Utility: add a status icon entry if not present (simple, non-destructive)
function addStatusMarker(u, statusId) {
  if (!u) return;
  ensureUnitStatusState(u);
  const key = String(statusId || '').toLowerCase();
  if (!u.statuses.some(s => String(s?.id || s).toLowerCase() === key)) {
    u.statuses.push({ id: statusId });
  }
}

function removeStatusMarker(u, statusId) {
  if (!u || !Array.isArray(u.statuses)) return;
  const key = String(statusId || '').toLowerCase();
  u.statuses = u.statuses.filter(s => String(s?.id || s).toLowerCase() !== key);
}

/* =========================================================
   Elimination mission helpers
   ========================================================= */

function fillTileAsStonePlatform(t) {
  if (!t) return;
  t.type = 'stone';
  t.groundType = 'stone';
  t.isUnderWater = false;
  t.isWater = false;
  t.isCoveredByWater = false;
  t.waterDepth = 0;
  t.baseElevation = 1;
  t.elevation = 1;
  t.visualElevation = 1;
  t.hasForest = false;
  t.hasRoad = false;
}

function fillTileAsDeepWater(t) {
  if (!t) return;
  t.type = 'water';
  t.groundType = 'water';
  t.isUnderWater = true;
  t.isWater = true;
  t.isCoveredByWater = true;
  t.waterDepth = 3;
  t.baseElevation = 0;
  t.elevation = 0;
  t.visualElevation = 0;
  t.hasForest = false;
  t.hasRoad = false;
}

function applyEliminationArenaMap(scene) {
  const map = scene.mapData || [];
  if (!map.length) return;

  const w = scene.mapWidth || 0;
  const h = scene.mapHeight || 0;
  if (!w || !h) return;

  // Center and radius for a circular stone arena
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  // Radius chosen to leave a visible water border
  const radius = Math.max(5, Math.floor(Math.min(w, h) * 0.34));

  for (const t of map) {
    if (!t) continue;

    const dq = t.q - cx;
    const dr = t.r - cy;
    const dist = Math.sqrt(dq * dq + dr * dr);

    if (dist <= radius) {
      fillTileAsStonePlatform(t);
    } else {
      fillTileAsDeepWater(t);
    }
  }

  // Remove resources/roads/locations on elimination map
  for (const t of map) {
    if (!t) continue;
    t.resourceType = null;
    t.hasFish = false;
    t.hasCrudeOil = false;
    t.hasRoad = false;
    t.roadType = null;
    t.isLocation = false;
    t.locationType = null;
    t.locationName = null;
  }

  // Keep water level deterministic with the arena
  scene.worldWaterLevel = 1;
  scene.waterLevel = 1;

  console.log(`[MISSION] Elimination arena applied: radius=${radius} (${w}x${h})`);
}

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {
    // ✅ All WorldScene preloads live in WorldScenePreload.js now.
    // This includes:
    // - unit panel action button icons (assets/ui/unit_panel/buttons/)
    // - status effect icons (assets/ui/unit_panel/statuses/)
    preloadWorldSceneUI(this);
  }

  /**
   * ✅ Ensure lore/POI is generated BEFORE first draw.
   * We can't call ensureWorldLoreGenerated directly (it's internal),
   * but generateRuinLoreForTile triggers it safely.
   *
   * IMPORTANT: Discovery now creates the first settlement (in LoreGeneration.js),
   * and lore caps AI factions to max 2.
   */
  ensureLoreReadyBeforeFirstDraw() {
    if (this.__worldLoreGenerated) return;
    if (!Array.isArray(this.mapData) || this.mapData.length === 0) return;

    const firstLand = this.mapData.find(t => t && t.type !== 'water');
    if (!firstLand) return;

    try {
      generateRuinLoreForTile(this, firstLand);
    } catch (e) {
      console.warn('[LORE] Failed to generate lore before draw:', e);
    }
  }

  /* ========================================================================
     Abilities + Effects runtime (deterministic, multiplayer-friendly)
     ======================================================================== */

  initEffectsRuntime() {
    // Store hex effects on lobbyState (Supabase JSON friendly)
    // and mirror to scene for convenience.
    if (!this.lobbyState) this.lobbyState = {};
    if (!Array.isArray(this.lobbyState.hexEffects)) this.lobbyState.hexEffects = [];
    if (!Array.isArray(this.hexEffects)) this.hexEffects = this.lobbyState.hexEffects;

    // Ensure units arrays exist and every unit has effects/statuses arrays
    this.getAllRuntimeUnits().forEach(u => {
      ensureUnitStatusState(u);
      ensureUnitEffectsState(u);
    });

    // Attach passive effects once at scene init.
    this.getAllRuntimeUnits().forEach(u => {
      try {
        ensurePassiveEffects(u, getAbilityDef);
      } catch (e) {
        console.warn('[EFF] ensurePassiveEffects failed for unit', u?.id, e);
      }
    });
  }

  getAllRuntimeUnits() {
    return []
      .concat(this.units || [])
      .concat(this.players || [])
      .concat(this.enemies || [])
      .concat(this.haulers || [])
      .concat(this.ships || []);
  }

  /**
   * Run a phase tick for all unit + hex effects.
   * Phases: TICK_PHASE.TURN_START | TURN_END | ABILITY_USED | MOVED | DEATH
   *
   * Context should contain:
   *  - sourceUnit, targetUnit, extra
   */
  runEffectPhase(phase, ctx = {}) {
    const units = this.getAllRuntimeUnits();

    // Unit effects
    for (const u of units) {
      try {
        ensureUnitEffectsState(u);
        tickUnitEffects(u, phase, { scene: this, ...ctx });
      } catch (e) {
        console.warn('[EFF] tickUnitEffects failed', { phase, unitId: u?.id }, e);
      }
    }

    // Hex effects
    try {
      tickHexEffects(this, phase, { scene: this, ...ctx });
    } catch (e) {
      console.warn('[EFF] tickHexEffects failed', { phase }, e);
    }
  }

  /**
   * Advance durations at the end of a full turn cycle.
   * We do this once inside endTurn() after END effects tick.
   */
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

  /**
   * Deterministic local application of an ability cast.
   * For now we support:
   *  - direct multi-type damage
   *  - direct healing
   *  - applyUnitEffects to self / target
   *  - placeHexEffects on target hex / self hex
   *
   * More advanced motion/transport logic can be extended later without
   * changing the payload shape.
   */
  applyAbilityCastLocal(payload) {
    if (!payload || payload.kind !== 'ability:cast') return false;

    const caster = this.getAllRuntimeUnits().find(u => (u?.id ?? u?.unitId) === payload.casterId);
    if (!caster) {
      console.warn('[ABILITY] caster not found', payload.casterId);
      return false;
    }

    const ability = getAbilityDef(payload.abilityId);
    if (!ability || ability.kind !== 'active' || !ability.active) {
      console.warn('[ABILITY] invalid active ability', payload.abilityId);
      return false;
    }

    const targetQ = Number.isFinite(payload.targetQ) ? payload.targetQ : caster.q;
    const targetR = Number.isFinite(payload.targetR) ? payload.targetR : caster.r;

    const targetUnit =
      payload.targetUnitId
        ? this.getAllRuntimeUnits().find(u => (u?.id ?? u?.unitId) === payload.targetUnitId) || null
        : this.getAllRuntimeUnits().find(u => u && !u.isDead && u.q === targetQ && u.r === targetR) || null;

    // Spend AP once on successful cast (if still available)
    ensureUnitCombatFields(caster);
    const apCost = Number.isFinite(ability.active.apCost) ? ability.active.apCost : 1;
    const mpCost = Number.isFinite(ability.active.mpCost) ? ability.active.mpCost : 0;

    if ((caster.ap ?? 0) < apCost) {
      console.warn('[ABILITY] not enough AP', { casterId: caster.id, ap: caster.ap, apCost });
      return false;
    }
    if ((caster.mp ?? 0) < mpCost) {
      console.warn('[ABILITY] not enough MP', { casterId: caster.id, mp: caster.mp, mpCost });
      return false;
    }

    caster.ap = Math.max(0, (caster.ap ?? 0) - apCost);
    if (Number.isFinite(caster.mp)) caster.mp = Math.max(0, caster.mp - mpCost);
    if (Number.isFinite(caster.movementPoints)) caster.movementPoints = caster.mp;

    // Trigger "ability used" phase (for effects like Volatile Ignition)
    this.runEffectPhase?.(TICK_PHASE.ABILITY_USED, {
      sourceUnit: caster,
      targetUnit,
      abilityId: payload.abilityId,
      payload,
    });

    // ---------- direct healing ----------
    const healAmount =
      Number.isFinite(payload.healAmount)
        ? payload.healAmount
        : (Number.isFinite(ability.active.healAmount) ? ability.active.healAmount : 0);

    if (healAmount > 0) {
      const healTarget = targetUnit || caster;
      ensureUnitCombatFields(healTarget);
      const maxHp = Number.isFinite(healTarget.maxHp) ? healTarget.maxHp : (healTarget.hp || 1);
      healTarget.hp = Math.min(maxHp, (healTarget.hp || 0) + healAmount);
      console.log('[ABILITY] heal', { abilityId: ability.id, targetId: healTarget.id, amount: healAmount, hp: healTarget.hp, maxHp });
    }

    // ---------- direct multi-type damage ----------
    const dmgProfile =
      payload.damageProfile ||
      ability.active.damageProfile ||
      null;

    if (dmgProfile && targetUnit) {
      ensureUnitCombatFields(targetUnit);

      const dmgRes = resolveDirectDamage(caster, targetUnit, dmgProfile);
      const amount = Number.isFinite(dmgRes.finalDamage) ? dmgRes.finalDamage : 0;

      if (amount > 0) {
        this.applyCombatEvent({
          type: 'combat:attack',
          attackerId: caster.id ?? caster.unitId,
          defenderId: targetUnit.id ?? targetUnit.unitId,
          damage: amount,
          weaponId: `ability:${ability.id}`,
        });
      }
    }

    // ---------- apply unit effects ----------
    const applySpecs = Array.isArray(ability.active.applyUnitEffects)
      ? ability.active.applyUnitEffects
      : [];

    for (const spec of applySpecs) {
      const recipient =
        spec.applyTo === 'self' ? caster :
        spec.applyTo === 'target' ? targetUnit :
        null;

      if (!recipient) continue;

      try {
        ensureUnitEffectsState(recipient);
        addUnitEffect(recipient, spec.effectId, {
          duration: spec.duration,
          stacks: spec.stacks,
          sourceUnitId: caster.id ?? caster.unitId,
          sourceFaction: caster.faction,
          ...spec.params,
        });
        addStatusMarker(recipient, spec.effectId);
      } catch (e) {
        console.warn('[ABILITY] addUnitEffect failed', spec, e);
      }
    }

    // ---------- place hex effects ----------
    const hexSpecs = Array.isArray(ability.active.placeHexEffects)
      ? ability.active.placeHexEffects
      : [];

    for (const spec of hexSpecs) {
      try {
        if (spec.placeOn === 'targetHex' || spec.placeOn === 'aoe') {
          placeHexEffect(this, targetQ, targetR, spec.effectId, {
            duration: spec.duration,
            stacks: spec.stacks,
            sourceUnitId: caster.id ?? caster.unitId,
            sourceFaction: caster.faction,
            radius: spec.radius ?? ability.active.aoeRadius ?? 0,
            ...spec.params,
          });
        } else if (spec.placeOn === 'selfHex') {
          placeHexEffect(this, caster.q, caster.r, spec.effectId, {
            duration: spec.duration,
            stacks: spec.stacks,
            sourceUnitId: caster.id ?? caster.unitId,
            sourceFaction: caster.faction,
            radius: spec.radius ?? 0,
            ...spec.params,
          });
        }
      } catch (e) {
        console.warn('[ABILITY] placeHexEffect failed', spec, e);
      }
    }

    // Best-effort UI refresh
    this.refreshUnitActionPanel?.();
    this.refreshUnitStatusIcons?.();
    this.redrawWorld?.();

    return true;
  }

  /**
   * Simple multiplayer-friendly publication:
   * - host applies immediately
   * - non-host writes a JSON action into lobbyState.pendingAbilityActions
   *
   * This mirrors the pattern already used elsewhere without requiring
   * a new networking subsystem right now.
   */
  async queueAbilityCast(payload) {
    if (!payload) return false;

    // Host can apply immediately
    if (this.isHost) {
      return this.applyAbilityCastLocal(payload);
    }

    // Non-host: append to pending action queue in lobby state
    if (!this.supabase || !this.roomCode) {
      console.warn('[ABILITY] no supabase/roomCode; applying locally as fallback');
      return this.applyAbilityCastLocal(payload);
    }

    try {
      const pending = Array.isArray(this.lobbyState?.pendingAbilityActions)
        ? this.lobbyState.pendingAbilityActions.slice()
        : [];

      pending.push(payload);

      const newState = {
        ...(this.lobbyState || {}),
        pendingAbilityActions: pending,
      };

      const { error } = await this.supabase
        .from('lobbies')
        .update({ state: newState })
        .eq('code', this.roomCode);

      if (error) {
        console.warn('[ABILITY] failed to queue action in Supabase; applying locally fallback', error);
        return this.applyAbilityCastLocal(payload);
      }

      this.lobbyState = newState;
      return true;
    } catch (e) {
      console.warn('[ABILITY] queueAbilityCast exception; applying locally fallback', e);
      return this.applyAbilityCastLocal(payload);
    }
  }

  /**
   * Host drains pending ability actions each frame / or on turn boundaries.
   * We call it opportunistically after sync events / endTurn.
   */
  async processPendingAbilityActions() {
    if (!this.isHost) return;
    const pending = Array.isArray(this.lobbyState?.pendingAbilityActions)
      ? this.lobbyState.pendingAbilityActions.slice()
      : [];

    if (!pending.length) return;

    for (const payload of pending) {
      try {
        this.applyAbilityCastLocal(payload);
      } catch (e) {
        console.warn('[ABILITY] processPendingAbilityActions failed for payload', payload, e);
      }
    }

    // clear queue in DB/state
    const newState = {
      ...(this.lobbyState || {}),
      pendingAbilityActions: [],
    };

    this.lobbyState = newState;

    if (this.supabase && this.roomCode) {
      try {
        await this.supabase
          .from('lobbies')
          .update({ state: newState })
          .eq('code', this.roomCode);
      } catch (e) {
        console.warn('[ABILITY] failed clearing pending ability queue', e);
      }
    }
  }

  create(data) {
    this.playerName = data.playerName || 'Player';
    this.roomCode = data.roomCode || null;
    this.playerId = data.playerId || null;
    this.isHost = !!data.isHost;
    this.supabase = data.supabase || sharedSupabase;
    this.lobbyState = data.lobbyState || null;

    // ✅ NEW: mission parsing
    this.missionType = String(data.missionType || data.mode || this.lobbyState?.missionType || '').toLowerCase();
    this.isEliminationMission = this.missionType === 'elimination';

    this.seed = data.seed || this.lobbyState?.seed || 'default-seed';
    this.mapWidth = 25;
    this.mapHeight = 25;
    this.hexSize = 22;
    this.mapOffsetX = 60;
    this.mapOffsetY = 60;

    this.units = [];
    this.players = [];
    this.enemies = [];
    this.haulers = [];
    this.ships = [];
    this.resources = [];
    this.buildings = [];
    this.pathPreviewTiles = [];
    this.pathPreviewLabels = [];
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

    if (this.isEliminationMission) {
      applyEliminationArenaMap(this);
    }

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
    this.applyCombatEvent = (ev) => {
      // Apply baseline combat event (damage + visuals + death handling)
      const res = applyCombatEvent(this, ev);

      try {
        // STATUS HOOK: Cryo Shatter — next physical hit deals bonus physical damage then disappears.
        // We don't have explicit damage types per weapon yet, so we treat all attacks as physical for this hook
        // unless the event provides a damageType.
        const defender = ev && (ev.defenderId ? this.getAllRuntimeUnits().find(u => (u.id ?? u.unitId) === ev.defenderId) : null);
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

    // IMPORTANT:
    // Run an initial reset for the first active side so player units start with
    // valid MP/AP even if some spawn path or legacy field sync left runtime MP at 0.
    try {
      const allUnits = []
        .concat(this.units || [])
        .concat(this.players || [])
        .concat(this.enemies || []);

      for (const u of allUnits) {
        if (!u || u.isDead) continue;

        if (!Number.isFinite(u.mp) && Number.isFinite(u.movementPoints)) u.mp = u.movementPoints;
        if (!Number.isFinite(u.movementPoints) && Number.isFinite(u.mp)) u.movementPoints = u.mp;

        if (!Number.isFinite(u.mpMax) && Number.isFinite(u.maxMovementPoints)) u.mpMax = u.maxMovementPoints;
        if (!Number.isFinite(u.maxMovementPoints) && Number.isFinite(u.mpMax)) u.maxMovementPoints = u.mpMax;

        if (!Number.isFinite(u.movementPointsMax) && Number.isFinite(u.mpMax)) u.movementPointsMax = u.mpMax;
      }

      resetUnitsForNewTurn?.(this);
    } catch (e) {
      console.warn('[WORLD] Initial turn reset failed:', e);
    }

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
            .eq('code', this.roomCode)
            .single();

          if (res.error) throw res.error;

          const lobbyState = res.data?.state || this.lobbyState || {};
          const moves = Array.isArray(lobbyState.moves) ? lobbyState.moves.slice() : [];

          moves.push({
            playerName: this.playerName,
            unitId: unit.id ?? unit.unitId,
            q: unit.q,
            r: unit.r,
            ts: Date.now(),
          });

          const update = await this.supabase
            .from('lobbies')
            .update({ state: { ...lobbyState, moves } })
            .eq('code', this.roomCode);

          if (update.error) throw update.error;
        } catch (err) {
          console.warn('[SYNC] Failed to sync player move:', err);
        }
      };

      this.processRemoteMoves = () => {
        const moves = Array.isArray(this.lobbyState?.moves) ? this.lobbyState.moves : [];
        if (!moves.length) return;

        for (const mv of moves) {
          const allUnits = []
            .concat(this.units || [])
            .concat(this.players || [])
            .concat(this.enemies || [])
            .concat(this.haulers || [])
            .concat(this.ships || []);

          const u = allUnits.find(x => (x.id ?? x.unitId) === mv.unitId);
          if (!u) continue;

          u.q = mv.q;
          u.r = mv.r;

          const pos = this.axialToWorld(mv.q, mv.r);
          if (typeof u.setPosition === 'function') u.setPosition(pos.x, pos.y);
          else { u.x = pos.x; u.y = pos.y; }
        }

        // Clear queue locally after processing
        this.lobbyState.moves = [];
      };
    }
  }

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

  getHexesInRadius(q, r, radius) {
    const out = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const nq = q + dq;
        const nr = r + dr;
        if (nq < 0 || nr < 0 || nq >= this.mapWidth || nr >= this.mapHeight) continue;
        out.push({ q: nq, r: nr });
      }
    }
    return out;
  }

  /**
   * Run queued auto-moves for the active side.
   * This remains best-effort and deterministic because it only uses stored targets.
   */
  runAutoMovesForTurnOwner() {
    const owner = this.turnOwner;
    if (!owner) return;

    const allUnits = this.getAllRuntimeUnits()
      .filter(u => u && !u.isDead && !u.isEnemy && (u.playerName || u.name) === owner);

    for (const unit of allUnits) {
      if (!unit?.autoMove?.active || !unit.autoMove.target) continue;

      const target = unit.autoMove.target;
      if (unit.q === target.q && unit.r === target.r) {
        unit.autoMove.active = false;
        continue;
      }

      // We intentionally don't replicate A* here; movement execution is handled through UI pathing.
      // This hook is kept for future deterministic queued movement logic.
    }
  }

  placeAbilityHexEffect(q, r, effectId, opts = {}) {
    try {
      placeHexEffect(this, q, r, effectId, opts);
      this.redrawWorld?.();
    } catch (e) {
      console.warn('[WORLD] placeAbilityHexEffect failed', { q, r, effectId, opts }, e);
    }
  }

  removeAbilityHexEffect(q, r, effectId = null) {
    try {
      removeHexEffectsAt(this, q, r, effectId ? [effectId] : null);
      this.redrawWorld?.();
    } catch (e) {
      console.warn('[WORLD] removeAbilityHexEffect failed', { q, r, effectId }, e);
    }
  }

  getHexEffectsAt(q, r) {
    try {
      return findHexEffectsAt(this, q, r);
    } catch (e) {
      console.warn('[WORLD] getHexEffectsAt failed', { q, r }, e);
      return [];
    }
  }

  /**
   * Utility for direct cast from UI / controllers
   */
  castAbility(payload) {
    return this.queueAbilityCast(payload);
  }

  /**
   * Visual refresh placeholder (status icons / UI)
   */
  refreshUnitStatusIcons() {
    this.refreshUnitActionPanel?.();
  }

  drawPathPreview(within = [], beyond = []) {
    this.clearPathPreview();

    const drawLine = (path, color, alpha) => {
      if (!path || path.length < 2) return;
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

    drawLine(within, 0x00ffff, 0.95);
    drawLine(beyond, 0x8a8a8a, 0.85);

    const createTurnMarker = (hex, text, reachable = true) => {
      const { x, y } = this.axialToWorld(hex.q, hex.r);
      const label = this.add.text(x, y - 10, String(text), {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: reachable ? '#00ffff' : '#b0b0b0',
        fontStyle: 'bold',
        backgroundColor: 'rgba(0,0,0,0.35)',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5);
      label.setDepth(101);
      this.pathPreviewLabels.push(label);
    };

    if (within.length > 1) {
      createTurnMarker(within[within.length - 1], 1, true);
    }
    if (beyond.length > 1) {
      createTurnMarker(beyond[beyond.length - 1], 2, false);
    }
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
    if (!unit || !path || path.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    // Keep movement aliases in sync before we start tweening.
    if (!Number.isFinite(unit.mp) && Number.isFinite(unit.movementPoints)) unit.mp = unit.movementPoints;
    if (!Number.isFinite(unit.movementPoints) && Number.isFinite(unit.mp)) unit.movementPoints = unit.mp;
    if (!Number.isFinite(unit.mpMax) && Number.isFinite(unit.maxMovementPoints)) unit.mpMax = unit.maxMovementPoints;
    if (!Number.isFinite(unit.maxMovementPoints) && Number.isFinite(unit.mpMax)) unit.maxMovementPoints = unit.mpMax;
    if (!Number.isFinite(unit.movementPointsMax) && Number.isFinite(unit.mpMax)) unit.movementPointsMax = unit.mpMax;

    this.isUnitMoving = true;
    const scene = this;
    let index = 1;

    function finishMove() {
      scene.isUnitMoving = false;
      scene.updateSelectionHighlight?.();
      scene.refreshUnitActionPanel?.();
      if (onComplete) onComplete();
    }

    function stepNext() {
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
      } catch (e) {}

      const { x, y } = scene.axialToWorld(nextStep.q, nextStep.r);

      // Fallback for odd cases where the tween manager silently refuses a target.
      const moveInstantly = () => {
        if (typeof unit.setPosition === 'function') unit.setPosition(x, y);
        else {
          unit.x = x;
          unit.y = y;
        }

        unit.q = nextStep.q;
        unit.r = nextStep.r;

        if (unitHasEffect(unit, 'CorrosiveCorrosivebial') || unitHasEffect(unit, 'CORROSIVE_BIAL')) {
          const before = Number.isFinite(unit.hp) ? unit.hp : 0;
          const dmg = 2;
          unit.hp = Math.max(0, before - dmg);
          scene.refreshUnitActionPanel?.();
          if (typeof console !== 'undefined') {
            console.log('[STATUS] Corrosive bial move dmg', { unitId: unit.id, dmg, hpBefore: before, hpAfter: unit.hp });
          }
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
              if (typeof console !== 'undefined') {
                console.log('[STATUS] Corrosive bial move dmg', { unitId: unit.id, dmg, hpBefore: before, hpAfter: unit.hp });
              }
            }

            index += 1;
            stepNext();
          },
          onStop: moveInstantly,
        });
      } catch (e) {
        console.warn('[MOVE] Tween failed, using instant fallback:', e);
        moveInstantly();
      }
    }

    stepNext();
  }

  /**
   * Recompute water overlay from current worldWaterLevel.
   * This preserves original groundType in each tile and only changes visual/runtime walkability.
   */
  recomputeWaterFromLevel(opts = {}) {
    const lvl = Number.isFinite(this.worldWaterLevel) ? this.worldWaterLevel : 3;
    this.waterLevel = lvl;

    if (!Array.isArray(this.mapData)) return;

    for (const t of this.mapData) {
      if (!t) continue;

      if (!Number.isFinite(t.baseElevation)) {
        if (Number.isFinite(t.elevation)) t.baseElevation = t.elevation;
        else t.baseElevation = 0;
      }

      if (!t.groundType) {
        t.groundType = (t.type && t.type !== 'water') ? t.type : 'grassland';
      }

      const base = t.baseElevation;

      if (base <= lvl) {
        t.type = 'water';
        t.isUnderWater = true;
        t.isWater = true;
        t.isCoveredByWater = true;
        t.waterDepth = Math.max(1, lvl - base + 1);

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
  this.selectedHex = { q, r };
  this.selectedUnit = null;
  this.selectedBuilding = null;

  this.clearPathPreview?.();
  this.updateSelectionHighlight?.();

  if (typeof this.openHexInspectPanel === 'function') {
    this.openHexInspectPanel(q, r);
  }

  try {
    this.debugHex?.(q, r);
  } catch (_) {}
};
