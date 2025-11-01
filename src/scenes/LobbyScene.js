// deephexbeta/src/scenes/LobbyScene.js
import { createLobby, joinLobby } from '../net/LobbyManager.js';
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getColorForTerrain } from './WorldSceneMap.js';

/* -------------------- helpers used only for preview labels -------------------- */

const keyOf = (q, r) => `${q},${r}`;
const inBounds = (q, r, w, h) => q >= 0 && q < w && r >= 0 && r < h;

// axial odd-r neighbor deltas
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

function classifyBiomeFromTiles(tiles) {
  const totalLand = tiles.filter(t => t.type !== 'water').length || 1;

  const counts = tiles.reduce((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});

  const pct = name => (counts[name] || 0) / totalLand;

  const icy = pct('ice') + pct('snow');
  const ash = pct('volcano_ash');
  const sand = pct('sand');
  const swampy = pct('swamp') + pct('mud');

  if (icy >= 0.50) return 'Icy Biome';
  if (ash >= 0.50) return 'Volcanic Biome';
  if (sand >= 0.50) return 'Desert Biome';
  if (swampy >= 0.45 && icy < 0.05 && ash < 0.05) return 'Swamp Biome';
  return 'Temperate Biome';
}

function classifyGeographyFromTiles(tiles, width, height) {
  // Build quick grid
  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const isLand = (q, r) => {
    const t = byKey.get(keyOf(q, r));
    return !!t && t.type !== 'water';
  };

  // Connected components of land
  const seen = new Set();
  let components = 0;
  for (const t of tiles) {
    if (t.type === 'water') continue;
    const k = keyOf(t.q, t.r);
    if (seen.has(k)) continue;
    components++;
    // BFS
    const qd = [t];
    seen.add(k);
    while (qd.length) {
      const cur = qd.pop();
      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const nq = cur.q + dq, nr = cur.r + dr;
        if (!inBounds(nq, nr, width, height)) continue;
        const nk = keyOf(nq, nr);
        if (seen.has(nk)) continue;
        const nt = byKey.get(nk);
        if (!nt || nt.type === 'water') continue;
        seen.add(nk);
        qd.push(nt);
      }
    }
  }

  if (components >= 2) return 'Multiple Islands';

  // Single island heuristics
  // 1) Central lake (water inside inner box ~40%..60% of map)
  const innerQ0 = Math.floor(width * 0.2);
  const innerQ1 = Math.ceil(width * 0.8);
  const innerR0 = Math.floor(height * 0.2);
  const innerR1 = Math.ceil(height * 0.8);

  let innerWater = 0, innerTotal = 0;
  for (let r = innerR0; r < innerR1; r++) {
    for (let q = innerQ0; q < innerQ1; q++) {
      const t = byKey.get(keyOf(q, r));
      if (!t) continue;
      innerTotal++;
      if (t.type === 'water') innerWater++;
    }
  }
  const innerWaterRatio = innerTotal ? innerWater / innerTotal : 0;

  if (innerWaterRatio >= 0.12) {
    // If there’s *lots* of inner water, call it lagoon; otherwise central lake
    return innerWaterRatio >= 0.18 ? 'Big Lagoon' : 'Central Lake';
  }

  // 2) Scattered terrain via “riveriness”: count water edges cutting through land
  let riverEdges = 0;
  for (const t of tiles) {
    if (t.type === 'water') continue;
    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const n = byKey.get(keyOf(t.q + dq, t.r + dr));
      if (n && n.type === 'water') riverEdges++;
    }
  }
  const avgRiverEdgesPerLand = riverEdges / ((tiles.length - innerWater) || 1);
  if (avgRiverEdgesPerLand >= 1.2) return 'Scattered Terrain';

  // 3) Diagonal shape: PCA-ish — variance ratio with angle
  const land = tiles.filter(t => t.type !== 'water');
  const cx = land.reduce((s, t) => s + t.q, 0) / (land.length || 1);
  const cy = land.reduce((s, t) => s + t.r, 0) / (land.length || 1);
  let Sxx = 0, Syy = 0, Sxy = 0;
  for (const t of land) {
    const dx = t.q - cx, dy = t.r - cy;
    Sxx += dx * dx; Syy += dy * dy; Sxy += dx * dy;
  }
  const tr = Sxx + Syy;
  const det = Sxx * Syy - Sxy * Sxy;
  const disc = Math.max(0, tr * tr - 4 * det);
  const lambda1 = (tr + Math.sqrt(disc)) / 2;
  const lambda2 = (tr - Math.sqrt(disc)) / 2;
  const ratio = lambda2 > 0 ? (lambda1 / lambda2) : 99;
  const angleRad = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy); // principal axis
  const angleDeg = Math.abs(angleRad * 180 / Math.PI);
  if (ratio >= 1.6 && angleDeg >= 20 && angleDeg <= 70) return 'Diagonal Island';

  // 4) Otherwise call it Small Bays (since “Normal round island” was removed)
  return 'Small Bays';
}

