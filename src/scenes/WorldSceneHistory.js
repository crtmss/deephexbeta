// src/scenes/WorldSceneHistory.js
//
// History panel UI:
// - Large panel near top-right.
// - Scrollable with mouse wheel.
// - Text clipped to panel via geometry mask.
// - Entries that can focus a hex are cyan & clickable.
// - City/outpost names in text are bold white and highlight their hex on hover.
//
// Public helpers:
//   setupHistoryUI(scene)
//   openHistoryPanel(scene)
//   closeHistoryPanel(scene)
//   refreshHistoryPanel(scene)

import { effectiveElevationLocal } from "./WorldSceneGeography.js";

const PANEL_WIDTH  = 420;
const PANEL_HEIGHT = 260;
const PANEL_MARGIN = 12;

// Colors
const COLOR_BG        = 0x000000;
const COLOR_BG_ALPHA  = 0.75;
const COLOR_BORDER    = 0xffffff;
const COLOR_TITLE     = "#ffffff";
const COLOR_TEXT      = "#9ad1ff"; // cyan-ish for normal history text
const COLOR_CITY_TEXT = "#ffffff"; // bold white for city/outpost names

/* =========================================================
   SETUP
   ========================================================= */
export function setupHistoryUI(scene) {
  // Panel root container
  const x = scene.scale.width - PANEL_WIDTH - PANEL_MARGIN;
  const y = PANEL_MARGIN + 64; // a bit below top UI

  const panel = scene.add.container(x, y).setDepth(1600);
  scene.historyPanelContainer = panel;
  scene.isHistoryPanelOpen = false;
  panel.setVisible(false);

  // Background + border
  const bg = scene.add
    .rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT, COLOR_BG, COLOR_BG_ALPHA)
    .setOrigin(0, 0);

  const border = scene.add
    .rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT)
    .setOrigin(0, 0);
  border.setStrokeStyle(2, COLOR_BORDER, 0.9);

  panel.add(bg);
  panel.add(border);

  // Title
  const title = scene.add.text(10, 6, "History", {
    fontFamily: "Arial",
    fontSize: "16px",
    color: COLOR_TITLE,
    fontStyle: "bold",
  });
  panel.add(title);

  // Close button
  const closeBtn = scene.add
    .text(PANEL_WIDTH - 18, 4, "×", {
      fontFamily: "Arial",
      fontSize: "18px",
      color: "#ff8080",
    })
    .setOrigin(0.5, 0);
  closeBtn.setInteractive({ useHandCursor: true });
  closeBtn.on("pointerdown", () => closeHistoryPanel(scene));
  panel.add(closeBtn);

  // Entries container (scrollable area)
  const entriesContainer = scene.add.container(0, 0);
  scene.historyEntriesContainer = entriesContainer;
  panel.add(entriesContainer);

  // Geometry mask for scroll area
  const maskGfx = scene.add.graphics();
  maskGfx.fillStyle(0xffffff, 1);
  const maskX = x + 4;
  const maskY = y + 26;
  const maskW = PANEL_WIDTH - 8;
  const maskH = PANEL_HEIGHT - 32;
  maskGfx.beginPath();
  maskGfx.fillRect(maskX, maskY, maskW, maskH);
  maskGfx.closePath();

  const mask = maskGfx.createGeometryMask();
  entriesContainer.setMask(mask);
  scene.historyMaskGraphics = maskGfx;

  scene.historyScrollOffset = 0;
  scene.historyMaxScroll = 0;

  // Mouse wheel scrolling when cursor is over panel
  scene.input.on("wheel", (pointer, _gameObjects, _dx, dy) => {
    if (!scene.isHistoryPanelOpen) return;

    const px = pointer.x;
    const py = pointer.y;
    const x0 = x;
    const y0 = y;
    const x1 = x + PANEL_WIDTH;
    const y1 = y + PANEL_HEIGHT;

    if (px < x0 || px > x1 || py < y0 || py > y1) return;

    const step = 30;
    const dir = dy > 0 ? 1 : -1;
    const maxScroll = scene.historyMaxScroll || 0;

    scene.historyScrollOffset = Math.max(
      0,
      Math.min(maxScroll, scene.historyScrollOffset + dir * step)
    );

    updateEntriesContainerOffset(scene);
  });

  // Expose helpers on scene for convenience
  scene.openHistoryPanel = () => openHistoryPanel(scene);
  scene.closeHistoryPanel = () => closeHistoryPanel(scene);
  scene.refreshHistoryPanel = () => refreshHistoryPanel(scene);
}

