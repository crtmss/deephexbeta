// src/units/UnitDefs.js
//
// Static unit definitions for the turn-based unit system.
//
// Stage A scope (extended for scalability):
//  - Canonical stats: HP, Armor (points + class), MP, AP, Vision
//  - Squad stats: Group size, Morale (for future)
//  - Weapons list (2 switchable weapons supported by runtime via activeWeaponIndex)
//  - Active/Passive abilities (up to 2 each in UI, but defs support any length)
//  - Base resistances by damage type (optional; defaults to 0)
//
// IMPORTANT:
//  - This file must remain pure (no Phaser imports).
//  - Unit runtime state is created in UnitFactory.js.

/** @typedef {'NONE'|'LIGHT'|'MEDIUM'|'HEAVY'} ArmorClass */

/**
 * Damage types supported by the game (extend later if needed).
 * NOTE: updated to match your planned UI row:
 * physical, thermal, toxic, cryo, radiation, energy, corrosion
 * @typedef {'physical'|'thermal'|'toxic'|'cryo'|'radiation'|'energy'|'corrosion'} DamageType
 */

/**
 * @typedef {Partial<Record<DamageType, number>>} ResistMap
 * Values are in percent points, e.g. { toxic: 25 } means -25% toxic damage taken.
 * (How exactly this is applied is handled in CombatResolver/EffectEngine integration.)
 */

/**
 * @typedef UnitDef
 * @property {string} id
 * @property {string} name
 * @property {ArmorClass} armorClass
 * @property {number} armorPoints
 * @property {number} hpMax
 * @property {number} mpMax
 * @property {number} apMax
 * @property {number} visionMax
 * @property {number} groupSize     // size of squad (infantry 4-5, heavy units 1)
 * @property {number} moraleMax     // for future; currently 0 for all units
 * @property {string[]} weapons
 * @property {string[]} [activeAbilities]   // ability ids from src/abilities/AbilityDefs.js
 * @property {string[]} [passiveAbilities]  // ability ids from src/abilities/AbilityDefs.js
 * @property {ResistMap} [resists]
 * @property {{canProduce?: string[]}} meta
 */

const BASE_RESISTS = /** @type {ResistMap} */ ({
  physical: 0,
  thermal: 0,
  toxic: 0,
  cryo: 0,
  radiation: 0,
  energy: 0,
  corrosion: 0,
});

/**
 * Canonical unit definitions.
 * Keep ids lowercase with underscores.
 *
 * NOTE:
 * - You requested earlier: "Пока пусть у всех юнитов будет 1 AP".
 * - Vision baseline in your rules was 4 hexes; we set it here.
 */
export const UNIT_DEFS = /** @type {Record<string, UnitDef>} */ ({
  mobile_base: {
    id: 'mobile_base',
    name: 'Mobile Base',
    hpMax: 50,
    armorPoints: 4,
    armorClass: 'HEAVY',

    mpMax: 3,
    apMax: 1,
    visionMax: 4,

    groupSize: 1,
    moraleMax: 0,

    weapons: ['hmg', 'hmg'],

    // For UI + early testing of ability pipeline.
    // (You can change these later from your unit spreadsheet.)
    activeAbilities: ['fortify', 'smoke_screen'],
    passiveAbilities: ['thick_plating'],

    resists: { ...BASE_RESISTS },

    meta: { canProduce: ['transporter', 'raider'] },
  },

  transporter: {
    id: 'transporter',
    name: 'Transporter',
    hpMax: 10,
    armorPoints: 3,
    armorClass: 'MEDIUM',

    mpMax: 3,
    apMax: 1,
    visionMax: 4,

    groupSize: 1,
    moraleMax: 0,

    weapons: ['lmg'],

    activeAbilities: [],
    passiveAbilities: [],

    resists: { ...BASE_RESISTS },

    meta: {},
  },

  raider: {
    id: 'raider',
    name: 'Raider',
    hpMax: 6,
    armorPoints: 1,
    armorClass: 'LIGHT',

    mpMax: 3,
    apMax: 1,
    visionMax: 4,

    groupSize: 4,
    moraleMax: 0,

    weapons: ['smg', 'cutter'],

    activeAbilities: [],
    passiveAbilities: [],

    resists: { ...BASE_RESISTS },

    meta: {},
  },

  // Existing enemy placeholder. We'll map it onto the new stats system
  // without breaking existing visuals/logic.
  enemy_raider: {
    id: 'enemy_raider',
    name: 'Enemy Raider',
    hpMax: 6,
    armorPoints: 1,
    armorClass: 'LIGHT',

    mpMax: 3,
    apMax: 1,
    visionMax: 4,

    groupSize: 4,
    moraleMax: 0,

    weapons: ['smg', 'cutter'],

    activeAbilities: [],
    passiveAbilities: [],

    resists: { ...BASE_RESISTS },

    meta: {},
  },
});

/**
 * Defensive getter so callers can safely request a unit def.
 * @param {string} type
 * @returns {UnitDef}
 */
export function getUnitDef(type) {
  const key = String(type || '').trim().toLowerCase();
  return UNIT_DEFS[key] || UNIT_DEFS.mobile_base;
}

export default {
  UNIT_DEFS,
  getUnitDef,
};
