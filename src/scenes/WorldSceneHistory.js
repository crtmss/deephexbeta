// src/scenes/WorldSceneHistory.js
// Scrollable, readable History panel.

export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  const panelWidth = 420;
  const panelHeight = 360;

  // Position to the left of Resources panel if possible
  let panelX = cam.width - margin - panelWidth - 260 - 20;
  let panelY = 70;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - panelWidth - 16;
    panelY = scene.resourcesPanel.y;
  }

  // --- Background ---
  const bg = scene.add.graphics();
  bg.fillStyle(0x07121f, 0.95);
  bg.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 8);
  bg.lineStyle(2, 0x34d2ff, 0.8);
  bg.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 8);
  bg.setScrollFactor(0).setDepth(2000);

  // --- Title ---
  const title = scene.add.text(
    panelX + 14,
    panelY + 10,
    "History",
    {
      fontSize: "17px",
      fontFamily: "monospace",
      color: "#d0f2ff",
    }
  ).setScrollFactor(0).setDepth(2001);

  // --- Scrollable TEXT ---
  const CONTENT_X = panelX + 14;
  const CONTENT_Y = panelY + 40;
  const CONTENT_W = panelWidth - 28;
  const CONTENT_H = panelHeight - 52;

  const text = scene.add.text(
    CONTENT_X,
    CONTENT_Y,
    "No events.",
    {
      fontSize: "14px",
      fontFamily: "monospace",
      color: "#b7d7ff",
      wordWrap: { width: CONTENT_W },
      lineSpacing: 6,
    }
  )
    .setDepth(2001)
    .setScrollFactor(0);

  // --- MASK (bitmap mask FIXES THE WHITE BOX BUG) ---
  const maskShape = scene.add.graphics();
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(CONTENT_X, CONTENT_Y, CONTENT_W, CONTENT_H);
  maskShape.setScrollFactor(0).setDepth(2002);
  maskShape.setVisible(false); // IMPORTANT

  const mask = maskShape.createBitmapMask();
  text.setMask(mask);

  // Save stuff in scene
  scene.historyPanel = { bg, title, text, maskShape };
  scene.historyPanelX = panelX;
  scene.historyPanelY = panelY;
  scene.historyPanelW = panelWidth;
  scene.historyPanelH = panelHeight;
  scene.historyContentY = CONTENT_Y;
  scene.historyScroll = 0;
  scene.isHistoryPanelOpen = false;

  // --- Toggle button ---
  const btn = scene.add.text(
    panelX,
    panelY - 28,
    "History",
    {
      fontSize: "15px",
      fontFamily: "monospace",
      color: "#d0f2ff",
      backgroundColor: "#092038",
      padding: { x: 8, y: 4 }
    }
  )
    .setScrollFactor(0)
    .setDepth(2003)
    .setInteractive();

  btn.on("pointerdown", () => {
    if (scene.isHistoryPanelOpen) {
      setHistoryPanelVisible(scene, false);
    } else {
      setHistoryPanelVisible(scene, true);
      refreshHistoryPanel(scene);
    }
  });

  scene.historyButton = btn;

  // --- Scroll wheel ---
  scene.input.on("wheel", (pointer, g, dx, dy) => {
    if (!scene.isHistoryPanelOpen) return;

    // Must be inside panel to scroll
    if (
      pointer.x < panelX || pointer.x > panelX + panelWidth ||
      pointer.y < panelY || pointer.y > panelY + panelHeight
    ) return;

    scene.historyScroll -= dy * 0.5; // scroll speed
    refreshHistoryPanel(scene);
  });

  // Start hidden
  setHistoryPanelVisible(scene, false);
}

export function setHistoryPanelVisible(scene, v) {
  const p = scene.historyPanel;
  if (!p) return;

  p.bg.setVisible(v);
  p.title.setVisible(v);
  p.text.setVisible(v);
  p.maskShape.setVisible(v);

  scene.isHistoryPanelOpen = v;
}

export function refreshHistoryPanel(scene) {
  if (!scene.historyPanel || !scene.historyEntries) return;

  const sorted = [...scene.historyEntries].sort((a, b) => a.year - b.year);

  const body = sorted
    .map(e => `${e.year} — ${e.text}`)
    .join("\n\n");

  const p = scene.historyPanel;
  p.text.setText(body || "No events yet.");

  // limit scrolling
  const contentHeight = p.text.height;
  const maxScroll = Math.max(0, contentHeight - (scene.historyPanelH - 60));

  if (scene.historyScroll < -maxScroll) scene.historyScroll = -maxScroll;
  if (scene.historyScroll > 0) scene.historyScroll = 0;

  p.text.y = scene.historyContentY + scene.historyScroll;
}
