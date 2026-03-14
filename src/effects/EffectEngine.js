// src/effects/EffectEngine.js
//
// Runtime interpreter for EffectDefs.js.
// Pure logic layer; no Phaser imports.

import {
  getEffectDef,
  EFFECT_KINDS,
  STACKING,
  TICK_ACTIONS,
  MOD_STATS,
  DAMAGE_TYPES,
} from './EffectDefs.js';

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

function isInfiniteDef(def) {
  return !!(def && Number.isFinite(def.baseDuration) && def.baseDuration <= 0);
}

function normalizeDamageType(dt) {
  const key = String(dt || 'physical').toLowerCase();
  return key === 'corrosive' ? 'corrosion' : key;
}

function hpMaxValue(unit) {
  if (Number.isFinite(unit?.maxHp)) return unit.maxHp;
  if (Number.isFinite(unit?.hpMax)) return unit.hpMax;
  return Number.isFinite(unit?.hp) ? unit.hp : 0;
}

function setHpMaxValue(unit, v) {
  if (!unit) return;
  if ('maxHp' in unit || Number.isFinite(unit?.maxHp)) unit.maxHp = v;
  if ('hpMax' in unit || Number.isFinite(unit?.hpMax)) unit.hpMax = v;
}

function ensureMetaBuckets(unit) {
  if (!unit || typeof unit !== 'object') return;
  if (!unit.__effectMeta || typeof unit.__effectMeta !== 'object') {
    unit.__effectMeta = { tempHpByInst: {} };
  }
  if (!unit.status || typeof unit.status !== 'object') unit.status = {};
}

export function ensureHexEffectsState(lobbyState) {
  if (!lobbyState || typeof lobbyState !== 'object') return;
  if (!lobbyState.hexEffects || typeof lobbyState.hexEffects !== 'object') lobbyState.hexEffects = {};
}

export function ensureUnitEffectsState(unit) {
  if (!unit || typeof unit !== 'object') return;
  if (!Array.isArray(unit.effects)) unit.effects = [];
  ensureMetaBuckets(unit);
}

function ensureInstParams(def, inst) {
  const base = (def && def.baseParams && typeof def.baseParams === 'object') ? def.baseParams : {};
  const p = (inst && inst.params && typeof inst.params === 'object') ? inst.params : {};
  return { ...base, ...p };
}

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

function applyTempHpBonus(unit, inst, amount) {
  ensureUnitEffectsState(unit);
  const bonus = Math.max(0, Math.round(Number(amount) || 0));
  if (!bonus) return;
  const id = inst?.id;
  if (!id) return;
  if (unit.__effectMeta.tempHpByInst[id]) return;
  unit.__effectMeta.tempHpByInst[id] = bonus;
  const max0 = hpMaxValue(unit);
  setHpMaxValue(unit, max0 + bonus);
  unit.hp = Math.max(0, (Number(unit.hp) || 0) + bonus);
}

function removeTempHpBonus(unit, inst) {
  if (!unit?.__effectMeta?.tempHpByInst) return;
  const id = inst?.id;
  if (!id) return;
  const bonus = Number(unit.__effectMeta.tempHpByInst[id]) || 0;
  if (!bonus) return;
  delete unit.__effectMeta.tempHpByInst[id];
  const max0 = hpMaxValue(unit);
  const nextMax = Math.max(1, max0 - bonus);
  setHpMaxValue(unit, nextMax);
  unit.hp = Math.min(Number(unit.hp) || 0, nextMax);
}

function applyOnAddHooks(unit, def, inst) {
  const p = ensureInstParams(def, inst);
  if (Number.isFinite(p.tempHpBonus) && p.tempHpBonus > 0) {
    applyTempHpBonus(unit, inst, p.tempHpBonus);
  }
}

function applyOnRemoveHooks(unit, def, inst) {
  const p = ensureInstParams(def, inst);
  if (Number.isFinite(p.tempHpBonus) && p.tempHpBonus > 0) {
    removeTempHpBonus(unit, inst);
  }
}

