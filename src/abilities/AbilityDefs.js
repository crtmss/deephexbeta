// src/abilities/AbilityDefs.js
//
// Data-driven definitions for ACTIVE and PASSIVE abilities.
//
// In this stage the project already has the new roster, but the final active-ability
// spreadsheet has not been integrated yet. To keep the runtime stable, every new
// ability name from UnitDefs is registered here as a safe placeholder definition.
//
// When the dedicated active-abilities table arrives, these placeholder defs can be
// replaced one by one without changing unit ids or unit references.

const mkId = (s) => String(s || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/["'’.]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const ABILITY_IDS = Object.freeze({
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

  INDUCE_PERCEPTION: 'induce_perception',
  INVOKE_VEIL: 'invoke_veil',
  VEIL_PUSH: 'veil_push',
  LOAD_TRANSPORT: 'load_transport',
  UNLOAD_TRANSPORT: 'unload_transport',
  SHIELD_SLAM: 'shield_slam',
  MIND_CONTROL: 'mind_control',
  EMERGENCY_REFIT: 'emergency_refit',
  BLAST_GRENADE: 'blast_grenade',
  FLAMETHROWER: 'flamethrower',
  BOARD: 'board',
  EVACUATE: 'evacuate',
  CALIBRATE: 'calibrate',
  FIELD_REPAIR: 'field_repair',
  SMOKE_SHELL: 'smoke_shell',
  CRIPPLING_BITE: 'crippling_bite',
  GENEBROTH_VIAL: 'genebroth_vial',
  ADRENAL_SURGE: 'adrenal_surge',
  GENEBROTH_DISCHARGE: 'genebroth_discharge',
  GRASPING_TENDRIL: 'grasping_tendril',
  EVOLUTION_SERUM: 'evolution_serum',
  SMOKE_GRENADE: 'smoke_grenade',
  DEFENSIVE_DRONE: 'defensive_drone',
  DISRUPT: 'disrupt',
  CLOAK: 'cloak',
  BATTLE_RAM: 'battle_ram',
  PIERCING_SHOT: 'piercing_shot',
  FLARE: 'flare',
  INCENDINARY_GRENADE: 'incendinary_grenade',
  TRENCH: 'trench',
  LAY_MINE: 'lay_mine',
  MISSILE_BATTERY: 'missile_battery',
  GET_MOUNTED: 'get_mounted',
  CAMOUFLAGE: 'camouflage',
  RITUAL_MARK: 'ritual_mark',
  BATTLE_TRANCE: 'battle_trance',
  INJECT_LARVA: 'inject_larva',
  DISMOUNT: 'dismount',
});

function inferTarget(name) {
  const n = String(name || '').toLowerCase();
  if (/(grenade|shell|flare|mine|trench|battery)/.test(n)) return 'hex';
  if (/(push|slam|control|repair|bite|tendril|ram|larva|flamethrower|disrupt|mark)/.test(n)) return 'unit';
  return 'self';
}

function inferRanges(target, name) {
  const n = String(name || '').toLowerCase();
  if (target === 'self') return { rangeMin: 0, rangeMax: 0 };
  if (target === 'unit') {
    if (/(mind control|field repair|disrupt|ritual mark)/.test(n)) return { rangeMin: 1, rangeMax: 3 };
    return { rangeMin: 1, rangeMax: 1 };
  }
  if (/(smoke shell|missile battery)/.test(n)) return { rangeMin: 1, rangeMax: 3, aoeRadius: 1 };
  return { rangeMin: 1, rangeMax: 3 };
}

function iconForAbility(name) {
  const n = String(name || '').toLowerCase();
  if (/(smoke|veil|cloak|camouflage)/.test(n)) return '🌫️';
  if (/(grenade|shell|battery|mine|flare)/.test(n)) return '💥';
  if (/(repair|refit|drone|fortify|trance|surge|calibrate)/.test(n)) return '🛡️';
  if (/(mind|induce|disrupt)/.test(n)) return '🧠';
  if (/(mark|ritual|control)/.test(n)) return '🔮';
  if (/(toxic|serum|genebroth|larva|flame)/.test(n)) return '🧪';
  if (/(board|evacuate|load|unload|mounted|dismount)/.test(n)) return '🚚';
  return '✨';
}

