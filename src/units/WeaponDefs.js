// src/units/WeaponDefs.js
//
// Data-driven weapon definitions.
//
// This stage integrates the new weapon spreadsheet into the existing project.
// The combat system now supports composite damage (multiple damage channels in one hit),
// weapon range, and optional magazine metadata.

const mkId = (s) => String(s || '')
  .trim()
  .toLowerCase()
  .replace(/["'’.]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

function makeDamage(parts = {}) {
  return {
    physical: Number(parts.physical) || 0,
    thermal: Number(parts.thermal) || 0,
    cryo: Number(parts.cryo) || 0,
    toxic: Number(parts.toxic) || 0,
    energy: Number(parts.energy) || 0,
    radiation: Number(parts.radiation) || 0,
    corrosion: Number(parts.corrosion) || 0,
  };
}

function defaultArmorClassMult() {
  return {
    NONE: 1.0,
    LIGHT: 1.0,
    MEDIUM: 1.0,
    NORMAL: 1.0,
    HEAVY: 1.0,
  };
}

function makeWeapon(name, cfg) {
  const damage = makeDamage(cfg.damage);
  const baseDamage = Object.values(damage).reduce((a, b) => a + b, 0);
  return {
    id: mkId(name),
    name,
    tier: cfg.tier || null,
    faction: cfg.faction || null,
    unit: cfg.unit || null,
    baseDamage,
    damage,
    damageTypes: Object.keys(damage).filter(k => damage[k] > 0),
    damageType: Object.keys(damage).find(k => damage[k] > 0) || 'physical',
    rangeMin: 1,
    rangeMax: Number(cfg.range) || 1,
    mag: Number(cfg.mag) || 0,
    armorClassMult: { ...defaultArmorClassMult(), ...(cfg.armorClassMult || {}) },
    distanceCurve: { ...(cfg.distanceCurve || {}) },
  };
}

const roster = [
  ['Bayonet', { faction: 'Admiralty', tier: 'I', unit: 'Line Infantry', range: 1, mag: 0, damage: { physical: 4 } }],
  ['Hullguard carbine', { faction: 'Admiralty', tier: 'I', unit: 'Line Infantry', range: 2, mag: 4, damage: { physical: 4 } }],
  ['Longwatch rifle', { faction: 'Admiralty', tier: 'I', unit: 'Sharpshooter', range: 3, mag: 2, damage: { physical: 4 } }],
  ['Ironcleaver scattergun', { faction: 'Admiralty', tier: 'II', unit: 'Combat engineer', range: 2, mag: 3, damage: { physical: 4, corrosion: 4 } }],
  ['Keelhammer cannon', { faction: 'Admiralty', tier: 'II', unit: 'Warden', range: 2, mag: 1, damage: { physical: 6, thermal: 4 } }],
  ['Tempest rotary', { faction: 'Admiralty', tier: 'III', unit: 'Tidewalker', range: 2, mag: 4, damage: { physical: 17 } }],

  ['Burial fangs', { faction: 'Cannibals', tier: 'I', unit: 'Burrower', range: 1, mag: 0, damage: { physical: 3, corrosion: 2 } }],
  ['Bone slip knife', { faction: 'Cannibals', tier: 'I', unit: 'Hunter', range: 1, mag: 0, damage: { physical: 5 } }],
  ['Throwing spear', { faction: 'Cannibals', tier: 'I', unit: 'Hunter', range: 2, mag: 1, damage: { physical: 3, toxic: 2 } }],
  ['Gutcleaver', { faction: 'Cannibals', tier: 'II', unit: 'Berserk', range: 1, mag: 0, damage: { physical: 6, corrosion: 3 } }],
  ['Sacrificial knife', { faction: 'Cannibals', tier: 'II', unit: 'Shaman', range: 1, mag: 0, damage: { toxic: 8 } }],
  ['Bloodlord fangs', { faction: 'Cannibals', tier: 'III', unit: 'Broodlord', range: 1, mag: 0, damage: { physical: 16, corrosion: 6 } }],
  ['Corrosive barrage', { faction: 'Cannibals', tier: 'III', unit: 'Broodlord', range: 2, mag: 1, damage: { physical: 2, corrosion: 10 } }],

  ['Chorus autopistol', { faction: 'Collective', tier: 'I', unit: 'Chant weaver', range: 2, mag: 2, damage: { physical: 2, energy: 2 } }],
  ['Chorus rifle', { faction: 'Collective', tier: 'I', unit: 'Chorus warrior', range: 2, mag: 3, damage: { physical: 4 } }],
  ['Toxic blade', { faction: 'Collective', tier: 'I', unit: 'Chorus warrior', range: 1, mag: 0, damage: { physical: 2, toxic: 3 } }],
  ['Toxic mortar', { faction: 'Collective', tier: 'II', unit: 'Spire', range: 3, mag: 1, damage: { physical: 3, toxic: 4 } }],
  ['Veil rifle (precision mode)', { faction: 'Collective', tier: 'II', unit: 'Templar', range: 2, mag: 4, damage: { physical: 4, toxic: 4 } }],
  ['Veil rifle (scatter mode)', { faction: 'Collective', tier: 'II', unit: 'Templar', range: 1, mag: 2, damage: { physical: 6, thermal: 4 } }],
  ['Harmonic lance', { faction: 'Collective', tier: 'III', unit: 'Oracle', range: 2, mag: 2, damage: { cryo: 6, energy: 6, radiation: 6 } }],

  ['Breaker shotgun', { faction: 'Fabricators', tier: 'I', unit: 'Breacher', range: 1, mag: 2, damage: { physical: 5 } }],
  ['Boiler rifle', { faction: 'Fabricators', tier: 'I', unit: 'Bulwark', range: 2, mag: 2, damage: { physical: 2, thermal: 2 } }],
  ['Furnace drill', { faction: 'Fabricators', tier: 'I', unit: 'Bulwark', range: 1, mag: 0, damage: { physical: 5 } }],
  ['Great hammer', { faction: 'Fabricators', tier: 'II', unit: 'Assembler', range: 1, mag: 0, damage: { physical: 10 } }],
  ['Rivet gun', { faction: 'Fabricators', tier: 'II', unit: 'Assembler', range: 2, mag: 1, damage: { physical: 3, thermal: 4 } }],
  ['Chariot cannon', { faction: 'Fabricators', tier: 'II', unit: 'Chariot', range: 2, mag: 1, damage: { physical: 4, radiation: 4 } }],
  ['Foundry cannon (molten shells)', { faction: 'Fabricators', tier: 'III', unit: 'Foundry cannon', range: 3, mag: 1, damage: { physical: 4, thermal: 10 } }],
  ['Foundry cannon (shrapnell shells)', { faction: 'Fabricators', tier: 'III', unit: 'Foundry cannon', range: 3, mag: 1, damage: { physical: 13 } }],

  ['Feral bite', { faction: 'Mutants', tier: 'I', unit: 'Mutant hound', range: 1, mag: 0, damage: { physical: 2, radiation: 3 } }],
  ['Gravecoil revolver', { faction: 'Mutants', tier: 'I', unit: 'Scavenger', range: 2, mag: 2, damage: { physical: 4 } }],
  ['Carapace claws', { faction: 'Mutants', tier: 'II', unit: 'Brute', range: 1, mag: 0, damage: { physical: 7, toxic: 2 } }],
  ['Isotope artillery', { faction: 'Mutants', tier: 'II', unit: 'Brute', range: 3, mag: 1, damage: { physical: 4, radiation: 3 } }],
  ['Heralds minigun', { faction: 'Mutants', tier: 'II', unit: 'Herald', range: 2, mag: 5, damage: { physical: 6, radiation: 2 } }],
  ['Ripping talons', { faction: 'Mutants', tier: 'III', unit: 'Amalgamation', range: 1, mag: 0, damage: { physical: 22 } }],
  ['Experimental rod', { faction: 'Mutants', tier: 'III', unit: 'Gene alternator', range: 1, mag: 1, damage: { thermal: 1, cryo: 1, toxic: 1, energy: 1, radiation: 1, corrosion: 1 } }],
  ['Umbral carabine', { faction: 'Mutants', tier: 'III', unit: 'Gene alternator', range: 2, mag: 3, damage: { physical: 6, cryo: 6, energy: 6 } }],

  ['Axiom suppressor', { faction: 'Transcendent', tier: 'I', unit: 'Adept', range: 2, mag: 3, damage: { physical: 4 } }],
  ['Axiom-12 SMG', { faction: 'Transcendent', tier: 'I', unit: 'Operative', range: 2, mag: 2, damage: { physical: 4 } }],
  ['Stillblade', { faction: 'Transcendent', tier: 'I', unit: 'Operative', range: 1, mag: 0, damage: { cryo: 3, energy: 2 } }],
  ['Horizon rifle', { faction: 'Transcendent', tier: 'II', unit: 'Phantom', range: 3, mag: 2, damage: { physical: 5, cryo: 3 } }],
  ['Bastion LMG', { faction: 'Transcendent', tier: 'II', unit: 'Knight', range: 2, mag: 3, damage: { physical: 7, cryo: 2 } }],
  ['Collapse launcher', { faction: 'Transcendent', tier: 'II', unit: 'Knight', range: 2, mag: 1, damage: { physical: 4, thermal: 4 } }],
  ['Vector cannon', { faction: 'Transcendent', tier: 'III', unit: 'Wyrm', range: 2, mag: 4, damage: { physical: 4, energy: 8, radiation: 4 } }],

  // Legacy prototype weapons kept for backwards compatibility.
  ['Heavy Machine Gun', { faction: 'Prototype', tier: '0', unit: 'Mobile Base', range: 3, mag: 0, damage: { physical: 10 }, armorClassMult: { LIGHT: 1.0, MEDIUM: 1.25, NORMAL: 1.15, HEAVY: 0.75 } }],
  ['Light Machine Gun', { faction: 'Prototype', tier: '0', unit: 'Transporter', range: 2, mag: 0, damage: { physical: 4 }, armorClassMult: { LIGHT: 1.25, MEDIUM: 0.75, NORMAL: 0.85, HEAVY: 0.50 } }],
  ['SMG', { faction: 'Prototype', tier: '0', unit: 'Raider', range: 2, mag: 0, damage: { physical: 3 }, armorClassMult: { LIGHT: 1.25, MEDIUM: 0.75, NORMAL: 0.85, HEAVY: 0.50 }, distanceCurve: { dist1: 1.25, dist2: 0.75 } }],
  ['Cutter', { faction: 'Prototype', tier: '0', unit: 'Raider', range: 1, mag: 0, damage: { physical: 6 }, armorClassMult: { LIGHT: 0.50, MEDIUM: 1.00, NORMAL: 1.00, HEAVY: 1.25 } }],
];

const weaponMap = {};
for (const [name, cfg] of roster) {
  const w = makeWeapon(name, cfg);
  weaponMap[w.id] = w;
}

export const WEAPON_IDS = Object.freeze(Object.keys(weaponMap).reduce((acc, id) => {
  acc[id.toUpperCase()] = id;
  return acc;
}, {}));

export const WEAPONS = Object.freeze(weaponMap);

export function getWeaponDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return WEAPONS[key] || WEAPONS.light_machine_gun || WEAPONS.smg;
}

export function listWeaponIds() {
  return Object.keys(WEAPONS);
}

export function makeWeaponId(name) {
  return mkId(name);
}

export default {
  WEAPON_IDS,
  WEAPONS,
  getWeaponDef,
  listWeaponIds,
  makeWeaponId,
};