export function addUnitEffect(unit, effectId, opts = {}) {
  if (!unit) return { ok: false, reason: 'no_unit' };
  const defId = String(effectId || '').trim();
  const def = getEffectDef(defId);
  if (!def) return { ok: false, reason: 'unknown_effect', effectId: defId };

  ensureUnitEffectsState(unit);

  const duration = (Number.isFinite(opts.duration) ? opts.duration : def.baseDuration);
  const stacks = (Number.isFinite(opts.stacks) ? opts.stacks : 1);
  const existingIdx = findUnitEffectIndex(unit, defId);

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
  applyOnAddHooks(unit, def, inst);
  syncUnitStatuses(unit);
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

function collectActiveUnitEffectDefs(unit) {
  const out = [];
  for (const inst of safeArr(unit?.effects)) {
    if (!inst) continue;
    const def = getEffectDef(inst.defId);
    if (!def) continue;
    const infinite = isInfiniteDef(def);
    const hasDuration = Number.isFinite(inst.duration);
    if (!infinite && hasDuration && inst.duration <= 0) continue;
    out.push({ def, inst });
  }
  return out;
}

export function getUnitModifierTotals(unit) {
  const totals = {
    armorDelta: 0,
    rangeDelta: 0,
    visionDelta: 0,
    healingReceivedPct: 0,
    cannotHeal: false,
    cannotUseAbilities: false,
    cannotUseWeapons: false,
    invisible: false,
    revealed: false,
    damageTakenPctByType: {},
    damageTakenFlatByType: {},
    damageDealtPctByType: {},
    resistDeltaByType: {},
  };

  const pairs = collectActiveUnitEffectDefs(unit);
  for (const { def, inst } of pairs) {
    const p = ensureInstParams(def, inst);
    if (p.cannotHeal) totals.cannotHeal = true;
    if (p.cannotUseAbilities) totals.cannotUseAbilities = true;
    if (p.cannotUseWeapons) totals.cannotUseWeapons = true;
    if (p.invisible) totals.invisible = true;
    if (p.revealed) totals.revealed = true;

    for (const m of safeArr(def.modifiers)) {
      if (!m || m.op !== 'add') continue;
      const stat = m.stat;
      const val = Number.isFinite(m.value) ? m.value : 0;
      if (stat === MOD_STATS.ARMOR) totals.armorDelta += val;
      else if (stat === MOD_STATS.RANGE) totals.rangeDelta += val;
      else if (stat === MOD_STATS.VISION) totals.visionDelta += val;
      else if (stat === MOD_STATS.HEALING_RECEIVED_PCT) totals.healingReceivedPct += val;
      else if (stat === MOD_STATS.DAMAGE_TAKEN_PCT) {
        const dt = normalizeDamageType(m.damageType || 'all');
        totals.damageTakenPctByType[dt] = (totals.damageTakenPctByType[dt] || 0) + val;
      } else if (stat === MOD_STATS.DAMAGE_TAKEN_FLAT) {
        const dt = normalizeDamageType(m.damageType || 'all');
        totals.damageTakenFlatByType[dt] = (totals.damageTakenFlatByType[dt] || 0) + val;
      } else if (stat === MOD_STATS.DAMAGE_DEALT_PCT) {
        const dt = normalizeDamageType(m.damageType || 'all');
        totals.damageDealtPctByType[dt] = (totals.damageDealtPctByType[dt] || 0) + val;
      } else if (stat === MOD_STATS.RESIST_ALL) {
        for (const dt of ['physical', 'thermal', 'toxic', 'cryo', 'radiation', 'energy', 'corrosion']) {
          totals.resistDeltaByType[dt] = (totals.resistDeltaByType[dt] || 0) + val;
        }
      } else if (stat === MOD_STATS.RESIST_BY_TYPE) {
        const dt = normalizeDamageType(m.damageType || 'all');
        totals.resistDeltaByType[dt] = (totals.resistDeltaByType[dt] || 0) + val;
      }
    }
  }

  return totals;
}

export function computeEffectModifiers(unit) {
  const t = getUnitModifierTotals(unit);
  return {
    [MOD_STATS.ARMOR]: t.armorDelta || 0,
    [MOD_STATS.RANGE]: t.rangeDelta || 0,
    [MOD_STATS.VISION]: t.visionDelta || 0,
    cannotHeal: !!t.cannotHeal,
    cannotUseAbilities: !!t.cannotUseAbilities,
    cannotUseWeapons: !!t.cannotUseWeapons,
    invisible: !!t.invisible,
    revealed: !!t.revealed,
    healingReceivedPct: t.healingReceivedPct || 0,
    damageTakenPctByType: { ...(t.damageTakenPctByType || {}) },
    damageTakenFlatByType: { ...(t.damageTakenFlatByType || {}) },
    damageDealtPctByType: { ...(t.damageDealtPctByType || {}) },
    resistDeltaByType: { ...(t.resistDeltaByType || {}) },
  };
}

export function syncUnitStatuses(unit) {
  if (!unit) return [];
  ensureUnitEffectsState(unit);
  const statuses = [];
  for (const inst of safeArr(unit.effects)) {
    const def = getEffectDef(inst?.defId);
    if (!def) continue;
    const infinite = isInfiniteDef(def);
    if (!infinite && Number.isFinite(inst.duration) && inst.duration <= 0) continue;
    statuses.push({
      id: inst.id,
      effectId: inst.defId,
      icon: def.icon || inst.defId,
      name: def.name || inst.defId,
      duration: Number.isFinite(inst.duration) ? inst.duration : null,
      stacks: Number.isFinite(inst.stacks) ? inst.stacks : 1,
    });
  }
  unit.statuses = statuses.slice(0, 10);
  return unit.statuses;
}

export function canUnitBeHealed(unit) {
  return !getUnitModifierTotals(unit).cannotHeal;
}

export function canUnitUseAbilities(unit) {
  return !getUnitModifierTotals(unit).cannotUseAbilities;
}

export function canUnitUseWeapons(unit) {
  return !getUnitModifierTotals(unit).cannotUseWeapons;
}

function applyDot(unit, amount, damageType, ctx, inst) {
  const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
  const dmg = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
  unit.hp = Math.max(0, hp - dmg);
  return {
    kind: 'effect_damage', phase: ctx?.phase, turn: nowTurn(ctx), unitId: unit.id ?? unit.unitId ?? null,
    defId: inst?.defId, amount: dmg, damageType: normalizeDamageType(damageType), hpBefore: hp, hpAfter: unit.hp,
  };
}

function applyRegen(unit, amount, ctx, inst) {
  const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
  const maxHp = hpMaxValue(unit);
  const heal = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
  const totals = getUnitModifierTotals(unit);
  const pct = totals.healingReceivedPct || 0;
  const effHeal = Math.max(0, Math.round(heal * (1 + pct / 100)));
  if (totals.cannotHeal) {
    return { kind: 'effect_heal_blocked', phase: ctx?.phase, turn: nowTurn(ctx), unitId: unit.id ?? unit.unitId ?? null, defId: inst?.defId, amount: 0, hpBefore: hp, hpAfter: hp, reason: 'cannotHeal' };
  }
  unit.hp = Math.min(maxHp, hp + effHeal);
  return { kind: 'effect_heal', phase: ctx?.phase, turn: nowTurn(ctx), unitId: unit.id ?? unit.unitId ?? null, defId: inst?.defId, amount: effHeal, hpBefore: hp, hpAfter: unit.hp };
}

function applyStatDelta(unit, mpDelta, apDelta, ctx, inst) {
  const mp0 = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);
  const ap0 = Number.isFinite(unit.ap) ? unit.ap : 0;
  const mp1 = Math.max(0, mp0 + (Number.isFinite(mpDelta) ? mpDelta : 0));
  const ap1 = Math.max(0, ap0 + (Number.isFinite(apDelta) ? apDelta : 0));
  unit.mp = mp1;
  if (Number.isFinite(unit.movementPoints)) unit.movementPoints = mp1;
  unit.ap = ap1;
  return { kind: 'effect_stat_delta', phase: ctx?.phase, turn: nowTurn(ctx), unitId: unit.id ?? unit.unitId ?? null, defId: inst?.defId, mpBefore: mp0, mpAfter: mp1, apBefore: ap0, apAfter: ap1 };
}

