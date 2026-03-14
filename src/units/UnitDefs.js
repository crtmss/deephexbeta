// src/units/UnitDefs.js
//
// Static unit definitions for the turn-based unit system.
//
// This step integrates the new faction roster into the existing project while
// preserving the old prototype units (mobile_base / transporter / raider /
// enemy_raider) so the current map flow remains playable.
//
// NOTE:
// - Weapon numbers / exact ability behavior will be refined when the dedicated
//   weapon / active-ability tables are integrated.
// - For now UnitDefs stores canonical ids, stats, resistances, faction info,
//   economy metadata, and references to weapon / ability ids.

import { makeWeaponId } from './WeaponDefs.js';
import { makeAbilityId } from '../abilities/AbilityDefs.js';

/** @typedef {'NONE'|'LIGHT'|'MEDIUM'|'NORMAL'|'HEAVY'} ArmorClass */

/**
 * Damage types supported by the game.
 * @typedef {'physical'|'thermal'|'toxic'|'cryo'|'radiation'|'energy'|'corrosion'} DamageType
 */

/** @typedef {Partial<Record<DamageType, number>>} ResistMap */

/**
 * @typedef ResourceCost
 * @property {number} scrap
 * @property {number} food
 * @property {number} components
 * @property {number} alloy
 */

/**
 * @typedef UnitDef
 * @property {string} id
 * @property {string} name
 * @property {string} shortName
 * @property {string} faction
 * @property {string} role
 * @property {string} tier
 * @property {ArmorClass} armorClass
 * @property {number} armorPoints
 * @property {number|null} hpMax
 * @property {number} mpMax
 * @property {number} apMax
 * @property {number} visionMax
 * @property {number} groupSize
 * @property {number} moraleMax
 * @property {string[]} weapons
 * @property {string[]} [activeAbilities]
 * @property {string[]} [passiveAbilities]
 * @property {ResistMap} [resists]
 * @property {{
 *   canProduce?: string[],
 *   summonOnly?: boolean,
 *   variableHp?: { source: string, defaultHpMax: number },
 *   cost?: ResourceCost,
 *   upkeep?: ResourceCost,
 *   stack?: number,
 *   notes?: string,
 *   legacy?: boolean,
 * }} meta
 */

const BASE_RESISTS = /** @type {ResistMap} */ ({
  physical: 0,
  thermal: 0,
  toxic: 0,
  cryo: 0,
  radiation: 0,
  energy: 0,
  corrosion: 0,
});

const ZERO_COST = Object.freeze({ scrap: 0, food: 0, components: 0, alloy: 0 });

function mergeResists(resists = {}) {
  return {
    ...BASE_RESISTS,
    ...(resists || {}),
  };
}

function parseResourceCost(input) {
  if (!input) return { ...ZERO_COST };
  if (typeof input === 'object') {
    return {
      scrap: Number(input.scrap) || 0,
      food: Number(input.food) || 0,
      components: Number(input.components) || 0,
      alloy: Number(input.alloy) || 0,
    };
  }

  const out = { ...ZERO_COST };
  const parts = String(input)
    .replace(/,/g, ';')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    const m = part.match(/(scrap|food|components?|alloy)\s*([0-9]+)/i)
      || part.match(/([0-9]+)\s*(scrap|food|components?|alloy)/i);
    if (!m) continue;
    const a = m[1];
    const b = m[2];
    const keyRaw = /[a-z]/i.test(a) ? a : b;
    const valRaw = /[0-9]/.test(a) ? a : b;
    const key = keyRaw.toLowerCase().startsWith('component') ? 'components' : keyRaw.toLowerCase();
    out[key] = Number(valRaw) || 0;
  }

  return out;
}

function toArmorClass(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'HEAVY') return 'HEAVY';
  if (raw === 'NORMAL') return 'NORMAL';
  if (raw === 'MEDIUM') return 'MEDIUM';
  if (raw === 'LIGHT') return 'LIGHT';
  return 'NONE';
}

