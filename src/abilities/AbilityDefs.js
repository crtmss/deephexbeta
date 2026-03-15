  // src/abilities/AbilityDefs.js
//
// Data-driven definitions for ACTIVE and PASSIVE abilities.
//
// This version integrates the supplied active-abilities table while preserving
// the existing runtime contract used by WorldScene and AbilityController.
//
// Notes:
// - active.applyUnitEffects / active.placeHexEffects continue to work exactly
//   as before.
// - Additional optional fields were added for richer runtime handling:
//   mpCost, heal, damage, removeHexEffects, convertHexEffects, selfMpDelta,
//   selfApDelta, targetMpDelta, targetApDelta, runtime.

import { EFFECT_IDS } from '../effects/EffectDefs.js';

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

  FLARE: 'flare',
  INCENDINARY_GRENADE: 'incendinary_grenade',
  TRENCH: 'trench',
  LAY_MINE: 'lay_mine',
  BOARD: 'board',
  EVACUATE: 'evacuate',
  MISSILE_BATTERY: 'missile_battery',
  EMERGENCY_REFIT: 'emergency_refit',
  BLAST_GRENADE: 'blast_grenade',
  FLAMETHROWER: 'flamethrower',
  FIELD_REPAIR: 'field_repair',
  CALIBRATE: 'calibrate',
  SMOKE_SHELL: 'smoke_shell',
  CRIPPLING_BITE: 'crippling_bite',
  GENEBROTH_VIAL: 'genebroth_vial',
  ADRENAL_SURGE: 'adrenal_surge',
  GENEBROTH_DISCHARGE: 'genebroth_discharge',
  GRASPING_TENDRIL: 'grasping_tendril',
  EVOLUTION_SERUM: 'evolution_serum',
  DEFENSIVE_DRONE: 'defensive_drone',
  DISRUPT: 'disrupt',
  SMOKE_GRENADE: 'smoke_grenade',
  CLOAK: 'cloak',
  BATTLE_RAM: 'battle_ram',
  PIERCING_SHOT: 'piercing_shot',
  GET_MOUNTED: 'get_mounted',
  DISMOUNT: 'dismount',
  CAMOUFLAGE: 'camouflage',
  BATTLE_TRANCE: 'battle_trance',
  RITUAL_MARK: 'ritual_mark',
  INJECT_LARVA: 'inject_larva',
  INDUCE_PERCEPTION: 'induce_perception',
  INVOKE_VEIL: 'invoke_veil',
  VEIL_PUSH: 'veil_push',
  SHIELD_SLAM: 'shield_slam',
  MIND_CONTROL: 'mind_control',
});

function passive(id, name, description, icon, effectId, params = {}) {
  return { id, kind: 'passive', name, description, icon, passive: { effectId, params } };
}

function active(name, cfg = {}) {
  const id = cfg.id || mkId(name);
  return {
    id,
    kind: 'active',
    name,
    description: cfg.description || name,
    icon: cfg.icon || '✨',
    active: {
      target: cfg.target || 'self',
      apCost: Number.isFinite(cfg.apCost) ? cfg.apCost : 1,
      mpCost: Number.isFinite(cfg.mpCost) ? cfg.mpCost : 0,
      rangeMin: Number.isFinite(cfg.rangeMin) ? cfg.rangeMin : 0,
      rangeMax: Number.isFinite(cfg.rangeMax) ? cfg.rangeMax : 0,
      aoeRadius: Number.isFinite(cfg.aoeRadius) ? cfg.aoeRadius : 0,
      cooldown: Number.isFinite(cfg.cooldown) ? cfg.cooldown : 5,
      requiresLos: !!cfg.requiresLos,
      enemyOnly: !!cfg.enemyOnly,
      allyOnly: !!cfg.allyOnly,
      emptyOnly: !!cfg.emptyOnly,
      allowedTargetArmorClasses: Array.isArray(cfg.allowedTargetArmorClasses) ? cfg.allowedTargetArmorClasses.slice() : undefined,
      applyUnitEffects: Array.isArray(cfg.applyUnitEffects) ? cfg.applyUnitEffects : [],
      placeHexEffects: Array.isArray(cfg.placeHexEffects) ? cfg.placeHexEffects : [],
      removeHexEffects: Array.isArray(cfg.removeHexEffects) ? cfg.removeHexEffects : [],
      convertHexEffects: Array.isArray(cfg.convertHexEffects) ? cfg.convertHexEffects : [],
      heal: cfg.heal || null,
      damage: cfg.damage || null,
      selfMpDelta: Number.isFinite(cfg.selfMpDelta) ? cfg.selfMpDelta : 0,
      selfApDelta: Number.isFinite(cfg.selfApDelta) ? cfg.selfApDelta : 0,
      targetMpDelta: Number.isFinite(cfg.targetMpDelta) ? cfg.targetMpDelta : 0,
      targetApDelta: Number.isFinite(cfg.targetApDelta) ? cfg.targetApDelta : 0,
      runtime: cfg.runtime || null,
    },
  };
}

