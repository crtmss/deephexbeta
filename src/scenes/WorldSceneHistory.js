// src/scenes/WorldSceneHistory.js
//
// History panel UI (improved):
// - Large panel near top-right (logistics-like style).
// - Scrollable with mouse wheel.
// - Entries are grouped into "Discovery" + "Era 1..N" blocks:
//    Discovery (always first) -> then for each MAIN event: Era k header + up to 2 secondary events.
// - Any entry that has coordinates highlights ALL its referenced hexes on hover.
// - Clicking an entry selects the relevant hex (opens Hex Inspect panel) and closes History.
// - Removes legacy floating history button (keeps tab-based control).
//
// Public helpers:
//   setupHistoryUI(scene)
//   openHistoryPanel(scene)
//   closeHistoryPanel(scene)
//   refreshHistoryPanel(scene)

import { effectiveElevationLocal } from './WorldSceneGeography.js';

/* =========================================================
   POI ICONS (History line icons)
   ========================================================= */

const POI_EVENT_ICON = {
  settlement: '🏘️',
  ruin: '🏚️',
  raider_camp: '☠️',
  roadside_camp: '🏕️',
  watchtower: '🏰',
  mine: '⚒️',
  shrine: '⛩️',
  crash_site: '💥',
  wreck: '⚓',
  vehicle: '🚗',
  abandoned_vehicle: '🚗',
};

function getEntryIcon(entry) {
  const pt = String(entry?.poiType || '').toLowerCase();
  if (pt && POI_EVENT_ICON[pt]) return POI_EVENT_ICON[pt];
  return '';
}

/* =========================================================
   Entry classification (for Era grouping)
   ========================================================= */

// "Main" events: the backbone of the DF-like narrative.
// We treat settlement/ruin/crash/war/truce/founding as main.
// Secondary: roads/camps/watchtowers/mines/shrines/vehicles/wreck/survey/etc.
function isMainEvent(entry) {
  if (!entry) return false;

  const t = String(entry.type || '').toLowerCase();
  const pt = String(entry.poiType || '').toLowerCase();

  if (t === 'founding' || t === 'discovery') return true;
  if (t === 'war' || t === 'truce' || t === 'peace') return true;
  if (t === 'cataclysm') return true;

  // POI-driven main types
  if (pt === 'settlement' || pt === 'ruin' || pt === 'crash_site') return true;

  // Some POI beats should count as main if explicitly marked
  if (t === 'major' || t === 'main') return true;

  return false;
}

function isSecondaryEvent(entry) {
  if (!entry) return false;
  return !isMainEvent(entry);
}

/* =========================================================
   SETUP
   ========================================================= */

export function setupHistoryUI(scene) {
  const margin = 12;

  const PANEL_WIDTH = 520;
  const PANEL_HEIGHT = 520;

  let panelX;
  let panelY;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - PANEL_WIDTH - 16;
    panelY = scene.resourcesPanel.y;
  } else {
    panelX = (scene.scale?.width ?? 900) - PANEL_WIDTH - margin;
    panelY = 70;
  }

  const depthBase = 9000;

  const container = scene.add.container(panelX, panelY);
  container.setScrollFactor(0);
  container.setDepth(depthBase);

  const bg = scene.add
    .rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 0x07121f, 0.96)
    .setOrigin(0, 0);
  bg.setStrokeStyle(2, 0x34d2ff, 0.85);
  container.add(bg);

  const title = scene.add.text(14, 8, 'History', {
    fontFamily: 'monospace',
    fontSize: '17px',
    color: '#d0f2ff',
  });
  container.add(title);

  const divider = scene.add.graphics();
  divider.lineStyle(1, 0x34d2ff, 0.35);
  divider.beginPath();
  divider.moveTo(12, 32);
  divider.lineTo(PANEL_WIDTH - 12, 32);
  divider.strokePath();
  container.add(divider);

  const CONTENT_X = 12;
  const CONTENT_Y = 40;
  const CONTENT_W = PANEL_WIDTH - 24;
  const CONTENT_H = PANEL_HEIGHT - CONTENT_Y - 12;

  const entriesContainer = scene.add.container(CONTENT_X, CONTENT_Y);
  container.add(entriesContainer);

  const maskGraphics = scene.make.graphics({ x: 0, y: 0, add: false });
  maskGraphics.fillStyle(0xffffff);
  maskGraphics.fillRect(panelX + CONTENT_X, panelY + CONTENT_Y, CONTENT_W, CONTENT_H);
  const entriesMask = maskGraphics.createGeometryMask();
  entriesContainer.setMask(entriesMask);

  container.setVisible(false);

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

  // Remove legacy floating toggle button (лишняя)
  if (scene.historyButton) {
    try {
      scene.historyButton.destroy();
    } catch (_e) {}
    scene.historyButton = null;
  }

  scene.openHistoryPanel = () => openHistoryPanel(scene);
  scene.closeHistoryPanel = () => closeHistoryPanel(scene);
  scene.refreshHistoryPanel = () => refreshHistoryPanel(scene);

  // Scroll with mouse wheel when pointer is over panel
  scene.input.on('wheel', (pointer, _gameObjects, _dx, dy) => {
    if (!scene.isHistoryPanelOpen) return;

    const px = pointer.x;
    const py = pointer.y;
    const x0 = panelX;
    const y0 = panelY;
    const x1 = panelX + PANEL_WIDTH;
    const y1 = panelY + PANEL_HEIGHT;

    if (px < x0 || px > x1 || py < y0 || py > y1) return;

    const step = 44;
    scene.historyScrollPos += Math.sign(dy) * step;
    refreshHistoryPanel(scene);
  });

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
  highlightHistoryHexes(scene, []);
}

