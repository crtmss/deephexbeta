// src/units/WeaponDefs.js
//
// Weapon definitions used by combat resolver.
// Keep pure (no Phaser imports).

import { ARMOR_CLASSES } from './ArmorDefs.js';

/**
 * @typedef WeaponDef
 * @property {string} id
 * @property {string} name
 * @property {number} baseDamage
 * @property {number} rangeMin
 * @property {number} rangeMax
 * @property {Record<string, number>} armorClassMult  // multipliers for LIGHT/MEDIUM/HEAVY/NONE
 * @property {'ranged'|'melee'} mode
 * @property {{dist1?: number, dist2?: number}} [distanceCurve] // optional for SMG
 */

export const WEAPON_DEFS = /** @type {Record<string, WeaponDef>} */ ({
  // Крупнокалиберный пулемет: 10 урона, дальность до 3
  // ЛБ 100%, СБ 125%, ТБ 75%
  hmg: {
    id: 'hmg',
    name: 'Heavy Machine Gun',
    baseDamage: 10,
    rangeMin: 1,
    rangeMax: 3,
    mode: 'ranged',
    armorClassMult: {
      [ARMOR_CLASSES.NONE]: 1.0,
      [ARMOR_CLASSES.LIGHT]: 1.0,
      [ARMOR_CLASSES.MEDIUM]: 1.25,
      [ARMOR_CLASSES.HEAVY]: 0.75,
    },
  },

  // Легкий пулемет: 4 урона, дальность до 2
  // ЛБ 125%, СБ 75%, ТБ 50%
  lmg: {
    id: 'lmg',
    name: 'Light Machine Gun',
    baseDamage: 4,
    rangeMin: 1,
    rangeMax: 2,
    mode: 'ranged',
    armorClassMult: {
      [ARMOR_CLASSES.NONE]: 1.0,
      [ARMOR_CLASSES.LIGHT]: 1.25,
      [ARMOR_CLASSES.MEDIUM]: 0.75,
      [ARMOR_CLASSES.HEAVY]: 0.5,
    },
  },

  // СМГ: 3 урона, дальность 2
  // dist1 +25%, dist2 -25%
  // ЛБ 125%, СБ 75%, ТБ 50%
  smg: {
    id: 'smg',
    name: 'SMG',
    baseDamage: 3,
    rangeMin: 1,
    rangeMax: 2,
    mode: 'ranged',
    distanceCurve: { dist1: 1.25, dist2: 0.75 },
    armorClassMult: {
      [ARMOR_CLASSES.NONE]: 1.0,
      [ARMOR_CLASSES.LIGHT]: 1.25,
      [ARMOR_CLASSES.MEDIUM]: 0.75,
      [ARMOR_CLASSES.HEAVY]: 0.5,
    },
  },

  // Резак (нож): ближний бой 1, 6 урона
  // ЛБ 50%, СБ 100%, ТБ 125%
  cutter: {
    id: 'cutter',
    name: 'Cutter',
    baseDamage: 6,
    rangeMin: 1,
    rangeMax: 1,
    mode: 'melee',
    armorClassMult: {
      [ARMOR_CLASSES.NONE]: 1.0,
      [ARMOR_CLASSES.LIGHT]: 0.5,
      [ARMOR_CLASSES.MEDIUM]: 1.0,
      [ARMOR_CLASSES.HEAVY]: 1.25,
    },
  },
});

/**
 * @param {string} weaponId
 * @returns {WeaponDef}
 */
export function getWeaponDef(weaponId) {
  const id = String(weaponId || '').trim().toLowerCase();
  return WEAPON_DEFS[id] || WEAPON_DEFS.lmg;
}