/* =========================================================
   OPEN / CLOSE
   ========================================================= */
export function openHistoryPanel(scene) {
  if (!scene.historyPanelContainer) return;
  scene.isHistoryPanelOpen = true;
  scene.historyPanelContainer.setVisible(true);
  scene.historyScrollOffset = 0;
  updateEntriesContainerOffset(scene);
  refreshHistoryPanel(scene);
}

export function closeHistoryPanel(scene) {
  if (!scene.historyPanelContainer) return;
  scene.isHistoryPanelOpen = false;
  scene.historyPanelContainer.setVisible(false);
  highlightHistoryHex(scene, null, null); // clear hover highlight
}

/* =========================================================
   REFRESH / RENDER
   ========================================================= */
export function refreshHistoryPanel(scene) {
  if (!scene.historyPanelContainer || !scene.historyEntriesContainer) return;

  const entries = scene.historyEntries || [];
  const container = scene.historyEntriesContainer;

  // Clear previous children (destroy)
  container.removeAll(true);

  const x0 = 12;    // left margin inside panel
  let yCursor = 28; // start a bit below the header

  const normalStyle = {
    fontFamily: "Arial",
    fontSize: "14px",
    color: COLOR_TEXT,
    wordWrap: { width: PANEL_WIDTH - 24 },
  };

  const cityStyle = {
    fontFamily: "Arial",
    fontSize: "14px",
    color: COLOR_CITY_TEXT,
    fontStyle: "bold",
  };

  // Precompute outposts & their names for highlighting
  const outposts =
    (scene.loreState && Array.isArray(scene.loreState.outposts))
      ? scene.loreState.outposts
      : [];
  const outpostNames = outposts
    .map((o) => (o && o.name ? String(o.name) : null))
    .filter(Boolean);

  // Render entries (already sorted by addHistoryEntry)
  for (const entry of entries) {
    const year = typeof entry.year === "number" ? entry.year : null;
    const text = String(entry.text ?? "");

    const mainText = year != null ? `[${year}] ${text}` : text;

    // Determine a "focus" hex for entry-level click (if any)
    const focus = resolveEntryFocus(entry);

    // Split text into segments: normal vs city-name segments
    const segments = splitTextByCityNames(mainText, outposts, outpostNames);

    // Layout tokens manually with simple wrapping
    let xCursor = x0;
    let lineBottom = yCursor;

    for (const seg of segments) {
      const baseStyle = seg.city ? cityStyle : normalStyle;
      // Split into tokens (words + spaces), preserve spaces
      const tokens = seg.text.split(/(\s+)/);

      for (const token of tokens) {
        if (!token) continue;

        // Measure token
        const tmp = scene.add.text(0, 0, token, baseStyle).setOrigin(0, 0);
        const tokenW = tmp.width;
        const tokenH = tmp.height;
        tmp.destroy();

        const maxWidth = PANEL_WIDTH - 24;
        if (
          token.trim().length > 0 &&
          xCursor > x0 &&
          xCursor + tokenW > x0 + maxWidth
        ) {
          // New line
          xCursor = x0;
          yCursor = lineBottom + 4;
          lineBottom = yCursor;
        }

        const style = { ...baseStyle };

        const tObj = scene.add.text(xCursor, yCursor, token, style).setOrigin(0, 0);

        // Entry-level click (cyan entries that can focus a hex)
        if (focus) {
          tObj.setColor(COLOR_TEXT);
          tObj.setInteractive({ useHandCursor: true });
          tObj.on("pointerdown", () => {
            selectHex(scene, focus.q, focus.r);
          });
        }

        // City-name specific hover/click (bold white)
        if (seg.city && token.trim().length > 0) {
          const city = seg.city;
          tObj.setInteractive({ useHandCursor: true });
          tObj.on("pointerover", () => {
            highlightHistoryHex(scene, city.q, city.r);
          });
          tObj.on("pointerout", () => {
            highlightHistoryHex(scene, null, null);
          });
          tObj.on("pointerdown", () => {
            selectHex(scene, city.q, city.r);
          });
        }

        container.add(tObj);

        xCursor += tObj.width;
        lineBottom = Math.max(lineBottom, yCursor + tObj.height);
      }
    }

    // Move to next entry (slightly more spacing)
    yCursor = lineBottom + 10;
  }

  // Compute max scroll
  const visibleHeight = PANEL_HEIGHT - 40;
  scene.historyMaxScroll = Math.max(0, yCursor - visibleHeight);
  updateEntriesContainerOffset(scene);
}

