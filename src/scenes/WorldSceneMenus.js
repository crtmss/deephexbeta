// src/scenes/WorldSceneMenus.js

import {
  startDocksPlacement,
  placeDocks,
  cancelPlacement,
} from './WorldSceneBuildings.js';

import {
  buildHaulerAtSelectedUnit,
} from './WorldSceneHaulers.js';

/* =========================================================
   Selection highlight
   ========================================================= */

/**
 * Draws a yellow ring under the currently selected unit.
 * Exposes scene.updateSelectionHighlight().
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
    g.strokeCircle(pos.x, pos.y, size * 0.9);
  };
}

/* =========================================================
   Menu layout definition (6 slots: 3x2)
   ========================================================= */

const MENUS = {
  // existing main/build/buildings/units/infra...

  harbor: {
    id: 'harbor',
    title: 'Harbor',
    slots: [
      { label: 'Build ship',    action: 'ship:build' },
      { label: '',              action: null },
      { label: 'Set route',     action: 'ship:setRoute' },
      { label: 'Recall ships',  action: 'ship:recall' },
      { label: 'Destroy',       action: 'ship:destroy' },
      { label: 'Close',         action: 'close' },
    ],
  },

  // Build category
  build: {
    id: 'build',
    title: 'Build',
    slots: [
      { label: 'Buildings',      action: 'open:buildings' },
      { label: 'Units',          action: 'open:units' },
      { label: 'Infrastructure', action: 'open:infra' },
      { label: 'Back',           action: 'back' },
      { label: '',               action: null },
      { label: '',               action: null },
    ],
  },

  // Buildings
buildings: {
  id: 'buildings',
  title: 'Buildings',
  slots: [
    { label: 'Docks',   action: 'build:docks' },
    { label: 'Mine',    action: 'build:mine' },
    { label: 'Factory', action: 'build:factory' },
    { label: 'Bunker',  action: 'build:bunker' },
    { label: '',        action: null },
    { label: 'Back',    action: 'back' },
  ],
},

  // Units
  units: {
    id: 'units',
    title: 'Units',
    slots: [
      { label: 'Hauler', action: 'unit:hauler' },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: 'Back',   action: 'back' },
    ],
  },

  // Infrastructure
  infra: {
    id: 'infra',
    title: 'Infrastructure',
    slots: [
      { label: 'Road',   action: 'infra:road' },
      { label: 'Bridge', action: 'infra:bridge' },
      { label: 'Canal',  action: 'infra:canal' },
      { label: '',       action: null },
      { label: '',       action: null },
      { label: 'Back',   action: 'back' },
    ],
  },
};

/* =========================================================
   Menu creation & wiring
   ========================================================= */

/**
 * Creates the 6-button menu panel and exposes:
 *  - scene.menuPanel
 *  - scene.menuButtons
 *  - scene.currentMenuId
 *  - scene.menuStack
 *  - scene.openRootUnitMenu(unit)
 *  - scene.closeAllMenus()
 */
