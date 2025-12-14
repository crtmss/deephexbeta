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
    units.find(u => u && u.q === q && u.r === r) ||
    players.find(u => u && u.q === q && u.r === r) ||
    enemies.find(e => e && e.q === q && e.r === r) ||
    haulers.find(h => h && h.q === q && h.r === r) ||
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

/* ---------------- MP helpers (keep legacy + canonical fields in sync) ---------------- */

function getMP(unit) {
  const mpA = Number.isFinite(unit.movementPoints) ? unit.movementPoints : null;
  const mpB = Number.isFinite(unit.mp) ? unit.mp : null;
  return (mpB != null) ? mpB : (mpA != null ? mpA : 0);
}

function setMP(unit, val) {
  const v = Math.max(0, Number.isFinite(val) ? val : 0);
  unit.mp = v;
  if (Number.isFinite(unit.movementPoints)) unit.movementPoints = v;
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
    if (!isPlayerUnit(scene.selectedUnit)) return;

    // Optional: only allow acting on your turnOwner
    const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      // Not your turn: ignore
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

      console.log('[UNITS] Attack mode:', scene.unitCommandMode === 'attack' ? 'ON' : 'OFF');
      return;
    }

    if (key === 'd') {
      const res = applyDefence(scene.selectedUnit);
      if (!res.ok) {
        console.log('[DEFENCE] failed:', res.reason);
        return;
      }
      console.log('[DEFENCE] applied to', scene.selectedUnit.name || scene.selectedUnit.unitId);
      // Visual cue: tint darker if possible
      try {
        scene.selectedUnit.setAlpha?.(0.85);
      } catch (e) {}
      scene.updateSelectionHighlight?.();
      scene.refreshUnitActionPanel?.();
      return;
    }
  });

  scene.input.on('pointerdown', pointer => {
    // Block world input when Logistics panel is open / logistics interactions active
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

    // Stage F: if in attack mode and clicked an enemy -> send intent (client) / resolve (host)
    const clickedUnit = getUnitAtHex(scene, q, r);
    if (scene.unitCommandMode === 'attack' && scene.selectedUnit && clickedUnit && isEnemy(clickedUnit)) {
      // Turn check
      const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
      if (scene.turnOwner && ownerName !== scene.turnOwner) return;

      const sent = trySendAttackIntent(scene, scene.selectedUnit, clickedUnit);

      if (!sent) {
        // Fallback: local resolve (dev/singleplayer)
        const dist = (typeof scene.hexDistance === 'function')
          ? scene.hexDistance(scene.selectedUnit.q, scene.selectedUnit.r, clickedUnit.q, clickedUnit.r)
          : null;

        const atk = applyAttack(scene.selectedUnit, clickedUnit, { distance: dist });
        if (!atk.ok) {
          console.log('[ATTACK] failed:', atk.reason);
          return;
        }

        // Note: in host-authoritative mode the real damage should come via events.
        // This fallback keeps old behavior for singleplayer/dev builds.
        const details = atk.details || atk.result || null;
        if (details) {
          console.log(
            `[ATTACK] ${scene.selectedUnit.name} -> enemy (${clickedUnit.q},${clickedUnit.r}) with ${details.weaponId}`
          );
        }

        if (clickedUnit.hp <= 0) {
          console.log('[ATTACK] target destroyed');
          killUnit(scene, clickedUnit);
        }
      }

      // After attack attempt exit attack mode (good UX)
      scene.unitCommandMode = null;
      clearCombatPreview(scene);
      scene.refreshUnitActionPanel?.();
      return;
    }

    // First, check if there's a unit on this hex and toggle selection.
    if (clickedUnit) {
      scene.toggleSelectedUnitAtHex?.(q, r);
      scene.clearPathPreview?.();
      scene.selectedHex = null;

      // Exit attack mode on selecting something else
      scene.unitCommandMode = null;
      clearCombatPreview(scene);

      scene.debugHex?.(q, r);
      return;
    }

    // No unit here: it's a ground/location click
    const tile = getTile(scene, q, r);
    if (tile && tile.isLocation) {
      console.log(
        `[LOCATION] Clicked on location: ${tile.locationType || 'Unknown'} at (${q},${r})`
      );
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
      let movementPoints = getMP(scene.selectedUnit);
      let costSum = 0;
      const maxPath = [];

      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;

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
