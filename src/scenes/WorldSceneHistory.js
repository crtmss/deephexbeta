// src/scenes/WorldSceneHistory.js
//
// History panel UI:
// - Large panel near top-right.
// - Scrollable with mouse wheel.
// - Text clipped to panel via geometry mask.
// - Clickable words (outpost / city names etc.) are cyan and focus the map.
//
// Exposed helpers:
//   setupHistoryUI(scene)
//   openHistoryPanel(scene)
//   closeHistoryPanel(scene)
//   refreshHistoryPanel(scene)

/* =========================================================
   SETUP
   ========================================================= */

export function setupHistoryUI(scene) {
  const cam = scene.cameras.main;
  const margin = 12;

  const PANEL_WIDTH = 420;
  const PANEL_HEIGHT = 360;

  // Position: to the left of resources panel if possible
  let panelX;
  let panelY;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - PANEL_WIDTH - 16;
    panelY = scene.resourcesPanel.y;
  } else {
    panelX = margin;
    panelY = 70;
  }

  const depthBase = 9000; // render above most UI

  // ---- Main container for the panel ----
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

  // Initial visibility
  container.setVisible(false);

  // ---- Store references on scene ----
  scene.historyPanelContainer = container;
  scene.historyPanelBg = bg;
  scene.historyPanelTitle = title;
  scene.historyEntriesContainer = entriesContainer;
  scene.historyEntryTexts = [];
  scene.historyPanelWidth = PANEL_WIDTH;
  scene.historyPanelHeight = PANEL_HEIGHT;
  scene.historyVisibleHeight = CONTENT_H;
  scene.historyEntriesBaseY = CONTENT_Y;
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

  // Public helpers
  scene.openHistoryPanel = () => openHistoryPanel(scene);
  scene.closeHistoryPanel = () => closeHistoryPanel(scene);
  scene.refreshHistoryPanel = () => refreshHistoryPanel(scene);

  // ---- Scroll with mouse wheel when pointer over panel ----
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

/* =========================================================
   OPEN / CLOSE
   ========================================================= */

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

/* =========================================================
   RENDER / SCROLL
   ========================================================= */

export function refreshHistoryPanel(scene) {
  const entriesContainer = scene.historyEntriesContainer;
  if (!entriesContainer) return;

  // Destroy previous texts
  const prevTexts = scene.historyEntryTexts || [];
  prevTexts.forEach(t => t.destroy());
  scene.historyEntryTexts = [];

  const entries = Array.isArray(scene.historyEntries)
    ? scene.historyEntries.slice().sort((a, b) => (a.year || 0) - (b.year || 0))
    : [];

  const maxWidth = scene.historyPanelWidth - 24;

  let yCursor = 0;

  if (!entries.length) {
    const txt = scene.add.text(
      0,
      0,
      'No events yet.',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#b7d7ff',
        wordWrap: { width: maxWidth },
        lineSpacing: 4,
      }
    );
    entriesContainer.add(txt);
    scene.historyEntryTexts.push(txt);
    scene.historyScrollPos = 0;
  } else {
    for (const ev of entries) {
      const year = typeof ev.year === 'number' ? ev.year : 5000;
      const body = ev.text || '';
      const label = `${year} — ${body}`;

      // Build clickable target metadata from entry
      const targets = collectTargetsFromEntry(ev);

      // Names that we can highlight
      const clickableNames = targets
        .map(t => t.name)
        .filter(n => typeof n === 'string' && n.length > 0);

      let segments;

      if (clickableNames.length === 0 && targets.length > 0) {
        // No names but we have coords → whole line is clickable
        segments = [{
          text: label,
          clickable: true,
          target: targets[0],
        }];
      } else if (clickableNames.length === 0) {
        // Plain non-clickable line
        segments = [{
          text: label,
          clickable: false,
          target: null,
        }];
      } else {
        // Split label into segments around each clickable name
        segments = buildSegmentsForLabel(label, clickableNames, targets);
      }

      // Render segments with manual wrapping
      let xCursor = 0;

      for (const seg of segments) {
        const color = seg.clickable ? '#6bf7ff' : '#b7d7ff';

        const txt = scene.add.text(
          xCursor,
          yCursor,
          seg.text,
          {
            fontFamily: 'monospace',
            fontSize: '14px',
            color,
            lineSpacing: 4,
          }
        );

        // Wrap if segment would overflow significantly
        if (xCursor > 0 && xCursor + txt.width > maxWidth) {
          xCursor = 0;
          yCursor += txt.height;
          txt.x = xCursor;
          txt.y = yCursor;
        }

        if (seg.clickable && seg.target && hasCoord(seg.target)) {
          txt.setInteractive({ useHandCursor: true });
          txt.on('pointerdown', () => {
            focusEntry(scene, { targets: [seg.target] });
          });
        } else if (!seg.clickable && segmentHasAnyTarget(seg) && targets.length) {
          // fallback: full-line click when we couldn't match text but have coords
          txt.setInteractive({ useHandCursor: true });
          txt.on('pointerdown', () => {
            focusEntry(scene, { targets });
          });
        }

        entriesContainer.add(txt);
        scene.historyEntryTexts.push(txt);

        xCursor += txt.width;

        // Support explicit line breaks in text (rare)
        if (seg.text.includes('\n')) {
          xCursor = 0;
          yCursor += txt.height;
        }
      }

      // Spacing after each entry
      yCursor += 18;
    }
  }

  const contentHeight = yCursor;
  const visibleHeight = scene.historyVisibleHeight || (scene.historyPanelHeight - 44);

  const maxScroll = Math.max(0, contentHeight - visibleHeight);

  if (scene.historyScrollPos < 0) scene.historyScrollPos = 0;
  if (scene.historyScrollPos > maxScroll) scene.historyScrollPos = maxScroll;

  // entriesContainer.y is relative to panel container
  entriesContainer.y = scene.historyEntriesBaseY - scene.historyScrollPos;
}

