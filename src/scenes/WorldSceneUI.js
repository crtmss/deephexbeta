// src/scenes/WorldSceneUI.js
//
// Turn UI, camera, and world input logic for the WorldScene.
//
// NOTE: This file grew a lot during stage A/B/F changes. It is intentionally
// kept as “UI & input glue” and delegates core rules to other modules.

import { findPath as aStarFindPath } from '../engine/AStar.js';
import { validateAttack, resolveAttack } from '../units/CombatResolver.js';
import { ensureUnitCombatFields } from '../units/UnitActions.js';

// NOTE: These are provided by WorldSceneWorldMeta.js merge
import { getTile } from './WorldSceneWorldMeta.js';

import {
  buildTransporterAtSelectedUnit,
  buildRaiderAtSelectedUnit,
} from './WorldSceneUnits.js';

// ------------------------------------------------------------
// Camera Controls
// ------------------------------------------------------------
export function setupCameraControls(scene) {
  const cam = scene.cameras.main;
  cam.setZoom(1);

  scene.isDragging = false;
  scene.dragStart = { x: 0, y: 0 };
  scene.camStart = { x: 0, y: 0 };

  scene.input.on('pointerdown', pointer => {
    if (scene.logisticsInputLocked) return;
    // Right click drag OR middle mouse drag
    if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
      scene.isDragging = true;
      scene.dragStart.x = pointer.x;
      scene.dragStart.y = pointer.y;
      scene.camStart.x = cam.scrollX;
      scene.camStart.y = cam.scrollY;
    }
  });

  scene.input.on('pointerup', pointer => {
    if (pointer.rightButtonReleased() || pointer.middleButtonReleased()) {
      scene.isDragging = false;
    }
  });

  scene.input.on('pointermove', pointer => {
    if (!scene.isDragging) return;
    const dx = pointer.x - scene.dragStart.x;
    const dy = pointer.y - scene.dragStart.y;
    cam.scrollX = scene.camStart.x - dx / cam.zoom;
    cam.scrollY = scene.camStart.y - dy / cam.zoom;
  });

  scene.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
    if (scene.logisticsInputLocked) return;
    const zoomStep = 0.0015;
    const newZoom = Phaser.Math.Clamp(cam.zoom - deltaY * zoomStep, 0.5, 2.2);

    // zoom toward mouse
    const wx = pointer.worldX;
    const wy = pointer.worldY;
    const before = cam.getWorldPoint(pointer.x, pointer.y);
    cam.setZoom(newZoom);
    const after = cam.getWorldPoint(pointer.x, pointer.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  });
}

// ------------------------------------------------------------
// Turn UI
// ------------------------------------------------------------
export function updateTurnText(scene, turnNumber) {
  if (!scene.turnText) return;
  scene.turnText.setText(`Player Turn: ${turnNumber}`);
}

export function setupTurnUI(scene) {
  const w = scene.scale.width;

  scene.turnText = scene.add.text(10, 10, 'Player Turn: 1', {
    fontSize: '16px',
    color: '#000',
    backgroundColor: '#ffffff88',
    padding: { x: 6, y: 3 }
  }).setScrollFactor(0).setDepth(1000);

  const endTurnBtn = scene.add.text(10, 40, 'End Turn', {
    fontSize: '16px',
    color: '#fff',
    backgroundColor: '#228be6',
    padding: { x: 8, y: 4 }
  }).setScrollFactor(0).setInteractive({ useHandCursor: true }).setDepth(1000);

  endTurnBtn.on('pointerdown', () => {
    scene.endTurn?.();
  });

  const refreshBtn = scene.add.text(10, 70, 'Refresh', {
    fontSize: '16px',
    color: '#fff',
    backgroundColor: '#444',
    padding: { x: 8, y: 4 }
  }).setScrollFactor(0).setInteractive({ useHandCursor: true }).setDepth(1000);

  refreshBtn.on('pointerdown', () => {
    window.location.reload();
  });

  // Build buttons (simple)
  const buildTransporterBtn = scene.add.text(w - 160, 10, 'Build Transporter', {
    fontSize: '14px',
    color: '#fff',
    backgroundColor: '#2f9e44',
    padding: { x: 8, y: 4 }
  }).setScrollFactor(0).setInteractive({ useHandCursor: true }).setDepth(1000);

  buildTransporterBtn.on('pointerdown', () => {
    buildTransporterAtSelectedUnit.call(scene);
  });

  const buildRaiderBtn = scene.add.text(w - 160, 40, 'Build Raider', {
    fontSize: '14px',
    color: '#fff',
    backgroundColor: '#9c36b5',
    padding: { x: 8, y: 4 }
  }).setScrollFactor(0).setInteractive({ useHandCursor: true }).setDepth(1000);

  buildRaiderBtn.on('pointerdown', () => {
    buildRaiderAtSelectedUnit.call(scene);
  });
}

