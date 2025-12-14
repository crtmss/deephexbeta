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
  if (CombatResolver && typeof CombatResolver.computeDamage === 'function') return CombatResolver.computeDamage;
  return null;
}

// Treat as enemy if:
//  - explicitly isEnemy/controller=ai
//  - OR simply not isPlayer (covers your "blue units" placeholder/AI)
function isEnemyRelative(attacker, u) {
  if (!u) return false;
  if (u === attacker) return false;
  if (u.isDead) return false;

  if (u.isEnemy || u.controller === 'ai') return true;

  // If attacker is player-controlled, any non-player is enemy for now
  if (attacker?.isPlayer) {
    return !u.isPlayer;
  }

  // If attacker is not player, then any player is enemy
  return !!u.isPlayer;
}

// Prefer scene.hexDistance if exists, else axial cube distance
function hexDistance(scene, q1, r1, q2, r2) {
  if (typeof scene?.hexDistance === 'function') return scene.hexDistance(q1, r1, q2, r2);
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
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
    // No resolver function -> skip preview silently (no crash)
    clearCombatPreview(scene);
    return;
  }

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

  // Collect all possible targets from arrays to avoid missing "blue units"
  const allUnits =
    []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || []);

  for (const target of allUnits) {
    if (!isEnemyRelative(attacker, target)) continue;

    const dist = hexDistance(scene, attacker.q, attacker.r, target.q, target.r);
    if (!Number.isFinite(dist)) continue;
    if (dist < weapon.rangeMin || dist > weapon.rangeMax) continue;

    const dmg = computeDamage(attacker, target, weaponId, { distance: dist });

    const pos = (typeof scene.axialToWorld === 'function')
      ? scene.axialToWorld(target.q, target.r)
      : { x: 0, y: 0 };

    // Highlight target hex
    g.lineStyle(3, 0xff5555, 0.85);
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
