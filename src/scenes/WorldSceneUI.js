// src/scenes/WorldSceneUI.js
// ---------------------------------------------------------------------------
// __COMBAT_TRACE__ (compact logs)
// Enable/disable in DevTools: window.__COMBAT_TRACE__ = true/false
// ---------------------------------------------------------------------------
const __TRACE_ON__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_TRACE__ ?? true) : true);
function __t(tag, data) {
  if (!__TRACE_ON__()) return;
  try { console.log(`[PLAYER:${tag}]`, data); } catch (_) {}
}

import { refreshUnits } from './WorldSceneActions.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { setupLogisticsPanel } from './WorldSceneLogistics.js';
import { setupEconomyUI } from './WorldSceneEconomy.js';

// Stage B/D combat
import { applyDefence } from '../units/UnitActions.js';

// Stage F: attack preview
import { updateCombatPreview, clearCombatPreview } from './WorldSceneCombatPreview.js';
import { pixelToHex, roundHex } from './WorldSceneMap.js';
import { validateAttack, resolveAttack } from '../units/CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from '../units/UnitActions.js';
import { getWeaponDef } from '../units/WeaponDefs.js';
import { applyCombatEvent } from './WorldSceneCombatRuntime.js';
import { AttackController } from '../combat/AttackController.js';
import { AbilityController } from '../abilities/AbilityController.js';

function ensureAttackController(scene) {
  if (!scene.attackController) {
    scene.attackController = new AttackController(scene);
  }
  return scene.attackController;
}

function ensureAbilityController(scene) {
  if (!scene.abilityController) {
    scene.abilityController = new AbilityController(scene);
  }
  return scene.abilityController;
}

function getUnitOwnerName(scene, unit) {
  if (!unit) return null;

  if (typeof unit.playerName === 'string' && unit.playerName) return unit.playerName;
  if (typeof unit.ownerName === 'string' && unit.ownerName) return unit.ownerName;
  if (typeof unit.owner === 'string' && unit.owner) return unit.owner;

  const n = (typeof unit.name === 'string' && unit.name) ? unit.name : null;
  if (n && (n === scene?.turnOwner || n === scene?.playerName)) return n;

  return n;
}

function syncMovementAliases(unit) {
  if (!unit) return;

  if (Number.isFinite(unit.mp) && !Number.isFinite(unit.movementPoints)) {
    unit.movementPoints = unit.mp;
  }
  if (Number.isFinite(unit.movementPoints) && !Number.isFinite(unit.mp)) {
    unit.mp = unit.movementPoints;
  }

  if (Number.isFinite(unit.mpMax)) {
    if (!Number.isFinite(unit.maxMovementPoints)) {
      unit.maxMovementPoints = unit.mpMax;
    }
    if (!Number.isFinite(unit.movementPointsMax)) {
      unit.movementPointsMax = unit.mpMax;
    }
  }

  if (Number.isFinite(unit.maxMovementPoints) && !Number.isFinite(unit.mpMax)) {
    unit.mpMax = unit.maxMovementPoints;
  }
}

/* ---------------- Camera controls (unused unless called) ---------------- */

function findUnitAtHex(scene, q, r) {
  const all =
    []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || []);
  return all.find(u => u && !u.isDead && u.q === q && u.r === r) || null;
}

function getActiveWeapon(attacker) {
  const weapons = attacker?.weapons || [];
  const weaponId = weapons[attacker.activeWeaponIndex] || weapons[0] || null;
  const weapon = weaponId ? getWeaponDef(weaponId) : null;
  return { weaponId, weapon };
}

