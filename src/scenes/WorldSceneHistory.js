// src/scenes/WorldSceneHistory.js
//
// History panel UI:
// - Large panel near top-right.
// - Scrollable with mouse wheel.
// - Text clipped to panel via geometry mask.
// - Entries that can focus a hex are cyan & clickable.
//
// Public helpers:
//   setupHistoryUI(scene)
//   openHistoryPanel(scene)
//   closeHistoryPanel(scene)
//   refreshHistoryPanel(scene)

import { effectiveElevationLocal } from './WorldSceneGeography.js';

/* =========================================================
   POI ICONS (NEW)
   ========================================================= */

// Icon shown in History line when entry.poiType is present.
// These can be different from map icons if you prefer.
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

  // Optional: infer from entry.type if you ever want.
  return '';
}

/* =========================================================
   SETUP
   ========================================================= */

export function setupHistoryUI(scene) {
  const margin = 12;

  // v2: make History panel match Logistics panel footprint better
  // (large, near top-right, similar style).
  //
  // If you already have a "logisticsPanel" or similar, we place next to it
  // in a stable way; otherwise use top-right anchor.
  const PANEL_WIDTH = 520;
  const PANEL_HEIGHT = 520;

  // Position: to the left of resources panel if present, else top-right.
  let panelX;
  let panelY;

  if (scene.resourcesPanel) {
    panelX = scene.resourcesPanel.x - PANEL_WIDTH - 16;
    panelY = scene.resourcesPanel.y;
  } else {
    // top-right-ish
    panelX = (scene.scale?.width ?? 900) - PANEL_WIDTH - margin;
    panelY = 70;
  }

  const depthBase = 9000; // render above most UI

  // ---- Main container for the panel ----
  const container = scene.add.container(panelX, panelY);
  container.setScrollFactor(0);
  container.setDepth(depthBase);

  // ---- Background (match Logistics vibe) ----
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
    14,
    8,
    'History',
    {
      fontFamily: 'monospace',
      fontSize: '17px',
      color: '#d0f2ff',
    }
  );
  container.add(title);

  // ---- Divider line under title ----
  const divider = scene.add.graphics();
  divider.lineStyle(1, 0x34d2ff, 0.35);
  divider.beginPath();
  divider.moveTo(12, 32);
  divider.lineTo(PANEL_WIDTH - 12, 32);
  divider.strokePath();
  container.add(divider);

  // ---- Scrollable entries container (inside panel) ----
  const CONTENT_X = 12;
  const CONTENT_Y = 40;
  const CONTENT_W = PANEL_WIDTH - 24;
  const CONTENT_H = PANEL_HEIGHT - CONTENT_Y - 12;

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

  // ---- IMPORTANT: remove legacy toggle button (the one you said is лишняя) ----
  // History should be opened via the main tab bar (next to Energy), not via a floating button.
  if (scene.historyButton) {
    try { scene.historyButton.destroy(); } catch (_e) {}
    scene.historyButton = null;
  }

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

    const step = 34;
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
  highlightHistoryTargets(scene, null);
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

  // IMPORTANT:
  // We DO NOT simply render all entries in "added order".
  // We build a Dwarf-Fortress-like timeline view:
  //   Discovery -> Main -> 2x Secondary -> Main -> 2x Secondary -> Main -> 2x Secondary -> Main -> Players
  // This keeps the history organic and prevents late-generated road entries
  // (which are often appended after map build) from always appearing at the bottom.
  const ALL = Array.isArray(scene.historyEntries)
    ? scene.historyEntries.slice().sort((a, b) => {
        const ya = (typeof a?.year === 'number') ? a.year : 5000;
        const yb = (typeof b?.year === 'number') ? b.year : 5000;
        if (ya !== yb) return ya - yb;
        // stable tie-breaker
        const ta = String(a?.type || '');
        const tb = String(b?.type || '');
        return ta.localeCompare(tb);
      })
    : [];

  const entries = buildHistoryView(ALL);

  const maxWidth = scene.historyPanelWidth - 24;

  // Precompute city/outpost data for highlighting in text
  const outposts =
    scene.loreState && Array.isArray(scene.loreState.outposts)
      ? scene.loreState.outposts
      : [];
  const outpostNames = outposts
    .map(o => (o && o.name ? String(o.name) : null))
    .filter(Boolean);

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

      // NEW: show POI icon if present
      const icon = getEntryIcon(ev);
      const iconPrefix = icon ? `${icon} ` : '';

      const label = `${iconPrefix}${year} — ${body}`;

      const hasTargets = entryHasTargets(ev);
      const baseColor = hasTargets ? '#6bf7ff' : '#b7d7ff';

      // Split into segments: normal and "city" names (legacy behavior)
      const segments = splitTextByCityNames(label, outposts, outpostNames);

      const normalStyle = {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: baseColor,
        wordWrap: { width: maxWidth },
        lineSpacing: 4,
      };

      const cityStyle = {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        fontStyle: 'bold',
        wordWrap: { width: maxWidth },
        lineSpacing: 4,
      };

      let xCursor = 0;
      let lineBottom = yCursor;

      // Hover highlight for ANY coordinate-bearing entry.
      // (Not just a single hex: highlight ALL referenced targets.)
      const hoverTargets = collectEntryTargets(ev);

      for (const seg of segments) {
        const segStyle = seg.city ? cityStyle : normalStyle;

        const tokens = seg.text.split(/(\s+)/); // words + spaces

        for (const token of tokens) {
          if (!token) continue;

          // Measure token
          const tmp = scene.add.text(0, 0, token, segStyle).setOrigin(0, 0);
          const tokenW = tmp.width;
          tmp.destroy();

          if (
            token.trim().length > 0 &&
            xCursor > 0 &&
            xCursor + tokenW > maxWidth
          ) {
            // New line
            xCursor = 0;
            yCursor = lineBottom + 4;
            lineBottom = yCursor;
          }

          const tObj = scene.add.text(xCursor, yCursor, token, segStyle).setOrigin(0, 0);

          // Click on the whole entry
          if (hasTargets) {
            tObj.setInteractive({ useHandCursor: true });
            tObj.on('pointerdown', () => {
              focusEntry(scene, ev);
            });

            if (hoverTargets && hoverTargets.length) {
              tObj.on('pointerover', () => {
                highlightHistoryTargets(scene, hoverTargets);
              });
              tObj.on('pointerout', () => {
                highlightHistoryTargets(scene, null);
              });
            }
          }

          // City-name segment interactions (kept)
          if (seg.city && token.trim().length > 0) {
            const city = seg.city;
            tObj.setInteractive({ useHandCursor: true });
            tObj.on('pointerover', () => {
              highlightHistoryTargets(scene, [{ q: city.q, r: city.r }]);
            });
            tObj.on('pointerout', () => {
              highlightHistoryTargets(scene, null);
            });
            tObj.on('pointerdown', () => {
              selectHex(scene, city.q, city.r);
            });
          }

          entriesContainer.add(tObj);
          scene.historyEntryTexts.push(tObj);

          xCursor += tObj.width;
          lineBottom = Math.max(lineBottom, yCursor + tObj.height);
        }
      }

      yCursor = lineBottom + 10; // spacing between entries
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

