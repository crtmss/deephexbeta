// src/effects/EffectDefs.js
//
// Data-driven effect definitions for unit and hex effects.
// Extended with ability-status and terrain effects used by the new roster.

export const EFFECT_KINDS = Object.freeze({ UNIT: 'unit', HEX: 'hex' });
export const STACKING = Object.freeze({ REFRESH: 'refresh', STACK: 'stack', IGNORE: 'ignore' });
export const TICK_PHASE = Object.freeze({ TURN_START: 'turnStart', TURN_END: 'turnEnd' });
export const DAMAGE_TYPES = Object.freeze({
  PHYSICAL: 'physical', THERMAL: 'thermal', TOXIC: 'toxic', CRYO: 'cryo', RADIATION: 'radiation', ENERGY: 'energy', CORROSIVE: 'corrosive',
});
export const MOD_STATS = Object.freeze({
  ARMOR: 'armor', VISION: 'vision', MP_DELTA: 'mpDelta', AP_DELTA: 'apDelta', RANGE: 'range',
  DAMAGE_DEALT_PCT: 'damageDealtPct', DAMAGE_TAKEN_PCT: 'damageTakenPct', DAMAGE_TAKEN_FLAT: 'damageTakenFlat',
  HEALING_RECEIVED_PCT: 'healingReceivedPct', RESIST_ALL: 'resistAll', RESIST_BY_TYPE: 'resistByType',
});
export const TICK_ACTIONS = Object.freeze({ DOT: 'dot', REGEN: 'regen', STAT_DELTA: 'statDelta' });

const desc = (s) => String(s || '');

export const EFFECT_IDS = Object.freeze({
  PhysicalBleeding: 'PhysicalBleeding',
  PhysicalArmorbreach: 'PhysicalArmorbreach',
  PhysicalWeakspot: 'PhysicalWeakspot',
  ThermalVolatileIgnition: 'ThermalVolatileIgnition',
  ThermalHeatStress: 'ThermalHeatStress',
  ThermalBurning: 'ThermalBurning',
  ToxicIntoxication: 'ToxicIntoxication',
  ToxicInterference: 'ToxicInterference',
  ToxicToxiccloud: 'ToxicToxiccloud',
  CryoBrittle: 'CryoBrittle',
  CryoShatter: 'CryoShatter',
  CryoDeepfreeze: 'CryoDeepfreeze',
  RadiationRadiationsickness: 'RadiationRadiationsickness',
  RadiationIonization: 'RadiationIonization',
  RadiationIrradiated: 'RadiationIrradiated',
  EnergyElectrocution: 'EnergyElectrocution',
  EnergySystemdamage: 'EnergySystemdamage',
  EnergyShock: 'EnergyShock',
  CorrosiveCorrosivebial: 'CorrosiveCorrosivebial',
  CorrosiveDeterioration: 'CorrosiveDeterioration',
  CorrosiveArmorDissolution: 'CorrosiveArmorDissolution',
  MutantStress: 'MutantStress',

  AbilityRevealed: 'AbilityRevealed',
  AbilityTrenched: 'AbilityTrenched',
  AbilityEmergencyRefit: 'AbilityEmergencyRefit',
  AbilityCalibrated: 'AbilityCalibrated',
  AbilityGenebroth: 'AbilityGenebroth',
  AbilityAdrenalSurge: 'AbilityAdrenalSurge',
  AbilityEvolutionSerum: 'AbilityEvolutionSerum',
  AbilitySurveillance: 'AbilitySurveillance',
  AbilityDisrupted: 'AbilityDisrupted',
  AbilityInvisible: 'AbilityInvisible',
  AbilityCamouflage: 'AbilityCamouflage',
  AbilityBattleTrance: 'AbilityBattleTrance',
  AbilityRitualMark: 'AbilityRitualMark',
  AbilityInjectedLarva: 'AbilityInjectedLarva',
  AbilityFortified: 'AbilityFortified',
  AbilityInducedPerception: 'AbilityInducedPerception',

  HexSmoke: 'HexSmoke',
  HexFire: 'HexFire',
  HexTrench: 'HexTrench',
  HexMine: 'HexMine',
  HexVeilHarmony: 'HexVeilHarmony',
  HexMissileTarget: 'HexMissileTarget',
});

