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

  // Must be in attack mode
  if (scene.unitCommandMode !== 'attack') { trace('fail:not_in_attack_mode'); return false; }

  // Must be highlighted
  const key = `${q},${r}`;
  if (!scene.attackableHexes || !scene.attackableHexes.has(key)) {
    trace('fail:not_highlighted', { hasAttackable: !!scene.attackableHexes, size: scene.attackableHexes?.size });
    return false;
  }

  // Need AP
  ensureUnitCombatFields(attacker);
  if ((attacker.ap || 0) <= 0) { trace('fail:no_ap', { ap: attacker.ap }); return false; }

  const target = findUnitAtHex(scene, q, r);
  if (!target || target === attacker) { trace('fail:no_target', { targetFound: !!target }); return false; }

  const { weaponId, weapon } = getActiveWeapon(attacker);
  if (!weaponId || !weapon) { trace('fail:no_weapon', { weaponId }); return false; }

  // Validate by resolver rules
  const v = validateAttack(attacker, target, weaponId);
  if (!v.ok) { trace('fail:validate', { reason: v.reason, distance: v.distance, weaponId }); return false; }

  // Spend AP and resolve damage
  spendAp(attacker, 1);
  ensureUnitCombatFields(target);

  const res = resolveAttack(attacker, target, weaponId);
  const dmg = Number.isFinite(res?.damage) ? res.damage :
              (Number.isFinite(res?.finalDamage) ? res.finalDamage : 0);

  // Apply combat event (handles HP reduction + death)
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

    // Left click: ability mode click-to-cast (handled before attack)
