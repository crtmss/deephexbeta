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
import { validateAttack, resolveAttack } from './CombatResolver.js';

function axialDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

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

/* ===export function applyAttack(attacker, target, opts = {}) {
  ensureUnitCombatFields(attacker);
  ensureUnitCombatFields(target);

  // Basic validation
  if (!attacker || !target) {
    return { ok: false, reason: 'invalid_target' };
  }

  // AP gate
  if (!canSpendAp(attacker, 1)) {
    return { ok: false, reason: 'no_ap' };
  }

  // Select weapon
  const weapons = attacker.weapons || [];
  const idx = Number.isFinite(attacker.activeWeaponIndex) ? attacker.activeWeaponIndex : 0;
  const weaponId = weapons[idx] || weapons[0];
  if (!weaponId) {
    return { ok: false, reason: 'no_weapon' };
  }

  const weapon = getWeaponDef(weaponId);
  if (!weapon) {
    return { ok: false, reason: 'bad_weapon' };
  }

  // Distance (caller may provide, else compute axial)
  const dist =
    Number.isFinite(opts.distance)
      ? opts.distance
      : ((Number.isFinite(attacker.q) && Number.isFinite(attacker.r) && Number.isFinite(target.q) && Number.isFinite(target.r))
          ? axialDistance(attacker.q, attacker.r, target.q, target.r)
          : NaN);

  // Validate range via CombatResolver rules when available (falls back to simple range checks)
  try {
    const v = validateAttack(attacker, target, weaponId);
    if (!v?.ok) return { ok: false, reason: v?.reason || 'invalid_attack', distance: v?.distance ?? dist };
  } catch (_) {
    // Fallback: simple range check
    if (Number.isFinite(dist)) {
      const rmin = Number.isFinite(weapon.rangeMin) ? weapon.rangeMin : 1;
      const rmax = Number.isFinite(weapon.rangeMax) ? weapon.rangeMax : rmin;
      if (dist < rmin) return { ok: false, reason: 'too_close', distance: dist };
      if (dist > rmax) return { ok: false, reason: 'out_of_range', distance: dist };
    }
  }

  // Spend AP (authoritative)
  spendAp(attacker, 1);

  // Compute damage
  let dmg = 0;
  let result = null;
  try {
    result = resolveAttack(attacker, target, weaponId);
    dmg = Number.isFinite(result?.damage) ? result.damage : (Number.isFinite(result?.finalDamage) ? result.finalDamage : 0);
  } catch (_) {
    // Fallback: baseDamage only
    dmg = Number.isFinite(weapon.baseDamage) ? weapon.baseDamage : 0;
  }
  if (!Number.isFinite(dmg)) dmg = 0;

  const hpBefore = Number.isFinite(target.hp) ? target.hp : 0;
  target.hp = Math.max(0, hpBefore - dmg);

  const killed = target.hp <= 0;

  const attackerId = attacker.id ?? attacker.unitId ?? attacker.uuid ?? attacker.netId ?? `${attacker.unitName || attacker.name}@${attacker.q},${attacker.r}`;
  const defenderId = target.id ?? target.unitId ?? target.uuid ?? target.netId ?? `${target.unitName || target.name}@${target.q},${target.r}`;

  const event = {
    type: 'combat:attack',
    attackerId: String(attackerId),
    defenderId: String(defenderId),
    damage: dmg,
    weaponId,
  };

  return {
    ok: true,
    weaponId,
    distance: dist,
    damage: dmg,
    hpBefore,
    hpAfter: target.hp,
    killed,
    event,
    result,
  };
}
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
