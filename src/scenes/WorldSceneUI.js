// deephexbeta/src/scenes/WorldSceneUI.js

import { refreshUnits } from './WorldSceneActions.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { setupLogisticsUI } from './WorldSceneLogistics.js';

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

/* ---------------- Turn UI + top tabs ---------------- */
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

  // Top-right tabs (Resources / Logistics) + panels
  createTopTabs(scene);
  createResourcesPanel(scene);
  setupLogisticsUI(scene); // hook up logistics panel + helpers
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
   Top-right tab bar (Resources / Logistics)
   ========================= */

function createTopTabs(scene) {
  const margin = 16;
  const tabWidth = 140;
  const tabHeight = 40;
  const spacing = 12;

  const totalWidth = tabWidth * 2 + spacing;
  const x = scene.scale.width - totalWidth - margin;
  const y = 16;

  const bar = scene.add.container(x, y).setScrollFactor(0).setDepth(2100);

  // Green strip background
  const bg = scene.add.graphics();
  bg.fillStyle(0x2e7d32, 1);
  bg.fillRoundedRect(0, 0, totalWidth, tabHeight + 8, 8);
  bar.add(bg);

  const makeTab = (label, index, onClick) => {
    const tx = index * (tabWidth + spacing);
    const ty = 4;

    const outer = scene.add.graphics();
    const text = scene.add.text(
      tx + tabWidth / 2,
      ty + tabHeight / 2,
      label,
      {
        fontSize: '16px',
        color: '#ffffff',
      }
    ).setOrigin(0.5);

    const hit = scene.add.rectangle(tx, ty, tabWidth, tabHeight, 0x000000, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });

    const drawState = (active) => {
      outer.clear();
      outer.fillStyle(active ? 0x3da9fc : 0x000000, 1);
      outer.fillRoundedRect(tx, ty, tabWidth, tabHeight, 6);
      text.setColor(active ? '#ffffff' : '#dddddd');
    };

    drawState(false);

    hit.on('pointerdown', (pointer, lx, ly, event) => {
      event?.stopPropagation?.();
      onClick?.();
    });

    bar.add([outer, text, hit]);

    return { outer, text, hit, drawState };
  };

  const tabs = {};

  tabs.resources = makeTab('Resources', 0, () => {
    scene.openResourcesPanel?.();
    scene.closeLogisticsPanel?.();
    scene.setActiveTopTab?.('resources');
  });

  tabs.logistics = makeTab('Logistics', 1, () => {
    scene.openLogisticsPanel?.();
    scene.closeResourcesPanel?.();
    scene.setActiveTopTab?.('logistics');
  });

  scene.topTabs = { container: bar, tabs };

  // Helper to update active/inactive visuals
  scene.setActiveTopTab = function (which) {
    const t = scene.topTabs?.tabs;
    if (!t) return;
    Object.entries(t).forEach(([key, tab]) => {
      tab.drawState?.(key === which);
    });
  };
}

/* =========================
   Resources Panel (table-style)
   ========================= */

