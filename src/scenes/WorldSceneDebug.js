// src/scenes/WorldSceneDebug.js
//
// Debug UI for manipulating global water level.
//
// Usage in your WorldScene:
//   import { initDebugMenu } from './WorldSceneDebug.js';
//   ...
//   create() {
//     ...
//     initDebugMenu.call(this);
//   }

import { drawHexMap } from "./WorldSceneMap.js";

function applyWaterLevel(scene, newLevel) {
  // Clamp water level between 0 and 7 (your elevation range)
  const level = Phaser.Math.Clamp(newLevel, 0, 7);
  scene.waterLevel = level;

  const tiles = scene.mapData || [];
  for (const t of tiles) {
    if (typeof t.elevation !== "number") continue;
    // Covered by water if elevation <= current water level
    t.isCoveredByWater = t.elevation <= level;
  }

  // Redraw map with updated water overlay
  drawHexMap.call(scene);
}

export function initDebugMenu() {
  /** @type {Phaser.Scene & any} */
  const scene = this;

  if (!scene || !Array.isArray(scene.mapData)) return;

  // initial water level if not set yet
  if (typeof scene.waterLevel !== "number") {
    scene.waterLevel = 3; // default starting water level
  }

  const cam = scene.cameras.main;
  const menuDepth = 10000;
  const optionSpacing = 8;

  const options = [
    {
      label: "Remove water",
      action: () => applyWaterLevel(scene, 0),
    },
    {
      label: "Water +1",
      action: () => applyWaterLevel(scene, scene.waterLevel + 1),
    },
    {
      label: "Water -1",
      action: () => applyWaterLevel(scene, scene.waterLevel - 1),
    },
    {
      label: "Fill lvl 3",
      action: () => applyWaterLevel(scene, 3),
    },
  ];

  // Container that will sit at the top center
  const container = scene.add.container(0, 0).setDepth(menuDepth);
  scene.debugMenuContainer = container;

  let xCursor = 0;
  const texts = [];

  options.forEach((opt, idx) => {
    const txt = scene.add
      .text(0, 0, opt.label, {
        fontSize: "14px",
        fontFamily: 'Arial, "Segoe UI", sans-serif',
        color: "#ffffff",
        backgroundColor: "#00000088",
        padding: { x: 6, y: 3 },
      })
      .setInteractive({ useHandCursor: true })
      .on("pointerup", () => opt.action());

    txt.x = xCursor;
    txt.y = 0;
    xCursor += txt.width + optionSpacing;

    container.add(txt);
    texts.push(txt);
  });

  const totalWidth = xCursor - optionSpacing;

  // position: top-center of the main camera
  const recenter = () => {
    const midX = cam.midPoint.x;
    container.x = midX - totalWidth / 2;
    container.y = 8; // small margin from top
  };

  recenter();

  // if your game resizes, keep menu centered
  scene.scale?.on("resize", recenter);
}

export default {
  initDebugMenu,
};
