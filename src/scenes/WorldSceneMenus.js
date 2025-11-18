// src/scenes/WorldSceneMenus.js

import {
  startDocksPlacement,
  placeDocks,
  cancelPlacement,
} from './WorldSceneBuildings.js';

import {
  buildHaulerAtSelectedUnit,
} from './WorldSceneHaulers.js';

/**
 * Data-driven menu definitions.
 * Each menu has 6 slots (3 x 2). Empty label = disabled button.
 */
const MENUS = {
  main: {
    slots: [
      { label: 'Build', action: 'open:build' },
      { label: '',      action: null },
      { label: '',      action: null },
      { label: 'Close', action: 'close' },
      { label: '',      action: null },
      { label: '',      action: null },
    ]
  },

  build: {
    slots: [
      { label: 'Buildings',      action: 'open:buildings' },
      { label: 'Units',          action: 'open:units' },
      { label: 'Infrastructure', action: 'open:infra' },
      { label: 'Back',           action: 'back' },
      { label: '',               action: null },
      { label: '',               action: null },
    ]
  },

  buildings: {
    slots: [
      { label: 'Docks',   action: 'build:docks' },
      { label: 'Mine',    action: 'build:mine' },
      { label: 'Factory', action: 'build:factory' },
      { label: '',        action: null },
      { label: '',        action: null },
      { label: 'Back',    action: 'back' },
    ]
  },

  units: {
    slots: [
      { label: 'Hauler', action: 'unit:hauler' },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: 'Back',   action: 'back' },
    ]
  },

  infra: {
    slots: [
      { label: 'Road',   action: 'infra:road' },
      { label: 'Bridge', action: 'infra:bridge' },
      { label: 'Canal',  action: 'infra:canal' },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: 'Back',   action: 'back' },
    ]
  },
};

/* =========================================================
   Public API
   ========================================================= */

/**
 * Creates the 6-slot menu panel and wires menu navigation + actions.
 * Attaches the following to the scene:
 *  - scene.menuPanel
 *  - scene.menuButtons (array of 6)
 *  - scene.currentMenuId
 *  - scene.menuStack
 *  - scene.openRootUnitMenu(unit)
 *  - scene.closeAllMenus()
 */
export function setupWorldMenus(scene) {
  // --- Panel base ---
  const originX = 20;
  const originY = 164;

  const panel = scene.add.container(originX, originY)
    .setScrollFactor(0)
    .setDepth(2000);
  panel.visible = false;

  const W = 260;
  const H = 200;

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.92);
  bg.fillRoundedRect(0, 0, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, W, H, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  for (let i = 1; i <= 2; i++) {
    bezel.strokeRect(8 * i, 8 * i, W - 16 * i, H - 16 * i);
  }

  panel.add([bg, bezel]);

  // --- 6 buttons: 3 columns x 2 rows ---
  const btnSizeW = 70;
  const btnSizeH = 70;
  const padX = 12;
  const padY = 12;

  const cols = 3;
  const rows = 2;

  const startX = 12;
  const startY = 12;

  const btns = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = startX + c * (btnSizeW + padX);
      const y = startY + r * (btnSizeH + padY);

      const g = scene.add.graphics();
      drawButtonIdle(g, x, y, btnSizeW, btnSizeH);

      const label = scene.add.text(
        x + btnSizeW / 2,
        y + btnSizeH / 2,
        '',
        {
          fontSize: '16px',
          color: '#e8f6ff',
          align: 'center',
          wordWrap: { width: btnSizeW - 8 },
        }
      ).setOrigin(0.5).setDepth(1);

      const hit = scene.add.rectangle(
        x + btnSizeW / 2,
        y + btnSizeH / 2,
        btnSizeW,
        btnSizeH,
        0x000000,
        0
      )
        .setInteractive({ useHandCursor: true });

      // Hover state
      hit.on('pointerover', () => {
        if (!hit.active) return;
        drawButtonHover(g, x, y, btnSizeW, btnSizeH);
      });

      hit.on('pointerout', () => {
        if (!hit.active) return;
        drawButtonIdle(g, x, y, btnSizeW, btnSizeH);
      });

      // Click
      hit.on('pointerdown', (pointer) => {
        // prevent click from propagating to world click handler
        if (pointer?.event && typeof pointer.event.stopPropagation === 'function') {
          pointer.event.stopPropagation();
        }

        if (!hit.active) return;

        const menu = MENUS[scene.currentMenuId];
        if (!menu) return;
        const slot = menu.slots[idx];
        if (!slot || !slot.action) return;

        handleMenuAction(scene, slot.action);
      });

      panel.add([g, label, hit]);
      btns.push({ g, label, hit, x, y, w: btnSizeW, h: btnSizeH });
    }
  }

  scene.menuPanel = panel;
  scene.menuButtons = btns;
  scene.currentMenuId = null;
  scene.menuStack = [];

  // scene-level menu control
  scene.openRootUnitMenu = (unit) => {
    if (!unit) return;
    scene.menuStack = [];
    openMenu(scene, 'main');
  };

  scene.closeAllMenus = () => {
    panel.visible = false;
    scene.currentMenuId = null;
    scene.menuStack = [];
  };
}

