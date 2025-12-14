// src/scenes/WorldSceneCombatPreview.js
//
// Stage F: Combat preview UX (range + damage estimate)
//
// Visual only. Does NOT apply damage.
//
// Compatibility note:
// Some branches export computeDamage as a named export from CombatResolver,
// others only via default export. We support both to avoid breaking builds.

import CombatResolverDefault from '../units/CombatResolver.js';
import { getWeaponDef } from '../units/WeaponDefs.js';

function getComputeDamageFn() {
  // Try named export first (if it exists in this build)
  // We cannot import it directly because that throws at module load time.
  // So we rely on default-export fallback.
  if (CombatResolverDefault && typeof CombatResolverDefault.computeDamage === 'function') {
    return CombatResolverDefault.computeDamage;
  }
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
    // No computeDamage available -> silently skip preview
    clearCombatPreview(scene);
    return;
  }

  // Init preview objects
  scene.combatPreview = scene.combatPreview || {
    graphics: scene.add.graphics().setDepth(2500),
    labels: [],
    lastKey: '',
  };

  const g = scene.combatPreview.graphics;

  // Simple signature to avoid re-creating every frame if nothing changed
  const sig = [
    attacker.q, attacker.r,
    weaponId,
    attacker.activeWeaponIndex,
    (scene.enemies || []).length,
  ].join('|');

  // We still clear every frame because enemies move; but keep structure
  g.clear();
  scene.combatPreview.labels.forEach(l => l.destroy());
  scene.combatPreview.labels = [];

  for (const enemy of scene.enemies || []) {
    if (!enemy) continue;

    const dist = (typeof scene.hexDistance === 'function')
      ? scene.hexDistance(attacker.q, attacker.r, enemy.q, enemy.r)
      : null;

    if (dist == null) continue;
    if (dist < weapon.rangeMin || dist > weapon.rangeMax) continue;

    const dmg = computeDamage(attacker, enemy, weaponId, { distance: dist });
    const pos = scene.axialToWorld(enemy.q, enemy.r);

    // Highlight target hex (circle)
    g.lineStyle(3, 0xff5555, 0.8);
    g.strokeCircle(pos.x, pos.y, scene.hexSize * 0.55);

    // Damage label
    const txt = scene.add.text(
      pos.x,
      pos.y - 22,
      `-${dmg.finalDamage ?? dmg.damage ?? 0}`,
      {
        fontSize: '14px',
        fontStyle: 'bold',
        color: damageColor(dmg),
      }
    ).setOrigin(0.5).setDepth(2600);

    scene.combatPreview.labels.push(txt);
  }

  scene.combatPreview.lastKey = sig;
}

function damageColor(dmg) {
  // Accept both new and old shapes
  const multArmorPoints = dmg.multArmorPoints ?? dmg.armorPointsMult;
  const multArmorClass = dmg.multArmorClass ?? dmg.armorClassMult;

  if (Number.isFinite(multArmorPoints) && multArmorPoints < 0.6) return '#aaaaaa';
  if (Number.isFinite(multArmorClass) && multArmorClass > 1.1) return '#ffd166';
  return '#ffffff';
}

export function clearCombatPreview(scene) {
  if (!scene?.combatPreview) return;

  try { scene.combatPreview.graphics.clear(); } catch (e) {}
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