function createPlaceholderActive(name, overrides = {}) {
  const id = mkId(name);
  const target = overrides.target || inferTarget(name);
  return {
    id,
    kind: 'active',
    name,
    description: overrides.description || `Placeholder definition for ${name}. Final behavior will be added from the active-abilities table.`,
    icon: overrides.icon || iconForAbility(name),
    active: {
      target,
      apCost: overrides.apCost ?? 1,
      cooldown: overrides.cooldown ?? 0,
      requiresLos: overrides.requiresLos ?? false,
      ...inferRanges(target, name),
      ...(overrides.active || {}),
    },
  };
}

function createPassive(id, name, description, icon, effectId, params = {}) {
  return {
    id,
    kind: 'passive',
    name,
    description,
    icon,
    passive: { effectId, params },
  };
}

const placeholderNames = [
  'Induce perception', 'Invoke Veil', 'Veil Push', 'Load transport', 'Unload transport',
  'Shield slam', 'Mind Control', 'Emergency refit', 'Blast grenade', 'Flamethrower',
  'Board', 'Evacuate', 'Calibrate', 'Field Repair', 'Smoke shell', 'Crippling bite',
  'Genebroth vial', 'Adrenal surge', 'Genebroth discharge', 'Grasping tendril',
  'Evolution serum', 'Smoke grenade', 'Defensive drone', 'Disrupt', 'Cloak',
  'Battle ram', 'Piercing shot', 'Flare', 'Incendinary grenade', 'Trench',
  'Lay mine', 'Missile battery', 'Get mounted', 'Camouflage', 'Ritual mark',
  'Battle trance', 'Inject larva', 'Dismount',
];

const abilities = {
  [ABILITY_IDS.FORTIFY]: createPlaceholderActive('Fortify', { icon: '🛡️' }),
  [ABILITY_IDS.REGEN_FIELD]: createPlaceholderActive('Regen Field', { target: 'hex', icon: '💠' }),
  [ABILITY_IDS.OVERCLOCK]: createPlaceholderActive('Overclock', { icon: '⚡' }),
  [ABILITY_IDS.SMOKE_SCREEN]: createPlaceholderActive('Smoke Screen', { target: 'hex', icon: '🌫️' }),
  [ABILITY_IDS.MIASMA_BOMB]: createPlaceholderActive('Miasma Bomb', { target: 'hex', icon: '☣️' }),
  [ABILITY_IDS.FIRE_PATCH]: createPlaceholderActive('Fire Patch', { target: 'hex', icon: '🔥' }),

  [ABILITY_IDS.THICK_PLATING]: createPassive('thick_plating', 'Thick Plating', 'Permanent bonus armor.', '🧱', 'PASSIVE_THICK_PLATING', { armorBonus: 1 }),
  [ABILITY_IDS.KEEN_SIGHT]: createPassive('keen_sight', 'Keen Sight', 'Permanent +vision.', '👁️', 'PASSIVE_KEEN_SIGHT', { visionBonus: 1 }),
  [ABILITY_IDS.SERVO_BOOST]: createPassive('servo_boost', 'Servo Boost', 'Permanent +MP.', '🦾', 'PASSIVE_SERVO_BOOST', { mpBonus: 1 }),
  [ABILITY_IDS.RANGE_TUNING]: createPassive('range_tuning', 'Range Tuning', 'Permanent +weapon range.', '🎯', 'PASSIVE_RANGE_TUNING', { rangeBonus: 1 }),
  [ABILITY_IDS.TOXIN_FILTERS]: createPassive('toxin_filters', 'Toxin Filters', 'Reduces toxin damage taken.', '🧪', 'PASSIVE_TOXIN_FILTERS', { toxinTakenPct: -25 }),
  [ABILITY_IDS.CORROSION_COATING]: createPassive('corrosion_coating', 'Corrosion Coating', 'Future hook for corrosion on hit.', '🧫', 'PASSIVE_CORROSION_COATING', { corrosionOnHit: true }),
};

for (const name of placeholderNames) {
  const id = mkId(name);
  if (!abilities[id]) abilities[id] = createPlaceholderActive(name);
}

export const ABILITIES = Object.freeze(abilities);

export function getAbilityDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return ABILITIES[key] || createPlaceholderActive(String(id || 'Unknown ability'));
}

export function listAbilityIds() {
  return Object.keys(ABILITIES);
}

export function isActiveAbility(id) {
  return getAbilityDef(id)?.kind === 'active';
}

export function isPassiveAbility(id) {
  return getAbilityDef(id)?.kind === 'passive';
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