/* =========================================================
   Era building
   ========================================================= */

function sortEntriesChronologically(entries) {
  return entries.slice().sort((a, b) => (a.year || 0) - (b.year || 0));
}

/**
 * Build DF-like structure:
 * Discovery (first entry) +
 * For each MAIN event: Era #k with header=main, then up to 2 secondary following it.
 */
function buildEraBlocks(allEntries) {
  const entries = sortEntriesChronologically(allEntries);

  if (!entries.length) return [];

  const blocks = [];
  const first = entries[0];

  blocks.push({
    kind: 'discovery',
    title: 'Discovery',
    main: first,
    items: [],
    collapsed: false,
  });

  let i = 1;
  let eraIndex = 1;

  // If there is no clear MAIN event later, we still chunk into eras by 3 items.
  const fallbackChunk = () => {
    const main = entries[i];
    const items = [];
    if (entries[i + 1]) items.push(entries[i + 1]);
    if (entries[i + 2]) items.push(entries[i + 2]);
    blocks.push({
      kind: 'era',
      title: `Era ${eraIndex}`,
      main,
      items,
      collapsed: true,
    });
    eraIndex += 1;
    i += 3;
  };

  while (i < entries.length) {
    const e = entries[i];

    if (!isMainEvent(e)) {
      // If we encounter a secondary without a preceding main, fallback chunking.
      fallbackChunk();
      continue;
    }

    const main = e;
    const items = [];
    let j = i + 1;
    while (j < entries.length && items.length < 2) {
      const nxt = entries[j];
      if (isMainEvent(nxt)) break; // next era begins
      items.push(nxt);
      j += 1;
    }

    blocks.push({
      kind: 'era',
      title: `Era ${eraIndex}`,
      main,
      items,
      collapsed: true,
    });

    eraIndex += 1;
    i = j;
  }

  return blocks;
}

/* =========================================================
   RENDER / SCROLL
   ========================================================= */

