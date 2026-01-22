// src/effects/EffectDefs.js
//
// Data-driven effect definitions for BOTH unit effects and hex effects.
// No Phaser imports.
//
// Goals:
// - Unified structure for buffs/debuffs/DoT/regen and hex hazards (fire, smoke, miasma).
// - Scales to many effects without adding special-case functions.
// - Effects are interpreted by EffectEngine (tick/derive/expire) and by scene runtime
//   (authoritative events in multiplayer).
//
// Terminology:
// - "Unit effect" lives on a unit: unit.effects[] (instances).
// - "Hex effect" lives on a hex: state.hexEffects["q,r"] = [instances].
//
// Effect instance shape (engine/runtime should use this):
// {
//   id: "inst_abc123",      // unique instance id
//   defId: "MIASMA_HEX",    // EffectDefs id
//   kind: "hex"|"unit",
//   q, r,                   // only for hex effects
//   sourceUnitId, sourceFaction,
//   duration: 3,            // remaining turns
//   stacks: 1,
//   params: {...}           // merged base params + instance params
// }
//
// Stacking policy:
// - 'refresh' : reapplying resets duration to max, stacks unchanged unless provided
// - 'stack'   : stacks++ (or set), duration refresh
// - 'ignore'  : if already present, do nothing
//
// Modifiers:
// - Applied while effect is active (derived stats).
// - Each modifier is an atom that StatResolver/EffectEngine understands.
//
// Ticks:
// - Executed at specific turn phases. We support 'turnStart' and 'turnEnd' now.
// - Tick actions yield *events* (damage/heal/stat change logs) but engine can also
//   apply directly in single-player. For multiplayer you should generate events.
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

// Supported modifier stats (keep stable, add more later)
export const MOD_STATS = Object.freeze({
  ARMOR: 'armor',                 // +N armor points (effective)
  VISION: 'vision',               // +N
  MP_MAX: 'mpMax',                // +N
  AP_MAX: 'apMax',                // +N
  RANGE: 'range',                 // +N weapon range (adds to both min/max in engine, or max only)
  DAMAGE_DEALT_PCT: 'damageDealtPct',   // +% dealt
  DAMAGE_TAKEN_PCT: 'damageTakenPct',   // +% taken
});

// Supported tick action types
export const TICK_ACTIONS = Object.freeze({
  DOT: 'dot',     // damage over time
  REGEN: 'regen', // heal over time
});

/**
 * @typedef {object} ModifierDef
 * @property {string} stat                      - one of MOD_STATS
 * @property {'add'} op                         - only 'add' for now
 * @property {number} value                     - N (or percent points for pct stats)
 * @property {string} [damageType]              - optional: affects only certain damage types (future hook)
 */

/**
 * @typedef {object} TickDef
 * @property {'turnStart'|'turnEnd'} phase      - when it ticks
 * @property {'dot'|'regen'} type               - action type
 * @property {number} amount                    - N
 * @property {string} [damageType]              - for DOT: physical|thermal|toxin|cryo|energy|corrosion
 * @property {boolean} [affectsAllOnHex]        - for hex effects: apply to all units on hex (default true)
 */

/**
 * @typedef {object} EffectDef
 * @property {string} id
 * @property {'unit'|'hex'} kind
 * @property {string} name
 * @property {string} icon                       - UI hint (emoji for now)
 * @property {string} description
 * @property {number} baseDuration               - default duration in turns
 * @property {'refresh'|'stack'|'ignore'} stacking
 * @property {number} [maxStacks]
 * @property {object} [baseParams]
 * @property {ModifierDef[]} [modifiers]         - applied while active
 * @property {TickDef[]} [ticks]                 - periodic actions
 * @property {object} [hexVisual]                - purely visual hint for scenes (optional)
 */

export const EFFECT_IDS = Object.freeze({
  // ===== UNIT BUFFS/DEBUFFS =====
  FORTIFY_ARMOR: 'FORTIFY_ARMOR',
  OVERCLOCK_STATS: 'OVERCLOCK_STATS',

  PASSIVE_THICK_PLATING: 'PASSIVE_THICK_PLATING',
  PASSIVE_KEEN_SIGHT: 'PASSIVE_KEEN_SIGHT',
  PASSIVE_SERVO_BOOST: 'PASSIVE_SERVO_BOOST',
  PASSIVE_RANGE_TUNING: 'PASSIVE_RANGE_TUNING',
  PASSIVE_TOXIN_FILTERS: 'PASSIVE_TOXIN_FILTERS',
  PASSIVE_CORROSION_COATING: 'PASSIVE_CORROSION_COATING',

  POISONED: 'POISONED',
  BURNING: 'BURNING',
  SMOKED: 'SMOKED',

  // ===== HEX FIELDS =====
  REGEN_FIELD_HEX: 'REGEN_FIELD_HEX',
  SMOKE_HEX: 'SMOKE_HEX',
  MIASMA_HEX: 'MIASMA_HEX',
  FIRE_HEX: 'FIRE_HEX',
});

