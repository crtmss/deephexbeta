// deephexbeta/src/scenes/WorldSceneEconomy.js

/* =========================================================================
   WorldSceneEconomy
   - Centralises resource HUD + resource panel UI for the world scene
   ======================================================================= */

/**
 * Entry point – call from WorldScene (e.g. in create() or setupTurnUI()):
 *   import { setupEconomyUI } from './WorldSceneEconomy.js';
 *   setupEconomyUI(this);
 */
export function setupEconomyUI(scene) {
  // Ensure resource state exists BEFORE drawing HUD / panels
  if (!scene.playerResources) {
    scene.playerResources = {
      food: 0,
      scrap: 0,
      metal: 0,
      components: 0,
      crudeOil: 0,
      energy: 0,
      credits: 0,
    };
  }

  createResourceHUD(scene);
  createTopTabs(scene);
  createResourcesPanel(scene);

  // Attach public helpers on the scene
  scene.updateResourceUI = () => updateResourceUI(scene);
  scene.bumpResource = (key, delta = 1) => bumpResource(scene, key, delta);
  scene.refreshResourcesPanel = () => refreshResourcesPanel(scene);

  // Initial refresh
  updateResourceUI(scene);
  refreshResourcesPanel(scene);

  // Default active tab = Resources
  if (typeof scene.setActiveTopTab === 'function') {
    scene.setActiveTopTab('resources');
  }
}

/* =========================================================================
   Top-left compact resource HUD
   ======================================================================= */

function createResourceHUD(scene) {
  const padding = 8;
  const lineHeight = 18;
  const rows = [
    { key: 'food',       emoji: '🍖', label: 'Food' },
    { key: 'scrap',      emoji: '♻', label: 'Scrap' },
    { key: 'metal',      emoji: '⚙️', label: 'Metal' },
    { key: 'components', emoji: '📦', label: 'Components' },
    { key: 'crudeOil',   emoji: '🛢', label: 'Crude Oil' },
    { key: 'energy',     emoji: '⚡', label: 'Energy' },
    { key: 'credits',    emoji: '💰', label: 'Credits' },
  ];

  const HUD_WIDTH  = 210;
  const HUD_HEIGHT = padding * 2 + lineHeight * rows.length;

  const x = 12;
  const y = 12;

  const container = scene.add.container(x, y)
    .setScrollFactor(0)
    .setDepth(2050);

  // Background FIRST so everything else is above it
  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.92);
  bg.fillRoundedRect(0, 0, HUD_WIDTH, HUD_HEIGHT, 10);
  bg.lineStyle(2, 0x3da9fc, 0.9);
  bg.strokeRoundedRect(0, 0, HUD_WIDTH, HUD_HEIGHT, 10);
  container.add(bg);

  const labelStyle = {
    fontSize: '12px',
    color: '#c4f1ff',
    fontFamily: 'sans-serif',
  };

  const valueStyle = {
    fontSize: '12px',
    color: '#ffffff',
    fontFamily: 'monospace',
  };

  const iconStyle = {
    fontSize: '14px',
    color: '#ffffff',
    fontFamily: 'sans-serif',
  };

  const texts = {};
  const iconX = padding + 2;
  const labelX = iconX + 20;
  const valueX = HUD_WIDTH - padding;

  let rowY = padding + lineHeight / 2;

  for (const row of rows) {
    // Icon column – perfectly vertical
    const icon = scene.add.text(
      iconX,
      rowY,
      row.emoji,
      iconStyle
    ).setOrigin(0, 0.5);

    const label = scene.add.text(
      labelX,
      rowY,
      row.label,
      labelStyle
    ).setOrigin(0, 0.5);

    const value = scene.add.text(
      valueX,
      rowY,
      '0',
      valueStyle
    ).setOrigin(1, 0.5);

    container.add(icon);
    container.add(label);
    container.add(value);

    texts[row.key] = { icon, label, value };

    rowY += lineHeight;
  }

  scene.resourceHUD = {
    container,
    bg,
    entries: texts,
  };
}

