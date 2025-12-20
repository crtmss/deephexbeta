// src/units/UnitDefs.js
//
// Static unit definitions for the turn-based unit system.
//
// Stage A scope:
//  - Canonical stats: HP, Armor (points + class), MP, AP
//  - Basic metadata used by UI and spawn code
//
// IMPORTANT:
//  - This file must remain pure (no Phaser imports).
//  - Unit runtime state is created in UnitFactory.js.

/** @typedef {'NONE'|'LIGHT'|'MEDIUM'|'HEAVY'} ArmorClass */

/**
 * @typedef UnitDef
 * @property {string} id
 * @property {string} name
 * @property {ArmorClass} armorClass
 * @property {number} armorPoints
 * @property {number} hpMax
 * @property {number} mpMax
 * @property {number} apMax
 * @property {string[]} weapons
 * @property {{canProduce?: string[]}} meta
 */

/**
 * Canonical unit definitions.
 * Keep ids lowercase with underscores.
 *
 * NOTE: You requested: "Пока пусть у всех юнитов будет 1 AP".
 */
export const UNIT_DEFS = /** @type {Record<string, UnitDef>} */ ({
  mobile_base: {
    id: 'mobile_base',
    name: 'Mobile Base',
    hpMax: 50,
    armorPoints: 4,
    armorClass: 'HEAVY',
    // Ground movement: 3 MP baseline
    mpMax: 3,
    apMax: 1,
    weapons: ['hmg', 'hmg'],
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
    weapons: ['lmg'],
    meta: {},
  },

  raider: {
    id: 'raider',
    name: 'Raider',
    hpMax: 6,
    armorPoints: 1,
    armorClass: 'LIGHT',
    // Ground movement: 3 MP baseline
    mpMax: 3,
    apMax: 1,
    weapons: ['smg', 'cutter'],
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
    // Ground movement: 3 MP baseline
    mpMax: 3,
    apMax: 1,
    weapons: ['smg', 'cutter'],
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
