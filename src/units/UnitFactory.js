// src/units/UnitFactory.js
//
// Creates runtime unit state objects from UnitDefs.
// Also provides helpers to "decorate" existing Phaser unit objects
// with canonical stats (while preserving legacy fields).

import { getUnitDef } from './UnitDefs.js';

let _seq = 1;

/**
 * @typedef {'player'|'ai'} UnitController
 */

/**
 * @typedef {Record<string, number>} ResistMapRuntime
 * Runtime resist map (percent points). Keys match DamageType in UnitDefs:
 * physical, thermal, toxic, cryo, radiation, energy, corrosion
 */

/**
 * @typedef UnitState
 * @property {string} id
 * @property {string} type
 * @property {string|null} ownerId
 * @property {number|null} ownerSlot
 * @property {UnitController} controller
 * @property {string} faction
 * @property {number} q
 * @property {number} r
 * @property {number} facing
 *
 * @property {number} level
 *
 * @property {number} hp
 * @property {number} hpMax
 *
 * @property {number} armorPoints
 * @property {'NONE'|'LIGHT'|'MEDIUM'|'HEAVY'} armorClass
 *
 * @property {number} mp
 * @property {number} mpMax
 * @property {number} ap
 * @property {number} apMax
 *
 * @property {number} vision
 * @property {number} visionMax
 *
 * @property {number} groupSize
 * @property {number} groupAlive
 *
 * @property {number} morale
 * @property {number} moraleMax
 *
 * @property {ResistMapRuntime} resists
 *
 * @property {string[]} weapons
 * @property {number} activeWeaponIndex
 *
 * @property {string[]} activeAbilities
 * @property {string[]} passiveAbilities
 *
 * @property {any[]} effects
 * @property {any[]} statuses
 *
 * @property {{defending?: boolean}} status
 */

/**
 * Fill any missing resist keys with 0.
 * @param {any} input
 * @returns {ResistMapRuntime}
 */
function normalizeResists(input) {
  const src = (input && typeof input === 'object') ? input : {};
  return {
    physical: Number.isFinite(src.physical) ? src.physical : 0,
    thermal: Number.isFinite(src.thermal) ? src.thermal : 0,
    toxic: Number.isFinite(src.toxic) ? src.toxic : 0,
    cryo: Number.isFinite(src.cryo) ? src.cryo : 0,
    radiation: Number.isFinite(src.radiation) ? src.radiation : 0,
    energy: Number.isFinite(src.energy) ? src.energy : 0,
    corrosion: Number.isFinite(src.corrosion) ? src.corrosion : 0,
  };
}

/**
 * Create a pure runtime state object.
 * @param {object} opts
 * @param {string} opts.type
 * @param {string|null} [opts.ownerId]
 * @param {number|null} [opts.ownerSlot]
 * @param {'player'|'ai'} [opts.controller]
 * @param {string} [opts.faction]
 * @param {number} opts.q
 * @param {number} opts.r
 * @param {number} [opts.facing]
 * @returns {UnitState}
 */
export function createUnitState(opts) {
  const def = getUnitDef(opts.type);
  const id = `u${_seq++}`;

  const weapons = Array.isArray(def.weapons) ? def.weapons.slice() : [];
  const activeAbilities = Array.isArray(def.activeAbilities) ? def.activeAbilities.slice() : [];
  const passiveAbilities = Array.isArray(def.passiveAbilities) ? def.passiveAbilities.slice() : [];

  const groupSize = Number.isFinite(def.groupSize) ? def.groupSize : 1;
  const moraleMax = Number.isFinite(def.moraleMax) ? def.moraleMax : 0;

  const visionMax = Number.isFinite(def.visionMax)
    ? def.visionMax
    : (Number.isFinite(def.vision) ? def.vision : 4);

  return {
    id,
    type: def.id,
    ownerId: opts.ownerId ?? null,
    ownerSlot: opts.ownerSlot ?? null,
    controller: opts.controller || 'player',
    faction: opts.faction ?? (opts.controller === 'ai' ? 'raiders' : `player${opts.ownerSlot ?? 0}`),

    q: opts.q,
    r: opts.r,
    facing: Number.isFinite(opts.facing) ? opts.facing : 0,

    // Meta progression
    level: 1,

    // Core stats
    hpMax: def.hpMax,
    hp: def.hpMax,
    armorPoints: def.armorPoints,
    armorClass: def.armorClass,

    mpMax: def.mpMax,
    mp: def.mpMax,
    apMax: def.apMax,
    ap: def.apMax,

    // Vision (used by fog-of-war and ability range in future)
    visionMax,
    vision: visionMax,

    // Squad stats
    groupSize,
    groupAlive: groupSize,

    // Morale
    moraleMax,
    morale: moraleMax, // currently 0 for all (per your rules)

    // Resists
    resists: normalizeResists(def.resists),

    // Weapons + abilities
    weapons,
    activeWeaponIndex: 0,

    activeAbilities,
    passiveAbilities,

    // Effects array is managed by EffectEngine; keep it on unit for runtime.
    effects: [],

    // Statuses (buff/debuff icons in UI). Engine will enforce max 10 later.
    statuses: [],

    // Lightweight flags used by UI/actions (legacy safe)
    status: {},
  };
}

