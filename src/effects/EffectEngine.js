// src/effects/EffectEngine.js
//
// Runtime interpreter for EffectDefs.js
// - No Phaser imports.
// - Deterministic-friendly: effects produce "events" you can broadcast in multiplayer.
// - Backward compatible API with your current WorldScene imports.
//
// Public API kept compatible:
//  ensureHexEffectsState, ensureUnitEffectsState,
//  addUnitEffect, placeHexEffect,
//  tickUnitEffects, tickHexEffects,
//  decrementUnitEffectDurations, decrementHexEffectDurations,
//  cleanupExpiredUnitEffects, cleanupExpiredHexEffects,
//  ensurePassiveEffects, hexKey
//
// Additional new helpers (hooks you should wire):
//  notifyAbilityUsed(sceneOrCtx, caster, abilityId)
//  notifyUnitMovedStep(sceneOrCtx, unit)
//  modifyIncomingDamage(attacker, defender, baseDamage, damageType) -> { damage, breakdown }
//  consumeNextHitHooks(attacker, defender, damageType, ctx) -> { bonusDamage, consumed }
//
// Notes:
// - Unit effect instance: { id, defId, kind:'unit', sourceUnitId, sourceFaction, duration, stacks, params }
// - Hex effect instance: { id, defId, kind:'hex', q,r, ... }
// - duration <= 0 treated as infinite
//

import {
  getEffectDef,
  EFFECT_KINDS,
  STACKING,
  TICK_PHASE,
  TICK_ACTIONS,
  MOD_STATS,
  DAMAGE_TYPES,
} from './EffectDefs.js';

/* =========================================================================
   Id + helpers
   ========================================================================= */

let __instCounter = 1;
function genInstId(prefix = 'inst') {
  __instCounter += 1;
  return `${prefix}_${__instCounter}`;
}

export function hexKey(q, r) {
  return `${q},${r}`;
}

function clampInt(n, lo, hi) {
  const x = Math.trunc(Number.isFinite(n) ? n : 0);
  return Math.max(lo, Math.min(hi, x));
}

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

function nowTurn(ctx) {
  return Number.isFinite(ctx?.turnNumber) ? ctx.turnNumber : null;
}

/* =========================================================================
   State ensure
   ========================================================================= */

export function ensureHexEffectsState(lobbyState) {
  if (!lobbyState || typeof lobbyState !== 'object') return;
  if (!lobbyState.hexEffects || typeof lobbyState.hexEffects !== 'object') {
    lobbyState.hexEffects = {}; // key "q,r" -> [effectInstances]
  }
  if (!lobbyState.__hexEffCounter) lobbyState.__hexEffCounter = 1;
}

export function ensureUnitEffectsState(unit) {
  if (!unit || typeof unit !== 'object') return;
  if (!Array.isArray(unit.effects)) unit.effects = [];
}

function ensureInstParams(def, inst) {
  const base = (def && def.baseParams && typeof def.baseParams === 'object') ? def.baseParams : {};
  const p = (inst && inst.params && typeof inst.params === 'object') ? inst.params : {};
  return { ...base, ...p };
}

/* =========================================================================
   Find/remove helpers
   ========================================================================= */

function findUnitEffectIndex(unit, defId) {
  const arr = safeArr(unit?.effects);
  const key = String(defId || '').trim();
  if (!key) return -1;
  return arr.findIndex(e => e && String(e.defId || '') === key);
}

function removeOneUnitEffectInstance(unit, idx) {
  if (!unit || !Array.isArray(unit.effects)) return null;
  if (idx < 0 || idx >= unit.effects.length) return null;
  return unit.effects.splice(idx, 1)[0] || null;
}

/* =========================================================================
   Add/apply effects
   ========================================================================= */

