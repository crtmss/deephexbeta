// src/units/UnitDefs.js
//
// Static unit definitions for the turn-based unit system.
//
// This file integrates the supplied unit spreadsheet into the existing project.
// Legacy prototype units are preserved so the current world scene can continue to run.

import { makeWeaponId } from './WeaponDefs.js';
import { makeAbilityId } from '../abilities/AbilityDefs.js';

/** @typedef {'NONE'|'LIGHT'|'MEDIUM'|'NORMAL'|'HEAVY'} ArmorClass */
/** @typedef {'physical'|'thermal'|'toxic'|'cryo'|'radiation'|'energy'|'corrosion'} DamageType */
/** @typedef {Partial<Record<DamageType, number>>} ResistMap */

const BASE_RESISTS = {
  physical: 0,
  thermal: 0,
  toxic: 0,
  cryo: 0,
  radiation: 0,
  energy: 0,
  corrosion: 0,
};

const ZERO_COST = Object.freeze({ scrap: 0, food: 0, components: 0, alloy: 0 });

function mergeResists(resists = {}) {
  return { ...BASE_RESISTS, ...(resists || {}) };
}

function unitId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/["'’.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseResourceCost(input) {
  if (!input) return { ...ZERO_COST };
  const out = { ...ZERO_COST };
  const parts = String(input).replace(/,/g, ';').split(';').map(s => s.trim()).filter(Boolean);
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

function makeUnitDef(row) {
  return {
    id: row.id || unitId(row.name),
    name: row.name,
    shortName: row.shortName || '',
    faction: row.faction || 'Neutral',
    role: row.role || 'Unknown',
    tier: row.tier || 'I',
    armorClass: row.armorClass || 'NONE',
    armorPoints: Number(row.armorPoints) || 0,
    hpMax: Number.isFinite(row.hpMax) ? row.hpMax : null,
    mpMax: Number(row.mpMax) || 0,
    apMax: Number(row.apMax) || 1,
    visionMax: Number(row.visionMax) || 4,
    groupSize: Number(row.groupSize) || 1,
    moraleMax: Number(row.moraleMax) || 0,
    weapons: (row.weapons || []).filter(Boolean).map(makeWeaponId),
    activeAbilities: (row.activeAbilities || []).filter(Boolean).map(makeAbilityId),
    passiveAbilities: (row.passiveAbilities || []).filter(Boolean).map(makeAbilityId),
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
    id: 'mobile_base', name: 'Mobile Base', shortName: 'Legacy', faction: 'Prototype', role: 'Base', tier: '0', armorClass: 'HEAVY',
    hpMax: 50, armorPoints: 4, mpMax: 3, apMax: 1, visionMax: 4, groupSize: 1, moraleMax: 0,
    weapons: ['Heavy Machine Gun', 'Heavy Machine Gun'], activeAbilities: ['Fortify', 'Smoke Screen'], passiveAbilities: ['Thick Plating'],
    resists: {}, meta: { canProduce: ['transporter', 'raider'], legacy: true },
  }),
  transporter: makeUnitDef({
    id: 'transporter', name: 'Transporter', shortName: 'Legacy', faction: 'Prototype', role: 'Logistics', tier: '0', armorClass: 'MEDIUM',
    hpMax: 10, armorPoints: 3, mpMax: 3, apMax: 1, visionMax: 4, groupSize: 1, moraleMax: 0,
    weapons: ['Light Machine Gun'], activeAbilities: [], passiveAbilities: [], resists: {}, meta: { legacy: true },
  }),
  raider: makeUnitDef({
    id: 'raider', name: 'Raider', shortName: 'Legacy', faction: 'Prototype', role: 'Skirmisher', tier: '0', armorClass: 'LIGHT',
    hpMax: 6, armorPoints: 1, mpMax: 3, apMax: 1, visionMax: 4, groupSize: 4, moraleMax: 0,
    weapons: ['SMG', 'Cutter'], activeAbilities: [], passiveAbilities: [], resists: {}, meta: { legacy: true },
  }),
  enemy_raider: makeUnitDef({
    id: 'enemy_raider', name: 'Enemy Raider', shortName: 'Legacy', faction: 'Raiders', role: 'Skirmisher', tier: '0', armorClass: 'LIGHT',
    hpMax: 6, armorPoints: 1, mpMax: 3, apMax: 1, visionMax: 4, groupSize: 4, moraleMax: 0,
    weapons: ['SMG', 'Cutter'], activeAbilities: [], passiveAbilities: [], resists: {}, meta: { legacy: true },
  }),
};

