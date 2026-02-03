// src/effects/EffectDefs.js
//
// Data-driven effect definitions for BOTH unit effects and hex effects.
// No Phaser imports.
//
// This version is generated to match the "status effects" table.
// Icon keys are expected to be loaded as textures with the SAME key as effect id,
// e.g. `PhysicalBleeding`, `ThermalBurning`, etc.
//
// Engine responsibilities (EffectEngine):
// - stacking, durations, ticks (turnStart/turnEnd)
// - modifiers: armor/range/mp/ap and per-damage-type taken/dealt deltas
// - hooks: onAbilityUse, onMoveStep, onDeath, nextHitBonus, cannotHeal, cannotUseAbilities
//

export const EFFECT_KINDS = Object.freeze({
  UNIT: 'unit',
  HEX: 'hex',
});

export const STACKING = Object.freeze({
  REFRESH: 'refresh',
  STACK: 'stack',
  IGNORE: 'ignore',
});

// For tick timing
export const TICK_PHASE = Object.freeze({
  TURN_START: 'turnStart',
  TURN_END: 'turnEnd',
});

// Damage types used by statuses table
export const DAMAGE_TYPES = Object.freeze({
  PHYSICAL: 'physical',
  THERMAL: 'thermal',
  TOXIC: 'toxic',
  CRYO: 'cryo',
  RADIATION: 'radiation',
  ENERGY: 'energy',
  CORROSIVE: 'corrosive',
});

// Supported modifier stats (expandable)
export const MOD_STATS = Object.freeze({
  ARMOR: 'armor',                       // +N armor points (effective)
  VISION: 'vision',                     // +N vision
  MP_DELTA: 'mpDelta',                  // add directly to current MP at phase (hook)
  AP_DELTA: 'apDelta',                  // add directly to current AP at phase (hook)
  RANGE: 'range',                       // +N range (max range) unless engine decides otherwise
  DAMAGE_DEALT_PCT: 'damageDealtPct',   // +% dealt (per damage type optional)
  DAMAGE_TAKEN_PCT: 'damageTakenPct',   // +% taken (per damage type optional)
  DAMAGE_TAKEN_FLAT: 'damageTakenFlat', // +N flat taken (per damage type optional)
  HEALING_RECEIVED_PCT: 'healingReceivedPct', // +% healing received (negative => reduced)
});

// Supported tick action types
export const TICK_ACTIONS = Object.freeze({
  DOT: 'dot',           // damage over time
  REGEN: 'regen',       // heal over time
  STAT_DELTA: 'statDelta', // immediate MP/AP adjust at phase (Deep freeze)
});

/**
 * @typedef {object} ModifierDef
 * @property {string} stat
 * @property {'add'} op
 * @property {number} value
 * @property {string} [damageType]              - optional: limits to a damage type
 * @property {object} [when]                    - optional conditions (engine-side)
 */

/**
 * @typedef {object} TickDef
 * @property {'turnStart'|'turnEnd'} phase
 * @property {'dot'|'regen'|'statDelta'} type
 * @property {number} [amount]                  - dot/regen
 * @property {string} [damageType]              - dot: one of DAMAGE_TYPES
 * @property {number} [mpDelta]                 - statDelta
 * @property {number} [apDelta]                 - statDelta
 */

/**
 * @typedef {object} EffectDef
 * @property {string} id
 * @property {'unit'|'hex'} kind
 * @property {string} name
 * @property {string} icon                       - texture key hint (same as id)
 * @property {string} description
 * @property {number} baseDuration               - duration in turns (0 => infinite)
 * @property {'refresh'|'stack'|'ignore'} stacking
 * @property {number} [maxStacks]
 * @property {object} [baseParams]               - behavior hooks for engine
 * @property {ModifierDef[]} [modifiers]
 * @property {TickDef[]} [ticks]
 */

