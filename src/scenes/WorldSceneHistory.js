// src/scenes/WorldSceneHistory.js
//
// Large, scrollable History panel UI with proper text clipping
// and clickable entries that focus hexes on the map.

/**
 * Setup the History panel. Call once from WorldScene.create().
 */
export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  const PANEL_WIDTH = 420;
  const PANEL_HEIGHT = 360;

  // Position: to the left of the resources panel if present
  let panelX;
  let panelY;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - PANEL_WIDTH - 16;
    panelY = scene.resourcesPanel.y;
  } else {
    panelX = margin;
    panelY = 70;
  }

  const depthBase = 9000; // very high, above most UI

  // ---- Main container ----
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
  ).setOrigin(0, 0);
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

  // ---- Scrollable entries container (inside panel) ----
  const CONTENT_X = 12;
  const CONTENT_Y = 34;
  const CONTENT_W = PANEL_WIDTH - 24;
  const CONTENT_H = PANEL_HEIGHT - CONTENT_Y - 10;

  const entriesContainer = scene.add.container(CONTENT_X, CONTENT_Y);
  container.add(entriesContainer);

  // ---- Mask to clip entries to panel ----
  const maskGraphics = scene.make.graphics({ x: 0, y: 0, add: false });
  maskGraphics.fillStyle(0xffffff);
  maskGraphics.fillRect(
    panelX + CONTENT_X,
    panelY + CONTENT_Y,
    CONTENT_W,
    CONTENT_H
  );
  const entriesMask = maskGraphics.createGeometryMask();
  entriesContainer.setMask(entriesMask);

  // Initial state
  container.setVisible(false);

  // Store on scene
  scene.historyPanelContainer = container;
  scene.historyPanelBg = bg;
  scene.historyPanelTitle = title;
  scene.historyEntriesContainer = entriesContainer;
  scene.historyEntryTexts = [];
  scene.historyPanelWidth = PANEL_WIDTH;
  scene.historyPanelHeight = PANEL_HEIGHT;
  scene.historyVisibleHeight = CONTENT_H;
  scene.historyScrollPos = 0;
  scene.historyMaskGraphics = maskGraphics;
  scene.historyEntriesMask = entriesMask;
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

  // Scroll with mouse wheel when pointer over panel
  scene.input.on('wheel', (pointer, _gameObjects, _dx, dy) => {
    if (!scene.isHistoryPanelOpen) return;

    const px = pointer.x;
    const py = pointer.y;
    const x0 = panelX;
    const y0 = panelY;
    const x1 = panelX + PANEL_WIDTH;
    const y1 = panelY + PANEL_HEIGHT;

    if (px < x0 || px > x1 || py < y0 || py > y1) return;

    const step = 30;
    scene.historyScrollPos += Math.sign(dy) * step;
    refreshHistoryPanel(scene);
  });

  // Initial refresh
  refreshHistoryPanel(scene);
}

/* ----------------- Open / close ----------------- */

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

/* ----------------- Refresh rendering ----------------- */