const roster = [
  { name: 'Chorus warrior', shortName: 'Collective', faction: 'The Collective', role: 'Skimisher', tier: 'I', armorClass: 'NORMAL', visionMax: 3, hpMax: 10, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 4, resists: { physical: 4, thermal: 0, cryo: 2, toxic: 6, energy: 4, radiation: 2, corrosion: 4 }, weapons: ['Chorus rifle', 'Toxic blade'], activeAbilities: ['Induce perception'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0' },
  { name: 'Chant weaver', shortName: 'Collective', faction: 'The Collective', role: 'Support', tier: 'I', armorClass: 'NORMAL', visionMax: 2, hpMax: 12, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3, resists: { physical: 2, thermal: 0, cryo: 4, toxic: 6, energy: 2, radiation: 4, corrosion: 2 }, weapons: ['Chorus autopistol'], activeAbilities: ['Invoke Veil', 'Veil Push'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0' },
  { name: 'Spire', shortName: 'Collective', faction: 'The Collective', role: 'Siege', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 24, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1, resists: { physical: 6, thermal: 4, cryo: 4, toxic: 6, energy: 2, radiation: 4, corrosion: 0 }, weapons: ['Toxic mortar'], activeAbilities: ['Load transport', 'Unload transport'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components' },
  { name: 'Templar', shortName: 'Collective', faction: 'The Collective', role: 'Infantry', tier: 'II', armorClass: 'NORMAL', visionMax: 2, hpMax: 28, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 3, resists: { physical: 6, thermal: 2, cryo: 2, toxic: 4, energy: 4, radiation: 4, corrosion: 2 }, weapons: ['Veil rifle (precision mode)', 'Veil rifle (scatter mode)'], activeAbilities: ['Fortify', 'Shield slam'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Oracle', shortName: 'Collective', faction: 'The Collective', role: 'Special', tier: 'III', armorClass: 'HEAVY', visionMax: 5, hpMax: 35, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 1, resists: { physical: 4, thermal: 2, cryo: 6, toxic: 6, energy: 2, radiation: 2, corrosion: 0 }, weapons: ['Harmonic lance'], activeAbilities: ['Mind Control'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2' },
  { name: 'Bulwark', shortName: 'Fabricators', faction: 'Fabricators', role: 'Infantry', tier: 'I', armorClass: 'NORMAL', visionMax: 2, hpMax: 16, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 4, resists: { physical: 6, thermal: 6, cryo: 2, toxic: 2, energy: 4, radiation: 2, corrosion: 2 }, weapons: ['Boiler rifle', 'Furnace drill'], activeAbilities: ['Emergency refit', 'Blast grenade'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0' },
  { name: 'Breacher', shortName: 'Fabricators', faction: 'Fabricators', role: 'Skimisher', tier: 'I', armorClass: 'NORMAL', visionMax: 3, hpMax: 12, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 6, cryo: 0, toxic: 2, energy: 4, radiation: 2, corrosion: 2 }, weapons: ['Breaker shotgun'], activeAbilities: ['Flamethrower'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0' },
  { name: 'Chariot', shortName: 'Fabricators', faction: 'Fabricators', role: 'Special', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 26, mpMax: 3, apMax: 1, armorPoints: 8, moraleMax: 10, groupSize: 1, resists: { physical: 8, thermal: 6, cryo: 4, toxic: 2, energy: 2, radiation: 4, corrosion: 0 }, weapons: ['Chariot cannon'], activeAbilities: ['Board', 'Evacuate'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components' },
  { name: 'Assembler', shortName: 'Fabricators', faction: 'Fabricators', role: 'Support', tier: 'II', armorClass: 'NORMAL', visionMax: 2, hpMax: 18, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 4, cryo: 4, toxic: 2, energy: 2, radiation: 4, corrosion: 2 }, weapons: ['Rivet gun', 'Great hammer'], activeAbilities: ['Calibrate', 'Field Repair'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Foundry cannon', shortName: 'Fabricators', faction: 'Fabricators', role: 'Siege', tier: 'III', armorClass: 'HEAVY', visionMax: 3, hpMax: 30, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 1, resists: { physical: 4, thermal: 6, cryo: 4, toxic: 4, energy: 0, radiation: 4, corrosion: 0 }, weapons: ['Foundry cannon (molten shells)', 'Foundry cannon (shrapnell shells)'], activeAbilities: ['Smoke shell'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2' },
  { name: 'Mutant hound', shortName: 'Mutants', faction: 'Afterborn', role: 'Skimisher', tier: 'I', armorClass: 'HEAVY', visionMax: 2, hpMax: 10, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 2, cryo: 2, toxic: 4, energy: 2, radiation: 6, corrosion: 0 }, weapons: ['Feral bite'], activeAbilities: ['Crippling bite'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0' },
  { name: 'Scavenger', shortName: 'Mutants', faction: 'Afterborn', role: 'Scout', tier: 'I', armorClass: 'NORMAL', visionMax: 3, hpMax: 11, mpMax: 3, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4, resists: { physical: 2, thermal: 0, cryo: 2, toxic: 2, energy: 2, radiation: 6, corrosion: 4 }, weapons: ['Gravecoil revolver'], activeAbilities: ['Genebroth vial'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0' },
  { name: 'Herald', shortName: 'Mutants', faction: 'Afterborn', role: 'Infantry', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 18, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1, resists: { physical: 6, thermal: 2, cryo: 4, toxic: 4, energy: 2, radiation: 6, corrosion: 0 }, weapons: ['Heralds minigun'], activeAbilities: ['Adrenal surge'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components' },
  { name: 'Brute', shortName: 'Mutants', faction: 'Afterborn', role: 'Siege', tier: 'II', armorClass: 'HEAVY', visionMax: 3, hpMax: 26, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 1, resists: { physical: 2, thermal: 2, cryo: 0, toxic: 2, energy: 6, radiation: 4, corrosion: 2 }, weapons: ['Isotope artillery', 'Carapace claws'], activeAbilities: ['Genebroth discharge'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Gene alternator', shortName: 'Mutants', faction: 'Afterborn', role: 'Special', tier: 'III', armorClass: 'NORMAL', visionMax: 2, hpMax: 30, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 1, resists: { physical: 4, thermal: 0, cryo: 4, toxic: 2, energy: 4, radiation: 6, corrosion: 2 }, weapons: ['Umbral carabine', 'Experimental rod'], activeAbilities: ['Grasping tendril'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2' },
  { name: 'Amalgamation', shortName: 'Mutants', faction: 'Afterborn', role: 'Skimisher', tier: 'III', armorClass: 'HEAVY', visionMax: 2, hpMax: null, mpMax: 2, apMax: 1, armorPoints: 8, moraleMax: 10, groupSize: 1, resists: { physical: 8, thermal: 2, cryo: 6, toxic: 2, energy: 2, radiation: 6, corrosion: 0 }, weapons: ['Ripping talons'], activeAbilities: ['Evolution serum'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2', meta: { summonOnly: true, variableHp: { source: 'evolution_serum_target_hp', defaultHpMax: 1 }, notes: 'HP is copied from the unit targeted by Evolution Serum. Cannot be built normally.' } },
  { name: 'Operative', shortName: 'Transcendent', faction: 'Transcendent', role: 'Skimisher', tier: 'I', armorClass: 'NORMAL', visionMax: 2, hpMax: 14, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4, resists: { physical: 2, thermal: 2, cryo: 6, toxic: 2, energy: 4, radiation: 0, corrosion: 4 }, weapons: ['Axiom-12 SMG', 'Stillblade'], activeAbilities: ['Smoke grenade'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0' },
  { name: 'Adept', shortName: 'Transcendent', faction: 'Transcendent', role: 'Support', tier: 'I', armorClass: 'NORMAL', visionMax: 2, hpMax: 10, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3, resists: { physical: 2, thermal: 2, cryo: 6, toxic: 4, energy: 2, radiation: 2, corrosion: 2 }, weapons: ['Axiom suppressor'], activeAbilities: ['Defensive drone', 'Disrupt'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0' },
  { name: 'Phantom', shortName: 'Transcendent', faction: 'Transcendent', role: 'Scout', tier: 'II', armorClass: 'NORMAL', visionMax: 4, hpMax: 22, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 2, cryo: 4, toxic: 2, energy: 4, radiation: 4, corrosion: 2 }, weapons: ['Horizon rifle'], activeAbilities: ['Cloak'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components' },
  { name: 'Knight', shortName: 'Transcendent', faction: 'Transcendent', role: 'Infantry', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 30, mpMax: 2, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1, resists: { physical: 6, thermal: 2, cryo: 6, toxic: 4, energy: 2, radiation: 2, corrosion: 0 }, weapons: ['Bastion LMG', 'Collapse launcher'], activeAbilities: ['Battle ram'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Wyrm', shortName: 'Transcendent', faction: 'Transcendent', role: 'Special', tier: 'III', armorClass: 'HEAVY', visionMax: 3, hpMax: 40, mpMax: 3, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1, resists: { physical: 6, thermal: 4, cryo: 6, toxic: 4, energy: 0, radiation: 4, corrosion: 0 }, weapons: ['Vector cannon'], activeAbilities: ['Piercing shot'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2' },
  { name: 'Sharpshooter', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Scout', tier: 'I', armorClass: 'NORMAL', visionMax: 3, hpMax: 10, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4, resists: { physical: 2, thermal: 2, cryo: 2, toxic: 2, energy: 4, radiation: 4, corrosion: 4 }, weapons: ['Longwatch rifle'], activeAbilities: ['Flare'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0' },
  { name: 'Line Infantry', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Infantry', tier: 'I', armorClass: 'NORMAL', visionMax: 2, hpMax: 14, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 4, resists: { physical: 4, thermal: 2, cryo: 4, toxic: 2, energy: 4, radiation: 2, corrosion: 4 }, weapons: ['Hullguard carbine', 'Bayonet'], activeAbilities: ['Incendinary grenade'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0' },
  { name: 'Combat engineer', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Support', tier: 'II', armorClass: 'NORMAL', visionMax: 2, hpMax: 16, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 4, cryo: 2, toxic: 2, energy: 4, radiation: 4, corrosion: 2 }, weapons: ['Ironcleaver scattergun'], activeAbilities: ['Trench', 'Lay mine'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components' },
  { name: 'Warden', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Siege', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 24, mpMax: 3, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1, resists: { physical: 6, thermal: 4, cryo: 4, toxic: 4, energy: 2, radiation: 4, corrosion: 0 }, weapons: ['Keelhammer cannon'], activeAbilities: ['Board', 'Evacuate'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Tidewalker', shortName: 'Admiralty', faction: 'Chain Admiralty', role: 'Special', tier: 'III', armorClass: 'HEAVY', visionMax: 3, hpMax: 40, mpMax: 3, apMax: 1, armorPoints: 8, moraleMax: 10, groupSize: 1, resists: { physical: 8, thermal: 4, cryo: 6, toxic: 4, energy: 0, radiation: 4, corrosion: 0 }, weapons: ['Tempest rotary'], activeAbilities: ['Missile battery'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2' },
  { name: 'Burrower', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Skimisher', tier: 'I', armorClass: 'HEAVY', visionMax: 2, hpMax: 12, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 2, cryo: 2, toxic: 4, energy: 2, radiation: 2, corrosion: 6 }, weapons: ['Burial fangs'], activeAbilities: ['Get mounted'], cost: 'Scrap 20; Food 50; Components 0; Alloy 0', upkeep: 'Scrap 2; Food 5; Components 0; Alloy 0' },
  { name: 'Hunter', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Scout', tier: 'I', armorClass: 'NORMAL', visionMax: 3, hpMax: 10, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 4, resists: { physical: 2, thermal: 0, cryo: 2, toxic: 2, energy: 4, radiation: 4, corrosion: 4 }, weapons: ['Bone slip knife', 'Throwing spear'], activeAbilities: ['Camouflage'], cost: 'Scrap 40; Food 40; Components 0; Alloy 0', upkeep: 'Scrap 4; Food 4; Components 0; Alloy 0' },
  { name: 'Shaman', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Support', tier: 'II', armorClass: 'NORMAL', visionMax: 2, hpMax: 18, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3, resists: { physical: 2, thermal: 0, cryo: 4, toxic: 4, energy: 2, radiation: 2, corrosion: 4 }, weapons: ['Sacrificial knife'], activeAbilities: ['Ritual mark'], cost: '40 scrap, 10 components', upkeep: '4 scrap, 1 components' },
  { name: 'Berserk', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Infantry', tier: 'II', armorClass: 'NORMAL', visionMax: 2, hpMax: 26, mpMax: 2, apMax: 1, armorPoints: 2, moraleMax: 10, groupSize: 3, resists: { physical: 2, thermal: 2, cryo: 2, toxic: 0, energy: 4, radiation: 4, corrosion: 2 }, weapons: ['Gutcleaver'], activeAbilities: ['Battle trance'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Broodlord', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Special', tier: 'III', armorClass: 'HEAVY', visionMax: 3, hpMax: 40, mpMax: 3, apMax: 1, armorPoints: 6, moraleMax: 10, groupSize: 1, resists: { physical: 6, thermal: 2, cryo: 4, toxic: 4, energy: 0, radiation: 2, corrosion: 6 }, weapons: ['Bloodlord fangs', 'Corrosive barrage'], activeAbilities: ['Inject larva'], cost: 'Scrap 150; Food 60; Components 40; Alloy 20', upkeep: 'Scrap 15; Food 6; Components 4; Alloy 2' },
  { name: 'Shaman on Burrower', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Support', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 18, mpMax: 3, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 0, cryo: 4, toxic: 4, energy: 2, radiation: 2, corrosion: 4 }, weapons: ['Sacrificial knife', 'Burial fangs'], activeAbilities: ['Ritual mark', 'Dismount'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
  { name: 'Berserk on Burrower', shortName: 'Cannibals', faction: 'Fleshbound Clans', role: 'Infantry', tier: 'II', armorClass: 'HEAVY', visionMax: 2, hpMax: 26, mpMax: 2, apMax: 1, armorPoints: 4, moraleMax: 10, groupSize: 3, resists: { physical: 4, thermal: 2, cryo: 2, toxic: 0, energy: 4, radiation: 4, corrosion: 2 }, weapons: ['Gutcleaver', 'Burial fangs'], activeAbilities: ['Battle trance', 'Dismount'], cost: 'Scrap 50; Food 50; Components 5; Alloy 5', upkeep: 'Scrap 9; Food 4; Components 1; Alloy 1' },
];

const rosterDefs = roster.reduce((acc, row) => {
  const def = makeUnitDef(row);
  acc[def.id] = def;
  return acc;
}, {});

export const UNIT_DEFS = { ...legacyUnits, ...rosterDefs };

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
