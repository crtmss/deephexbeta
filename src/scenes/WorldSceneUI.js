// deephexbeta/src/scenes/WorldSceneUI.js

import { refreshUnits } from './WorldSceneActions.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { setupLogisticsPanel } from './WorldSceneLogistics.js';
import { setupEconomyUI } from './WorldSceneEconomy.js';

// Stage B/D combat
import { applyAttack, applyDefence } from '../units/UnitActions.js';

// Stage F: attack preview
import { updateCombatPreview, clearCombatPreview } from './WorldSceneCombatPreview.js';

/* ---------------- Camera controls (unused unless called) ---------------- */
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

  scene.input.on('pointerup', () => {
    if (scene.isDragging) {
      scene.isDragging = false;
      scene.input.setDefaultCursor('grab');
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

  // Logistics panel + helpers (the UI itself lives in WorldSceneLogistics)
  setupLogisticsPanel(scene);

  // Wrap logistics open/close to:
  // - lock world input (no mobile base movement while logistics is open)
  // - clear any selected unit and path preview when opening
  const origOpenLogi = scene.openLogisticsPanel;
  const origCloseLogi = scene.closeLogisticsPanel;

  scene.logisticsInputLocked = false;

  scene.openLogisticsPanel = function () {
    this.logisticsInputLocked = true;

    // Unselect any unit and clear move preview when opening logistics
    this.setSelectedUnit?.(null);
    this.selectedHex = null;
    this.clearPathPreview?.();

    // Stage F: clear attack preview
    clearCombatPreview(this);

    origOpenLogi?.call(this);
  };

  scene.closeLogisticsPanel = function () {
    this.logisticsInputLocked = false;
    origCloseLogi?.call(this);
  };
}

export function updateTurnText(scene, currentTurn) {
  if (scene.turnText) {
    scene.turnText.setText('Player Turn: ' + currentTurn);
  }
}

/* =========================
   Path preview & selection UI
   ========================= */

// local helper, same as in WorldScene
function getTile(scene, q, r) {
  return (scene.mapData || []).find(h => h.q === q && h.r === r);
}

// helper: find any unit/hauler on given hex
function getUnitAtHex(scene, q, r) {
  // Prefer scene.units if present (contains players + enemies),
  // but keep legacy arrays for compatibility.
  const units = scene.units || [];
  const players = scene.players || [];
  const enemies = scene.enemies || [];
  const haulers = scene.haulers || [];

  return (
    units.find(u => u && u.q === q && u.r === r && !u.isDead) ||
    players.find(u => u && u.q === q && u.r === r && !u.isDead) ||
    enemies.find(e => e && e.q === q && e.r === r && !e.isDead) ||
    haulers.find(h => h && h.q === q && h.r === r && !h.isDead) ||
    null
  );
}

// wrapper around shared A* to keep logic here
function computePathWithAStar(scene, unit, targetHex, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) {
    return [start];
  }

  const isBlocked = tile => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  return aStarFindPath(start, goal, scene.mapData, isBlocked);
}

/**
 * Enemy classification (FIX):
 * Your "blue" AI units may not have isEnemy/controller flags,
 * so for player units we treat ANY non-player as enemy.
 */
function isEnemyRelative(scene, attacker, u) {
  if (!u || u.isDead) return false;
  if (u === attacker) return false;

  // explicit AI/enemy flags
  if (u.isEnemy || u.controller === 'ai') return true;

  // if attacker is player -> anyone not player is enemy
  if (attacker?.isPlayer) return !u.isPlayer;

  // if attacker is not player -> players are enemies
  return !!u.isPlayer;
}

function isEnemy(u) {
  return !!(u && (u.isEnemy || u.controller === 'ai') && !u.isPlayer);
}

function isPlayerUnit(u) {
  return !!(u && u.isPlayer);
}

/**
 * Stage B: apply kill handling (remove from arrays, destroy GO)
 * NOTE: In host-authoritative mode, kills should primarily come from combat events.
 * This function is still kept for legacy/local fallback.
 */
function killUnit(scene, unit) {
  if (!scene || !unit) return;

  // Remove from arrays
  const rm = (arr) => {
    if (!Array.isArray(arr)) return;
    const idx = arr.indexOf(unit);
    if (idx >= 0) arr.splice(idx, 1);
  };

  rm(scene.units);
  rm(scene.players);
  rm(scene.enemies);

  try {
    unit.destroy?.();
  } catch (e) {}

  if (scene.selectedUnit === unit) {
    scene.setSelectedUnit?.(null);
  }
  scene.updateSelectionHighlight?.();
}

/**
 * Axial hex distance helper (for preview if needed elsewhere).
 */
function hexDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function getMP(unit) {
  if (!unit) return 0;
  if (Number.isFinite(unit.movementPoints)) return unit.movementPoints;
  if (Number.isFinite(unit.mp)) return unit.mp;
  return 0;
}
function setMP(unit, v) {
  if (!unit) return;
  unit.movementPoints = v;
  if (Number.isFinite(unit.mp)) unit.mp = v;
  else unit.mp = v; // keep legacy field present for other modules
}
function getAP(unit) {
  if (!unit) return 0;
  if (Number.isFinite(unit.ap)) return unit.ap;
  if (Number.isFinite(unit.actionPoints)) return unit.actionPoints;
  return 0;
}
function setAP(unit, v) {
  if (!unit) return;
  unit.ap = v;
  unit.actionPoints = v;
}

/**
 * Host-authoritative: send attack intent from clients.
 * If scene.sendCombatIntent exists, we use it.
 * Otherwise fallback to local applyAttack (singleplayer/dev).
 */
function trySendAttackIntent(scene, attacker, defender) {
  if (!scene || !attacker || !defender) return false;

  const weapons = attacker.weapons || [];
  const weaponId = weapons[attacker.activeWeaponIndex] || weapons[0] || null;

  const attackerId =
    attacker.id ??
    attacker.unitId ??
    attacker.uuid ??
    attacker.netId ??
    `${attacker.unitName || attacker.name}@${attacker.q},${attacker.r}`;

  const defenderId =
    defender.id ??
    defender.unitId ??
    defender.uuid ??
    defender.netId ??
    `${defender.unitName || defender.name}@${defender.q},${defender.r}`;

  const nonce =
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  const intent = {
    type: 'intent:attack',
    attackerId: String(attackerId),
    defenderId: String(defenderId),
    weaponId,
    nonce,
    sender: scene.playerName || null,
  };

  if (typeof scene.sendCombatIntent === 'function') {
    scene.sendCombatIntent(intent);
    return true;
  }

  if (scene.isHost && typeof scene.handleCombatIntent === 'function') {
    scene.handleCombatIntent(intent);
    return true;
  }

  return false;
}

/**
 * Sets up unit selection + path preview + movement + Stage B/F attack/defence hotkeys.
 */
export function setupWorldInputUI(scene) {
  // ensure arrays for preview are present
  scene.pathPreviewTiles = scene.pathPreviewTiles || [];
  scene.pathPreviewLabels = scene.pathPreviewLabels || [];

  // Stage B: command mode
  scene.unitCommandMode = scene.unitCommandMode || null; // null | 'attack'

  // Provide distance helper for preview module (safe)
  if (typeof scene.hexDistance !== 'function') {
    scene.hexDistance = hexDistance;
  }

  // Stage B: hotkeys (A=attack mode, D=defence, ESC=cancel mode)
  scene.input.keyboard?.on('keydown', (ev) => {
    if (!scene || scene.logisticsInputLocked) return;

    const key = String(ev.key || '').toLowerCase();

    if (key === 'escape') {
      if (scene.unitCommandMode) {
        scene.unitCommandMode = null;
        scene.clearPathPreview?.();
        clearCombatPreview(scene);
        console.log('[UNITS] Command mode cleared');
      }
      return;
    }

    if (!scene.selectedUnit) return;

    // Allow selecting enemy (panel), but actions only for player units
    if (!isPlayerUnit(scene.selectedUnit)) return;

    // Optional: only allow acting on your turnOwner
    const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      // Not your turn: ignore
      return;
    }

    if (key === 'a') {
      // Must have AP to enter attack mode
      if (getAP(scene.selectedUnit) <= 0) return;

      scene.unitCommandMode = (scene.unitCommandMode === 'attack') ? null : 'attack';
      scene.clearPathPreview?.();

      if (scene.unitCommandMode === 'attack') {
        updateCombatPreview(scene);
      } else {
        clearCombatPreview(scene);
      }

      console.log('[UNITS] Attack mode:', scene.unitCommandMode === 'attack' ? 'ON' : 'OFF');
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
      try {
        scene.selectedUnit.setAlpha?.(0.85);
      } catch (e) {}
      scene.updateSelectionHighlight?.();
      scene.refreshUnitActionPanel?.();
      return;
    }
  });

  scene.input.on('pointerdown', pointer => {
    if (scene.logisticsInputLocked) return;
    if (scene.isDragging) return;
    if (pointer.rightButtonDown && pointer.rightButtonDown()) return;

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (
      rounded.q < 0 ||
      rounded.r < 0 ||
      rounded.q >= scene.mapWidth ||
      rounded.r >= scene.mapHeight
    ) return;

    const { q, r } = rounded;

    const clickedUnit = getUnitAtHex(scene, q, r);

    // Stage F: attack mode -> click enemy to attack
    if (scene.unitCommandMode === 'attack' && scene.selectedUnit && clickedUnit) {
      // Must be player unit to attack
      if (!isPlayerUnit(scene.selectedUnit)) return;

      // Must be enemy relative to selected unit (FIX for "blue" units)
      if (!isEnemyRelative(scene, scene.selectedUnit, clickedUnit)) return;

      // Turn check
      const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
      if (scene.turnOwner && ownerName !== scene.turnOwner) return;

      // Must have AP
      const apNow = getAP(scene.selectedUnit);
      if (apNow <= 0) return;

      // Host-authoritative send intent, else local fallback
      const sent = trySendAttackIntent(scene, scene.selectedUnit, clickedUnit);

      if (!sent) {
        const atk = applyAttack(scene.selectedUnit, clickedUnit, {
          turnOwner: scene.turnOwner,
          turnNumber: scene.turnNumber,
          roomCode: scene.roomCode,
          seed: scene.seed,
        });
        if (!atk.ok) {
          console.log('[ATTACK] failed:', atk.reason);
          return;
        }

        const r2 = atk.details || atk.result || null;
        if (r2) {
          console.log(
            `[ATTACK] ${scene.selectedUnit.name} -> enemy (${clickedUnit.q},${clickedUnit.r}) with ${r2.weaponId}: dmg=${atk.damage ?? r2.finalDamage} dist=${r2.distance}`
          );
        }

        // Local fallback kill
        if (clickedUnit.hp <= 0) {
          console.log('[ATTACK] target destroyed');
          killUnit(scene, clickedUnit);
        }
      }

      // Spend AP always; spend 1 MP only if MP remains (as you requested)
      setAP(scene.selectedUnit, Math.max(0, apNow - 1));
      const mpNow = getMP(scene.selectedUnit);
      if (mpNow > 0) setMP(scene.selectedUnit, Math.max(0, mpNow - 1));

      // Exit attack mode
      scene.unitCommandMode = null;
      clearCombatPreview(scene);
      scene.refreshUnitActionPanel?.();
      return;
    }

    // Clicking a unit -> select it (including enemies, to view info panel)
    if (clickedUnit) {
      scene.toggleSelectedUnitAtHex?.(q, r);
      scene.clearPathPreview?.();
      scene.selectedHex = null;

      // Exit attack mode on selecting something else
      scene.unitCommandMode = null;
      clearCombatPreview(scene);

      scene.debugHex?.(q, r);
      scene.refreshUnitActionPanel?.();
      return;
    }

    // Ground click
    const tile = getTile(scene, q, r);
    if (tile && tile.isLocation) {
      console.log(
        `[LOCATION] Clicked on location: ${tile.locationType || 'Unknown'} at (${q},${r})`
      );
    }

    scene.selectedHex = rounded;
    scene.debugHex?.(q, r);

    if (scene.selectedUnit) {
      // Cancel attack mode if click ground (safe UX)
      if (scene.unitCommandMode === 'attack') {
        scene.unitCommandMode = null;
        clearCombatPreview(scene);
        scene.refreshUnitActionPanel?.();
        return;
      }

      // Only player units can move
      if (!isPlayerUnit(scene.selectedUnit)) return;

      // Turn check
      const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
      if (scene.turnOwner && ownerName !== scene.turnOwner) return;

      // ✅ FIX: do not allow moving with 0 MP
      const mpStart = getMP(scene.selectedUnit);
      if (mpStart <= 0) return;

      // Block occupied tiles (no stacking, includes enemies)
      const blocked = t => {
        if (!t) return true;
        if (t.type === 'water' || t.type === 'mountain') return true;
        const occ = getUnitAtHex(scene, t.q, t.r);
        if (occ && occ !== scene.selectedUnit) return true;
        return false;
      };

      const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

      if (fullPath && fullPath.length > 1) {
        let movementPoints = mpStart;
        const trimmedPath = [];
        let costSum = 0;

        for (let i = 0; i < fullPath.length; i++) {
          const step = fullPath[i];
          const tile2 = getTile(scene, step.q, step.r);
          const cost = tile2?.movementCost || 1;

          if (i > 0 && costSum + cost > movementPoints) break;

          // Extra safety: stop if any intermediate destination becomes occupied (except start)
          if (i > 0) {
            const occ = getUnitAtHex(scene, step.q, step.r);
            if (occ && occ !== scene.selectedUnit) break;
          }

          trimmedPath.push(step);
          if (i > 0) costSum += cost;
        }

        if (trimmedPath.length > 1) {
          // Ensure destination not occupied (no stacking)
          const dest = trimmedPath[trimmedPath.length - 1];
          const destOcc = getUnitAtHex(scene, dest.q, dest.r);
          if (destOcc && destOcc !== scene.selectedUnit) return;

          console.log('[MOVE] Committing move along path:', trimmedPath);
          scene.startStepMovement?.(scene.selectedUnit, trimmedPath, () => {
            try {
              const unit = scene.selectedUnit;
              if (unit) {
                const mpBefore = getMP(unit);
                const mpAfter = Math.max(0, mpBefore - costSum);
                setMP(unit, mpAfter);
              }
            } catch (e) {}

            if (scene.checkCombat?.(
              scene.selectedUnit,
              trimmedPath[trimmedPath.length - 1]
            )) {
              scene.scene.start('CombatScene', {
                seed: scene.seed,
                playerUnit: scene.selectedUnit,
              });
            } else {
              scene.syncPlayerMove?.(scene.selectedUnit);
            }

            scene.refreshUnitActionPanel?.();
          });
        }
      }
    }
  });

  scene.input.on('pointermove', pointer => {
    if (scene.logisticsInputLocked) return;
    if (scene.isDragging) return;
    if (!scene.selectedUnit || scene.isUnitMoving) return;

    // Stage F: attack preview
    if (scene.unitCommandMode === 'attack') {
      scene.clearPathPreview?.();
      updateCombatPreview(scene);
      return;
    } else {
      clearCombatPreview(scene);
    }

    // Only show path preview for player units
    if (!isPlayerUnit(scene.selectedUnit)) {
      scene.clearPathPreview?.();
      return;
    }

    // Turn check
    const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      scene.clearPathPreview?.();
      return;
    }

    // ✅ FIX: no preview if 0 MP
    const mpNow = getMP(scene.selectedUnit);
    if (mpNow <= 0) {
      scene.clearPathPreview?.();
      return;
    }

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

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

    const path = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

    scene.clearPathPreview?.();
    if (path && path.length > 1) {
      let movementPoints = mpNow;
      let costSum = 0;
      const maxPath = [];

      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;

        if (i > 0 && costSum + cost > movementPoints) break;

        if (i > 0) {
          const occ = getUnitAtHex(scene, step.q, step.r);
          if (occ && occ !== scene.selectedUnit) break;
        }

        maxPath.push(step);
        if (i > 0) costSum += cost;
      }

      const graphics = scene.add.graphics();
      graphics.lineStyle(2, 0x64ffda, 0.9);
      graphics.setDepth(50);

      for (let i = 0; i < maxPath.length - 1; i++) {
        const a = maxPath[i];
        const b = maxPath[i + 1];
        const wa = scene.axialToWorld(a.q, a.r);
        const wb = scene.axialToWorld(b.q, b.r);
        graphics.beginPath();
        graphics.moveTo(wa.x, wa.y);
        graphics.lineTo(wb.x, wb.y);
        graphics.strokePath();
      }

      scene.pathPreviewTiles.push(graphics);

      const baseColor = '#e8f6ff';
      const outOfRangeColor = '#ff7b7b';
      costSum = 0;
      for (let i = 0; i < maxPath.length; i++) {
        const step = maxPath[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;
        if (i > 0) costSum += cost;
        const { x, y } = scene.axialToWorld(step.q, step.r);
        const labelColor = costSum <= movementPoints ? baseColor : outOfRangeColor;
        const label = scene.add.text(x, y, `${costSum}`, {
          fontSize: '10px',
          color: labelColor,
          fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(51);
        scene.pathPreviewLabels.push(label);
      }
    }
  });

  scene.input.on('pointerout', () => {
    scene.clearPathPreview?.();
    clearCombatPreview(scene);
  });
}

/* Optional default export for convenience (doesn't break named imports) */
export default {
  setupCameraControls,
  setupTurnUI,
  updateTurnText,
  setupWorldInputUI,
};
