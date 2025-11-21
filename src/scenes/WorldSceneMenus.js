// src/scenes/WorldSceneMenus.js

import {
  startDocksPlacement,
  placeMineAtSelectedHex,
  placeFactoryAtSelectedHex,
  placeBuildingUnderMobileBase,
} from './WorldSceneBuildings.js';

import {
  buildHaulerAtSelectedUnit,
} from './WorldSceneHaulers.js';

/**
 * Data-driven menu definitions.
 * Each menu has 6 slots (3 x 2). Empty label = disabled button.
 *
 * NOTE: labels now include emojis + costs where applicable.
 */
const MENUS = {
  root: {
    slots: [
      { label: 'Build', action: 'open:build' },
      { label: '',      action: null },
      { label: '',      action: null },
      { label: 'Close', action: 'close' },
      { label: '',      action: null },
      { label: '',      action: null },
    ],
  },

  build: {
    slots: [
      { label: 'Buildings',      action: 'open:buildings' },
      { label: 'Units',          action: 'open:units' },
      { label: 'Infrastructure', action: 'open:infra' },
      { label: 'Back',           action: 'back' },
      { label: '',               action: null },
      { label: '',               action: null },
    ],
  },

  /**
   * Buildings submenu: 3×2
   *  [0] Docks (⚓)
   *  [1] Mine (⛏️)
   *  [2] Factory (🏭)
   *  [3] Bunker (🛡️)
   *  [4] —
   *  [5] Back
   *
   * Costs are shown in the label text:
   *  - Docks:   🛠20 💰50
   *  - Mine:    🛠30 💰40
   *  - Factory: 🛠50 💰80
   *  - Bunker:  🛠40 💰60
   *
   * These must match the COSTS in WorldSceneBuildings.js.
   */
  buildings: {
    slots: [
      { label: '⚓ Docks\n🛠20 💰50',      action: 'build:docks'   },
      { label: '⛏️ Mine\n🛠30 💰40',      action: 'build:mine'    },
      { label: '🏭 Factory\n🛠50 💰80',    action: 'build:factory' },
      { label: '🛡️ Bunker\n🛠40 💰60',    action: 'build:bunker'  },
      { label: '',                         action: null           },
      { label: 'Back',                     action: 'back'         },
    ],
  },

  /**
   * Units submenu: 3×2
   *  [0] Hauler
   *  [5] Back
   *
   * Hauler cost:
   *  - 🍖10 (matches buildHaulerAtSelectedUnit in WorldSceneHaulers.js)
   */
  units: {
    slots: [
      { label: '🚚 Hauler\n🍖10', action: 'unit:hauler' },
      { label: '',                action: null          },
      { label: '',                action: null          },
      { label: '',                action: null          },
      { label: '',                action: null          },
      { label: 'Back',            action: 'back'        },
    ],
  },

  infra: {
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

/**
 * Creates the unit/build menu (3x2 buttons) and wires up behaviour.
 * Called once from WorldScene.create().
 */
export function setupWorldMenus(scene) {
  const originX = 20;
  const originY = 164;

  // -------- Screen overlay to absorb clicks while menu is open --------
  const overlay = scene.add.rectangle(
    0, 0,
    scene.scale.width,
    scene.scale.height,
    0x000000,
    0.001
  )
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(3950)
    .setInteractive({ useHandCursor: false });

  overlay.visible = false;

  overlay.on('pointerdown', (pointer, lx, ly, event) => {
    // swallow clicks & close menu
    event?.stopPropagation?.();
    scene.closeAllMenus?.();
  });

  // -------- Menu container --------
  const container = scene.add.container(originX, originY)
    .setDepth(4000)
    .setScrollFactor(0);

  container.visible = false;

  const W = 260;
  const H = 172;

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.92);
  bg.fillRoundedRect(0, 0, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, W, H, 12);
  bg.setScrollFactor(0);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  for (let i = 1; i <= 2; i++) {
    bezel.strokeRect(8 * i, 8 * i, W - 16 * i, H - 16 * i);
  }
  bezel.setScrollFactor(0);

  container.add([bg, bezel]);
  container.sendToBack(bg);
  container.sendToBack(bezel);

  const btnWidth = 70;
  const btnHeight = 70;
  const pad = 8;
  const cols = 3;
  const rows = 2;
  const startX = 12;
  const startY = 12;

  const buttons = [];

  const makeButton = (sx, sy) => {
    const g = scene.add.graphics();
    g.fillStyle(0x173b52, 1);
    g.fillRoundedRect(sx, sy, btnWidth, btnHeight, 8);
    g.lineStyle(2, 0x6fe3ff, 0.7);
    g.strokeRoundedRect(sx, sy, btnWidth, btnHeight, 8);
    g.lineStyle(1, 0x6fe3ff, 0.15);
    g.beginPath();
    g.moveTo(sx + btnWidth / 2, sy + 6);
    g.lineTo(sx + btnWidth / 2, sy + btnHeight - 6);
    g.moveTo(sx + 6, sy + btnHeight / 2);
    g.lineTo(sx + btnWidth - 6, sy + btnHeight / 2);
    g.strokePath();
    g.setScrollFactor(0);

    const label = scene.add.text(
      sx + btnWidth / 2,
      sy + btnHeight / 2,
      '',
      {
        fontSize: '16px',
        color: '#e8f6ff',
        align: 'center',
        wordWrap: { width: btnWidth - 10 },
      }
    ).setOrigin(0.5);
    label.setScrollFactor(0);

    const hit = scene.add.rectangle(sx, sy, btnWidth, btnHeight, 0x000000, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    hit.setScrollFactor(0);

    container.add([g, label, hit]);

    return { g, label, hit, baseX: sx, baseY: sy };
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (btnWidth + pad);
      const y = startY + r * (btnHeight + pad);
      const btn = makeButton(x, y);
      buttons.push(btn);
    }
  }

  // Menu state stored on the scene
  scene.unitMenu = {
    container,
    buttons,
    currentMenuKey: 'root',
    stack: [],
  };

  const handleButtonClick = (index) => {
    const menuKey = scene.unitMenu.currentMenuKey;
    const def = MENUS[menuKey];
    if (!def) return;

    const slot = def.slots[index];
    if (!slot || !slot.action) return;

    handleMenuAction(scene, slot.action);
  };

  buttons.forEach((btn, idx) => {
    const clickHandler = (pointer, lx, ly, event) => {
      event?.stopPropagation?.();
      handleButtonClick(idx);
    };

    btn.hit.on('pointerdown', clickHandler);
    btn.label.setInteractive({ useHandCursor: true });
    btn.label.on('pointerdown', clickHandler);

    btn.hit.on('pointerover', () => {
      btn.g.clear();
      btn.g.fillStyle(0x1a4764, 1);
      btn.g.fillRoundedRect(btn.baseX, btn.baseY, btnWidth, btnHeight, 8);
      btn.g.lineStyle(2, 0x9be4ff, 1);
      btn.g.strokeRoundedRect(btn.baseX, btn.baseY, btnWidth, btnHeight, 8);
      btn.g.setScrollFactor(0);
    });

    const drawDefault = () => {
      btn.g.clear();
      btn.g.fillStyle(0x173b52, 1);
      btn.g.fillRoundedRect(btn.baseX, btn.baseY, btnWidth, btnHeight, 8);
      btn.g.lineStyle(2, 0x6fe3ff, 0.7);
      btn.g.strokeRoundedRect(btn.baseX, btn.baseY, btnWidth, btnHeight, 8);
      btn.g.lineStyle(1, 0x6fe3ff, 0.15);
      btn.g.beginPath();
      btn.g.moveTo(btn.baseX + btnWidth / 2, btn.baseY + 6);
      btn.g.lineTo(btn.baseX + btnWidth / 2, btn.baseY + btnHeight - 6);
      btn.g.moveTo(btn.baseX + 6, btn.baseY + btnHeight / 2);
      btn.g.lineTo(btn.baseX + btnWidth - 6, btn.baseY + btnHeight / 2);
      btn.g.strokePath();
      btn.g.setScrollFactor(0);
    };

    btn.hit.on('pointerout', drawDefault);
    drawDefault(); // initial
  });

  // Helper to refresh visual state when menu or labels change
  scene.refreshUnitMenuView = function () {
    const menuKey = scene.unitMenu.currentMenuKey;
    const def = MENUS[menuKey];
    if (!def) {
      scene.unitMenu.container.visible = false;
      overlay.visible = false;
      overlay.disableInteractive();
      return;
    }

    def.slots.forEach((slot, i) => {
      const btn = scene.unitMenu.buttons[i];
      if (!btn) return;

      const label = slot?.label || '';
      const enabled = !!slot?.action && label !== '';

      btn.label.setText(label);
      btn.label.setAlpha(enabled ? 1 : 0.4);
      btn.g.setAlpha(enabled ? 1 : 0.3);

      if (enabled) {
        btn.hit.setInteractive({ useHandCursor: true });
        btn.label.setInteractive({ useHandCursor: true });
      } else {
        if (btn.hit.input) btn.hit.disableInteractive();
        if (btn.label.input) btn.label.disableInteractive();
      }
    });
  };

  // Public helpers used by WorldScene.setSelectedUnit / setSelectedBuilding
  scene.openRootUnitMenu = function (selection) {
    // selection can be a unit OR a building
    scene.menuContextSelection = selection || null;
    scene.unitMenu.stack = ['root'];
    scene.unitMenu.currentMenuKey = 'root';
    scene.unitMenu.container.visible = true;

    overlay.visible = true;
    overlay.setInteractive({ useHandCursor: false });

    scene.refreshUnitMenuView();
    // bring menu above everything
    scene.children.bringToTop(container);
  };

  scene.closeAllMenus = function () {
    if (scene.unitMenu) {
      scene.unitMenu.container.visible = false;
    }
    overlay.visible = false;
    if (overlay.input) {
      overlay.disableInteractive();
    }
  };

  // expose overlay in case other modules need to tweak it
  scene.unitMenuOverlay = overlay;
}

/**
 * Handle a menu action string like:
 *  - "open:build"
 *  - "build:docks"
 *  - "build:mine"
 *  - "build:factory"
 *  - "build:bunker"
 *  - "unit:hauler"
 *  - "infra:road"
 */
function handleMenuAction(scene, action) {
  if (!action) return;

  const [kind, arg] = action.split(':');

  if (kind === 'open') {
    const current = scene.unitMenu.currentMenuKey;
    scene.unitMenu.stack.push(current);
    scene.unitMenu.currentMenuKey = arg;
    scene.refreshUnitMenuView?.();
    return;
  }

  if (kind === 'back') {
    if (scene.unitMenu.stack.length > 0) {
      scene.unitMenu.currentMenuKey = scene.unitMenu.stack.pop();
      scene.refreshUnitMenuView?.();
    } else {
      scene.closeAllMenus?.();
    }
    return;
  }

  if (kind === 'close') {
    scene.closeAllMenus?.();
    return;
  }

  // Selected context can be a unit *or* a building
  const selection = scene.menuContextSelection || scene.selectedUnit || null;

  if (kind === 'build') {
    if (!selection) {
      console.warn('[MENU] No selection for build action:', arg);
      return;
    }
    switch (arg) {
      case 'docks':
        // place docks, usually at selected unit hex or override logic in WorldSceneBuildings
        startDocksPlacement.call(scene);
        break;
      case 'mine':
        placeMineAtSelectedHex?.call(scene);
        break;
      case 'factory':
        placeFactoryAtSelectedHex?.call(scene);
        break;
      case 'bunker':
        placeBunkerAtSelectedHex?.call(scene);
        break;
      default:
        console.warn('[MENU] Unknown build target:', arg);
        break;
    }
    return;
  }

  if (kind === 'unit') {
    if (!selection) {
      console.warn('[MENU] No selection for unit action:', arg);
      return;
    }
    switch (arg) {
      case 'hauler':
        buildHaulerAtSelectedUnit.call(scene);
        break;
      default:
        console.warn('[MENU] Unknown unit action:', arg);
        break;
    }
    return;
  }

  if (kind === 'infra') {
    switch (arg) {
      case 'road':
      case 'bridge':
      case 'canal':
        console.log('[MENU] Infrastructure action (not yet implemented):', arg);
        break;
      default:
        console.warn('[MENU] Unknown infrastructure action:', arg);
        break;
    }
  }
}

/**
 * Selection highlight attached to the scene.
 * WorldScene calls attachSelectionHighlight(this) during create(),
 * and then uses this.updateSelectionHighlight() whenever selection changes.
 *
 * Currently highlights the *selected unit* hex. If you want buildings
 * to be highlighted too, extend this to consider scene.selectedBuilding.
 */
export function attachSelectionHighlight(scene) {
  const size = scene.hexSize || 24;
  const g = scene.add.graphics().setDepth(1900);
  g.visible = false;
  g.setScrollFactor(0);

  scene.selectionHighlight = g;

  scene.updateSelectionHighlight = function () {
    // Prefer unit; could be extended to buildings as well
    const unit = scene.selectedUnit;
    const building = scene.selectedBuilding;

    const target = unit || building || null;

    if (!target) {
      g.clear();
      g.visible = false;
      return;
    }

    const pos = scene.axialToWorld(target.q, target.r);
    const x = pos.x;
    const y = pos.y;

    g.clear();
    g.lineStyle(3, 0xffff00, 1);

    const radius = size * 0.9;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i + Math.PI / 6; // 60° steps, rotated 30°
      const px = x + radius * Math.cos(angle);
      const py = y + radius * Math.sin(angle);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.strokePath();

    g.visible = true;
  };
}

export default {
  setupWorldMenus,
  attachSelectionHighlight,
};
