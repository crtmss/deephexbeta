// src/units/WeaponDefs.js
//
// Weapon definitions.
//
// IMPORTANT FOR THIS STEP:
// - The unit roster has been integrated first.
// - Detailed weapon balance values will be refined once the dedicated weapon
//   spreadsheet is provided.
// - To keep the game stable right now, every weapon referenced by UnitDefs has
//   a safe placeholder definition with sensible range / damage type defaults.

const mkId = (s) => String(s || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/['’.]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

function titleCaseFromId(id) {
  return String(id || '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mkArmorMult({ light = 1.0, medium = 1.0, normal = medium, heavy = 1.0 } = {}) {
  return {
    LIGHT: light,
    MEDIUM: medium,
    NORMAL: normal,
    HEAVY: heavy,
    NONE: 1.0,
  };
}

function inferWeaponShape(id, name) {
  const key = `${id} ${name}`.toLowerCase();

  // Melee / close assault
  if (/(blade|knife|fang|fangs|claw|claws|hammer|drill|talon|talons|bite|ram|spear|tendril|gutcleaver|stillblade|bayonet)/.test(key)) {
    return {
      baseDamage: 6,
      rangeMin: 1,
      rangeMax: 1,
      damageType: /(toxic)/.test(key) ? 'toxic'
        : /(corrosive|burial|bloodlord)/.test(key) ? 'corrosion'
        : /(experimental|umbral|stillblade|node)/.test(key) ? 'energy'
        : 'physical',
      armorClassMult: mkArmorMult({ light: 0.9, medium: 1.0, heavy: 1.15 }),
      distanceCurve: {},
    };
  }

  // Grenades / mines / mortars / artillery / launchers / barrage / missiles
  if (/(grenade|mine|mortar|artillery|launcher|battery|barrage|shell|cannon)/.test(key)) {
    const damageType = /(toxic)/.test(key) ? 'toxic'
      : /(smoke|flare)/.test(key) ? 'physical'
      : /(molten|furnace|flame|fire|incendi)/.test(key) ? 'thermal'
      : /(isotope|radiation)/.test(key) ? 'radiation'
      : /(corrosive)/.test(key) ? 'corrosion'
      : /(vector|node|umbral)/.test(key) ? 'energy'
      : 'physical';
    return {
      baseDamage: 8,
      rangeMin: 2,
      rangeMax: 4,
      damageType,
      armorClassMult: mkArmorMult({ light: 1.1, medium: 1.0, heavy: 0.95 }),
      distanceCurve: {},
    };
  }

  // Shotguns / scatterguns
  if (/(shotgun|scatter)/.test(key)) {
    return {
      baseDamage: 5,
      rangeMin: 1,
      rangeMax: 2,
      damageType: 'physical',
      armorClassMult: mkArmorMult({ light: 1.15, medium: 1.0, heavy: 0.8 }),
      distanceCurve: { dist1: 1.2, dist2: 0.8 },
    };
  }

  // Pistols / revolvers / autopistols
  if (/(pistol|revolver|autopistol|suppressor)/.test(key)) {
    return {
      baseDamage: 3,
      rangeMin: 1,
      rangeMax: 2,
      damageType: /(gravecoil)/.test(key) ? 'radiation' : 'physical',
      armorClassMult: mkArmorMult({ light: 1.1, medium: 0.95, heavy: 0.8 }),
      distanceCurve: { dist1: 1.1, dist2: 0.9 },
    };
  }

  // Automatic / rifle family
  if (/(rifle|carbine|minigun|rotary|lmg)/.test(key)) {
    return {
      baseDamage: /(minigun|rotary|lmg)/.test(key) ? 6 : 4,
      rangeMin: 1,
      rangeMax: /(longwatch|horizon)/.test(key) ? 4 : 3,
      damageType: /(veil|harmonic|axiom|umbral)/.test(key) ? 'energy'
        : /(boiler)/.test(key) ? 'thermal'
        : 'physical',
      armorClassMult: mkArmorMult({ light: 1.0, medium: 1.0, heavy: 0.9 }),
      distanceCurve: {},
    };
  }

  return {
    baseDamage: 4,
    rangeMin: 1,
    rangeMax: 2,
    damageType: 'physical',
    armorClassMult: mkArmorMult(),
    distanceCurve: {},
  };
}

function createWeapon(id, name, overrides = {}) {
  const base = inferWeaponShape(id, name);
  return {
    id,
    name,
    ...base,
    ...overrides,
    armorClassMult: {
      ...mkArmorMult(),
      ...(base.armorClassMult || {}),
      ...(overrides.armorClassMult || {}),
    },
    distanceCurve: {
      ...(base.distanceCurve || {}),
      ...(overrides.distanceCurve || {}),
    },
  };
}

const weaponNames = [
  'Heavy Machine Gun',
  'Light Machine Gun',
  'SMG',
  'Cutter',
  'Chorus rifle',
  'Toxic blade',
  'Chorus autopistol',
  'Toxic mortar',
  'Veil rifle (precision mode)',
  'Veil rifle (scatter mode)',
  'Harmonic lance',
  'Boiler rifle',
  'Furnace drill',
  'Breaker shotgun',
  'Chariot cannon',
  'Rivet gun',
  'Great hammer',
  'Foundry cannon (molten shells)',
  'Foundry cannon (shrapnell shells)',
  'Feral bite',
  'Gravecoil revolver',
  'Heralds minigun',
  'Isotope artillery',
  'Carapace claws',
  'Umbral carabine',
  'Experimental rod',
  'Ripping talons',
  'Axiom-12 Pistol',
  'Stillblade',
  'Axiom Suppressor',
  'Horizon Rifle',
  'Bastion LMG',
  'Node Collapse launcher',
  'Vector cannon',
  'Longwatch rifle',
  'Hullguard carbine',
  'Bayonet',
  'Ironcleaver scattergun',
  'Keelhammer cannon',
  'Tempest rotary',
  'Burial Fangs',
  'Bone slip knife',
  'Throwing spear',
  'Sacrificial knife',
  'Gutcleaver',
  'Bloodlord fangs',
  'Corrosive barrage',
];

export const WEAPON_IDS = Object.freeze(weaponNames.reduce((acc, name) => {
  acc[mkId(name).toUpperCase()] = mkId(name);
  return acc;
}, {
  HMG: 'hmg',
  LMG: 'lmg',
  SMG: 'smg',
  CUTTER: 'cutter',
}));

/** @type {Record<string, any>} */
const weaponMap = {};

// Legacy weapons used by the current playable prototype
weaponMap.hmg = createWeapon('hmg', 'Heavy Machine Gun', {
  baseDamage: 10,
  rangeMin: 1,
  rangeMax: 3,
  damageType: 'physical',
  armorClassMult: mkArmorMult({ light: 1.0, medium: 1.25, normal: 1.15, heavy: 0.75 }),
});
weaponMap.lmg = createWeapon('lmg', 'Light Machine Gun', {
  baseDamage: 4,
  rangeMin: 1,
  rangeMax: 2,
  damageType: 'physical',
  armorClassMult: mkArmorMult({ light: 1.25, medium: 0.75, normal: 0.85, heavy: 0.5 }),
});
weaponMap.smg = createWeapon('smg', 'SMG', {
  baseDamage: 3,
  rangeMin: 1,
  rangeMax: 2,
  damageType: 'physical',
  armorClassMult: mkArmorMult({ light: 1.25, medium: 0.75, normal: 0.85, heavy: 0.5 }),
  distanceCurve: { dist1: 1.25, dist2: 0.75 },
});
weaponMap.cutter = createWeapon('cutter', 'Cutter', {
  baseDamage: 6,
  rangeMin: 1,
  rangeMax: 1,
  damageType: 'physical',
  armorClassMult: mkArmorMult({ light: 0.5, medium: 1.0, normal: 1.0, heavy: 1.25 }),
});

for (const name of weaponNames) {
  const id = mkId(name);
  if (!weaponMap[id]) weaponMap[id] = createWeapon(id, name);
}

export const WEAPONS = Object.freeze(weaponMap);

export function getWeaponDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return WEAPONS[key] || WEAPONS[WEAPON_IDS.LMG];
}

export function listWeaponIds() {
  return Object.keys(WEAPONS);
}

export function makeWeaponId(name) {
  return mkId(name);
}

export function getWeaponName(id) {
  return getWeaponDef(id)?.name || titleCaseFromId(id);
}

export default {
  WEAPON_IDS,
  WEAPONS,
  getWeaponDef,
  listWeaponIds,
  makeWeaponId,
  getWeaponName,
};
