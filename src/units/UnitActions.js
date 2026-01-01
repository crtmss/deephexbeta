// src/units/UnitActions.js
//
// Stage B/C: Unit actions used by UI + input.
//
// Implemented actions:
//  - move        (handled by WorldScene movement system)
//  - attack      (AP cost + validation, damage resolved elsewhere)
//  - defence     (consume MP+AP, +1 armor, heal 10% HP)
//  - turn        (free, handled by UI)
//  - convoy/hide (placeholders)
//
// IMPORTANT:
//  - This file contains ONLY rule logic (no Phaser, no rendering)
//  - Damage calculation will later be delegated to CombatResolver.js

// ---------------------------------------------------------------------------
// __COMBAT_DEBUG__ (auto-instrumentation)
// Toggle in devtools: window.__COMBAT_DEBUG_ENABLED__ = true/false
// ---------------------------------------------------------------------------
const __DBG_ENABLED__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_DEBUG_ENABLED__ ?? true) : true);
function __dbg_ts() { try { return new Date().toISOString().slice(11, 23); } catch (_) { return ''; } }
function __dbg(tag, data) { if (!__DBG_ENABLED__()) return; try { console.log('[' + tag + '] ' + __dbg_ts(), data); } catch (_) {} }
function __dbg_group(tag, title, data) {
  if (!__DBG_ENABLED__()) return;
  try { console.groupCollapsed('[' + tag + '] ' + __dbg_ts() + ' ' + title); if (data !== undefined) console.log(data); } catch (_) {}
}
function __dbg_group_end() { if (!__DBG_ENABLED__()) return; try { console.groupEnd(); } catch (_) {} }

import { getWeaponDef } from './WeaponDefs.js';

/* =========================================================
   Core normalization
   ========================================================= */

export function ensureUnitCombatFields(unit) {
  __dbg('COMBAT:ensureFields', { id: unit?.unitId ?? unit?.id, type: unit?.type, hp: unit?.hp, maxHp: unit?.maxHp, ap: unit?.ap, maxAp: unit?.maxAp, faction: unit?.faction });
  if (!unit) return;

  // HP
  if (!Number.isFinite(unit.maxHp) && Number.isFinite(unit.hp)) unit.maxHp = unit.hp;
  if (!Number.isFinite(unit.hp)) unit.hp = Number.isFinite(unit.maxHp) ? unit.maxHp : 0;
  if (!Number.isFinite(unit.maxHp)) unit.maxHp = unit.hp;

  // Movement
  if (!Number.isFinite(unit.mp) && Number.isFinite(unit.movementPoints)) unit.mp = unit.movementPoints;
  if (!Number.isFinite(unit.mpMax) && Number.isFinite(unit.maxMovementPoints)) unit.mpMax = unit.maxMovementPoints;
  if (!Number.isFinite(unit.mp)) unit.mp = 0;
  if (!Number.isFinite(unit.mpMax)) unit.mpMax = unit.mp;

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

  // Status flags
  unit.status = unit.status || {};
}

/* =========================================================
   AP helpers
   ========================================================= */

export function canSpendAp(unit, n = 1) {
  ensureUnitCombatFields(unit);
  return (unit.ap || 0) >= n;
}

export function spendAp(unit, n = 1) {
  __dbg('COMBAT:spendAp', { id: unit?.unitId ?? unit?.id, ap: unit?.ap, n });
  ensureUnitCombatFields(unit);
  if ((unit.ap || 0) < n) return false;
  unit.ap -= n;
  return true;
}

/* =========================================================
   Defence action
   ========================================================= */

export function applyDefence(unit) {
  ensureUnitCombatFields(unit);

  if (!canSpendAp(unit, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  // Consume everything
  unit.mp = 0;
  unit.ap = 0;

  // +1 armor until end of turn
  unit.tempArmorBonus = (unit.tempArmorBonus || 0) + 1;

  // Heal 10% max HP
  const maxHp = Number.isFinite(unit.maxHp) ? unit.maxHp : 0;
  const heal = Math.max(0, Math.round(maxHp * 0.10));
  unit.hp = Math.min(maxHp, (unit.hp || 0) + heal);

  unit.status.defending = true;

  return {
    ok: true,
    heal,
    tempArmorBonus: unit.tempArmorBonus,
  };
}

/* =========================================================
   Attack action (NEW — REQUIRED BY WorldSceneUI)
   ========================================================= */

export function applyAttack(attacker, target, opts = {}) {
  ensureUnitCombatFields(attacker);
  ensureUnitCombatFields(target);

  // Basic validation
  if (!attacker || !target) {
    return { ok: false, reason: 'invalid_target' };
  }

  if (!canSpendAp(attacker, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  // Select weapon
  const weapons = attacker.weapons || [];
  const idx = Number.isFinite(attacker.activeWeaponIndex)
    ? attacker.activeWeaponIndex
    : 0;

  const weaponId = weapons[idx] || weapons[0];
  if (!weaponId) {
    return { ok: false, reason: 'no_weapon' };
  }

  const weapon = getWeaponDef(weaponId);

  // Distance check (hex distance must be provided by caller)
  const dist = Number.isFinite(opts.distance) ? opts.distance : null;
  if (dist != null) {
    if (dist < weapon.rangeMin || dist > weapon.rangeMax) {
      return { ok: false, reason: 'out_of_range' };
    }
  }

  // Spend AP (damage resolution later)
  spendAp(attacker, 1);

  attacker.status.attackedThisTurn = true;

  // NOTE:
  // Actual damage calculation will be done in CombatResolver.js
  // For now we only return an intent object.

  return {
    ok: true,
    weaponId,
    baseDamage: weapon.baseDamage,
    armorClassMult: weapon.armorClassMult,
    distanceCurve: weapon.distanceCurve || {},
    attacker,
    target,
  };
}

/* =========================================================
   Turn cleanup
   ========================================================= */

export function clearTurnTempBonuses(unit) {
  ensureUnitCombatFields(unit);

  unit.tempArmorBonus = 0;

  if (unit.status) {
    unit.status.defending = false;
    unit.status.attackedThisTurn = false;
  }
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
