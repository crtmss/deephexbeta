// src/scenes/WorldSceneUI.js
// ---------------------------------------------------------------------------
// __COMBAT_TRACE__ (compact logs)
// Enable/disable in DevTools: window.__COMBAT_TRACE__ = true/false
// ---------------------------------------------------------------------------
const __TRACE_ON__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_TRACE__ ?? true) : true);
function __t(tag, data) {
  if (!__TRACE_ON__()) return;
  try { console.log(`[$PLAYER]`, data); } catch (_) {}
}

import { refreshUnits } from './WorldSceneActions.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { setupLogisticsPanel } from './WorldSceneLogistics.js';
import { setupEconomyUI } from './WorldSceneEconomy.js';

// Stage B/D combat
import { applyAttack, applyDefence } from '../units/UnitActions.js';

// Stage F: attack preview
import { updateCombatPreview, clearCombatPreview } from './WorldSceneCombatPreview.js';
import { pixelToHex, roundHex } from './WorldSceneMap.js';
import { validateAttack, resolveAttack } from '../units/CombatResolver.js';
import { ensureUnitCombatFields, spendAp } from '../units/UnitActions.js';
import { getWeaponDef } from '../units/WeaponDefs.js';
import { applyCombatEvent } from './WorldSceneCombatRuntime.js';
import { AttackController } from '../combat/AttackController.js';


