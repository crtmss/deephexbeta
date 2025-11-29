// src/scenes/WorldSceneBuildingsUI.js
// ---------------------------------------------------------------------------
// Building UI (docks, factories, etc.)
// - Context menus that appear when clicking on buildings.
// - Separated from Logistics panel / economy logic.
// - Attach via setupBuildingsUI(scene) inside WorldScene.create().
// ---------------------------------------------------------------------------

/**
 * Call this once from your WorldScene.create():
 *   import { setupBuildingsUI } from './WorldSceneBuildingsUI.js';
 *   setupBuildingsUI(this);
 */
export function setupBuildingsUI(scene) {
  // Single container per scene
  scene.buildingMenuContainer = null;

  /**
   * Close and destroy the current building context menu, if any.
   */
  scene.closeBuildingMenu = function () {
    if (scene.buildingMenuContainer) {
      scene.buildingMenuContainer.destroy();
      scene.buildingMenuContainer = null;
    }
  };

  /**
   * Open a context menu for a given building (dock, factory, etc.).
   * Building is expected to have at least:
   *   - type (string)
   *   - q, r (axial coords) for positioning (optional but recommended)
   */
  scene.openBuildingMenu = function (building) {
    if (!building) return;

    // Replace any previous menu
    scene.closeBuildingMenu();

    const cam = scene.cameras.main;

    // --- Screen-space anchor position (defaults) ---
    let screenX = 40;
    let screenY = 260;

    if (scene.axialToWorld && Number.isInteger(building.q) && Number.isInteger(building.r)) {
      // Convert building hex to world, then to screen
      const p = scene.axialToWorld(building.q, building.r);
      screenX = p.x - cam.scrollX + 24;
      screenY = p.y - cam.scrollY + 24;
    }

    // --- Container fixed to camera ---
    const container = scene.add
      .container(screenX, screenY)
      .setScrollFactor(0)
      .setDepth(3000);
    scene.buildingMenuContainer = container;

    const BUTTON_WIDTH  = 170;
    const BUTTON_HEIGHT = 26;
    const BUTTON_GAP    = 6;

    // --- Background plate ---
    const bgWidth  = BUTTON_WIDTH + 30;
    const bgHeight = BUTTON_HEIGHT * 4 + BUTTON_GAP * 6 + 16; // header + padding

    const bg = scene.add.graphics();
    bg.fillStyle(0x071824, 0.96);
    bg.fillRoundedRect(0, 0, bgWidth, bgHeight, 10);
    bg.lineStyle(1, 0x3da9fc, 0.9);
    bg.strokeRoundedRect(0, 0, bgWidth, bgHeight, 10);
    container.add(bg);

    // --- Header (building name) ---
    const title = buildDisplayName(building);
    const headerText = scene.add.text(
      bgWidth / 2,
      10,
      title,
      {
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#e8f6ff',
      }
    ).setOrigin(0.5, 0);
    container.add(headerText);

    // --- Button definitions, by building type ---
    const t = (building.type || '').toLowerCase();

    /** @type {{label:string, onClick: (null|Function)}[]} */
    let buttons;

    if (t === 'factory') {
      buttons = [
        {
          label: 'Change production',
          onClick: () => {
            // Hook your real factory production UI here.
            if (typeof scene.changeFactoryProduction === 'function') {
              scene.changeFactoryProduction(building);
            } else {
              console.log('[FACTORY] Change production for', building);
            }
          }
        },
        {
          label: 'Destroy',
          onClick: () => {
            if (typeof scene.destroyBuilding === 'function') {
              scene.destroyBuilding(building);
            } else {
              console.log('[FACTORY] Destroy building', building);
            }
            scene.closeBuildingMenu();
          }
        },
        { label: '', onClick: null },
        { label: '', onClick: null },
      ];
    } else if (t === 'dock' || t === 'docks') {
      buttons = [
        {
          label: 'Load / Unload',
          onClick: () => {
            if (typeof scene.handleDockLoadUnload === 'function') {
              scene.handleDockLoadUnload(building);
            } else {
              console.log('[DOCK] Load / Unload for', building);
            }
          }
        },
        {
          label: 'Destroy',
          onClick: () => {
            if (typeof scene.destroyBuilding === 'function') {
              scene.destroyBuilding(building);
            } else {
              console.log('[DOCK] Destroy building', building);
            }
            scene.closeBuildingMenu();
          }
        },
        { label: '', onClick: null },
        { label: '', onClick: null },
      ];
    } else {
      // Fallback for any future building types
      buttons = [
        {
          label: 'Details',
          onClick: () => {
            console.log('[BUILDING] Details for', building);
          }
        },
        {
          label: 'Destroy',
          onClick: () => {
            if (typeof scene.destroyBuilding === 'function') {
              scene.destroyBuilding(building);
            } else {
              console.log('[BUILDING] Destroy', building);
            }
            scene.closeBuildingMenu();
          }
        },
        { label: '', onClick: null },
        { label: '', onClick: null },
      ];
    }

    // --- Build buttons ---
    let yCursor = 26; // below header

    buttons.forEach((btn, idx) => {
      yCursor += BUTTON_GAP;

      const hasLabel = !!btn.label;
      const x = 15;
      const y = yCursor;

      const plate = scene.add.graphics();
      if (hasLabel) {
        plate.fillStyle(0x12324a, 0.95);
        plate.fillRoundedRect(x, y, BUTTON_WIDTH, BUTTON_HEIGHT, 6);
        plate.lineStyle(1, 0x3da9fc, 0.7);
        plate.strokeRoundedRect(x, y, BUTTON_WIDTH, BUTTON_HEIGHT, 6);
      }
      container.add(plate);

      const text = scene.add.text(
        x + BUTTON_WIDTH / 2,
        y + BUTTON_HEIGHT / 2,
        btn.label,
        {
          fontSize: '13px',
          color: '#e8f6ff',
        }
      ).setOrigin(0.5);
      container.add(text);

      const hit = scene.add.rectangle(
        x + BUTTON_WIDTH / 2,
        y + BUTTON_HEIGHT / 2,
        BUTTON_WIDTH,
        BUTTON_HEIGHT,
        0x000000,
        0
      );
      hit.setInteractive({ useHandCursor: !!btn.onClick });
      container.add(hit);

      if (btn.onClick) {
        hit.on('pointerdown', (pointer, lx, ly, event) => {
          event?.stopPropagation?.();
          btn.onClick();
        });

        hit.on('pointerover', () => {
          plate.alpha = 1.0;
        });
        hit.on('pointerout', () => {
          plate.alpha = 0.95;
        });
      } else {
        // Blank slot: keep it inert and invisible
        plate.alpha = 0;
        text.visible = false;
      }

      yCursor += BUTTON_HEIGHT;
    });

    // --- Close helpers ---
    // ESC closes menu
    scene.input.keyboard?.once('keydown-ESC', () => {
      scene.closeBuildingMenu();
    });
  };

  // -------------------------------------------------------------------------
  // Legacy compatibility: if some code still calls openDockMenu / openFactoryMenu
  // -------------------------------------------------------------------------
  scene.openDockMenu = function (building) {
    scene.openBuildingMenu(building);
  };
  scene.openFactoryMenu = function (building) {
    scene.openBuildingMenu(building);
  };
}

/**
 * Helper to build a nice display name for the menu header.
 */
function buildDisplayName(building) {
  const base =
    building.displayName ||
    building.name ||
    (building.type
      ? building.type.charAt(0).toUpperCase() + building.type.slice(1)
      : 'Building');

  if (typeof building.id !== 'undefined') {
    return `${base} #${building.id}`;
  }
  if (Number.isInteger(building.q) && Number.isInteger(building.r)) {
    return `${base} (${building.q},${building.r})`;
  }
  return base;
}

export default {
  setupBuildingsUI,
};
