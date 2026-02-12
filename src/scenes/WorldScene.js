// src/scenes/WorldScene.js

import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';

import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';
import { setupWorldMenus, attachSelectionHighlight } from './WorldSceneMenus.js';
import { setupUnitActionPanel } from './WorldSceneUnitPanel.js';
import { startHexTransformTool } from './HexTransformTool.js';
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
  endTurn as endTurnImpl,
  getNextPlayer as getNextPlayerImpl,
} from './WorldSceneWorldMeta.js';

// AI moved to units folder
import { moveEnemies as moveEnemiesImpl } from '../units/WorldSceneAI.js';

// ✅ NEW: ensure lore/POI exists before first draw
import { generateRuinLoreForTile } from './LoreGeneration.js';

// Abilities + Effects runtime (data-driven)
import { getAbilityDef } from '../abilities/AbilityDefs.js';
import {
  ensureHexEffectsState,
  ensureUnitEffectsState,
  addUnitEffect,
  placeHexEffect,
  tickUnitEffects,
  tickHexEffects,
  decrementUnitEffectDurations,
  decrementHexEffectDurations,
  cleanupExpiredUnitEffects,
  cleanupExpiredHexEffects,
  ensurePassiveEffects,
  hexKey as hexKeyEff,
} from '../effects/EffectEngine.js';
import { TICK_PHASE } from '../effects/EffectDefs.js';
import { ensureUnitCombatFields, canSpendAp, spendAp } from '../units/UnitActions.js';

/* ========================================================================
   Status icons (preload keys must match filenames in /assets/statuses)
   ======================================================================== */

export const STATUS_ICON_KEYS = [
  // Physical
  'PhysicalBleeding',
  'PhysicalArmorbreach',
  'PhysicalWeakspot',
  // Thermal
  'ThermalVolatileIgnition',
  'ThermalHeatStress',
  'ThermalBurning',
  // Toxic
  'ToxicIntoxication',
  'ToxicInterference',
  'ToxicToxiccloud',
  // Cryo
  'CryoBrittle',
  'CryoShatter',
  'CryoDeepfreeze',
  // Radiation
  'RadiationRadiationsickness',
  'RadiationIonization',
  'RadiationIrradiated',
  // Energy
  'EnergyElectrocution',
  'EnergySystemdamage',
  'EnergyShock',
  // Corrosive
  'CorrosionCorrosivebial',
  'CorrosionDeterioration',
  'CorrosionArmorDissolution',
];

function unitHasEffect(unit, effectId) {
  const arr = Array.isArray(unit?.effects) ? unit.effects : [];
  if (!arr.length) return false;
  const key = String(effectId || '').trim();
  if (!key) return false;
  return arr.some(e => e && (e.defId === key || e.defId === key.toUpperCase() || e.defId === key.toLowerCase()));
}

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
  const ships = scene.ships || [];
  return (
    units.find(u => u && u.q === q && u.r === r) ||
    players.find(u => u && u.q === q && u.r === r) ||
    enemies.find(e => e && e.q === q && e.r === r) ||
    haulers.find(h => h && h.q === q && h.r === r) ||
    ships.find(s => s && s.q === q && s.r === r) ||
    null
  );
}

function isControllable(u) {
  if (!u) return false;
  if (u.isDead) return false;
  if (u.isEnemy || u.controller === 'ai') return false;

  // canonical
  if (u.isPlayer) return true;

  // support objects without isPlayer (e.g., raiders/mobile base/etc.)
  if (Number.isFinite(u.mpMax) || Number.isFinite(u.mp) || Number.isFinite(u.movementPoints)) return true;

  return false;
}