function tryAttackHex(scene, attacker, q, r) {
  const aid = attacker?.id || attacker?.unitId;
  const trace = (step, extra) => __t('ATTACK', { step, aid, q, r, mode: scene?.unitCommandMode, ...extra });
  if (!scene || !attacker) { trace('fail:no_scene_or_attacker'); return false; }

  if (scene.unitCommandMode !== 'attack') { trace('fail:not_in_attack_mode'); return false; }

  const key = `${q},${r}`;
  if (!scene.attackableHexes || !scene.attackableHexes.has(key)) {
    trace('fail:not_highlighted', { hasAttackable: !!scene.attackableHexes, size: scene.attackableHexes?.size });
    return false;
  }

  ensureUnitCombatFields(attacker);
  if ((attacker.ap || 0) <= 0) { trace('fail:no_ap', { ap: attacker.ap }); return false; }

  const target = findUnitAtHex(scene, q, r);
  if (!target || target === attacker) { trace('fail:no_target', { targetFound: !!target }); return false; }

  const { weaponId, weapon } = getActiveWeapon(attacker);
  if (!weaponId || !weapon) { trace('fail:no_weapon', { weaponId }); return false; }

  const v = validateAttack(attacker, target, weaponId);
  if (!v.ok) { trace('fail:validate', { reason: v.reason, distance: v.distance, weaponId }); return false; }

  spendAp(attacker, 1);
  ensureUnitCombatFields(target);

  const res = resolveAttack(attacker, target, weaponId);
  const dmg = Number.isFinite(res?.damage) ? res.damage :
              (Number.isFinite(res?.finalDamage) ? res.finalDamage : 0);

  const hpBefore = target.hp;
  trace('apply_event', { tid: (target.id || target.unitId), weaponId, dmg, hpBefore });

  applyCombatEvent(scene, {
    type: 'combat:attack',
    attackerId: attacker.id || attacker.unitId,
    defenderId: target.id || target.unitId,
    damage: dmg,
    weaponId,
  });

  trace('after_event', { tid: (target.id || target.unitId), hpAfter: target.hp });

  updateCombatPreview(scene);
  scene.refreshUnitActionPanel?.();

  return true;
}

export function setupCameraControls(scene) {
  scene.input.setDefaultCursor('grab');
  scene.isDragging = false;

  scene.input.on('pointerdown', pointer => {
    if (pointer.rightButtonDown()) {
      scene.isDragging = true;
      scene.input.setDefaultCursor('grabbing');
      scene.dragStartX = pointer.x;
      scene.dragStartY = pointer.y;
      scene.cameraStartX = scene.cameras.main.scrollX;
      scene.cameraStartY = scene.cameras.main.scrollY;
    }
  });

  scene.input.on('pointerup', (pointer) => {
    if (scene.isDragging) {
      scene.isDragging = false;
      scene.input.setDefaultCursor('grab');
      return;
    }

    if (String(scene.unitCommandMode || '').startsWith('ability:') && pointer && !pointer.rightButtonDown?.()) {
      const caster = scene.selectedUnit;
      if (caster) {
        const worldX = pointer.worldX - (scene.mapOffsetX || 0);
        const worldY = pointer.worldY - (scene.mapOffsetY || 0);
        const frac = pixelToHex(worldX, worldY, scene.hexSize || 22);
        const axial = roundHex(frac.q, frac.r);

        const ab = ensureAbilityController(scene);
        const handled = ab.tryCastHex(axial.q, axial.r);

        if (!handled) {
          ab.exit('click_outside');
          scene.unitCommandMode = null;
          clearCombatPreview(scene);
          scene.refreshUnitActionPanel?.();
        }
      }
      return;
    }

    if (scene.unitCommandMode === 'attack' && pointer && !pointer.rightButtonDown?.()) {
      const attacker = scene.selectedUnit;
      if (attacker) {
        const worldX = pointer.worldX - (scene.mapOffsetX || 0);
        const worldY = pointer.worldY - (scene.mapOffsetY || 0);
        const frac = pixelToHex(worldX, worldY, scene.hexSize || 22);
        const axial = roundHex(frac.q, frac.r);

        const ac = ensureAttackController(scene);
        const handled = ac.isActive()
          ? ac.tryAttackHex(axial.q, axial.r)
          : tryAttackHex(scene, attacker, axial.q, axial.r);

        if (!handled) {
          ac.exit();
          scene.unitCommandMode = null;
          clearCombatPreview(scene);
          scene.attackableHexes = null;
          scene.refreshUnitActionPanel?.();
        }
      }
    }
  });

  scene.input.on('pointermove', pointer => {
    if (scene.isDragging) {
      const dx = pointer.x - scene.dragStartX;
      const dy = pointer.y - scene.dragStartY;
      scene.cameras.main.scrollX =
        scene.cameraStartX - dx / scene.cameras.main.zoom;
      scene.cameras.main.scrollY =
        scene.cameraStartY - dy / scene.cameras.main.zoom;
    }
  });

  scene.input.on('wheel', (pointer, _, __, deltaY) => {
    const cam = scene.cameras.main;
    let z = cam.zoom - deltaY * 0.001;
    z = Phaser.Math.Clamp(z, 0.5, 2.5);
    cam.setZoom(z);
  });
}