export function refreshHistoryPanel(scene) {
  const entriesContainer = scene.historyEntriesContainer;
  if (!entriesContainer) return;

  // Destroy previous texts / graphics
  const prevTexts = scene.historyEntryTexts || [];
  prevTexts.forEach(t => {
    try { t.destroy(); } catch (_e) {}
  });
  scene.historyEntryTexts = [];

  // Get entries
  const ALL = Array.isArray(scene.historyEntries) ? scene.historyEntries : [];

  // If too many events exist, reduce noise:
  // Prefer keeping structure: last N eras (not just last N entries).
  const blocksAll = buildEraBlocks(ALL);
  const ERA_CAP = 10; // keeps UI readable while still DF-like; tweak if desired
  const blocks =
    blocksAll.length > (1 + ERA_CAP)
      ? [blocksAll[0]].concat(blocksAll.slice(blocksAll.length - ERA_CAP))
      : blocksAll;

  const maxWidth = scene.historyPanelWidth - 24;

  let y = 0;

  if (!blocks.length) {
    const txt = scene.add.text(0, 0, 'No events yet.', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#b7d7ff',
      wordWrap: { width: maxWidth },
      lineSpacing: 4,
    });
    entriesContainer.add(txt);
    scene.historyEntryTexts.push(txt);
    scene.historyScrollPos = 0;
  } else {
    for (const block of blocks) {
      // --- Block header ---
      const headerText =
        block.kind === 'discovery'
          ? `◆ ${block.title}`
          : `◆ ${block.title}`;

      const header = scene.add.text(0, y, headerText, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#d0f2ff',
      }).setOrigin(0, 0);
      entriesContainer.add(header);
      scene.historyEntryTexts.push(header);

      // Collapse toggle only for eras (discovery always expanded)
      if (block.kind === 'era') {
        header.setInteractive({ useHandCursor: true });
        header.on('pointerdown', () => {
          block.collapsed = !block.collapsed;
          // store collapse state across refreshes (by main.year + main.text key)
          const key = blockKey(block);
          if (!scene.__historyCollapse) scene.__historyCollapse = {};
          scene.__historyCollapse[key] = block.collapsed;
          refreshHistoryPanel(scene);
        });
      }

      // Restore collapse state
      if (block.kind === 'era') {
        const key = blockKey(block);
        if (scene.__historyCollapse && key in scene.__historyCollapse) {
          block.collapsed = !!scene.__historyCollapse[key];
        }
      }

      y += header.height + 6;

      // --- Main line ---
      const mainLine = renderEntryLine(scene, entriesContainer, block.main, y, maxWidth, {
        isMain: true,
      });
      y += mainLine.height + 6;

      // --- Secondary lines ---
      if (block.kind === 'era' && block.collapsed) {
        // show a small hint
        if (block.items.length) {
          const hint = scene.add.text(0, y, `… ${block.items.length} secondary event(s)`, {
            fontFamily: 'monospace',
            fontSize: '13px',
            color: '#7bbbd0',
          }).setOrigin(0, 0);
          entriesContainer.add(hint);
          scene.historyEntryTexts.push(hint);
          y += hint.height + 10;
        } else {
          y += 8;
        }
      } else {
        for (const it of block.items) {
          const line = renderEntryLine(scene, entriesContainer, it, y, maxWidth, {
            indent: 16,
            isMain: false,
          });
          y += line.height + 6;
        }
        y += 6;
      }
    }
  }

  const contentHeight = y;
  const visibleHeight = scene.historyVisibleHeight || (scene.historyPanelHeight - 44);

  const maxScroll = Math.max(0, contentHeight - visibleHeight);
  if (scene.historyScrollPos < 0) scene.historyScrollPos = 0;
  if (scene.historyScrollPos > maxScroll) scene.historyScrollPos = maxScroll;

  entriesContainer.y = scene.historyEntriesBaseY - scene.historyScrollPos;
}

function blockKey(block) {
  const m = block?.main || {};
  const y = typeof m.year === 'number' ? m.year : 0;
  const t = String(m.text || '').slice(0, 48);
  return `${block.title}|${y}|${t}`;
}

function renderEntryLine(scene, parent, entry, y, maxWidth, opts = {}) {
  const year = typeof entry?.year === 'number' ? entry.year : 5000;
  const body = String(entry?.text || '');

  const icon = getEntryIcon(entry);
  const iconPrefix = icon ? `${icon} ` : '';

  const indent = opts.indent || 0;
  const isMain = !!opts.isMain;

  const lineText = `${iconPrefix}${year} — ${body}`;

  const hasTargets = entryHasTargets(entry);
  const color = isMain ? '#ffffff' : (hasTargets ? '#6bf7ff' : '#b7d7ff');

  const tObj = scene.add.text(indent, y, lineText, {
    fontFamily: 'monospace',
    fontSize: isMain ? '14px' : '13.5px',
    color,
    wordWrap: { width: maxWidth - indent },
    lineSpacing: 4,
  }).setOrigin(0, 0);

  parent.add(tObj);
  scene.historyEntryTexts.push(tObj);

  if (hasTargets) {
    tObj.setInteractive({ useHandCursor: true });

    tObj.on('pointerover', () => {
      const coords = collectEntryTargets(entry);
      highlightHistoryHexes(scene, coords);
    });
    tObj.on('pointerout', () => {
      highlightHistoryHexes(scene, []);
    });

    // ✅ FIX: clicking selects hex (opens hex-inspect) and closes history (no camera pan).
    tObj.on('pointerdown', () => {
      selectFromEntryAndClose(scene, entry);
    });
  }

  return tObj;
}

