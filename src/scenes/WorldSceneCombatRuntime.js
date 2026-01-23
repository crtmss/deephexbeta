// src/scenes/WorldSceneCombatRuntime.js
//
// Stage E: Apply authoritative combat events to local state
// Stage F: Combat UX (floating damage numbers, death FX, combat log)
//
// This is called on ALL clients (host included)
// ---------------------------------------------------------------------------
// __COMBAT_TRACE__ (compact logs)
// Enable/disable in DevTools: window.__COMBAT_TRACE__ = true/false
// ---------------------------------------------------------------------------
const __TRACE_ON__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_TRACE__ ?? true) : true);
function __t(tag, data) {
  if (!__TRACE_ON__()) return;
  try { console.log(`[$COMBAT]`, data); } catch (_) {}
}

// Abilities / effects (Stage G+)
// - Ability events should be applied identically on all clients.
// - We keep this runtime tolerant: unknown ability/effect ids are ignored.
// - We store HEX effects in a scene-owned serializable bag: scene.effectsState.

import { getAbilityDef } from '../abilities/AbilityDefs.js';
import {
  addUnitEffect,
  placeHexEffect,
  ensureHexEffectsState,
  ensureUnitEffectsState,
} from '../effects/EffectEngine.js';

// IMPORTANT:
// In your project you said you DON'T have WorldSceneCombatFX.js.
// Static import would crash the module graph.
// So we do a safe dynamic import once, and gracefully no-op if missing.

let __combatFx = null;
let __combatFxTried = false;

async function __loadCombatFX() {
  if (__combatFxTried) return __combatFx;
  __combatFxTried = true;
  try {
    // Path as originally expected
    __combatFx = await import('./WorldSceneCombatFX.js');
  } catch (e) {
    __combatFx = null;
  }
  return __combatFx;
}

async function spawnDamageNumberSafe(scene, q, r, dmg) {
  try {
    const fx = await __loadCombatFX();
    if (fx && typeof fx.spawnDamageNumber === 'function') {
      fx.spawnDamageNumber(scene, q, r, dmg);
    }
  } catch (e) {
    // non-fatal
  }
}

async function spawnDeathFXSafe(scene, unit) {
  try {
    const fx = await __loadCombatFX();
    if (fx && typeof fx.spawnDeathFX === 'function') {
      fx.spawnDeathFX(scene, unit);
    }
  } catch (e) {
    // non-fatal
  }
}

export function applyCombatEvent(scene, event) {
  if (!scene || !event) return;

  // Route other authoritative world events through the same entry point.
  if (event.type === 'ability:cast') {
    applyAbilityEvent(scene, event);
    return;
  }

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
  const hpBefore = Number.isFinite(defender.hp)
    ? defender.hp
    : (Number.isFinite(defender.maxHp) ? defender.maxHp : 0);

  defender.hp = Math.max(0, hpBefore - (Number.isFinite(damage) ? damage : 0));

  defender.lastHit = {
    by: attackerId,
    weaponId,
    damage,
  };

  // Stage F: floating damage number (safe even if FX module absent)
  spawnDamageNumberSafe(scene, defender.q, defender.r, Number.isFinite(damage) ? damage : 0);

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

    // Stage F: death FX (safe even if FX module absent)
    spawnDeathFXSafe(scene, defender);

    removeUnit(scene, defender);
  }

  // Hook for visuals / logs
  scene.onCombatResolved?.(event);

  // ✅ IMPORTANT: refresh unit panel if it shows attacker/defender
  try {
    if (scene.selectedUnit === attacker || scene.selectedUnit === defender) {
      scene.refreshUnitActionPanel?.();
    }
  } catch (e) {}
}

/* =========================================================
   Abilities
   ========================================================= */

/**
 * Apply an authoritative ability cast event.
 *
 * Expected shape (tolerant):
 * {
 *   type:'ability:cast',
 *   casterId, abilityId,
 *   targetUnitId?, targetHex?:{q,r},
 *   casterApAfter?,
 *   unitEffects?: [{ targetId, effectId, duration?, stacks?, params?, sourceUnitId?, sourceFaction? }],
 *   hexEffects?:  [{ q, r, effectId, duration?, stacks?, params?, sourceUnitId?, sourceFaction? }],
 * }
 */