export const EFFECT_IDS = Object.freeze({
  // ===== Physical
  PhysicalBleeding: 'PhysicalBleeding',
  PhysicalArmorbreach: 'PhysicalArmorbreach',
  PhysicalWeakspot: 'PhysicalWeakspot',

  // ===== Thermal
  ThermalVolatileIgnition: 'ThermalVolatileIgnition',
  ThermalHeatStress: 'ThermalHeatStress',
  ThermalBurning: 'ThermalBurning',

  // ===== Toxic
  ToxicIntoxication: 'ToxicIntoxication',
  ToxicInterference: 'ToxicInterference',
  ToxicToxiccloud: 'ToxicToxiccloud',

  // ===== Cryo
  CryoBrittle: 'CryoBrittle',
  CryoShatter: 'CryoShatter',
  CryoDeepfreeze: 'CryoDeepfreeze',

  // ===== Radiation
  RadiationRadiationsickness: 'RadiationRadiationsickness',
  RadiationIonization: 'RadiationIonization',
  RadiationIrradiated: 'RadiationIrradiated',

  // ===== Energy
  EnergyElectrocution: 'EnergyElectrocution',
  EnergySystemdamage: 'EnergySystemdamage',
  EnergyShock: 'EnergyShock',

  // ===== Corrosive
  CorrosiveCorrosivebial: 'CorrosiveCorrosivebial',
  CorrosiveDeterioration: 'CorrosiveDeterioration',
  CorrosiveArmorDissolution: 'CorrosiveArmorDissolution',

  // Table references this as separate status
  MutantStress: 'MutantStress',
});

/** Helper: short description builder */
function desc(lines) {
  return Array.isArray(lines) ? lines.join(' ') : String(lines || '');
}