function unitId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function makeUnitDef(row) {
  const id = row.id || unitId(row.name);
  const weapons = (row.weapons || []).filter(Boolean).map(makeWeaponId);
  const activeAbilities = (row.activeAbilities || []).filter(Boolean).map(makeAbilityId);
  const passiveAbilities = (row.passiveAbilities || []).filter(Boolean).map(makeAbilityId);

  return {
    id,
    name: row.name,
    shortName: row.shortName || row.faction || '',
    faction: row.faction || 'Neutral',
    role: row.role || 'Unknown',
    tier: row.tier || 'I',
    armorClass: toArmorClass(row.armorClass),
    armorPoints: Number(row.armorPoints) || 0,
    hpMax: Number.isFinite(row.hpMax) ? row.hpMax : null,
    mpMax: Number(row.mpMax) || 0,
    apMax: Number(row.apMax) || 1,
    visionMax: Number(row.visionMax) || 4,
    groupSize: Number(row.groupSize) || 1,
    moraleMax: Number(row.moraleMax) || 0,
    weapons,
    activeAbilities,
    passiveAbilities,
    resists: mergeResists(row.resists),
    meta: {
      cost: parseResourceCost(row.cost),
      upkeep: parseResourceCost(row.upkeep),
      stack: Number(row.groupSize) || 1,
      ...(row.meta || {}),
    },
  };
}

const legacyUnits = {
  mobile_base: makeUnitDef({
    id: 'mobile_base',
    name: 'Mobile Base',
    shortName: 'Legacy',
    faction: 'Prototype',
    role: 'Base',
    tier: '0',
    armorClass: 'HEAVY',
    armorPoints: 4,
    hpMax: 50,
    mpMax: 3,
    apMax: 1,
    visionMax: 4,
    groupSize: 1,
    moraleMax: 0,
    weapons: ['Heavy Machine Gun', 'Heavy Machine Gun'],
    activeAbilities: ['Fortify', 'Smoke Screen'],
    passiveAbilities: ['Thick Plating'],
    resists: {},
    cost: ZERO_COST,
    upkeep: ZERO_COST,
    meta: {
      canProduce: ['transporter', 'raider'],
      legacy: true,
      notes: 'Preserved for current prototype scene flow.',
    },
  }),
  transporter: makeUnitDef({
    id: 'transporter',
    name: 'Transporter',
    shortName: 'Legacy',
    faction: 'Prototype',
    role: 'Logistics',
    tier: '0',
    armorClass: 'MEDIUM',
    armorPoints: 3,
    hpMax: 10,
    mpMax: 3,
    apMax: 1,
    visionMax: 4,
    groupSize: 1,
    moraleMax: 0,
    weapons: ['Light Machine Gun'],
    activeAbilities: [],
    passiveAbilities: [],
    resists: {},
    cost: { scrap: 15, food: 0, components: 0, alloy: 0 },
    upkeep: ZERO_COST,
    meta: { legacy: true },
  }),
  raider: makeUnitDef({
    id: 'raider',
    name: 'Raider',
    shortName: 'Legacy',
    faction: 'Prototype',
    role: 'Skirmisher',
    tier: '0',
    armorClass: 'LIGHT',
    armorPoints: 1,
    hpMax: 6,
    mpMax: 3,
    apMax: 1,
    visionMax: 4,
    groupSize: 4,
    moraleMax: 0,
    weapons: ['SMG', 'Cutter'],
    activeAbilities: [],
    passiveAbilities: [],
    resists: {},
    cost: { scrap: 10, food: 0, components: 0, alloy: 0 },
    upkeep: ZERO_COST,
    meta: { legacy: true },
  }),
  enemy_raider: makeUnitDef({
    id: 'enemy_raider',
    name: 'Enemy Raider',
    shortName: 'Legacy',
    faction: 'Raiders',
    role: 'Skirmisher',
    tier: '0',
    armorClass: 'LIGHT',
    armorPoints: 1,
    hpMax: 6,
    mpMax: 3,
    apMax: 1,
    visionMax: 4,
    groupSize: 4,
    moraleMax: 0,
    weapons: ['SMG', 'Cutter'],
    activeAbilities: [],
    passiveAbilities: [],
    resists: {},
    cost: ZERO_COST,
    upkeep: ZERO_COST,
    meta: { legacy: true },
  }),
};