export function setupWorldMenus(scene) {
  const panel = scene.add.container(20, 164).setScrollFactor(0).setDepth(2000);
  panel.visible = false;

  const W = 260;
  const H = 200;

  // Background
  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.95);
  bg.fillRoundedRect(0, 0, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, W, H, 12);
  panel.add(bg);

  // Title label
  const titleText = scene.add.text(W / 2, 18, 'Menu', {
    fontSize: '16px',
    color: '#e8f6ff',
  }).setOrigin(0.5, 0.5);
  panel.add(titleText);

  // 3x2 grid of buttons
  const btns = [];
  const cols = 3;
  const rows = 2;

  const btnWidth = 70;
  const btnHeight = 52;

  const padX = 12;
  const padY = 10;

  const gridOriginX = 16;
  const gridOriginY = 40;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = gridOriginX + c * (btnWidth + padX);
      const y = gridOriginY + r * (btnHeight + padY);

      const g = scene.add.graphics();
      g.fillStyle(0x173b52, 1);
      g.fillRoundedRect(x, y, btnWidth, btnHeight, 8);
      g.lineStyle(2, 0x6fe3ff, 0.7);
      g.strokeRoundedRect(x, y, btnWidth, btnHeight, 8);

      const label = scene.add.text(
        x + btnWidth / 2,
        y + btnHeight / 2,
        '',
        {
          fontSize: '15px',
          color: '#e8f6ff',
          align: 'center',
          wordWrap: { width: btnWidth - 8 },
        }
      ).setOrigin(0.5);

      const hit = scene.add.rectangle(
        x + btnWidth / 2,
        y + btnHeight / 2,
        btnWidth,
        btnHeight,
        0x000000,
        0
      ).setInteractive({ useHandCursor: true });

      // Hover effects
      hit.on('pointerover', () => {
        g.clear();
        g.fillStyle(0x1a4764, 1);
        g.fillRoundedRect(x, y, btnWidth, btnHeight, 8);
        g.lineStyle(2, 0x9be4ff, 1);
        g.strokeRoundedRect(x, y, btnWidth, btnHeight, 8);
      });

      hit.on('pointerout', () => {
        g.clear();
        g.fillStyle(0x173b52, 1);
        g.fillRoundedRect(x, y, btnWidth, btnHeight, 8);
        g.lineStyle(2, 0x6fe3ff, 0.7);
        g.strokeRoundedRect(x, y, btnWidth, btnHeight, 8);
      });

      // Click handler – action will be resolved via menu data
      hit.on('pointerdown', () => {
        const slot = btns[idx];
        if (!slot || !slot.action) return;
        handleMenuAction(scene, slot.action);
      });

      panel.add(g);
      panel.add(label);
      panel.add(hit);

      btns[idx] = {
        bg: g,
        label,
        hit,
        action: null,
      };
    }
  }

  // Expose on scene
  scene.menuPanel = panel;
  scene.menuButtons = btns;
  scene.menuTitleText = titleText;
  scene.currentMenuId = null;
  scene.menuStack = [];

  /**
   * Called by WorldScene.setSelectedUnit(unit)
   */
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

/* =========================================================
   Menu state helpers
   ========================================================= */

function openMenu(scene, menuId) {
  const def = MENUS[menuId];
  if (!def) return;

  scene.currentMenuId = menuId;
  scene.menuPanel.visible = true;

  if (scene.menuTitleText) {
    scene.menuTitleText.setText(def.title || '');
  }

  applyMenuLayout(scene, def);
}

function applyMenuLayout(scene, def) {
  const btns = scene.menuButtons || [];
  const slots = def.slots || [];

  for (let i = 0; i < btns.length; i++) {
    const btn = btns[i];
    const slot = slots[i];

    if (!slot || !slot.label) {
      btn.label.setText('');
      btn.action = null;
      btn.hit.disableInteractive();
      continue;
    }

    btn.label.setText(slot.label);
    btn.action = slot.action || null;
    btn.hit.setInteractive({ useHandCursor: true });
  }
}

/* =========================================================
   Action dispatcher
   ========================================================= */

function handleMenuAction(scene, action) {
  if (!action) return;

  // Navigation
  if (action === 'close') {
    scene.closeAllMenus?.();
    return;
  }

  if (action === 'back') {
    if (scene.menuStack.length > 0) {
      const prev = scene.menuStack.pop();
      openMenu(scene, prev);
    } else {
      scene.closeAllMenus?.();
    }
    return;
  }

  if (action.startsWith('open:')) {
    const target = action.split(':')[1];
    if (MENUS[target]) {
      if (scene.currentMenuId) {
        scene.menuStack.push(scene.currentMenuId);
      }
      openMenu(scene, target);
    }
    return;
  }

  // Build actions
  if (action.startsWith('build:')) {
    const kind = action.split(':')[1];
    handleBuildAction(scene, kind);
    return;
  }

  // Unit actions
  if (action.startsWith('unit:')) {
    const kind = action.split(':')[1];
    handleUnitAction(scene, kind);
    return;
  }

  // Infrastructure actions
  if (action.startsWith('infra:')) {
    const kind = action.split(':')[1];
    handleInfraAction(scene, kind);
    return;
  }
}