export function addUnitEffect(unit, effectId, opts = {}) {
  if (!unit) return { ok: false, reason: 'no_unit' };
  const defId = String(effectId || '').trim();
  const def = getEffectDef(defId);
  if (!def) return { ok: false, reason: 'unknown_effect', effectId: defId };

  ensureUnitEffectsState(unit);

  const duration = (Number.isFinite(opts.duration) ? opts.duration : def.baseDuration);
  const stacks = (Number.isFinite(opts.stacks) ? opts.stacks : 1);

  const existingIdx = findUnitEffectIndex(unit, defId);

  // Stacking policy
  if (existingIdx >= 0) {
    const existing = unit.effects[existingIdx];
    if (def.stacking === STACKING.IGNORE) return { ok: true, applied: false, reason: 'ignored' };

    if (def.stacking === STACKING.REFRESH) {
      if (Number.isFinite(duration)) existing.duration = duration;
      if (Number.isFinite(opts.stacks)) existing.stacks = clampInt(stacks, 1, def.maxStacks || 99);
      existing.params = ensureInstParams(def, { params: opts.params || existing.params });
      return { ok: true, applied: true, refreshed: true, instance: existing };
    }

    if (def.stacking === STACKING.STACK) {
      const maxS = Number.isFinite(def.maxStacks) ? def.maxStacks : 99;
      existing.stacks = clampInt((existing.stacks || 1) + 1, 1, maxS);
      if (Number.isFinite(duration)) existing.duration = duration;
      existing.params = ensureInstParams(def, { params: opts.params || existing.params });
      return { ok: true, applied: true, stacked: true, instance: existing };
    }
  }

  const inst = {
    id: opts.id || genInstId('u'),
    defId,
    kind: EFFECT_KINDS.UNIT,
    sourceUnitId: opts.sourceUnitId ?? null,
    sourceFaction: opts.sourceFaction ?? null,
    duration: Number.isFinite(duration) ? duration : def.baseDuration,
    stacks: clampInt(stacks, 1, def.maxStacks || 99),
    params: ensureInstParams(def, { params: opts.params }),
  };

  unit.effects.push(inst);
  return { ok: true, applied: true, instance: inst };
}

export function placeHexEffect(lobbyState, q, r, effectId, opts = {}) {
  if (!lobbyState) return { ok: false, reason: 'no_lobby' };
  ensureHexEffectsState(lobbyState);

  const defId = String(effectId || '').trim();
  const def = getEffectDef(defId);
  if (!def) return { ok: false, reason: 'unknown_effect', effectId: defId };
  if (def.kind !== EFFECT_KINDS.HEX) return { ok: false, reason: 'not_hex_effect', effectId: defId };

  const key = hexKey(q, r);
  if (!Array.isArray(lobbyState.hexEffects[key])) lobbyState.hexEffects[key] = [];

  const duration = (Number.isFinite(opts.duration) ? opts.duration : def.baseDuration);
  const stacks = (Number.isFinite(opts.stacks) ? opts.stacks : 1);

  const list = lobbyState.hexEffects[key];
  const existingIdx = list.findIndex(e => e && String(e.defId || '') === defId);

  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    if (def.stacking === STACKING.IGNORE) return { ok: true, placed: false, reason: 'ignored' };

    if (def.stacking === STACKING.REFRESH) {
      existing.duration = duration;
      if (Number.isFinite(opts.stacks)) existing.stacks = clampInt(stacks, 1, def.maxStacks || 99);
      existing.params = ensureInstParams(def, { params: opts.params || existing.params });
      return { ok: true, placed: true, refreshed: true, instance: existing };
    }

    if (def.stacking === STACKING.STACK) {
      const maxS = Number.isFinite(def.maxStacks) ? def.maxStacks : 99;
      existing.stacks = clampInt((existing.stacks || 1) + 1, 1, maxS);
      existing.duration = duration;
      existing.params = ensureInstParams(def, { params: opts.params || existing.params });
      return { ok: true, placed: true, stacked: true, instance: existing };
    }
  }

  const inst = {
    id: opts.id || genInstId('h'),
    defId,
    kind: EFFECT_KINDS.HEX,
    q, r,
    sourceUnitId: opts.sourceUnitId ?? null,
    sourceFaction: opts.sourceFaction ?? null,
    duration: Number.isFinite(duration) ? duration : def.baseDuration,
    stacks: clampInt(stacks, 1, def.maxStacks || 99),
    params: ensureInstParams(def, { params: opts.params }),
  };

  list.push(inst);
  return { ok: true, placed: true, instance: inst };
}

/* =========================================================================
   Derived modifiers
   ========================================================================= */