function transformUnitInPlace(unit, targetType, opts = {}) {
  if (!unit || !targetType) return null;
  const hpBefore = Number(unit.hp) || 0;
  unit.unitType = targetType;
  unit.type = targetType;
  if (opts.copyHpToMax) {
    setHpMaxValue(unit, Math.max(1, hpBefore));
    unit.hp = Math.max(1, hpBefore);
  }
  unit.__pendingTransform = { targetType, hpBefore };
  return { unitId: unit.id ?? unit.unitId ?? null, toType: targetType, hp: unit.hp, hpMax: hpMaxValue(unit) };
}

export function tickUnitEffects(unit, phase, ctx = {}) {
  if (!unit) return [];
  ensureUnitEffectsState(unit);
  const events = [];
  const pairs = collectActiveUnitEffectDefs(unit);
  const runCtx = { ...ctx, phase };

  for (const { def, inst } of pairs) {
    const p = ensureInstParams(def, inst);

    if (phase === 'turnStart' && p.transformAtTurnStart?.unitType) {
      const tr = transformUnitInPlace(unit, p.transformAtTurnStart.unitType, { copyHpToMax: !!p.transformAtTurnStart.copyHpToMax });
      if (tr) events.push({ kind: 'effect_transform', phase, turn: nowTurn(ctx), defId: inst.defId, ...tr });
      inst.duration = 0;
      continue;
    }

    for (const t of safeArr(def.ticks)) {
      if (!t || t.phase !== phase) continue;
      if (t.type === TICK_ACTIONS.DOT) events.push(applyDot(unit, t.amount, t.damageType, runCtx, inst));
      else if (t.type === TICK_ACTIONS.REGEN) events.push(applyRegen(unit, t.amount, runCtx, inst));
      else if (t.type === TICK_ACTIONS.STAT_DELTA) events.push(applyStatDelta(unit, t.mpDelta, t.apDelta, runCtx, inst));
    }
  }

  syncUnitStatuses(unit);
  return events;
}