if (String(scene.unitCommandMode || '').startsWith('ability:') && pointer && !pointer.rightButtonDown?.()) {
  const caster = scene.selectedUnit;
  if (caster) {
    const worldX = pointer.worldX - (scene.mapOffsetX || 0);
    const worldY = pointer.worldY - (scene.mapOffsetY || 0);
    const frac = pixelToHex(worldX, worldY, scene.hexSize || 22);
    const axial = roundHex(frac.q, frac.r);

    const ab = ensureAbilityController(scene);

    // AbilityController.tryCastHex returns:
    // - true  => click was handled (cast or valid inside)
    // - false => click outside highlighted targets (cancel ability mode)
    const handled = ab.tryCastHex(axial.q, axial.r);

    if (!handled) {
      ab.exit('click_outside');
      scene.unitCommandMode = null;

      // ability highlighting is managed by AbilityController graphics,
      // but we still clear combat preview to avoid confusion.
      clearCombatPreview(scene);
      scene.refreshUnitActionPanel?.();
    }
  }
  return; // prevent fallthrough into attack logic
}




    
    // Left click: attack mode click-to-attack
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

          // Clicked outside valid targets -> exit attack mode & clear highlights
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
  // Centralised economy UI (resource HUD, top tabs, resources panel)
  setupEconomyUI(scene);

  // Turn label – positioned under the (now taller) resource HUD
  const baseY = 170;

  scene.turnText = scene.add.text(20, baseY, 'Player Turn: ...', {
    fontSize: '18px',
    fill: '#e8f6ff',
    backgroundColor: '#133046',
    padding: { x: 10, y: 5 },
  }).setScrollFactor(0).setDepth(100).setInteractive();

  // End Turn button
  scene.endTurnButton = scene.add.text(20, baseY + 30, 'End Turn', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#3da9fc',
    padding: { x: 10, y: 5 },
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.endTurnButton.on('pointerdown', () => {
    scene.endTurn();
  });

  // Refresh button (refresh units + redraw world)
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

  // ✅ Hotkey: Enter -> End Turn (also Numpad Enter)
  // Avoid triggering while logistics is open, UI locked, OR if a text input is focused.
  const safeEndTurn = () => {
    if (scene.logisticsInputLocked) return;
    if (scene.uiLocked) return;
    if (scene.isHistoryPanelOpen) return; // don't end turn while reading history
    if (scene.isUnitMoving) return;

    const ae = (typeof document !== 'undefined') ? document.activeElement : null;
    const tag = ae?.tagName ? String(ae.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;

    scene.endTurn?.();
  };

  // Guard against multiple bindings if scene restarts
  if (!scene.__endTurnHotkeyBound) {
    scene.__endTurnHotkeyBound = true;

    scene.input.keyboard?.on('keydown-ENTER', safeEndTurn);
    scene.input.keyboard?.on('keydown-NUMPAD_ENTER', safeEndTurn);
  }

  updateTurnText(scene, scene.turnNumber);

  // Logistics panel setup (non-modal; keeps side buttons usable)
  setupLogisticsPanel(scene);

  // Side buttons appear above logistics panel area
  scene.refreshButton.setY(baseY + 30 + 33);
}

export function updateTurnText(scene, explicitTurnNumber = null) {
  const n = explicitTurnNumber != null ? explicitTurnNumber : (scene.turnNumber ?? 1);
  scene.turnText?.setText(`Player Turn: ${scene.turnOwner} (Turn ${n})`);
}

/* ---------------- (MOVED OUT) Movement / path preview helpers ---------------- */
// Moved to WorldSceneActions.js

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

function stepMoveCost(prevTile, tile) {
  if (!tile) return Infinity;
  if (tile.type === 'water' || tile.type === 'mountain') return Infinity;

  const typeCost = (tile.type === 'forest') ? 2 : 1;

  const prevElev = Number(prevTile?.elevation ?? prevTile?.visualElevation ?? prevTile?.baseElevation ?? 0);
  const elev = Number(tile.elevation ?? tile.visualElevation ?? tile.baseElevation ?? 0);
  const elevDiff = Math.abs(elev - prevElev);

  return typeCost + elevDiff;
}

function splitPathByMP(scene, unit, fullPath, blockedFn) {
  const mp = getMP(unit);
  let costSum = 0;
  const within = [];
  const beyond = [];

  for (let i = 0; i < fullPath.length; i++) {
    const step = fullPath[i];
    const tile = getTile(scene, step.q, step.r);
    const prevTile = (i > 0) ? getTile(scene, fullPath[i - 1].q, fullPath[i - 1].r) : null;
    const stepCost = (i === 0) ? 0 : stepMoveCost(prevTile, tile);

    if (!Number.isFinite(stepCost) || stepCost === Infinity || (i > 0 && blockedFn(tile))) {
      break;
    }

    if (i === 0 || costSum + stepCost <= mp) {
      within.push(step);
      if (i > 0) costSum += stepCost;
    } else {
      beyond.push(step);
    }
  }

  const usablePath = (within.length > 1) ? within : [];
  const costs = [];
  const cum = [];
  let run = 0;

  for (let i = 0; i < usablePath.length; i++) {
    if (i === 0) {
      costs.push(0);
      cum.push(0);
      continue;
    }
    const prevTile = getTile(scene, usablePath[i - 1].q, usablePath[i - 1].r);
    const tile = getTile(scene, usablePath[i].q, usablePath[i].r);
    const c = stepMoveCost(prevTile, tile);
    run += c;
    costs.push(c);
    cum.push(run);
  }

  return { within, beyond, usablePath, costs, cum, mp };
}

function computePathWithAStar(scene, unit, targetHex, blockedFn) {
  if (!scene || !unit || !targetHex) return null;

  try {
    return aStarFindPath(
      scene,
      { q: unit.q, r: unit.r },
      { q: targetHex.q, r: targetHex.r },
      blockedFn
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
  scene.unitCommandMode = null; // null | 'attack'
  scene.lastHoverCombatTarget = null;
  scene.showPathCostInfo = false;

  ensureAttackController(scene);
  ensureAbilityController(scene);

  // Small floating UI for movement preview cost (screen-space, not world-space)
  scene.pathCostText = scene.add.text(0, 0, '', {
    fontSize: '14px',
    fill: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: { x: 6, y: 4 }
  })
    .setScrollFactor(0)
    .setDepth(10000)
    .setVisible(false);

  if (!scene.pathCostText.setOrigin) {
    // no-op safety for odd Phaser typings/builds
  } else {
    scene.pathCostText.setOrigin(0.5, 1.0);
  }

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
        // Local (singleplayer) fallback: execute attack directly via validate/resolve/applyCombatEvent chain.
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

      const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

      if (fullPath && fullPath.length > 1) {
        setAutoMoveTarget(scene.selectedUnit, rounded.q, rounded.r);

        syncMovementAliases(scene.selectedUnit);
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

    const rounded = scene.worldToAxial(pointer.worldX, pointer.worldY);
    if (
      rounded.q < 0 ||
      rounded.r < 0 ||
      rounded.q >= scene.mapWidth ||
      rounded.r >= scene.mapHeight
    ) {
      scene.clearPathPreview?.();
      scene.pathCostText?.setVisible(false);
      return;
    }

    const ownerName = getUnitOwnerName(scene, scene.selectedUnit);
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      scene.clearPathPreview?.();
      scene.pathCostText?.setVisible(false);
      return;
    }

    const clickedUnit = getUnitAtHex(scene, rounded.q, rounded.r);
    if (clickedUnit && clickedUnit !== scene.selectedUnit) {
      scene.clearPathPreview?.();
      scene.pathCostText?.setVisible(false);
      return;
    }

    const blocked = t => {
      if (!t) return true;
      if (t.type === 'water' || t.type === 'mountain') return true;
      const occ = getUnitAtHex(scene, t.q, t.r);
      if (occ && occ !== scene.selectedUnit) return true;
      return false;
    };

    const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);
    if (!fullPath || fullPath.length <= 1) {
      scene.clearPathPreview?.();
      scene.pathCostText?.setVisible(false);
      return;
    }

    syncMovementAliases(scene.selectedUnit);

    const {
      within,
      beyond,
      usablePath,
      costs,
      cum,
      mp: movementPoints,
    } = splitPathByMP(scene, scene.selectedUnit, fullPath, blocked);

    scene.drawPathPreview?.(within, beyond);

    // Movement cost tooltip
    if (scene.pathCostText) {
      const totalCost = cum.length ? cum[cum.length - 1] : 0;
      const reachable = usablePath.length > 1;
      const txt = reachable
        ? `Move cost: ${totalCost} / ${movementPoints}`
        : `Blocked`;

      scene.pathCostText
        .setText(txt)
        .setPosition(pointer.x, pointer.y - 14)
        .setVisible(true);
    }
  });

  scene.input.on('pointerout', () => {
    scene.clearPathPreview?.();
    scene.pathCostText?.setVisible(false);
  });

  scene.input.keyboard?.on('keydown-ESC', () => {
    scene.unitCommandMode = null;
    scene.clearPathPreview?.();
    clearCombatPreview(scene);
    scene.attackableHexes = null;
    scene.refreshUnitActionPanel?.();
  });
}

