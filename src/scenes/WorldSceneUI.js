// deephexbeta/src/scenes/WorldSceneUI.js

import { refreshUnits } from './WorldSceneActions.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';

/* ---------------- Camera controls (unchanged) ---------------- */
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
      scene.cameras.main.scrollX = scene.cameraStartX - dx / scene.cameras.main.zoom;
      scene.cameras.main.scrollY = scene.cameraStartY - dy / scene.cameras.main.zoom;
    }
  });

  scene.input.on('wheel', (pointer, _, __, deltaY) => {
    const cam = scene.cameras.main;
    let z = cam.zoom - deltaY * 0.001;
    z = Phaser.Math.Clamp(z, 0.5, 2.5);
    cam.setZoom(z);
  });
}

/* ---------------- Turn UI ---------------- */
export function setupTurnUI(scene) {
  // Ensure resource state exists BEFORE drawing HUD
  if (!scene.playerResources) {
    scene.playerResources = { food: 20, scrap: 20, money: 100, influence: 0 };
  }

  // Resource HUD (top-left, fixed)
  createResourceHUD(scene);
  scene.updateResourceUI = () => updateResourceUI(scene);
  scene.bumpResource = (key) => bumpResource(scene, key);
  updateResourceUI(scene);

  // Turn label
  scene.turnText = scene.add.text(20, 58, 'Player Turn: ...', {
    fontSize: '18px',
    fill: '#e8f6ff',
    backgroundColor: '#133046',
    padding: { x: 10, y: 5 }
  }).setScrollFactor(0).setDepth(100).setInteractive();

  // End Turn button
  scene.endTurnButton = scene.add.text(20, 88, 'End Turn', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#3da9fc',
    padding: { x: 10, y: 5 }
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.endTurnButton.on('pointerdown', () => {
    scene.endTurn();
  });

  // Refresh button
  scene.refreshButton = scene.add.text(20, 121, 'Refresh', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#444',
    padding: { x: 10, y: 5 }
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.refreshButton.on('pointerdown', () => {
    refreshUnits(scene);
  });

  // Unit Action Panel (2×2)
  createUnitActionPanel(scene);
}

export function updateTurnText(scene, currentTurn) {
  if (scene.turnText) {
    scene.turnText.setText('Player Turn: ' + currentTurn);
  }
}

/* =========================
   RESOURCE HUD (top-left)
   ========================= */
function createResourceHUD(scene) {
  const plateColor = 0x0f2233;
  const strokeColor = 0x3da9fc;

  const originX = 20;
  const originY = 16;

  const panel = scene.add.container(originX, originY).setScrollFactor(0).setDepth(2000);

  const W = 280, H = 34;
  const bg = scene.add.graphics();
  bg.fillStyle(plateColor, 0.92);
  bg.fillRoundedRect(0, 0, W, H, 10);
  bg.lineStyle(2, strokeColor, 0.9);
  bg.strokeRoundedRect(0, 0, W, H, 10);

  panel.add(bg);

  const items = [
    { key: 'food',      emoji: '🍖', label: 'Food' },
    { key: 'scrap',     emoji: '🛠', label: 'Scrap' },
    { key: 'money',     emoji: '💰', label: 'Money' },
    { key: 'influence', emoji: '⭐', label: 'Inf' },
  ];

  const gap = 66;
  const startX = 12;
  const yMid = H / 2;

  const entries = {};

  items.forEach((it, i) => {
    const x = startX + i * gap;

    const icon = scene.add.text(x, yMid, it.emoji, {
      fontSize: '18px',
      color: '#ffffff'
    }).setOrigin(0, 0.5).setDepth(2001);

    const txt = scene.add.text(x + 22, yMid, '0', {
      fontSize: '16px',
      color: '#e8f6ff'
    }).setOrigin(0, 0.5).setDepth(2001);

    panel.add(icon);
    panel.add(txt);

    entries[it.key] = { icon, txt };
  });

  scene.resourceHUD = {
    container: panel,
    bg,
    entries
  };
}

function updateResourceUI(scene) {
  if (!scene.resourceHUD || !scene.resourceHUD.entries) return;
  const r = scene.playerResources || { food: 0, scrap: 0, money: 0, influence: 0 };
  const { entries } = scene.resourceHUD;

  if (entries.food)      entries.food.txt.setText(String(r.food ?? 0));
  if (entries.scrap)     entries.scrap.txt.setText(String(r.scrap ?? 0));
  if (entries.money)     entries.money.txt.setText(String(r.money ?? 0));
  if (entries.influence) entries.influence.txt.setText(String(r.influence ?? 0));
}

function bumpResource(scene, key) {
  if (!scene.resourceHUD || !scene.resourceHUD.entries) return;
  const entry = scene.resourceHUD.entries[key];
  if (!entry) return;

  const targets = [entry.icon, entry.txt];
  targets.forEach(obj => {
    obj.setScale(1);
    scene.tweens.add({
      targets: obj,
      scale: 1.15,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
  });
}

/* =========================
   Unit Action Panel (2×2)
   ========================= */
function createUnitActionPanel(scene) {
  const originX = 20;
  const originY = 164;

  const panel = scene.add.container(originX, originY).setScrollFactor(0).setDepth(2000);
  panel.visible = false;

  const W = 172, H = 172;
  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.92);
  bg.fillRoundedRect(0, 0, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, W, H, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  for (let i = 1; i <= 2; i++) {
    bezel.strokeRect(8*i, 8*i, W - 16*i, H - 16*i);
  }

  const btnSize = 70;
  const pad = 8;
  const startX = 12;
  const startY = 12;

  // Labels correspond to: [Build docks, Build hauler, Set route, Close]
  const labels = ['Docks', 'Hauler', 'Set route', 'Close'];

  const btns = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const x = startX + c * (btnSize + pad);
      const y = startY + r * (btnSize + pad);

      const g = scene.add.graphics();
      g.fillStyle(0x173b52, 1);
      g.fillRoundedRect(x, y, btnSize, btnSize, 8);
      g.lineStyle(2, 0x6fe3ff, 0.7);
      g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
      g.lineStyle(1, 0x6fe3ff, 0.15);
      g.beginPath();
      g.moveTo(x + btnSize/2, y + 6);
      g.lineTo(x + btnSize/2, y + btnSize - 6);
      g.moveTo(x + 6, y + btnSize/2);
      g.lineTo(x + btnSize - 6, y + btnSize/2);
      g.strokePath();

      const label = scene.add.text(x + btnSize/2, y + btnSize/2, labels[r*2 + c], {
        fontSize: '18px',
        color: '#e8f6ff'
      }).setOrigin(0.5).setDepth(1);

      const hit = scene.add.rectangle(x, y, btnSize, btnSize, 0x000000, 0)
        .setOrigin(0,0)
        .setInteractive({ useHandCursor: true });

      hit.on('pointerover', () => {
        g.clear();
        g.fillStyle(0x1a4764, 1);
        g.fillRoundedRect(x, y, btnSize, btnSize, 8);
        g.lineStyle(2, 0x9be4ff, 1);
        g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
      });
      hit.on('pointerout', () => {
        g.clear();
        g.fillStyle(0x173b52, 1);
        g.fillRoundedRect(x, y, btnSize, btnSize, 8);
        g.lineStyle(2, 0x6fe3ff, 0.7);
        g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
        g.lineStyle(1, 0x6fe3ff, 0.15);
        g.beginPath();
        g.moveTo(x + btnSize/2, y + 6);
        g.lineTo(x + btnSize/2, y + btnSize - 6);
        g.moveTo(x + 6, y + btnSize/2);
        g.lineTo(x + btnSize - 6, y + btnSize/2);
        g.strokePath();
      });

      btns.push({ g, hit, label });
      panel.add([g, label, hit]);
    }
  }

  panel.add([bg, bezel]);
  panel.sendToBack(bg);
  panel.sendToBack(bezel);

  // Expose simple API on the scene
  scene.showUnitPanel = () => { panel.visible = true; };
  scene.hideUnitPanel = () => { panel.visible = false; };

  scene.unitActionPanel = panel;
  scene.unitPanelButtons = btns; // [Docks, Hauler, Set route, Close]
}

/* =========================
   Path preview & selection UI
   ========================= */

// local helper, same as in WorldScene
function getTile(scene, q, r) {
  return (scene.mapData || []).find(h => h.q === q && h.r === r);
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
 * Sets up unit selection + path preview + movement
 * (moved from WorldScene into UI layer)
 */
export function setupWorldInputUI(scene) {
  // ensure arrays for preview are present
  scene.pathPreviewTiles = scene.pathPreviewTiles || [];
  scene.pathPreviewLabels = scene.pathPreviewLabels || [];

  scene.input.on('pointerdown', pointer => {
    if (scene.isDragging) return;

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) return;

    // Select unit: look in players (red mobile base + others),
    // plus haulers if present.
    const clickedUnit =
      (scene.players || []).find(u => u.q === rounded.q && u.r === rounded.r) ||
      scene.haulers?.find?.(h => h.q === rounded.q && h.r === rounded.r);

    if (clickedUnit) {
      scene.selectedUnit = clickedUnit;
      scene.showUnitPanel?.(clickedUnit);
      scene.clearPathPreview?.();
      scene.selectedHex = null;
      scene.debugHex?.(rounded.q, rounded.r);
      return;
    }

    const tile = getTile(scene, rounded.q, rounded.r);
    if (tile && tile.isLocation) {
      console.log(`[LOCATION] Clicked on location: ${tile.locationType || 'Unknown'} at (${rounded.q},${rounded.r})`);
    }

    scene.selectedHex = rounded;
    scene.debugHex?.(rounded.q, rounded.r);

    if (scene.selectedUnit) {
      if (scene.selectedUnit.q === rounded.q && scene.selectedUnit.r === rounded.r) {
        scene.selectedUnit = null;
        scene.hideUnitPanel?.();
        scene.clearPathPreview?.();
      } else {
        const blocked = t => !t || t.type === 'water' || t.type === 'mountain';
        const fullPath = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);
        if (fullPath && fullPath.length > 1) {
          let movementPoints = scene.selectedUnit.movementPoints || 4;
          const trimmedPath = [];
          let costSum = 0;
          for (let i = 0; i < fullPath.length; i++) {
            const step = fullPath[i];
            const tile2 = getTile(scene, step.q, step.r);
            const cost = tile2?.movementCost || 1;
            if (i > 0 && costSum + cost > movementPoints) break;
            trimmedPath.push(step);
            if (i > 0) costSum += cost;
          }

          if (trimmedPath.length > 1) {
            console.log('[MOVE] Committing move along path:', trimmedPath);
            scene.startStepMovement?.(scene.selectedUnit, trimmedPath, () => {
              if (scene.checkCombat?.(scene.selectedUnit, trimmedPath[trimmedPath.length - 1])) {
                scene.scene.start('CombatScene', {
                  seed: scene.seed,
                  playerUnit: scene.selectedUnit,
                });
              } else {
                scene.syncPlayerMove?.(scene.selectedUnit);
              }
            });
          }
        }
      }
    }
  });

  scene.input.on('pointermove', pointer => {
    if (scene.isDragging) return;
    if (!scene.selectedUnit || scene.isUnitMoving) return;

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      scene.clearPathPreview?.();
      return;
    }

    const blocked = t => !t || t.type === 'water' || t.type === 'mountain';
    const path = computePathWithAStar(scene, scene.selectedUnit, rounded, blocked);

    scene.clearPathPreview?.();
    if (path && path.length > 1) {
      let movementPoints = scene.selectedUnit.movementPoints || 4;
      let costSum = 0;
      const maxPath = [];

      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;

        if (i > 0 && costSum + cost > movementPoints) break;
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
          fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(51);
        scene.pathPreviewLabels.push(label);
      }
    }
  });

  scene.input.on('pointerout', () => {
    scene.clearPathPreview?.();
  });
}