function ensureAttackController(scene) {
  if (!scene.attackController) {
    scene.attackController = new AttackController(scene);
  }
  return scene.attackController;
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
  const trace = (step, extra) => __t('PLAYER_ATTACK', { step, aid, q, r, mode: scene?.unitCommandMode, ...extra });
  if (!scene || !attacker) { trace('fail:no_scene_or_attacker'); return false; }

  // Must be in attack mode
  if (scene.unitCommandMode !== 'attack') { trace('fail:not_in_attack_mode'); return false; }

  // Must be highlighted
  const key = `${q},${r}`;
  if (!scene.attackableHexes || !scene.attackableHexes.has(key)) { trace('fail:not_highlighted', { hasAttackable: !!scene.attackableHexes, size: scene.attackableHexes?.size }); return false; }

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
  __t('PLAYER_ATTACK', { step: 'apply_event', aid, tid: (target.id || target.unitId), weaponId, dmg, hpBefore });
  applyCombatEvent(scene, {
    type: 'combat:attack',
    attackerId: attacker.id || attacker.unitId,
    defenderId: target.id || target.unitId,
    damage: dmg,
    weaponId,
  });

  // Refresh preview after AP/damage
  __t('PLAYER_ATTACK', { step: 'after_event', tid: (target.id || target.unitId), hpAfter: target.hp });
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

    // Left click: attack mode click-to-attack
    if (scene.unitCommandMode === 'attack' && pointer && !pointer.rightButtonDown?.()) {
      const attacker = scene.selectedUnit;
      if (attacker) {
        const worldX = pointer.worldX - (scene.mapOffsetX || 0);
        const worldY = pointer.worldY - (scene.mapOffsetY || 0);
        const frac = pixelToHex(worldX, worldY, scene.hexSize || 22);
        const axial = roundHex(frac.q, frac.r);

        const ac = ensureAttackController(scene);
        const handled = ac.isActive() ? ac.tryAttackHex(axial.q, axial.r) : tryAttackHex(scene, attacker, axial.q, axial.r);
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

  // Logistics panel + helpers (the UI itself lives in WorldSceneLogistics)
  setupLogisticsPanel(scene);

  // Wrap logistics open/close to:
  // - lock world input (no movement while logistics is open)
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

/* ---------------- Movement rules patch ----------------
   Rules:
   - Units cannot step if |Δelevation| > 1 between adjacent hexes
   - Base move cost = 1 (all land)
   - Forest adds +1
   - Uphill (toElev > fromElev) adds +1
-------------------------------------------------------- */

function tileElevation(t) {
  if (!t) return 0;
  if (Number.isFinite(t.visualElevation)) return t.visualElevation;
  if (Number.isFinite(t.elevation)) return t.elevation;
  if (Number.isFinite(t.baseElevation)) return t.baseElevation;
  return 0;
}

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

  // If AStar.js supports dynamic move cost, it will use this.
  // If not, it'll ignore the 5th argument; UI trimming/preview still applies rules below.
  return aStarFindPath(start, goal, scene.mapData, isBlocked, { getMoveCost: stepMoveCost });
}

function isEnemy(u) {
  return !!(u && (u.isEnemy || u.controller === 'ai') && !u.isPlayer);
}

/**
 * Управляемый объект игрока:
 * - НЕ enemy/ai
 * - обычно isPlayer=true
 * - но также поддерживаем объекты без isPlayer (рейдеры/мобильная база и т.п.)
 *   если у них есть mp/mpMax или movementPoints.
 */
function isControllable(u) {
  if (!u) return false;
  if (u.isEnemy || u.controller === 'ai') return false;

  if (u.isPlayer) return true;

  // fallback: если объект имеет MP-поля, считаем его управляемым
  if (Number.isFinite(u.mpMax) || Number.isFinite(u.mp) || Number.isFinite(u.movementPoints)) return true;

  return false;
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

function getMPMax(unit) {
  const a = Number.isFinite(unit.mpMax) ? unit.mpMax : null;
  const b = Number.isFinite(unit.movementPointsMax) ? unit.movementPointsMax : null;
  const c = Number.isFinite(unit.maxMovementPoints) ? unit.maxMovementPoints : null;
  const cur = getMP(unit);
  return (a ?? b ?? c ?? cur ?? 0) || 0;
}

function setMP(unit, val) {
  const v = Math.max(0, Number.isFinite(val) ? val : 0);
  unit.mp = v;
  if (Number.isFinite(unit.movementPoints)) unit.movementPoints = v;
}

/* ---------------- Auto-move helpers ---------------- */

function cancelAutoMove(unit) {
  if (!unit) return;
  if (unit.autoMove && unit.autoMove.active) {
    unit.autoMove.active = false;
  }
}

function setAutoMoveTarget(unit, q, r) {
  if (!unit) return;
  unit.autoMove = {
    active: true,
    target: { q, r }
  };
}

/* ---------------- Path preview helpers ---------------- */

/**
 * Takes a full A* path and splits it into:
 * - within: the segment this unit can traverse this turn (<= MP)
 * - beyond: the rest of the path (starts at last point of within so the line connects)
 *
 * Also returns:
 * - usablePath: the validated prefix of fullPath up to the first illegal step (Infinity etc.)
 * - costs: per-step move costs (index aligned to usablePath; costs[0]=0)
 * - cum: cumulative cost per node in usablePath (cum[0]=0)
 * - cutIndex: last index (in usablePath) that is reachable this turn
 */
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

/**
 * Возвращает массив меток { q, r, turnIndex } только в границах ходов + цель.
 * Первый ход использует текущий MP, далее mpMax.
 */
function computeTurnMarkers(scene, unit, usablePath, costs) {
  const markers = [];
  if (!Array.isArray(usablePath) || usablePath.length < 2) return markers;

  const mpMax = getMPMax(unit);
  let turn = 1;
  let mpLeft = getMP(unit);
  if (mpLeft <= 0) mpLeft = mpMax;

  for (let i = 1; i < usablePath.length; i++) {
    const stepCost = costs[i] ?? 0;

    if (stepCost > mpLeft) {
      // заканчиваем ход на предыдущей клетке
      const prev = usablePath[i - 1];
      markers.push({ q: prev.q, r: prev.r, turnIndex: turn });

      // новый ход
      turn += 1;
      mpLeft = mpMax;
    }

    mpLeft -= stepCost;
  }

  const goal = usablePath[usablePath.length - 1];
  markers.push({ q: goal.q, r: goal.r, turnIndex: turn });

  return markers;
}

function drawPathLine(scene, path, style) {
  if (!Array.isArray(path) || path.length < 2) return null;

  const g = scene.add.graphics();
  g.lineStyle(style.width ?? 2, style.color ?? 0xffffff, style.alpha ?? 0.9);
  g.setDepth(style.depth ?? 50);

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const wa = scene.axialToWorld(a.q, a.r);
    const wb = scene.axialToWorld(b.q, b.r);
    g.beginPath();
    g.moveTo(wa.x, wa.y);
    g.lineTo(wb.x, wb.y);
    g.strokePath();
  }

  scene.pathPreviewTiles.push(g);
  return g;
}

/**
 * Sets up unit selection + path preview + movement + Stage B/F attack/defence hotkeys.
 */
export function setupWorldInputUI(scene) {
  scene.pathPreviewTiles = scene.pathPreviewTiles || [];
  scene.pathPreviewLabels = scene.pathPreviewLabels || [];

  scene.unitCommandMode = scene.unitCommandMode || null; // null | 'attack'

  if (typeof scene.hexDistance !== 'function') {
    scene.hexDistance = hexDistance;
  }

  // ✅ If UI (History) set a short click-block flag, respect it here.
  const isUiPointerBlocked = () => {
    const now = scene.time?.now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return !!(scene.__uiPointerBlockUntil && now < scene.__uiPointerBlockUntil);
  };

  // Prevent world input while hovering over history panel
  // (panel is on screen space, pointer world coords still update).
  const isPointerOverHistoryPanel = (pointer) => {
    if (!scene.isHistoryPanelOpen) return false;
    const p = scene.historyPanelContainer;
    if (!p || !p.visible) return false;

    const px = pointer.x;
    const py = pointer.y;
    const x0 = p.x;
    const y0 = p.y;
    const x1 = p.x + (scene.historyPanelWidth || 0);
    const y1 = p.y + (scene.historyPanelHeight || 0);

    return px >= x0 && px <= x1 && py >= y0 && py <= y1;
  };

  // Stage B: hotkeys (A=attack mode, D=defence, ESC=cancel mode)
  scene.input.keyboard?.on('keydown', (ev) => {
    if (!scene || scene.logisticsInputLocked) return;

    const ae = (typeof document !== 'undefined') ? document.activeElement : null;
    const tag = ae?.tagName ? String(ae.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;

    const key = String(ev.key || '').toLowerCase();

    if (key === 'escape') {
      // 1) cancel command mode
      if (scene.unitCommandMode) {
        scene.unitCommandMode = null;
        scene.clearPathPreview?.();
        clearCombatPreview(scene);
        console.log('[UNITS] Command mode cleared');
        return;
      }

      // 2) cancel selected unit auto-move
      if (scene.selectedUnit && isControllable(scene.selectedUnit)) {
        cancelAutoMove(scene.selectedUnit);
        console.log('[MOVE] Auto-move cancelled');
        scene.refreshUnitActionPanel?.();
      }
      return;
    }

    if (!scene.selectedUnit) return;
    if (!isControllable(scene.selectedUnit)) return;

    const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
    if (scene.turnOwner && ownerName !== scene.turnOwner) {
      return;
    }

    if (key === 'a') {
      scene.unitCommandMode = (scene.unitCommandMode === 'attack') ? null : 'attack';
      scene.clearPathPreview?.();

      if (scene.unitCommandMode === 'attack') __t('PLAYER_ATTACK', { step: 'after_event', tid: (target.id || target.unitId), hpAfter: target.hp });
  updateCombatPreview(scene);
      else clearCombatPreview(scene);      return;
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
      return;
    }
  });

  scene.input.on('pointerdown', pointer => {
    if (scene.logisticsInputLocked) return;
    if (scene.isDragging) return;
    if (pointer.rightButtonDown && pointer.rightButtonDown()) return;
    if (isUiPointerBlocked()) return;              // ✅ NEW: prevent click-through from History
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
      const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
      if (scene.turnOwner && ownerName !== scene.turnOwner) return;

      const sent = trySendAttackIntent(scene, scene.selectedUnit, clickedUnit);

      if (!sent) {
        const dist = (typeof scene.hexDistance === 'function')
          ? scene.hexDistance(scene.selectedUnit.q, scene.selectedUnit.r, clickedUnit.q, clickedUnit.r)
          : null;

        const atk = applyAttack(scene.selectedUnit, clickedUnit, { distance: dist });
        if (!atk.ok) {
          console.log('[ATTACK] failed:', atk.reason);
          return;
        }

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

      scene.unitCommandMode = null;
      clearCombatPreview(scene);

      cancelAutoMove(scene.selectedUnit);

      scene.refreshUnitActionPanel?.();
      return;
    }

    // Unit selection
    if (clickedUnit) {
      scene.toggleSelectedUnitAtHex?.(q, r);
      scene.clearPathPreview?.();
      scene.selectedHex = null;

      scene.unitCommandMode = null;
      clearCombatPreview(scene);

      scene.debugHex?.(q, r);
      return;
    }

    // Ground click
    // If no unit is selected, allow selecting ANY hex (including water)
    // and show its info in the Unit panel (hex inspector).
    if (!scene.selectedUnit) {
      scene.selectedHex = { q, r };
      scene.selectedBuilding = null;

      // Close any lingering command mode / previews
      scene.unitCommandMode = null;
      scene.clearPathPreview?.();
      clearCombatPreview(scene);

      // Open hex inspector in the same panel used for units
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

      const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
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
        // ✅ AUTO-MOVE always stores target
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
    if (isUiPointerBlocked()) return;              // ✅ NEW: prevent preview churn right after History click
    if (isPointerOverHistoryPanel(pointer)) return;
    if (!scene.selectedUnit || scene.isUnitMoving) return;

    if (scene.unitCommandMode === 'attack') {
      scene.clearPathPreview?.();
      __t('PLAYER_ATTACK', { step: 'after_event', tid: (target.id || target.unitId), hpAfter: target.hp });
  updateCombatPreview(scene);
      return;
    } else {
      clearCombatPreview(scene);
    }

    if (!isControllable(scene.selectedUnit)) {
      scene.clearPathPreview?.();
      return;
    }

    const ownerName = scene.selectedUnit.playerName || scene.selectedUnit.name;
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

      // ✅ Colors: cyan + grey
      const withinColor = 0x00ffff; // cyan
      const beyondColor = 0x8a8a8a; // grey

      if (within.length > 1) {
        drawPathLine(scene, within, { color: withinColor, alpha: 0.95, width: 3, depth: 50 });
      }
      if (beyond.length > 1) {
        drawPathLine(scene, beyond, { color: beyondColor, alpha: 0.85, width: 3, depth: 50 });
      }

      // ✅ Only show "turns to goal" markers
      const markers = computeTurnMarkers(scene, scene.selectedUnit, usablePath, costs);

      for (const m of markers) {
        const { x, y } = scene.axialToWorld(m.q, m.r);

        // marker color: reachable this turn => cyan, else grey
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

/* Optional default export for convenience (doesn't break named imports) */
export default {
  setupCameraControls,
  setupTurnUI,
  updateTurnText,
  setupWorldInputUI,
};