export function applyAbilityEvent(scene, event) {
  if (!scene || !event) return;
  if (event.type !== 'ability:cast') return;

  // Ensure effect state container exists
  if (!scene.effectsState || typeof scene.effectsState !== 'object') {
    scene.effectsState = {};
  }
  ensureHexEffectsState(scene.effectsState);

  const caster = findUnit(scene, event.casterId);
  if (!caster) {
    console.warn('[ABILITY] Missing caster for event', event);
    return;
  }

  ensureUnitEffectsState(caster);

  // If the host included an authoritative AP value, apply it (do NOT guess)
  if (Number.isFinite(event.casterApAfter)) {
    caster.ap = Math.max(0, event.casterApAfter);
  }

  const abilityId = String(event.abilityId || '').trim().toLowerCase();
  const adef = abilityId ? getAbilityDef(abilityId) : null;

  const unitEffects = Array.isArray(event.unitEffects) ? event.unitEffects : [];
  const hexEffects = Array.isArray(event.hexEffects) ? event.hexEffects : [];

  // Apply UNIT effects
  let appliedUnit = 0;
  for (const ue of unitEffects) {
    if (!ue || !ue.effectId) continue;
    const target = findUnit(scene, ue.targetId);
    if (!target) continue;
    ensureUnitEffectsState(target);
    const inst = addUnitEffect(target, String(ue.effectId), {
      duration: ue.duration,
      stacks: ue.stacks,
      params: ue.params,
      sourceUnitId: ue.sourceUnitId ?? event.casterId,
      sourceFaction: ue.sourceFaction ?? caster.faction,
      instanceId: ue.instanceId,
    });
    if (inst) appliedUnit++;
  }

  // Apply HEX effects
  let appliedHex = 0;
  for (const he of hexEffects) {
    if (!he || !he.effectId) continue;
    const q = Number(he.q);
    const r = Number(he.r);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;

    const inst = placeHexEffect(scene.effectsState, q, r, String(he.effectId), {
      duration: he.duration,
      stacks: he.stacks,
      params: he.params,
      sourceUnitId: he.sourceUnitId ?? event.casterId,
      sourceFaction: he.sourceFaction ?? caster.faction,
      instanceId: he.instanceId,
    });
    if (inst) appliedHex++;
  }

  // Compact trace
  try {
    const casterName = caster.unitName || caster.name || caster.type || caster.id || event.casterId;
    const abName = adef?.name || abilityId || 'ability';
    console.log('[ABILITY]', `${casterName} cast ${abName}`, {
      abilityId,
      casterId: event.casterId,
      targetUnitId: event.targetUnitId ?? null,
      targetHex: event.targetHex ?? null,
      unitEffects: appliedUnit,
      hexEffects: appliedHex,
    });
  } catch (_e) {}

  // Optional: add to History panel
  try {
    const year =
      (typeof scene.getNextHistoryYear === 'function')
        ? scene.getNextHistoryYear()
        : 5000 + (Number.isFinite(scene.turnNumber) ? scene.turnNumber : 0);

    const tq = Number.isFinite(event?.targetHex?.q) ? event.targetHex.q : (caster.q ?? 0);
    const tr = Number.isFinite(event?.targetHex?.r) ? event.targetHex.r : (caster.r ?? 0);

    scene.addHistoryEntry?.({
      year,
      type: 'ability',
      q: tq,
      r: tr,
      text: `${caster.unitName || caster.name || caster.type} cast ${adef?.name || abilityId}`,
    });
  } catch (_e) {}

  // Hook for UI (icons, particles)
  scene.onAbilityResolved?.(event);
}

export function applyWorldEvent(scene, event) {
  // Convenience router for future net bridges.
  if (!event) return;
  if (event.type === 'combat:attack') return applyCombatEvent(scene, event);
  if (event.type === 'ability:cast') return applyAbilityEvent(scene, event);
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
  applyAbilityEvent,
  applyWorldEvent,
};