/** @type {Record<string, EffectDef>} */
export const EFFECTS = Object.freeze({
  /* =========================================================================
     UNIT EFFECTS
     ========================================================================= */

  [EFFECT_IDS.FORTIFY_ARMOR]: {
    id: EFFECT_IDS.FORTIFY_ARMOR,
    kind: EFFECT_KINDS.UNIT,
    name: 'Fortified',
    icon: '🛡️',
    description: 'Temporary armor bonus.',
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { armorBonus: 2 },
    modifiers: [
      { stat: MOD_STATS.ARMOR, op: 'add', value: 2 },
    ],
  },

  [EFFECT_IDS.OVERCLOCK_STATS]: {
    id: EFFECT_IDS.OVERCLOCK_STATS,
    kind: EFFECT_KINDS.UNIT,
    name: 'Overclocked',
    icon: '⚡',
    description: '+MP and +AP this turn.',
    baseDuration: 1,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { mpBonus: 1, apBonus: 1 },
    modifiers: [
      { stat: MOD_STATS.MP_MAX, op: 'add', value: 1 },
      { stat: MOD_STATS.AP_MAX, op: 'add', value: 1 },
    ],
  },

  // PASSIVES (modeled as infinite-duration unit effects; engine/runtime should treat baseDuration<=0 as infinite)
  [EFFECT_IDS.PASSIVE_THICK_PLATING]: {
    id: EFFECT_IDS.PASSIVE_THICK_PLATING,
    kind: EFFECT_KINDS.UNIT,
    name: 'Thick Plating',
    icon: '🧱',
    description: 'Permanent armor bonus.',
    baseDuration: 0, // 0 => infinite in engine
    stacking: STACKING.IGNORE,
    maxStacks: 1,
    baseParams: { armorBonus: 1 },
    modifiers: [
      { stat: MOD_STATS.ARMOR, op: 'add', value: 1 },
    ],
  },

  [EFFECT_IDS.PASSIVE_KEEN_SIGHT]: {
    id: EFFECT_IDS.PASSIVE_KEEN_SIGHT,
    kind: EFFECT_KINDS.UNIT,
    name: 'Keen Sight',
    icon: '👁️',
    description: 'Permanent +vision.',
    baseDuration: 0,
    stacking: STACKING.IGNORE,
    maxStacks: 1,
    baseParams: { visionBonus: 1 },
    modifiers: [
      { stat: MOD_STATS.VISION, op: 'add', value: 1 },
    ],
  },

  [EFFECT_IDS.PASSIVE_SERVO_BOOST]: {
    id: EFFECT_IDS.PASSIVE_SERVO_BOOST,
    kind: EFFECT_KINDS.UNIT,
    name: 'Servo Boost',
    icon: '🦾',
    description: 'Permanent +MP.',
    baseDuration: 0,
    stacking: STACKING.IGNORE,
    maxStacks: 1,
    baseParams: { mpBonus: 1 },
    modifiers: [
      { stat: MOD_STATS.MP_MAX, op: 'add', value: 1 },
    ],
  },

  [EFFECT_IDS.PASSIVE_RANGE_TUNING]: {
    id: EFFECT_IDS.PASSIVE_RANGE_TUNING,
    kind: EFFECT_KINDS.UNIT,
    name: 'Range Tuning',
    icon: '🎯',
    description: 'Permanent +weapon range.',
    baseDuration: 0,
    stacking: STACKING.IGNORE,
    maxStacks: 1,
    baseParams: { rangeBonus: 1 },
    modifiers: [
      { stat: MOD_STATS.RANGE, op: 'add', value: 1 },
    ],
  },

  [EFFECT_IDS.PASSIVE_TOXIN_FILTERS]: {
    id: EFFECT_IDS.PASSIVE_TOXIN_FILTERS,
    kind: EFFECT_KINDS.UNIT,
    name: 'Toxin Filters',
    icon: '🧪',
    description: 'Reduce toxin damage taken (handled in CombatResolver via derived stat hook).',
    baseDuration: 0,
    stacking: STACKING.IGNORE,
    maxStacks: 1,
    baseParams: { toxinTakenPct: -25 },
    modifiers: [
      // We keep this as a generic "damage taken pct" for now.
      // If you later want per-type, extend modifiers with `damageType`.
      { stat: MOD_STATS.DAMAGE_TAKEN_PCT, op: 'add', value: -25, damageType: 'toxin' },
    ],
  },

  [EFFECT_IDS.PASSIVE_CORROSION_COATING]: {
    id: EFFECT_IDS.PASSIVE_CORROSION_COATING,
    kind: EFFECT_KINDS.UNIT,
    name: 'Corrosion Coating',
    icon: '🧫',
    description: 'Attacks may apply corrosion debuff (future hook).',
    baseDuration: 0,
    stacking: STACKING.IGNORE,
    maxStacks: 1,
    baseParams: { corrosionOnHit: true },
    // No direct modifiers; this is a hook read by attack pipeline.
    modifiers: [],
  },

  // Example unit DOTs (can also be applied from hex fields)
  [EFFECT_IDS.POISONED]: {
    id: EFFECT_IDS.POISONED,
    kind: EFFECT_KINDS.UNIT,
    name: 'Poisoned',
    icon: '☣️',
    description: 'Takes toxin damage each turn.',
    baseDuration: 3,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { dot: 2, damageType: 'toxin' },
    ticks: [
      { phase: TICK_PHASE.TURN_END, type: TICK_ACTIONS.DOT, amount: 2, damageType: 'toxin' },
    ],
  },

  [EFFECT_IDS.BURNING]: {
    id: EFFECT_IDS.BURNING,
    kind: EFFECT_KINDS.UNIT,
    name: 'Burning',
    icon: '🔥',
    description: 'Takes thermal damage each turn.',
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { dot: 2, damageType: 'thermal' },
    ticks: [
      { phase: TICK_PHASE.TURN_END, type: TICK_ACTIONS.DOT, amount: 2, damageType: 'thermal' },
    ],
  },

  [EFFECT_IDS.SMOKED]: {
    id: EFFECT_IDS.SMOKED,
    kind: EFFECT_KINDS.UNIT,
    name: 'Smoked',
    icon: '🌫️',
    description: 'Reduced vision while active.',
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { visionDebuff: 2 },
    modifiers: [
      { stat: MOD_STATS.VISION, op: 'add', value: -2 },
    ],
  },

  /* =========================================================================
     HEX EFFECTS
     ========================================================================= */

  [EFFECT_IDS.REGEN_FIELD_HEX]: {
    id: EFFECT_IDS.REGEN_FIELD_HEX,
    kind: EFFECT_KINDS.HEX,
    name: 'Regen Field',
    icon: '💠',
    description: 'Units on this hex regenerate HP each turn.',
    baseDuration: 3,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { healPerTurn: 2 },
    ticks: [
      { phase: TICK_PHASE.TURN_END, type: TICK_ACTIONS.REGEN, amount: 2, affectsAllOnHex: true },
    ],
    hexVisual: { hint: 'regen' },
  },

  [EFFECT_IDS.SMOKE_HEX]: {
    id: EFFECT_IDS.SMOKE_HEX,
    kind: EFFECT_KINDS.HEX,
    name: 'Smoke',
    icon: '🌫️',
    description: 'Units on this hex suffer reduced vision.',
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { visionDebuff: 2 },
    // For hex effects, modifiers are not directly applied; instead we apply a unit effect on enter/tick.
    // The engine will interpret this by applying `SMOKED` to units standing in it.
    baseParams2: null,
    hexVisual: { hint: 'smoke' },
  },

  [EFFECT_IDS.MIASMA_HEX]: {
    id: EFFECT_IDS.MIASMA_HEX,
    kind: EFFECT_KINDS.HEX,
    name: 'Miasma',
    icon: '☣️',
    description: 'Toxic cloud that damages units each turn.',
    baseDuration: 3,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { dot: 2, damageType: 'toxin' },
    ticks: [
      { phase: TICK_PHASE.TURN_END, type: TICK_ACTIONS.DOT, amount: 2, damageType: 'toxin', affectsAllOnHex: true },
    ],
    hexVisual: { hint: 'miasma' },
  },

  [EFFECT_IDS.FIRE_HEX]: {
    id: EFFECT_IDS.FIRE_HEX,
    kind: EFFECT_KINDS.HEX,
    name: 'Fire',
    icon: '🔥',
    description: 'Burning ground damages units each turn.',
    baseDuration: 2,
    stacking: STACKING.REFRESH,
    maxStacks: 1,
    baseParams: { dot: 2, damageType: 'thermal' },
    ticks: [
      { phase: TICK_PHASE.TURN_END, type: TICK_ACTIONS.DOT, amount: 2, damageType: 'thermal', affectsAllOnHex: true },
    ],
    hexVisual: { hint: 'fire' },
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
};
