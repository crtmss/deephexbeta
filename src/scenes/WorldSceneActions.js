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
    if (Number.isFinite(unit.hp)) unit.maxHp = unit.hp;
    else unit.maxHp = 1;
  }
  if (!Number.isFinite(unit.hp)) unit.hp = unit.maxHp;

  // Movement points (some units don't use these, but keep consistent fields)
  if (!Number.isFinite(unit.mp)) unit.mp = 0;
  if (!Number.isFinite(unit.mpMax)) unit.mpMax = Number.isFinite(unit.maxMovementPoints) ? unit.maxMovementPoints : unit.mp;

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
  return (unit.ap || 0) >= n;
}

/** Spend n AP (clamped at 0). */
export function spendAp(unit, n = 1) {
  ensureUnitCombatFields(unit);
  const cost = Number.isFinite(n) ? n : 1;
  unit.ap = Math.max(0, (unit.ap || 0) - cost);
  return unit.ap;
}

/** Clears temporary bonuses that should not persist across turns. */
export function clearTurnTempBonuses(unit) {
  if (!unit) return;
  unit.tempArmorBonus = 0;
}

/**
 * Defence action:
 * - Costs 1 AP if available
 * - Grants +1 temporary armor for the rest of the turn
 * - Heals 10% of max HP (min 1) but not above max
 */
export function applyDefence(unit) {
  ensureUnitCombatFields(unit);

  if (!canSpendAp(unit, 1)) return { ok: false, reason: 'no_ap' };

  spendAp(unit, 1);

  unit.tempArmorBonus = (Number.isFinite(unit.tempArmorBonus) ? unit.tempArmorBonus : 0) + 1;

  const heal = Math.max(1, Math.round((unit.maxHp || 1) * 0.10));
  unit.hp = Math.min(unit.maxHp || unit.hp, (unit.hp || 0) + heal);

  return { ok: true, heal, tempArmorBonus: unit.tempArmorBonus };
}

/**
 * Resolve an attack into a combat event (does NOT apply damage directly).
 *
 * @param {any} attacker
 * @param {any} target
 * @param {object} opts
 * @returns {{ok: boolean, reason?: string, event?: any, killed?: boolean, details?: any}}
 */
export function applyAttack(attacker, target, opts = {}) {
  ensureUnitCombatFields(attacker);
  ensureUnitCombatFields(target);

  // Need AP
  if (!canSpendAp(attacker, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  // Pick active weapon
  const ws = attacker.weapons || [];
  const weaponId = ws[attacker.activeWeaponIndex] || ws[0] || null;
  if (!weaponId) {
    return { ok: false, reason: 'no_weapon' };
  }
  const weapon = getWeaponDef(weaponId);
  if (!weapon) {
    return { ok: false, reason: 'bad_weapon' };
  }

  // Validate range (uses hex distance internally)
  const v = validateAttack(attacker, target, weaponId);
  if (!v.ok) {
    return { ok: false, reason: v.reason || 'invalid', distance: v.distance };
  }

  // Spend AP authoritatively here
  spendAp(attacker, 1);

  // Resolve damage (pure math)
  const res = resolveAttack(attacker, target, weaponId);

  // Support both return shapes: {finalDamage} or {damage}
  const damage =
    Number.isFinite(res?.finalDamage) ? res.finalDamage :
    (Number.isFinite(res?.damage) ? res.damage : 0);

  const defenderHpBefore = Number.isFinite(target.hp) ? target.hp : 0;
  const defenderHpAfter = Math.max(0, defenderHpBefore - damage);

  const attackerId = attacker.id ?? attacker.unitId ?? attacker.uuid ?? attacker.netId ?? `${attacker.unitName || attacker.name}@${attacker.q},${attacker.r}`;
  const defenderId = target.id ?? target.unitId ?? target.uuid ?? target.netId ?? `${target.unitName || target.name}@${target.q},${target.r}`;

  const event = {
    type: 'combat:attack',
    attackerId: String(attackerId),
    defenderId: String(defenderId),
    weaponId: String(weaponId),
    damage,
    // metadata for debugging / UI
    distance: v.distance,
    turnOwner: opts.turnOwner ?? null,
    turnNumber: opts.turnNumber ?? null,
    roomCode: opts.roomCode ?? null,
    nonce: opts.nonce ?? null,
  };

  return {
    ok: true,
    event,
    killed: defenderHpAfter <= 0,
    details: {
      weaponId,
      damage,
      distance: v.distance,
      defenderHpBefore,
      defenderHpAfter,
    },
  };
}

/* =========================================================
   Default export (safe for legacy imports)
   ========================================================= */
export default {
  ensureUnitCombatFields,
  canSpendAp,
  spendAp,
  applyDefence,
  applyAttack,
  clearTurnTempBonuses,
};
