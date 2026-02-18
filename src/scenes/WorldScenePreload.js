// src/scenes/WorldScenePreload.js
//
// Centralized preloading for WorldScene (unit panel icons, status icons, etc.)
// Keep ALL preload paths here so WorldScene.js stays lean.
//
// NOTE:
// - Status icons live in: assets/ui/unit_panel/statuses/
// - Action button icons live in: assets/ui/unit_panel/buttons/
//
// This module exports a single function that WorldScene.preload() calls.

 /* eslint-disable no-console */

// ================================
// Status icon keys used by effects
// ================================

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
  // Corrosive (repo uses "Corrosion..." filenames/keys in some places)
  'CorrosionCorrosivebial',
  'CorrosionDeterioration',
  'CorrosionArmorDissolution',
];

// Some filenames in repo differ from logical ids (legacy typos / naming).
// Map logical key -> actual filename (WITH extension).
// If your repo already has perfect matching names, you can leave this empty.
// I keep it here because you previously had 404s for status icons.
export const STATUS_ICON_FILE_MAP = {
  // Common legacy typo set (seen earlier in repo variants)
  PhysicalBleeding: 'PhyscalBleeding.png',
  PhysicalArmorbreach: 'PhyscalArmorbreach.png',
  PhysicalWeakspot: 'PhyscalWeakspot.png',

  // Repo typo: EnergyElectricution.png (missing 'o')
  EnergyElectrocution: 'EnergyElectricution.png',

  // Some repos use Corrosion* file prefix for corrosive icons
  CorrosionCorrosivebial: 'CorrosionCorrosivebial.png',
  CorrosionDeterioration: 'CorrosionDeterioration.png',
  CorrosionArmorDissolution: 'CorrosionArmorDissolution.png',
};

// ================================
// Unit panel action button icons
// ================================
//
// IMPORTANT:
// Your error: "URL Error in File: ui_action_defence from:" happens when a preload call
// is made with empty/undefined URL. This mapping makes URLs explicit and stable.
//
// The actual PNGs are in: assets/ui/unit_panel/buttons/
// and (per your repo) are named like: Defence.png, Heal.png, Ambush.png, etc.

export const ACTION_BUTTON_ICON_MAP = {
  ui_action_defence: 'Defence.png',
  ui_action_heal: 'Heal.png',
  ui_action_ambush: 'Ambush.png',
  ui_action_build: 'Build.png',
  ui_action_switch: 'Switch.png',
  ui_action_turn: 'Turn.png',
  ui_action_endturn: 'EndTurn.png',
  ui_action_dismiss: 'Dismiss.png',
};

// Optional “active/toggled” variants if you use them later.
// If files exist, you can preload them too. If not, harmless.
export const ACTION_BUTTON_ICON_MAP_ALT = {
  ui_action_defenceA: 'DefenceA.png',
  ui_action_healA: 'HealA.png',
  ui_action_ambushA: 'AmbushA.png',
  ui_action_buildA: 'BuildA.png',
  ui_action_switchA: 'SwitchA.png',
  ui_action_turnA: 'TurnA.png',
  ui_action_endturnA: 'EndTurnA.png',
  ui_action_dismissA: 'DismissA.png',
};

function safeLoadImage(scene, key, url) {
  if (!scene?.load?.image) return;
  if (!key || typeof key !== 'string') return;
  if (!url || typeof url !== 'string') return;

  // Avoid double-load if texture already exists
  if (scene.textures?.exists?.(key)) return;

  scene.load.image(key, url);
}

/**
 * Call from WorldScene.preload().
 * @param {Phaser.Scene} scene
 */
export function preloadWorldSceneAssets(scene) {
  // 1) Action buttons
  try {
    const baseBtn = 'assets/ui/unit_panel/buttons/';

    for (const [key, file] of Object.entries(ACTION_BUTTON_ICON_MAP)) {
      safeLoadImage(scene, key, baseBtn + file);
    }
    for (const [key, file] of Object.entries(ACTION_BUTTON_ICON_MAP_ALT)) {
      // optional – only loads if texture missing; 404 is OK, but if you want no 404 spam, remove this loop
      safeLoadImage(scene, key, baseBtn + file);
    }
  } catch (e) {
    console.warn('[PRELOAD] action button icons failed:', e);
  }

  // 2) Status icons
  try {
    const baseStatus = 'assets/ui/unit_panel/statuses/';

    for (const k of STATUS_ICON_KEYS) {
      const file = STATUS_ICON_FILE_MAP[k] || `${k}.png`;
      safeLoadImage(scene, k, baseStatus + file);
    }
  } catch (e) {
    console.warn('[PRELOAD] status icons failed:', e);
  }
}
