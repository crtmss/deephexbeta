// deephexbeta/src/scenes/LobbyScene.js
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getColorForTerrain } from './WorldSceneMap.js';

/* ---------- fallback helpers (used only if worldMeta is missing) ---------- */
const keyOf = (q, r) => `${q},${r}`;
const inBounds = (q, r, w, h) => q >= 0 && q < w && r >= 0 && r < h;
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[+0,+1],[-1,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}
function classifyBiomeFromTiles(tiles) {
  const land = tiles.filter(t => t.type !== 'water');
  const total = land.length || 1;
  const cnt = tiles.reduce((a, t) => (a[t.type] = (a[t.type] || 0) + 1, a), {});
  const pct = n => (cnt[n] || 0) / total;

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
  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const seen = new Set();
  let comps = 0;

  for (const t of tiles) {
    if (t.type === 'water') continue;
    const k = keyOf(t.q, t.r);
    if (seen.has(k)) continue;

    comps++;
    const qd = [t];
    seen.add(k);

    while (qd.length) {
      const cur = qd.pop();
      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const nq = cur.q + dq, nr = cur.r + dr, nk = keyOf(nq, nr);
        if (!inBounds(nq, nr, width, height) || seen.has(nk)) continue;
        const nt = byKey.get(nk);
        if (!nt || nt.type === 'water') continue;
        seen.add(nk);
        qd.push(nt);
      }
    }
  }

  if (comps >= 2) return 'Multiple Islands';

  // inner-water heuristic
  const innerQ0 = Math.floor(width * 0.2),  innerQ1 = Math.ceil(width * 0.8);
  const innerR0 = Math.floor(height * 0.2), innerR1 = Math.ceil(height * 0.8);
  let innerWater = 0, innerTot = 0;

  for (let r = innerR0; r < innerR1; r++)
    for (let q = innerQ0; q < innerQ1; q++) {
      const t = byKey.get(keyOf(q, r));
      if (!t) continue;
      innerTot++;
      if (t.type === 'water') innerWater++;
    }

  const innerRatio = innerTot ? innerWater / innerTot : 0;
  if (innerRatio >= 0.12) return innerRatio >= 0.18 ? 'Big Lagoon' : 'Central Lake';

  // riveriness
  let riverEdges = 0;
  let landCount = 0;
  for (const t of tiles) {
    if (t.type === 'water') continue;
    landCount++;
    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const n = byKey.get(keyOf(t.q + dq, t.r + dr));
      if (n && n.type === 'water') riverEdges++;
    }
  }

  if ((riverEdges / Math.max(1, landCount)) >= 1.2) return 'Scattered Terrain';

  // diagonal PCA check
  const land2 = tiles.filter(t => t.type !== 'water');
  const cx = land2.reduce((s, t) => s + t.q, 0) / Math.max(1, land2.length);
  const cy = land2.reduce((s, t) => s + t.r, 0) / Math.max(1, land2.length);

  let Sxx = 0, Syy = 0, Sxy = 0;
  for (const t of land2) {
    const dx = t.q - cx, dy = t.r - cy;
    Sxx += dx * dx; Syy += dy * dy; Sxy += dx * dy;
  }

  const tr = Sxx + Syy;
  const det = Sxx * Syy - Sxy * Sxy;
  const disc = Math.max(0, tr * tr - 4 * det);
  const lambda1 = (tr + Math.sqrt(disc)) / 2;
  const lambda2 = (tr - Math.sqrt(disc)) / 2;

  const ratio = lambda2 > 0 ? lambda1 / lambda2 : 99;
  const angle = Math.abs(0.5 * Math.atan2(2 * Sxy, Sxx - Syy) * 180 / Math.PI);

  if (ratio >= 1.6 && angle >= 20 && angle <= 70) return 'Diagonal Island';

  return 'Small Bays';
}

