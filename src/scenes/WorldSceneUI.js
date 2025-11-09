// deephexbeta/src/scenes/WorldSceneUI.js

import { refreshUnits } from './WorldSceneActions.js';
import {
  startDocksPlacement,
  buildHaulerAtSelectedUnit,
  enterHaulerRoutePicker
} from './WorldSceneBuildings.js';

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
  scene.turnText = scene.add.text(20, 20, 'Player Turn: ...', {
    fontSize: '18px',
    fill: '#e8f6ff',
    backgroundColor: '#133046',
    padding: { x: 10, y: 5 }
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.endTurnButton = scene.add.text(20, 50, 'End Turn', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#3da9fc',
    padding: { x: 10, y: 5 }
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.endTurnButton.on('pointerdown', () => {
    scene.endTurn();
  });

  scene.refreshButton = scene.add.text(20, 85, 'Refresh', {
    fontSize: '18px',
    fill: '#fff',
    backgroundColor: '#444',
    padding: { x: 10, y: 5 }
  }).setScrollFactor(0).setDepth(100).setInteractive();

  scene.refreshButton.on('pointerdown', () => {
    refreshUnits(scene);
  });

  // Unit Action Panel (left UI)
  createUnitActionPanel(scene);
}

export function updateTurnText(scene, currentTurn) {
  if (scene.turnText) {
    scene.turnText.setText('Player Turn: ' + currentTurn);
  }
}

/* =========================
   Unit Action Panel (2x2)
   ========================= */
function createUnitActionPanel(scene) {
  // Container position (fixed UI, below your Refresh)
  const originX = 20;
  const originY = 130;

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

  // Final labels and handlers:
  const labels = ['Docks', 'Hauler', 'Set Route', '—'];
  const handlers = [
    () => startDocksPlacement.call(scene),
    () => buildHaulerAtSelectedUnit.call(scene),
    () => enterHaulerRoutePicker.call(scene),
    () => {} // reserved
  ];

  const btns = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const idx = r * 2 + c;
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

      const label = scene.add.text(x + btnSize/2, y + btnSize/2, labels[idx], {
        fontSize: '16px',
        color: '#e8f6ff',
        align: 'center',
        wordWrap: { width: btnSize - 8 }
      }).setOrigin(0.5).setDepth(1);

      // hit-area for clicks / hover
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

      hit.on('pointerdown', () => {
        // no sound play (avoid missing key error)
        const fn = handlers[idx];
        try { fn && fn(); } catch (e) { console.error(e); }
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
}
