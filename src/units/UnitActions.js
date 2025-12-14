// src/units/UnitActions.js
//
// Stage B/C: Unit actions used by UI + input.
//
// Actions implemented here:
//  - defence: consumes all MP and AP, +1 temporary armor, heals 10% max HP
//  - turn: free; UI just sets facing (handled in UI module)
//
// Attack and move are mediated by scene input (WorldSceneUI), but helper
// functions here keep the rules in one place.

export function ensureUnitCombatFields(unit) {
  if (!unit) return;

  // HP
  if (!Number.isFinite(unit.maxHp) && Number.isFinite(unit.hp)) unit.maxHp = unit.hp;
  if (!Number.isFinite(unit.hp)) unit.hp = Number.isFinite(unit.maxHp) ? unit.maxHp : 0;
  if (!Number.isFinite(unit.maxHp)) unit.maxHp = unit.hp;

  // MP/AP
  if (!Number.isFinite(unit.mp) && Number.isFinite(unit.movementPoints)) unit.mp = unit.movementPoints;
  if (!Number.isFinite(unit.mpMax) && Number.isFinite(unit.maxMovementPoints)) unit.mpMax = unit.maxMovementPoints;

  if (!Number.isFinite(unit.mp)) unit.mp = 0;
  if (!Number.isFinite(unit.mpMax)) unit.mpMax = unit.mp;

  if (!Number.isFinite(unit.apMax)) unit.apMax = 1;
  if (!Number.isFinite(unit.ap)) unit.ap = unit.apMax;

  // Armor
  if (!Number.isFinite(unit.armorPoints)) unit.armorPoints = 0;
  if (!Number.isFinite(unit.tempArmorBonus)) unit.tempArmorBonus = 0;
  if (!unit.armorClass) unit.armorClass = 'NONE';

  unit.status = unit.status || {};
}

export function canSpendAp(unit, n = 1) {
  ensureUnitCombatFields(unit);
  return (unit.ap || 0) >= n;
}

export function spendAp(unit, n = 1) {
  ensureUnitCombatFields(unit);
  if ((unit.ap || 0) < n) return false;
  unit.ap -= n;
  return true;
}

export function applyDefence(unit) {
  ensureUnitCombatFields(unit);

  if (!canSpendAp(unit, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  // Consume all points
  unit.mp = 0;
  unit.ap = 0;

  // +1 armor for the rest of the turn
  unit.tempArmorBonus = (unit.tempArmorBonus || 0) + 1;

  // Heal 10% max HP
  const maxHp = Number.isFinite(unit.maxHp) ? unit.maxHp : 0;
  const heal = Math.max(0, Math.round(maxHp * 0.10));
  unit.hp = Math.min(maxHp, (unit.hp || 0) + heal);

  unit.status.defending = true;

  return { ok: true, heal, tempArmorBonus: unit.tempArmorBonus };
}

export function clearTurnTempBonuses(unit) {
  ensureUnitCombatFields(unit);
  unit.tempArmorBonus = 0;
  if (unit.status) {
    unit.status.defending = false;
  }
}

export default {
  ensureUnitCombatFields,
  canSpendAp,
  spendAp,
  applyDefence,
  clearTurnTempBonuses,
};
