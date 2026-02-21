// src/scenes/WorldScenePreload.js
// Centralized preload for WorldScene UI assets.
// (Extracted from WorldScene.js to keep the scene file smaller.)

/* eslint-disable no-console */

// Status icons used by the unit panel (Effect id -> texture key)
export const STATUS_ICON_KEYS = [
  // Physical
  'PhysicalBleeding',
  'PhysicalArmorbreach',
  'PhysicalWeakspot',
  // Thermal
  'ThermalVolatileIgnition',
  'ThermalHeatStress',
  'ThermalBurning',
  // Toxic
  'ToxicIntoxication',
  'ToxicInterference',
  'ToxicToxiccloud',
  // Cryo
  'CryoBrittle',
  'CryoShatter',
  'CryoDeepfreeze',
  // Radiation
  'RadiationRadiationsickness',
  'RadiationIonization',
  'RadiationIrradiated',
  // Energy
  'EnergyElectrocution',
  'EnergySystemdamage',
  'EnergyShock',
  // Corrosive (repo uses legacy "Corrosion" naming for some)
  'CorrosionCorrosivebial',
  'CorrosionDeterioration',
  'CorrosionArmorDissolution',
];

// Some filenames differ from logical ids (legacy typos)
const STATUS_ICON_FILE_MAP = {
  PhysicalBleeding: 'PhyscalBleeding.png',
  PhysicalArmorbreach: 'PhyscalArmorbreach.png',
  PhysicalWeakspot: 'PhyscalWeakspot.png',

  // Repo file name: EnergyElectricution.png (legacy typo)
  EnergyElectrocution: 'EnergyElectricution.png',
};

// Unit panel (grid sprite) + stats + resists
export const UNIT_PANEL_BG_KEY = 'ui_unit_panel_bg';

export const UI_STAT_KEYS = {
  ap: 'ui_stat_ap',
  mp: 'ui_stat_mp',
  gr: 'ui_stat_gr',
  hp: 'ui_stat_hp',
  mo: 'ui_stat_mo',
  faction: 'ui_stat_faction',
  lvl: 'ui_stat_lvl',
  weapon: 'ui_stat_weapon',
  sideWeapon: 'ui_stat_sideweapon',
};

export const UI_RESIST_KEYS = {
  physical: 'ui_resist_physical',
  thermal: 'ui_resist_thermal',
  toxic: 'ui_resist_toxic',
  cryo: 'ui_resist_cryo',
  radiation: 'ui_resist_radiation',
  energy: 'ui_resist_energy',
  corrosion: 'ui_resist_corrosion',
};

// Action button keys are already used elsewhere; we keep them here for completeness.
export const UI_ACTION_KEYS = {
  defence: 'ui_action_defence',
  heal: 'ui_action_heal',
  ambush: 'ui_action_ambush',
  build: 'ui_action_build',
  switch: 'ui_action_switch',
  turn: 'ui_action_turn',
  endturn: 'ui_action_endturn',
  dismiss: 'ui_action_dismiss',
};

export function preloadWorldSceneUI(scene) {
  if (!scene || !scene.load) return;

  // --- Unit panel background sprite ---
  try {
    if (!scene.textures?.exists?.(UNIT_PANEL_BG_KEY)) {
      scene.load.image(UNIT_PANEL_BG_KEY, 'assets/ui/unit_panel/UnitPanel.png');
    }
  } catch (e) {
    console.warn('[PRELOAD] UnitPanel background failed:', e);
  }

  // --- Stats icons ---
  const statsBase = 'assets/ui/unit_panel/stats/';
  const statsFiles = {
    [UI_STAT_KEYS.ap]: 'AP.png',
    [UI_STAT_KEYS.mp]: 'MP.png',
    [UI_STAT_KEYS.gr]: 'Group.png',
    [UI_STAT_KEYS.hp]: 'HP.png',
    [UI_STAT_KEYS.mo]: 'Morale.png',
    [UI_STAT_KEYS.faction]: 'Faction.png',
    [UI_STAT_KEYS.lvl]: 'LVL.png',
    [UI_STAT_KEYS.weapon]: 'Weapon.png',
    [UI_STAT_KEYS.sideWeapon]: 'SideWeapon.png',
  };

  try {
    for (const [key, file] of Object.entries(statsFiles)) {
      if (scene.textures?.exists?.(key)) continue;
      scene.load.image(key, `${statsBase}${file}`);
    }
  } catch (e) {
    console.warn('[PRELOAD] stats icons failed:', e);
  }

  // --- Resist icons ---
  const resBase = 'assets/ui/unit_panel/resists/';
  const resFiles = {
    [UI_RESIST_KEYS.physical]: 'Physical.png',
    [UI_RESIST_KEYS.thermal]: 'Thermal.png',
    [UI_RESIST_KEYS.toxic]: 'Toxic.png',
    [UI_RESIST_KEYS.cryo]: 'Cryo.png',
    [UI_RESIST_KEYS.radiation]: 'Radiation.png',
    [UI_RESIST_KEYS.energy]: 'Energy.png',
    [UI_RESIST_KEYS.corrosion]: 'Corrosion.png',
  };

  try {
    for (const [key, file] of Object.entries(resFiles)) {
      if (scene.textures?.exists?.(key)) continue;
      scene.load.image(key, `${resBase}${file}`);
    }
  } catch (e) {
    console.warn('[PRELOAD] resist icons failed:', e);
  }

  // --- Status icons (effects) ---
  try {
    const base = 'assets/ui/unit_panel/statuses/';
    for (const k of STATUS_ICON_KEYS) {
      if (scene.textures?.exists?.(k)) continue;
      const file = STATUS_ICON_FILE_MAP[k] || `${k}.png`;
      scene.load.image(k, `${base}${file}`);
    }
  } catch (e) {
    console.warn('[PRELOAD] status icons failed:', e);
  }

  // --- Action button icons ---
  // NOTE: These are used as image keys in the panel.
  // If you already preload them elsewhere, Phaser will just ignore duplicates.
  try {
    const base = 'assets/ui/unit_panel/buttons/';
    const files = {
      [UI_ACTION_KEYS.defence]: 'Defence.png',
      [UI_ACTION_KEYS.heal]: 'Heal.png',
      [UI_ACTION_KEYS.ambush]: 'Ambush.png',
      [UI_ACTION_KEYS.build]: 'Build.png',
      [UI_ACTION_KEYS.switch]: 'Switch.png',
      [UI_ACTION_KEYS.turn]: 'Turn.png',
      [UI_ACTION_KEYS.endturn]: 'EndTurn.png',
      [UI_ACTION_KEYS.dismiss]: 'Dismiss.png',
    };

    for (const [key, file] of Object.entries(files)) {
      if (scene.textures?.exists?.(key)) continue;
      scene.load.image(key, `${base}${file}`);
    }
  } catch (e) {
    console.warn('[PRELOAD] action icons failed:', e);
  }
}
