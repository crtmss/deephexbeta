// src/scenes/WorldSceneCombatRuntime.js
//
// Stage E: Apply authoritative combat events to local state
//
// This is called on ALL clients (host included)

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

  // HP already authoritatively set on host,
  // but clients need to apply it
  defender.hp = Math.max(0, defender.hp - damage);

  defender.lastHit = {
    by: attackerId,
    weaponId,
    damage,
  };

  if (defender.hp <= 0) {
    defender.isDead = true;
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

  if (typeof unit.destroy === 'function') unit.destroy();
  if (unit.container?.destroy) unit.container.destroy();

  console.log('[COMBAT] Unit removed:', unit.unitName || unit.name);
}

export default {
  applyCombatEvent,
};