/* =========================================================
   Build / Unit / Infra action handlers
   ========================================================= */

function handleBuildAction(scene, kind) {
  const unit = scene.selectedUnit;
  if (!unit) return;

  switch (kind) {
    case 'docks': {
      const tile = (scene.mapData || []).find(
        t => t.q === unit.q && t.r === unit.r
      );
      if (!tile) return;

      if (!isCoastalTile(scene, tile)) {
        console.log('[BUILD] Docks: current hex is not coastal, doing nothing.');
        return;
      }

      // Old building code expects to read this.selectedHex and this.playerResources
      scene.selectedHex = { q: unit.q, r: unit.r };

      try {
        // IMPORTANT: bind `this` correctly so _ensureResourceInit can read this.playerResources
        startDocksPlacement?.call(scene);
      } catch (e) {
        console.warn('startDocksPlacement error:', e);
      }

      try {
        placeDocks?.call(scene);
      } catch (e) {
        console.warn('placeDocks error:', e);
      }

      try {
        cancelPlacement?.call(scene);
      } catch (e) {
        console.warn('cancelPlacement error:', e);
      }

      break;
    }

    case 'mine':
    case 'factory':
      console.log('[BUILD]', kind, 'not implemented yet.');
      break;

    default:
      console.log('[BUILD] Unknown build kind:', kind);
      break;
  }
}

function handleBuildAction(scene, kind) {
  const unit = scene.selectedUnit;
  if (!unit) return;

  switch (kind) {
    case 'docks':
      // (already wired as now; using .call(scene))
      ...
      break;

    case 'mine':
      scene.selectedHex = { q: unit.q, r: unit.r };
      placeMine?.call(scene);
      break;

    case 'factory':
      scene.selectedHex = { q: unit.q, r: unit.r };
      placeFactory?.call(scene);
      break;

    case 'bunker':
      scene.selectedHex = { q: unit.q, r: unit.r };
      placeBunker?.call(scene);
      break;

    default:
      console.log('[BUILD] Unknown build kind:', kind);
      break;
  }
}

function handleInfraAction(scene, kind) {
  // Placeholder: you can wire actual road/bridge/canal placement later
  console.log('[INFRA] Requested', kind, 'at unit hex – not implemented yet.');
}

/* =========================================================
   Map helpers (coastal check etc.)
   ========================================================= */

function getNeighborsAxial(q, r, width, height) {
  const dirsEven = [
    { dq: +1, dr: 0 }, { dq: 0, dr: -1 }, { dq: -1, dr: -1 },
    { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
  ];
  const dirsOdd = [
    { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
    { dq: -1, dr: 0 }, { dq: 0, dr: +1 }, { dq: +1, dr: +1 },
  ];
  const dirs = (r & 1) ? dirsOdd : dirsEven;

  const result = [];
  for (const d of dirs) {
    const nq = q + d.dq;
    const nr = r + d.dr;
    if (nq < 0 || nr < 0 || nq >= width || nr >= height) continue;
    result.push({ q: nq, r: nr });
  }
  return result;
}

function isCoastalTile(scene, tile) {
  if (!tile) return false;
  if (!scene.mapData) return false;

  // If tile itself is water, we don't build docks "on the sea".
  if (tile.type === 'water') return false;

  const W = scene.mapWidth ?? 25;
  const H = scene.mapHeight ?? 25;

  const { q, r } = tile;
  const neighbors = getNeighborsAxial(q, r, W, H);
  return neighbors.some(n => {
    const t = scene.mapData.find(h => h.q === n.q && h.r === n.r);
    return t && t.type === 'water';
  });
}