/* =========================================================
   INTERNAL HELPERS
   ========================================================= */
function updateEntriesContainerOffset(scene) {
  if (!scene.historyEntriesContainer) return;
  // Offset entries inside mask (top margin ~24 for header)
  scene.historyEntriesContainer.y = 24 - (scene.historyScrollOffset || 0);
}

// Determine a "focus" coordinate for a history entry (road built, discovery, etc.)
function resolveEntryFocus(entry) {
  if (!entry || typeof entry !== "object") return null;

  // Explicit focus field
  if (entry.focus && typeof entry.focus.q === "number" && typeof entry.focus.r === "number") {
    return { q: entry.focus.q, r: entry.focus.r };
  }

  // from / to coordinates (roads, etc.)
  if (entry.from && typeof entry.from.q === "number" && typeof entry.from.r === "number") {
    return { q: entry.from.q, r: entry.from.r };
  }
  if (entry.to && typeof entry.to.q === "number" && typeof entry.to.r === "number") {
    return { q: entry.to.q, r: entry.to.r };
  }

  // Direct q,r on the entry itself
  if (typeof entry.q === "number" && typeof entry.r === "number") {
    return { q: entry.q, r: entry.r };
  }

  return null;
}

// Split text by city/outpost names so we can style & highlight them
function splitTextByCityNames(text, outposts, outpostNames) {
  if (!outposts || !outposts.length || !outpostNames || !outpostNames.length) {
    return [{ text, city: null }];
  }

  const matches = [];

  for (const name of outpostNames) {
    const n = String(name);
    let idx = text.indexOf(n);
    while (idx !== -1) {
      matches.push({ start: idx, end: idx + n.length, name: n });
      idx = text.indexOf(n, idx + n.length);
    }
  }

  if (!matches.length) {
    return [{ text, city: null }];
  }

  // Sort and keep non-overlapping matches (prefer earlier, longer)
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end; // longer first if same start
  });

  const filtered = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  const segments = [];
  let pos = 0;
  for (const m of filtered) {
    if (m.start > pos) {
      segments.push({ text: text.slice(pos, m.start), city: null });
    }
    const city = outposts.find((o) => o && o.name === m.name) || null;
    segments.push({ text: text.slice(m.start, m.end), city });
    pos = m.end;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), city: null });
  }
  return segments;
}

/**
 * Highlight a hex with a white outline, similar to hovering over a hex.
 * If q/r are null, clears the history-driven highlight.
 */
function highlightHistoryHex(scene, q, r) {
  if (!scene || !scene.mapData) return;

  if (!scene.historyHoverGraphics) {
    const g = scene.add.graphics().setDepth(1850);
    g.visible = false;
    scene.historyHoverGraphics = g;
  }
  const g = scene.historyHoverGraphics;

  if (typeof q !== "number" || typeof r !== "number") {
    g.clear();
    g.visible = false;
    return;
  }

  const tile = scene.mapData.find((t) => t.q === q && t.r === r);
  if (!tile) {
    g.clear();
    g.visible = false;
    return;
  }

  const size = scene.hexSize || 24;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;
  const eff = effectiveElevationLocal(tile);

  const coord = scene.hexToPixel(q, r, size);
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const x = coord.x + offsetX;
  const y = coord.y + offsetY - LIFT * eff;

  const radius = size * 0.95;

  g.clear();
  g.lineStyle(3, 0xffffff, 1);

  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6; // 60° steps, rotated 30°
    const px = x + radius * Math.cos(angle);
    const py = y + radius * Math.sin(angle);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.strokePath();

  g.visible = true;
}

/**
 * Programmatically select a hex, similar to clicking it on the map.
 * Used when clicking on history entries that can focus a hex.
 */
function selectHex(scene, q, r) {
  if (typeof q !== "number" || typeof r !== "number") return;

  // Clear unit selection & path preview
  scene.setSelectedUnit?.(null);
  scene.selectedHex = { q, r };
  scene.clearPathPreview?.();

  // Update selection visuals (if the scene has a hook for this)
  scene.updateSelectionHighlight?.();

  // Optional debug hook
  scene.debugHex?.(q, r);
}

export default {
  setupHistoryUI,
  openHistoryPanel,
  closeHistoryPanel,
  refreshHistoryPanel,
};
