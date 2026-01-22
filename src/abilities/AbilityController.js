// src/abilities/AbilityController.js
//
// Centralized click-to-cast controller for ACTIVE abilities.
//
// This is the abilities analogue of src/combat/AttackController.js.
// It is designed to be multiplayer-safe:
//  - It can produce a deterministic "ability:cast" event payload
//  - The host should validate + apply, then broadcast
//  - Clients should only display preview/highlights locally
//
// IMPORTANT:
// - No Phaser imports outside of using scene.add.graphics() etc.
// - This controller does NOT apply effects directly.
//   It only helps select a valid target and produces an event.

import { getAbilityDef } from './AbilityDefs.js';

function hexDistanceOddR(q1, r1, q2, r2) {
  // ODD-R offset coordinates → cube distance (same as AttackController)
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

function key(q, r) {
  return `${q},${r}`;
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

const __A_ON__ = () => (typeof window !== 'undefined' ? (window.__TRACE_ABILITY__ ?? true) : false);
function __a(tag, data) {
  if (!__A_ON__()) return;
  try { console.log(`[ABILITY] ${tag}`, data); } catch (_) {}
}

export class AbilityController {
  constructor(scene) {
    this.scene = scene;

    this.active = false;
    this.caster = null;
    this.abilityId = null;

    /** @type {Set<string>} */
    this.targetable = new Set();

    // Render highlights above most map overlays, but below UI.
    this.g = scene.add.graphics().setDepth(9400);
    this.g.setScrollFactor?.(1);

    this._last = {
      rangeMin: 0,
      rangeMax: 0,
      target: null,
      aoeRadius: 0,
    };
  }

  isActive() {
    return this.active && this.scene?.unitCommandMode?.startsWith?.('ability:');
  }

  enter(caster, abilityId) {
    const scene = this.scene;
    if (!scene || !caster) return;

    const def = getAbilityDef(abilityId);
    if (!def || def.kind !== 'active' || !def.active) return;

    this.caster = caster;
    this.abilityId = def.id;
    this.active = true;

    scene.unitCommandMode = `ability:${def.id}`;

    __a('enter', {
      casterId: caster.unitId ?? caster.id,
      abilityId: def.id,
      target: def.active.target,
      rangeMin: def.active.rangeMin,
      rangeMax: def.active.rangeMax,
      aoeRadius: def.active.aoeRadius ?? 0,
      apCost: def.active.apCost,
    });

    this.recompute();
  }

  exit(reason = 'exit') {
    const scene = this.scene;
    __a('exit', { reason, abilityId: this.abilityId, casterId: this.caster?.unitId ?? this.caster?.id });

    this.active = false;
    this.caster = null;
    this.abilityId = null;
    this.targetable = new Set();
    this._last = { rangeMin: 0, rangeMax: 0, target: null, aoeRadius: 0 };

    if (scene) {
      if (String(scene.unitCommandMode || '').startsWith('ability:')) scene.unitCommandMode = null;
      scene.abilityTargetableHexes = null;
    }
    this.clearHighlights();
  }

  clearHighlights() {
    try { this.g.clear(); } catch (_) {}
  }

  recompute() {
    const scene = this.scene;
    const caster = this.caster;
    if (!scene || !caster || !this.abilityId) return;

    const def = getAbilityDef(this.abilityId);
    if (!def || def.kind !== 'active' || !def.active) return;

    const a = def.active;
    const rangeMin = Number.isFinite(a.rangeMin) ? a.rangeMin : 0;
    const rangeMax = Number.isFinite(a.rangeMax) ? a.rangeMax : rangeMin;
    const target = a.target || 'self';
    const aoeRadius = Number.isFinite(a.aoeRadius) ? a.aoeRadius : 0;

    this._last = { rangeMin, rangeMax, target, aoeRadius };

    // self-target: no hex targeting needed
    if (target === 'self') {
      this.targetable = new Set([key(caster.q, caster.r)]);
      scene.abilityTargetableHexes = this.targetable;
      this.clearHighlights();

      // draw only caster outline (so player understands it's a self cast)
      const pos = (typeof scene.axialToWorld === 'function') ? scene.axialToWorld(caster.q, caster.r) : { x: 0, y: 0 };
      const R = (scene.hexSize || 22) * 0.62;
      this.g.lineStyle(3, 0x9bffb0, 0.95);
      this.g.strokeCircle(pos.x, pos.y, R);

      __a('targets', { abilityId: def.id, mode: 'self', count: 1, at: { q: caster.q, r: caster.r } });
      return;
    }

    const mapW = scene.mapWidth || 0;
    const mapH = scene.mapHeight || 0;

    const set = new Set();
    this.clearHighlights();

    // Use outline-only highlights (so unit badge / icons are not obscured)
    this.g.lineStyle(3, 0x9bffb0, 0.85);

    if (mapW > 0 && mapH > 0) {
      for (let q = 0; q < mapW; q++) {
        for (let r = 0; r < mapH; r++) {
          if (typeof scene.tileAt === 'function' && !scene.tileAt(q, r)) continue;

          const dist = hexDistanceOddR(caster.q, caster.r, q, r);
          if (!Number.isFinite(dist)) continue;
          if (dist < rangeMin || dist > rangeMax) continue;

          // unit-target: require a unit on hex
          if (target === 'unit') {
            const u = findUnitAtHex(scene, q, r);
            if (!u || u === caster) continue;

            // For now: everyone is hostile to everyone (as you requested earlier),
            // so we allow any other unit. Later we can add faction filters in AbilityDefs.
          }

          set.add(key(q, r));

          const pos = (typeof scene.axialToWorld === 'function') ? scene.axialToWorld(q, r) : { x: 0, y: 0 };
          const R = (scene.hexSize || 22) * 0.60;
          this.g.strokeCircle(pos.x, pos.y, R);
        }
      }
    }

    this.targetable = set;
    scene.abilityTargetableHexes = set;

    __a('targets', {
      abilityId: def.id,
      target,
      rangeMin,
      rangeMax,
      aoeRadius,
      count: set.size,
    });
  }

  /**
   * Called on left click in world space.
   * Returns true if click was handled (either cast queued or click was inside/ignored).
   * Returns false if click should cancel ability mode.
   */
  tryCastHex(q, r) {
    const scene = this.scene;
    const caster = this.caster;
    if (!scene || !caster) return false;
    if (!this.isActive()) return false;

    const def = getAbilityDef(this.abilityId);
    if (!def || def.kind !== 'active' || !def.active) return false;

    const k = key(q, r);
    const okTarget = this.targetable && this.targetable.has(k);

    // If click is outside highlight → let caller cancel
    if (!okTarget) {
      __a('click', { step: 'outside', abilityId: def.id, q, r });
      return false;
    }

    const a = def.active;

    // AP gate (client-side precheck only)
    const ap = Number.isFinite(caster.ap) ? caster.ap : 0;
    if (ap < (a.apCost || 1)) {
      __a('click', { step: 'no_ap', abilityId: def.id, ap, apCost: a.apCost || 1 });
      return true;
    }

    // unit target requires a unit at hex
    let targetUnit = null;
    if (a.target === 'unit') {
      targetUnit = findUnitAtHex(scene, q, r);
      if (!targetUnit || targetUnit === caster) {
        __a('click', { step: 'no_unit_on_hex', abilityId: def.id, q, r });
        return true;
      }
    }

    // Produce cast event (host should validate/apply)
    const ev = {
      type: 'ability:cast',
      abilityId: def.id,
      casterId: String(caster.unitId ?? caster.id),
      target: {
        kind: a.target,
        q,
        r,
        targetUnitId: targetUnit ? String(targetUnit.unitId ?? targetUnit.id) : null,
      },
      // debug metadata
      apCost: a.apCost || 1,
      rangeMin: this._last.rangeMin,
      rangeMax: this._last.rangeMax,
      aoeRadius: this._last.aoeRadius,
      ts: Date.now(),
    };

    __a('cast_event', ev);

    // If a scene method exists, forward to it. Otherwise keep as local debug.
    // (This keeps the controller safe to drop in before wiring networking.)
    if (typeof scene.queueAbilityCast === 'function') {
      scene.queueAbilityCast(ev);
    } else if (typeof scene.applyAbilityCastLocal === 'function') {
      scene.applyAbilityCastLocal(ev);
    }

    // After a click, we exit targeting mode by default
    this.exit('cast');
    scene.refreshUnitActionPanel?.();
    return true;
  }
}

export default AbilityController;
