// src/units/UnitTurn.js
//
// Turn-cycle helpers for unit MP/AP refresh.
// Stage A: refreshes MP/AP for the active player's units.
// Stage B: resets temporary combat statuses (defence bonus).
//
// Stage C (added): tick & manage status effects (buffs/debuffs).
// - turnStart ticks happen when a player's turn begins (refreshUnitsForTurn)
// - turnEnd ticks + duration decrement + cleanup should happen when a player's turn ends
//   (applyEndTurnForUnits) and be called by WorldScene.

import { syncLegacyMovementFields } from './UnitFactory.js';
import {
  tickUnitEffects,
  decrementUnitEffectDurations,
  cleanupExpiredUnitEffects,
  ensurePassiveEffects,
  syncUnitStatuses,
} from '../effects/EffectEngine.js';

import { getAbilityDef } from '../abilities/AbilityDefs.js';

/**
 * Refresh MP/AP of units owned by the given turn owner.
 *
 * Compatibility notes:
 * - Existing game identifies current player by display name (turnOwner).
 * - Units spawned by WorldSceneUnits set unit.playerName / unit.playerId.
 *
 * Stage C:
 * - ensures passive effects exist (infinite duration)
 * - ticks unit effects at turnStart (DoTs/Regen/etc)
 * - keeps unit.statuses in sync (max 10 handled by EffectEngine)
 *
 * @param {any} scene
 * @param {string} turnOwnerName
 * @returns {Array<any>} effect events (optional use by host/runtime)
 */
export function refreshUnitsForTurn(scene, turnOwnerName) {
  if (!scene || !turnOwnerName) return [];

  const events = [];
  const all = scene.units || [];

  const ctx = {
    turnOwner: turnOwnerName,
    turnNumber: Number.isFinite(scene.turnNumber) ? scene.turnNumber : null,
  };

  for (const u of all) {
    if (!u) continue;

    const ownerName = u.playerName || u.name || null;
    // Only refresh units controlled by that player
    if (ownerName !== turnOwnerName) continue;

    // Canonical MP/AP refresh
    if (Number.isFinite(u.mpMax)) u.mp = u.mpMax;
    if (Number.isFinite(u.apMax)) u.ap = u.apMax;

    // Reset temporary statuses (Stage B)
    if (Number.isFinite(u.tempArmorBonus)) u.tempArmorBonus = 0;
    if (u.status && typeof u.status === 'object') {
      delete u.status.defending;
    }

    // Stage C: ensure passives exist (infinite duration, not in status slots)
    // getAbilityDef is imported from AbilityDefs to avoid circular deps in EffectEngine.
    ensurePassiveEffects(u, getAbilityDef);

    // Tick turnStart effects (DoTs/Regen etc if configured)
    const ev = tickUnitEffects(u, 'turnStart', ctx);
    if (Array.isArray(ev) && ev.length) events.push(...ev);

    // Keep UI-status list in sync (temporary effects only, max 10)
    syncUnitStatuses(u);

    syncLegacyMovementFields(u);
  }

  return events;
}

/**
 * Apply end-of-turn processing for units of given owner:
 * - tick turnEnd effects
 * - decrement durations by 1
 * - cleanup expired effects
 *
 * This should be called by WorldScene when a player ends their turn.
 *
 * @param {any} scene
 * @param {string} turnOwnerName
 * @returns {Array<any>} effect events (optional use by host/runtime)
 */
export function applyEndTurnForUnits(scene, turnOwnerName) {
  if (!scene || !turnOwnerName) return [];

  const events = [];
  const all = scene.units || [];

  const ctx = {
    turnOwner: turnOwnerName,
    turnNumber: Number.isFinite(scene.turnNumber) ? scene.turnNumber : null,
  };

  for (const u of all) {
    if (!u) continue;

    const ownerName = u.playerName || u.name || null;
    if (ownerName !== turnOwnerName) continue;

    // Ensure passives still exist (cheap)
    ensurePassiveEffects(u, getAbilityDef);

    // Tick end-of-turn effects
    const ev = tickUnitEffects(u, 'turnEnd', ctx);
    if (Array.isArray(ev) && ev.length) events.push(...ev);

    // Decrement durations once per turn end
    decrementUnitEffectDurations(u);

    // Cleanup expired effects and sync statuses
    cleanupExpiredUnitEffects(u);
    syncUnitStatuses(u);

    syncLegacyMovementFields(u);
  }

  return events;
}
