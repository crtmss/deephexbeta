// src/combat/AttackController.js
//
// Centralized click-to-attack controller.
// Responsibilities:
//  - Enter/exit attack mode
//  - Compute and render attackable hex highlights based on active weapon range
//  - Resolve attack on left click, spend AP, apply HP changes via applyCombatEvent
//  - Cancel mode if user clicks outside valid targets

import { getWeaponDef } from '../units/WeaponDefs.js';
import { ensureUnitCombatFields, spendAp } from '../units/UnitActions.js';
import { validateAttack, resolveAttack } from '../units/CombatResolver.js';
import { applyCombatEvent } from '../scenes/WorldSceneCombatRuntime.js';

function hexDistanceAxial(q1, r1, q2, r2) {
  // ODD-R offset coordinates → cube distance
  const toCube = (q, r) => {
    const x = q - ((r - (r & 1)) / 2);
    const z = r;
    const y = -x - z;
    return { x, y, z };
  };
  const a = toCube(q1, r1);
  const b = toCube(q2, r2);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

function findUnitAtHex(scene, q, r) {
  const all =
    []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || []);
  return all.find(u => u && !u.isDead && u.q === q && u.r === r) || null;
}

function ownerColor(scene, unit) {
  const slot =
    (typeof unit?.playerIndex === 'number' ? unit.playerIndex :
     (typeof unit?.ownerSlot === 'number' ? unit.ownerSlot : null));
  const colors = scene?.PLAYER_COLORS || [0xff4b4b, 0x4bc0ff, 0x54ff9b, 0xffe14b];
  if (typeof slot === 'number') return colors[((slot % colors.length) + colors.length) % colors.length];
  return 0x9aa0a6;
}

export class AttackController {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.attacker = null;
    this.attackable = new Set();

    this.g = scene.add.graphics().setDepth(9500);
    this.g.setScrollFactor?.(1);

    // Optional: show current weapon range info
    this._lastWeaponId = null;
  }

  isActive() {
    return this.active && this.scene?.unitCommandMode === 'attack';
  }

  enter(attacker) {
    const scene = this.scene;
    if (!scene || !attacker) return;

    this.attacker = attacker;
    this.active = true;
    scene.unitCommandMode = 'attack';

    this.recompute();
  }

  exit() {
    const scene = this.scene;
    this.active = false;
    this.attacker = null;
    this.attackable = new Set();
    if (scene) {
      scene.unitCommandMode = null;
      scene.attackableHexes = null;
    }
    this.clearHighlights();
  }

  clearHighlights() {
    try { this.g.clear(); } catch (_) {}
  }

  recompute() {
    const scene = this.scene;
    const attacker = this.attacker;
    if (!scene || !attacker) return;

    const weapons = attacker.weapons || [];
    const weaponId = weapons[attacker.activeWeaponIndex] || weapons[0];
    const weapon = weaponId ? getWeaponDef(weaponId) : null;
    if (!weapon) {
      this.attackable = new Set();
      scene.attackableHexes = this.attackable;
      this.clearHighlights();
      return;
    }

    const rangeMin = Number.isFinite(weapon.rangeMin) ? weapon.rangeMin : 1;
    const rangeMax = Number.isFinite(weapon.rangeMax)
      ? weapon.rangeMax
      : (Number.isFinite(weapon.range) ? weapon.range : 1);

    this._lastWeaponId = weaponId;

    const mapW = scene.mapWidth || 0;
    const mapH = scene.mapHeight || 0;

    const set = new Set();
    this.clearHighlights();

    // Draw at a high depth and with strong alpha so it is visible.
    // We do a filled circle marker on each attackable hex.
    this.g.lineStyle(2, 0xffd166, 0.9);

    if (mapW > 0 && mapH > 0) {
      for (let q = 0; q < mapW; q++) {
        for (let r = 0; r < mapH; r++) {
          if (typeof scene.tileAt === 'function' && !scene.tileAt(q, r)) continue;
          const dist = hexDistanceAxial(attacker.q, attacker.r, q, r);
          if (!Number.isFinite(dist)) continue;
          if (dist < rangeMin || dist > rangeMax) continue;

          set.add(`${q},${r}`);

          const pos = (typeof scene.axialToWorld === 'function') ? scene.axialToWorld(q, r) : { x: 0, y: 0 };

          // Filled marker
          this.g.fillStyle(0xffd166, 0.18);
          this.g.fillCircle(pos.x, pos.y, (scene.hexSize || 22) * 0.50);

          // Outline
          this.g.strokeCircle(pos.x, pos.y, (scene.hexSize || 22) * 0.52);
        }
      }
    }

    this.attackable = set;
    scene.attackableHexes = set;
  }

  /**
   * Called on left click in world space.
   * Returns true if click was handled (either attack succeeded or click was inside/ignored).
   * Returns false if click should cancel attack mode.
   */
  tryAttackHex(q, r) {
    const scene = this.scene;
    const attacker = this.attacker;
    if (!scene || !attacker) return false;
    if (!this.isActive()) return false;

    const key = `${q},${r}`;
    if (!this.attackable || !this.attackable.has(key)) return false;

    ensureUnitCombatFields(attacker);
    if ((attacker.ap || 0) <= 0) return true; // handled but no action

    const target = findUnitAtHex(scene, q, r);
    if (!target || target === attacker) return true;

    // Must be enemy (basic rule)
    if (attacker.isEnemy && target.isEnemy) return true;
    if (attacker.isPlayer && target.isPlayer) return true;

    const weapons = attacker.weapons || [];
    const weaponId = weapons[attacker.activeWeaponIndex] || weapons[0] || null;
    if (!weaponId) return true;

    const v = validateAttack(attacker, target, weaponId);
    if (!v?.ok) return true;

    spendAp(attacker, 1);

    ensureUnitCombatFields(target);
    const res = resolveAttack(attacker, target, weaponId);
    const dmg = Number.isFinite(res?.damage) ? res.damage :
                (Number.isFinite(res?.finalDamage) ? res.finalDamage : 0);

    applyCombatEvent(scene, {
      type: 'combat:attack',
      attackerId: attacker.unitId ?? attacker.id,
      defenderId: target.unitId ?? target.id,
      damage: dmg,
      weaponId,
    });

    // Recompute highlights if AP changed (or weapon switched)
    this.recompute();
    scene.refreshUnitActionPanel?.();

    return true;
  }
}