const roster = [
  {
    name: 'Chorus warrior', shortName: 'Collective', faction: 'The Collective', role: 'Skimisher', tier: 'I', armorClass: 'NORMAL',
    visionMax: 3, hpMax: 10, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 4,
    resists: { physical: 4, thermal: 0, cryo: 2, toxic: 6, energy: 4, radiation: 2, corrosion: 4 },
    weapons: ['Chorus rifle', 'Toxic blade'], activeAbilities: ['Induce perception'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0',
  },
  {
    name: 'Chant weaver', shortName: 'Collective', faction: 'The Collective', role: 'Support', tier: 'I', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 12, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3,
    resists: { physical: 2, thermal: 0, cryo: 4, toxic: 6, energy: 2, radiation: 4, corrosion: 2 },
    weapons: ['Chorus autopistol'], activeAbilities: ['Invoke Veil', 'Veil Push'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0',
  },
  {
    name: 'Spire', shortName: 'Collective', faction: 'The Collective', role: 'Siege', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 24, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1,
    resists: { physical: 6, thermal: 4, cryo: 4, toxic: 6, energy: 2, radiation: 4, corrosion: 0 },
    weapons: ['Toxic mortar'], activeAbilities: ['Load transport', 'Unload transport'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components',
  },
  {
    name: 'Templar', shortName: 'Collective', faction: 'The Collective', role: 'Infantry', tier: 'II', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 28, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 3,
    resists: { physical: 6, thermal: 2, cryo: 2, toxic: 4, energy: 4, radiation: 4, corrosion: 2 },
    weapons: ['Veil rifle (precision mode)', 'Veil rifle (scatter mode)'], activeAbilities: ['Fortify', 'Shield slam'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Oracle', shortName: 'Collective', faction: 'The Collective', role: 'Special', tier: 'III', armorClass: 'HEAVY',
    visionMax: 5, hpMax: 35, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 1,
    resists: { physical: 4, thermal: 2, cryo: 6, toxic: 6, energy: 2, radiation: 2, corrosion: 0 },
    weapons: ['Harmonic lance'], activeAbilities: ['Mind Control'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
  },
  {
    name: 'Bulwark', shortName: 'Fabricators', faction: 'Fabricators', role: 'Infantry', tier: 'I', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 16, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 4,
    resists: { physical: 6, thermal: 6, cryo: 2, toxic: 2, energy: 4, radiation: 2, corrosion: 2 },
    weapons: ['Boiler rifle', 'Furnace drill'], activeAbilities: ['Emergency refit', 'Blast grenade'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0',
  },
  {
    name: 'Breacher', shortName: 'Fabricators', faction: 'Fabricators', role: 'Skimisher', tier: 'I', armorClass: 'NORMAL',
    visionMax: 3, hpMax: 12, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 6, cryo: 0, toxic: 2, energy: 4, radiation: 2, corrosion: 2 },
    weapons: ['Breaker shotgun'], activeAbilities: ['Flamethrower'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0',
  },
  {
    name: 'Chariot', shortName: 'Fabricators', faction: 'Fabricators', role: 'Special', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 26, mpMax: 3, apMax: 1, armorPoints: 8, moraleMax: 10, groupSize: 1,
    resists: { physical: 8, thermal: 6, cryo: 4, toxic: 2, energy: 2, radiation: 4, corrosion: 0 },
    weapons: ['Chariot cannon'], activeAbilities: ['Board', 'Evacuate'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components',
  },
  {
    name: 'Assembler', shortName: 'Fabricators', faction: 'Fabricators', role: 'Support', tier: 'II', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 18, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 4, cryo: 4, toxic: 2, energy: 2, radiation: 4, corrosion: 2 },
    weapons: ['Rivet gun', 'Great hammer'], activeAbilities: ['Calibrate', 'Field Repair'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Foundry cannon', shortName: 'Fabricators', faction: 'Fabricators', role: 'Siege', tier: 'III', armorClass: 'HEAVY',
    visionMax: 3, hpMax: 30, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 1,
    resists: { physical: 4, thermal: 6, cryo: 4, toxic: 4, energy: 0, radiation: 4, corrosion: 0 },
    weapons: ['Foundry cannon (molten shells)', 'Foundry cannon (shrapnell shells)'], activeAbilities: ['Smoke shell'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
  },
  {
    name: 'Mutant hound', shortName: 'Mutants', faction: 'Afterborn', role: 'Skimisher', tier: 'I', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 10, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 2, cryo: 2, toxic: 4, energy: 2, radiation: 6, corrosion: 0 },
    weapons: ['Feral bite'], activeAbilities: ['Crippling bite'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0',
  },
  {
    name: 'Scavenger', shortName: 'Mutants', faction: 'Afterborn', role: 'Scout', tier: 'I', armorClass: 'NORMAL',
    visionMax: 3, hpMax: 11, mpMax: 3, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4,
    resists: { physical: 2, thermal: 0, cryo: 2, toxic: 2, energy: 2, radiation: 6, corrosion: 4 },
    weapons: ['Gravecoil revolver'], activeAbilities: ['Genebroth vial'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0',
  },
  {
    name: 'Herald', shortName: 'Mutants', faction: 'Afterborn', role: 'Infantry', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 18, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1,
    resists: { physical: 6, thermal: 2, cryo: 4, toxic: 4, energy: 2, radiation: 6, corrosion: 0 },
    weapons: ['Heralds minigun'], activeAbilities: ['Adrenal surge'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components',
  },
  {
    name: 'Brute', shortName: 'Mutants', faction: 'Afterborn', role: 'Siege', tier: 'II', armorClass: 'HEAVY',
    visionMax: 3, hpMax: 26, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 1,
    resists: { physical: 2, thermal: 2, cryo: 0, toxic: 2, energy: 6, radiation: 4, corrosion: 2 },
    weapons: ['Isotope artillery', 'Carapace claws'], activeAbilities: ['Genebroth discharge'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Gene alternator', shortName: 'Mutants', faction: 'Afterborn', role: 'Special', tier: 'III', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 30, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 1,
    resists: { physical: 4, thermal: 0, cryo: 4, toxic: 2, energy: 4, radiation: 6, corrosion: 2 },
    weapons: ['Umbral carabine', 'Experimental rod'], activeAbilities: ['Grasping tendril'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
  },
  {
    name: 'Amalgamation', shortName: 'Mutants', faction: 'Afterborn', role: 'Skimisher', tier: 'III', armorClass: 'HEAVY',
    visionMax: 2, hpMax: null, mpMax: 2, apMax: 1, armorPoints: 8, moraleMax: 10, groupSize: 1,
    resists: { physical: 8, thermal: 2, cryo: 6, toxic: 2, energy: 2, radiation: 6, corrosion: 0 },
    weapons: ['Ripping talons'], activeAbilities: ['Evolution serum'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
    meta: { summonOnly: true, variableHp: { source: 'evolution_serum_target_hp', defaultHpMax: 1 }, notes: 'HP is copied from the unit consumed by Evolution Serum. Cannot be built normally.' },
  },
  {
    name: 'Operative', shortName: 'Transcendent', faction: 'Transcendent', role: 'Skimisher', tier: 'I', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 14, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4,
    resists: { physical: 2, thermal: 2, cryo: 6, toxic: 2, energy: 4, radiation: 0, corrosion: 4 },
    weapons: ['Axiom-12 Pistol', 'Stillblade'], activeAbilities: ['Smoke grenade'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0',
  },
  {
    name: 'Adept', shortName: 'Transcendent', faction: 'Transcendent', role: 'Support', tier: 'I', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 10, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3,
    resists: { physical: 2, thermal: 2, cryo: 6, toxic: 4, energy: 2, radiation: 2, corrosion: 2 },
    weapons: ['Axiom Suppressor'], activeAbilities: ['Defensive drone', 'Disrupt'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0',
  },
  {
    name: 'Phantom', shortName: 'Transcendent', faction: 'Transcendent', role: 'Scout', tier: 'II', armorClass: 'NORMAL',
    visionMax: 4, hpMax: 22, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 2, cryo: 4, toxic: 2, energy: 4, radiation: 4, corrosion: 2 },
    weapons: ['Horizon Rifle'], activeAbilities: ['Cloak'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components',
  },
  {
    name: 'Knight', shortName: 'Transcendent', faction: 'Transcendent', role: 'Infantry', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 30, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1,
    resists: { physical: 6, thermal: 2, cryo: 6, toxic: 4, energy: 2, radiation: 2, corrosion: 0 },
    weapons: ['Bastion LMG', 'Node Collapse launcher'], activeAbilities: ['Battle ram'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Wyrm', shortName: 'Transcendent', faction: 'Transcendent', role: 'Special', tier: 'III', armorClass: 'HEAVY',
    visionMax: 3, hpMax: 40, mpMax: 3, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1,
    resists: { physical: 6, thermal: 4, cryo: 6, toxic: 4, energy: 0, radiation: 4, corrosion: 0 },
    weapons: ['Vector cannon'], activeAbilities: ['Piercing shot'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
  },
  {
    name: 'Sharpshooter', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Scout', tier: 'I', armorClass: 'NORMAL',
    visionMax: 3, hpMax: 10, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4,
    resists: { physical: 2, thermal: 2, cryo: 2, toxic: 2, energy: 4, radiation: 4, corrosion: 4 },
    weapons: ['Longwatch rifle'], activeAbilities: ['Flare'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0',
  },
  {
    name: 'Line Infantry', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Infantry', tier: 'I', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 14, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 4,
    resists: { physical: 4, thermal: 2, cryo: 4, toxic: 2, energy: 4, radiation: 2, corrosion: 4 },
    weapons: ['Hullguard carbine', 'Bayonet'], activeAbilities: ['Incendinary grenade'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0',
  },
  {
    name: 'Combat engineer', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Support', tier: 'II', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 16, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 4, cryo: 2, toxic: 2, energy: 4, radiation: 4, corrosion: 2 },
    weapons: ['Ironcleaver scattergun'], activeAbilities: ['Trench', 'Lay mine'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components',
  },
  {
    name: 'Warden', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Siege', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 24, mpMax: 3, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1,
    resists: { physical: 6, thermal: 4, cryo: 4, toxic: 4, energy: 2, radiation: 4, corrosion: 0 },
    weapons: ['Keelhammer cannon'], activeAbilities: ['Board', 'Evacuate'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Tidewalker', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Special', tier: 'III', armorClass: 'HEAVY',
    visionMax: 3, hpMax: 40, mpMax: 3, apMax: 1, armorPoints: 8, moraleMax: 10, groupSize: 1,
    resists: { physical: 8, thermal: 4, cryo: 6, toxic: 4, energy: 0, radiation: 4, corrosion: 0 },
    weapons: ['Tempest rotary'], activeAbilities: ['Missile battery'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
  },
  {
    name: 'Burrower', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Skimisher', tier: 'I', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 12, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 2, cryo: 2, toxic: 4, energy: 2, radiation: 2, corrosion: 6 },
    weapons: ['Burial Fangs'], activeAbilities: ['Get mounted'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0',
  },
  {
    name: 'Hunter', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Scout', tier: 'I', armorClass: 'NORMAL',
    visionMax: 3, hpMax: 10, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4,
    resists: { physical: 2, thermal: 0, cryo: 2, toxic: 2, energy: 4, radiation: 4, corrosion: 4 },
    weapons: ['Bone slip knife', 'Throwing spear'], activeAbilities: ['Camouflage'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0',
  },
  {
    name: 'Shaman', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Support', tier: 'II', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 18, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3,
    resists: { physical: 2, thermal: 0, cryo: 4, toxic: 4, energy: 2, radiation: 2, corrosion: 4 },
    weapons: ['Sacrificial knife'], activeAbilities: ['Ritual mark'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components',
  },
  {
    name: 'Berserk', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Infantry', tier: 'II', armorClass: 'NORMAL',
    visionMax: 2, hpMax: 26, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3,
    resists: { physical: 2, thermal: 2, cryo: 2, toxic: 0, energy: 4, radiation: 4, corrosion: 2 },
    weapons: ['Gutcleaver'], activeAbilities: ['Battle trance'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Broodlord', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Special', tier: 'III', armorClass: 'HEAVY',
    visionMax: 3, hpMax: 40, mpMax: 3, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1,
    resists: { physical: 6, thermal: 2, cryo: 4, toxic: 4, energy: 0, radiation: 2, corrosion: 6 },
    weapons: ['Bloodlord fangs', 'Corrosive barrage'], activeAbilities: ['Inject larva'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2',
  },
  {
    name: 'Shaman on Burrower', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Support', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 18, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 0, cryo: 4, toxic: 4, energy: 2, radiation: 2, corrosion: 4 },
    weapons: ['Sacrificial knife', 'Burial Fangs'], activeAbilities: ['Ritual mark', 'Dismount'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
  {
    name: 'Berserk on Burrower', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Infantry', tier: 'II', armorClass: 'HEAVY',
    visionMax: 2, hpMax: 26, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3,
    resists: { physical: 4, thermal: 2, cryo: 2, toxic: 0, energy: 4, radiation: 4, corrosion: 2 },
    weapons: ['Gutcleaver', 'Burial Fangs'], activeAbilities: ['Battle trance', 'Dismount'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1',
  },
];

const rosterDefs = roster.reduce((acc, row) => {
  const def = makeUnitDef(row);
  acc[def.id] = def;
  return acc;
}, {});

export const UNIT_DEFS = /** @type {Record<string, UnitDef>} */ ({
  ...legacyUnits,
  ...rosterDefs,
});

/**
 * Defensive getter so callers can safely request a unit def.
 * @param {string} type
 * @returns {UnitDef}
 */
export function getUnitDef(type) {
  const key = String(type || '').trim().toLowerCase();
  return UNIT_DEFS[key] || UNIT_DEFS.mobile_base;
}

export function listUnitIds() {
  return Object.keys(UNIT_DEFS);
}

export default {
  UNIT_DEFS,
  getUnitDef,
  listUnitIds,
};
