// src/abilities/AbilityDefs.js
//
// Data-driven definitions for ACTIVE and PASSIVE abilities.
//
// IMPORTANT DESIGN GOALS
// - Pure data + small helpers. No Phaser imports.
// - Scales to 50+ units and many abilities/effects.
// - Abilities do NOT directly mutate game state here.
//   They describe targeting + costs + what effects/actions should happen.
//   The runtime (scene/host) will interpret these defs and produce authoritative events.
//
// Conventions (used by UI + host resolver):
// - Active ability: has `active` block
// - Passive ability: has `passive` block
// - `icon` is a UI hint (emoji for now; later you can switch to sprite keys)
//
// Targeting:
// - 'self'       : affects caster only
// - 'unit'       : select a unit (enemy/ally) within range
// - 'hex'        : select a hex within range
// - 'hex_aoe'    : select a center hex; affects an area (radius from params)
//
// Action model (future-proof):
// - `applyUnitEffects`: list of effects to apply to a unit (self or target)
// - `placeHexEffects` : list of effects to place on a hex (target hex or aoe)
// Each entry references `effectId` from EffectDefs and carries optional payload.
//
// Logging:
// - Runtime should log: cast begin → validate → targets count → apply/placed → tick/expire.
//   This file intentionally does NOT console.log.

export const ABILITY_IDS = Object.freeze({
  // ===== ACTIVE =====
  FORTIFY: 'fortify',
  REGEN_FIELD: 'regen_field',
  OVERCLOCK: 'overclock',
  SMOKE_SCREEN: 'smoke_screen',
  MIASMA_BOMB: 'miasma_bomb',
  FIRE_PATCH: 'fire_patch',

  // ===== PASSIVE =====
  THICK_PLATING: 'thick_plating',
  KEEN_SIGHT: 'keen_sight',
  SERVO_BOOST: 'servo_boost',
  RANGE_TUNING: 'range_tuning',
  TOXIN_FILTERS: 'toxin_filters',
  CORROSION_COATING: 'corrosion_coating',
});

/**
 * @typedef {'self'|'unit'|'hex'|'hex_aoe'} AbilityTarget
 */

/**
 * @typedef {object} AbilityEffectSpec
 * @property {string} effectId         - EffectDefs id
 * @property {'self'|'target'} applyTo - where to apply (for unit effects)
 * @property {number} [duration]       - override duration (turns)
 * @property {number} [stacks]         - override stacks
 * @property {object} [params]         - arbitrary effect params
 */

/**
 * @typedef {object} HexEffectSpec
 * @property {string} effectId
 * @property {'targetHex'|'aoe'} placeOn
 * @property {number} [duration]
 * @property {number} [stacks]
 * @property {object} [params]
 */

/**
 * @typedef {object} ActiveAbilityDef
 * @property {AbilityTarget} target
 * @property {number} apCost
 * @property {number} rangeMin
 * @property {number} rangeMax
 * @property {number} [cooldown]       - optional cooldown in turns
 * @property {boolean} [requiresLos]   - line of sight (optional, default false)
 * @property {number} [aoeRadius]      - for hex_aoe
 * @property {AbilityEffectSpec[]} [applyUnitEffects]
 * @property {HexEffectSpec[]} [placeHexEffects]
 */

/**
 * @typedef {object} PassiveAbilityDef
 * @property {string} effectId         - EffectDefs id to keep active while unit exists
 * @property {object} [params]
 */

/**
 * @typedef {object} AbilityDef
 * @property {string} id
 * @property {'active'|'passive'} kind
 * @property {string} name
 * @property {string} description
 * @property {string} icon             - UI hint (emoji for now)
 * @property {ActiveAbilityDef} [active]
 * @property {PassiveAbilityDef} [passive]
 */