export function refreshHistoryPanel(scene) {
  const container = scene.historyEntriesContainer;
  if (!container) return;

  const prevTexts = scene.historyEntryTexts || [];
  prevTexts.forEach(t => t.destroy());
  scene.historyEntryTexts = [];

  const entries = Array.isArray(scene.historyEntries)
    ? scene.historyEntries.slice().sort((a, b) => (a.year || 0) - (b.year || 0))
    : [];

  if (!entries.length) {
    const txt = scene.add.text(
      0,
      0,
      'No events yet.',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#b7d7ff',
        wordWrap: { width: scene.historyPanelWidth - 24 },
        lineSpacing: 4,
      }
    );
    container.add(txt);
    scene.historyEntryTexts.push(txt);
    scene.historyScrollPos = 0;
    container.y = 34; // relative to main container; will be overwritten anyway
    return;
  }

  const maxWidth = scene.historyPanelWidth - 24;
  let y = 0;

  for (const ev of entries) {
    const year = typeof ev.year === 'number' ? ev.year : 5000;
    const text = ev.text || '';
    const label = `${year} — ${text}`;

    const hasTargets = entryHasTargets(ev);
    const color = hasTargets ? '#ffffff' : '#b7d7ff';

    const txt = scene.add.text(
      0,
      y,
      label,
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color,
        wordWrap: { width: maxWidth },
        lineSpacing: 4,
      }
    );

    if (hasTargets) {
      txt.setInteractive({ useHandCursor: true });
      txt.on('pointerdown', () => {
        focusEntry(scene, ev);
      });
    }

    container.add(txt);
    scene.historyEntryTexts.push(txt);

    y += txt.height + 10; // spacing between entries
  }

  const contentHeight = y;
  const visibleHeight = scene.historyVisibleHeight || (scene.historyPanelHeight - 44);

  const maxScroll = Math.max(0, contentHeight - visibleHeight);

  if (scene.historyScrollPos < 0) scene.historyScrollPos = 0;
  if (scene.historyScrollPos > maxScroll) scene.historyScrollPos = maxScroll;

  // entriesContainer's local y is relative to panel; 0 means top aligned
  container.y = 34 - scene.historyScrollPos;
}

/* ----------------- Helpers for clickable entries ----------------- */

function entryHasTargets(entry) {
  if (typeof entry.q === 'number' && typeof entry.r === 'number') return true;
  if (entry.from && typeof entry.from.q === 'number' && typeof entry.from.r === 'number') return true;
  if (entry.to && typeof entry.to.q === 'number' && typeof entry.to.r === 'number') return true;
  if (Array.isArray(entry.targets) && entry.targets.length) return true;
  return false;
}

function focusEntry(scene, entry) {
  const targets = [];

  if (typeof entry.q === 'number' && typeof entry.r === 'number') {
    targets.push({ q: entry.q, r: entry.r });
  }
  if (entry.from && typeof entry.from.q === 'number' && typeof entry.from.r === 'number') {
    targets.push({ q: entry.from.q, r: entry.from.r });
  }
  if (entry.to && typeof entry.to.q === 'number' && typeof entry.to.r === 'number') {
    targets.push({ q: entry.to.q, r: entry.to.r });
  }
  if (Array.isArray(entry.targets)) {
    for (const t of entry.targets) {
      if (typeof t.q === 'number' && typeof t.r === 'number') {
        targets.push({ q: t.q, r: t.r });
      }
    }
  }

  if (!targets.length) return;

  // For roads, we also consider the midpoint to pan the camera nicely
  let focusQ = targets[0].q;
  let focusR = targets[0].r;

  if (entry.from && entry.to &&
      typeof entry.from.q === 'number' && typeof entry.from.r === 'number' &&
      typeof entry.to.q === 'number' && typeof entry.to.r === 'number') {
    const a = scene.axialToWorld(entry.from.q, entry.from.r);
    const b = scene.axialToWorld(entry.to.q, entry.to.r);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    panCameraTo(scene, midX, midY);
    // Highlight the "from" hex
    focusQ = entry.from.q;
    focusR = entry.from.r;
  } else {
    const p = scene.axialToWorld(focusQ, focusR);
    panCameraTo(scene, p.x, p.y);
  }

  selectHex(scene, focusQ, focusR);
}

function panCameraTo(scene, x, y) {
  const cam = scene.cameras.main;
  if (!cam) return;
  cam.pan(x, y, 350, 'Sine.easeInOut', true);
}

function selectHex(scene, q, r) {
  if (typeof q !== 'number' || typeof r !== 'number') return;

  // Clear unit selection & path preview
  scene.setSelectedUnit?.(null);
  scene.selectedHex = { q, r };
  scene.clearPathPreview?.();

  // Let your existing highlight system update
  scene.updateSelectionHighlight?.();

  // Optional: debug log
  scene.debugHex?.(q, r);
}