/* ---------------- Turn UI + economy + logistics ---------------- */
export function setupTurnUI(scene) {
  setupEconomyUI(scene);

  const baseY = 170;

  scene.turnText = scene.add.text(20, baseY, 'Player Turn: ...', {
    fontSize: '18px',
    fill: '#e8f6ff',
    backgroundColor: '#133046',
    padding: { x: 10, y: 5 },
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.endTurnButton = scene.add.text(20, baseY + 30, 'End Turn', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#3da9fc',
    padding: { x: 10, y: 5 },
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.endTurnButton.on('pointerdown', () => {
    scene.endTurn();
  });

  scene.refreshButton = scene.add.text(20, baseY + 63, 'Refresh', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#444',
    padding: { x: 10, y: 5 },
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.refreshButton.on('pointerdown', () => {
    refreshUnits(scene);
    scene.redrawWorld?.();
  });

  const safeEndTurn = () => {
    if (scene.logisticsInputLocked) return;
    if (scene.uiLocked) return;
    if (scene.isHistoryPanelOpen) return;
    if (scene.isUnitMoving) return;

    const ae = (typeof document !== 'undefined') ? document.activeElement : null;
    const tag = ae?.tagName ? String(ae.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;

    scene.endTurn?.();
  };

  if (!scene.__endTurnHotkeyBound) {
    scene.__endTurnHotkeyBound = true;
    scene.input.keyboard?.on('keydown-ENTER', safeEndTurn);
    scene.input.keyboard?.on('keydown-NUMPAD_ENTER', safeEndTurn);
  }

  updateTurnText(scene, scene.turnNumber);
  setupLogisticsPanel(scene);
  scene.refreshButton.setY(baseY + 30 + 33);
}

export function updateTurnText(scene, explicitTurnNumber = null) {
  const n = explicitTurnNumber != null ? explicitTurnNumber : (scene.turnNumber ?? 1);
  scene.turnText?.setText(`Player Turn: ${scene.turnOwner} (Turn ${n})`);
}

export function setupWorldInputUI(scene) {
  scene.pathPreviewTiles = scene.pathPreviewTiles || [];
  scene.pathPreviewLabels = scene.pathPreviewLabels || [];
  setupPlayerControls(scene);
}

/* ---------------- Selection highlight helpers ---------------- */
export function updateSelectionHighlight(scene) {
  if (typeof scene.attachSelectionHighlight === 'function') {
    scene.attachSelectionHighlight();
  }
}

/* ---------------- Path preview + movement ---------------- */

function getTile(scene, q, r) {
  return scene.mapData.find(t => t.q === q && t.r === r) || null;
}

function isEnemy(u) {
  return !!u?.isEnemy || u?.controller === 'ai';
}

function isControllable(u) {
  return !!u && !u.isEnemy;
}

function getMP(u) {
  if (Number.isFinite(u?.mp)) return u.mp;
  if (Number.isFinite(u?.movementPoints)) return u.movementPoints;
  return 0;
}

function setMP(u, v) {
  if (!u) return;
  if (Number.isFinite(u.mp)) u.mp = v;
  if (Number.isFinite(u.movementPoints)) u.movementPoints = v;
}

function isUiPointerBlocked() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function getUnitAtHex(scene, q, r) {
  return (
    []
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || [])
      .find(u => u && !u.isDead && u.q === q && u.r === r) || null
  );
}

function stepMoveCost(fromTile, toTile) {
  if (!fromTile || !toTile) return Infinity;

  const e0 = Number.isFinite(fromTile.visualElevation) ? fromTile.visualElevation
           : Number.isFinite(fromTile.elevation) ? fromTile.elevation
           : Number.isFinite(fromTile.baseElevation) ? fromTile.baseElevation : 0;

  const e1 = Number.isFinite(toTile.visualElevation) ? toTile.visualElevation
           : Number.isFinite(toTile.elevation) ? toTile.elevation
           : Number.isFinite(toTile.baseElevation) ? toTile.baseElevation : 0;

  if (Math.abs(e1 - e0) > 1) return Infinity;

  let cost = 1;
  if (toTile.hasForest) cost += 1;
  if (e1 > e0) cost += 1;

  return cost;
}

function drawPathLine(scene, path, { color = 0x00ffff, alpha = 1, width = 3, depth = 50 } = {}) {
  if (!Array.isArray(path) || path.length < 2) return;

  const g = scene.add.graphics().setDepth(depth);
  g.lineStyle(width, color, alpha);

  for (let i = 0; i < path.length - 1; i++) {
    const a = scene.axialToWorld(path[i].q, path[i].r);
    const b = scene.axialToWorld(path[i + 1].q, path[i + 1].r);

    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.strokePath();
  }

  scene.pathPreviewTiles.push(g);
}

function splitPathByMP(scene, unit, fullPath, blockedPred) {
  const mp = getMP(unit);
  const within = [];
  const beyond = [];
  const usablePath = [];
  const costs = [];
  const cum = [];

  if (!Array.isArray(fullPath) || fullPath.length === 0) {
    return { within, beyond, usablePath, costs, cum, cutIndex: 0, mp };
  }

  let sum = 0;
  usablePath.push(fullPath[0]);
  costs.push(0);
  cum.push(0);

  for (let i = 1; i < fullPath.length; i++) {
    const prev = fullPath[i - 1];
    const cur = fullPath[i];
    const prevTile = getTile(scene, prev.q, prev.r);
    const curTile = getTile(scene, cur.q, cur.r);

    if (blockedPred && blockedPred(curTile)) break;

    const stepCost = stepMoveCost(prevTile, curTile);
    if (!Number.isFinite(stepCost) || stepCost === Infinity) break;

    const occ = getUnitAtHex(scene, cur.q, cur.r);
    if (occ && occ !== unit) break;

    sum += stepCost;
    usablePath.push(cur);
    costs.push(stepCost);
    cum.push(sum);
  }

  let cutIndex = 0;
  for (let i = 0; i < usablePath.length; i++) {
    if (cum[i] <= mp) cutIndex = i;
    else break;
  }

  for (let i = 0; i <= cutIndex; i++) within.push(usablePath[i]);

  if (usablePath.length > 1 && cutIndex < usablePath.length - 1) {
    const startBeyond = Math.max(0, cutIndex);
    for (let i = startBeyond; i < usablePath.length; i++) beyond.push(usablePath[i]);
  }

  return { within, beyond, usablePath, costs, cum, cutIndex, mp };
}

function computeTurnMarkers(scene, unit, usablePath, costs) {
  const markers = [];
  if (!Array.isArray(usablePath) || usablePath.length < 2) return markers;

  const maxMP =
    Number.isFinite(unit?.mpMax) ? unit.mpMax :
    Number.isFinite(unit?.maxMovementPoints) ? unit.maxMovementPoints :
    0;

  if (!(maxMP > 0)) return markers;

  let sum = 0;
  let currentTurn = 1;

  for (let i = 1; i < usablePath.length; i++) {
    const stepCost = costs[i] ?? 0;
    if (sum + stepCost > maxMP) {
      markers.push({
        q: usablePath[i - 1].q,
        r: usablePath[i - 1].r,
        turnIndex: currentTurn,
      });
      currentTurn += 1;
      sum = 0;
    }
    sum += stepCost;
  }

  markers.push({
    q: usablePath[usablePath.length - 1].q,
    r: usablePath[usablePath.length - 1].r,
    turnIndex: currentTurn,
  });

  return markers;
}

function computePathWithAStar(scene, unit, targetHex, blockedFn) {
  if (!scene || !unit || !targetHex) return null;

  try {
    return aStarFindPath(
      { q: unit.q, r: unit.r },
      { q: targetHex.q, r: targetHex.r },
      scene.mapData || [],
      blockedFn,
      { getMoveCost: stepMoveCost }
    );
  } catch (e) {
    console.warn('[PATH] A* failed:', e);
    return null;
  }
}

function setAutoMoveTarget(unit, q, r) {
  if (!unit) return;
  unit.autoMove = { active: true, target: { q, r } };
}

function cancelAutoMove(unit) {
  if (!unit) return;
  unit.autoMove = { active: false, target: null };
}

function isPointerOverHistoryPanel(pointer) {
  const panelEl = document.querySelector('.history-panel');
  if (!panelEl) return false;

  const rect = panelEl.getBoundingClientRect();
  const x = pointer.x;
  const y = pointer.y;

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/* ---------------- Player controls: selection, move, inspect, attack mode ---------------- */

export function setupPlayerControls(scene) {
  scene.selectedUnit = null;
  scene.selectedHex = null;
  scene.selectedBuilding = null;
  scene.unitCommandMode = null;
  scene.lastHoverCombatTarget = null;
  scene.showPathCostInfo = false;

  ensureAttackController(scene);
  ensureAbilityController(scene);

  scene.pathPreviewTiles = [];
  scene.pathPreviewLabels = [];

  const trySendAttackIntent = (scene, attacker, target) => {
    try {
      if (!attacker || !target) return false;
      if (typeof scene.publishCombatAction !== 'function') return false;

      scene.publishCombatAction({
        kind: 'attack',
        attackerId: attacker.id || attacker.unitId,
        defenderId: target.id || target.unitId,
        weaponId: attacker.weapons?.[attacker.activeWeaponIndex] || attacker.weapons?.[0] || null,
      });

      return true;
    } catch (err) {
      console.warn('[NET] Failed to publish attack action:', err);
      return false;
    }
  };

  const killUnit = (scene, unit) => {
    if (!unit || unit.isDead) return;

    unit.isDead = true;
    unit.hp = 0;

    try {
      const coll = [scene.units, scene.players, scene.enemies];
      for (const arr of coll) {
        const i = Array.isArray(arr) ? arr.indexOf(unit) : -1;
        if (i >= 0) arr.splice(i, 1);
      }
    } catch (_) {}

    try { unit.destroy?.(); } catch (_) {}

    if (scene.selectedUnit === unit) {
      scene.selectedUnit = null;
      scene.selectedHex = null;
      scene.clearPathPreview?.();
      clearCombatPreview(scene);
      scene.attackableHexes = null;
      scene.unitCommandMode = null;
    }

    scene.updateSelectionHighlight?.();
    scene.refreshUnitActionPanel?.();
  };

  scene.input.keyboard?.on('keydown', (ev) => {
    if (!scene || scene.logisticsInputLocked) return;

    const ae = (typeof document !== 'undefined') ? document.activeElement : null;
    const tag = ae?.tagName ? String(ae.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;

    const key = String(ev.key || '').toLowerCase();

    if (key === 'escape') {
      if (scene.unitCommandMode) {
        scene.unitCommandMode = null;
        scene.clearPathPreview?.();
        clearCombatPreview(scene);
        console.log('[UNITS] Command mode cleared');
        return;
      }

      if (scene.selectedUnit && isControllable(scene.selectedUnit)) {
        cancelAutoMove(scene.selectedUnit);
        console.log('[MOVE] Auto-move cancelled');
        scene.refreshUnitActionPanel?.();
      }
      return;
    }

    if (!scene.selectedUnit) return;
    if (!isControllable(scene.selectedUnit)) return;

    const ownerName = getUnitOwnerName(scene, scene.selectedUnit);
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      return;
    }

    if (key === 'a') {
      scene.unitCommandMode = (scene.unitCommandMode === 'attack') ? null : 'attack';
      scene.clearPathPreview?.();

      if (scene.unitCommandMode === 'attack') {
        updateCombatPreview(scene);
      } else {
        clearCombatPreview(scene);
      }

      scene.refreshUnitActionPanel?.();
      return;
    }

    if (key === 'd') {
      const res = applyDefence(scene.selectedUnit);
      if (!res.ok) {
        console.log('[DEFENCE] failed:', res.reason);
        return;
      }
      console.log('[DEFENCE] applied to', scene.selectedUnit.name || scene.selectedUnit.unitId);
      try { scene.selectedUnit.setAlpha?.(0.85); } catch (e) {}
      scene.updateSelectionHighlight?.();
      scene.refreshUnitActionPanel?.();
    }
  });

  scene.input.on('pointerdown', pointer => {
    if (scene.logisticsInputLocked) return;
    if (scene.isDragging) return;
    if (pointer.rightButtonDown && pointer.rightButtonDown()) return;
    if (isUiPointerBlocked()) return;
    if (isPointerOverHistoryPanel(pointer)) return;

    const rounded = scene.worldToAxial(pointer.worldX, pointer.worldY);

    if (
      rounded.q < 0 ||
      rounded.r < 0 ||
      rounded.q >= scene.mapWidth ||
      rounded.r >= scene.mapHeight
    ) return;

    const { q, r } = rounded;

    const clickedUnit = getUnitAtHex(scene, q, r);
    if (scene.unitCommandMode === 'attack' && scene.selectedUnit && clickedUnit && isEnemy(clickedUnit)) {
      const ownerName = getUnitOwnerName(scene, scene.selectedUnit);
      if (scene.turnOwner && ownerName !== scene.turnOwner) return;

      const sent = trySendAttackIntent(scene, scene.selectedUnit, clickedUnit);

      if (!sent) {
        const ok = tryAttackHex(scene, scene.selectedUnit, clickedUnit.q, clickedUnit.r);
        if (!ok) {
          console.log('[ATTACK] local fallback failed (see [PLAYER:ATTACK] logs for details)');
          return;
        }

        if (clickedUnit.hp <= 0) {
          console.log('[ATTACK] target destroyed');
          killUnit(scene, clickedUnit);
        }
      }

      scene.unitCommandMode = null;
      clearCombatPreview(scene);
      cancelAutoMove(scene.selectedUnit);
      scene.refreshUnitActionPanel?.();
      return;
    }

    if (clickedUnit) {
      scene.toggleSelectedUnitAtHex?.(q, r);
      scene.clearPathPreview?.();
      scene.selectedHex = null;
      scene.unitCommandMode = null;
      clearCombatPreview(scene);
      scene.debugHex?.(q, r);
      return;
    }

    if (!scene.selectedUnit) {
      scene.selectedHex = { q, r };
      scene.selectedBuilding = null;
      scene.unitCommandMode = null;
      scene.clearPathPreview?.();
      clearCombatPreview(scene);
      scene.openHexInspectPanel?.(q, r);
      scene.updateSelectionHighlight?.();
      scene.debugHex?.(q, r);
      return;
    }

    const tile = getTile(scene, q, r);
    if (tile && tile.isLocation) {
      console.log(
        `[LOCATION] Clicked on location: ${tile.locationType || 'Unknown'} at (${q},${r})`
      );
    }

    scene.selectedHex = rounded;
    scene.debugHex?.(q, r);

    if (scene.selectedUnit) {
      if (scene.unitCommandMode === 'attack') {
        scene.unitCommandMode = null;
        clearCombatPreview(scene);
        return;
      }

      if (!isControllable(scene.selectedUnit)) {
        scene.clearPathPreview?.();
        return;
      }

      const ownerName = getUnitOwnerName(scene, scene.selectedUnit);
      if (scene.turnOwner && ownerName !== scene.turnOwner) {
        return;
      }

      const blocked = t => {
        if (!t) return true;
        if (t.type === 'water' || t.type === 'mountain') return true;
        const occ = getUnitAtHex(scene, t.q, t.r);
        if (occ && occ !== scene.selectedUnit) return true;
        return false;
      };

      syncMovementAliases(scene.selectedUnit);

      const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

      if (fullPath && fullPath.length > 1) {
        setAutoMoveTarget(scene.selectedUnit, rounded.q, rounded.r);

        const movementPoints = getMP(scene.selectedUnit);
        const trimmedPath = [];
        let costSum = 0;

        for (let i = 0; i < fullPath.length; i++) {
          const step = fullPath[i];
          const tile2 = getTile(scene, step.q, step.r);
          const prevTile = (i > 0) ? getTile(scene, fullPath[i - 1].q, fullPath[i - 1].r) : null;

          const stepCost = (i === 0) ? 0 : stepMoveCost(prevTile, tile2);
          if (!Number.isFinite(stepCost) || stepCost === Infinity) break;
          if (i > 0 && costSum + stepCost > movementPoints) break;

          if (i > 0) {
            const occ = getUnitAtHex(scene, step.q, step.r);
            if (occ && occ !== scene.selectedUnit) break;
          }

          trimmedPath.push(step);
          if (i > 0) costSum += stepCost;
        }

        if (trimmedPath.length > 1) {
          const dest = trimmedPath[trimmedPath.length - 1];
          const destOcc = getUnitAtHex(scene, dest.q, dest.r);
          if (destOcc && destOcc !== scene.selectedUnit) return;

          console.log('[MOVE] Committing move along path:', trimmedPath);
          scene.startStepMovement?.(scene.selectedUnit, trimmedPath, () => {
            try {
              const unit = scene.selectedUnit;
              if (unit) {
                const mpBefore = getMP(unit);
                setMP(unit, mpBefore - costSum);

                const target = unit.autoMove?.target;
                if (target && unit.q === target.q && unit.r === target.r) {
                  unit.autoMove.active = false;
                }
              }
            } catch (e) {}

            scene.syncPlayerMove?.(scene.selectedUnit);
            scene.refreshUnitActionPanel?.();
          });
        }
      }
    }
  });

  scene.input.on('pointermove', pointer => {
    if (scene.logisticsInputLocked) return;
    if (scene.isDragging) return;
    if (isUiPointerBlocked()) return;
    if (isPointerOverHistoryPanel(pointer)) return;
    if (!scene.selectedUnit || scene.isUnitMoving) return;

    if (scene.unitCommandMode === 'attack') {
      scene.clearPathPreview?.();
      updateCombatPreview(scene);
      return;
    } else {
      clearCombatPreview(scene);
    }

    if (!isControllable(scene.selectedUnit)) {
      scene.clearPathPreview?.();
      return;
    }

    const ownerName = getUnitOwnerName(scene, scene.selectedUnit);
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      scene.clearPathPreview?.();
      return;
    }

    const rounded = scene.worldToAxial(pointer.worldX, pointer.worldY);

    if (
      rounded.q < 0 ||
      rounded.r < 0 ||
      rounded.q >= scene.mapWidth ||
      rounded.r >= scene.mapHeight
    ) {
      scene.clearPathPreview?.();
      return;
    }

    const blocked = t => {
      if (!t) return true;
      if (t.type === 'water' || t.type === 'mountain') return true;
      const occ = getUnitAtHex(scene, t.q, t.r);
      if (occ && occ !== scene.selectedUnit) return true;
      return false;
    };

    syncMovementAliases(scene.selectedUnit);

    const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

    scene.clearPathPreview?.();

    if (fullPath && fullPath.length > 1) {
      const {
        within,
        beyond,
        usablePath,
        costs,
        cum,
        mp: movementPoints,
      } = splitPathByMP(scene, scene.selectedUnit, fullPath, blocked);

      if (usablePath.length <= 1) return;

      const withinColor = 0x00ffff;
      const beyondColor = 0x8a8a8a;

      if (within.length > 1) {
        drawPathLine(scene, within, { color: withinColor, alpha: 0.95, width: 3, depth: 50 });
      }
      if (beyond.length > 1) {
        drawPathLine(scene, beyond, { color: beyondColor, alpha: 0.85, width: 3, depth: 50 });
      }

      const markers = computeTurnMarkers(scene, scene.selectedUnit, usablePath, costs);

      for (const m of markers) {
        const { x, y } = scene.axialToWorld(m.q, m.r);

        const idx = usablePath.findIndex(p => p.q === m.q && p.r === m.r);
        const c = (idx >= 0) ? (cum[idx] ?? 0) : 0;
        const labelColor = (c <= movementPoints) ? '#00ffff' : '#b0b0b0';

        const label = scene.add.text(x, y - 10, `${m.turnIndex}`, {
          fontSize: '12px',
          color: labelColor,
          fontStyle: 'bold',
          backgroundColor: 'rgba(0,0,0,0.35)',
          padding: { x: 4, y: 2 },
        }).setOrigin(0.5).setDepth(52);

        scene.pathPreviewLabels.push(label);
      }
    }
  });

  scene.input.on('pointerout', () => {
    scene.clearPathPreview?.();
    clearCombatPreview(scene);
  });
}

export default {
  setupCameraControls,
  setupTurnUI,
  updateTurnText,
  setupWorldInputUI,
};
