// src/units/ArmorDefs.js
//
// Armor class + armor points rules.
//
// Rule: each armor point reduces incoming damage by 5%.
// Additionally, weapons may have effectiveness multipliers against armor classes.
//
// NORMAL was added for the new roster. It is the default human / infantry armor class
// used by many of the new units. Legacy LIGHT / MEDIUM / HEAVY remain supported.

export const ARMOR_CLASSES = /** @type {const} */ ({
  NONE: 'NONE',
  LIGHT: 'LIGHT',
  MEDIUM: 'MEDIUM',
  NORMAL: 'NORMAL',
  HEAVY: 'HEAVY',
});

/**
 * Compute reduction multiplier from armor points (and optional temporary bonus).
 * Each point => -5% incoming.
 *
 * @param {number} armorPoints
 * @returns {number} multiplier in [0..1]
 */
export function armorPointsMultiplier(armorPoints) {
  const ap = Number.isFinite(armorPoints) ? armorPoints : 0;
  const m = 1 - ap * 0.05;
  return Math.max(0, Math.min(1, m));
}
