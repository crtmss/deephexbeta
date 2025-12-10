// src/scenes/WorldSceneHistory.js
//
// History panel UI.
// - Large, scrollable lore log.
// - Appears to the left of the Resources panel (if available).
// - Renders chronological entries from scene.historyEntries (year + text).

/**
 * Create the History panel and toggle button.
 * Call once from WorldScene.create().
 * @param {Phaser.Scene & any} scene
 */
export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  // Panel size (~200% of the first version)
  const panelWidth = 420;
  const panelHeight = 360;

  // Try to position relative to the resources panel if it exists
  let panelX;
  let panelY;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - panelWidth - 16;
    panelY = scene.resourcesPanel.y;
  } else {
    // Fallback: top-right area
    panelX = cam.width - margin - panelWidth - 260 - 16; // assume 260px for resources panel
    panelY = 70;
  }

  // Store geometry for later (scroll hit-test)
  scene.historyPanelX = panelX;
  scene.historyPanelY = panelY;
  scene.historyPanelWidth = panelWidth;
  scene.historyPanelHeight = panelHeight;

  // ----- Background -----
  const bg = scene.add.graphics();
  bg.setScrollFactor(0);
  bg.setDepth(1900);
  bg.fillStyle(0x050f1a, 0.92);
  bg.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 8);
  bg.lineStyle(1, 0x34d2ff, 0.9);
  bg.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 8);

  // ----- Title -----
  const title = scene.add.text(
    panelX + 12,
    panelY + 8,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#d0f2ff',
    }
  )
    .setScrollFactor(0)
    .setDepth(1901);

  // ----- Scrollable text area -----
  const TEXT_TOP = panelY + 36;
  const TEXT_LEFT = panelX + 14;
  const TEXT_WIDTH = panelWidth - 28;
  const TEXT_BOTTOM_PADDING = 12;

  const entriesText = scene.add.text(
    TEXT_LEFT,
    TEXT_TOP,
    'No events recorded yet.',
    {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#a8c7e6',
      wordWrap: { width: TEXT_WIDTH },
      lineSpacing: 4,
    }
  )
    .setScrollFactor(0)
    .setDepth(1901);

  // Mask for scrollable area (using world coordinates)
  const visibleHeight = panelHeight - (TEXT_TOP - panelY) - TEXT_BOTTOM_PADDING;
  const maskGraphics = scene.add.graphics();
  maskGraphics.setScrollFactor(0);
  maskGraphics.setDepth(1901);
  maskGraphics.fillStyle(0xffffff, 1);
  maskGraphics.fillRect(
    TEXT_LEFT - 2,
    TEXT_TOP - 2,
    TEXT_WIDTH + 4,
    visibleHeight + 4
  );
  const textMask = maskGraphics.createGeometryMask();
  entriesText.setMask(textMask);

  // ----- Scroll hitbox -----
  const scrollZone = scene.add.zone(
    panelX,
    panelY,
    panelWidth,
    panelHeight
  )
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(1902)
    .setInteractive(); // to ensure pointer events are tracked over it

  // Store refs on scene
  scene.historyPanelBg = bg;
  scene.historyPanelTitle = title;
  scene.historyPanelText = entriesText;
  scene.historyPanelMask = maskGraphics;
  scene.historyPanelScrollZone = scrollZone;

  scene.historyTextBaseY = TEXT_TOP;
  scene.historyVisibleHeight = visibleHeight;
  scene.historyScrollOffset = 0;
  scene.isHistoryPanelOpen = false;

  // ----- Toggle button ("History") -----
  const buttonWidth = 96;
  const buttonHeight = 26;
  const btnX = panelX; // align left edge of panel
  const btnY = panelY - buttonHeight - 6;

  const buttonBg = scene.add.rectangle(
    btnX + buttonWidth / 2,
    btnY + buttonHeight / 2,
    buttonWidth,
    buttonHeight,
    0x06121f,
    0.95
  )
    .setStrokeStyle(1, 0x34d2ff, 0.9)
    .setScrollFactor(0)
    .setDepth(1903)
    .setInteractive({ useHandCursor: true });

  const buttonLabel = scene.add.text(
    btnX + 10,
    btnY + 5,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#d0f2ff',
    }
  )
    .setScrollFactor(0)
    .setDepth(1904);

  buttonBg.on('pointerover', () => {
    buttonBg.setFillStyle(0x0b2338, 0.95);
  });

  buttonBg.on('pointerout', () => {
    buttonBg.setFillStyle(0x06121f, 0.95);
  });

  buttonBg.on('pointerup', () => {
    if (scene.isHistoryPanelOpen) {
      closeHistoryPanel(scene);
    } else {
      openHistoryPanel(scene);
    }
  });

  scene.historyButtonBg = buttonBg;
  scene.historyButtonLabel = buttonLabel;

  // Expose helpers on scene
  scene.openHistoryPanel = () => openHistoryPanel(scene);
  scene.closeHistoryPanel = () => closeHistoryPanel(scene);
  scene.refreshHistoryPanel = () => refreshHistoryPanel(scene);

  // Scroll with mouse wheel only when cursor is over the history panel
  scene.input.on('wheel', (pointer, _gameObjects, _dx, dy) => {
    if (!scene.isHistoryPanelOpen || !scene.historyPanelText) return;

    const px = pointer.x;
    const py = pointer.y;

    const x0 = scene.historyPanelX;
    const y0 = scene.historyPanelY;
    const x1 = x0 + scene.historyPanelWidth;
    const y1 = y0 + scene.historyPanelHeight;

    // Scroll only if cursor is inside the panel bounds
    if (px < x0 || px > x1 || py < y0 || py > y1) return;

    const step = 30;
    // Phaser wheel: dy > 0 → scroll down
    scene.historyScrollOffset -= Math.sign(dy) * step;
    refreshHistoryPanel(scene);
  });

  // Hide everything by default
  setHistoryPanelVisible(scene, false);

  // Initial refresh so UI shows a sensible placeholder
  refreshHistoryPanel(scene);
}

