// src/units/UnitActions.js
//
// Stage B: apply DEFENCE and ATTACK to Phaser unit objects while preserving legacy fields.

import { validateAttack, resolveAttack } from './CombatResolver.js';

/**
 * Apply defence:
 * - consumes all MP and AP
 * - heals 10% of max HP
 * - grants +1 temporary armor until owner's next turn refresh
 *
 * @param {any} unit
 * @returns {{ok:boolean, reason?:string}}
 */
export function applyDefence(unit) {
  if (!unit) return { ok: false, reason: 'no_unit' };

  // Must have at least 1 AP or MP? Spec says: Defence is an action.
  // Stage B: allow if unit has AP>0 OR MP>0 (so it can be used even if moved but still has AP).
  const ap = Number.isFinite(unit.ap) ? unit.ap : 0;
  const mp = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);

  if (ap <= 0 && mp <= 0) return { ok: false, reason: 'no_points' };

  // Consume all
  unit.ap = 0;
  unit.mp = 0;
  unit.movementPoints = 0;

  // Heal 10%
  const hpMax = Number.isFinite(unit.maxHp) ? unit.maxHp : (Number.isFinite(unit.hpMax) ? unit.hpMax : unit.hp || 0);
  const hp = Number.isFinite(unit.hp) ? unit.hp : hpMax;
  const heal = Math.max(0, Math.floor(hpMax * 0.10));
  unit.hp = Math.min(hpMax, hp + heal);

  // +1 temporary armor bonus
  unit.tempArmorBonus = 1;
  unit.status = unit.status && typeof unit.status === 'object' ? unit.status : {};
  unit.status.defending = true;

  return { ok: true };
}

/**
 * Apply attack:
 * - costs 1 AP
 * - uses active weapon (unit.weapons[unit.activeWeaponIndex]) fallback to first
 * - applies damage; may kill defender
 *
 * @param {any} attacker
 * @param {any} defender
 * @returns {{ok:boolean, reason?:string, result?:any}}
 */
export function applyAttack(attacker, defender) {
  if (!attacker || !defender) return { ok: false, reason: 'missing_units' };

  const ap = Number.isFinite(attacker.ap) ? attacker.ap : 0;
  if (ap <= 0) return { ok: false, reason: 'no_ap' };

  const weapons = Array.isArray(attacker.weapons) ? attacker.weapons : [];
  const idx = Number.isFinite(attacker.activeWeaponIndex) ? attacker.activeWeaponIndex : 0;
  const weaponId = weapons[idx] || weapons[0] || 'lmg';

  const v = validateAttack(attacker, defender, weaponId);
  if (!v.ok) return { ok: false, reason: v.reason || 'invalid_attack' };

  const r = resolveAttack(attacker, defender, weaponId);

  // Spend AP
  attacker.ap = ap - 1;

  // Apply damage
  const hpMax = Number.isFinite(defender.maxHp) ? defender.maxHp : (Number.isFinite(defender.hpMax) ? defender.hpMax : defender.hp || 0);
  const hp = Number.isFinite(defender.hp) ? defender.hp : hpMax;
  defender.hp = Math.max(0, hp - r.finalDamage);

  return { ok: true, result: r };
}
