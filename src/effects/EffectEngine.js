// src/effects/EffectEngine.js
//
// Pure rules for applying and ticking UNIT and HEX effects.
// No Phaser imports. Multiplayer-safe: functions can return "events"
// that the host can broadcast and every client can apply identically.
//
// This engine is intentionally compact and deterministic.
// Rendering/visuals must be handled by scenes (e.g., outline highlights, particles).
//
// Logging (compact):
// - Enable in DevTools:
//   window.__TRACE_EFF__ = true/false
//
// Output examples:
//   [EFF:+unit] u4 +POISONED dur=3 stacks=1 src=u1
//   [EFF:+hex]  10,6 +MIASMA_HEX dur=3 stacks=1 src=u1
//   [EFF:tick]  u4 POISONED dot=2 toxin hp:6->4
//   [EFF:exp]   u4 -POISONED
//
// NOTE:
// - This file does NOT know about supabase/lobby/host. It only manipulates plain objects.

import { getEffectDef, EFFECT_KINDS, STACKING, TICK_ACTIONS, MOD_STATS } from './EffectDefs.js';

/* ============================================================================
   Trace logger
   ========================================================================== */

const __EFF_ON__ = () => (typeof window !== 'undefined' ? (window.__TRACE_EFF__ ?? true) : false);
function __e(msg) {
  if (!__EFF_ON__()) return;
  try { console.log(msg); } catch (_) {}
}

/* ============================================================================
   Helpers
   ========================================================================== */

export function hexKey(q, r) {
  return `${q},${r}`;
}

function asInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function uid(prefix = 'e') {
  // deterministic enough for local; for net events host should provide nonce/id
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

/**
 * Status slots (for UI):
 * - unit.effects remains the authoritative list of effect instances.
 * - unit.statuses is a UI-friendly list of active TEMPORARY statuses (max 10).
 */
const MAX_UNIT_STATUSES = 10;

export function ensureUnitEffectsState(unit) {
  if (!unit) return;
  if (!Array.isArray(unit.effects)) unit.effects = [];
  if (!Array.isArray(unit.statuses)) unit.statuses = [];
}

export function ensureHexEffectsState(state) {
  if (!state) return;
  // Use plain object for serialization safety (Supabase JSON)
  if (!state.hexEffects || typeof state.hexEffects !== 'object') state.hexEffects = {};
}

/**
 * Merge params: def.baseParams <- instanceParams (instance wins)
 */
function mergedParams(def, instanceParams) {
  const base = def?.baseParams && typeof def.baseParams === 'object' ? def.baseParams : {};
  const inst = instanceParams && typeof instanceParams === 'object' ? instanceParams : {};
  return { ...base, ...inst };
}

/**
 * Find existing effect instance by defId on a unit.
 */
function findUnitEffect(unit, defId) {
  ensureUnitEffectsState(unit);
  return unit.effects.find(e => e && e.defId === defId) || null;
}

/**
 * Find existing hex effect instance by defId at key.
 */
function findHexEffect(state, key, defId) {
  ensureHexEffectsState(state);
  const arr = Array.isArray(state.hexEffects[key]) ? state.hexEffects[key] : [];
  return arr.find(e => e && e.defId === defId) || null;
}

/**
 * Decide whether an effect instance should be represented in unit.statuses.
 * Design rule (for now):
 * - TEMPORARY effects (duration > 0) -> status slot
 * - INFINITE effects (duration == 0) -> not a status slot (passives), unless forced
 */
function isStatusEffectInstance(inst, def) {
  // if effect def explicitly says "uiHidden" or similar, you can wire it later in EffectDefs.
  // For now we keep it rule-based.
  if (!inst || !def) return false;
  if (inst.disabled) return false;
  const d = asInt(inst.duration, 0);
  return d > 0; // temporary only
}

/**
 * Ensure unit.statuses mirrors unit.effects (TEMP effects only), max 10.
 * Keeps stable order: existing order preserved, then fills with newly found.
 */
export function syncUnitStatuses(unit) {
  ensureUnitEffectsState(unit);

  const existing = Array.isArray(unit.statuses) ? unit.statuses : [];
  const existingIds = new Set(existing.map(s => s?.defId).filter(Boolean));

  // build list of desired statuses from effects
  const desired = [];
  for (const inst of unit.effects) {
    if (!inst || inst.disabled) continue;
    const def = getEffectDef(inst.defId);
    if (!def || def.kind !== EFFECT_KINDS.UNIT) continue;
    if (!isStatusEffectInstance(inst, def)) continue;
    desired.push(inst);
  }

  // keep current ones that still exist
  const next = [];
  for (const s of existing) {
    if (!s || !s.defId) continue;
    const still = desired.find(d => d && d.defId === s.defId);
    if (still) next.push({ defId: still.defId, id: still.id });
  }

  // append new ones not present
  for (const inst of desired) {
    if (!inst) continue;
    if (existingIds.has(inst.defId)) continue;
    if (next.length >= MAX_UNIT_STATUSES) break;
    next.push({ defId: inst.defId, id: inst.id });
  }

  unit.statuses = next;
}

/**
 * Remove a specific defId from unit.statuses (fast path).
 */
function removeStatusByDefId(unit, defId) {
  ensureUnitEffectsState(unit);
  if (!defId) return;
  if (!Array.isArray(unit.statuses) || !unit.statuses.length) return;
  unit.statuses = unit.statuses.filter(s => s && s.defId !== defId);
}

/* ============================================================================
   Derived stats (modifiers)
   ========================================================================== */

/**
 * Compute additive modifiers from active unit effects.
 * Returns a small object used by combat/move/vision systems.
 *
 * @returns {{
 *   armorBonus:number, visionBonus:number, mpMaxBonus:number, apMaxBonus:number,
 *   rangeBonus:number, damageDealtPct:number, damageTakenPct:number,
 *   perTypeDamageTakenPct: Record<string, number>
 * }}
 */
export function computeEffectModifiers(unit) {
  ensureUnitEffectsState(unit);

  const out = {
    armorBonus: 0,
    visionBonus: 0,
    mpMaxBonus: 0,
    apMaxBonus: 0,
    rangeBonus: 0,
    damageDealtPct: 0,
    damageTakenPct: 0,
    perTypeDamageTakenPct: {}, // e.g. { toxic: -25 }
  };

  for (const inst of unit.effects) {
    if (!inst || inst.disabled) continue;
    const def = getEffectDef(inst.defId);
    if (!def || def.kind !== EFFECT_KINDS.UNIT) continue;

    const mods = Array.isArray(def.modifiers) ? def.modifiers : [];
    const params = mergedParams(def, inst.params);

    for (const m of mods) {
      if (!m || m.op !== 'add') continue;
      const v = Number.isFinite(m.value) ? m.value : 0;

      switch (m.stat) {
        case MOD_STATS.ARMOR:
          out.armorBonus += v;
          break;
        case MOD_STATS.VISION:
          out.visionBonus += v;
          break;
        case MOD_STATS.MP_MAX:
          out.mpMaxBonus += v;
          break;
        case MOD_STATS.AP_MAX:
          out.apMaxBonus += v;
          break;
        case MOD_STATS.RANGE:
          out.rangeBonus += v;
          break;
        case MOD_STATS.DAMAGE_DEALT_PCT:
          out.damageDealtPct += v;
          break;
        case MOD_STATS.DAMAGE_TAKEN_PCT:
          // optional per-type
          if (m.damageType) {
            const t = String(m.damageType).toLowerCase();
            out.perTypeDamageTakenPct[t] = (out.perTypeDamageTakenPct[t] || 0) + v;
          } else {
            out.damageTakenPct += v;
          }
          break;
        default:
          break;
      }

      // allow param-based overrides (kept minimal)
      void params;
    }
  }

  return out;
}

/**
 * Returns effective weapon range for a unit given a weapon def range.
 * Runtime should pass in weapon's base rmin/rmax; this adds effect bonus.
 *
 * @param {any} unit
 * @param {{rangeMin:number, rangeMax:number}} weaponRange
 * @returns {{rangeMin:number, rangeMax:number}}
 */
export function getEffectiveWeaponRange(unit, weaponRange) {
  const baseMin = asInt(weaponRange?.rangeMin, 1);
  const baseMax = asInt(weaponRange?.rangeMax, baseMin);

  const mods = computeEffectModifiers(unit);
  const bonus = asInt(mods.rangeBonus, 0);

  // Keep min >= 0, max >= min
  const rmin = Math.max(0, baseMin + bonus);
  const rmax = Math.max(rmin, baseMax + bonus);

  return { rangeMin: rmin, rangeMax: rmax };
}

/* ============================================================================
   Apply effects (unit / hex)
   ========================================================================== */

/**
 * Add or update a unit effect instance.
 *
 * IMPORTANT (your design):
 * - Only TEMP effects (duration > 0) occupy a "status slot" in unit.statuses.
 * - Max 10 statuses: if full, new TEMP effect is ignored (refresh/stack existing is allowed).
 *
 * @param {any} unit
 * @param {string} effectId
 * @param {object} [opts]
 * @param {number} [opts.duration] - override duration
 * @param {number} [opts.stacks]
 * @param {object} [opts.params]
 * @param {string} [opts.sourceUnitId]
 * @param {string} [opts.sourceFaction]
 * @param {string} [opts.instanceId] - if provided, use it (host should set)
 * @returns {any|null} effect instance
 */
export function addUnitEffect(unit, effectId, opts = {}) {
  ensureUnitEffectsState(unit);

  const def = getEffectDef(effectId);
  if (!def || def.kind !== EFFECT_KINDS.UNIT) return null;

  const stacking = def.stacking || STACKING.REFRESH;
  const maxStacks = Number.isFinite(def.maxStacks) ? def.maxStacks : 99;

  const dur = Number.isFinite(opts.duration)
    ? asInt(opts.duration, def.baseDuration)
    : asInt(def.baseDuration, 0);

  const isInfinite = dur <= 0;

  const existing = findUnitEffect(unit, def.id);

  // If effect already exists: refresh/stack is allowed even if statuses are full.
  if (existing) {
    if (stacking === STACKING.IGNORE) return existing;

    if (stacking === STACKING.STACK) {
      const next = Math.min(
        maxStacks,
        asInt(existing.stacks, 1) + (Number.isFinite(opts.stacks) ? asInt(opts.stacks, 1) : 1)
      );
      existing.stacks = next;
    } else {
      // refresh: keep stacks unless explicit
      if (Number.isFinite(opts.stacks)) existing.stacks = asInt(opts.stacks, existing.stacks || 1);
    }

    // refresh duration only if not infinite
    if (!isInfinite) existing.duration = dur;

    existing.params = mergedParams(def, { ...existing.params, ...opts.params });
    existing.sourceUnitId = opts.sourceUnitId ?? existing.sourceUnitId ?? null;
    existing.sourceFaction = opts.sourceFaction ?? existing.sourceFaction ?? null;

    // sync statuses (in case duration changed temp<->infinite)
    syncUnitStatuses(unit);

    __e(`[EFF:+unit] ${unit.id || unit.unitId || '?'} ~${def.id} dur=${existing.duration ?? '∞'} stacks=${existing.stacks ?? 1}`);
    return existing;
  }

  // New instance: if it is a TEMP status and we already have 10 statuses -> ignore.
  if (!isInfinite) {
    // ensure statuses are synced before checking
    syncUnitStatuses(unit);
    const hasSlots = (unit.statuses?.length ?? 0) < MAX_UNIT_STATUSES;
    if (!hasSlots) {
      __e(`[EFF:cap] ${unit.id || unit.unitId || '?'} status cap ${MAX_UNIT_STATUSES} reached, ignore +${def.id}`);
      return null;
    }
  }

  const inst = {
    id: opts.instanceId || uid('ue'),
    defId: def.id,
    kind: EFFECT_KINDS.UNIT,
    duration: isInfinite ? 0 : dur,
    stacks: Number.isFinite(opts.stacks) ? asInt(opts.stacks, 1) : 1,
    params: mergedParams(def, opts.params),
    sourceUnitId: opts.sourceUnitId ?? null,
    sourceFaction: opts.sourceFaction ?? null,
  };

  unit.effects.push(inst);

  // reflect into statuses if temporary
  if (isStatusEffectInstance(inst, def)) {
    syncUnitStatuses(unit);
  }

  __e(`[EFF:+unit] ${unit.id || unit.unitId || '?'} +${def.id} dur=${inst.duration || '∞'} stacks=${inst.stacks} src=${inst.sourceUnitId || '-'}`);
  return inst;
}

/**
 * Place a hex effect at (q,r). Stored in state.hexEffects["q,r"].
 *
 * @param {any} state - serializable state holder (lobbyState or scene.lobbyState)
 * @param {number} q
 * @param {number} r
 * @param {string} effectId
 * @param {object} [opts]
 * @returns {any|null}
 */
export function placeHexEffect(state, q, r, effectId, opts = {}) {
  ensureHexEffectsState(state);

  const def = getEffectDef(effectId);
  if (!def || def.kind !== EFFECT_KINDS.HEX) return null;

  const key = hexKey(q, r);
  if (!Array.isArray(state.hexEffects[key])) state.hexEffects[key] = [];

  const stacking = def.stacking || STACKING.REFRESH;
  const maxStacks = Number.isFinite(def.maxStacks) ? def.maxStacks : 99;

  const dur = Number.isFinite(opts.duration) ? asInt(opts.duration, def.baseDuration) : asInt(def.baseDuration, 0);
  const isInfinite = dur <= 0;

  const existing = findHexEffect(state, key, def.id);

  if (existing) {
    if (stacking === STACKING.IGNORE) return existing;

    if (stacking === STACKING.STACK) {
      const next = Math.min(maxStacks, asInt(existing.stacks, 1) + (Number.isFinite(opts.stacks) ? asInt(opts.stacks, 1) : 1));
      existing.stacks = next;
    } else {
      if (Number.isFinite(opts.stacks)) existing.stacks = asInt(opts.stacks, existing.stacks || 1);
    }

    if (!isInfinite) existing.duration = dur;
    existing.params = mergedParams(def, { ...existing.params, ...opts.params });
    existing.sourceUnitId = opts.sourceUnitId ?? existing.sourceUnitId ?? null;
    existing.sourceFaction = opts.sourceFaction ?? existing.sourceFaction ?? null;

    __e(`[EFF:+hex] ${key} ~${def.id} dur=${existing.duration ?? '∞'} stacks=${existing.stacks ?? 1}`);
    return existing;
  }

  const inst = {
    id: opts.instanceId || uid('he'),
    defId: def.id,
    kind: EFFECT_KINDS.HEX,
    q: asInt(q, 0),
    r: asInt(r, 0),
    duration: isInfinite ? 0 : dur,
    stacks: Number.isFinite(opts.stacks) ? asInt(opts.stacks, 1) : 1,
    params: mergedParams(def, opts.params),
    sourceUnitId: opts.sourceUnitId ?? null,
    sourceFaction: opts.sourceFaction ?? null,
  };

  state.hexEffects[key].push(inst);
  __e(`[EFF:+hex] ${key} +${def.id} dur=${inst.duration || '∞'} stacks=${inst.stacks} src=${inst.sourceUnitId || '-'}`);
  return inst;
}

/* ============================================================================
   Ticking and expiry
   ========================================================================== */

/**
 * Decrement durations and remove expired effects from unit.effects.
 * Also removes expired ones from unit.statuses.
 * Returns list of removed defIds.
 */
export function cleanupExpiredUnitEffects(unit) {
  ensureUnitEffectsState(unit);
  const removed = [];

  unit.effects = unit.effects.filter(inst => {
    if (!inst) return false;
    const def = getEffectDef(inst.defId);
    if (!def) return false;

    // duration 0 means infinite for our design
    if (!Number.isFinite(inst.duration) || inst.duration === 0) return true;

    if (inst.duration <= 0) {
      removed.push(inst.defId);
      return false;
    }
    return true;
  });

  for (const d of removed) {
    removeStatusByDefId(unit, d);
    __e(`[EFF:exp] ${unit.id || unit.unitId || '?'} -${d}`);
  }

  // ensure we don't exceed cap / keep order consistent after removals
  syncUnitStatuses(unit);

  return removed;
}

/**
 * Decrement durations and remove expired hex effects in state.hexEffects.
 * Returns array of removed instances keys.
 */
export function cleanupExpiredHexEffects(state) {
  ensureHexEffectsState(state);
  const removed = [];

  for (const key of Object.keys(state.hexEffects)) {
    const arr = Array.isArray(state.hexEffects[key]) ? state.hexEffects[key] : [];
    const kept = [];

    for (const inst of arr) {
      if (!inst) continue;
      const def = getEffectDef(inst.defId);
      if (!def) continue;

      if (!Number.isFinite(inst.duration) || inst.duration === 0) {
        kept.push(inst);
        continue;
      }

      if (inst.duration <= 0) {
        removed.push({ key, defId: inst.defId, id: inst.id });
      } else {
        kept.push(inst);
      }
    }

    if (kept.length) state.hexEffects[key] = kept;
    else delete state.hexEffects[key];
  }

  for (const r of removed) {
    __e(`[EFF:exp] ${r.key} -${r.defId}`);
  }
  return removed;
}

/**
 * Tick unit effects for a single phase.
 * This function can directly apply to unit.hp, but also returns "events"
 * that a host can broadcast.
 *
 * @param {any} unit
 * @param {'turnStart'|'turnEnd'} phase
 * @param {object} [ctx]
 * @param {string} [ctx.turnOwner]
 * @param {number} [ctx.turnNumber]
 * @returns {Array<any>} events (damage/heal)
 */
export function tickUnitEffects(unit, phase, ctx = {}) {
  ensureUnitEffectsState(unit);

  // keep statuses consistent (cheap)
  syncUnitStatuses(unit);

  const events = [];

  for (const inst of unit.effects) {
    if (!inst || inst.disabled) continue;
    const def = getEffectDef(inst.defId);
    if (!def || def.kind !== EFFECT_KINDS.UNIT) continue;

    const ticks = Array.isArray(def.ticks) ? def.ticks : [];
    if (!ticks.length) continue;

    for (const t of ticks) {
      if (!t || t.phase !== phase) continue;

      if (t.type === TICK_ACTIONS.DOT) {
        const dmg = asInt(t.amount, 0) * asInt(inst.stacks, 1);
        if (dmg <= 0) continue;

        const before = asInt(unit.hp, 0);
        const after = Math.max(0, before - dmg);
        unit.hp = after;

        const ev = {
          type: 'effect:dot',
          targetId: String(unit.id ?? unit.unitId ?? ''),
          effectId: String(def.id),
          amount: dmg,
          damageType: String(t.damageType || 'physical').toLowerCase(),
          hpBefore: before,
          hpAfter: after,
          turnOwner: ctx.turnOwner ?? null,
          turnNumber: ctx.turnNumber ?? null,
        };
        events.push(ev);

        __e(`[EFF:tick] ${unit.id || unit.unitId || '?'} ${def.id} dot=${dmg} ${ev.damageType} hp:${before}->${after}`);
      }

      if (t.type === TICK_ACTIONS.REGEN) {
        const heal = asInt(t.amount, 0) * asInt(inst.stacks, 1);
        if (heal <= 0) continue;

        const maxHp = asInt(unit.maxHp, asInt(unit.hp, 1));
        const before = asInt(unit.hp, 0);
        const after = Math.min(maxHp, before + heal);
        unit.hp = after;

        const ev = {
          type: 'effect:regen',
          targetId: String(unit.id ?? unit.unitId ?? ''),
          effectId: String(def.id),
          amount: heal,
          hpBefore: before,
          hpAfter: after,
          turnOwner: ctx.turnOwner ?? null,
          turnNumber: ctx.turnNumber ?? null,
        };
        events.push(ev);

        __e(`[EFF:tick] ${unit.id || unit.unitId || '?'} ${def.id} regen=${heal} hp:${before}->${after}`);
      }
    }
  }

  return events;
}

/**
 * Tick hex effects for a phase.
 * For now, hex effects directly apply to units standing on those hexes.
 *
 * @param {any} state
 * @param {Array<any>} allUnits - array of unit objects that have q/r/hp fields
 * @param {'turnStart'|'turnEnd'} phase
 * @param {object} [ctx]
 * @returns {Array<any>} events
 */
export function tickHexEffects(state, allUnits, phase, ctx = {}) {
  ensureHexEffectsState(state);
  const events = [];

  // Build quick lookup: key -> units on hex
  const unitsOn = {};
  for (const u of (allUnits || [])) {
    if (!u) continue;
    const k = hexKey(u.q, u.r);
    (unitsOn[k] ||= []).push(u);
  }

  for (const key of Object.keys(state.hexEffects)) {
    const list = Array.isArray(state.hexEffects[key]) ? state.hexEffects[key] : [];
    if (!list.length) continue;

    const unitsHere = unitsOn[key] || [];
    if (!unitsHere.length) continue;

    for (const inst of list) {
      if (!inst || inst.disabled) continue;
      const def = getEffectDef(inst.defId);
      if (!def || def.kind !== EFFECT_KINDS.HEX) continue;

      const ticks = Array.isArray(def.ticks) ? def.ticks : [];
      if (!ticks.length) continue;

      for (const t of ticks) {
        if (!t || t.phase !== phase) continue;

        if (t.type === TICK_ACTIONS.DOT) {
          const dmg = asInt(t.amount, 0) * asInt(inst.stacks, 1);
          if (dmg <= 0) continue;
          const dtype = String(t.damageType || 'physical').toLowerCase();

          for (const u of unitsHere) {
            const before = asInt(u.hp, 0);
            const after = Math.max(0, before - dmg);
            u.hp = after;

            const ev = {
              type: 'hex:dot',
              targetId: String(u.id ?? u.unitId ?? ''),
              hex: key,
              effectId: String(def.id),
              amount: dmg,
              damageType: dtype,
              hpBefore: before,
              hpAfter: after,
              sourceUnitId: inst.sourceUnitId ?? null,
              sourceFaction: inst.sourceFaction ?? null,
              turnOwner: ctx.turnOwner ?? null,
              turnNumber: ctx.turnNumber ?? null,
            };
            events.push(ev);

            __e(`[EFF:tick] ${u.id || u.unitId || '?'} on ${key} ${def.id} dot=${dmg} ${dtype} hp:${before}->${after}`);
          }
        }

        if (t.type === TICK_ACTIONS.REGEN) {
          const heal = asInt(t.amount, 0) * asInt(inst.stacks, 1);
          if (heal <= 0) continue;

          for (const u of unitsHere) {
            const maxHp = asInt(u.maxHp, asInt(u.hp, 1));
            const before = asInt(u.hp, 0);
            const after = Math.min(maxHp, before + heal);
            u.hp = after;

            const ev = {
              type: 'hex:regen',
              targetId: String(u.id ?? u.unitId ?? ''),
              hex: key,
              effectId: String(def.id),
              amount: heal,
              hpBefore: before,
              hpAfter: after,
              sourceUnitId: inst.sourceUnitId ?? null,
              sourceFaction: inst.sourceFaction ?? null,
              turnOwner: ctx.turnOwner ?? null,
              turnNumber: ctx.turnNumber ?? null,
            };
            events.push(ev);

            __e(`[EFF:tick] ${u.id || u.unitId || '?'} on ${key} ${def.id} regen=${heal} hp:${before}->${after}`);
          }
        }
      }
    }
  }

  return events;
}

/**
 * Advance durations by 1 turn for unit effects.
 * Call this once per turn for all units.
 */
export function decrementUnitEffectDurations(unit) {
  ensureUnitEffectsState(unit);
  for (const inst of unit.effects) {
    if (!inst) continue;
    // 0 means infinite
    if (!Number.isFinite(inst.duration) || inst.duration === 0) continue;
    inst.duration = asInt(inst.duration, 0) - 1;
  }
}

/**
 * Advance durations by 1 turn for all hex effects.
 */
export function decrementHexEffectDurations(state) {
  ensureHexEffectsState(state);
  for (const key of Object.keys(state.hexEffects)) {
    const arr = Array.isArray(state.hexEffects[key]) ? state.hexEffects[key] : [];
    for (const inst of arr) {
      if (!inst) continue;
      if (!Number.isFinite(inst.duration) || inst.duration === 0) continue;
      inst.duration = asInt(inst.duration, 0) - 1;
    }
  }
}

/* ============================================================================
   Convenience: ensure passive effects from ability list
   ========================================================================== */

/**
 * Ensure passive effects exist on unit based on passive ability definitions.
 * Runtime will call this at spawn and at turn start (cheap).
 *
 * @param {any} unit
 * @param {(id:string)=>any} getAbilityDef - injected to avoid circular imports
 */
export function ensurePassiveEffects(unit, getAbilityDef) {
  ensureUnitEffectsState(unit);
  const passives = Array.isArray(unit.passiveAbilities) ? unit.passiveAbilities : [];
  if (!passives.length || typeof getAbilityDef !== 'function') return;

  for (const pid of passives) {
    const a = getAbilityDef(pid);
    if (!a || a.kind !== 'passive' || !a.passive?.effectId) continue;

    const effectId = a.passive.effectId;
    const exists = findUnitEffect(unit, effectId);
    if (exists) continue;

    // Add as infinite duration (does not take a status slot)
    addUnitEffect(unit, effectId, {
      duration: 0,
      stacks: 1,
      params: a.passive.params || {},
      sourceUnitId: unit.id ?? unit.unitId ?? null,
      sourceFaction: unit.faction ?? null,
    });
  }

  // keep status list valid
  syncUnitStatuses(unit);
}

export default {
  hexKey,
  ensureUnitEffectsState,
  ensureHexEffectsState,
  syncUnitStatuses,
  computeEffectModifiers,
  getEffectiveWeaponRange,
  addUnitEffect,
  placeHexEffect,
  tickUnitEffects,
  tickHexEffects,
  decrementUnitEffectDurations,
  decrementHexEffectDurations,
  cleanupExpiredUnitEffects,
  cleanupExpiredHexEffects,
  ensurePassiveEffects,
};