/**
 * Simple selection highlight: call once from WorldScene.create(),
 * then WorldScene.setSelectedUnit() can call scene.updateSelectionHighlight().
 */
export function attachSelectionHighlight(scene) {
  const g = scene.add.graphics().setDepth(1500);
  scene.selectionHighlight = g;

  scene.updateSelectionHighlight = () => {
    g.clear();
    const u = scene.selectedUnit;
    if (!u) return;

    const pos = scene.axialToWorld(u.q, u.r);
    const size = scene.hexSize || 24;

    g.lineStyle(3, 0xffff00, 1);
    // You can replace this with a proper hex outline if desired
    g.strokeCircle(pos.x, pos.y, size * 0.9);
  };
}

/* =========================================================
   Internal helpers
   ========================================================= */

function drawButtonIdle(g, x, y, w, h) {
  g.clear();
  g.fillStyle(0x173b52, 1);
  g.fillRoundedRect(x, y, w, h, 8);
  g.lineStyle(2, 0x6fe3ff, 0.7);
  g.strokeRoundedRect(x, y, w, h, 8);
  g.lineStyle(1, 0x6fe3ff, 0.15);
  g.beginPath();
  g.moveTo(x + w / 2, y + 6);
  g.lineTo(x + w / 2, y + h - 6);
  g.moveTo(x + 6, y + h / 2);
  g.lineTo(x + w - 6, y + h / 2);
  g.strokePath();
}

function drawButtonHover(g, x, y, w, h) {
  g.clear();
  g.fillStyle(0x1a4764, 1);
  g.fillRoundedRect(x, y, w, h, 8);
  g.lineStyle(2, 0x9be4ff, 1);
  g.strokeRoundedRect(x, y, w, h, 8);
}

/**
 * Open a given menu by ID, updating all 6 buttons.
 */
function openMenu(scene, id) {
  const def = MENUS[id];
  if (!def) return;

  scene.currentMenuId = id;
  scene.menuPanel.visible = true;

  const slots = def.slots || [];

  scene.menuButtons.forEach((btn, index) => {
    const slot = slots[index];
    const labelText = slot?.label || '';
    const active = !!slot?.action && !!labelText;

    btn.label.setText(labelText);
    btn.hit.active = active;
    btn.hit.input && (btn.hit.input.enabled = active);

    if (!active) {
      // visually "disabled"
      btn.g.clear();
      btn.g.fillStyle(0x101b28, 0.7);
      btn.g.fillRoundedRect(btn.x, btn.y, btn.w, btn.h, 8);
      btn.g.lineStyle(1, 0x3a4a5c, 0.6);
      btn.g.strokeRoundedRect(btn.x, btn.y, btn.w, btn.h, 8);
    } else {
      drawButtonIdle(btn.g, btn.x, btn.y, btn.w, btn.h);
    }
  });
}

/**
 * Top-level action dispatcher.
 * Supports:
 *  - 'close'
 *  - 'back'
 *  - 'open:<menuId>'
 *  - 'build:<type>'
 *  - 'unit:<type>'
 *  - 'infra:<type>'
 */
