// src/net/CombatNetBridge.js
//
// Stage E: Host-authoritative combat networking bridge
//
// Responsibilities:
//  - Receive combat INTENTS from clients
//  - Resolve combat ONLY on host
//  - Broadcast authoritative combat EVENTS
//
// Transport-agnostic (Supabase / WebSocket / custom)

import { applyAttack } from '../units/UnitActions.js';

export function handleCombatIntent(scene, intent) {
  if (!scene || !intent) return;

  if (!scene.isHost) {
    console.warn('[NET] Non-host tried to resolve combat');
    return;
  }

  if (intent.type !== 'intent:attack') return;

  const {
    attackerId,
    defenderId,
    weaponId,
    nonce,
    sender,
  } = intent;

  const attacker = findUnitByNetId(scene, attackerId);
  const defender = findUnitByNetId(scene, defenderId);

  if (!attacker || !defender) {
    console.warn('[NET] Invalid combat intent, unit missing', intent);
    return;
  }

  // Turn ownership validation
  const owner =
    attacker.playerName ??
    attacker.playerId ??
    attacker.owner ??
    null;

  if (String(owner) !== String(scene.turnOwner)) {
    console.warn('[NET] Attack rejected: not attacker turn');
    return;
  }

  // Resolve combat AUTHORITATIVELY
  const res = applyAttack(attacker, defender, {
    turnOwner: scene.turnOwner,
    turnNumber: scene.turnNumber,
    roomCode: scene.roomCode,
    seed: scene.seed,
    nonce,
  });

  if (!res.ok) {
    console.warn('[NET] Combat resolve failed', res);
    return;
  }

  // Apply death
  if (res.killed) {
    handleUnitDeath(scene, defender);
  }

  // Broadcast event
  broadcastCombatEvent(scene, res.event);
}

/* =========================================================
   Helpers
   ========================================================= */

function findUnitByNetId(scene, netId) {
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

function handleUnitDeath(scene, unit) {
  unit.isDead = true;

  // Remove from arrays
  scene.units = (scene.units || []).filter(u => u !== unit);
  scene.players = (scene.players || []).filter(u => u !== unit);
  scene.enemies = (scene.enemies || []).filter(u => u !== unit);

  // Destroy visual
  if (typeof unit.destroy === 'function') {
    unit.destroy();
  } else if (unit.container?.destroy) {
    unit.container.destroy();
  }

  console.log('[COMBAT] Unit destroyed:', unit.unitName || unit.name);
}

/* =========================================================
   Transport hook (Supabase/WebSocket/etc.)
   ========================================================= */

function broadcastCombatEvent(scene, event) {
  if (!event) return;

  // Local apply for host (already applied stats, but useful for UI hooks)
  scene.applyCombatEvent?.(event);

  // Network broadcast (Supabase example)
  if (scene.supabase && scene.roomCode) {
    scene.supabase
      .from('combat_events')
      .insert({
        room_code: scene.roomCode,
        event,
      })
      .catch(err =>
        console.error('[NET] Failed to broadcast combat event', err)
      );
  }
}

export default {
  handleCombatIntent,
};
