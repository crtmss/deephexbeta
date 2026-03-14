// src/units/UnitFactory.js
//
// Creates runtime unit state objects from UnitDefs.
// Also provides helpers to decorate existing Phaser unit objects with canonical stats.

import { getUnitDef } from './UnitDefs.js';

let _seq = 1;

function normalizeResists(input) {
  const src = (input && typeof input === 'object') ? input : {};
  return {
    physical: Number.isFinite(src.physical) ? src.physical : 0,
    thermal: Number.isFinite(src.thermal) ? src.thermal : 0,
    toxic: Number.isFinite(src.toxic) ? src.toxic : 0,
    cryo: Number.isFinite(src.cryo) ? src.cryo : 0,
    radiation: Number.isFinite(src.radiation) ? src.radiation : 0,
    energy: Number.isFinite(src.energy) ? src.energy : 0,
    corrosion: Number.isFinite(src.corrosion) ? src.corrosion : 0,
  };
}

export function createUnitState(opts) {
  const def = getUnitDef(opts.type);
  const id = `u${_seq++}`;

  const resolvedHpMax = Number.isFinite(opts.hpMaxOverride)
    ? Number(opts.hpMaxOverride)
    : (Number.isFinite(def.hpMax)
      ? Number(def.hpMax)
      : Number(def?.meta?.variableHp?.defaultHpMax) || 1);

  const visionMax = Number.isFinite(def.visionMax) ? def.visionMax : 4;
  const groupSize = Number.isFinite(def.groupSize) ? def.groupSize : 1;
  const moraleMax = Number.isFinite(def.moraleMax) ? def.moraleMax : 0;

  return {
    id,
    type: def.id,
    ownerId: opts.ownerId ?? null,
    ownerSlot: opts.ownerSlot ?? null,
    controller: opts.controller || 'player',
    faction: opts.faction ?? (opts.controller === 'ai' ? 'raiders' : `player${opts.ownerSlot ?? 0}`),
    q: opts.q,
    r: opts.r,
    facing: Number.isFinite(opts.facing) ? opts.facing : 0,
    level: 1,
    hpMax: resolvedHpMax,
    hp: resolvedHpMax,
    hpSource: def?.meta?.variableHp?.source ?? null,
    armorPoints: def.armorPoints,
    armorClass: def.armorClass,
    mpMax: def.mpMax,
    mp: def.mpMax,
    apMax: def.apMax,
    ap: def.apMax,
    visionMax,
    vision: visionMax,
    groupSize,
    groupAlive: groupSize,
    moraleMax,
    morale: moraleMax,
    resists: normalizeResists(def.resists),
    weapons: Array.isArray(def.weapons) ? def.weapons.slice() : [],
    activeWeaponIndex: 0,
    activeAbilities: Array.isArray(def.activeAbilities) ? def.activeAbilities.slice() : [],
    passiveAbilities: Array.isArray(def.passiveAbilities) ? def.passiveAbilities.slice() : [],
    effects: [],
    statuses: [],
    status: {},
  };
}

export function applyUnitStateToPhaserUnit(phaserUnit, state) {
  if (!phaserUnit || !state) return;
  phaserUnit.unitId = state.id;
  phaserUnit.unitType = state.type;
  phaserUnit.ownerId = state.ownerId;
  phaserUnit.ownerSlot = state.ownerSlot;
  phaserUnit.controller = state.controller;
  phaserUnit.faction = state.faction;
  if (!phaserUnit.id) phaserUnit.id = state.id;
  phaserUnit.facing = state.facing;
  phaserUnit.level = state.level;
  phaserUnit.hp = state.hp;
  phaserUnit.maxHp = state.hpMax;
  phaserUnit.hpSource = state.hpSource ?? null;
  phaserUnit.armorPoints = state.armorPoints;
  phaserUnit.armorClass = state.armorClass;
  phaserUnit.mp = state.mp;
  phaserUnit.mpMax = state.mpMax;
  phaserUnit.ap = state.ap;
  phaserUnit.apMax = state.apMax;
  phaserUnit.vision = state.vision;
  phaserUnit.visionMax = state.visionMax;
  phaserUnit.groupSize = state.groupSize;
  phaserUnit.groupAlive = state.groupAlive;
  phaserUnit.moraleMax = state.moraleMax;
  phaserUnit.morale = state.morale;
  phaserUnit.resists = state.resists;
  phaserUnit.weapons = state.weapons;
  phaserUnit.activeWeaponIndex = state.activeWeaponIndex;
  phaserUnit.activeAbilities = state.activeAbilities;
  phaserUnit.passiveAbilities = state.passiveAbilities;
  if (!Array.isArray(phaserUnit.effects)) phaserUnit.effects = state.effects || [];
  if (!Array.isArray(phaserUnit.statuses)) phaserUnit.statuses = state.statuses || [];
  phaserUnit.status = state.status;
  phaserUnit.movementPoints = state.mp;
  phaserUnit.maxMovementPoints = state.mpMax;
}

export function syncLegacyMovementFields(phaserUnit) {
  if (!phaserUnit) return;
  if (Number.isFinite(phaserUnit.mp)) phaserUnit.movementPoints = phaserUnit.mp;
  if (Number.isFinite(phaserUnit.mpMax)) phaserUnit.maxMovementPoints = phaserUnit.mpMax;
}

export default {
  createUnitState,
  applyUnitStateToPhaserUnit,
  syncLegacyMovementFields,
};