function collectActiveUnitEffectDefs(unit) {
  const out = [];
  for (const inst of safeArr(unit?.effects)) {
    if (!inst) continue;
    if (Number.isFinite(inst.duration) && inst.duration <= 0) continue; // 0 treated as infinite? We treat <=0 as infinite for now in cleanup; keep active here.
    const def = getEffectDef(inst.defId);
    if (!def) continue;
    out.push({ def, inst });
  }
  return out;
}

export function getUnitModifierTotals(unit) {
  // Returns totals usable by combat/ability pipeline (does not mutate unit).
  const totals = {
    armorDelta: 0,
    rangeDelta: 0,
    healingReceivedPct: 0,
    cannotHeal: false,
    cannotUseAbilities: false,
    damageTakenPctByType: {},
    damageTakenFlatByType: {},
    damageDealtPctByType: {},
  };

  const pairs = collectActiveUnitEffectDefs(unit);

  for (const { def, inst } of pairs) {
    const p = ensureInstParams(def, inst);

    if (p.cannotHeal) totals.cannotHeal = true;
    if (p.cannotUseAbilities) totals.cannotUseAbilities = true;

    const mods = safeArr(def.modifiers);
    for (const m of mods) {
      if (!m || m.op !== 'add') continue;
      const stat = m.stat;
      const val = Number.isFinite(m.value) ? m.value : 0;

      if (stat === MOD_STATS.ARMOR) totals.armorDelta += val;
      else if (stat === MOD_STATS.RANGE) totals.rangeDelta += val;
      else if (stat === MOD_STATS.HEALING_RECEIVED_PCT) totals.healingReceivedPct += val;
      else if (stat === MOD_STATS.DAMAGE_TAKEN_PCT) {
        const dt = m.damageType || 'all';
        totals.damageTakenPctByType[dt] = (totals.damageTakenPctByType[dt] || 0) + val;
      } else if (stat === MOD_STATS.DAMAGE_TAKEN_FLAT) {
        const dt = m.damageType || 'all';
        totals.damageTakenFlatByType[dt] = (totals.damageTakenFlatByType[dt] || 0) + val;
      } else if (stat === MOD_STATS.DAMAGE_DEALT_PCT) {
        const dt = m.damageType || 'all';
        totals.damageDealtPctByType[dt] = (totals.damageDealtPctByType[dt] || 0) + val;
      }
    }
  }

  return totals;
}

export function canUnitBeHealed(unit) {
  const t = getUnitModifierTotals(unit);
  return !t.cannotHeal;
}

export function canUnitUseAbilities(unit) {
  const t = getUnitModifierTotals(unit);
  return !t.cannotUseAbilities;
}

/* =========================================================================
   Ticking (turnStart/turnEnd)
   ========================================================================= */

function applyDot(unit, amount, damageType, ctx, inst) {
  const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
  const dmg = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
  unit.hp = Math.max(0, hp - dmg);

  return {
    kind: 'effect_damage',
    phase: ctx?.phase,
    turn: nowTurn(ctx),
    unitId: unit.id ?? unit.unitId ?? null,
    defId: inst?.defId,
    amount: dmg,
    damageType: damageType || null,
    hpBefore: hp,
    hpAfter: unit.hp,
  };
}

function applyRegen(unit, amount, ctx, inst) {
  const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
  const maxHp = Number.isFinite(unit.maxHp) ? unit.maxHp : (Number.isFinite(unit.hpMax) ? unit.hpMax : hp);
  const heal = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));

  // Healing received modifiers
  const totals = getUnitModifierTotals(unit);
  const pct = totals.healingReceivedPct || 0;
  const effHeal = Math.max(0, Math.round(heal * (1 + pct / 100)));

  unit.hp = Math.min(maxHp, hp + effHeal);

  return {
    kind: 'effect_heal',
    phase: ctx?.phase,
    turn: nowTurn(ctx),
    unitId: unit.id ?? unit.unitId ?? null,
    defId: inst?.defId,
    amount: effHeal,
    hpBefore: hp,
    hpAfter: unit.hp,
  };
}

