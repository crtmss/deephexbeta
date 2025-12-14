// src/units/WeaponDefs.js
//
// Stage B/C: Weapon definitions.
//
// Each weapon defines:
//  - id, name
//  - baseDamage
//  - rangeMin, rangeMax (in hexes)
//  - armorClassMult: { LIGHT, MEDIUM, HEAVY }
//  - distanceCurve: optional multipliers by distance
//
// NOTE: Damage calculation is handled in CombatResolver.

export const WEAPON_IDS = Object.freeze({
  HMG: 'hmg',
  LMG: 'lmg',
  SMG: 'smg',
  CUTTER: 'cutter',
});

/** @type {Record<string, any>} */
export const WEAPONS = Object.freeze({
  // Крупнокалиберный пулемет
  [WEAPON_IDS.HMG]: {
    id: WEAPON_IDS.HMG,
    name: 'Heavy Machine Gun',
    baseDamage: 10,
    rangeMin: 1,
    rangeMax: 3,
    armorClassMult: { LIGHT: 1.0, MEDIUM: 1.25, HEAVY: 0.75 },
    distanceCurve: {},
  },

  // Легкий пулемет
  [WEAPON_IDS.LMG]: {
    id: WEAPON_IDS.LMG,
    name: 'Light Machine Gun',
    baseDamage: 4,
    rangeMin: 1,
    rangeMax: 2,
    armorClassMult: { LIGHT: 1.25, MEDIUM: 0.75, HEAVY: 0.50 },
    distanceCurve: {},
  },

  // СМГ: дальность до 2; dist=1 +25%, dist=2 -25%
  [WEAPON_IDS.SMG]: {
    id: WEAPON_IDS.SMG,
    name: 'SMG',
    baseDamage: 3,
    rangeMin: 1,
    rangeMax: 2,
    armorClassMult: { LIGHT: 1.25, MEDIUM: 0.75, HEAVY: 0.50 },
    distanceCurve: { dist1: 1.25, dist2: 0.75 },
  },

  // Резак (ближний бой)
  [WEAPON_IDS.CUTTER]: {
    id: WEAPON_IDS.CUTTER,
    name: 'Cutter',
    baseDamage: 6,
    rangeMin: 1,
    rangeMax: 1,
    armorClassMult: { LIGHT: 0.50, MEDIUM: 1.00, HEAVY: 1.25 },
    distanceCurve: {},
  },
});

export function getWeaponDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return WEAPONS[key] || WEAPONS[WEAPON_IDS.LMG];
}

export function listWeaponIds() {
  return Object.keys(WEAPONS);
}

export default {
  WEAPON_IDS,
  WEAPONS,
  getWeaponDef,
  listWeaponIds,
};
