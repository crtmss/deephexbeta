// src/scenes/WorldSceneHistory.js
//
// Large, scrollable History panel UI with proper text clipping.

export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  // Panel size
  const PANEL_WIDTH = 420;
  const PANEL_HEIGHT = 360;

  // Position: to the left of resources panel if present, otherwise top-left-ish.
  let panelX;
  let panelY;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - PANEL_WIDTH - 16;
    panelY = scene.resourcesPanel.y;
  } else {
    panelX = margin;
    panelY = 70;
  }

  const depthBase = 9000; // above almost everything

  // ---- Container that holds all visible parts ----
  const container = scene.add.container(panelX, panelY);
  container.setScrollFactor(0);
  container.setDepth(depthBase);

  // ---- Background ----
  const bg = scene.add.rectangle(
    0,
    0,
    PANEL_WIDTH,
    PANEL_HEIGHT,
    0x07121f,
    0.96
  )
    .setOrigin(0, 0);
  bg.setStrokeStyle(2, 0x34d2ff, 0.85);
  container.add(bg);

  // ---- Title ----
  const title = scene.add.text(
    12,
    8,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '17px',
      color: '#d0f2ff',
    }
  );
  container.add(title);

  // ---- Scrollable text area ----
  const CONTENT_X = 12;
  const CONTENT_Y = 34;
  const CONTENT_W = PANEL_WIDTH - 24;
  const CONTENT_H = PANEL_HEIGHT - CONTENT_Y - 10;

  const entriesText = scene.add.text(
    CONTENT_X,
    CONTENT_Y,
    'No events yet.',
    {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#b7d7ff',
      wordWrap: { width: CONTENT_W },
      lineSpacing: 6, // extra spacing between lines
    }
  );
  container.add(entriesText);

  // ---- Proper clipping mask for the text ----
  // Use world coordinates (panelX + local offsets) and don't add the graphics to the display list.
  const maskGraphics = scene.make.graphics({ x: 0, y: 0, add: false });
  maskGraphics.fillStyle(0xffffff);
  maskGraphics.fillRect(
    panelX + CONTENT_X,
    panelY + CONTENT_Y,
    CONTENT_W,
    CONTENT_H
  );
  const textMask = maskGraphics.createGeometryMask();
  entriesText.setMask(textMask);

  // Initial state
  container.setVisible(false);

  // Store on scene
  scene.historyPanelContainer = container;
  scene.historyPanelText = entriesText;
  scene.historyPanelWidth = PANEL_WIDTH;
  scene.historyPanelHeight = PANEL_HEIGHT;
  scene.historyTextBaseY = CONTENT_Y;
  scene.historyScrollOffset = 0;
  scene.historyMaskGraphics = maskGraphics;
  scene.historyTextMask = textMask;
  scene.isHistoryPanelOpen = false;

  // ---- Toggle button ----
  const button = scene.add.text(
    panelX,
    panelY - 26,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#d0f2ff',
      backgroundColor: '#092038',
      padding: { x: 8, y: 4 },
    }
  )
    .setScrollFactor(0)
    .setDepth(depthBase + 1)
    .setInteractive({ useHandCursor: true });

  button.on('pointerdown', () => {
    if (scene.isHistoryPanelOpen) {
      closeHistoryPanel(scene);
    } else {
      openHistoryPanel(scene);
    }
  });

  scene.historyButton = button;

  // Expose helpers on scene
  scene.openHistoryPanel = () => openHistoryPanel(scene);
  scene.closeHistoryPanel = () => closeHistoryPanel(scene);
  scene.refreshHistoryPanel = () => refreshHistoryPanel(scene);

  // Scroll with mouse wheel (clipped by mask)
  scene.input.on('wheel', (pointer, _gameObjects, _dx, dy) => {
    if (!scene.isHistoryPanelOpen) return;

    // Only scroll when pointer is over the panel
    const px = pointer.x;
    const py = pointer.y;
    const x0 = panelX;
    const y0 = panelY;
    const x1 = panelX + PANEL_WIDTH;
    const y1 = panelY + PANEL_HEIGHT;

    if (px < x0 || px > x1 || py < y0 || py > y1) return;

    const step = 25;
    scene.historyScrollOffset -= Math.sign(dy) * step;
    refreshHistoryPanel(scene);
  });

  // Initial refresh
  refreshHistoryPanel(scene);
}

export function openHistoryPanel(scene) {
  if (!scene.historyPanelContainer) return;
  scene.historyPanelContainer.setVisible(true);
  scene.isHistoryPanelOpen = true;
  refreshHistoryPanel(scene);
}

export function closeHistoryPanel(scene) {
  if (!scene.historyPanelContainer) return;
  scene.historyPanelContainer.setVisible(false);
  scene.isHistoryPanelOpen = false;
}

export function refreshHistoryPanel(scene) {
  const textObj = scene.historyPanelText;
  if (!textObj) return;

  const entries = Array.isArray(scene.historyEntries)
    ? scene.historyEntries.slice().sort((a, b) => (a.year || 0) - (b.year || 0))
    : [];

  if (!entries.length) {
    textObj.setText('No events yet.');
    textObj.y = scene.historyTextBaseY || 34;
    scene.historyScrollOffset = 0;
    return;
  }

  const lines = entries.map(e => {
    const year = typeof e.year === 'number' ? e.year : 5000;
    const txt = e.text || '';
    return `${year} — ${txt}`;
  });

  // Extra blank line between events
  textObj.setText(lines.join('\n\n'));

  const baseY = scene.historyTextBaseY || 34;
  const contentHeight = textObj.height;
  const visibleHeight = scene.historyPanelHeight - baseY - 10;

  if (contentHeight <= visibleHeight) {
    // No need to scroll
    scene.historyScrollOffset = 0;
    textObj.y = baseY;
    return;
  }

  const maxScroll = contentHeight - visibleHeight;

  // scrollOffset is negative when scrolled down
  if (scene.historyScrollOffset > 0) scene.historyScrollOffset = 0;
  if (scene.historyScrollOffset < -maxScroll) scene.historyScrollOffset = -maxScroll;

  textObj.y = baseY + scene.historyScrollOffset;
}