export function tickHexEffects(lobbyState, allUnits, phase, ctx = {}) {
  if (!lobbyState) return [];
  ensureHexEffectsState(lobbyState);
  const events = [];
  const runCtx = { ...ctx, phase };
  const units = safeArr(allUnits);

  for (const key of Object.keys(lobbyState.hexEffects || {})) {
    const list = safeArr(lobbyState.hexEffects[key]);
    if (!list.length) continue;
    const [qs, rs] = String(key).split(',');
    const q = Number(qs);
    const r = Number(rs);

    for (const inst of list) {
      const def = getEffectDef(inst?.defId);
      if (!def) continue;
      for (const t of safeArr(def.ticks)) {
        if (!t || t.phase !== phase) continue;
        const targets = units.filter(u => u && u.q === q && u.r === r && !u.isDead);
        for (const u of targets) {
          ensureUnitEffectsState(u);
          if (t.type === TICK_ACTIONS.DOT) events.push(applyDot(u, t.amount, t.damageType, runCtx, inst));
          else if (t.type === TICK_ACTIONS.REGEN) events.push(applyRegen(u, t.amount, runCtx, inst));
        }
      }
    }
  }
  return events;
}

export function decrementUnitEffectDurations(unit) {
  if (!unit || !Array.isArray(unit.effects)) return;
  for (const inst of unit.effects) {
    const def = getEffectDef(inst?.defId);
    if (isInfiniteDef(def)) continue;
    if (!Number.isFinite(inst?.duration)) continue;
    if (inst.duration <= 0) continue;
    inst.duration -= 1;
  }
}

export function cleanupExpiredUnitEffects(unit) {
  if (!unit || !Array.isArray(unit.effects)) return;
  const kept = [];
  for (const inst of unit.effects) {
    if (!inst) continue;
    const def = getEffectDef(inst.defId);
    const infinite = isInfiniteDef(def);
    const keep = infinite || !Number.isFinite(inst.duration) || inst.duration > 0;
    if (keep) kept.push(inst);
    else applyOnRemoveHooks(unit, def, inst);
  }
  unit.effects = kept;
  syncUnitStatuses(unit);
}