export const EFFECTS = Object.freeze({
  [EFFECT_IDS.PhysicalBleeding]: { id:EFFECT_IDS.PhysicalBleeding, kind:'unit', name:'Bleeding', icon:EFFECT_IDS.PhysicalBleeding, description:desc('At the start of the turn unit takes Physical damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'dot', amount:2, damageType:'physical' }] },
  [EFFECT_IDS.PhysicalArmorbreach]: { id:EFFECT_IDS.PhysicalArmorbreach, kind:'unit', name:'Armor breach', icon:EFFECT_IDS.PhysicalArmorbreach, description:desc('Reduces unit armor points.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'armor', op:'add', value:-2 }] },
  [EFFECT_IDS.PhysicalWeakspot]: { id:EFFECT_IDS.PhysicalWeakspot, kind:'unit', name:'Weak spot', icon:EFFECT_IDS.PhysicalWeakspot, description:desc('Increase Physical damage taken.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageTakenFlat', op:'add', value:1, damageType:'physical' }] },

  [EFFECT_IDS.ThermalVolatileIgnition]: { id:EFFECT_IDS.ThermalVolatileIgnition, kind:'unit', name:'Volatile Ignition', icon:EFFECT_IDS.ThermalVolatileIgnition, description:desc('If unit uses an ability, it takes Thermal damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ onAbilityUse:{ type:'damage', amount:4, damageType:'thermal' } } },
  [EFFECT_IDS.ThermalHeatStress]: { id:EFFECT_IDS.ThermalHeatStress, kind:'unit', name:'Heat Stress', icon:EFFECT_IDS.ThermalHeatStress, description:desc('Increase Thermal damage taken by 15%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageTakenPct', op:'add', value:15, damageType:'thermal' }] },
  [EFFECT_IDS.ThermalBurning]: { id:EFFECT_IDS.ThermalBurning, kind:'unit', name:'Burning', icon:EFFECT_IDS.ThermalBurning, description:desc('At the start of the turn take Thermal damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'dot', amount:2, damageType:'thermal' }] },

  [EFFECT_IDS.ToxicIntoxication]: { id:EFFECT_IDS.ToxicIntoxication, kind:'unit', name:'Intoxication', icon:EFFECT_IDS.ToxicIntoxication, description:desc('At the start of the turn unit takes Toxic damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'dot', amount:2, damageType:'toxic' }] },
  [EFFECT_IDS.ToxicInterference]: { id:EFFECT_IDS.ToxicInterference, kind:'unit', name:'Interference', icon:EFFECT_IDS.ToxicInterference, description:desc('Reduces attack range by 1 (not melee).'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ rangeNotForMelee:true }, modifiers:[{ stat:'range', op:'add', value:-1, when:{ notMelee:true } }] },
  [EFFECT_IDS.ToxicToxiccloud]: { id:EFFECT_IDS.ToxicToxiccloud, kind:'unit', name:'Toxic cloud', icon:EFFECT_IDS.ToxicToxiccloud, description:desc('Unit cannot be healed or repaired.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ cannotHeal:true } },

  [EFFECT_IDS.CryoBrittle]: { id:EFFECT_IDS.CryoBrittle, kind:'unit', name:'Brittle', icon:EFFECT_IDS.CryoBrittle, description:desc('Increase Cryo damage taken by 15%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageTakenPct', op:'add', value:15, damageType:'cryo' }] },
  [EFFECT_IDS.CryoShatter]: { id:EFFECT_IDS.CryoShatter, kind:'unit', name:'Shatter', icon:EFFECT_IDS.CryoShatter, description:desc('Next physical hit deals bonus Physical damage and then disappears.'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ nextHitBonus:{ amount:4, damageType:'physical', consume:true } } },
  [EFFECT_IDS.CryoDeepfreeze]: { id:EFFECT_IDS.CryoDeepfreeze, kind:'unit', name:'Deep freeze', icon:EFFECT_IDS.CryoDeepfreeze, description:desc('Decrease MP and AP by 1.'), baseDuration:1, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'statDelta', mpDelta:-1, apDelta:-1 }] },

  [EFFECT_IDS.RadiationRadiationsickness]: { id:EFFECT_IDS.RadiationRadiationsickness, kind:'unit', name:'Radiation sickness', icon:EFFECT_IDS.RadiationRadiationsickness, description:desc('Healing received is reduced by 50%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'healingReceivedPct', op:'add', value:-50 }] },
  [EFFECT_IDS.RadiationIonization]: { id:EFFECT_IDS.RadiationIonization, kind:'unit', name:'Ionization', icon:EFFECT_IDS.RadiationIonization, description:desc('At the start of the turn unit takes Radiation damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'dot', amount:2, damageType:'radiation' }] },
  [EFFECT_IDS.RadiationIrradiated]: { id:EFFECT_IDS.RadiationIrradiated, kind:'unit', name:'Irradiated', icon:EFFECT_IDS.RadiationIrradiated, description:desc('On death, apply Ionization and Radiation sickness to adjacent units.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ onDeathRadius:1, onDeathApplyAdjacent:[{ effectId:EFFECT_IDS.RadiationIonization, duration:2, stacks:1 }, { effectId:EFFECT_IDS.RadiationRadiationsickness, duration:2, stacks:1 }] } },

  [EFFECT_IDS.EnergyElectrocution]: { id:EFFECT_IDS.EnergyElectrocution, kind:'unit', name:'Electrocution', icon:EFFECT_IDS.EnergyElectrocution, description:desc('Increase Thermal damage taken by 15%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageTakenPct', op:'add', value:15, damageType:'thermal' }] },
  [EFFECT_IDS.EnergySystemdamage]: { id:EFFECT_IDS.EnergySystemdamage, kind:'unit', name:'System damage', icon:EFFECT_IDS.EnergySystemdamage, description:desc('At the start of the turn unit takes Energy damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'dot', amount:2, damageType:'energy' }] },
  [EFFECT_IDS.EnergyShock]: { id:EFFECT_IDS.EnergyShock, kind:'unit', name:'Shock', icon:EFFECT_IDS.EnergyShock, description:desc('Unit can’t use abilities.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ cannotUseAbilities:true } },

  [EFFECT_IDS.CorrosiveCorrosivebial]: { id:EFFECT_IDS.CorrosiveCorrosivebial, kind:'unit', name:'Corrosive bial', icon:EFFECT_IDS.CorrosiveCorrosivebial, description:desc('When the unit moves, it takes Corrosive damage.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ onMoveStep:{ type:'damage', amount:2, damageType:'corrosive' } } },
  [EFFECT_IDS.CorrosiveDeterioration]: { id:EFFECT_IDS.CorrosiveDeterioration, kind:'unit', name:'Deterioration', icon:EFFECT_IDS.CorrosiveDeterioration, description:desc('Increase Corrosive damage taken by 15%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageTakenPct', op:'add', value:15, damageType:'corrosive' }] },
  [EFFECT_IDS.CorrosiveArmorDissolution]: { id:EFFECT_IDS.CorrosiveArmorDissolution, kind:'unit', name:'Armor Dissolution', icon:EFFECT_IDS.CorrosiveArmorDissolution, description:desc('Reduces unit armor by 2.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'armor', op:'add', value:-2 }] },
  [EFFECT_IDS.MutantStress]: { id:EFFECT_IDS.MutantStress, kind:'unit', name:'Mutant stress', icon:EFFECT_IDS.RadiationIrradiated, description:desc('Placeholder stress status.'), baseDuration:2, stacking:'refresh', maxStacks:1 },

  [EFFECT_IDS.AbilityRevealed]: { id:EFFECT_IDS.AbilityRevealed, kind:'unit', name:'Revealed', icon:EFFECT_IDS.AbilityRevealed, description:desc('The hex under the affected unit is seen, and it takes 10% more damage.'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ revealed:true }, modifiers:[{ stat:'damageTakenPct', op:'add', value:10 }] },
  [EFFECT_IDS.AbilityTrenched]: { id:EFFECT_IDS.AbilityTrenched, kind:'unit', name:'Trenched', icon:EFFECT_IDS.AbilityTrenched, description:desc('Receives +4 armor while in trench.'), baseDuration:1, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'armor', op:'add', value:4 }], baseParams:{ removeIfMoved:true } },
  [EFFECT_IDS.AbilityEmergencyRefit]: { id:EFFECT_IDS.AbilityEmergencyRefit, kind:'unit', name:'Emergency refit', icon:EFFECT_IDS.AbilityEmergencyRefit, description:desc('At the start of the next turn unit gets healed.'), baseDuration:2, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'regen', amount:5 }] },
  [EFFECT_IDS.AbilityCalibrated]: { id:EFFECT_IDS.AbilityCalibrated, kind:'unit', name:'Calibrated', icon:EFFECT_IDS.AbilityCalibrated, description:desc('Increases damage dealt by 15%.'), baseDuration:1, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageDealtPct', op:'add', value:15 }] },
  [EFFECT_IDS.AbilityGenebroth]: { id:EFFECT_IDS.AbilityGenebroth, kind:'unit', name:'Genebroth', icon:EFFECT_IDS.AbilityGenebroth, description:desc('Gives +10 temporary HP.'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ tempHpBonus:10 } },
  [EFFECT_IDS.AbilityAdrenalSurge]: { id:EFFECT_IDS.AbilityAdrenalSurge, kind:'unit', name:'Adrenal surge', icon:EFFECT_IDS.AbilityAdrenalSurge, description:desc('Increases damage done by 10%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageDealtPct', op:'add', value:10 }] },
  [EFFECT_IDS.AbilityEvolutionSerum]: { id:EFFECT_IDS.AbilityEvolutionSerum, kind:'unit', name:'Evolution serum', icon:EFFECT_IDS.AbilityEvolutionSerum, description:desc('At the start of the next turn, affected unit is converted to Amalgamation.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ transformAtTurnStart:{ unitType:'amalgamation', copyHpToMax:true } } },
  [EFFECT_IDS.AbilitySurveillance]: { id:EFFECT_IDS.AbilitySurveillance, kind:'unit', name:'Surveillance', icon:EFFECT_IDS.AbilitySurveillance, description:desc('Increases vision by 1 and all resistances by 1.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'vision', op:'add', value:1 }, { stat:'resistAll', op:'add', value:1 }] },
  [EFFECT_IDS.AbilityDisrupted]: { id:EFFECT_IDS.AbilityDisrupted, kind:'unit', name:'Disrupted', icon:EFFECT_IDS.AbilityDisrupted, description:desc('Unit can not use weapons.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ cannotUseWeapons:true } },
  [EFFECT_IDS.AbilityInvisible]: { id:EFFECT_IDS.AbilityInvisible, kind:'unit', name:'Invisible', icon:EFFECT_IDS.AbilityInvisible, description:desc('Makes the unit unseen until it attacks.'), baseDuration:3, stacking:'refresh', maxStacks:1, baseParams:{ invisible:true } },
  [EFFECT_IDS.AbilityCamouflage]: { id:EFFECT_IDS.AbilityCamouflage, kind:'unit', name:'Camouflage', icon:EFFECT_IDS.AbilityCamouflage, description:desc('Makes the unit unseen until it moves or attacks.'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ invisible:true, removeIfMoved:true } },
  [EFFECT_IDS.AbilityBattleTrance]: { id:EFFECT_IDS.AbilityBattleTrance, kind:'unit', name:'Battle trance', icon:EFFECT_IDS.AbilityBattleTrance, description:desc('Reduces damage taken from all sources by 20%.'), baseDuration:2, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'damageTakenPct', op:'add', value:-20 }] },
  [EFFECT_IDS.AbilityRitualMark]: { id:EFFECT_IDS.AbilityRitualMark, kind:'unit', name:'Ritual mark', icon:EFFECT_IDS.AbilityRitualMark, description:desc('If the unit dies, nearby cannibal units gain 1 MP and heal 5.'), baseDuration:1, stacking:'refresh', maxStacks:1, baseParams:{ onDeathAllyBurst:{ radius:2, heal:5, mp:1, faction:'Fleshbound Clans' } } },
  [EFFECT_IDS.AbilityInjectedLarva]: { id:EFFECT_IDS.AbilityInjectedLarva, kind:'unit', name:'Injected larva', icon:EFFECT_IDS.AbilityInjectedLarva, description:desc('If the unit dies with this effect, spawn a Burrower on the same hex.'), baseDuration:2, stacking:'refresh', maxStacks:1, baseParams:{ onDeathSpawnUnit:{ unitType:'burrower' } } },
  [EFFECT_IDS.AbilityFortified]: { id:EFFECT_IDS.AbilityFortified, kind:'unit', name:'Fortified', icon:EFFECT_IDS.AbilityFortified, description:desc('Fortified for 1 turn.'), baseDuration:1, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'armor', op:'add', value:2 }] },
  [EFFECT_IDS.AbilityInducedPerception]: { id:EFFECT_IDS.AbilityInducedPerception, kind:'unit', name:'Induced perception', icon:EFFECT_IDS.AbilityInducedPerception, description:desc('Heightened perception for 1 turn.'), baseDuration:1, stacking:'refresh', maxStacks:1, modifiers:[{ stat:'vision', op:'add', value:1 }] },

  [EFFECT_IDS.HexSmoke]: { id:EFFECT_IDS.HexSmoke, kind:'hex', name:'Smoke', icon:EFFECT_IDS.HexSmoke, description:desc('Smoke terrain effect.'), baseDuration:2, stacking:'refresh', maxStacks:1 },
  [EFFECT_IDS.HexFire]: { id:EFFECT_IDS.HexFire, kind:'hex', name:'Fire', icon:EFFECT_IDS.HexFire, description:desc('Fire terrain effect.'), baseDuration:2, stacking:'refresh', maxStacks:1 },
  [EFFECT_IDS.HexTrench]: { id:EFFECT_IDS.HexTrench, kind:'hex', name:'Trench', icon:EFFECT_IDS.HexTrench, description:desc('Trench terrain effect.'), baseDuration:0, stacking:'refresh', maxStacks:1 },
  [EFFECT_IDS.HexMine]: { id:EFFECT_IDS.HexMine, kind:'hex', name:'Mine', icon:EFFECT_IDS.HexMine, description:desc('Mine terrain effect.'), baseDuration:0, stacking:'refresh', maxStacks:1 },
  [EFFECT_IDS.HexVeilHarmony]: { id:EFFECT_IDS.HexVeilHarmony, kind:'hex', name:'Veil of harmony', icon:EFFECT_IDS.HexVeilHarmony, description:desc('Veil of harmony terrain effect.'), baseDuration:2, stacking:'refresh', maxStacks:1 },
  [EFFECT_IDS.HexMissileTarget]: { id:EFFECT_IDS.HexMissileTarget, kind:'hex', name:'Missile target', icon:EFFECT_IDS.HexMissileTarget, description:desc('Delayed missile strike marker.'), baseDuration:1, stacking:'refresh', maxStacks:1, ticks:[{ phase:'turnStart', type:'dot', amount:14, damageType:'physical' }] },
});

export function getEffectDef(id) { return EFFECTS[String(id || '').trim()] || null; }
export function listEffectIds() { return Object.keys(EFFECTS); }
export function isUnitEffect(id) { return getEffectDef(id)?.kind === EFFECT_KINDS.UNIT; }
export function isHexEffect(id) { return getEffectDef(id)?.kind === EFFECT_KINDS.HEX; }

export default { EFFECT_IDS, EFFECTS, getEffectDef, listEffectIds, isUnitEffect, isHexEffect, EFFECT_KINDS, STACKING, TICK_PHASE, MOD_STATS, TICK_ACTIONS, DAMAGE_TYPES };