/**
 * Decorate an existing Phaser unit object (circle/triangle/sprite) with
 * canonical fields, WITHOUT removing legacy fields used elsewhere.
 *
 * This keeps compatibility with current code that expects:
 *  - movementPoints / maxMovementPoints
 *  - hp / maxHp
 *
 * @param {any} phaserUnit
 * @param {UnitState} state
 */
export function applyUnitStateToPhaserUnit(phaserUnit, state) {
  if (!phaserUnit || !state) return;

  // Canonical identity
  phaserUnit.unitId = state.id;
  phaserUnit.unitType = state.type;
  phaserUnit.ownerId = state.ownerId;
  phaserUnit.ownerSlot = state.ownerSlot;
  phaserUnit.controller = state.controller;
  phaserUnit.faction = state.faction;

  // Mirror id for systems that look at `unit.id`
  if (!phaserUnit.id) phaserUnit.id = state.id;

  phaserUnit.facing = state.facing;

  // Progression
  phaserUnit.level = state.level;

  // Core stats
  phaserUnit.hp = state.hp;
  phaserUnit.maxHp = state.hpMax;
  phaserUnit.armorPoints = state.armorPoints;
  phaserUnit.armorClass = state.armorClass;

  phaserUnit.mp = state.mp;
  phaserUnit.mpMax = state.mpMax;
  phaserUnit.ap = state.ap;
  phaserUnit.apMax = state.apMax;

  phaserUnit.vision = state.vision;
  phaserUnit.visionMax = state.visionMax;

  // Squad stats
  phaserUnit.groupSize = state.groupSize;
  phaserUnit.groupAlive = state.groupAlive;

  // Morale
  phaserUnit.moraleMax = state.moraleMax;
  phaserUnit.morale = state.morale;

  // Resists
  phaserUnit.resists = state.resists;

  // Weapons + abilities
  phaserUnit.weapons = state.weapons;
  phaserUnit.activeWeaponIndex = state.activeWeaponIndex;

  phaserUnit.activeAbilities = state.activeAbilities;
  phaserUnit.passiveAbilities = state.passiveAbilities;

  // Effects array is managed by EffectEngine; keep it on unit for runtime.
  if (!Array.isArray(phaserUnit.effects)) phaserUnit.effects = state.effects || [];

  // Status list (buff/debuff icons)
  if (!Array.isArray(phaserUnit.statuses)) phaserUnit.statuses = state.statuses || [];

  // Legacy lightweight flags object
  phaserUnit.status = state.status;

  // Legacy compatibility
  phaserUnit.movementPoints = state.mp;
  phaserUnit.maxMovementPoints = state.mpMax;
}

/**
 * Re-sync runtime fields after movement/turn updates.
 * @param {any} phaserUnit
 */
export function syncLegacyMovementFields(phaserUnit) {
  if (!phaserUnit) return;
  if (Number.isFinite(phaserUnit.mp)) {
    phaserUnit.movementPoints = phaserUnit.mp;
  }
  if (Number.isFinite(phaserUnit.mpMax)) {
    phaserUnit.maxMovementPoints = phaserUnit.mpMax;
  }
}