/**
 * Show the History panel.
 * @param {Phaser.Scene & any} scene
 */
export function openHistoryPanel(scene) {
  setHistoryPanelVisible(scene, true);
  scene.isHistoryPanelOpen = true;
  refreshHistoryPanel(scene);
}

/**
 * Hide the History panel.
 * @param {Phaser.Scene & any} scene
 */
export function closeHistoryPanel(scene) {
  setHistoryPanelVisible(scene, false);
  scene.isHistoryPanelOpen = false;
}

/**
 * Show/hide all history UI elements together.
 */
function setHistoryPanelVisible(scene, visible) {
  const elems = [
    scene.historyPanelBg,
    scene.historyPanelTitle,
    scene.historyPanelText,
    scene.historyPanelMask,
    scene.historyPanelScrollZone,
  ];
  elems.forEach(e => e && e.setVisible(visible));
}

/**
 * Update the History panel text from scene.historyEntries,
 * apply spacing between entries, and clamp scroll offset.
 * @param {Phaser.Scene & any} scene
 */
export function refreshHistoryPanel(scene) {
  if (!scene.historyPanelText) return;

  const entries = Array.isArray(scene.historyEntries)
    ? scene.historyEntries.slice().sort((a, b) => (a.year || 0) - (b.year || 0))
    : [];

  if (entries.length === 0) {
    scene.historyPanelText.setText('No events recorded yet.');
    scene.historyScrollOffset = 0;
    scene.historyPanelText.y = scene.historyTextBaseY || (scene.historyPanelY + 36);
    return;
  }

  // Extra spacing between entries
  const lines = entries.map(e => {
    const year = typeof e.year === 'number' ? e.year : 5000;
    const text = e.text || '';
    return `${year} – ${text}`;
  });

  scene.historyPanelText.setText(lines.join('\n\n'));

  const baseY = scene.historyTextBaseY || (scene.historyPanelY + 36);
  const visibleHeight = scene.historyVisibleHeight || 300;
  const contentHeight = scene.historyPanelText.height;

  // If content is smaller than view, reset scroll
  if (contentHeight <= visibleHeight) {
    scene.historyScrollOffset = 0;
    scene.historyPanelText.y = baseY;
    return;
  }

  const maxScroll = contentHeight - visibleHeight;
  // scrollOffset is negative when scrolled down
  if (scene.historyScrollOffset > 0) scene.historyScrollOffset = 0;
  if (scene.historyScrollOffset < -maxScroll) scene.historyScrollOffset = -maxScroll;

  scene.historyPanelText.y = baseY + scene.historyScrollOffset;
}