// ------------------------------------------------------------
// Selection / Combat UI helpers
// ------------------------------------------------------------
function getMP(unit) {
  if (!unit) return 0;
  if (Number.isFinite(unit.mp)) return unit.mp;
  if (Number.isFinite(unit.movementPoints)) return unit.movementPoints;
  if (Number.isFinite(unit.mpMax)) return unit.mpMax;
  return 0;
}

function setMP(unit, mp) {
  if (!unit) return;
  unit.mp = mp;
  if (Number.isFinite(unit.movementPoints)) unit.movementPoints = mp;
}

function getAP(unit) {
  if (!unit) return 0;
  if (Number.isFinite(unit.ap)) return unit.ap;
  if (Number.isFinite(unit.apMax)) return unit.apMax;
  return 0;
}

function setAP(unit, ap) {
  if (!unit) return;
  unit.ap = ap;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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
    units.find(u => u && u.q === q && u.r === r) ||
    players.find(u => u && u.q === q && u.r === r) ||
    enemies.find(e => e && e.q === q && e.r === r) ||
    haulers.find(h => h && h.q === q && h.r === r) ||
    null
  );
}

// wrapper around shared A* to keep logic here
function tileElevation(t) {
  const v = (t && Number.isFinite(t.visualElevation)) ? t.visualElevation
    : (t && Number.isFinite(t.elevation)) ? t.elevation
    : (t && Number.isFinite(t.baseElevation)) ? t.baseElevation
    : 0;
  return v;
}

// Movement rules (ground units):
// - cannot step if |Δelevation| > 1
// - base cost = 1 for land
// - forest adds +1
// - uphill (toElev > fromElev) adds +1
function stepMoveCost(fromTile, toTile) {
  if (!fromTile || !toTile) return Infinity;

  const e0 = tileElevation(fromTile);
  const e1 = tileElevation(toTile);
  if (Math.abs(e1 - e0) > 1) return Infinity;

  let cost = 1;
  if (toTile.hasForest) cost += 1;
  if (e1 > e0) cost += 1;
  return cost;
}

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

  return aStarFindPath(start, goal, scene.mapData, isBlocked, { getMoveCost: stepMoveCost });
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

// ------------------------------------------------------------
// Combat preview (Stage F - minimal)
// ------------------------------------------------------------
function clearCombatPreview(scene) {
  if (!scene) return;
  if (scene.combatPreviewText) {
    scene.combatPreviewText.destroy();
    scene.combatPreviewText = null;
  }
}

function updateCombatPreview(scene) {
  if (!scene?.selectedUnit || scene.unitCommandMode !== 'attack') return;

  const pointer = scene.input.activePointer;
  const rounded = scene.worldToAxial(pointer.worldX, pointer.worldY);

  const target = getUnitAtHex(scene, rounded.q, rounded.r);
  if (!target || !isEnemy(target)) {
    clearCombatPreview(scene);
    return;
  }

  const attacker = scene.selectedUnit;
  ensureUnitCombatFields(attacker);
  ensureUnitCombatFields(target);

  const weapons = attacker.weapons || [];
  const weaponId = weapons[attacker.activeWeaponIndex] || weapons[0] || null;
  if (!weaponId) {
    clearCombatPreview(scene);
    return;
  }

  const v = validateAttack(attacker, target, weaponId);
  if (!v.ok) {
    clearCombatPreview(scene);
    return;
  }

  // Simple preview: show target HP after a single attack
  const sim = resolveAttack(attacker, target, weaponId, { simulate: true });
  const hpAfter = Math.max(0, (target.hp || 0) - (sim.finalDamage || 0));

  if (scene.combatPreviewText) scene.combatPreviewText.destroy();

  const { x, y } = scene.axialToWorld(target.q, target.r);
  scene.combatPreviewText = scene.add.text(x, y - 22, `HP → ${hpAfter}`, {
    fontSize: '12px',
    color: '#fff',
    backgroundColor: '#000000aa',
    padding: { x: 4, y: 2 }
  }).setOrigin(0.5).setDepth(2000);
}