/** @type {Record<string, EffectDef>} */
export const EFFECTS = Object.freeze({
  /* =========================================================================
     UNIT STATUS EFFECTS (from table)
     ========================================================================= */

  // -------------------------
  // Physical
  // -------------------------

  [EFFECT_IDS.PhysicalBleeding]: {
    id: EFFECT_IDS.PhysicalBleeding,
    kind: EFFECT_KINDS.UNIT,
    name: 'Bleeding',
    icon: EFFECT_IDS.PhysicalBleeding,
    description: desc(['At the start of the turn unit takes Physical damage.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { damageType: DAMAGE_TYPES.PHYSICAL },
    ticks: [
      { phase: TICK_PHASE.TURN_START, type: TICK_ACTIONS.DOT, amount: 2, damageType: DAMAGE_TYPES.PHYSICAL },
    ],
  },

  [EFFECT_IDS.PhysicalArmorbreach]: {
    id: EFFECT_IDS.PhysicalArmorbreach,
    kind: EFFECT_KINDS.UNIT,
    name: 'Armor breach',
    icon: EFFECT_IDS.PhysicalArmorbreach,
    description: desc(['Reduces unit armor points.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.ARMOR, op: 'add', value: -2 },
    ],
  },

  [EFFECT_IDS.PhysicalWeakspot]: {
    id: EFFECT_IDS.PhysicalWeakspot,
    kind: EFFECT_KINDS.UNIT,
    name: 'Weak spot',
    icon: EFFECT_IDS.PhysicalWeakspot,
    description: desc(['Increases Physical damage taken.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.DAMAGE_TAKEN_FLAT, op: 'add', value: 1, damageType: DAMAGE_TYPES.PHYSICAL },
    ],
  },

  // -------------------------
  // Thermal
  // -------------------------

  [EFFECT_IDS.ThermalVolatileIgnition]: {
    id: EFFECT_IDS.ThermalVolatileIgnition,
    kind: EFFECT_KINDS.UNIT,
    name: 'Volatile Ignition',
    icon: EFFECT_IDS.ThermalVolatileIgnition,
    description: desc(['If unit uses an ability, it takes Thermal damage.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: {
      onAbilityUse: { type: 'damage', amount: 4, damageType: DAMAGE_TYPES.THERMAL },
    },
  },

  [EFFECT_IDS.ThermalHeatStress]: {
    id: EFFECT_IDS.ThermalHeatStress,
    kind: EFFECT_KINDS.UNIT,
    name: 'Heat Stress',
    icon: EFFECT_IDS.ThermalHeatStress,
    description: desc(['Increases Thermal damage taken by % .']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.DAMAGE_TAKEN_PCT, op: 'add', value: 15, damageType: DAMAGE_TYPES.THERMAL },
    ],
  },

  [EFFECT_IDS.ThermalBurning]: {
    id: EFFECT_IDS.ThermalBurning,
    kind: EFFECT_KINDS.UNIT,
    name: 'Burning',
    icon: EFFECT_IDS.ThermalBurning,
    description: desc(['At the start of the turn unit takes Thermal damage.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { damageType: DAMAGE_TYPES.THERMAL },
    ticks: [
      { phase: TICK_PHASE.TURN_START, type: TICK_ACTIONS.DOT, amount: 2, damageType: DAMAGE_TYPES.THERMAL },
    ],
  },

  // -------------------------
  // Toxic
  // -------------------------

  [EFFECT_IDS.ToxicIntoxication]: {
    id: EFFECT_IDS.ToxicIntoxication,
    kind: EFFECT_KINDS.UNIT,
    name: 'Intoxication',
    icon: EFFECT_IDS.ToxicIntoxication,
    description: desc(['At the start of the turn unit takes Toxic damage.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { damageType: DAMAGE_TYPES.TOXIC },
    ticks: [
      { phase: TICK_PHASE.TURN_START, type: TICK_ACTIONS.DOT, amount: 2, damageType: DAMAGE_TYPES.TOXIC },
    ],
  },

  [EFFECT_IDS.ToxicInterference]: {
    id: EFFECT_IDS.ToxicInterference,
    kind: EFFECT_KINDS.UNIT,
    name: 'Interference',
    icon: EFFECT_IDS.ToxicInterference,
    description: desc(['Reduces attack range (does not work for melee).']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { rangeNotForMelee: true },
    modifiers: [
      { stat: MOD_STATS.RANGE, op: 'add', value: -1, when: { notMelee: true } },
    ],
  },

  [EFFECT_IDS.ToxicToxiccloud]: {
    id: EFFECT_IDS.ToxicToxiccloud,
    kind: EFFECT_KINDS.UNIT,
    name: 'Toxic cloud',
    icon: EFFECT_IDS.ToxicToxiccloud,
    description: desc(['Unit cannot be healed or repaired.']),
    baseDuration: 1,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { cannotHeal: true },
  },

  // -------------------------
  // Cryo
  // -------------------------

  [EFFECT_IDS.CryoBrittle]: {
    id: EFFECT_IDS.CryoBrittle,
    kind: EFFECT_KINDS.UNIT,
    name: 'Brittle',
    icon: EFFECT_IDS.CryoBrittle,
    description: desc(['Increases Cryo damage taken by %.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.DAMAGE_TAKEN_PCT, op: 'add', value: 15, damageType: DAMAGE_TYPES.CRYO },
    ],
  },

  [EFFECT_IDS.CryoShatter]: {
    id: EFFECT_IDS.CryoShatter,
    kind: EFFECT_KINDS.UNIT,
    name: 'Shatter',
    icon: EFFECT_IDS.CryoShatter,
    description: desc(['Next physical hit deals bonus Physical damage, then debuff disappears.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: {
      nextHitBonus: { amount: 4, damageType: DAMAGE_TYPES.PHYSICAL, consume: true },
    },
  },

  [EFFECT_IDS.CryoDeepfreeze]: {
    id: EFFECT_IDS.CryoDeepfreeze,
    kind: EFFECT_KINDS.UNIT,
    name: 'Deep freeze',
    icon: EFFECT_IDS.CryoDeepfreeze,
    description: desc(['Decreases MP and AP by 1.']),
    baseDuration: 1,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    ticks: [
      { phase: TICK_PHASE.TURN_START, type: TICK_ACTIONS.STAT_DELTA, mpDelta: -1, apDelta: -1 },
    ],
  },

  // -------------------------
  // Radiation
  // -------------------------

  [EFFECT_IDS.RadiationRadiationsickness]: {
    id: EFFECT_IDS.RadiationRadiationsickness,
    kind: EFFECT_KINDS.UNIT,
    name: 'Radiation sickness',
    icon: EFFECT_IDS.RadiationRadiationsickness,
    description: desc(['Healing received is reduced by %.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.HEALING_RECEIVED_PCT, op: 'add', value: -50 },
    ],
  },

  [EFFECT_IDS.RadiationIonization]: {
    id: EFFECT_IDS.RadiationIonization,
    kind: EFFECT_KINDS.UNIT,
    name: 'Ionization',
    icon: EFFECT_IDS.RadiationIonization,
    description: desc(['At the start of the turn unit takes Radiation damage.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { damageType: DAMAGE_TYPES.RADIATION },
    ticks: [
      { phase: TICK_PHASE.TURN_START, type: TICK_ACTIONS.DOT, amount: 2, damageType: DAMAGE_TYPES.RADIATION },
    ],
  },

  [EFFECT_IDS.RadiationIrradiated]: {
    id: EFFECT_IDS.RadiationIrradiated,
    kind: EFFECT_KINDS.UNIT,
    name: 'Irradiated',
    icon: EFFECT_IDS.RadiationIrradiated,
    description: desc(['On death, apply "Mutant stress" and "Irradiated" to adjacent units.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: {
      onDeathApplyAdjacent: [
        { effectId: EFFECT_IDS.MutantStress, duration: 2, stacks: 1 },
        { effectId: EFFECT_IDS.RadiationIrradiated, duration: 2, stacks: 1 },
      ],
    },
  },

  // -------------------------
  // Energy
  // -------------------------

  [EFFECT_IDS.EnergyElectrocution]: {
    id: EFFECT_IDS.EnergyElectrocution,
    kind: EFFECT_KINDS.UNIT,
    name: 'Electrocution',
    icon: EFFECT_IDS.EnergyElectrocution,
    description: desc(['Increases Thermal damage taken by %.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.DAMAGE_TAKEN_PCT, op: 'add', value: 15, damageType: DAMAGE_TYPES.THERMAL },
    ],
  },

  [EFFECT_IDS.EnergySystemdamage]: {
    id: EFFECT_IDS.EnergySystemdamage,
    kind: EFFECT_KINDS.UNIT,
    name: 'System damage',
    icon: EFFECT_IDS.EnergySystemdamage,
    description: desc(['At the start of the turn unit takes Energy damage.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { damageType: DAMAGE_TYPES.ENERGY },
    ticks: [
      { phase: TICK_PHASE.TURN_START, type: TICK_ACTIONS.DOT, amount: 2, damageType: DAMAGE_TYPES.ENERGY },
    ],
  },

  [EFFECT_IDS.EnergyShock]: {
    id: EFFECT_IDS.EnergyShock,
    kind: EFFECT_KINDS.UNIT,
    name: 'Shock',
    icon: EFFECT_IDS.EnergyShock,
    description: desc(['Unit cannot use abilities.']),
    baseDuration: 1,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { cannotUseAbilities: true },
  },

  // -------------------------
  // Corrosive
  // -------------------------

  [EFFECT_IDS.CorrosiveCorrosivebial]: {
    id: EFFECT_IDS.CorrosiveCorrosivebial,
    kind: EFFECT_KINDS.UNIT,
    name: 'Corrosive bial',
    icon: EFFECT_IDS.CorrosiveCorrosivebial,
    description: desc(['When the unit moves, it takes Corrosive damage.']),
    baseDuration: 1,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: {
      onMoveStep: { type: 'damage', amount: 2, damageType: DAMAGE_TYPES.CORROSIVE },
    },
  },

  [EFFECT_IDS.CorrosiveDeterioration]: {
    id: EFFECT_IDS.CorrosiveDeterioration,
    kind: EFFECT_KINDS.UNIT,
    name: 'Deterioration',
    icon: EFFECT_IDS.CorrosiveDeterioration,
    description: desc(['Increases Corrosive damage taken by %.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.DAMAGE_TAKEN_PCT, op: 'add', value: 15, damageType: DAMAGE_TYPES.CORROSIVE },
    ],
  },

  [EFFECT_IDS.CorrosiveArmorDissolution]: {
    id: EFFECT_IDS.CorrosiveArmorDissolution,
    kind: EFFECT_KINDS.UNIT,
    name: 'Armor Dissolution',
    icon: EFFECT_IDS.CorrosiveArmorDissolution,
    description: desc(['Reduces unit armor points.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    modifiers: [
      { stat: MOD_STATS.ARMOR, op: 'add', value: -2 },
    ],
  },

  // -------------------------
  // Extra referenced by table (Irradiated spread)
  // -------------------------

  [EFFECT_IDS.MutantStress]: {
    id: EFFECT_IDS.MutantStress,
    kind: EFFECT_KINDS.UNIT,
    name: 'Mutant stress',
    icon: EFFECT_IDS.RadiationIrradiated, // if you add a dedicated icon later, change this key
    description: desc(['(Placeholder) Stress status applied by Irradiated on death.']),
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { placeholder: true },
  },
});

/**
 * Get effect definition by id.
 * Returns null if unknown (runtime should handle).
 */
export function getEffectDef(id) {
  const key = String(id || '').trim();
  return EFFECTS[key] || null;
}

export function listEffectIds() {
  return Object.keys(EFFECTS);
}

export function isUnitEffect(id) {
  const e = getEffectDef(id);
  return e?.kind === EFFECT_KINDS.UNIT;
}

export function isHexEffect(id) {
  const e = getEffectDef(id);
  return e?.kind === EFFECT_KINDS.HEX;
}

export default {
  EFFECT_IDS,
  EFFECTS,
  getEffectDef,
  listEffectIds,
  isUnitEffect,
  isHexEffect,
  EFFECT_KINDS,
  STACKING,
  TICK_PHASE,
  MOD_STATS,
  TICK_ACTIONS,
  DAMAGE_TYPES,
};