/** @type {Record<string, AbilityDef>} */
export const ABILITIES = Object.freeze({
  /* =========================================================================
     ACTIVE abilities
     ========================================================================= */

  [ABILITY_IDS.FORTIFY]: {
    id: ABILITY_IDS.FORTIFY,
    kind: 'active',
    name: 'Fortify',
    icon: '🛡️',
    description: 'Spend AP to gain temporary armor for a few turns.',
    active: {
      target: 'self',
      apCost: 1,
      rangeMin: 0,
      rangeMax: 0,
      cooldown: 0,
      applyUnitEffects: [
        {
          effectId: 'FORTIFY_ARMOR', // EffectDefs.js (to be added)
          applyTo: 'self',
          duration: 2,
          stacks: 1,
          params: { armorBonus: 2 },
        },
      ],
    },
  },

  [ABILITY_IDS.REGEN_FIELD]: {
    id: ABILITY_IDS.REGEN_FIELD,
    kind: 'active',
    name: 'Regen Field',
    icon: '💠',
    description: 'Place a regenerative field on a hex for several turns.',
    active: {
      target: 'hex',
      apCost: 1,
      rangeMin: 1,
      rangeMax: 3,
      requiresLos: false,
      placeHexEffects: [
        {
          effectId: 'REGEN_FIELD_HEX', // EffectDefs.js
          placeOn: 'targetHex',
          duration: 3,
          stacks: 1,
          params: { healPerTurn: 2 },
        },
      ],
    },
  },

  [ABILITY_IDS.OVERCLOCK]: {
    id: ABILITY_IDS.OVERCLOCK,
    kind: 'active',
    name: 'Overclock',
    icon: '⚡',
    description: 'Gain +MP/+AP this turn at a cost (optional heat, later).',
    active: {
      target: 'self',
      apCost: 1,
      rangeMin: 0,
      rangeMax: 0,
      applyUnitEffects: [
        {
          effectId: 'OVERCLOCK_STATS', // EffectDefs.js
          applyTo: 'self',
          duration: 1,
          stacks: 1,
          params: { mpBonus: 1, apBonus: 1 },
        },
      ],
    },
  },

  [ABILITY_IDS.SMOKE_SCREEN]: {
    id: ABILITY_IDS.SMOKE_SCREEN,
    kind: 'active',
    name: 'Smoke Screen',
    icon: '🌫️',
    description: 'Place smoke that reduces vision on affected hexes.',
    active: {
      target: 'hex_aoe',
      apCost: 1,
      rangeMin: 1,
      rangeMax: 3,
      aoeRadius: 1,
      placeHexEffects: [
        {
          effectId: 'SMOKE_HEX', // EffectDefs.js
          placeOn: 'aoe',
          duration: 2,
          stacks: 1,
          params: { visionDebuff: 2 },
        },
      ],
    },
  },

  [ABILITY_IDS.MIASMA_BOMB]: {
    id: ABILITY_IDS.MIASMA_BOMB,
    kind: 'active',
    name: 'Miasma Bomb',
    icon: '☣️',
    description: 'Place toxic miasma; units inside take toxin damage over time.',
    active: {
      target: 'hex_aoe',
      apCost: 1,
      rangeMin: 1,
      rangeMax: 3,
      aoeRadius: 1,
      placeHexEffects: [
        {
          effectId: 'MIASMA_HEX', // EffectDefs.js
          placeOn: 'aoe',
          duration: 3,
          stacks: 1,
          params: { dot: 2, damageType: 'toxin' },
        },
      ],
    },
  },

  [ABILITY_IDS.FIRE_PATCH]: {
    id: ABILITY_IDS.FIRE_PATCH,
    kind: 'active',
    name: 'Fire Patch',
    icon: '🔥',
    description: 'Ignite hexes; units on fire hex take thermal damage over time.',
    active: {
      target: 'hex_aoe',
      apCost: 1,
      rangeMin: 1,
      rangeMax: 3,
      aoeRadius: 1,
      placeHexEffects: [
        {
          effectId: 'FIRE_HEX', // EffectDefs.js
          placeOn: 'aoe',
          duration: 2,
          stacks: 1,
          params: { dot: 2, damageType: 'thermal' },
        },
      ],
    },
  },

  /* =========================================================================
     PASSIVE abilities
     ========================================================================= */

  [ABILITY_IDS.THICK_PLATING]: {
    id: ABILITY_IDS.THICK_PLATING,
    kind: 'passive',
    name: 'Thick Plating',
    icon: '🧱',
    description: 'Permanent bonus armor.',
    passive: {
      effectId: 'PASSIVE_THICK_PLATING', // EffectDefs.js
      params: { armorBonus: 1 },
    },
  },

  [ABILITY_IDS.KEEN_SIGHT]: {
    id: ABILITY_IDS.KEEN_SIGHT,
    kind: 'passive',
    name: 'Keen Sight',
    icon: '👁️',
    description: 'Permanent +vision.',
    passive: {
      effectId: 'PASSIVE_KEEN_SIGHT',
      params: { visionBonus: 1 },
    },
  },

  [ABILITY_IDS.SERVO_BOOST]: {
    id: ABILITY_IDS.SERVO_BOOST,
    kind: 'passive',
    name: 'Servo Boost',
    icon: '🦾',
    description: 'Permanent +MP.',
    passive: {
      effectId: 'PASSIVE_SERVO_BOOST',
      params: { mpBonus: 1 },
    },
  },

  [ABILITY_IDS.RANGE_TUNING]: {
    id: ABILITY_IDS.RANGE_TUNING,
    kind: 'passive',
    name: 'Range Tuning',
    icon: '🎯',
    description: 'Permanent +weapon range.',
    passive: {
      effectId: 'PASSIVE_RANGE_TUNING',
      params: { rangeBonus: 1 },
    },
  },

  [ABILITY_IDS.TOXIN_FILTERS]: {
    id: ABILITY_IDS.TOXIN_FILTERS,
    kind: 'passive',
    name: 'Toxin Filters',
    icon: '🧪',
    description: 'Reduces toxin damage taken.',
    passive: {
      effectId: 'PASSIVE_TOXIN_FILTERS',
      params: { toxinTakenPct: -25 },
    },
  },

  [ABILITY_IDS.CORROSION_COATING]: {
    id: ABILITY_IDS.CORROSION_COATING,
    kind: 'passive',
    name: 'Corrosion Coating',
    icon: '🧫',
    description: 'Your attacks apply a small corrosion debuff (future hook).',
    passive: {
      effectId: 'PASSIVE_CORROSION_COATING',
      params: { corrosionOnHit: true },
    },
  },
});

/**
 * Returns ability definition by id.
 * Falls back to a safe default (Fortify) if unknown.
 */
export function getAbilityDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return ABILITIES[key] || ABILITIES[ABILITY_IDS.FORTIFY];
}

export function listAbilityIds() {
  return Object.keys(ABILITIES);
}

export function isActiveAbility(id) {
  const a = getAbilityDef(id);
  return a?.kind === 'active';
}

export function isPassiveAbility(id) {
  const a = getAbilityDef(id);
  return a?.kind === 'passive';
}

export default {
  ABILITY_IDS,
  ABILITIES,
  getAbilityDef,
  listAbilityIds,
  isActiveAbility,
  isPassiveAbility,
};