// ------------------------------------------------------------
// World Input UI (selection + movement)
// ------------------------------------------------------------
export function setupWorldInputUI(scene) {
  scene.pathPreviewTiles = [];
  scene.pathPreviewLabels = [];

  scene.clearPathPreview = () => {
    (scene.pathPreviewTiles || []).forEach(g => g?.destroy?.());
    (scene.pathPreviewLabels || []).forEach(t => t?.destroy?.());
    scene.pathPreviewTiles = [];
    scene.pathPreviewLabels = [];
  };

  scene.input.on('pointerdown', pointer => {
    if (scene.logisticsInputLocked) return;
    if (scene.isDragging) return;

    const rounded = scene.worldToAxial(pointer.worldX, pointer.worldY);
    const { q, r } = rounded;

    if (
      q < 0 || r < 0 ||
      q >= scene.mapWidth || r >= scene.mapHeight
    ) {
      scene.clearPathPreview?.();
      clearCombatPreview(scene);
      return;
    }

    const clickedUnit = getUnitAtHex(scene, q, r);

    // If clicked a unit, select it (and open panel)
    if (clickedUnit) {
      scene.setSelectedUnit?.(clickedUnit);
      scene.updateSelectionHighlight?.();
      scene.refreshUnitActionPanel?.();
      scene.clearPathPreview?.();
      clearCombatPreview(scene);
      return;
    }

    scene.selectedHex = rounded;
    scene.debugHex?.(q, r);

    // If we have a selected unit, treat this as a move order
    if (scene.selectedUnit) {
      // If attack mode active and clicked ground: just cancel attack mode (safer UX)
      if (scene.unitCommandMode === 'attack') {
        scene.unitCommandMode = null;
        clearCombatPreview(scene);
        return;
      }

      // Only allow movement for player-controlled units
      if (!isPlayerUnit(scene.selectedUnit)) {
        scene.clearPathPreview?.();
        return;
      }

      // Turn check
      const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
      if (scene.turnOwner && ownerName !== scene.turnOwner) {
        return;
      }

      // Stage A: units cannot occupy the same hex.
      const blocked = t => {
        if (!t) return true;
        if (t.type === 'water' || t.type === 'mountain') return true;
        const occ = getUnitAtHex(scene, t.q, t.r);
        // Allow start tile (occupied by the moving unit)
        if (occ && occ !== scene.selectedUnit) return true;
        return false;
      };

      const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

      if (fullPath && fullPath.length > 1) {
        let movementPoints = getMP(scene.selectedUnit);
        const trimmedPath = [];
        let costSum = 0;

        for (let i = 0; i < fullPath.length; i++) {
          const step = fullPath[i];
          const tile2 = getTile(scene, step.q, step.r);
          const prev = i > 0 ? getTile(scene, fullPath[i - 1].q, fullPath[i - 1].r) : null;
          const cost = i === 0 ? 0 : stepMoveCost(prev, tile2);
          if (!Number.isFinite(cost) || cost === Infinity) break;
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

            // Combat is resolved directly on the WorldScene (no separate CombatScene).
            // Movement is always applied locally; multiplayer sync (if present) happens here.
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

    // IMPORTANT:
    // Use pointer.worldX/worldY (already camera-adjusted) to keep picking consistent
    // with the hover logic in WorldSceneMap.drawHexMap().
    // Using positionToCamera() here can produce drift under zoom/scroll.
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

    const path = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

    scene.clearPathPreview?.();
    if (path && path.length > 1) {
      let movementPoints = getMP(scene.selectedUnit);
      let costSum = 0;
      const maxPath = [];

      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const prev = i > 0 ? getTile(scene, path[i - 1].q, path[i - 1].r) : null;
        const cost = i === 0 ? 0 : stepMoveCost(prev, tile);
        if (!Number.isFinite(cost) || cost === Infinity) break;

        if (i > 0 && costSum + cost > movementPoints) break;

        // Don't preview through occupied hexes (except start)
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
        const prev = i > 0 ? getTile(scene, maxPath[i - 1].q, maxPath[i - 1].r) : null;
        const cost = i === 0 ? 0 : stepMoveCost(prev, tile);
        if (!Number.isFinite(cost) || cost === Infinity) break;
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
