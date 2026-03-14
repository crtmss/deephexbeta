// src/units/CombatResolver.js
//
// Pure combat math. No Phaser imports.
// Updated to consume effect-based damage taken / damage dealt / resist bonuses.

const __TRACE_ON__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_TRACE__ ?? true) : true);
function __t(tag, data) {
  if (!__TRACE_ON__()) return;
  try { console.log(`[COMBAT:${tag}]`, data); } catch (_) {}
}

import { armorPointsMultiplier, ARMOR_CLASSES } from './ArmorDefs.js';
import { getWeaponDef } from './WeaponDefs.js';
import { computeEffectModifiers } from '../effects/EffectEngine.js';

function hexDistance(q1, r1, q2, r2) {
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

function normalizeDamageType(dt) {
  const key = String(dt || 'physical').toLowerCase();
  return key === 'corrosive' ? 'corrosion' : key;
}

function getResistValue(defender, damageType) {
  const dt = normalizeDamageType(damageType);
  const res = defender?.resists && typeof defender.resists === 'object' ? defender.resists : null;
  const base = res && Number.isFinite(res[dt]) ? res[dt] : 0;
  const mods = computeEffectModifiers(defender);
  const bonus = Number.isFinite(mods?.resistDeltaByType?.[dt]) ? mods.resistDeltaByType[dt] : 0;
  return base + bonus;
}

function getWeaponDamageType(weaponDef) {
  const dt = weaponDef?.damageType;
  return normalizeDamageType(dt || 'physical');
}

export function resolveAttack(attacker, defender, weaponId) {
  try {
    const w = getWeaponDef(weaponId);
    if (!w) {
      return {
        distance: NaN, baseDamage: 0, groupMult: 1, armorClassMult: 1, distanceMult: 1,
        armorPointsMult: 1, resistValue: 0, resistMult: 1, effectTakenMult: 1,
        effectDealtMult: 1, finalDamage: 0, weaponId, damageType: 'physical',
      };
    }

    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);
    const damageType = getWeaponDamageType(w);

    const groupSize = asInt(attacker?.groupSize, 1);
    const groupAlive = asInt(attacker?.groupAlive, groupSize);
    const groupMult = groupSize > 1 ? Math.max(0, Math.min(1, groupAlive / groupSize)) : 1;

    const armorClass = defender.armorClass || ARMOR_CLASSES.NONE;
    const acMultRaw = w.armorClassMult?.[armorClass];
    const armorClassMult = Number.isFinite(acMultRaw) ? acMultRaw : 1.0;

    let distanceMult = 1.0;
    if (w.distanceCurve && Number.isFinite(dist)) {
      if (dist === 1 && Number.isFinite(w.distanceCurve.dist1)) distanceMult = w.distanceCurve.dist1;
      if (dist === 2 && Number.isFinite(w.distanceCurve.dist2)) distanceMult = w.distanceCurve.dist2;
      if (dist === 3 && Number.isFinite(w.distanceCurve.dist3)) distanceMult = w.distanceCurve.dist3;
    }

    const defenderMods = computeEffectModifiers(defender);
    const attackerMods = computeEffectModifiers(attacker);

    const baseArmorPts = Number.isFinite(defender.armorPoints) ? defender.armorPoints : 0;
    const tempArmor = Number.isFinite(defender.tempArmorBonus) ? defender.tempArmorBonus : 0;
    const effectArmor = Number.isFinite(defenderMods?.armor) ? defenderMods.armor : 0;
    const armorPtsEffective = baseArmorPts + tempArmor + effectArmor;
    const armorPointsMult = armorPointsMultiplier(armorPtsEffective);

    const resistValue = getResistValue(defender, damageType);
    const resistMult = armorPointsMultiplier(resistValue);

    const takenPct = (defenderMods?.damageTakenPctByType?.[damageType] || 0) + (defenderMods?.damageTakenPctByType?.all || 0);
    const dealtPct = (attackerMods?.damageDealtPctByType?.[damageType] || 0) + (attackerMods?.damageDealtPctByType?.all || 0);
    const effectTakenMult = 1 + takenPct / 100;
    const effectDealtMult = 1 + dealtPct / 100;

    const baseDamage = Number.isFinite(w.baseDamage) ? w.baseDamage : 0;
    const raw = baseDamage * groupMult * armorClassMult * distanceMult * armorPointsMult * resistMult * effectTakenMult * effectDealtMult;
    const finalDamage = Math.max(0, Math.round(raw));

    __t('RESOLVE_OK', {
      weaponId: w.id, dist, damageType, baseDamage, groupMult, armorClassMult, distanceMult,
      armorPointsMult, resistValue, resistMult, effectTakenMult, effectDealtMult, finalDamage,
    });

    return {
      distance: dist, baseDamage, groupMult, armorClassMult, distanceMult, armorPointsMult,
      resistValue, resistMult, effectTakenMult, effectDealtMult, finalDamage, weaponId: w.id, damageType,
    };
  } catch (e) {
    __t('RESOLVE_EX', { weaponId, msg: String(e?.message || e) });
    return {
      distance: NaN, baseDamage: 0, groupMult: 1, armorClassMult: 1, distanceMult: 1,
      armorPointsMult: 1, resistValue: 0, resistMult: 1, effectTakenMult: 1,
      effectDealtMult: 1, finalDamage: 0, weaponId, damageType: 'physical',
    };
  }
}

export function validateAttack(attacker, defender, weaponId) {
  try {
    const w = getWeaponDef(weaponId);
    if (!w) return { ok: false, reason: 'bad_weapon' };
    const rmin = Number.isFinite(w.rangeMin) ? w.rangeMin : 1;
    const rmaxBase = Number.isFinite(w.rangeMax) ? w.rangeMax : rmin;
    const rangeDelta = Number(computeEffectModifiers(attacker)?.range || 0);
    const isMelee = rmaxBase <= 1;
    const rmax = isMelee ? rmaxBase : Math.max(rmin, rmaxBase + rangeDelta);
    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);
    if (!Number.isFinite(dist)) return { ok: false, reason: 'bad_distance' };
    if (dist < rmin) return { ok: false, reason: 'too_close', distance: dist };
    if (dist > rmax) return { ok: false, reason: 'out_of_range', distance: dist };
    return { ok: true, distance: dist };
  } catch {
    return { ok: false, reason: 'exception' };
  }
}