const A = {
  [ABILITY_IDS.THICK_PLATING]: passive('thick_plating', 'Thick Plating', 'Permanent bonus armor.', '🧱', 'PASSIVE_THICK_PLATING', { armorBonus: 1 }),
  [ABILITY_IDS.KEEN_SIGHT]: passive('keen_sight', 'Keen Sight', 'Permanent +vision.', '👁️', 'PASSIVE_KEEN_SIGHT', { visionBonus: 1 }),
  [ABILITY_IDS.SERVO_BOOST]: passive('servo_boost', 'Servo Boost', 'Permanent +MP.', '🦾', 'PASSIVE_SERVO_BOOST', { mpBonus: 1 }),
  [ABILITY_IDS.RANGE_TUNING]: passive('range_tuning', 'Range Tuning', 'Permanent +weapon range.', '🎯', 'PASSIVE_RANGE_TUNING', { rangeBonus: 1 }),
  [ABILITY_IDS.TOXIN_FILTERS]: passive('toxin_filters', 'Toxin Filters', 'Reduces toxin damage taken.', '🧪', 'PASSIVE_TOXIN_FILTERS', { toxinTakenPct: -25 }),
  [ABILITY_IDS.CORROSION_COATING]: passive('corrosion_coating', 'Corrosion Coating', 'Future hook for corrosion on hit.', '🧫', 'PASSIVE_CORROSION_COATING', { corrosionOnHit: true }),

  [ABILITY_IDS.FLARE]: active('Flare', {
    icon: '💥', description: 'Reveal target area and mark enemies as Revealed.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 2, aoeRadius: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityRevealed, applyTo: 'target', duration: 2 }],
    runtime: { revealRadius: 1, applyToUnitsInRadius: true },
  }),
  [ABILITY_IDS.INCENDINARY_GRENADE]: active('Incendinary grenade', {
    icon: '🔥', description: 'Deals thermal damage and applies Burning.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 2, cooldown: 5, enemyOnly: false,
    damage: { thermal: 5 }, runtime: { applyDamageInRadius: 0 },
    applyUnitEffects: [{ effectId: EFFECT_IDS.ThermalBurning, applyTo: 'target', duration: 2 }],
  }),
  [ABILITY_IDS.TRENCH]: active('Trench', {
    icon: '🛡️', description: 'Construct trench under the caster.', target: 'self', apCost: 1, mpCost: 2, cooldown: 4,
    placeHexEffects: [{ effectId: EFFECT_IDS.HexTrench, placeOn: 'targetHex', duration: 0 }],
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityTrenched, applyTo: 'self', duration: 1 }],
  }),
  [ABILITY_IDS.LAY_MINE]: active('Lay mine', {
    icon: '💥', description: 'Construct a mine on the current hex.', target: 'self', apCost: 1, mpCost: 2, cooldown: 4,
    placeHexEffects: [{ effectId: EFFECT_IDS.HexMine, placeOn: 'targetHex', duration: 0 }],
  }),
  [ABILITY_IDS.BOARD]: active('Board', {
    icon: '🚚', description: 'Board adjacent allied normal-armor unit.', target: 'unit', apCost: 0, mpCost: 3, rangeMin: 1, rangeMax: 1, allyOnly: true, cooldown: 1,
    allowedTargetArmorClasses: ['NORMAL'], runtime: { action: 'board', maxBoarded: 2 },
  }),
  [ABILITY_IDS.EVACUATE]: active('Evacuate', {
    icon: '🚚', description: 'Evacuate boarded units to adjacent hexes.', target: 'self', apCost: 0, mpCost: 0, cooldown: 3,
    runtime: { action: 'evacuate' },
  }),
  [ABILITY_IDS.MISSILE_BATTERY]: active('Missile battery', {
    icon: '💥', description: 'Delayed strike on a target hex.', target: 'hex', apCost: 1, mpCost: 3, rangeMin: 1, rangeMax: 5, cooldown: 2,
    placeHexEffects: [{ effectId: EFFECT_IDS.HexMissileTarget, placeOn: 'targetHex', duration: 1, params: { damage: { physical: 14 } } }],
    runtime: { delayedStrike: { turns: 1, damage: { physical: 14 } } },
  }),
  [ABILITY_IDS.EMERGENCY_REFIT]: active('Emergency refit', {
    icon: '🛡️', description: 'Self-heal and apply Emergency refit.', target: 'self', apCost: 1, cooldown: 5,
    heal: { amount: 5, applyTo: 'self' },
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityEmergencyRefit, applyTo: 'self', duration: 2 }],
  }),
  [ABILITY_IDS.BLAST_GRENADE]: active('Blast grenade', {
    icon: '💥', description: 'Deal physical damage in a small area, extinguish fire and convert it to smoke.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 1, aoeRadius: 1, cooldown: 5,
    damage: { physical: 2 }, runtime: { applyDamageInRadius: 1 },
    removeHexEffects: [EFFECT_IDS.HexVeilHarmony],
    convertHexEffects: [{ from: EFFECT_IDS.HexFire, to: EFFECT_IDS.HexSmoke, duration: 2 }],
  }),
  [ABILITY_IDS.FLAMETHROWER]: active('Flamethrower', {
    icon: '🔥', description: 'Deal thermal damage and create fire terrain.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 1, cooldown: 6,
    damage: { thermal: 4 }, runtime: { applyDamageInRadius: 0, pattern: 'cone4' },
    placeHexEffects: [{ effectId: EFFECT_IDS.HexFire, placeOn: 'targetHex', duration: 2 }],
  }),
  [ABILITY_IDS.FIELD_REPAIR]: active('Field Repair', {
    icon: '🛡️', description: 'Restore HP to an adjacent ally.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 1, allyOnly: true, cooldown: 2,
    heal: { amount: 6, applyTo: 'target' },
  }),
  [ABILITY_IDS.CALIBRATE]: active('Calibrate', {
    icon: '🛡️', description: 'Apply Calibrated to allied heavy unit.', target: 'unit', apCost: 1, rangeMin: 0, rangeMax: 0, allyOnly: true, cooldown: 1,
    allowedTargetArmorClasses: ['HEAVY'],
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityCalibrated, applyTo: 'target', duration: 1 }],
  }),
  [ABILITY_IDS.SMOKE_SHELL]: active('Smoke shell', {
    icon: '🌫️', description: 'Create smoke on target hex and around it.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 2, aoeRadius: 1, cooldown: 5,
    placeHexEffects: [{ effectId: EFFECT_IDS.HexSmoke, placeOn: 'aoe', duration: 2 }],
  }),
  [ABILITY_IDS.CRIPPLING_BITE]: active('Crippling bite', {
    icon: '🧪', description: 'Deal damage and reduce target MP.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 1, enemyOnly: true, cooldown: 5,
    damage: { physical: 2 }, targetMpDelta: -1,
  }),
  [ABILITY_IDS.GENEBROTH_VIAL]: active('Genebroth vial', {
    icon: '🧪', description: 'Apply Genebroth to a unit or convert Fire to Smoke / remove Veil.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 2, cooldown: 5,
    runtime: { canTargetUnitOnHex: true },
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityGenebroth, applyTo: 'target', duration: 2 }],
    convertHexEffects: [{ from: EFFECT_IDS.HexFire, to: EFFECT_IDS.HexSmoke, duration: 2 }],
    removeHexEffects: [EFFECT_IDS.HexVeilHarmony],
  }),
  [ABILITY_IDS.ADRENAL_SURGE]: active('Adrenal surge', {
    icon: '🛡️', description: 'Increase own damage dealt.', target: 'self', apCost: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityAdrenalSurge, applyTo: 'self', duration: 2 }],
  }),
  [ABILITY_IDS.GENEBROTH_DISCHARGE]: active('Genebroth discharge', {
    icon: '🧪', description: 'Apply Genebroth to nearby units and convert nearby fire.', target: 'self', apCost: 1, aoeRadius: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityGenebroth, applyTo: 'target', duration: 2 }],
    runtime: { applyToUnitsInRadiusFromCaster: 1 },
    convertHexEffects: [{ from: EFFECT_IDS.HexFire, to: EFFECT_IDS.HexSmoke, duration: 2 }],
    removeHexEffects: [EFFECT_IDS.HexVeilHarmony],
  }),
  [ABILITY_IDS.GRASPING_TENDRIL]: active('Grasping tendril', {
    icon: '🧪', description: 'Drag target and deal physical damage.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 2, enemyOnly: true, cooldown: 5,
    damage: { physical: 10 }, runtime: { action: 'pull', hexes: 1 },
  }),
  [ABILITY_IDS.EVOLUTION_SERUM]: active('Evolution serum', {
    icon: '🧪', description: 'Transform target into Amalgamation at next turn start.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 2, enemyOnly: false, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityEvolutionSerum, applyTo: 'target', duration: 1 }],
  }),
  [ABILITY_IDS.DEFENSIVE_DRONE]: active('Defensive drone', {
    icon: '🛡️', description: 'Heal target and apply Surveillance.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 2, allyOnly: true, cooldown: 5,
    heal: { amount: 4, applyTo: 'target' },
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilitySurveillance, applyTo: 'target', duration: 2 }],
  }),
  [ABILITY_IDS.DISRUPT]: active('Disrupt', {
    icon: '🧠', description: 'Apply Disrupted to enemy heavy unit.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 2, enemyOnly: true, cooldown: 5,
    allowedTargetArmorClasses: ['HEAVY'],
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityDisrupted, applyTo: 'target', duration: 1 }],
  }),
  [ABILITY_IDS.SMOKE_GRENADE]: active('Smoke grenade', {
    icon: '🌫️', description: 'Create smoke under and around caster and gain +1 MP.', target: 'self', apCost: 1, cooldown: 5, aoeRadius: 1, selfMpDelta: 1,
    placeHexEffects: [{ effectId: EFFECT_IDS.HexSmoke, placeOn: 'aoe', duration: 2 }],
  }),
  [ABILITY_IDS.CLOAK]: active('Cloak', {
    icon: '🌫️', description: 'Become Invisible for 3 turns.', target: 'self', apCost: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityInvisible, applyTo: 'self', duration: 3 }],
  }),
  [ABILITY_IDS.BATTLE_RAM]: active('Battle ram', {
    icon: '💥', description: 'Rush up to 3 hexes and damage first enemy collided with.', target: 'hex', apCost: 1, mpCost: 2, rangeMin: 1, rangeMax: 1, cooldown: 5,
    runtime: { action: 'rush', maxHexes: 3, collisionDamage: { physical: 6 } },
  }),
  [ABILITY_IDS.PIERCING_SHOT]: active('Piercing shot', {
    icon: '💥', description: 'Damage enemy units in a line of 3 hexes.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 1, cooldown: 5,
    damage: { physical: 6, cryo: 6, energy: 6 }, runtime: { action: 'line_attack', lineLength: 3 },
  }),
  [ABILITY_IDS.GET_MOUNTED]: active('Get mounted', {
    icon: '🚚', description: 'Convert Berserk or Shaman into mounted version.', target: 'unit', apCost: 1, mpCost: 2, rangeMin: 1, rangeMax: 1, allyOnly: true, cooldown: 5,
    runtime: { action: 'mount', mapping: { berserk: 'berserk_on_burrower', shaman: 'shaman_on_burrower' }, consumeCaster: true },
  }),
  [ABILITY_IDS.DISMOUNT]: active('Dismount', {
    icon: '🚚', description: 'Split mounted unit into rider and Burrower.', target: 'self', apCost: 1, mpCost: 2, cooldown: 0,
    runtime: { action: 'dismount' },
  }),
  [ABILITY_IDS.CAMOUFLAGE]: active('Camouflage', {
    icon: '🌫️', description: 'Become Camouflaged until moving.', target: 'self', apCost: 1, mpCost: 2, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityCamouflage, applyTo: 'self', duration: 2 }],
  }),
  [ABILITY_IDS.BATTLE_TRANCE]: active('Battle trance', {
    icon: '🛡️', description: 'Reduce incoming damage for 2 turns.', target: 'self', apCost: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityBattleTrance, applyTo: 'self', duration: 2 }],
  }),
  [ABILITY_IDS.RITUAL_MARK]: active('Ritual mark', {
    icon: '🔮', description: 'Mark enemy; allies around it benefit if it dies.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 2, enemyOnly: true, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityRitualMark, applyTo: 'target', duration: 1 }],
  }),
  [ABILITY_IDS.INJECT_LARVA]: active('Inject larva', {
    icon: '🧪', description: 'Damage and mark normal-armor target to spawn Burrower on death.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 1, enemyOnly: true, cooldown: 5,
    allowedTargetArmorClasses: ['NORMAL'], damage: { physical: 5 },
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityInjectedLarva, applyTo: 'target', duration: 2 }],
  }),
  [ABILITY_IDS.INDUCE_PERCEPTION]: active('Induce perception', {
    icon: '🧠', description: 'Apply Induced Perception to caster.', target: 'self', apCost: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityInducedPerception, applyTo: 'self', duration: 1 }],
  }),
  [ABILITY_IDS.INVOKE_VEIL]: active('Invoke Veil', {
    icon: '🌫️', description: 'Create Veil of harmony under caster.', target: 'self', apCost: 1, cooldown: 5,
    placeHexEffects: [{ effectId: EFFECT_IDS.HexVeilHarmony, placeOn: 'targetHex', duration: 2 }],
  }),
  [ABILITY_IDS.VEIL_PUSH]: active('Veil Push', {
    icon: '🌫️', description: 'Move nearby veil toward target hex.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 1, cooldown: 5,
    runtime: { action: 'veil_push', radius: 1 },
  }),
  [ABILITY_IDS.SHIELD_SLAM]: active('Shield slam', {
    icon: '💥', description: 'Damage and push target 1 hex.', target: 'unit', apCost: 1, rangeMin: 1, rangeMax: 1, enemyOnly: true, cooldown: 5,
    damage: { physical: 6 }, runtime: { action: 'push', hexes: 1, collisionBonus: { physical: 6 } },
  }),
  [ABILITY_IDS.FORTIFY]: active('Fortify', {
    icon: '🛡️', description: 'Apply Fortified to caster.', target: 'self', apCost: 1, cooldown: 5,
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityFortified, applyTo: 'self', duration: 1 }],
  }),
  [ABILITY_IDS.MIND_CONTROL]: active('Mind Control', {
    icon: '🧠', description: 'Apply Disrupted to target and nearby enemies.', target: 'hex', apCost: 1, rangeMin: 1, rangeMax: 2, aoeRadius: 1, cooldown: 5,
    runtime: { applyToUnitsInRadius: true },
    applyUnitEffects: [{ effectId: EFFECT_IDS.AbilityDisrupted, applyTo: 'target', duration: 2 }],
  }),

  // Legacy placeholders preserved
  [ABILITY_IDS.REGEN_FIELD]: active('Regen Field', { icon: '💠', target: 'hex' }),
  [ABILITY_IDS.OVERCLOCK]: active('Overclock', { icon: '⚡' }),
  [ABILITY_IDS.SMOKE_SCREEN]: active('Smoke Screen', { icon: '🌫️', target: 'hex' }),
  [ABILITY_IDS.MIASMA_BOMB]: active('Miasma Bomb', { icon: '☣️', target: 'hex' }),
  [ABILITY_IDS.FIRE_PATCH]: active('Fire Patch', { icon: '🔥', target: 'hex' }),
};

export const ABILITIES = Object.freeze(A);

export function getAbilityDef(id) {
  const key = String(id || '').trim().toLowerCase();
  return ABILITIES[key] || null;
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
