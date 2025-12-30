// src/scenes/WorldSceneCombatPreview.js
//
// Stage F: Combat preview UX (range + damage estimate)
//
// Visual only. Does NOT apply damage.
//
// Compatibility note:
// In this project CombatResolver may have ONLY named exports (no default).
// We import as namespace and read computeDamage if present.
// ---------------------------------------------------------------------------
// Targeting helpers (attack preview)
// ---------------------------------------------------------------------------
function ensureCombatPreview(scene) {
  if (!scene.combatPreview) scene.combatPreview = {};
  if (!scene.combatPreview.graphics) {
    scene.combatPreview.graphics = scene.add.graphics().setDepth(9500);
  } else {
    scene.combatPreview.graphics.setDepth(9500);
  }
  return scene.combatPreview;
}

// ---------------------------------------------------------------------------
// __COMBAT_DEBUG__ (auto-instrumentation)
// Toggle in devtools: window.__COMBAT_DEBUG_ENABLED__ = true/false
// ---------------------------------------------------------------------------
const __DBG_ENABLED__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_DEBUG_ENABLED__ ?? true) : true);
function __dbg_ts() { try { return new Date().toISOString().slice(11, 23); } catch (_) { return ''; } }
function __dbg(tag, data) { if (!__DBG_ENABLED__()) return; try { console.log('[' + tag + '] ' + __dbg_ts(), data); } catch (_) {} }
function __dbg_group(tag, title, data) {
  if (!__DBG_ENABLED__()) return;
  try { console.groupCollapsed('[' + tag + '] ' + __dbg_ts() + ' ' + title); if (data !== undefined) console.log(data); } catch (_) {}
}
function __dbg_group_end() { if (!__DBG_ENABLED__()) return; try { console.groupEnd(); } catch (_) {} }

function uniqUnits(list) {
  const out = [];
  const seen = new Set();
  for (const u of list) {
    if (!u || u.isDead) continue;
    const id = u.unitId ?? u.id ?? `${u.type}:${u.q},${u.r}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(u);
  }
  return out;
}

function getSideKey(u) {
  if (typeof u?.playerIndex === 'number') return `p:${u.playerIndex}`;
  if (typeof u?.ownerSlot === 'number') return `p:${u.ownerSlot}`;
  if (u?.isEnemy) return 'enemy';
  if (u?.isPlayer) return 'player';
  return 'neutral';
}

function getFaction(u) {
  return String(u?.faction ?? u?.ownerId ?? u?.ownerSlot ?? (u?.isEnemy ? 'raiders' : 'neutral'));
}

// Compute a hex outline ring (flat-top) in *iso* space, matching WorldSceneMap.drawHex.
function hexIsoRing(scene, xIso, yIso, size) {
  const ISO_SHEAR = scene.ISO_SHEAR ?? 0.5;
  const ISO_YSCALE = scene.ISO_YSCALE ?? 0.866;

  const isoOffset = (x, y) => ({ x: x - y * ISO_SHEAR, y: y * ISO_YSCALE });

  const w = size * Math.sqrt(3) / 2;
  const h = size / 2;
  const d = [
    { dx: 0,  dy: -size },
    { dx: +w, dy: -h    },
    { dx: +w, dy: +h    },
    { dx: 0,  dy: +size },
    { dx: -w, dy: +h    },
    { dx: -w, dy: -h    },
  ];
  return d.map(({dx,dy}) => {
    const off = isoOffset(dx, dy);
    return { x: xIso + off.x, y: yIso + off.y };
  });
}



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
  __dbg('PLAYER:Preview:start', { mode: scene.unitCommandMode, selected: { id: scene.selectedUnit?.unitId ?? scene.selectedUnit?.id, q: scene.selectedUnit?.q, r: scene.selectedUnit?.r, ap: scene.selectedUnit?.ap, weapons: scene.selectedUnit?.weapons, activeWeaponIndex: scene.selectedUnit?.activeWeaponIndex } });
  ensureCombatPreview(scene);
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
    graphics: scene.add.graphics().setDepth(9500),
    labels: [],
  };

  const g = scene.combatPreview.graphics;

  // Clear old
  g.clear();
  (scene.combatPreview.labels || []).forEach(l => {
    try { l.destroy(); } catch (e) {}
  });
  scene.combatPreview.labels = [];

  
  // Precompute attackable hexes for click-to-attack UX
  // (stored on scene so input handler can validate clicks)
  const attackable = new Set();
  const rangeMin = Number.isFinite(weapon.rangeMin) ? weapon.rangeMin : 1;
  const rangeMax = Number.isFinite(weapon.rangeMax) ? weapon.rangeMax : (Number.isFinite(weapon.range) ? weapon.range : 1);

  // Draw generic attack range (all hexes within range)
  const mapW = scene.mapWidth || 0;
  const mapH = scene.mapHeight || 0;

  // If map size unknown, skip tile highlight (still shows enemy target preview)
  if (mapW > 0 && mapH > 0) {
    for (let q = 0; q < mapW; q++) {
      for (let r = 0; r < mapH; r++) {
        // Only highlight existing tiles (tileAt is defined in WorldSceneMap)
        if (typeof scene.tileAt === 'function' && !scene.tileAt(q, r)) continue;

        const dist = hexDistance(scene, attacker.q, attacker.r, q, r);
        if (!Number.isFinite(dist)) continue;
        if (dist < rangeMin || dist > rangeMax) continue;

        attackable.add(`${q},${r}`);

        const pos = (typeof scene.axialToWorld === 'function')
          ? scene.axialToWorld(q, r)
          : { x: 0, y: 0 };

        // Subtle outline for in-range hexes
        g.lineStyle(2, 0xffd166, 0.35);
        g.strokeCircle(pos.x, pos.y, (scene.hexSize || 22) * 0.52);
      }
    }
  }

    scene.attackableHexes = attackable;
  __dbg('PLAYER:Preview:summary', { attackableCount: attackable.size, keys: Array.from(attackable).slice(0, 50) });
  // eslint-disable-next-line no-console
  console.log('[ATTACK] preview targets', { weaponId, rangeMin, rangeMax, enemiesInRange });
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

    // Highlight target hex (outline, so unit badge doesn't hide it)
    const ring = hexIsoRing(scene, pos.x, pos.y, size);
    g.lineStyle(3, 0xffd166, 1);
    g.beginPath();
    g.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(ring[i].x, ring[i].y);
    g.closePath();
    g.strokePath();

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