function getOwnerName(scene, u) {
  if (!u) return null;

  // Most common
  if (typeof u.playerName === 'string' && u.playerName) return u.playerName;
  if (typeof u.ownerName === 'string' && u.ownerName) return u.ownerName;
  if (typeof u.owner === 'string' && u.owner) return u.owner;
  if (typeof u.faction === 'string' && u.faction) return u.faction;

  // Some units only have "name", but that might be a unit type.
  // We only use it as owner if it matches a known player or current turn owner.
  const n = (typeof u.name === 'string' && u.name) ? u.name : null;
  if (n && (n === scene.turnOwner || n === scene.playerName)) return n;

  // If it's a controllable object with no owner fields, assume it belongs to local player
  // (this fixes "raider/mobile base doesn't move on end turn" in singleplayer/local dev).
  if (isControllable(u) && scene?.playerName) return scene.playerName;

  return null;
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

  // NOTE: road movement advantage will be added later in Unit movement cost,
  // but road building itself is handled via lore + A* here.
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

/* ---------------------------
   ✅ Road application (Lore -> Tiles)
   --------------------------- */

function ensureRoadLinks(tile) {
  if (!tile) return;
  if (!(tile.roadLinks instanceof Set)) tile.roadLinks = new Set();
}

function roadKey(q, r) {
  return `${q},${r}`;
}

function applyRoadLinkBetween(a, b) {
  if (!a || !b) return;
  ensureRoadLinks(a);
  ensureRoadLinks(b);

  a.roadLinks.add(roadKey(b.q, b.r));
  b.roadLinks.add(roadKey(a.q, a.r));
  a.hasRoad = true;
  b.hasRoad = true;
}

function isMountainTile(tile) {
  if (!tile) return false;
  const type = String(tile.type || '').toLowerCase();
  const gt = String(tile.groundType || '').toLowerCase();
  if (type === 'mountain') return true;
  if (gt === 'mountain') return true;
  // legacy
  if (tile.elevation === 7 && type !== 'water') return true;
  return false;
}

function isRoadBlocked(tile) {
  if (!tile) return true;
  const type = String(tile.type || '').toLowerCase();
  if (type === 'water') return true;
  if (isMountainTile(tile)) return true;
  return false;
}

/**
 * Applies loreState.roadPlans onto mapData as:
 *  - tile.hasRoad = true
 *  - tile.roadLinks = Set("q,r")
 *
 * Safe to call multiple times (rebuilds from scratch).
 */
function applyRoadPlansToMap(scene) {
  const plans = scene?.loreState?.roadPlans;
  if (!Array.isArray(plans) || plans.length === 0) {
    // clear any stale roads if present
    if (Array.isArray(scene.mapData)) {
      for (const t of scene.mapData) {
        if (!t) continue;
        t.hasRoad = false;
        if (t.roadLinks instanceof Set) t.roadLinks.clear();
        else t.roadLinks = new Set();
      }
    }
    scene.__roadsAppliedFromLore = true;
    return;
  }

  if (!Array.isArray(scene.mapData) || scene.mapData.length === 0) return;

  // Clear current roads (authoritative rebuild from lore)
  for (const t of scene.mapData) {
    if (!t) continue;
    t.hasRoad = false;
    if (t.roadLinks instanceof Set) t.roadLinks.clear();
    else t.roadLinks = new Set();
  }

  const getT = (q, r) => (scene.mapData || []).find(h => h && h.q === q && h.r === r);

  // For each plan, carve a path using A*
  for (const rp of plans) {
    if (!rp || !rp.from || !rp.to) continue;
    const from = { q: rp.from.q, r: rp.from.r };
    const to = { q: rp.to.q, r: rp.to.r };

    if (!Number.isFinite(from.q) || !Number.isFinite(from.r)) continue;
    if (!Number.isFinite(to.q) || !Number.isFinite(to.r)) continue;

    const tA = getT(from.q, from.r);
    const tB = getT(to.q, to.r);
    if (!tA || !tB) continue;
    if (isRoadBlocked(tA) || isRoadBlocked(tB)) continue;

    const blockedPred = (tile) => isRoadBlocked(tile);

    let path = null;
    try {
      path = aStarFindPath(from, to, scene.mapData, blockedPred, { getMoveCost: stepMoveCost });
    } catch (e) {
      console.warn('[ROADS] A* failed for roadPlan:', rp, e);
      path = null;
    }

    if (!Array.isArray(path) || path.length < 2) continue;

    // Apply links along the path
    for (let i = 1; i < path.length; i++) {
      const p0 = path[i - 1];
      const p1 = path[i];
      const a = getT(p0.q, p0.r);
      const b = getT(p1.q, p1.r);
      if (!a || !b) break;
      if (isRoadBlocked(a) || isRoadBlocked(b)) break;
      applyRoadLinkBetween(a, b);
    }
  }

  scene.__roadsAppliedFromLore = true;
}

/* =========================================================
   Elimination mission: flat circular arena (no POI/resources/camps)
   ========================================================= */

function applyEliminationArenaMap(scene) {
  const w = scene.mapWidth;
  const h = scene.mapHeight;
  if (!Array.isArray(scene.mapData) || scene.mapData.length === 0) return;

  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const radius = Math.floor(Math.min(w, h) * 0.42); // ~12 for 29x29

  const isInside = (q, r) => {
    const dx = q - cx;
    const dy = r - cy;
    // Euclidean works fine for a "round" arena in axial coords
    return Math.sqrt(dx*dx + dy*dy) <= radius;
  };

  for (const t of scene.mapData) {
    if (!t) continue;

    // wipe world clutter flags
    t.hasForest = false;
    t.forestDensity = 0;
    t.hasRoad = false;
    if (t.roadLinks instanceof Set) t.roadLinks.clear();

    // clear any lore / POI markers so drawLocations doesn't render anything
    t.poi = null;
    t.poiType = null;
    t.poiEmoji = null;
    t.ruin = null;
    t.city = null;
    t.camp = null;
    t.location = null;

    if (isInside(t.q, t.r)) {
      // Flat land
      t.type = 'grassland';
      t.groundType = 'grassland';
      t.baseElevation = 4;
      t.elevation = 4;
      t.visualElevation = 1;
      t.isWater = false;
      t.isUnderWater = false;
      t.isCoveredByWater = false;
      t.waterDepth = 0;
    } else {
      // Water outside arena
      t.type = 'water';
      t.groundType = 'water';
      t.baseElevation = 1;
      t.elevation = 1;
      t.visualElevation = 0;
      t.isWater = true;
      t.isUnderWater = true;
      t.isCoveredByWater = true;
      t.waterDepth = 1;
    }
  }

  // Ensure any mapInfo objects (geos, POI props) are removed
  if (scene.mapInfo && Array.isArray(scene.mapInfo.objects)) scene.mapInfo.objects = [];
  if (scene.hexMap) scene.hexMap.objects = [];

  // Disable lore-driven systems for this mission
  scene.__worldLoreGenerated = true;
  scene.__roadsAppliedFromLore = true;
  scene.loreState = scene.loreState || {};
  scene.loreState.roadPlans = [];

  console.log(`[MISSION] Elimination arena applied: radius=${radius} (${w}x${h})`);
}

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {
    // Preload status effect icons (for the unit panel status row)
    // Expected path in repo: /assets/ui/unit_panel/statuses/<Key>.png
    // (If you later change extension, adjust here.)
    try {
      for (const k of STATUS_ICON_KEYS) {
        if (this.textures && this.textures.exists && this.textures.exists(k)) continue;
        this.load.image(k, `assets/ui/unit_panel/statuses/${k}.png`);
      }
    } catch (e) {
      console.warn('[PRELOAD] status icons failed:', e);
    }
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
    if (!this.lobbyState) this.lobbyState = {};
    ensureHexEffectsState(this.lobbyState);

    // Ensure every existing unit has an effects array
    for (const u of this.getAllRuntimeUnits()) {
      ensureUnitEffectsState(u);
      ensureUnitCombatFields(u);
    }

    // Apply passive abilities as infinite-duration effects (if unit defines passives)
    // Convention: unit.passives = ['thick_plating', ...] (AbilityDefs ids)
    for (const u of this.getAllRuntimeUnits()) {
      try {
        ensurePassiveEffects(u, getAbilityDef);
      } catch (e) {
        console.warn('[EFF] ensurePassiveEffects failed:', u?.id, e);
      }
    }

    if (typeof window !== 'undefined') {
      // Toggle at runtime: window.__TRACE_EFF__ = true/false
      // Toggle at runtime: window.__TRACE_ABIL__ = true/false
      if (window.__TRACE_ABIL__ === undefined) window.__TRACE_ABIL__ = true;
    }
  }

  getAllRuntimeUnits() {
    // Keep this central so effects + AI + UI all use the same source of truth.
    // Include everything that can have HP/effects: players + enemies + units + haulers + ships.
    const all = []
      .concat(this.players || [])
      .concat(this.enemies || [])
      .concat(this.units || [])
      .concat(this.haulers || [])
      .concat(this.ships || []);

    // De-dupe by id if possible
    const out = [];
    const seen = new Set();
    for (const u of all) {
      if (!u) continue;
      const id = u.id ?? u.unitId ?? null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(u);
    }
    return out;
  }

  traceAbility(tag, data) {
    const on = (typeof window !== 'undefined') ? (window.__TRACE_ABIL__ ?? true) : true;
    if (!on) return;
    try { console.log(`[ABIL:${tag}]`, data); } catch (_) {}
  }

  runEffectPhase(phase) {
    // Phase: TICK_PHASE.TURN_START or TICK_PHASE.TURN_END
    const allUnits = this.getAllRuntimeUnits();
    const ctx = {
      turnOwner: this.turnOwner,
      turnNumber: this.turnNumber,
      roomCode: this.roomCode,
    };

    // Unit effects
    for (const u of allUnits) {
      try {
        ensureUnitEffectsState(u);
        tickUnitEffects(u, phase, ctx);
      } catch (e) {
        console.warn('[EFF] tickUnitEffects failed:', u?.id, phase, e);
      }
    }

    // Hex effects
    try {
      ensureHexEffectsState(this.lobbyState);
      tickHexEffects(this.lobbyState, allUnits, phase, ctx);
    } catch (e) {
      console.warn('[EFF] tickHexEffects failed:', phase, e);
    }
  }

  advanceEffectsOnTurnEnd() {
    // Decrement durations and cleanup after TURN_END tick.
    const allUnits = this.getAllRuntimeUnits();

    for (const u of allUnits) {
      try {
        decrementUnitEffectDurations(u);
        cleanupExpiredUnitEffects(u);
      } catch (e) {
        console.warn('[EFF] unit cleanup failed:', u?.id, e);
      }
    }

    try {
      ensureHexEffectsState(this.lobbyState);
      decrementHexEffectDurations(this.lobbyState);
      cleanupExpiredHexEffects(this.lobbyState);
    } catch (e) {
      console.warn('[EFF] hex cleanup failed:', e);
    }
  }

  /* ------------------------------------------------------------------------
     Ability casting (local runtime helper)
     - In multiplayer, host should turn this into an event and broadcast it.
     - This helper is still useful for local dev and for host-side resolution.
     ------------------------------------------------------------------------ */

  /**
   * Cast an ability from a unit.
   * @param {any} caster
   * @param {string} abilityId
   * @param {{targetUnit?: any, targetHex?: {q:number,r:number}}} target
   */
  castAbility(caster, abilityId, target = {}) {
    const a = getAbilityDef(abilityId);
    if (!a || a.kind !== 'active') {
      this.traceAbility('fail:bad_ability', { abilityId, casterId: caster?.id });
      return { ok: false, reason: 'bad_ability' };
    }

    ensureUnitCombatFields(caster);
    ensureUnitEffectsState(caster);

    // STATUS HOOK: Shock blocks active ability use
    // (Effect id should match your EffectDefs; we accept both exact and icon-key forms.)
    if (unitHasEffect(caster, 'EnergyShock') || unitHasEffect(caster, 'ENERGY_SHOCK')) {
      this.traceAbility('fail:shocked', { abilityId, casterId: caster?.id });
      return { ok: false, reason: 'shocked' };
    }

    const apCost = Number.isFinite(a.active?.apCost) ? a.active.apCost : 1;
    if (!canSpendAp(caster, apCost)) {
      this.traceAbility('fail:no_ap', { abilityId, casterId: caster?.id, ap: caster?.ap, apCost });
      return { ok: false, reason: 'no_ap' };
    }

    // Target resolution (minimal, no LoS for now)
    const resolved = this.resolveAbilityTarget(a, caster, target);
    if (!resolved.ok) {
      this.traceAbility('fail:bad_target', { abilityId, casterId: caster?.id, ...resolved });
      return resolved;
    }

    // Spend AP
    spendAp(caster, apCost);

    // STATUS HOOK: Volatile Ignition — taking thermal damage when using an ability
    // Table: "If unit uses an ability, it take Thermal damage of 4"
    if (unitHasEffect(caster, 'ThermalVolatileIgnition') || unitHasEffect(caster, 'THERMAL_VOLATILE_IGNITION')) {
      const before = Number.isFinite(caster.hp) ? caster.hp : 0;
      const dmg = 4;
      caster.hp = Math.max(0, before - dmg);
      this.traceAbility('status:volatile_ignition', { casterId: caster?.id, hpBefore: before, hpAfter: caster.hp, dmg });
    }

    // Apply unit effects
    const applied = [];
    const unitSpecs = Array.isArray(a.active?.applyUnitEffects) ? a.active.applyUnitEffects : [];
    for (const spec of unitSpecs) {
      const dest = (spec.applyTo === 'self') ? caster : resolved.targetUnit;
      if (!dest) continue;
      ensureUnitEffectsState(dest);

      addUnitEffect(dest, spec.effectId, {
        duration: spec.duration,
        stacks: spec.stacks,
        params: spec.params,
        sourceUnitId: caster.id,
        sourceFaction: caster.faction,
      });
      applied.push({ to: dest.id, effectId: spec.effectId });
    }

    // Place hex effects
    const placed = [];
    const hexSpecs = Array.isArray(a.active?.placeHexEffects) ? a.active.placeHexEffects : [];
    for (const spec of hexSpecs) {
      const centers = (spec.placeOn === 'aoe' && Number.isFinite(a.active?.aoeRadius))
        ? this.getHexesInRadius(resolved.targetHex.q, resolved.targetHex.r, a.active.aoeRadius)
        : [resolved.targetHex];

      for (const h of centers) {
        placeHexEffect(this.lobbyState, h.q, h.r, spec.effectId, {
          duration: spec.duration,
          stacks: spec.stacks,
          params: spec.params,
          sourceUnitId: caster.id,
          sourceFaction: caster.faction,
        });
        placed.push({ q: h.q, r: h.r, effectId: spec.effectId });
      }
    }

    this.traceAbility('cast', {
      abilityId: a.id,
      casterId: caster.id,
      apAfter: caster.ap,
      applied,
      placed,
    });

    return { ok: true, applied, placed };
  }

  resolveAbilityTarget(abilityDef, caster, target) {
    const t = abilityDef?.active?.target;

    if (t === 'self') {
      return { ok: true, targetUnit: caster, targetHex: { q: caster.q, r: caster.r } };
    }

    if (t === 'unit') {
      const tu = target?.targetUnit || null;
      if (!tu || !Number.isFinite(tu.q) || !Number.isFinite(tu.r)) return { ok: false, reason: 'no_target_unit' };
      return { ok: true, targetUnit: tu, targetHex: { q: tu.q, r: tu.r } };
    }

    // hex / hex_aoe
    const th = target?.targetHex || null;
    if (!th || !Number.isFinite(th.q) || !Number.isFinite(th.r)) return { ok: false, reason: 'no_target_hex' };
    return { ok: true, targetUnit: null, targetHex: { q: th.q, r: th.r } };
  }

  // Axial distance helpers (odd-r layout already used elsewhere; distance is axial-cube)
  hexDistance(q1, r1, q2, r2) {
    const dq = q2 - q1;
    const dr = r2 - r1;
    const ds = -dq - dr;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
  }

  getHexesInRadius(cq, cr, radius) {
    const out = [];
    const r = Math.max(0, Math.trunc(radius));
    for (let dq = -r; dq <= r; dq++) {
      for (let dr = Math.max(-r, -dq - r); dr <= Math.min(r, -dq + r); dr++) {
        const q = cq + dq;
        const rr = cr + dr;
        out.push({ q, r: rr });
      }
    }
    return out;
  }

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

    const { seed, playerName, roomCode, isHost, supabase, lobbyState, missionType } =
      this.scene.settings.data || {};

    this.seed = seed || '000000';
    this.playerName = playerName || 'Player';
    this.roomCode = roomCode || this.seed;

    // local/dev: if not provided, act as host so AI runs.
    this.isHost = (typeof isHost === 'undefined') ? true : !!isHost;

    this.supabase = supabase || sharedSupabase || null;
    this.lobbyState = lobbyState || { units: {}, enemies: [] };

    // Mission type affects map generation/spawns
    this.missionType = missionType || this.lobbyState?.missionType || 'big_construction';
    this.isEliminationMission = (this.missionType === 'elimination');

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
