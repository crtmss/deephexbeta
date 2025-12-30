// src/scenes/WorldSceneCombatRuntime.js
//
// Stage E: Apply authoritative combat events to local state
// Stage F: Combat UX (floating damage numbers, death FX, combat log)
//
// This is called on ALL clients (host included)

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
  __dbg_group('COMBAT:event', 'apply', { evt });
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

  __dbg_group_end();
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