/* ------------------------------ LOBBY SCENE -------------------------------- */

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
    this.waitEvent = null;
    this.waitStatusText = null;
  }

  async create() {
    // DOM overlay non-blocking
    if (this.game && this.game.domContainer) {
      const dc = this.game.domContainer;
      dc.style.pointerEvents = 'none';
      dc.style.zIndex = '10';
      dc.style.background = 'transparent';
    }

    // Title
    this.add.text(500, 60, 'DeepHex Multiplayer Lobby', {
      fontSize: '28px', fill: '#ffffff'
    }).setScrollFactor(0);

    // Supabase connectivity check (optional but useful)
    try {
      const { error: pingError } =
        await supabase.from('lobbies').select('id').limit(1);
      if (pingError)
        console.error('[Supabase ERROR] Cannot connect:', pingError.message);
      else console.log('[Supabase OK] Connection active.');
    } catch (err) {
      console.error('[Supabase EXCEPTION] Connection check failed:', err.message);
    }

    /* --- Input fields --- */
    this.add.text(460, 130, 'Your Name:', { fontSize: '18px', fill: '#ffffff' });
    const nameInput = this.add.dom(640, 160, 'input')
      .setOrigin(0.5).setDepth(1200).setScrollFactor(0);

    nameInput.node.placeholder = 'Your name';
    nameInput.node.maxLength = 16;

    Object.assign(nameInput.node.style, {
      pointerEvents: 'auto',
      width: '260px',
      height: '36px',
      fontSize: '18px',
      padding: '4px 10px',
      borderRadius: '8px',
      border: '1px solid #88a',
      background: '#0b0f1a',
      color: '#e7f1ff',
      outline: 'none'
    });

    this.add.text(400, 220, 'Map Seed (6 digits):', {
      fontSize: '18px', fill: '#ffffff'
    }).setScrollFactor(0);

    const codeInput = this.add.dom(640, 250, 'input')
      .setOrigin(0.5).setDepth(1200).setScrollFactor(0);

    codeInput.node.placeholder = '000000';
    codeInput.node.maxLength = 6;

    Object.assign(codeInput.node.style, {
      pointerEvents: 'auto',
      width: '110px',
      height: '36px',
      fontSize: '18px',
      textAlign: 'center',
      padding: '4px 10px',
      borderRadius: '8px',
      border: '1px solid #88a',
      background: '#0b0f1a',
      color: '#e7f1ff',
      outline: 'none'
    });

    /* --- Random Seed --- */
    const randomBtn = this.add.dom(
      640,
      290,
      'button',
      {
        backgroundColor: '#555',
        color: '#fff',
        fontSize: '14px',
        padding: '8px 14px',
        border: '1px solid #888',
        borderRadius: '6px',
        cursor: 'pointer',
        pointerEvents: 'auto'
      },
      '🎲 Random Seed'
    ).setOrigin(0.5).setDepth(1250).setScrollFactor(0);

    /* --- Players selector --- */
    this.add.text(400, 330, 'Select players (1–4):', {
      fontSize: '18px', fill: '#ffffff'
    }).setScrollFactor(0);

    const playersSelect = this.add.dom(640, 330, 'select')
      .setOrigin(0.5).setDepth(1200).setScrollFactor(0);

    ['1', '2', '3', '4'].forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = `${n} player${n === '1' ? '' : 's'}`;
      if (n === '2') opt.selected = true;
      playersSelect.node.appendChild(opt);
    });

    Object.assign(playersSelect.node.style, {
      pointerEvents: 'auto',
      width: '160px',
      height: '32px',
      fontSize: '16px',
      borderRadius: '8px',
      border: '1px solid #88a',
      background: '#0b0f1a',
      color: '#e7f1ff',
      outline: 'none'
    });

    /* --- Mission selector --- */
    this.add.text(400, 380, 'Select mission:', {
      fontSize: '18px', fill: '#ffffff'
    }).setScrollFactor(0);

    const missionSelect = this.add.dom(640, 380, 'select')
      .setOrigin(0.5).setDepth(1200).setScrollFactor(0);

    const missionOptions = [
      { value: 'big_construction',    label: 'Big construction' },
      { value: 'resource_extraction', label: 'Resource extraction' },
      { value: 'elimination',         label: 'Elimination' },
      { value: 'control_point',       label: 'Control point' },
    ];

    missionOptions.forEach((m, idx) => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      if (idx === 0) opt.selected = true;
      missionSelect.node.appendChild(opt);
    });

    Object.assign(missionSelect.node.style, {
      pointerEvents: 'auto',
      width: '220px',
      height: '32px',
      fontSize: '16px',
      borderRadius: '8px',
      border: '1px solid #88a',
      background: '#0b0f1a',
      color: '#e7f1ff',
      outline: 'none'
    });

    /* --- Preview panel --- */
    this.add.text(870, 130, 'Map Preview', {
      fontSize: '18px', fill: '#ffffff'
    }).setScrollFactor(0);

    this.previewSize = 80;
    this.previewWidth = 25;
    this.previewHeight = 25;

    this.previewContainer = this.add.container(900, 200).setScrollFactor(0);
    this.previewGraphics = this.add.graphics();
    this.previewContainer.add(this.previewGraphics);

    this.geographyText = this.add.text(820, 380, '', {
      fontSize: '18px', fill: '#aadfff'
    }).setScrollFactor(0);
    this.biomeText = this.add.text(820, 410, '', {
      fontSize: '18px', fill: '#aadfff'
    }).setScrollFactor(0);

    /* --- Seed Init --- */
    this.currentHexMap = null;
    this.currentTiles = null;

    const firstSeed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    codeInput.node.value = firstSeed;

    const regenerateAndPreview = (seed) => {
      this.currentHexMap = new HexMap(this.previewWidth, this.previewHeight, seed);
      this.currentTiles = this.currentHexMap.getMap();
      this.drawPreviewFromTiles(this.currentTiles);

      const meta = this.currentHexMap.worldMeta
        || this.currentTiles.__worldMeta
        || null;

      const geography = meta?.geography
        || classifyGeographyFromTiles(this.currentTiles, this.previewWidth, this.previewHeight);

      const biome = meta?.biome
        || classifyBiomeFromTiles(this.currentTiles);

      const geoLabel = typeof geography === 'string'
        ? geography
        : (geography?.label || JSON.stringify(geography));

      this.geographyText.setText(`🌍 Geography: ${geoLabel}`);
      this.biomeText.setText(`🌿 Biome: ${biome}`);
    };

    codeInput.node.addEventListener('input', () => {
      let v = codeInput.node.value.replace(/\D/g, '');
      v = v.slice(0, 6);
      codeInput.node.value = v;
      if (v) {
        regenerateAndPreview(v.padStart(6, '0'));
      }
    });

    codeInput.node.addEventListener('blur', () => {
      let v = codeInput.node.value.trim();
      if (!v) v = '000000';
      codeInput.node.value = v.padStart(6, '0');
      regenerateAndPreview(codeInput.node.value);
    });

    // 🔧 IMPORTANT: register click listener before .on
    randomBtn.addListener('click');
    randomBtn.on('click', () => {
      const seed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      codeInput.node.value = seed;
      regenerateAndPreview(seed);
    });

    // First run
    regenerateAndPreview(firstSeed);

    /* --- Host / Join Buttons --- */

    const hostBtn = this.add.dom(
      540,
      450,
      'button',
      {
        backgroundColor: '#006400',
        color: '#fff',
        fontSize: '18px',
        padding: '10px 20px',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        pointerEvents: 'auto'
      },
      'Host Game'
    ).setDepth(1200).setScrollFactor(0);

    const joinBtn = this.add.dom(
      720,
      450,
      'button',
      {
        backgroundColor: '#1E90FF',
        color: '#fff',
        fontSize: '18px',
        padding: '10px 20px',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        pointerEvents: 'auto'
      },
      'Join Game'
    ).setDepth(1200).setScrollFactor(0);

    // 🔧 IMPORTANT: register click listeners
    hostBtn.addListener('click');
    joinBtn.addListener('click');

    // Waiting status text (hidden until needed)
    this.waitStatusText = this.add.text(480, 500, '', {
      fontSize: '18px',
      fill: '#ffd27f'
    }).setScrollFactor(0);

    /* =========================
       Host Game handler
       ========================= */
    hostBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      let code = codeInput.node.value.trim().replace(/\D/g, '');
      code = code.slice(0, 6).padStart(6, '0');

      if (!name || !/^\d{6}$/.test(code)) {
        alert('Enter your name and a 6-digit numeric seed.');
        return;
      }

      const roomCode = code;
      const seed = code;
      const hostPlayerId = 'p1';

      let maxPlayers = parseInt(playersSelect.node.value, 10);
      if (!Number.isFinite(maxPlayers)) maxPlayers = 2;
      maxPlayers = Math.min(4, Math.max(1, maxPlayers));

      const missionType = missionSelect.node.value || 'big_construction';

      const initialState = {
        seed,
        mapConfig: { width: 25, height: 25 },
        maxPlayers,
        missionType,
        players: [{
          id: hostPlayerId,
          name,
          slot: 0,
          isHost: true,
          isConnected: true,
          resources: {
            food: 200,
            scrap: 200,
            money: 200,
            influence: 200,
          },
        }],
        currentTurnPlayerId: hostPlayerId,
        turnNumber: 1,
        units: [],
        buildings: [],
        haulers: [],
        enemies: [],
        status: 'waiting', // lobby waiting for all players
        lastUpdatedAt: new Date().toISOString(),
      };

      try {
        const { error } = await supabase
          .from('lobbies')
          .upsert(
            {
              room_code: roomCode,
              state: initialState,
            },
            { onConflict: 'room_code' }
          );

        if (error) {
          console.error('[Supabase ERROR] Create lobby:', error.message);
          alert('Failed to create lobby.');
          return;
        }

        // Host now waits until all players connect
        this.startWaitingForFullLobby({
          seed,
          playerName: name,
          playerId: hostPlayerId,
          roomCode,
          isHost: true,
        });

      } catch (err) {
        console.error('[Supabase EXCEPTION] Create lobby failed:', err.message);
        alert('Failed to create lobby (exception).');
      }
    });

    /* =========================
       Join Game handler
       ========================= */
    joinBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      let code = codeInput.node.value.trim().replace(/\D/g, '');
      code = code.slice(0, 6).padStart(6, '0');

      if (!name || !/^\d{6}$/.test(code)) {
        alert('Enter your name and a 6-digit numeric seed.');
        return;
      }

      const roomCode = code;

      try {
        const { data, error } = await supabase
          .from('lobbies')
          .select('state')
          .eq('room_code', roomCode)
          .single();

        if (error || !data?.state) {
          console.error('[Supabase ERROR] Join lobby:', error?.message);
          alert('Game not found for this seed.');
          return;
        }

        let state = data.state;

        if (!Array.isArray(state.players)) {
          state.players = [];
        }

        let maxPlayers = Math.min(4, Math.max(1, state.maxPlayers || 1));
        if (state.players.length >= maxPlayers) {
          alert(`This game already has ${maxPlayers} players (maximum).`);
          return;
        }

        // If the same name already exists, reuse that slot
        const existing = state.players.find(p => p.name === name);
        let newId;
        if (existing) {
          newId = existing.id;
          existing.isConnected = true;
        } else {
          newId = `p${state.players.length + 1}`;
          const newPlayer = {
            id: newId,
            name,
            slot: state.players.length,
            isHost: false,
            isConnected: true,
            resources: {
              food: 200,
              scrap: 200,
              money: 200,
              influence: 200,
            },
          };
          state.players = [...state.players, newPlayer];
        }

        state.lastUpdatedAt = new Date().toISOString();

        const { error: updateError } = await supabase
          .from('lobbies')
          .update({ state })
          .eq('room_code', roomCode);

        if (updateError) {
          console.error('[Supabase ERROR] Join lobby update:', updateError.message);
          alert('Failed to join lobby.');
          return;
        }

        const seed = state.seed || code;

        // Joiner also waits until lobby is full
        this.startWaitingForFullLobby({
          seed,
          playerName: name,
          playerId: newId,
          roomCode,
          isHost: false,
        });

      } catch (err) {
        console.error('[Supabase EXCEPTION] Join lobby failed:', err.message);
        alert('Failed to join lobby (exception).');
      }
    });
  }

  /**
   * Polls Supabase until lobby has players.length === maxPlayers,
   * then transitions to WorldScene with the final lobby state.
   */
  startWaitingForFullLobby(cfg) {
    const { seed, playerName, playerId, roomCode, isHost } = cfg;

    if (this.waitEvent) {
      this.waitEvent.remove(false);
      this.waitEvent = null;
    }

    if (this.waitStatusText) {
      this.waitStatusText.setText('Waiting for players…');
    }

    this.waitEvent = this.time.addEvent({
      delay: 1500,
      loop: true,
      callback: async () => {
        try {
          const { data, error } = await supabase
            .from('lobbies')
            .select('state')
            .eq('room_code', roomCode)
            .single();

          if (error || !data?.state) {
            console.error('[Supabase ERROR] Poll lobby:', error?.message);
            return;
          }

          const state = data.state;
          const players = Array.isArray(state.players) ? state.players : [];
          const maxPlayers = Math.min(4, Math.max(1, state.maxPlayers || 1));
          const missionType = state.missionType || 'big_construction';

          if (this.waitStatusText) {
            this.waitStatusText.setText(
              `Waiting for players ${players.length}/${maxPlayers}…`
            );
          }

          if (players.length >= maxPlayers) {
            // stop polling
            if (this.waitEvent) {
              this.waitEvent.remove(false);
              this.waitEvent = null;
            }

            this.scene.start('WorldScene', {
              seed: state.seed || seed,
              playerName,
              playerId,
              roomCode,
              isHost,
              supabase,
              lobbyState: state,
              missionType,
            });
          }
        } catch (err) {
          console.error('[Supabase EXCEPTION] Poll lobby failed:', err.message);
        }
      },
    });
  }

  drawPreviewFromTiles(tiles) {
    this.previewGraphics.clear();
    const size = 6;

    const hexToPixel = (q, r, s) => {
      const x = s * Math.sqrt(3) * (q + 0.5 * (r & 1));
      const y = s * 1.5 * r;
      return { x, y };
    };

    const gridW = size * Math.sqrt(3) * (this.previewWidth + 0.5);
    const gridH = size * 1.5 * (this.previewHeight + 0.5);
    const offsetX = -gridW * 0.45;
    const offsetY = -gridH * 0.38;

    for (const t of tiles) {
      const { x, y } = hexToPixel(t.q, t.r, size);
      const color = getColorForTerrain
        ? getColorForTerrain(t.type, t.elevation)
        : 0x999999;

      this.drawHex(this.previewGraphics, x + offsetX, y + offsetY, size, color);
    }
  }

  drawHex(g, x, y, size, color) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Phaser.Math.DegToRad(60 * i - 30);
      corners.push({
        x: x + size * Math.cos(a),
        y: y + size * Math.sin(a)
      });
    }
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.fillPath();
  }
}
