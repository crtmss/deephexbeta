// src/scenes/WorldSceneCombatRuntime.js
//
// Stage E: Apply authoritative combat events to local state
// Stage F: Combat UX (floating damage numbers, death FX, combat log)
//
// This is called on ALL clients (host included)

import { spawnDamageNumber, spawnDeathFX } from './WorldSceneCombatFX.js';

export function applyCombatEvent(scene, event) {
  if (!scene || !event) return;
  if (event.type !== 'combat:attack') return;

  const {
    attackerId,
    defenderId,
    damage,
    weaponId,
  } = event;

  const attacker = findUnit(scene, attackerId);
  const defender = findUnit(scene, defenderId);

  if (!attacker || !defender) {
    console.warn('[COMBAT] Event references missing unit', event);
    return;
  }

  // Apply authoritative damage (clients apply; host may also apply for reconciliation safety)
  const hpBefore = Number.isFinite(defender.hp) ? defender.hp : (Number.isFinite(defender.maxHp) ? defender.maxHp : 0);
  defender.hp = Math.max(0, hpBefore - (Number.isFinite(damage) ? damage : 0));

  defender.lastHit = {
    by: attackerId,
    weaponId,
    damage,
  };

  // Stage F: floating damage number
  try {
    spawnDamageNumber(scene, defender.q, defender.r, Number.isFinite(damage) ? damage : 0);
  } catch (e) {
    // non-fatal
  }

  // Stage F: combat log -> History panel (optional)
  try {
    const attackerName = attacker.unitName || attacker.name || attacker.type || attackerId;
    const defenderName = defender.unitName || defender.name || defender.type || defenderId;

    const year =
      (typeof scene.getNextHistoryYear === 'function')
        ? scene.getNextHistoryYear()
        : 5000 + (Number.isFinite(scene.turnNumber) ? scene.turnNumber : 0);

    scene.addHistoryEntry?.({
      year,
      type: 'combat',
      q: defender.q,
      r: defender.r,
      text:
        `${attackerName} → ${defenderName}\n` +
        `Weapon: ${weaponId}\n` +
        `Damage: ${damage}`,
    });
  } catch (e) {
    // non-fatal
  }

  if (defender.hp <= 0) {
    defender.isDead = true;

    // Stage F: death FX
    try {
      spawnDeathFX(scene, defender);
    } catch (e) {}

    removeUnit(scene, defender);
  }

  // Hook for visuals / logs
  scene.onCombatResolved?.(event);
}

/* ========================================================= */

function findUnit(scene, netId) {
  const all =
    []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || []);

  return all.find(u =>
    String(
      u.id ??
      u.unitId ??
      u.uuid ??
      u.netId ??
      `${u.unitName || u.name}@${u.q},${u.r}`
    ) === String(netId)
  );
}

function removeUnit(scene, unit) {
  scene.units = (scene.units || []).filter(u => u !== unit);
  scene.players = (scene.players || []).filter(u => u !== unit);
  scene.enemies = (scene.enemies || []).filter(u => u !== unit);

  try {
    if (typeof unit.destroy === 'function') unit.destroy();
  } catch (e) {}

  try {
    if (unit.container?.destroy) unit.container.destroy();
  } catch (e) {}

  if (scene.selectedUnit === unit) {
    scene.setSelectedUnit?.(null);
  }
  scene.updateSelectionHighlight?.();

  console.log('[COMBAT] Unit removed:', unit.unitName || unit.name);
}

export default {
  applyCombatEvent,
};
