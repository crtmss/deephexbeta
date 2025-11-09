// deephexbeta/src/scenes/WorldSceneUI.js

import { refreshUnits } from './WorldSceneActions.js';

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
  // Expose update/bump so game logic can adjust HUD
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
   RESOURCE HUD (NEW)
   ========================= */
function createResourceHUD(scene) {
  // Visual style
  const plateColor = 0x0f2233;
  const strokeColor = 0x3da9fc;

  const originX = 20;
  const originY = 16;

  const panel = scene.add.container(originX, originY).setScrollFactor(0).setDepth(2000);

  // Background plate
  const W = 280, H = 34;
  const bg = scene.add.graphics();
  bg.fillStyle(plateColor, 0.92);
  bg.fillRoundedRect(0, 0, W, H, 10);
  bg.lineStyle(2, strokeColor, 0.9);
  bg.strokeRoundedRect(0, 0, W, H, 10);

  panel.add(bg);

  // Entries: emoji + value text, always shown even if 0
  const items = [
    { key: 'food',      emoji: '🍖', label: 'Food' },
    { key: 'scrap',     emoji: '🛠', label: 'Scrap' },
    { key: 'money',     emoji: '💰', label: 'Money' },
    { key: 'influence', emoji: '⭐', label: 'Inf' },
  ];

  const gap = 66; // horizontal spacing between entries
  const startX = 12; // padding from left
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

  // Always display a value, even when zero
  if (entries.food)      entries.food.txt.setText(String(r.food ?? 0));
  if (entries.scrap)     entries.scrap.txt.setText(String(r.scrap ?? 0));
  if (entries.money)     entries.money.txt.setText(String(r.money ?? 0));
  if (entries.influence) entries.influence.txt.setText(String(r.influence ?? 0));
}

function bumpResource(scene, key) {
  if (!scene.resourceHUD || !scene.resourceHUD.entries) return;
  const entry = scene.resourceHUD.entries[key];
  if (!entry) return;

  // Small scale bump on both icon and text
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
   Unit Action Panel (kept)
   ========================= */
function createUnitActionPanel(scene) {
  // Container position (fixed UI, under Refresh)
  const originX = 20;
  const originY = 164;

  const panel = scene.add.container(originX, originY).setScrollFactor(0).setDepth(2000);
  panel.visible = false;

  // Sci-fi plate background
  const W = 172, H = 172;
  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.92);              // deep blue plate
  bg.fillRoundedRect(0, 0, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);               // neon edge
  bg.strokeRoundedRect(0, 0, W, H, 12);

  // Futuristic inner grid bezel
  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  for (let i = 1; i <= 2; i++) {
    bezel.strokeRect(8*i, 8*i, W - 16*i, H - 16*i);
  }

  // 2x2 square buttons
  const btnSize = 70; // square
  const pad = 8;
  const startX = 12;
  const startY = 12;

  const labels = ['Docks', 'B', 'C', 'D']; // replace B/C/D later with real actions

  const btns = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const x = startX + c * (btnSize + pad);
      const y = startY + r * (btnSize + pad);

      const g = scene.add.graphics();
      // button body
      g.fillStyle(0x173b52, 1);
      g.fillRoundedRect(x, y, btnSize, btnSize, 8);
      // subtle border glow
      g.lineStyle(2, 0x6fe3ff, 0.7);
      g.strokeRoundedRect(x, y, btnSize, btnSize, 8);
      // crosshair lines
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

      // NOTE: no audio here (removes "ui-click" error). Hook your actions externally.
      // Example: in WorldScene.js you can attach:
      // scene.unitPanelButtons[0].on('pointerdown', () => scene.startDocksPlacement());

      btns.push({ g, hit, label });
      panel.add([g, label, hit]);
    }
  }

  panel.add([bg, bezel]);
  panel.sendToBack(bg);
  panel.sendToBack(bezel);

  // Expose simple API on the scene
  scene.showUnitPanel = (unit) => {
    panel.visible = true;
  };
  scene.hideUnitPanel = () => {
    panel.visible = false;
  };

  // Expose buttons so WorldScene can attach handlers (e.g., Docks)
  scene.unitActionPanel = panel;
  scene.unitPanelButtons = btns; // array of 4 hit areas in order
}
