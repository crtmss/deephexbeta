// src/units/UnitActions.js
//
// Pure rules for unit actions (no Phaser / rendering).
//
// Responsibilities:
// - Ensure combat-related fields exist on unit objects.
// - Spend AP safely.
// - Apply defence action (temporary armor + small heal).
// - Resolve an attack into a combat event (authoritative logic lives in host / runtime).
//
// NOTE:
// - applyAttack() returns a combat event; it does NOT apply damage directly.
//   Damage/HP changes should be applied by scene.applyCombatEvent(event) (host + clients).

import { getWeaponDef } from './WeaponDefs.js';
import { validateAttack, resolveAttack } from './CombatResolver.js';

/** Ensure combat-related fields exist so other systems can rely on them. */
export function ensureUnitCombatFields(unit) {
  if (!unit) return;

  // Identity
  if (!unit.unitId && unit.id) unit.unitId = unit.id;

  // HP
  if (!Number.isFinite(unit.maxHp)) {
    unit.maxHp = Number.isFinite(unit.hp) ? unit.hp : 1;
  }
  if (!Number.isFinite(unit.hp)) unit.hp = unit.maxHp;

  // Movement
  if (!Number.isFinite(unit.mp)) unit.mp = 0;
  if (!Number.isFinite(unit.mpMax)) {
    unit.mpMax = Number.isFinite(unit.maxMovementPoints)
      ? unit.maxMovementPoints
      : unit.mp;
  }

  // Action points
  if (!Number.isFinite(unit.apMax)) unit.apMax = 1;
  if (!Number.isFinite(unit.ap)) unit.ap = unit.apMax;

  // Armor
  if (!Number.isFinite(unit.armorPoints)) unit.armorPoints = 0;
  if (!Number.isFinite(unit.tempArmorBonus)) unit.tempArmorBonus = 0;
  if (!unit.armorClass) unit.armorClass = 'NONE';

  // Weapons
  if (!Array.isArray(unit.weapons)) unit.weapons = [];
  if (!Number.isFinite(unit.activeWeaponIndex)) unit.activeWeaponIndex = 0;
}

/** True if unit has at least n AP available. */
export function canSpendAp(unit, n = 1) {
  ensureUnitCombatFields(unit);
  return unit.ap >= n;
}

/** Spend n AP (clamped at 0). */
export function spendAp(unit, n = 1) {
  ensureUnitCombatFields(unit);
  unit.ap = Math.max(0, unit.ap - n);
  return unit.ap;
}

/** Clears temporary bonuses that should not persist across turns. */
export function clearTurnTempBonuses(unit) {
  if (!unit) return;
  unit.tempArmorBonus = 0;
}

/**
 * Defence action:
 * - Costs 1 AP
 * - Grants +1 temporary armor
 * - Heals 10% max HP (min 1)
 */
export function applyDefence(unit) {
  ensureUnitCombatFields(unit);

  if (!canSpendAp(unit, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  spendAp(unit, 1);

  unit.tempArmorBonus += 1;

  const heal = Math.max(1, Math.round(unit.maxHp * 0.1));
  unit.hp = Math.min(unit.maxHp, unit.hp + heal);

  return { ok: true, heal };
}

/**
 * Resolve an attack into a combat event (does NOT apply damage directly).
 */
export function applyAttack(attacker, target, opts = {}) {
  ensureUnitCombatFields(attacker);
  ensureUnitCombatFields(target);

  if (!canSpendAp(attacker, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  const weapons = attacker.weapons || [];
  const weaponId =
    weapons[attacker.activeWeaponIndex] || weapons[0] || null;

  if (!weaponId) {
    return { ok: false, reason: 'no_weapon' };
  }

  const weapon = getWeaponDef(weaponId);
  if (!weapon) {
    return { ok: false, reason: 'bad_weapon' };
  }

  const validation = validateAttack(attacker, target, weaponId);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  spendAp(attacker, 1);

  const res = resolveAttack(attacker, target, weaponId);
  const damage = Math.max(0, res.finalDamage || 0);

  const event = {
    type: 'combat:attack',
    attackerId: attacker.id ?? attacker.unitId,
    defenderId: target.id ?? target.unitId,
    weaponId,
    damage,
    distance: validation.distance,
    nonce: opts.nonce ?? null,
  };

  return {
    ok: true,
    event,
    killed: target.hp - damage <= 0,
    details: {
      weaponId,
      damage,
      distance: validation.distance,
    },
  };
}

export default {
  ensureUnitCombatFields,
  canSpendAp,
  spendAp,
  clearTurnTempBonuses,
  applyDefence,
  applyAttack,
};
