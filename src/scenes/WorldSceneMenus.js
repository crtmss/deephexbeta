// src/scenes/WorldSceneMenus.js
//
// LEGACY MENU REMOVAL:
// The old 3x2 "Build/Close" menu (Buildings/Units/Infra/Energy) is removed.
// All actions are migrated to the new Unit Panel UI.
//
// We keep:
// - attachSelectionHighlight(scene)  -> selection ring/hex outline
//
// We keep compatibility stubs:
// - setupWorldMenus(scene) defines no-op functions that other code may call
//   (openRootUnitMenu, openUnitBuildMenu, closeAllMenus, etc.)
//   so nothing crashes while we migrate UI modules one by one.

export function setupWorldMenus(scene) {
  if (!scene) return;

  // Keep placeholder so old code "if (scene.unitMenu)" checks won't crash.
  scene.unitMenu = null;

  // Compatibility stubs (NO-OP)
  scene.openRootUnitMenu = function (_selection) {};
  scene.openUnitBuildMenu = function (_selection) {};
  scene.closeUnitBuildMenu = function () {};
  scene.refreshUnitMenuView = function () {};
  scene.closeAllMenus = function () {};

  // Some code might reference this too.
  scene.unitMenuOverlay = null;
}

/**
 * Selection highlight attached to the scene.
 * Used by WorldScene.setSelectedUnit / history hex inspect / etc.
 */
export function attachSelectionHighlight(scene) {
  if (!scene) return;

  const size = scene.hexSize || 24;
  const g = scene.add.graphics().setDepth(1900);
  g.visible = false;

  scene.selectionHighlight = g;

  scene.updateSelectionHighlight = function () {
    try {
      const unit = scene.selectedUnit;
      const building = scene.selectedBuilding;
      const target = unit || building;

      // Hex selection is allowed only when no unit/building is selected
      const hex = (!target && scene.selectedHex) ? scene.selectedHex : null;

      if (!target && !hex) {
        g.clear();
        g.visible = false;
        return;
      }

      const pos = target
        ? scene.axialToWorld(target.q, target.r)
        : scene.axialToWorld(hex.q, hex.r);

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
    } catch (_e) {
      g.clear();
      g.visible = false;
    }
  };
}

export default {
  setupWorldMenus,
  attachSelectionHighlight,
};
