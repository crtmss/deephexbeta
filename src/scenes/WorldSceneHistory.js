// src/scenes/WorldSceneHistory.js
//
// Simple History panel UI.
// - Sits near the top-right corner, visually similar to the resources panel.
// - Panel is hidden by default and can be toggled with a "History" button.
// - Renders chronological entries from scene.historyEntries (year + text).

/**
 * Create the History panel and toggle button.
 * Call once from WorldScene.create().
 * @param {Phaser.Scene & any} scene
 */
export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  // Approximate layout: to the left of resources panel (which is top-right).
  // We assume resources panel roughly takes ~260px width on the far right.
  const panelWidth = 260;
  const panelHeight = 220;

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
    6,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#d0f2ff',
    }
  );

  // Entries text
  const entriesText = scene.add.text(
    10,
    26,
    'No events recorded yet.',
    {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#a8c7e6',
      wordWrap: { width: panelWidth - 20 },
      lineSpacing: 2,
    }
  );

  container.add([bg, title, entriesText]);
  container.setVisible(false); // closed by default

  // Store refs on scene
  scene.historyPanelContainer = container;
  scene.historyPanelText = entriesText;
  scene.isHistoryPanelOpen = false;

  // --- Toggle button ("History") ---
  const buttonWidth = 80;
  const buttonHeight = 22;
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
    btnX + 8,
    btnY + 4,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '11px',
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
 * Update the History panel text from scene.historyEntries.
 * @param {Phaser.Scene & any} scene
 */
export function refreshHistoryPanel(scene) {
  if (!scene.historyPanelText) return;

  const entries = Array.isArray(scene.historyEntries)
    ? scene.historyEntries.slice().sort((a, b) => (a.year || 0) - (b.year || 0))
    : [];

  if (entries.length === 0) {
    scene.historyPanelText.setText('No events recorded yet.');
    return;
  }

  const lines = entries.map(e => {
    const year = typeof e.year === 'number' ? e.year : 5000;
    const text = e.text || '';
    return `${year} – ${text}`;
  });

  scene.historyPanelText.setText(lines.join('\n'));
}
