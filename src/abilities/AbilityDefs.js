// src/abilities/AbilityDefs.js
//
// Data-driven definitions for ACTIVE and PASSIVE abilities.
//
// IMPORTANT FOR THIS STEP:
// - The unit roster is integrated first.
// - Many of the new active abilities below are safe placeholders so the roster
//   can be wired into the runtime immediately.
// - Their final targeting / effects / costs should be refined when the
//   dedicated active-abilities table is provided.

const mkId = (s) => String(s || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/['’.]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

/**
 * @typedef {'self'|'unit'|'hex'|'hex_aoe'} AbilityTarget
 */

/**
 * @typedef {object} AbilityEffectSpec
 * @property {string} effectId
 * @property {'self'|'target'} applyTo
 * @property {number} [duration]
 * @property {number} [stacks]
 * @property {object} [params]
 */

/**
 * @typedef {object} HexEffectSpec
 * @property {string} effectId
 * @property {'targetHex'|'aoe'} placeOn
 * @property {number} [duration]
 * @property {number} [stacks]
 * @property {object} [params]
 */

/**
 * @typedef {object} ActiveAbilityDef
 * @property {AbilityTarget} target
 * @property {number} apCost
 * @property {number} rangeMin
 * @property {number} rangeMax
 * @property {number} [cooldown]
 * @property {boolean} [requiresLos]
 * @property {number} [aoeRadius]
 * @property {AbilityEffectSpec[]} [applyUnitEffects]
 * @property {HexEffectSpec[]} [placeHexEffects]
 */

/**
 * @typedef {object} PassiveAbilityDef
 * @property {string} effectId
 * @property {object} [params]
 */

/**
 * @typedef {object} AbilityDef
 * @property {string} id
 * @property {'active'|'passive'} kind
 * @property {string} name
 * @property {string} description
 * @property {string} icon
 * @property {ActiveAbilityDef} [active]
 * @property {PassiveAbilityDef} [passive]
 */

function iconForAbility(name) {
  const n = String(name || '').toLowerCase();
  if (/(smoke|veil|cloak|camouflage)/.test(n)) return '🌫️';
  if (/(grenade|shell|flare|battery|mine)/.test(n)) return '💥';
  if (/(repair|refit|calibrate|drone|fortify|trance|surge|defensive)/.test(n)) return '🛡️';
  if (/(mind|disrupt|induce)/.test(n)) return '🧠';
  if (/(mark|control|ritual)/.test(n)) return '🔮';
  if (/(flame|fire|toxic|genebroth|larva|serum)/.test(n)) return '🧪';
  if (/(board|evacuate|load|unload|mounted|dismount)/.test(n)) return '🚚';
  return '✨';
}

function inferTarget(name) {
  const n = String(name || '').toLowerCase();
  if (/(grenade|shell|flare|mine|trench)/.test(n)) return 'hex';
  if (/(smoke shell|missile battery)/.test(n)) return 'hex_aoe';
  if (/(mind control|push|slam|repair|disrupt|mark|bite|tendril|ram|larva|flamethrower)/.test(n)) return 'unit';
  if (/(board|evacuate|load transport|unload transport|get mounted|dismount)/.test(n)) return 'self';
  if (/(fortify|invoke veil|induce perception|calibrate|emergency refit|adrenal surge|evolution serum|cloak|battle trance|defensive drone|camouflage)/.test(n)) return 'self';
  return 'self';
}

function inferRanges(target, name) {
  const n = String(name || '').toLowerCase();
  if (target === 'self') return { rangeMin: 0, rangeMax: 0 };
  if (target === 'unit') {
    if (/(mind control|repair|disrupt|mark)/.test(n)) return { rangeMin: 1, rangeMax: 3 };
    return { rangeMin: 1, rangeMax: 1 };
  }
  if (target === 'hex_aoe') return { rangeMin: 1, rangeMax: 3, aoeRadius: 1 };
  return { rangeMin: 1, rangeMax: 3 };
}

function createPlaceholderActive(name, overrides = {}) {
  const id = mkId(name);
  const target = overrides.target || inferTarget(name);
  const ranges = inferRanges(target, name);
  return {
    id,
    kind: 'active',
    name,
    icon: overrides.icon || iconForAbility(name),
    description: overrides.description || `Placeholder definition for ${name}. Will be refined from the active-abilities table.`,
    active: {
      target,
      apCost: overrides.apCost ?? 1,
      cooldown: overrides.cooldown ?? 0,
      requiresLos: overrides.requiresLos ?? false,
      ...ranges,
      ...(overrides.active || {}),
    },
  };
}

function createPassive(id, name, description, icon, effectId, params = {}) {
  return {
    id,
    kind: 'passive',
    name,
    icon,
    description,
    passive: { effectId, params },
  };
}

const abilityNames = [
  'Induce perception',
  'Invoke Veil',
  'Veil Push',
  'Load transport',
  'Unload transport',
  'Fortify',
  'Shield slam',
  'Mind Control',
  'Emergency refit',
  'Blast grenade',
  'Flamethrower',
  'Board',
  'Evacuate',
  'Calibrate',
  'Field Repair',
  'Smoke shell',
  'Crippling bite',
  'Genebroth vial',
  'Adrenal surge',
  'Genebroth discharge',
  'Grasping tendril',
  'Evolution serum',
  'Smoke grenade',
  'Defensive drone',
  'Disrupt',
  'Cloak',
  'Battle ram',
  'Piercing shot',
  'Flare',
  'Incendinary grenade',
  'Trench',
  'Lay mine',
  'Missile battery',
  'Get mounted',
  'Camouflage',
  'Ritual mark',
  'Battle trance',
  'Inject larva',
  'Dismount',
];

export const ABILITY_IDS = Object.freeze(abilityNames.reduce((acc, name) => {
  acc[mkId(name).toUpperCase()] = mkId(name);
  return acc;
}, {
  FORTIFY: 'fortify',
  REGEN_FIELD: 'regen_field',
  OVERCLOCK: 'overclock',
  SMOKE_SCREEN: 'smoke_screen',
  MIASMA_BOMB: 'miasma_bomb',
  FIRE_PATCH: 'fire_patch',
  THICK_PLATING: 'thick_plating',
  KEEN_SIGHT: 'keen_sight',
  SERVO_BOOST: 'servo_boost',
  RANGE_TUNING: 'range_tuning',
  TOXIN_FILTERS: 'toxin_filters',
  CORROSION_COATING: 'corrosion_coating',
}));

/** @type {Record<string, AbilityDef>} */
const abilities = {
  fortify: createPlaceholderActive('Fortify', {
    icon: '🛡️',
    description: 'Placeholder: defensive self-buff. Final effect data will be added later.',
  }),
  regen_field: createPlaceholderActive('Regen Field', {
    target: 'hex',
    icon: '💠',
    description: 'Legacy placeholder for a regenerative field.',
  }),
  overclock: createPlaceholderActive('Overclock', {
    icon: '⚡',
    description: 'Legacy placeholder for a temporary self-overclock.',
  }),
  smoke_screen: createPlaceholderActive('Smoke Screen', {
    target: 'hex_aoe',
    icon: '🌫️',
    description: 'Legacy placeholder for a smoke area ability.',
  }),
  miasma_bomb: createPlaceholderActive('Miasma Bomb', {
    target: 'hex_aoe',
    icon: '☣️',
    description: 'Legacy placeholder for a toxic area ability.',
  }),
  fire_patch: createPlaceholderActive('Fire Patch', {
    target: 'hex_aoe',
    icon: '🔥',
    description: 'Legacy placeholder for a fire area ability.',
  }),
  thick_plating: createPassive('thick_plating', 'Thick Plating', 'Permanent bonus armor.', '🧱', 'PASSIVE_THICK_PLATING', { armorBonus: 1 }),
  keen_sight: createPassive('keen_sight', 'Keen Sight', 'Permanent +vision.', '👁️', 'PASSIVE_KEEN_SIGHT', { visionBonus: 1 }),
  servo_boost: createPassive('servo_boost', 'Servo Boost', 'Permanent +MP.', '🦾', 'PASSIVE_SERVO_BOOST', { mpBonus: 1 }),
  range_tuning: createPassive('range_tuning', 'Range Tuning', 'Permanent +weapon range.', '🎯', 'PASSIVE_RANGE_TUNING', { rangeBonus: 1 }),
  toxin_filters: createPassive('toxin_filters', 'Toxin Filters', 'Reduces toxin damage taken.', '🧪', 'PASSIVE_TOXIN_FILTERS', { toxinTakenPct: -25 }),
  corrosion_coating: createPassive('corrosion_coating', 'Corrosion Coating', 'Future hook for corrosion on hit.', '🧫', 'PASSIVE_CORROSION_COATING', { corrosionOnHit: true }),
};

for (const name of abilityNames) {
  const id = mkId(name);
  if (!abilities[id]) abilities[id] = createPlaceholderActive(name);
}

export const ABILITIES = Object.freeze(abilities);

/**
 * Returns ability definition by id.
 * Falls back to a safe inert self-target placeholder if unknown.
 */
export function getAbilityDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return ABILITIES[key] || createPlaceholderActive(String(id || 'Unknown ability'));
}

export function listAbilityIds() {
  return Object.keys(ABILITIES);
}

export function isActiveAbility(id) {
  const a = getAbilityDef(id);
  return a?.kind === 'active';
}

export function isPassiveAbility(id) {
  const a = getAbilityDef(id);
  return a?.kind === 'passive';
}

export function makeAbilityId(name) {
  return mkId(name);
}

export default {
  ABILITY_IDS,
  ABILITIES,
  getAbilityDef,
  listAbilityIds,
  isActiveAbility,
  isPassiveAbility,
  makeAbilityId,
};