function createResourcesPanel(scene) {
  // Positioned under the top tabs, on the right side
  const panelX = scene.scale.width - 520;   // width 500 + margin
  const panelY = 70;

  const container = scene.add.container(panelX, panelY)
    .setScrollFactor(0)
    .setDepth(2050);

  container.visible = false;

  const WIDTH = 500;
  const HEIGHT = 220; // fixed for now; enough for several rows

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.96);
  bg.fillRoundedRect(0, 0, WIDTH, HEIGHT, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, WIDTH, HEIGHT, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  bezel.strokeRect(10, 10, WIDTH - 20, HEIGHT - 20);
  bezel.strokeRect(18, 18, WIDTH - 36, HEIGHT - 36);

  container.add([bg, bezel]);

  // Column definitions
  // Building | Food | Scrap | Energy | Metal plates | Components | Currency
  const cols = [
    { key: 'name',       label: 'Building',    width: 130 },
    { key: 'food',       label: 'Food',        width: 55 },
    { key: 'scrap',      label: 'Scrap',       width: 55 },
    { key: 'energy',     label: 'Energy',      width: 65 },
    { key: 'metal',      label: 'Metal',       width: 70 }, // "Metal plates"
    { key: 'components', label: 'Components',  width: 85 },
    { key: 'currency',   label: 'Currency',    width: 70 },
  ];

  const startX = 20;
  const startY = 24;
  const rowHeight = 20;

  let xCursor = startX;
  cols.forEach(col => {
    col.x = xCursor;
    const header = scene.add.text(
      xCursor,
      startY,
      col.label,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e8f6ff',
      }
    ).setOrigin(0, 0);
    header.setScrollFactor(0);
    container.add(header);
    xCursor += col.width;
  });

  // We keep created row texts so they can be destroyed on refresh
  const meta = {
    container,
    columns: cols,
    rowTexts: [],
    headerY: startY,
    rowHeight,
  };

  scene.resourcesPanel = container;
  scene.resourcesPanelMeta = meta;

  // Public helpers on scene:

  scene.refreshResourcesPanel = function () {
    const m = scene.resourcesPanelMeta;
    if (!m) return;

    // Clear previous row texts
    m.rowTexts.forEach(t => t.destroy());
    m.rowTexts.length = 0;

    const buildings = scene.buildings || [];
    buildings.forEach((b, idx) => {
      const y = m.headerY + m.rowHeight * (idx + 1);

      // derive a display name
      const baseName = b.displayName || b.name || (b.type ? b.type[0].toUpperCase() + b.type.slice(1) : 'Building');
      const suffix = typeof b.id !== 'undefined' ? ` ${b.id}` : ` ${idx + 1}`;
      const dispName = baseName + suffix;

      const res = b.resources || {};
      const rowValues = {
        name: dispName,
        food:       res.food       ?? b.storageFood ?? 0,
        scrap:      res.scrap      ?? 0,
        energy:     res.energy     ?? 0,
        metal:      res.metal      ?? res.metalPlates ?? 0,
        components: res.components ?? 0,
        currency:   res.currency   ?? 0,
      };

      m.columns.forEach(col => {
        const val = rowValues[col.key] ?? 0;
        const txt = scene.add.text(
          col.x,
          y,
          String(val),
          {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#e8f6ff',
          }
        ).setOrigin(0, 0);
        txt.setScrollFactor(0);
        m.container.add(txt);
        m.rowTexts.push(txt);
      });
    });
  };

  scene.openResourcesPanel = function () {
    scene.resourcesPanel.visible = true;
    scene.refreshResourcesPanel?.();
    scene.closeLogisticsPanel?.();
  };

  scene.closeResourcesPanel = function () {
    if (scene.resourcesPanel) scene.resourcesPanel.visible = false;
  };
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
  const players = scene.players || [];
  const haulers = scene.haulers || [];
  return (
    players.find(u => u.q === q && u.r === r) ||
    haulers.find(h => h.q === q && h.r === r) ||
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
 * Sets up unit selection + path preview + movement
 */
export function setupWorldInputUI(scene) {
  // ensure arrays for preview are present
  scene.pathPreviewTiles = scene.pathPreviewTiles || [];
  scene.pathPreviewLabels = scene.pathPreviewLabels || [];

  scene.input.on('pointerdown', pointer => {
    if (scene.isDragging) return;
    if (pointer.rightButtonDown && pointer.rightButtonDown()) return;

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) return;

    const { q, r } = rounded;

    // First, check if there's a unit on this hex and toggle selection.
    const unitAtHex = getUnitAtHex(scene, q, r);
    if (unitAtHex) {
      scene.toggleSelectedUnitAtHex?.(q, r);
      scene.clearPathPreview?.();
      scene.selectedHex = null;
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