function applyStatDelta(unit, mpDelta, apDelta, ctx, inst) {
  const mp0 = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);
  const ap0 = Number.isFinite(unit.ap) ? unit.ap : 0;

  const mp1 = Math.max(0, mp0 + (Number.isFinite(mpDelta) ? mpDelta : 0));
  const ap1 = Math.max(0, ap0 + (Number.isFinite(apDelta) ? apDelta : 0));

  unit.mp = mp1;
  if (Number.isFinite(unit.movementPoints)) unit.movementPoints = mp1;
  unit.ap = ap1;

  return {
    kind: 'effect_stat_delta',
    phase: ctx?.phase,
    turn: nowTurn(ctx),
    unitId: unit.id ?? unit.unitId ?? null,
    defId: inst?.defId,
    mpBefore: mp0,
    mpAfter: mp1,
    apBefore: ap0,
    apAfter: ap1,
  };
}

export function tickUnitEffects(unit, phase, ctx = {}) {
  if (!unit) return [];
  ensureUnitEffectsState(unit);

  const events = [];
  const pairs = collectActiveUnitEffectDefs(unit);

  const runCtx = { ...ctx, phase };

  for (const { def, inst } of pairs) {
    const ticks = safeArr(def.ticks);
    for (const t of ticks) {
      if (!t || t.phase !== phase) continue;

      if (t.type === TICK_ACTIONS.DOT) {
        events.push(applyDot(unit, t.amount, t.damageType, runCtx, inst));
      } else if (t.type === TICK_ACTIONS.REGEN) {
        events.push(applyRegen(unit, t.amount, runCtx, inst));
      } else if (t.type === TICK_ACTIONS.STAT_DELTA) {
        events.push(applyStatDelta(unit, t.mpDelta, t.apDelta, runCtx, inst));
      }
    }
  }

  return events;
}

export function tickHexEffects(lobbyState, allUnits, phase, ctx = {}) {
  // This project currently uses unit statuses; hex effects are still supported.
  if (!lobbyState) return [];
  ensureHexEffectsState(lobbyState);

  const events = [];
  const runCtx = { ...ctx, phase };

  const units = safeArr(allUnits);

  for (const key of Object.keys(lobbyState.hexEffects || {})) {
    const list = safeArr(lobbyState.hexEffects[key]);
    if (!list.length) continue;

    // parse key q,r
    const [qs, rs] = String(key).split(',');
    const q = Number(qs);
    const r = Number(rs);

    for (const inst of list) {
      if (!inst) continue;
      const def = getEffectDef(inst.defId);
      if (!def) continue;

      const ticks = safeArr(def.ticks);
      for (const t of ticks) {
        if (!t || t.phase !== phase) continue;

        const affectsAll = (t.affectsAllOnHex !== false);

        if (t.type === TICK_ACTIONS.DOT || t.type === TICK_ACTIONS.REGEN) {
          const targets = affectsAll
            ? units.filter(u => u && u.q === q && u.r === r && !u.isDead)
            : [];

          for (const u of targets) {
            ensureUnitEffectsState(u);
            if (t.type === TICK_ACTIONS.DOT) {
              events.push(applyDot(u, t.amount, t.damageType, runCtx, inst));
            } else {
              events.push(applyRegen(u, t.amount, runCtx, inst));
            }
          }
        }
      }
    }
  }

  return events;
}

/* =========================================================================
   Duration decrement + cleanup
   ========================================================================= */

export function decrementUnitEffectDurations(unit) {
  if (!unit || !Array.isArray(unit.effects)) return;

  for (const inst of unit.effects) {
    if (!inst) continue;
    // baseDuration <= 0 treated as infinite => keep duration <=0 untouched
    if (!Number.isFinite(inst.duration)) continue;
    if (inst.duration <= 0) continue;
    inst.duration = inst.duration - 1;
  }
}

export function cleanupExpiredUnitEffects(unit) {
  if (!unit || !Array.isArray(unit.effects)) return;
  unit.effects = unit.effects.filter(inst => {
    if (!inst) return false;
    if (!Number.isFinite(inst.duration)) return true;
    // duration <=0: keep if it was "infinite" (we treat 0 as infinite) BUT
    // for turn-based durations, it will hit 0 and should expire.
    // So we need a rule: "infinite" is represented as duration===0 AND def.baseDuration===0.
    const def = getEffectDef(inst.defId);
    const isInfinite = (def && Number.isFinite(def.baseDuration) && def.baseDuration <= 0);
    if (isInfinite) return true;
    return inst.duration > 0;
  });
}