function updateResourceUI(scene) {
  if (!scene.resourceHUD || !scene.resourceHUD.entries) return;
  const r = scene.playerResources || {};
  const entries = scene.resourceHUD.entries;

  const safe = v => (typeof v === 'number' ? v : 0);

  const setVal = (key, prop) => {
    const entry = entries[key];
    if (!entry) return;
    entry.value.setText(String(safe(r[key])));
  };

  setVal('food');
  setVal('scrap');
  setVal('metal');
  setVal('components');
  setVal('crudeOil');
  setVal('energy');
  setVal('credits');
}

function bumpResource(scene, key, delta = 1) {
  if (!scene.playerResources) scene.playerResources = {};
  scene.playerResources[key] = (scene.playerResources[key] || 0) + delta;
  updateResourceUI(scene);
  refreshResourcesPanel(scene);

  const entry = scene.resourceHUD?.entries?.[key];
  if (!entry) return;

  const targets = [entry.icon, entry.label, entry.value];
  targets.forEach(obj => {
    obj.setScale(1);
    scene.tweens.add({
      targets: obj,
      scale: 1.13,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  });
}

/* =========================================================================
   Top-right tabs: Resources / Logistics
   ======================================================================= */

function createTopTabs(scene) {
  const tabWidth = 120;
  const tabHeight = 28;
  const marginRight = 20;

  const x = scene.scale.width - marginRight - tabWidth * 2;
  const y = 16;

  const container = scene.add.container(x, y)
    .setScrollFactor(0)
    .setDepth(2050);

  // Background bar
  const bg = scene.add.graphics();
  const totalWidth = tabWidth * 2;
  const totalHeight = tabHeight + 6;
  bg.fillStyle(0x0b1925, 0.95);
  bg.fillRoundedRect(0, 0, totalWidth, totalHeight, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, totalWidth, totalHeight, 12);
  container.add(bg);

  const tabStyleInactive = {
    fontSize: '13px',
    color: '#8fb6d9',
    fontFamily: 'sans-serif',
  };

  const tabStyleActive = {
    fontSize: '13px',
    color: '#ffffff',
    fontFamily: 'sans-serif',
  };

  const makeTab = (label, offsetX) => {
    const g = scene.add.graphics();
    g.fillStyle(0x123047, 0.9);
    g.fillRoundedRect(offsetX, 3, tabWidth, tabHeight, 8);
    g.lineStyle(1, 0x3da9fc, 1);
    g.strokeRoundedRect(offsetX, 3, tabWidth, tabHeight, 8);

    const t = scene.add.text(
      offsetX + tabWidth / 2,
      3 + tabHeight / 2,
      label,
      tabStyleInactive
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    container.add(g);
    container.add(t);

    return { bg: g, label: t };
  };

  const resTab = makeTab('Resources', 4);
  const logTab = makeTab('Logistics', tabWidth + 4);

  container.resTab = resTab;
  container.logTab = logTab;

  scene.topTabs = container;

  // Helper to update tab visuals
  function updateTabVisual(active) {
    const setTab = (tab, isActive, offsetX) => {
      if (!tab) return;
      tab.bg.clear();
      tab.bg.fillStyle(isActive ? 0x1b4b72 : 0x123047, 0.95);
      tab.bg.fillRoundedRect(offsetX, 3, tabWidth, tabHeight, 8);
      tab.bg.lineStyle(1, 0x3da9fc, 1);
      tab.bg.strokeRoundedRect(offsetX, 3, tabWidth, tabHeight, 8);
      tab.label.setStyle(isActive ? tabStyleActive : tabStyleInactive);
    };

    setTab(resTab, active === 'resources', 4);
    setTab(logTab, active === 'logistics', tabWidth + 4);
  }

  // Public API on scene
  scene.setActiveTopTab = function (which) {
    updateTabVisual(which);

    if (which === 'resources') {
      if (scene.resourcesPanel) scene.resourcesPanel.visible = true;
      if (scene.logisticsPanel) scene.logisticsPanel.visible = false;
    } else if (which === 'logistics') {
      if (scene.resourcesPanel) scene.resourcesPanel.visible = false;
      if (scene.logisticsPanel) scene.logisticsPanel.visible = true;
    }
  };

  // Click handlers
  resTab.label.on('pointerdown', () => {
    scene.openResourcesPanel?.();
    scene.closeLogisticsPanel?.();
    scene.setActiveTopTab('resources');
  });

  logTab.label.on('pointerdown', () => {
    scene.openLogisticsPanel?.();
    scene.closeResourcesPanel?.();
    scene.setActiveTopTab('logistics');
  });
}

/* =========================================================================
   Resources Panel (simple global summary on the right)
   ======================================================================= */

function createResourcesPanel(scene) {
  const WIDTH = 260;
  const HEIGHT = 220;
  const marginRight = 20;

  const x = scene.scale.width - marginRight - WIDTH;
  const y = 50;

  const container = scene.add.container(x, y)
    .setScrollFactor(0)
    .setDepth(2050);

  // Background FIRST so other content is clearly above it
  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.96);
  bg.fillRoundedRect(0, 0, WIDTH, HEIGHT, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, WIDTH, HEIGHT, 12);
  container.add(bg);

  const title = scene.add.text(
    12,
    8,
    'Resources',
    {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
    }
  ).setOrigin(0, 0);
  container.add(title);

  const headerType = scene.add.text(
    32,
    32,
    'Type',
    {
      fontSize: '12px',
      color: '#8fb6d9',
      fontFamily: 'sans-serif',
    }
  ).setOrigin(0, 0);
  const headerVal = scene.add.text(
    WIDTH - 12,
    32,
    'Amount',
    {
      fontSize: '12px',
      color: '#8fb6d9',
      fontFamily: 'sans-serif',
    }
  ).setOrigin(1, 0);
  container.add(headerType);
  container.add(headerVal);

  const rowStyleLabel = {
    fontSize: '12px',
    color: '#c4f1ff',
    fontFamily: 'sans-serif',
  };
  const rowStyleValue = {
    fontSize: '12px',
    color: '#ffffff',
    fontFamily: 'monospace',
  };
  const rowStyleIcon = {
    fontSize: '13px',
    color: '#ffffff',
    fontFamily: 'sans-serif',
  };

  const rows = [
    { key: 'food',       icon: '🍖', label: 'Food' },
    { key: 'scrap',      icon: '♻', label: 'Scrap' },
    { key: 'metal',      icon: '⚙️', label: 'Metal' },
    { key: 'components', icon: '📦', label: 'Components' },
    { key: 'crudeOil',   icon: '🛢', label: 'Crude Oil' },
    { key: 'energy',     icon: '⚡', label: 'Energy' },
    { key: 'credits',    icon: '💰', label: 'Credits' },
  ];

  const texts = {};
  let rowY = 52;

  const iconX = 12;
  const labelX = 32;
  const valueX = WIDTH - 12;

  for (const row of rows) {
    const icon = scene.add.text(
      iconX,
      rowY + 9, // center icon in 18px row
      row.icon,
      rowStyleIcon
    ).setOrigin(0, 0.5);

    const lbl = scene.add.text(
      labelX,
      rowY,
      row.label,
      rowStyleLabel
    ).setOrigin(0, 0);

    const val = scene.add.text(
      valueX,
      rowY,
      '0',
      rowStyleValue
    ).setOrigin(1, 0);

    container.add(icon);
    container.add(lbl);
    container.add(val);

    texts[row.key] = { icon, label: lbl, value: val };

    rowY += 18;
  }

  container.visible = true; // visibility toggled via tabs

  scene.resourcesPanel = container;
  scene.resourcesPanelTexts = texts;
}

function refreshResourcesPanel(scene) {
  if (!scene.resourcesPanelTexts || !scene.playerResources) return;

  const res = scene.playerResources;
  const texts = scene.resourcesPanelTexts;

  const safe = v => (typeof v === 'number' ? v : 0);

  const setVal = key => {
    const entry = texts[key];
    if (!entry) return;
    entry.value.setText(String(safe(res[key])));
  };

  setVal('food');
  setVal('scrap');
  setVal('metal');
  setVal('components');
  setVal('crudeOil');
  setVal('energy');
  setVal('credits');
}
