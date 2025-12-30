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
// __COMBAT_DEBUG__ (auto-instrumentation)
// Toggle in devtools: window.__COMBAT_DEBUG_ENABLED__ = true/false
// ---------------------------------------------------------------------------
const __DBG_ENABLED__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_DEBUG_ENABLED__ ?? true) : true);
function __dbg_ts() {
  try { return new Date().toISOString().slice(11, 23); } catch (_) { return ''; }
}
function __dbg(tag, data) {
  if (!__DBG_ENABLED__()) return;
  try { console.log('[' + tag + '] ' + __dbg_ts(), data); } catch (_) {}
}
function __dbg_group(tag, title, data) {
  if (!__DBG_ENABLED__()) return;
  try {
    console.groupCollapsed('[' + tag + '] ' + __dbg_ts() + ' ' + title);
    if (data !== undefined) console.log(data);
  } catch (_) {}
}
function __dbg_group_end() {
  if (!__DBG_ENABLED__()) return;
  try { console.groupEnd(); } catch (_) {}
}

import { armorPointsMultiplier, ARMOR_CLASSES } from './ArmorDefs.js';
import { getWeaponDef } from './WeaponDefs.js';

function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
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
  __dbg_group('COMBAT:resolve', 'start', { attacker: { id: attacker?.unitId ?? attacker?.id, ap: attacker?.ap }, defender: { id: defender?.unitId ?? defender?.id, hp: defender?.hp }, weaponId });
  const w = getWeaponDef(weaponId);

  const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

  // Armor class multiplier
  const armorClass = defender.armorClass || ARMOR_CLASSES.NONE;
  const acMultRaw = w.armorClassMult?.[armorClass];
  const armorClassMult = Number.isFinite(acMultRaw) ? acMultRaw : 1.0;

  // Distance multiplier (SMG)
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

  __dbg_group_end();
  __dbg('COMBAT:resolve:computed', { damage, hit, crit, finalDamage });
  __dbg_group_end();
  return {
    distance: dist,
    baseDamage,
    armorClassMult,
    distanceMult,
    armorPointsMult,
    finalDamage,
    weaponId: w.id,
  };
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
  __dbg_group('COMBAT:validate', 'start', { attacker: { id: attacker?.unitId ?? attacker?.id, type: attacker?.type, q: attacker?.q, r: attacker?.r, ap: attacker?.ap, faction: attacker?.faction }, defender: { id: defender?.unitId ?? defender?.id, type: defender?.type, q: defender?.q, r: defender?.r, hp: defender?.hp, faction: defender?.faction }, weaponId });
  const w = getWeaponDef(weaponId);
  const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

  if (!Number.isFinite(dist)) __dbg_group_end();
  return { ok: false, reason: 'bad_distance' };
  if (dist < w.rangeMin) __dbg_group_end();
  return { ok: false, reason: 'too_close', distance: dist };
  if (dist > w.rangeMax) __dbg_group_end();
  return { ok: false, reason: 'out_of_range', distance: dist };

  __dbg_group_end();
  return { ok: true, distance: dist };
}