/* =========================================================
   SEGMENT BUILDING / TARGET COLLECTION
   ========================================================= */

function hasCoord(t) {
  return typeof t.q === 'number' && typeof t.r === 'number';
}

function collectTargetsFromEntry(ev) {
  const result = [];

  if (typeof ev.q === 'number' && typeof ev.r === 'number') {
    result.push({ name: ev.name || null, q: ev.q, r: ev.r });
  }

  if (ev.from && hasCoord(ev.from)) {
    result.push({
      name: ev.from.name || ev.from.cityName || null,
      q: ev.from.q,
      r: ev.from.r,
    });
  }

  if (ev.to && hasCoord(ev.to)) {
    result.push({
      name: ev.to.name || ev.to.cityName || null,
      q: ev.to.q,
      r: ev.to.r,
    });
  }

  if (Array.isArray(ev.targets)) {
    for (const t of ev.targets) {
      if (hasCoord(t)) {
        result.push({
          name: t.name || t.cityName || null,
          q: t.q,
          r: t.r,
        });
      }
    }
  }

  return result;
}

/**
 * Splits a label string into segments, where each clickable name
 * becomes its own segment with a target attached.
 */
function buildSegmentsForLabel(label, clickableNames, allTargets) {
  let segments = [{ text: label, clickable: false, target: null }];

  for (const name of clickableNames) {
    const newSegs = [];

    for (const seg of segments) {
      if (seg.clickable) {
        newSegs.push(seg);
        continue;
      }

      let remaining = seg.text;
      let first = true;

      while (true) {
        const idx = remaining.indexOf(name);
        if (idx === -1) {
          if (remaining.length) {
            newSegs.push({ text: remaining, clickable: false, target: null });
          }
          break;
        }

        // text before
        if (idx > 0) {
          newSegs.push({
            text: remaining.slice(0, idx),
            clickable: false,
            target: null,
          });
        }

        // clickable name
        const target = allTargets.find(t => t.name === name) || allTargets[0] || null;
        newSegs.push({
          text: name,
          clickable: true,
          target,
        });

        remaining = remaining.slice(idx + name.length);

        // Only highlight first occurrence per segment to avoid spam
        if (first) {
          if (remaining.length) {
            newSegs.push({
              text: remaining,
              clickable: false,
              target: null,
            });
          }
          break;
        }
      }
    }

    segments = newSegs;
  }

  return segments;
}

function segmentHasAnyTarget(seg) {
  return !!seg.target;
}

/* =========================================================
   FOCUS / CAMERA / SELECTION
   ========================================================= */

function focusEntry(scene, entry) {
  const targets = [];

  if (typeof entry.q === 'number' && typeof entry.r === 'number') {
    targets.push({ q: entry.q, r: entry.r });
  }
  if (entry.from && hasCoord(entry.from)) {
    targets.push({ q: entry.from.q, r: entry.from.r });
  }
  if (entry.to && hasCoord(entry.to)) {
    targets.push({ q: entry.to.q, r: entry.to.r });
  }
  if (Array.isArray(entry.targets)) {
    for (const t of entry.targets) {
      if (hasCoord(t)) {
        targets.push({ q: t.q, r: t.r });
      }
    }
  }

  if (!targets.length) return;

  let focusQ = targets[0].q;
  let focusR = targets[0].r;

  if (
    entry.from && hasCoord(entry.from) &&
    entry.to && hasCoord(entry.to)
  ) {
    // Road-style: pan to midpoint, highlight "from"
    const a = scene.axialToWorld(entry.from.q, entry.from.r);
    const b = scene.axialToWorld(entry.to.q, entry.to.r);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    panCameraTo(scene, midX, midY);
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

  // Update hex selection visuals
  scene.updateSelectionHighlight?.();

  // Optional debug
  scene.debugHex?.(q, r);
}
