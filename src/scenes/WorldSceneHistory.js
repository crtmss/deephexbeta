// src/scenes/WorldSceneHistory.js
//
// History panel UI.
// - Sits near the top-right corner, visually similar to the resources panel.
// - Panel is hidden by default and can be toggled with a "History" button.
// - Renders chronological entries from scene.historyEntries (year + text).
// - Now bigger, scrollable, and spaced out for readability.

/**
 * Create the History panel and toggle button.
 * Call once from WorldScene.create().
 * @param {Phaser.Scene & any} scene
 */
export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  // 200% bigger than original: width & height x2
  const panelWidth = 520;
  const panelHeight = 440;

  const rightAnchor = cam.width - margin;
  const panelX = rightAnchor - panelWidth * 2 - 16; // leave space for resources panel
  const panelY = margin + 28; // a bit under the top edge

  // --- History panel container ---
  const container = scene.add.container(panelX, panelY);
  container.setScrollFactor(0);
  container.setDepth(1900); // above map, below some HUD if needed

  // Background
  const bg = scene.add.graphics();
  bg.fillStyle(0x050f1a, 0.92);
  bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 8);
  bg.lineStyle(1, 0x34d2ff, 0.9);
  bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 8);

  // Title
  const title = scene.add.text(
    10,
    8,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#d0f2ff',
    }
  );

  // Scrollable text area
  const TEXT_TOP = 36;
  const TEXT_LEFT = 14;
  const TEXT_WIDTH = panelWidth - TEXT_LEFT * 2;
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
  );

  // Mask for scrollable area
  const maskGraphics = scene.add.graphics();
  maskGraphics.fillStyle(0xffffff, 1);
  maskGraphics.fillRect(
    TEXT_LEFT - 2,
    TEXT_TOP - 2,
    TEXT_WIDTH + 4,
    panelHeight - TEXT_TOP - TEXT_BOTTOM_PADDING
  );
  const textMask = maskGraphics.createGeometryMask();
  entriesText.setMask(textMask);

  container.add([bg, title, entriesText, maskGraphics]);
  container.setVisible(false); // closed by default

  // Store refs on scene
  scene.historyPanelContainer = container;
  scene.historyPanelText = entriesText;
  scene.historyTextBaseY = TEXT_TOP;
  scene.historyScrollOffset = 0;
  scene.historyPanelHeight = panelHeight;
  scene.historyPanelInnerHeight = panelHeight - TEXT_TOP - TEXT_BOTTOM_PADDING;
  scene.isHistoryPanelOpen = false;

  // --- Toggle button ("History") ---
  const buttonWidth = 96;
  const buttonHeight = 26;
  const btnX = panelX; // align left edge of panel
  const btnY = margin; // just under top edge

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
    .setDepth(1901)
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
    .setDepth(1902);

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

  // Expose helpers on scene for other modules (if they want to use them)
  scene.openHistoryPanel = () => openHistoryPanel(scene);
  scene.closeHistoryPanel = () => closeHistoryPanel(scene);
  scene.refreshHistoryPanel = () => refreshHistoryPanel(scene);

  // Scroll with mouse wheel when panel is open
  scene.input.on('wheel', (_pointer, _gameObjects, _dx, dy) => {
    if (!scene.isHistoryPanelOpen || !scene.historyPanelText) return;

    const step = 30; // scroll speed
    scene.historyScrollOffset -= Math.sign(dy) * step;
    refreshHistoryPanel(scene);
  });

  // Initial refresh so UI shows a sensible placeholder
  refreshHistoryPanel(scene);
}

/**
 * Show the History panel.
 * @param {Phaser.Scene & any} scene
 */
export function openHistoryPanel(scene) {
  if (!scene.historyPanelContainer) return;
  scene.isHistoryPanelOpen = true;
  scene.historyPanelContainer.setVisible(true);
  refreshHistoryPanel(scene);
}

/**
 * Hide the History panel.
 * @param {Phaser.Scene & any} scene
 */
export function closeHistoryPanel(scene) {
  if (!scene.historyPanelContainer) return;
  scene.isHistoryPanelOpen = false;
  scene.historyPanelContainer.setVisible(false);
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
    scene.historyPanelText.y = scene.historyTextBaseY || 36;
    return;
  }

  // Extra spacing between entries and slightly more verbose format if needed
  const lines = entries.map(e => {
    const year = typeof e.year === 'number' ? e.year : 5000;
    const text = e.text || '';
    return `${year} – ${text}`;
  });

  // Double newline = spaced chronology
  scene.historyPanelText.setText(lines.join('\n\n'));

  // Scroll handling
  const baseY = scene.historyTextBaseY || 36;
  const visibleHeight = scene.historyPanelInnerHeight || 300;
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