export function decrementHexEffectDurations(lobbyState) {
  if (!lobbyState) return;
  ensureHexEffectsState(lobbyState);

  for (const key of Object.keys(lobbyState.hexEffects || {})) {
    const list = safeArr(lobbyState.hexEffects[key]);
    for (const inst of list) {
      if (!inst) continue;
      if (!Number.isFinite(inst.duration)) continue;
      if (inst.duration <= 0) continue;
      inst.duration = inst.duration - 1;
    }
  }
}

export function cleanupExpiredHexEffects(lobbyState) {
  if (!lobbyState) return;
  ensureHexEffectsState(lobbyState);

  for (const key of Object.keys(lobbyState.hexEffects || {})) {
    const list = safeArr(lobbyState.hexEffects[key]);
    const kept = list.filter(inst => {
      if (!inst) return false;
      const def = getEffectDef(inst.defId);
      const isInfinite = (def && Number.isFinite(def.baseDuration) && def.baseDuration <= 0);
      if (isInfinite) return true;
      if (!Number.isFinite(inst.duration)) return true;
      return inst.duration > 0;
    });
    lobbyState.hexEffects[key] = kept;
    if (!kept.length) delete lobbyState.hexEffects[key];
  }
}

/* =========================================================================
   Passive abilities -> effects (compat)
   ========================================================================= */

export function ensurePassiveEffects(unit, getAbilityDefFn) {
  if (!unit) return;
  ensureUnitEffectsState(unit);

  // Convention in your code: unit.passives = ['someAbilityId', ...]
  const passives = Array.isArray(unit.passives) ? unit.passives : [];
  if (!passives.length) return;

  for (const abilId of passives) {
    const a = (typeof getAbilityDefFn === 'function') ? getAbilityDefFn(abilId) : null;
    if (!a || a.kind !== 'passive') continue;

    // Allow passive to define effect ids to apply
    const effs = []
      .concat(Array.isArray(a.passive?.applyEffects) ? a.passive.applyEffects : [])
      .concat(a.passive?.effectId ? [a.passive.effectId] : []);

    for (const eId of effs) {
      if (!eId) continue;
      // baseDuration 0 => infinite
      addUnitEffect(unit, eId, { duration: 0, stacks: 1 });
    }
  }
}

/* =========================================================================
   Hook notifications (wire from WorldScene)
   ========================================================================= */

export function notifyAbilityUsed(ctx, caster, abilityId) {
  if (!caster) return [];
  ensureUnitEffectsState(caster);

  const events = [];
  const pairs = collectActiveUnitEffectDefs(caster);

  for (const { def, inst } of pairs) {
    const p = ensureInstParams(def, inst);
    const hook = p.onAbilityUse;
    if (!hook) continue;

    if (hook.type === 'damage') {
      events.push(applyDot(caster, hook.amount, hook.damageType, { ...ctx, phase: 'abilityUse' }, inst));
    }
  }

  return events;
}

export function notifyUnitMovedStep(ctx, unit) {
  if (!unit) return [];
  ensureUnitEffectsState(unit);

  const events = [];
  const pairs = collectActiveUnitEffectDefs(unit);

  for (const { def, inst } of pairs) {
    const p = ensureInstParams(def, inst);
    const hook = p.onMoveStep;
    if (!hook) continue;

    if (hook.type === 'damage') {
      events.push(applyDot(unit, hook.amount, hook.damageType, { ...ctx, phase: 'moveStep' }, inst));
    }
  }

  return events;
}

