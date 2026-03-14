// src/units/CombatResolver.js
//
// Pure combat math. No Phaser imports.
//
// Updated for multi-channel weapon damage:
// - each weapon can deal several damage types in one hit
// - each channel is reduced by armor, resist, and effects independently
// - final damage is the rounded sum of all channels

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

function getResistValue(defender, damageType) {
  const dt = String(damageType || 'physical').toLowerCase();
  const res = defender?.resists && typeof defender.resists === 'object' ? defender.resists : null;
  const v = res ? res[dt] : 0;
  return Number.isFinite(v) ? v : 0;
}

function getDamageMap(weaponDef) {
  if (weaponDef?.damage && typeof weaponDef.damage === 'object') {
    return weaponDef.damage;
  }
  const dt = String(weaponDef?.damageType || 'physical').toLowerCase();
  return { [dt]: Number(weaponDef?.baseDamage) || 0 };
}

export function resolveAttack(attacker, defender, weaponId) {
  try {
    const w = getWeaponDef(weaponId);
    if (!w) {
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
        perType: {},
      };
    }

    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);
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

    const baseArmorPts = Number.isFinite(defender.armorPoints) ? defender.armorPoints : 0;
    const bonus = Number.isFinite(defender.tempArmorBonus) ? defender.tempArmorBonus : 0;
    const armorPtsEffective = baseArmorPts + bonus;
    const armorPointsMult = armorPointsMultiplier(armorPtsEffective);

    const mods = computeEffectModifiers(defender);
    const globalTakenPct = Number.isFinite(mods?.damageTakenPct) ? mods.damageTakenPct : 0;
    const perTypeTaken = mods?.perTypeDamageTakenPct && typeof mods.perTypeDamageTakenPct === 'object'
      ? mods.perTypeDamageTakenPct
      : {};

    const damageMap = getDamageMap(w);
    const perType = {};
    let finalFloat = 0;
    let primaryDamageType = w.damageType || 'physical';
    let highestChannel = -1;
    let resistValue = 0;
    let resistMult = 1;
    let effectTakenMult = 1;

    for (const [damageType, rawBase] of Object.entries(damageMap)) {
      const baseChannel = Number(rawBase) || 0;
      if (baseChannel <= 0) continue;

      const channelResistValue = getResistValue(defender, damageType);
      const channelResistMult = armorPointsMultiplier(channelResistValue);
      const channelPerTypePct = Number.isFinite(perTypeTaken?.[damageType]) ? perTypeTaken[damageType] : 0;
      const channelEffectTakenMult = 1 + (globalTakenPct + channelPerTypePct) / 100;
      const channelDamage = baseChannel * groupMult * armorClassMult * distanceMult * armorPointsMult * channelResistMult * channelEffectTakenMult;

      perType[damageType] = {
        baseDamage: baseChannel,
        resistValue: channelResistValue,
        resistMult: channelResistMult,
        effectTakenMult: channelEffectTakenMult,
        finalDamage: Math.max(0, Math.round(channelDamage)),
      };

      if (baseChannel > highestChannel) {
        highestChannel = baseChannel;
        primaryDamageType = damageType;
        resistValue = channelResistValue;
        resistMult = channelResistMult;
        effectTakenMult = channelEffectTakenMult;
      }

      finalFloat += channelDamage;
    }

    const baseDamage = Number.isFinite(w.baseDamage)
      ? w.baseDamage
      : Object.values(damageMap).reduce((a, b) => a + (Number(b) || 0), 0);

    const finalDamage = Math.max(0, Math.round(finalFloat));

    __t('RESOLVE_OK', {
      weaponId: w.id,
      dist,
      baseDamage,
      damageMap,
      groupMult,
      armorClassMult,
      distanceMult,
      armorPointsMult,
      finalDamage,
      perType,
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
      damageType: primaryDamageType,
      perType,
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
      perType: {},
    };
  }
}

export function validateAttack(attacker, defender, weaponId) {
  try {
    const w = getWeaponDef(weaponId);
    if (!w) return { ok: false, reason: 'bad_weapon' };

    const rmin = Number.isFinite(w.rangeMin) ? w.rangeMin : 1;
    const rmax = Number.isFinite(w.rangeMax) ? w.rangeMax : rmin;
    const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

    if (!Number.isFinite(dist)) return { ok: false, reason: 'bad_distance' };
    if (dist < rmin) return { ok: false, reason: 'too_close', distance: dist };
    if (dist > rmax) return { ok: false, reason: 'out_of_range', distance: dist };
    return { ok: true, distance: dist };
  } catch (_) {
    return { ok: false, reason: 'exception' };
  }
}