// Split a text label into segments so that outpost/city names
// can be rendered with a different style and interactions.
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

  // Keep non-overlapping matches, preferring earlier and longer ones
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
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
    const city = outposts.find(o => o && o.name === m.name) || null;
    segments.push({ text: text.slice(m.start, m.end), city });
    pos = m.end;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), city: null });
  }
  return segments;
}

/* =========================================================
   Dwarf-Fortress-like ordering helpers
   ========================================================= */

function normType(x) {
  return String(x || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isDiscoveryEntry(e) {
  const t = normType(e?.type);
  return t === 'discovery' || t === 'opening' || t === 'open_island' || t === 'island_discovery';
}

function isPlayersArriveEntry(e) {
  const t = normType(e?.type);
  return t === 'players' || t === 'players_arrive' || t === 'player_arrival' || t === 'arrival' || t === 'spawn_players';
}

function isMainEvent(e) {
  if (!e) return false;
  if (isDiscoveryEntry(e) || isPlayersArriveEntry(e)) return true;

  const t = normType(e.type);
  const pt = normType(e.poiType);

  // Explicit main markers
  if (t === 'major' || t === 'main') return true;

  // Major event categories
  if (t === 'war' || t === 'peace' || t === 'truce' || t === 'ceasefire' || t === 'armistice') return true;
  if (t === 'cataclysm' || t === 'disaster' || t === 'plague' || t === 'collapse') return true;
  if (t === 'crash' || t === 'crash_site' || pt === 'crash_site') return true;

  // Settlement founding / destruction => main
  if (pt === 'settlement' || pt === 'outpost') return true;
  if (pt === 'ruin') return true;
  if (t.includes('settlement') || t.includes('outpost')) return true;
  if (t.includes('ruin') || t.includes('destroy') || t.includes('destroyed')) return true;

  return false;
}

/**
 * Build the displayed list in the strict order:
 *   Discovery -> Main -> 2 Secondary -> Main -> 2 Secondary -> Main -> 2 Secondary -> Main -> Players Arrive
 * We limit to 4 main events between discovery and players.
 * We also drop any entries that happen AFTER players arrive (prevents late road lore from hijacking the end).
 */
function buildHistoryView(allSortedByYear) {
  if (!Array.isArray(allSortedByYear) || allSortedByYear.length === 0) return [];

  const discovery = allSortedByYear.find(isDiscoveryEntry) || null;
  const players = [...allSortedByYear].reverse().find(isPlayersArriveEntry) || null;
  const playersYear = (players && typeof players.year === 'number') ? players.year : Infinity;

  // Only consider "pre-player" events for the timeline body.
  const pre = allSortedByYear.filter(e => {
    const y = (typeof e?.year === 'number') ? e.year : 5000;
    if (players && y > playersYear) return false;
    return true;
  });

  const mainsRaw = pre.filter(e => isMainEvent(e) && !isDiscoveryEntry(e) && !isPlayersArriveEntry(e));
  // Keep at most 4 mains (as per your spec).
  const mains = mainsRaw.slice(0, 4);

  // Everything else becomes secondary candidates.
  const mainSet = new Set(mains);
  const secondary = pre.filter(e => {
    if (e === discovery) return false;
    if (e === players) return false;
    if (mainSet.has(e)) return false;
    if (isDiscoveryEntry(e) || isPlayersArriveEntry(e)) return false;
    return true;
  });

  const out = [];
  if (discovery) out.push(discovery);

  for (let i = 0; i < mains.length; i++) {
    const m = mains[i];
    out.push(m);

    const mYear = (typeof m?.year === 'number') ? m.year : 5000;
    const nextMain = mains[i + 1] || null;
    const nextYear = nextMain ? ((typeof nextMain.year === 'number') ? nextMain.year : 5000) : playersYear;

    // take up to 2 secondary events in this era window
    const secs = secondary
      .filter(s => {
        const y = (typeof s?.year === 'number') ? s.year : 5000;
        return y >= mYear && y < nextYear;
      })
      .slice(0, 2);

    out.push(...secs);
  }

  if (players) out.push(players);

  // De-dup
  const seen = new Set();
  return out.filter(e => {
    if (!e) return false;
    const key = `${normType(e.type)}|${typeof e.year === 'number' ? e.year : 5000}|${String(e.text || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collect ALL coordinate targets for an entry (q/r, from, to, targets[]), de-duped.
 */
function collectEntryTargets(entry) {
  const targets = [];
  if (!entry) return targets;

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

function highlightHistoryTargets(scene, targets) {
  if (!scene || !scene.mapData) return;

  if (!scene.historyHoverGraphics) {
    const g = scene.add.graphics().setDepth(9050);
    g.visible = false;
    scene.historyHoverGraphics = g;
  }
  const g = scene.historyHoverGraphics;

  if (!Array.isArray(targets) || targets.length === 0) {
    g.clear();
    g.visible = false;
    return;
  }

  const size = scene.hexSize || 24;
  const LIFT = scene?.LIFT_PER_LVL ?? 4;
  const offsetX = scene.mapOffsetX || 0;
  const offsetY = scene.mapOffsetY || 0;
  const radius = size * 0.95;

  g.clear();
  g.lineStyle(3, 0xffffff, 1);

  for (const t0 of targets) {
    const q = t0?.q;
    const r = t0?.r;
    if (typeof q !== 'number' || typeof r !== 'number') continue;

    const tile = scene.mapData.find(t => t.q === q && t.r === r);
    if (!tile) continue;

    const eff = effectiveElevationLocal(tile);
    const coord = scene.hexToPixel(q, r, size);
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

// Back-compat
function highlightHistoryHex(scene, q, r) {
  if (typeof q !== 'number' || typeof r !== 'number') {
    return highlightHistoryTargets(scene, null);
  }
  return highlightHistoryTargets(scene, [{ q, r }]);
}

/* =========================================================
   CLICKABLE ENTRY HELPERS
   ========================================================= */

function entryHasTargets(entry) {
  if (typeof entry.q === 'number' && typeof entry.r === 'number') return true;
  if (entry.from && hasCoord(entry.from)) return true;
  if (entry.to && hasCoord(entry.to)) return true;
  if (Array.isArray(entry.targets) && entry.targets.some(hasCoord)) return true;
  return false;
}

function hasCoord(t) {
  return t && typeof t.q === 'number' && typeof t.r === 'number';
}

function focusEntry(scene, entry) {
  const targets = collectEntryTargets(entry);
  if (!targets.length) return;

  // IMPORTANT CHANGE:
  // Clicking a history entry should NOT pan the camera.
  // Instead it should select the referenced hex (same behavior as selecting a hex from the Units panel)
  // and then close the History panel.
  let focusQ = targets[0].q;
  let focusR = targets[0].r;

  // For road-like entries, prefer highlighting the "from" endpoint.
  if (entry.from && hasCoord(entry.from)) {
    focusQ = entry.from.q;
    focusR = entry.from.r;
  }

  selectHex(scene, focusQ, focusR);
  closeHistoryPanel(scene);
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