export function decrementHexEffectDurations(lobbyState) {
  if (!lobbyState) return;
  ensureHexEffectsState(lobbyState);
  for (const key of Object.keys(lobbyState.hexEffects || {})) {
    for (const inst of safeArr(lobbyState.hexEffects[key])) {
      const def = getEffectDef(inst?.defId);
      if (isInfiniteDef(def)) continue;
      if (!Number.isFinite(inst?.duration)) continue;
      if (inst.duration <= 0) continue;
      inst.duration -= 1;
    }
  }
}

export function cleanupExpiredHexEffects(lobbyState) {
  if (!lobbyState) return;
  ensureHexEffectsState(lobbyState);
  for (const key of Object.keys(lobbyState.hexEffects || {})) {
    const kept = safeArr(lobbyState.hexEffects[key]).filter(inst => {
      const def = getEffectDef(inst?.defId);
      return isInfiniteDef(def) || !Number.isFinite(inst?.duration) || inst.duration > 0;
    });
    if (kept.length) lobbyState.hexEffects[key] = kept;
    else delete lobbyState.hexEffects[key];
  }
}

export function ensurePassiveEffects(unit, getAbilityDefFn) {
  if (!unit) return;
  ensureUnitEffectsState(unit);
  const passives = Array.isArray(unit.passives) ? unit.passives : (Array.isArray(unit.passiveAbilities) ? unit.passiveAbilities : []);
  if (!passives.length) return;
  for (const abilId of passives) {
    const a = (typeof getAbilityDefFn === 'function') ? getAbilityDefFn(abilId) : null;
    if (!a || a.kind !== 'passive') continue;
    const effs = [].concat(Array.isArray(a.passive?.applyEffects) ? a.passive.applyEffects : []).concat(a.passive?.effectId ? [a.passive.effectId] : []);
    for (const eId of effs) addUnitEffect(unit, eId, { duration: 0, stacks: 1 });
  }
}

export function notifyAbilityUsed(ctx, caster, abilityId) {
  if (!caster) return [];
  ensureUnitEffectsState(caster);
  const events = [];
  for (const { def, inst } of collectActiveUnitEffectDefs(caster)) {
    const p = ensureInstParams(def, inst);
    const hook = p.onAbilityUse;
    if (hook?.type === 'damage') events.push(applyDot(caster, hook.amount, hook.damageType, { ...ctx, phase: 'abilityUse' }, inst));
  }
  return events;
}

export function notifyUnitMovedStep(ctx, unit) {
  if (!unit) return [];
  ensureUnitEffectsState(unit);
  const events = [];
  for (let i = unit.effects.length - 1; i >= 0; i--) {
    const inst = unit.effects[i];
    const def = getEffectDef(inst?.defId);
    if (!def) continue;
    const p = ensureInstParams(def, inst);
    const hook = p.onMoveStep;
    if (hook?.type === 'damage') events.push(applyDot(unit, hook.amount, hook.damageType, { ...ctx, phase: 'moveStep' }, inst));
    if (p.breakOnMove || p.removeIfMoved) {
      applyOnRemoveHooks(unit, def, inst);
      removeOneUnitEffectInstance(unit, i);
      events.push({ kind: 'effect_removed', reason: 'move', unitId: unit.id ?? unit.unitId ?? null, defId: inst.defId });
    }
  }
  syncUnitStatuses(unit);
  return events;
}

