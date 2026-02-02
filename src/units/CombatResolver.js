// src/units/CombatResolver.js
//
// Pure combat math. No Phaser imports.
//
// Stage B rules:
// - Damage = baseDamage * groupMult * armorClassMultiplier * distanceMultiplier * armorPointsMultiplier * resistMultiplier * effectTakenMultiplier
// - armorPointsMultiplier = 1 - 0.05 * armorPointsEffective
// - resistMultiplier uses the SAME curve as armor points (1 - 0.05 * resistValue) by design (temporary, can be tuned later)
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
import { computeEffectModifiers } from '../effects/EffectEngine.js';

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

function asInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

/**
 * Read resist value from defender by damage type.
 * Expected runtime shape: defender.resists = { physical, thermal, toxic, cryo, radiation, energy, corrosion }
 * Missing keys -> 0.
 */
function getResistValue(defender, damageType) {
  const dt = String(damageType || 'physical').toLowerCase();
  const res = defender?.resists && typeof defender.resists === 'object' ? defender.resists : null;
  const v = res ? res[dt] : 0;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Determine weapon damage type:
 * - if weapon def has damageType -> use it
 * - otherwise default to 'physical' (until per-weapon types are added)
 */
function getWeaponDamageType(weaponDef) {
  const dt = weaponDef?.damageType;
  if (!dt) return 'physical';
  return String(dt).toLowerCase();
}

/**
 * @typedef CombatResult
 * @property {number} distance
 * @property {number} baseDamage
 * @property {number} groupMult
 * @property {number} armorClassMult
 * @property {number} distanceMult
 * @property {number} armorPointsMult
 * @property {number} resistValue
 * @property {number} resistMult
 * @property {number} effectTakenMult
 * @property {number} finalDamage
 * @property {string} weaponId
 * @property {string} damageType
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
        groupMult: 1,
        armorClassMult: 1,
        distanceMult: 1,
        armorPointsMult: 1,
        resistValue: 0,
        resistMult: 1,
        effectTakenMult: 1,
        finalDamage: 0,
        weaponId,
        damageType: 'physical',
      };
    }

    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

    // Damage type (default physical until WeaponDefs adds explicit types)
    const damageType = getWeaponDamageType(w);

    // Group multiplier (infantry squads scale damage by alive members)
    const groupSize = asInt(attacker?.groupSize, 1);
    const groupAlive = asInt(attacker?.groupAlive, groupSize);
    const groupMult = groupSize > 1 ? Math.max(0, Math.min(1, groupAlive / groupSize)) : 1;

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

    // Resist multiplier (per damage type, uses same curve as armor points for now)
    const resistValue = getResistValue(defender, damageType);
    const resistMult = armorPointsMultiplier(resistValue);

    // Effect-based damage taken multiplier (global + per-type)
    const mods = computeEffectModifiers(defender);
    const globalTakenPct = Number.isFinite(mods?.damageTakenPct) ? mods.damageTakenPct : 0;
    const perType = mods?.perTypeDamageTakenPct && typeof mods.perTypeDamageTakenPct === 'object'
      ? mods.perTypeDamageTakenPct
      : {};
    const perTypePct = Number.isFinite(perType?.[damageType]) ? perType[damageType] : 0;

    // Convert pct points to multiplier
    const effectTakenMult = (1 + (globalTakenPct + perTypePct) / 100);

    const baseDamage = Number.isFinite(w.baseDamage) ? w.baseDamage : 0;

    const raw = baseDamage * groupMult * armorClassMult * distanceMult * armorPointsMult * resistMult * effectTakenMult;
    const finalDamage = Math.max(0, Math.round(raw));

    __t('RESOLVE_OK', {
      weaponId: w.id,
      dist,
      damageType,
      baseDamage,
      groupMult,
      armorClassMult,
      distanceMult,
      armorPointsMult,
      resistValue,
      resistMult,
      effectTakenMult,
      finalDamage,
    });

    return {
      distance: dist,
      baseDamage,
      groupMult,
      armorClassMult,
      distanceMult,
      armorPointsMult,
      resistValue,
      resistMult,
      effectTakenMult,
      finalDamage,
      weaponId: w.id,
      damageType,
    };
  } catch (e) {
    __t('RESOLVE_EX', { weaponId, msg: String(e?.message || e) });
    return {
      distance: NaN,
      baseDamage: 0,
      groupMult: 1,
      armorClassMult: 1,
      distanceMult: 1,
      armorPointsMult: 1,
      resistValue: 0,
      resistMult: 1,
      effectTakenMult: 1,
      finalDamage: 0,
      weaponId,
      damageType: 'physical',
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
