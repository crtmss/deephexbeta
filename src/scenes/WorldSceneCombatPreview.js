// src/scenes/WorldSceneCombatPreview.js
//
// Stage F: Combat preview UX (range + damage estimate)
//
// Visual only. Does NOT apply damage.

import { computeDamage } from '../units/CombatResolver.js';
import { getWeaponDef } from '../units/WeaponDefs.js';

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
  if (!weapon) return;

  clearCombatPreview(scene);

  scene.combatPreview = scene.combatPreview || {
    graphics: scene.add.graphics().setDepth(2500),
    labels: [],
  };

  const g = scene.combatPreview.graphics;

  for (const enemy of scene.enemies || []) {
    const dist = scene.hexDistance
      ? scene.hexDistance(attacker.q, attacker.r, enemy.q, enemy.r)
      : null;

    if (dist == null) continue;
    if (dist < weapon.rangeMin || dist > weapon.rangeMax) continue;

    // Damage preview
    const dmg = computeDamage(attacker, enemy, weaponId, { distance: dist });

    const pos = scene.axialToWorld(enemy.q, enemy.r);

    // Highlight hex
    g.lineStyle(3, 0xff5555, 0.8);
    g.strokeCircle(pos.x, pos.y, scene.hexSize * 0.55);

    // Damage label
    const txt = scene.add.text(
      pos.x,
      pos.y - 22,
      `-${dmg.finalDamage}`,
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
  if (dmg.multArmorPoints < 0.6) return '#aaaaaa'; // heavily reduced
  if (dmg.multArmorClass > 1.1) return '#ffd166'; // effective
  return '#ffffff';
}

export function clearCombatPreview(scene) {
  if (!scene?.combatPreview) return;

  scene.combatPreview.graphics.clear();
  scene.combatPreview.labels.forEach(l => l.destroy());
  scene.combatPreview.labels = [];
}

export default {
  updateCombatPreview,
  clearCombatPreview,
};