/* ---------------- Action panel / selected unit HUD ---------------- */

function getSelectedOwnerName(scene) {
  return getUnitOwnerName(scene, scene.selectedUnit);
}

export function refreshUnitActionPanel(scene) {
  if (!scene.actionPanel) return;

  const panel = scene.actionPanel;
  panel.removeAll(true);

  if (!scene.selectedUnit) {
    panel.setVisible(false);
    return;
  }

  const u = scene.selectedUnit;
  ensureUnitCombatFields(u);

  panel.setVisible(true);

  const ownerName = getSelectedOwnerName(scene);
  const isMyTurn = !scene.turnOwner || ownerName === scene.turnOwner;

  let y = 0;

  const title = scene.add.text(0, y, `Selected: ${u.unitName || u.type || 'Unit'}`, {
    fontSize: '16px',
    fill: '#ffffff',
  });
  panel.add(title);
  y += 24;

  const stats = scene.add.text(0, y,
    `HP ${u.hp}/${u.maxHp ?? u.hpMax ?? '?'}   MP ${getMP(u)}/${u.mpMax ?? u.maxMovementPoints ?? '?'}   AP ${u.ap}/${u.apMax}`,
    { fontSize: '14px', fill: '#d7ecff' }
  );
  panel.add(stats);
  y += 24;

  const modeText = scene.unitCommandMode ? `Mode: ${scene.unitCommandMode}` : 'Mode: move/select';
  const modeLabel = scene.add.text(0, y, modeText, {
    fontSize: '13px',
    fill: '#ffe8a3',
  });
  panel.add(modeLabel);
  y += 26;

  const mkBtn = (label, onClick, enabled = true, color = '#355c7d') => {
    const btn = scene.add.text(0, y, label, {
      fontSize: '14px',
      fill: enabled ? '#fff' : '#888',
      backgroundColor: enabled ? color : '#333',
      padding: { x: 8, y: 4 },
    }).setInteractive({ useHandCursor: enabled });

    if (enabled) btn.on('pointerdown', onClick);
    panel.add(btn);
    y += 28;
    return btn;
  };

  // Attack button
  const hasWeapon = Array.isArray(u.weapons) && u.weapons.length > 0;
  const canAttack = isMyTurn && hasWeapon && (u.ap || 0) > 0;

  mkBtn('Attack', () => {
    if (!canAttack) return;
    scene.unitCommandMode = (scene.unitCommandMode === 'attack') ? null : 'attack';

    if (scene.unitCommandMode === 'attack') {
      ensureAttackController(scene).enter(u);
      updateCombatPreview(scene);
    } else {
      ensureAttackController(scene).exit();
      clearCombatPreview(scene);
    }

    scene.refreshUnitActionPanel?.();
  }, canAttack, scene.unitCommandMode === 'attack' ? '#b23a48' : '#355c7d');

  // Defence button
  const canDefend = isMyTurn && (u.ap || 0) > 0;
  mkBtn('Defend', () => {
    if (!canDefend) return;
    applyDefence(u);
    scene.refreshUnitActionPanel?.();
  }, canDefend, '#3f6b3f');

  // Weapon switch
  const canSwitch = isMyTurn && Array.isArray(u.weapons) && u.weapons.length > 1;
  mkBtn('Switch Weapon', () => {
    if (!canSwitch) return;
    u.activeWeaponIndex = ((u.activeWeaponIndex || 0) + 1) % u.weapons.length;
    scene.refreshUnitActionPanel?.();
    if (scene.unitCommandMode === 'attack') {
      updateCombatPreview(scene);
    }
  }, canSwitch, '#6f4e7c');

  // Ability buttons
  const abilities = Array.isArray(u.activeAbilities) ? u.activeAbilities : [];
  for (const abilityId of abilities) {
    const abilityDef = abilityId ? ensureAbilityController(scene).getAbilityDefSafe?.(abilityId) : null;
    const label = abilityDef?.name || abilityId;
    const canUse = isMyTurn && (u.ap || 0) > 0;

    mkBtn(`Ability: ${label}`, () => {
      if (!canUse) return;

      const abilityController = ensureAbilityController(scene);
      const currentMode = String(scene.unitCommandMode || '');
      const nextMode = `ability:${abilityId}`;

      if (currentMode === nextMode) {
        abilityController.exit('toggle_off');
        scene.unitCommandMode = null;
        clearCombatPreview(scene);
      } else {
        // Exit attack mode if entering ability mode
        ensureAttackController(scene).exit();
        clearCombatPreview(scene);

        scene.unitCommandMode = nextMode;
        abilityController.enter(u, abilityId);
      }

      scene.refreshUnitActionPanel?.();
    }, canUse, '#2a6273');
  }

  panel.setPosition(20, scene.scale.height - Math.min(y + 20, 240));
}

/* ---------------- Selection panel root ---------------- */

export function setupUnitActionPanel(scene) {
  scene.actionPanel = scene.add.container(20, scene.scale.height - 220).setScrollFactor(0).setDepth(9999);
  refreshUnitActionPanel(scene);
}