/* =========================================================
   HOVER HIGHLIGHT (ALL coords)
   ========================================================= */

function keyOf(q, r) {
  return q + ',' + r;
}

function highlightHistoryHexes(scene, coords) {
  if (!scene || !scene.mapData) return;

  if (!scene.historyHoverGraphics) {
    const g = scene.add.graphics().setDepth(9050);
    g.visible = false;
    scene.historyHoverGraphics = g;
  }
  const g = scene.historyHoverGraphics;

  const list = Array.isArray(coords) ? coords.filter(c => c && Number.isFinite(c.q) && Number.isFinite(c.r)) : [];
  if (!list.length) {
    g.clear();
    g.visible = false;
    return;
  }

  const size = scene.hexSize || 24;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;

  // Build tile lookup for speed
  const byKey = new Map((scene.mapData || []).map(t => [keyOf(t.q, t.r), t]));

  g.clear();
  g.lineStyle(3, 0xffffff, 1);

  const radius = size * 0.95;

  for (const c of list) {
    const tile = byKey.get(keyOf(c.q, c.r));
    if (!tile) continue;

    const eff = effectiveElevationLocal(tile);
    const coord = scene.hexToPixel(c.q, c.r, size);
    const x = coord.x + offsetX;
    const y = coord.y + offsetY - LIFT * eff;

    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6;
      const px = x + radius * Math.cos(angle);
      const py = y + radius * Math.sin(angle);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.strokePath();
  }

  g.visible = true;
}

/* =========================================================
   CLICK / FOCUS HELPERS
   ========================================================= */

function entryHasTargets(entry) {
  if (!entry) return false;
  const coords = collectEntryTargets(entry);
  return coords.length > 0;
}

function hasCoord(t) {
  return t && typeof t.q === 'number' && typeof t.r === 'number';
}

function collectEntryTargets(entry) {
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
      if (hasCoord(t)) targets.push({ q: t.q, r: t.r });
    }
  }

  // Deduplicate
  const seen = new Set();
  const out = [];
  for (const t of targets) {
    const k = `${t.q},${t.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Choose "best" focus coord for an entry.
 * Priority:
 *   1) entry.q/r
 *   2) entry.to
 *   3) entry.from
 *   4) first entry.targets[0]
 */
function pickPrimaryCoord(entry) {
  if (!entry) return null;

  if (typeof entry.q === 'number' && typeof entry.r === 'number') {
    return { q: entry.q, r: entry.r };
  }
  if (entry.to && hasCoord(entry.to)) return { q: entry.to.q, r: entry.to.r };
  if (entry.from && hasCoord(entry.from)) return { q: entry.from.q, r: entry.from.r };

  if (Array.isArray(entry.targets)) {
    const t0 = entry.targets.find(hasCoord);
    if (t0) return { q: t0.q, r: t0.r };
  }
  return null;
}

/**
 * ✅ NEW behavior:
 * - Select hex (same logic as clicking empty hex on map):
 *   clear unit selection, set selectedHex, open hex inspect panel.
 * - Close history panel.
 * - Clear hover highlight.
 * - No camera pan.
 */
function selectFromEntryAndClose(scene, entry) {
  const coord = pickPrimaryCoord(entry);
  if (!coord) return;

  // Clear hover highlight immediately
  highlightHistoryHexes(scene, []);

  // Deselect any unit; select hex
  scene.setSelectedUnit?.(null);
  scene.selectedHex = { q: coord.q, r: coord.r };
  scene.selectedBuilding = null;
  scene.clearPathPreview?.();

  // Open hex inspector in the same panel used for units
  scene.openHexInspectPanel?.(coord.q, coord.r);

  // Update selection visuals
  scene.updateSelectionHighlight?.();
  scene.debugHex?.(coord.q, coord.r);

  // Close history (tab stays)
  scene.closeHistoryPanel?.();
}