export function notifyUnitDied(ctx, unit, sceneLike = null) {
  // This is pure data; applying adjacent effects requires ability to find neighbors.
  // If you pass sceneLike with getHexesInRadius + getUnitAtHex or a resolver, it will apply.
  if (!unit) return { events: [], applied: [] };
  ensureUnitEffectsState(unit);

  const events = [];
  const applied = [];

  const pairs = collectActiveUnitEffectDefs(unit);
  for (const { def, inst } of pairs) {
    const p = ensureInstParams(def, inst);
    const spec = p.onDeathApplyAdjacent;
    if (!Array.isArray(spec) || !spec.length) continue;

    // Need a resolver to find neighbors
    const getNeighbors = sceneLike?.getHexesInRadius
      ? (q, r) => sceneLike.getHexesInRadius(q, r, 1).filter(h => !(h.q === q && h.r === r))
      : null;

    const getUnitAt = sceneLike?.getUnitAtHex
      ? (q, r) => sceneLike.getUnitAtHex(q, r)
      : null;

    if (!getNeighbors || !getUnitAt) continue;

    const neigh = getNeighbors(unit.q, unit.r);
    for (const h of neigh) {
      const u2 = getUnitAt(h.q, h.r);
      if (!u2 || u2.isDead) continue;
      ensureUnitEffectsState(u2);

      for (const s of spec) {
        if (!s || !s.effectId) continue;
        const res = addUnitEffect(u2, s.effectId, {
          duration: s.duration,
          stacks: s.stacks,
          sourceUnitId: unit.id,
          sourceFaction: unit.faction,
        });
        if (res?.ok && res?.applied) applied.push({ to: u2.id ?? u2.unitId, effectId: s.effectId });
      }
    }

    events.push({
      kind: 'effect_on_death',
      turn: nowTurn(ctx),
      unitId: unit.id ?? unit.unitId ?? null,
      defId: inst.defId,
      applied,
    });
  }

  return { events, applied };
}

/* =========================================================================
   Combat-related helpers
   ========================================================================= */

function pctToMult(pct) {
  const p = Number.isFinite(pct) ? pct : 0;
  return 1 + p / 100;
}

export function modifyIncomingDamage(attacker, defender, baseDamage, damageType) {
  const dt = String(damageType || 'physical');
  const dmg0 = Math.max(0, Math.round(Number.isFinite(baseDamage) ? baseDamage : 0));

  const t = getUnitModifierTotals(defender);
  const pct =
    (t.damageTakenPctByType?.[dt] || 0) +
    (t.damageTakenPctByType?.all || 0);

  const flat =
    (t.damageTakenFlatByType?.[dt] || 0) +
    (t.damageTakenFlatByType?.all || 0);

  const afterPct = Math.round(dmg0 * pctToMult(pct));
  const dmg = Math.max(0, afterPct + flat);

  return {
    damage: dmg,
    breakdown: { base: dmg0, pct, flat, afterPct },
  };
}

export function consumeNextHitHooks(attacker, defender, damageType, ctx = {}) {
  // "Next hit bonus" is stored on DEFENDER (CryoShatter).
  if (!defender) return { bonusDamage: 0, consumed: false };

  ensureUnitEffectsState(defender);

  let bonus = 0;
  let consumed = false;

  for (let i = 0; i < defender.effects.length; i++) {
    const inst = defender.effects[i];
    if (!inst) continue;
    const def = getEffectDef(inst.defId);
    if (!def) continue;
    const p = ensureInstParams(def, inst);
    const hook = p.nextHitBonus;
    if (!hook) continue;

    // Only apply if hook.damageType matches incoming damageType OR hook.damageType is physical and we treat unknown as physical
    const dt = String(damageType || DAMAGE_TYPES.PHYSICAL);
    if (hook.damageType && String(hook.damageType) !== dt) continue;

    const add = Math.max(0, Math.round(Number.isFinite(hook.amount) ? hook.amount : 0));
    bonus += add;

    if (hook.consume) {
      removeOneUnitEffectInstance(defender, i);
      consumed = true;
    }

    // only one "next hit" hook should fire
    break;
  }

  return { bonusDamage: bonus, consumed };
}

export default {
  ensureHexEffectsState,
  ensureUnitEffectsState,
  addUnitEffect,
  placeHexEffect,
  tickUnitEffects,
  tickHexEffects,
  decrementUnitEffectDurations,
  decrementHexEffectDurations,
  cleanupExpiredUnitEffects,
  cleanupExpiredHexEffects,
  ensurePassiveEffects,
  hexKey,

  // new helpers
  getUnitModifierTotals,
  canUnitBeHealed,
  canUnitUseAbilities,
  notifyAbilityUsed,
  notifyUnitMovedStep,
  notifyUnitDied,
  modifyIncomingDamage,
  consumeNextHitHooks,
};
