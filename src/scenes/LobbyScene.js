// deephexbeta/src/scenes/LobbyScene.js
import { createLobby, joinLobby } from '../net/LobbyManager.js';
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getColorForTerrain } from './WorldSceneMap.js';

// --- helper functions matching WorldSceneMap.js ---
function hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

// Deterministic geography and biome generation preview
function getWorldSummary(seed) {
  const rng = xorshift32(hashStr32(String(seed ?? 'default')));
  const geoRoll = rng();
  const bioRoll = rng();

  let geography;
  if (geoRoll < 0.15) geography = 'Big Lagoon';
  else if (geoRoll < 0.30) geography = 'Central Lake';
  else if (geoRoll < 0.50) geography = 'Small Bays';
  else if (geoRoll < 0.70) geography = 'Scattered Terrain';
  else if (geoRoll < 0.85) geography = 'Diagonal Island';
  else geography = 'Multiple Islands';

  let biome;
  if (bioRoll < 0.20) biome = 'Icy Biome';
  else if (bioRoll < 0.40) biome = 'Volcanic Biome';
  else if (bioRoll < 0.60) biome = 'Desert Biome';
  else if (bioRoll < 0.80) biome = 'Temperate Biome';
  else biome = 'Swamp Biome';

  return { geography, biome };
}

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
    nameInput.setDepth(1000);
    nameInput.node.placeholder = 'Your name';
    nameInput.node.maxLength = 16;

    // Seed input
    this.add.text(400, 220, 'Map Seed (6 digits):', { fontSize: '18px', fill: '#ffffff' });
    const codeInput = this.add.dom(640, 250, 'input');
    codeInput.setOrigin(0.5);
    codeInput.setDepth(1000);
    codeInput.node.placeholder = '000000';
    codeInput.node.maxLength = 6;
    codeInput.node.style.textAlign = 'center';
    codeInput.node.style.width = '100px';

    // 🎲 Random Seed button
    const randomBtn = this.add.dom(770, 250, 'button', {
      backgroundColor: '#444',
      color: '#fff',
      fontSize: '14px',
      padding: '6px 10px',
      border: 'none',
      cursor: 'pointer'
    }, '🎲 Random Seed');
    randomBtn.setOrigin(0, 0.5);
    randomBtn.setDepth(1000);

    // Random 6-digit seed on load
    const randomSeed = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    codeInput.node.value = randomSeed;

    // Preview & summary labels
    this.add.text(870, 130, 'Map Preview', {
      fontSize: '18px',
      fill: '#ffffff'
    });

    this.previewSize = 80;
    this.previewContainer = this.add.container(900, 200);
    this.previewGraphics = this.add.graphics();
    this.previewContainer.add(this.previewGraphics);

    // Text boxes showing geography and biome
    this.geographyText = this.add.text(820, 380, '', {
      fontSize: '18px',
      fill: '#aadfff'
    });
    this.biomeText = this.add.text(820, 410, '', {
      fontSize: '18px',
      fill: '#aadfff'
    });

    // Numeric input validation and preview update
    codeInput.node.addEventListener('input', () => {
      let value = codeInput.node.value.replace(/\D/g, '');
      if (value.length > 6) value = value.slice(0, 6);
      codeInput.node.value = value;
      this.updatePreview(codeInput.node.value.padStart(6, '0'));
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
      const newSeed = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
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
      cursor: 'pointer'
    }, 'Host Game');
    hostBtn.setDepth(1000);

    // Join button
    const joinBtn = this.add.dom(720, 330, 'button', {
      backgroundColor: '#1E90FF',
      color: '#fff',
      fontSize: '18px',
      padding: '10px 20px',
      border: 'none',
      cursor: 'pointer'
    }, 'Join Game');
    joinBtn.setDepth(1000);

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

  // Draw small map preview
  updatePreview(seedString) {
    if (!this.previewGraphics) return;
    this.previewGraphics.clear();

    // create small hex map
    const hexMap = new HexMap(25, 25, seedString);
    const mapData = hexMap.getMap();

    const size = 6;

    const hexToPixel = (q, r, size) => {
      const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
      const y = size * 1.5 * r;
      return { x, y };
    };

    const w = this.previewSize;
    const offsetX = -w;
    const offsetY = -w / 1.2;

    for (const tile of mapData) {
      const { q, r, type, elevation } = tile;
      const { x, y } = hexToPixel(q, r, size);
      const color = getColorForTerrain
        ? getColorForTerrain(type, elevation)
        : 0x999999;

      this.drawHex(this.previewGraphics, x + offsetX, y + offsetY, size, color);
    }

    // Update geography/biome text
    const { geography, biome } = getWorldSummary(seedString);
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