export function notifyUnitDied(ctx, unit, sceneLike = null) {
  if (!unit) return { events: [], applied: [] };
  ensureUnitEffectsState(unit);
  const events = [];
  const applied = [];

  const getNeighbors = sceneLike?.getHexesInRadius
    ? (q, r, radius = 1) => sceneLike.getHexesInRadius(q, r, radius).filter(h => !(h.q === q && h.r === r))
    : null;
  const getUnitAt = sceneLike?.getUnitAtHex
    ? (q, r) => sceneLike.getUnitAtHex(q, r)
    : null;

  for (const { def, inst } of collectActiveUnitEffectDefs(unit)) {
    const p = ensureInstParams(def, inst);

    if (Array.isArray(p.onDeathApplyAdjacent) && getNeighbors && getUnitAt) {
      const neigh = getNeighbors(unit.q, unit.r, Number(p.onDeathRadius) || 1);
      for (const h of neigh) {
        const u2 = getUnitAt(h.q, h.r);
        if (!u2 || u2.isDead) continue;
        for (const s of p.onDeathApplyAdjacent) {
          const res = addUnitEffect(u2, s.effectId, { duration: s.duration, stacks: s.stacks, sourceUnitId: unit.id, sourceFaction: unit.faction });
          if (res?.ok && res?.applied) applied.push({ to: u2.id ?? u2.unitId, effectId: s.effectId });
        }
      }
    }

    const allyBurst = p.onDeathAllyBurst;
    if (allyBurst && getNeighbors && getUnitAt) {
      const neigh = getNeighbors(unit.q, unit.r, Number(allyBurst.radius) || 1);
      for (const h of neigh) {
        const u2 = getUnitAt(h.q, h.r);
        if (!u2 || u2.isDead) continue;
        if (allyBurst.faction && String(u2.faction) !== String(allyBurst.faction)) continue;
        const hp0 = Number(u2.hp) || 0;
        const maxHp = hpMaxValue(u2);
        const heal = Math.max(0, Number(allyBurst.heal) || 0);
        const mp = Math.max(0, Number(allyBurst.mp) || 0);
        u2.hp = Math.min(maxHp, hp0 + heal);
        if (Number.isFinite(u2.mp)) u2.mp += mp;
        if (Number.isFinite(u2.movementPoints)) u2.movementPoints = u2.mp;
        applied.push({ to: u2.id ?? u2.unitId, kind: 'allyBurst', heal, mp });
      }
    }

    if (p.onDeathSpawnUnit) {
      events.push({ kind: 'effect_spawn_unit', turn: nowTurn(ctx), unitId: unit.id ?? unit.unitId ?? null, defId: inst.defId, q: unit.q, r: unit.r, spawn: { ...p.onDeathSpawnUnit } });
    }
  }

  return { events, applied };
}

function pctToMult(pct) {
  return 1 + (Number.isFinite(pct) ? pct : 0) / 100;
}

export function modifyIncomingDamage(attacker, defender, baseDamage, damageType) {
  const dt = normalizeDamageType(damageType);
  const dmg0 = Math.max(0, Math.round(Number.isFinite(baseDamage) ? baseDamage : 0));
  const t = getUnitModifierTotals(defender);
  const pct = (t.damageTakenPctByType?.[dt] || 0) + (t.damageTakenPctByType?.all || 0);
  const flat = (t.damageTakenFlatByType?.[dt] || 0) + (t.damageTakenFlatByType?.all || 0);
  const afterPct = Math.round(dmg0 * pctToMult(pct));
  const dmg = Math.max(0, afterPct + flat);
  return { damage: dmg, breakdown: { base: dmg0, pct, flat, afterPct } };
}

export function consumeNextHitHooks(attacker, defender, damageType, ctx = {}) {
  if (!defender) return { bonusDamage: 0, consumed: false };
  ensureUnitEffectsState(defender);
  let bonus = 0;
  let consumed = false;
  const dt = normalizeDamageType(damageType || DAMAGE_TYPES.PHYSICAL);
  for (let i = 0; i < defender.effects.length; i++) {
    const inst = defender.effects[i];
    const def = getEffectDef(inst?.defId);
    if (!def) continue;
    const hook = ensureInstParams(def, inst).nextHitBonus;
    if (!hook) continue;
    if (hook.damageType && normalizeDamageType(hook.damageType) !== dt) continue;
    bonus += Math.max(0, Math.round(Number(hook.amount) || 0));
    if (hook.consume) {
      applyOnRemoveHooks(defender, def, inst);
      removeOneUnitEffectInstance(defender, i);
      consumed = true;
    }
    break;
  }
  syncUnitStatuses(defender);
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
  computeEffectModifiers,
  getUnitModifierTotals,
  syncUnitStatuses,
  canUnitBeHealed,
  canUnitUseAbilities,
  canUnitUseWeapons,
  notifyAbilityUsed,
  notifyUnitMovedStep,
  notifyUnitDied,
  modifyIncomingDamage,
  consumeNextHitHooks,
};
