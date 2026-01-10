// src/units/CombatResolver.js
//
// Pure combat math. No Phaser imports.
//
// Stage B rules:
// - Damage = baseDamage * armorClassMultiplier * distanceMultiplier * armorPointsMultiplier
// - armorPointsMultiplier = 1 - 0.05 * armorPointsEffective
// - SMG distance curve: dist=1 => +25%, dist=2 => -25%
// - Final damage is rounded to nearest int (Math.round) and clamped >= 0
// ---------------------------------------------------------------------------
// __COMBAT_TRACE__ (compact logs)
// Enable/disable in DevTools: window.__COMBAT_TRACE__ = true/false
// ---------------------------------------------------------------------------
const __TRACE_ON__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_TRACE__ ?? true) : true);
function __t(tag, data) {
  if (!__TRACE_ON__()) return;
  try { console.log(`[COMBAT:${tag}]`, data); } catch (_) {}
}

import { armorPointsMultiplier, ARMOR_CLASSES } from './ArmorDefs.js';
import { getWeaponDef } from './WeaponDefs.js';

function hexDistance(q1, r1, q2, r2) {
  // ODD-R offset coordinates → cube distance
  const toCube = (q, r) => {
    const x = q - ((r - (r & 1)) / 2);
    const z = r;
    const y = -x - z;
    return { x, y, z };
  };
  const a = toCube(q1, r1);
  const b = toCube(q2, r2);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/**
 * @typedef CombatResult
 * @property {number} distance
 * @property {number} baseDamage
 * @property {number} armorClassMult
 * @property {number} distanceMult
 * @property {number} armorPointsMult
 * @property {number} finalDamage
 * @property {string} weaponId
 */

/**
 * Compute damage from attacker -> defender using weapon.
 *
 * @param {any} attacker
 * @param {any} defender
 * @param {string} weaponId
 * @returns {CombatResult}
 */
export function resolveAttack(attacker, defender, weaponId) {
  try {
    const w = getWeaponDef(weaponId);
    if (!w) {
      __t('RESOLVE_ERR', { weaponId, reason: 'bad_weapon' });
      return {
        distance: NaN,
        baseDamage: 0,
        armorClassMult: 1,
        distanceMult: 1,
        armorPointsMult: 1,
        finalDamage: 0,
        weaponId,
      };
    }

    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

    // Armor class multiplier
    const armorClass = defender.armorClass || ARMOR_CLASSES.NONE;
    const acMultRaw = w.armorClassMult?.[armorClass];
    const armorClassMult = Number.isFinite(acMultRaw) ? acMultRaw : 1.0;

    // Distance multiplier (SMG curve)
    let distanceMult = 1.0;
    if (w.distanceCurve && Number.isFinite(dist)) {
      if (dist === 1 && Number.isFinite(w.distanceCurve.dist1)) distanceMult = w.distanceCurve.dist1;
      if (dist === 2 && Number.isFinite(w.distanceCurve.dist2)) distanceMult = w.distanceCurve.dist2;
    }

    // Armor points multiplier (include defence bonus if present)
    const baseArmorPts = Number.isFinite(defender.armorPoints) ? defender.armorPoints : 0;
    const bonus = Number.isFinite(defender.tempArmorBonus) ? defender.tempArmorBonus : 0;
    const armorPtsEffective = baseArmorPts + bonus;
    const armorPointsMult = armorPointsMultiplier(armorPtsEffective);

    const baseDamage = w.baseDamage || 0;
    const raw = baseDamage * armorClassMult * distanceMult * armorPointsMult;
    const finalDamage = Math.max(0, Math.round(raw));

    __t('RESOLVE_OK', { weaponId: w.id, dist, finalDamage });
    return {
      distance: dist,
      baseDamage,
      armorClassMult,
      distanceMult,
      armorPointsMult,
      finalDamage,
      weaponId: w.id,
    };
  } catch (e) {
    __t('RESOLVE_EX', { weaponId, msg: String(e?.message || e) });
    return {
      distance: NaN,
      baseDamage: 0,
      armorClassMult: 1,
      distanceMult: 1,
      armorPointsMult: 1,
      finalDamage: 0,
      weaponId,
    };
  }
}

/**
 * Validate that attack is in range of the current weapon.
 *
 * @param {any} attacker
 * @param {any} defender
 * @param {string} weaponId
 * @returns {{ok: boolean, reason?: string, distance?: number}}
 */
export function validateAttack(attacker, defender, weaponId) {
  try {
    const w = getWeaponDef(weaponId);
    if (!w) {
      __t('VALIDATE', { ok: false, reason: 'bad_weapon', weaponId });
      return { ok: false, reason: 'bad_weapon' };
    }

    const rmin = Number.isFinite(w.rangeMin) ? w.rangeMin : 1;
    const rmax = Number.isFinite(w.rangeMax) ? w.rangeMax : rmin;
    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

    if (!Number.isFinite(dist)) {
      __t('VALIDATE', { ok: false, reason: 'bad_distance', weaponId });
      return { ok: false, reason: 'bad_distance' };
    }

    if (dist < rmin) {
      __t('VALIDATE', { ok: false, reason: 'too_close', dist, rmin, rmax, weaponId });
      return { ok: false, reason: 'too_close', distance: dist };
    }

    if (dist > rmax) {
      __t('VALIDATE', { ok: false, reason: 'out_of_range', dist, rmin, rmax, weaponId });
      return { ok: false, reason: 'out_of_range', distance: dist };
    }

    __t('VALIDATE', { ok: true, dist, rmin, rmax, weaponId });
    return { ok: true, distance: dist };
  } catch (e) {
    __t('VALIDATE_EX', { weaponId, msg: String(e?.message || e) });
    return { ok: false, reason: 'exception' };
  }
}