/* -------------------------------- Lobby Scene -------------------------------- */

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
  }

  async create() {
    this.add.text(500, 60, 'DeepHex Multiplayer Lobby', {
      fontSize: '28px',
      fill: '#ffffff'
    });

    // Supabase health check
    try {
      const { error: pingError } = await supabase.from('lobbies').select('id').limit(1);
      if (pingError) console.error('[Supabase ERROR] Cannot connect:', pingError.message);
      else console.log('[Supabase OK] Connection active.');
    } catch (err) {
      console.error('[Supabase EXCEPTION] Connection check failed:', err.message);
    }

    // Name input
    this.add.text(460, 130, 'Your Name:', { fontSize: '18px', fill: '#ffffff' });
    const nameInput = this.add.dom(640, 160, 'input');
    nameInput.setOrigin(0.5);
    nameInput.setDepth(1200);
    nameInput.node.placeholder = 'Your name';
    nameInput.node.maxLength = 16;

    // Seed input
    this.add.text(400, 220, 'Map Seed (6 digits):', { fontSize: '18px', fill: '#ffffff' });
    const codeInput = this.add.dom(640, 250, 'input');
    codeInput.setOrigin(0.5);
    codeInput.setDepth(1200);
    codeInput.node.placeholder = '000000';
    codeInput.node.maxLength = 6;
    codeInput.node.style.textAlign = 'center';
    codeInput.node.style.width = '110px';

    // 🎲 Random Seed button
    const randomBtn = this.add.dom(640, 290, 'button', {
      backgroundColor: '#555',
      color: '#fff',
      fontSize: '14px',
      padding: '8px 14px',
      border: '1px solid #888',
      borderRadius: '6px',
      cursor: 'pointer'
    }, '🎲 Random Seed');
    randomBtn.setOrigin(0.5);
    randomBtn.setDepth(1250);
    randomBtn.setScrollFactor(0);

    // Random 6-digit seed on load
    const randomSeed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    codeInput.node.value = randomSeed;

    // Preview title
    this.add.text(870, 130, 'Map Preview', {
      fontSize: '18px',
      fill: '#ffffff'
    });

    // Hex-only preview
    this.previewSize = 80;
    this.previewContainer = this.add.container(900, 200);
    this.previewGraphics = this.add.graphics();
    this.previewContainer.add(this.previewGraphics);

    // Labels that reflect the *actual* generated tiles
    this.geographyText = this.add.text(820, 380, '', {
      fontSize: '18px',
      fill: '#aadfff'
    });
    this.biomeText = this.add.text(820, 410, '', {
      fontSize: '18px',
      fill: '#aadfff'
    });

    // Numeric enforcement and live preview
    codeInput.node.addEventListener('input', () => {
      let value = codeInput.node.value.replace(/\D/g, '');
      if (value.length > 6) value = value.slice(0, 6);
      codeInput.node.value = value;
      this.updatePreview(value.padStart(6, '0'));
    });
    codeInput.node.addEventListener('blur', () => {
      let value = codeInput.node.value.trim();
      if (!value) value = '000000';
      codeInput.node.value = value.padStart(6, '0');
      this.updatePreview(codeInput.node.value);
    });

    // Random button handler
    randomBtn.addListener('click');
    randomBtn.on('click', () => {
      const newSeed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      codeInput.node.value = newSeed;
      this.updatePreview(newSeed);
    });

    // Initial preview
    this.updatePreview(randomSeed);

    // Host button
    const hostBtn = this.add.dom(540, 330, 'button', {
      backgroundColor: '#006400',
      color: '#fff',
      fontSize: '18px',
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer'
    }, 'Host Game');
    hostBtn.setDepth(1200);

    // Join button
    const joinBtn = this.add.dom(720, 330, 'button', {
      backgroundColor: '#1E90FF',
      color: '#fff',
      fontSize: '18px',
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer'
    }, 'Join Game');
    joinBtn.setDepth(1200);

    // Host logic
    hostBtn.addListener('click');
    hostBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      const code = codeInput.node.value.trim().padStart(6, '0');
      if (!name || !/^\d{6}$/.test(code)) {
        alert('Enter your name and a 6-digit numeric seed.');
        return;
      }
      const { data, error } = await createLobby(name, code);
      if (error) {
        console.error('[Supabase ERROR] Failed to create lobby:', error.message);
        alert('Failed to create lobby. Check console for details.');
        return;
      }
      this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: true });
    });

    // Join logic
    joinBtn.addListener('click');
    joinBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      const code = codeInput.node.value.trim().padStart(6, '0');
      if (!name || !/^\d{6}$/.test(code)) {
        alert('Enter your name and a 6-digit numeric seed.');
        return;
      }
      const { data, error } = await joinLobby(name, code);
      if (error) {
        console.error('[Supabase ERROR] Failed to join lobby:', error.message);
        alert('Failed to join lobby. Check console for details.');
        return;
      }
      this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: false });
    });
  }

  // Draw small map preview (same HexMap as the game)
  updatePreview(seedString) {
    if (!this.previewGraphics) return;
    this.previewGraphics.clear();

    const width = 25, height = 25;
    const hexMap = new HexMap(width, height, seedString);
    const mapData = hexMap.getMap();

    // flat-top axial pixel conversion (non-isometric for a compact preview)
    const size = 6;
    const hexToPixel = (q, r, s) => {
      const x = s * Math.sqrt(3) * (q + 0.5 * (r & 1));
      const y = s * 1.5 * r;
      return { x, y };
    };

    // center preview
    const gridW = size * Math.sqrt(3) * (width + 0.5);
    const gridH = size * 1.5 * (height + 0.5);
    const offsetX = -gridW * 0.45;
    const offsetY = -gridH * 0.38;

    for (const tile of mapData) {
      const { x, y } = hexToPixel(tile.q, tile.r, size);
      const color = getColorForTerrain
        ? getColorForTerrain(tile.type, tile.elevation)
        : 0x999999;
      this.drawHex(this.previewGraphics, x + offsetX, y + offsetY, size, color);
    }

    // Labels derived from the *actual* map tiles → matches in-game
    const biome = classifyBiomeFromTiles(mapData);
    const geography = classifyGeographyFromTiles(mapData, width, height);
    this.geographyText.setText(`🌍 Geography: ${geography}`);
    this.biomeText.setText(`🌿 Biome: ${biome}`);
  }

  drawHex(graphics, x, y, size, color) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const angle = Phaser.Math.DegToRad(60 * i - 30);
      corners.push({
        x: x + size * Math.cos(angle),
        y: y + size * Math.sin(angle)
      });
    }
    graphics.fillStyle(color, 1);
    graphics.beginPath();
    graphics.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) graphics.lineTo(corners[i].x, corners[i].y);
    graphics.closePath();
    graphics.fillPath();
  }
}