function handleMenuAction(scene, action) {
  if (!action) return;

  if (action === 'close') {
    scene.closeAllMenus?.();
    return;
  }

  if (action === 'back') {
    const prev = scene.menuStack.pop();
    if (prev) {
      openMenu(scene, prev);
    } else {
      scene.closeAllMenus?.();
    }
    return;
  }

  if (action.startsWith('open:')) {
    const target = action.split(':')[1];
    if (scene.currentMenuId) {
      scene.menuStack.push(scene.currentMenuId);
    }
    openMenu(scene, target);
    return;
  }

  if (action.startsWith('build:')) {
    handleBuildAction(scene, action.split(':')[1]);
    return;
  }

  if (action.startsWith('unit:')) {
    handleUnitAction(scene, action.split(':')[1]);
    return;
  }

  if (action.startsWith('infra:')) {
    handleInfraAction(scene, action.split(':')[1]);
    return;
  }
}

/* ---------- Concrete build / unit / infra actions ---------- */

function handleBuildAction(scene, kind) {
  const unit = scene.selectedUnit;
  if (!unit) return;

  switch (kind) {
    case 'docks': {
      const tile = (scene.mapData || []).find(t => t.q === unit.q && t.r === unit.r);
      if (!tile) return;

      if (!isCoastalTile(scene, tile)) {
        // silently ignore or log
        console.log('[BUILD] Docks: current hex is not coastal, doing nothing.');
        return;
      }

      // Make sure scene knows where we are
      scene.selectedHex = { q: unit.q, r: unit.r };

      // Try to be compatible with existing signatures:
      // (scene) or (scene, hex) or (scene, q,r)
      try {
        startDocksPlacement?.(scene, { q: unit.q, r: unit.r });
      } catch (e) {
        console.warn('startDocksPlacement error:', e);
      }

      try {
        placeDocks?.(scene, { q: unit.q, r: unit.r });
      } catch (e) {
        console.warn('placeDocks error:', e);
      }

      break;
    }

    case 'mine':
    case 'factory':
      // No-op for now, but kept for future implementation
      console.log('[BUILD]', kind, 'not implemented yet.');
      break;

    default:
      break;
  }
}

function handleUnitAction(scene, kind) {
  const unit = scene.selectedUnit;
  if (!unit) return;

  switch (kind) {
    case 'hauler':
      try {
        buildHaulerAtSelectedUnit?.(scene, unit);
      } catch (e) {
        console.warn('buildHaulerAtSelectedUnit error:', e);
      }
      break;

    default:
      console.log('[UNIT]', kind, 'not implemented yet.');
      break;
  }
}

function handleInfraAction(scene, kind) {
  // Not implemented yet; just log requests
  console.log('[INFRA] Requested', kind, 'at unit hex – not implemented yet.');
}

/* ---------- Coastal detection helper ---------- */

/**
 * A tile is considered coastal if:
 *  - It is not water itself
 *  - At least one adjacent tile is water
 */
function isCoastalTile(scene, tile) {
  if (!tile) return false;
  if (!scene.mapData) return false;

  if (String(tile.type).toLowerCase() === 'water') return false;

  const neighbors = getNeighbors(scene, tile.q, tile.r);
  for (const n of neighbors) {
    const t = scene.mapData.find(h => h.q === n.q && h.r === n.r);
    if (t && String(t.type).toLowerCase() === 'water') {
      return true;
    }
  }
  return false;
}

/**
 * Neighbor helper based on row-parity, matching your enemy movement.
 */
function getNeighbors(scene, q, r) {
  const W = scene.mapWidth ?? 25;
  const H = scene.mapHeight ?? 25;

  const dirsEven = [
    { dq: +1, dr: 0 }, { dq: 0, dr: -1 }, { dq: -1, dr: -1 },
    { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
  ];
  const dirsOdd = [
    { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
    { dq: -1, dr: 0 }, { dq: 0, dr: +1 }, { dq: +1, dr: +1 },
  ];
  const dirs = (r & 1) ? dirsOdd : dirsEven;

  const res = [];
  for (const d of dirs) {
    const nq = q + d.dq;
    const nr = r + d.dr;
    if (nq >= 0 && nr >= 0 && nq < W && nr < H) {
      res.push({ q: nq, r: nr });
    }
  }
  return res;
}
