// src/units/UnitTurn.js
//
// Turn-cycle helpers for unit MP/AP refresh.
// Stage A: refreshes MP/AP for the active player's units.
// Stage B: resets temporary combat statuses (defence bonus).

import { syncLegacyMovementFields } from './UnitFactory.js';

/**
 * Refresh MP/AP of units owned by the given turn owner.
 *
 * Compatibility notes:
 * - Existing game identifies current player by display name (turnOwner).
 * - Units spawned by WorldSceneUnits set unit.playerName / unit.playerId.
 *
 * @param {any} scene
 * @param {string} turnOwnerName
 */
export function refreshUnitsForTurn(scene, turnOwnerName) {
  if (!scene || !turnOwnerName) return;

  const all = scene.units || [];
  for (const u of all) {
    if (!u) continue;

    const ownerName = u.playerName || u.name || null;
    // Only refresh units controlled by that player
    if (ownerName !== turnOwnerName) continue;

    // Canonical MP/AP
    if (Number.isFinite(u.mpMax)) u.mp = u.mpMax;
    if (Number.isFinite(u.apMax)) u.ap = u.apMax;

    // Reset temporary statuses (Stage B)
    if (Number.isFinite(u.tempArmorBonus)) u.tempArmorBonus = 0;
    if (u.status && typeof u.status === 'object') {
      delete u.status.defending;
    }

    syncLegacyMovementFields(u);
  }
}
