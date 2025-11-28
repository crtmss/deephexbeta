// deephexbeta/src/scenes/WorldSceneEconomy.js

/* =========================================================================
   WorldSceneEconomy
   - Centralises resource HUD + resource panel UI for the world scene
   - Keeps visual style & behaviour self-contained and attach helpers on scene
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
  const HUD_WIDTH = 190;
  const HUD_HEIGHT = 8 + lineHeight * 7 + 8;

  const x = 12;
  const y = 12;

  const container = scene.add.container(x, y)
    .setScrollFactor(0)
    .setDepth(2050);

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.9);
  bg.fillRoundedRect(0, 0, HUD_WIDTH, HUD_HEIGHT, 10);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, HUD_WIDTH, HUD_HEIGHT, 10);

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

  const rows = [
    { key: 'food',       label: '🍖 Food'       },
    { key: 'scrap',      label: '♻ Scrap'      },
    { key: 'metal',      label: '⚙ Metal'      },
    { key: 'components', label: '📦 Components' },
    { key: 'crudeOil',   label: '🛢 Oil'        },
    { key: 'energy',     label: '⚡ Energy'     },
    { key: 'credits',    label: '💰 Credits'    },
  ];

  const texts = {};

  let rowY = padding;
  for (const row of rows) {
    const label = scene.add.text(
      padding,
      rowY,
      row.label,
      labelStyle
    ).setOrigin(0, 0);

    const value = scene.add.text(
      HUD_WIDTH - padding,
      rowY,
      '0',
      valueStyle
    ).setOrigin(1, 0);

    container.add(label);
    container.add(value);

    texts[row.key] = value;
    rowY += lineHeight;
  }

  container.add(bg);
  bg.setDepth(-1);

  scene.resourceHUD = container;
  scene.resourceHUDTexts = texts;
}

function updateResourceUI(scene) {
  if (!scene.playerResources || !scene.resourceHUDTexts) return;

  const res = scene.playerResources;
  const texts = scene.resourceHUDTexts;

  const safe = (v) => (typeof v === 'number' ? v : 0);

  if (texts.food)       texts.food.setText(String(safe(res.food)));
  if (texts.scrap)      texts.scrap.setText(String(safe(res.scrap)));
  if (texts.metal)      texts.metal.setText(String(safe(res.metal)));
  if (texts.components) texts.components.setText(String(safe(res.components)));
  if (texts.crudeOil)   texts.crudeOil.setText(String(safe(res.crudeOil)));
  if (texts.energy)     texts.energy.setText(String(safe(res.energy)));
  if (texts.credits)    texts.credits.setText(String(safe(res.credits)));
}

function bumpResource(scene, key, delta = 1) {
  if (!scene.playerResources) {
    scene.playerResources = {};
  }
  const current = scene.playerResources[key] || 0;
  scene.playerResources[key] = current + delta;
  updateResourceUI(scene);
  refreshResourcesPanel(scene);
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
    const setTab = (tab, isActive) => {
      if (!tab) return;
      tab.bg.clear();
      tab.bg.fillStyle(isActive ? 0x1b4b72 : 0x123047, 0.95);
      tab.bg.fillRoundedRect(
        tab === resTab ? 4 : tabWidth + 4,
        3,
        tabWidth,
        tabHeight,
        8
      );
      tab.bg.lineStyle(1, 0x3da9fc, 1);
      tab.bg.strokeRoundedRect(
        tab === resTab ? 4 : tabWidth + 4,
        3,
        tabWidth,
        tabHeight,
        8
      );
      tab.label.setStyle(isActive ? tabStyleActive : tabStyleInactive);
    };

    setTab(resTab, active === 'resources');
    setTab(logTab, active === 'logistics');
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
    scene.setActiveTopTab('resources');
  });

  logTab.label.on('pointerdown', () => {
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

  const header = scene.add.text(
    12,
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
  container.add(header);
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

  const rows = [
    { key: 'food',       label: '🍖 Food'       },
    { key: 'scrap',      label: '♻ Scrap'      },
    { key: 'metal',      label: '⚙ Metal'      },
    { key: 'components', label: '📦 Components' },
    { key: 'crudeOil',   label: '🛢 Crude Oil'  },
    { key: 'energy',     label: '⚡ Energy'     },
    { key: 'credits',    label: '💰 Credits'    },
  ];

  const texts = {};
  let rowY = 52;

  for (const row of rows) {
    const lbl = scene.add.text(
      12,
      rowY,
      row.label,
      rowStyleLabel
    ).setOrigin(0, 0);

    const val = scene.add.text(
      WIDTH - 12,
      rowY,
      '0',
      rowStyleValue
    ).setOrigin(1, 0);

    container.add(lbl);
    container.add(val);
    texts[row.key] = val;

    rowY += 18;
  }

  container.visible = true; // will be toggled by tabs later

  scene.resourcesPanel = container;
  scene.resourcesPanelTexts = texts;
}

function refreshResourcesPanel(scene) {
  if (!scene.resourcesPanelTexts || !scene.playerResources) return;

  const res = scene.playerResources;
  const texts = scene.resourcesPanelTexts;

  const safe = (v) => (typeof v === 'number' ? v : 0);

  if (texts.food)       texts.food.setText(String(safe(res.food)));
  if (texts.scrap)      texts.scrap.setText(String(safe(res.scrap)));
  if (texts.metal)      texts.metal.setText(String(safe(res.metal)));
  if (texts.components) texts.components.setText(String(safe(res.components)));
  if (texts.crudeOil)   texts.crudeOil.setText(String(safe(res.crudeOil)));
  if (texts.energy)     texts.energy.setText(String(safe(res.energy)));
  if (texts.credits)    texts.credits.setText(String(safe(res.credits)));
}
