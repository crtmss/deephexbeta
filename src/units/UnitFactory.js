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
 * @typedef UnitState
 * @property {string} id
 * @property {string} type
 * @property {string|null} ownerId
 * @property {number|null} ownerSlot
 * @property {UnitController} controller
 * @property {number} q
 * @property {number} r
 * @property {number} facing
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} armorPoints
 * @property {'NONE'|'LIGHT'|'MEDIUM'|'HEAVY'} armorClass
 * @property {number} mp
 * @property {number} mpMax
 * @property {number} ap
 * @property {number} apMax
 * @property {string[]} weapons
 * @property {number} activeWeaponIndex
 * @property {{defending?: boolean}} status
 */

/**
 * Create a pure runtime state object.
 * @param {object} opts
 * @param {string} opts.type
 * @param {string|null} [opts.ownerId]
 * @param {number|null} [opts.ownerSlot]
 * @param {'player'|'ai'} [opts.controller]
 * @param {number} opts.q
 * @param {number} opts.r
 * @param {number} [opts.facing]
 * @returns {UnitState}
 */
export function createUnitState(opts) {
  const def = getUnitDef(opts.type);
  const id = `u${_seq++}`;

  return {
    id,
    type: def.id,
    ownerId: opts.ownerId ?? null,
    ownerSlot: opts.ownerSlot ?? null,
    controller: opts.controller || 'player',
    q: opts.q,
    r: opts.r,
    facing: Number.isFinite(opts.facing) ? opts.facing : 0,
    hpMax: def.hpMax,
    hp: def.hpMax,
    armorPoints: def.armorPoints,
    armorClass: def.armorClass,
    mpMax: def.mpMax,
    mp: def.mpMax,
    apMax: def.apMax,
    ap: def.apMax,
    weapons: Array.isArray(def.weapons) ? def.weapons.slice() : [],
    activeWeaponIndex: 0,
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

  // Canonical
  phaserUnit.unitId = state.id;
  phaserUnit.unitType = state.type;
  phaserUnit.ownerId = state.ownerId;
  phaserUnit.ownerSlot = state.ownerSlot;
  phaserUnit.controller = state.controller;
  phaserUnit.facing = state.facing;

  phaserUnit.hp = state.hp;
  phaserUnit.maxHp = state.hpMax;
  phaserUnit.armorPoints = state.armorPoints;
  phaserUnit.armorClass = state.armorClass;

  phaserUnit.mp = state.mp;
  phaserUnit.mpMax = state.mpMax;
  phaserUnit.ap = state.ap;
  phaserUnit.apMax = state.apMax;

  phaserUnit.weapons = state.weapons;
  phaserUnit.activeWeaponIndex = state.activeWeaponIndex;
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
