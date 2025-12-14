// src/scenes/WorldSceneCombatPreview.js
//
// Stage F: Combat preview UX (range + damage estimate)
//
// Visual only. Does NOT apply damage.
//
// Compatibility note:
// In this project CombatResolver may have ONLY named exports (no default).
// We import as namespace and read computeDamage if present.

import * as CombatResolver from '../units/CombatResolver.js';
import { getWeaponDef } from '../units/WeaponDefs.js';

function getComputeDamageFn() {
  // Prefer named computeDamage, fallback to other possible names if you had them
  if (CombatResolver && typeof CombatResolver.computeDamage === 'function') return CombatResolver.computeDamage;
  return null;
}

export function updateCombatPreview(scene) {
  if (!scene || scene.unitCommandMode !== 'attack') {
    clearCombatPreview(scene);
    return;
  }

  const attacker = scene.selectedUnit;
  if (!attacker) {
    clearCombatPreview(scene);
    return;
  }

  const weapons = attacker.weapons || [];
  const weaponId = weapons[attacker.activeWeaponIndex] || weapons[0];
  const weapon = getWeaponDef(weaponId);

  if (!weapon) {
    clearCombatPreview(scene);
    return;
  }

  const computeDamage = getComputeDamageFn();
  if (!computeDamage) {
    // If resolver doesn't provide computeDamage, we silently skip preview (no crash).
    clearCombatPreview(scene);
    return;
  }

  // Create preview container once
  scene.combatPreview = scene.combatPreview || {
    graphics: scene.add.graphics().setDepth(2500),
    labels: [],
  };

  const g = scene.combatPreview.graphics;

  // Clear old
  g.clear();
  (scene.combatPreview.labels || []).forEach(l => {
    try { l.destroy(); } catch (e) {}
  });
  scene.combatPreview.labels = [];

  // Draw per-enemy if in range
  for (const enemy of scene.enemies || []) {
    if (!enemy) continue;

    const dist = (typeof scene.hexDistance === 'function')
      ? scene.hexDistance(attacker.q, attacker.r, enemy.q, enemy.r)
      : null;

    if (dist == null) continue;
    if (dist < weapon.rangeMin || dist > weapon.rangeMax) continue;

    const dmg = computeDamage(attacker, enemy, weaponId, { distance: dist });

    const pos = (typeof scene.axialToWorld === 'function')
      ? scene.axialToWorld(enemy.q, enemy.r)
      : { x: 0, y: 0 };

    // Highlight hex (circle)
    g.lineStyle(3, 0xff5555, 0.8);
    g.strokeCircle(pos.x, pos.y, (scene.hexSize || 22) * 0.55);

    // Damage label
    const dmgValue =
      (Number.isFinite(dmg?.finalDamage) ? dmg.finalDamage :
        (Number.isFinite(dmg?.damage) ? dmg.damage : 0));

    const txt = scene.add.text(
      pos.x,
      pos.y - 22,
      `-${dmgValue}`,
      {
        fontSize: '14px',
        fontStyle: 'bold',
        color: damageColor(dmg),
      }
    ).setOrigin(0.5).setDepth(2600);

    scene.combatPreview.labels.push(txt);
  }
}

function damageColor(dmg) {
  // Accept multiple shapes from different resolver versions
  const multArmorPoints =
    dmg?.multArmorPoints ??
    dmg?.armorPointsMult ??
    null;

  const multArmorClass =
    dmg?.multArmorClass ??
    dmg?.armorClassMult ??
    null;

  if (Number.isFinite(multArmorPoints) && multArmorPoints < 0.6) return '#aaaaaa';
  if (Number.isFinite(multArmorClass) && multArmorClass > 1.1) return '#ffd166';
  return '#ffffff';
}

export function clearCombatPreview(scene) {
  if (!scene?.combatPreview) return;

  try { scene.combatPreview.graphics?.clear?.(); } catch (e) {}

  try {
    (scene.combatPreview.labels || []).forEach(l => {
      try { l.destroy(); } catch (e) {}
    });
  } catch (e) {}

  scene.combatPreview.labels = [];
}

export default {
  updateCombatPreview,
  clearCombatPreview,
};
