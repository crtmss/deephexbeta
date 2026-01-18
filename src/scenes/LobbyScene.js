// deephexbeta/src/scenes/LobbyScene.js
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getFillForTile } from './WorldSceneMap.js';

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

  // Inner water density → lagoon detection
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

  // Riveriness
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

  // PCA orientation classification
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

const FACTIONS = [
  'Admiralty',
  'Cannibals',
  'Collective',
  'Fabricators',
  'Mutants',
  'Transcendent',
];

const factionKey = (f) => `lobbybg_${String(f || '').toLowerCase()}`;

// Vite/ESM-friendly asset URLs (these must match src/assets/art/)
const FACTION_BG_URLS = {
  Admiralty: new URL('../assets/art/Admiralty.png', import.meta.url).href,
  Cannibals: new URL('../assets/art/Cannibals.png', import.meta.url).href,
  Collective: new URL('../assets/art/Collective.png', import.meta.url).href,
  Fabricators: new URL('../assets/art/Fabricators.png', import.meta.url).href,
  Mutants: new URL('../assets/art/Mutants.png', import.meta.url).href,
  Transcendent: new URL('../assets/art/Transcendent.png', import.meta.url).href,
};

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
    this.waitEvent = null;
    this.waitStatusText = null;

    this.selectedFaction = 'Admiralty';
    this.bgImage = null;

    // preview dims
    this.previewSize = 80;
    this.previewWidth = 29;
    this.previewHeight = 29;

    this.currentHexMap = null;
    this.currentTiles = null;
  }

  preload() {
    for (const f of FACTIONS) {
      const url = FACTION_BG_URLS[f];
      if (url) this.load.image(factionKey(f), url);
    }
  }

  async create() {
    /* ===== UI Creation (unchanged) ===== */
    if (this.game && this.game.domContainer) {
      const dc = this.game.domContainer;
      dc.style.pointerEvents = 'none';
      dc.style.zIndex = '10';
      dc.style.background = 'transparent';
    }

    // If the camera has a background color, it will show through gaps.
    // We keep it, but the image should fully cover now.
    // (You can also set to black if you prefer.)
    // this.cameras.main.setBackgroundColor('#000000');

    const fitBgToCamera = () => {
      if (!this.bgImage) return;

      const cam = this.cameras.main;

      // use camera viewport size (most correct for what you actually see)
      const vw = cam.width;
      const vh = cam.height;

      const tex = this.textures.get(this.bgImage.texture.key);
      const src = tex?.getSourceImage?.();
      if (!src?.width || !src?.height) return;

      const sx = vw / src.width;
      const sy = vh / src.height;

      // COVER behavior
      const scale = Math.max(sx, sy);

      this.bgImage
        .setOrigin(0.5, 0.5)
        // center in the camera viewport
        .setPosition(cam.centerX, cam.centerY)
        .setScrollFactor(0)
        .setScale(scale);

      // Ensure it renders behind everything
      this.bgImage.setDepth(-1000);
    };

    const applyLobbyBackground = (factionName) => {
      const key = factionKey(factionName);

      if (!this.textures.exists(key)) {
        console.warn('[LOBBY] Missing background texture:', key);
        return;
      }

      if (!this.bgImage) {
        this.bgImage = this.add.image(0, 0, key);
      } else {
        this.bgImage.setTexture(key);
      }

      fitBgToCamera();
    };

    // Refit when Phaser resizes the game (covers DPR / window resize / scale mode changes)
    this.scale.on('resize', () => {
      // camera size can change too in some scale modes
      fitBgToCamera();
    });

    // default bg
    applyLobbyBackground(this.selectedFaction);

    this.add.text(500, 60, 'DeepHex Multiplayer Lobby', {
      fontSize: '28px', fill: '#ffffff'
    }).setScrollFactor(0);

    try {
      const { error: pingError } =
        await supabase.from('lobbies').select('id').limit(1);
      if (pingError)
        console.error('[Supabase ERROR] Cannot connect:', pingError.message);
      else console.log('[Supabase OK] Connection active.');
    } catch (err) {
      console.error('[Supabase EXCEPTION] Connection check failed:', err.message);
    }

    /* ===== Name + Seed ===== */
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
    });

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

    /* === RANDOM SEED === */
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
    ).setOrigin(0.5).setDepth(1250);

    /* ===== Players Selector ===== */
    this.add.text(400, 330, 'Select players (1–4):', {
      fontSize: '18px', fill: '#ffffff'
    });

    const playersSelect = this.add.dom(640, 330, 'select')
      .setOrigin(0.5).setDepth(1200);

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

    /* ===== Mission Selector ===== */
    this.add.text(400, 380, 'Select mission:', {
      fontSize: '18px', fill: '#ffffff'
    });

    const missionSelect = this.add.dom(640, 380, 'select')
      .setOrigin(0.5).setDepth(1200);

    [
      { value: 'big_construction',    label: 'Big construction' },
      { value: 'resource_extraction', label: 'Resource extraction' },
      { value: 'elimination',         label: 'Elimination' },
      { value: 'control_point',       label: 'Control point' },
    ].forEach((m, idx) => {
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

    /* ===== Faction Selector ===== */
    this.add.text(400, 420, 'Faction:', {
      fontSize: '18px', fill: '#ffffff'
    });

    const factionSelect = this.add.dom(640, 420, 'select')
      .setOrigin(0.5).setDepth(1200);

    FACTIONS.forEach((f, idx) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      if (f === this.selectedFaction || idx === 0) opt.selected = true;
      factionSelect.node.appendChild(opt);
    });

    Object.assign(factionSelect.node.style, {
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

    factionSelect.node.addEventListener('change', () => {
      const v = factionSelect.node.value || 'Admiralty';
      this.selectedFaction = v;
      applyLobbyBackground(v);
    });

    /* ==============================
       PREVIEW
       ============================== */

    this.add.text(870, 130, 'Map Preview', {
      fontSize: '18px', fill: '#ffffff'
    });

    this.previewContainer = this.add.container(900, 200).setScrollFactor(0);
    this.previewGraphics = this.add.graphics();
    this.previewContainer.add(this.previewGraphics);

    this.geographyText = this.add.text(820, 380, '', {
      fontSize: '18px', fill: '#aadfff'
    });
    this.biomeText = this.add.text(820, 410, '', {
      fontSize: '18px', fill: '#aadfff'
    });

    /* ==============================
       SEED INIT AND PREVIEW
       ============================== */

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
      if (v) regenerateAndPreview(v.padStart(6, '0'));
    });

    codeInput.node.addEventListener('blur', () => {
      let v = codeInput.node.value.trim();
      if (!v) v = '000000';
      codeInput.node.value = v.padStart(6, '0');
      regenerateAndPreview(codeInput.node.value);
    });

    randomBtn.addListener('click');
    randomBtn.on('click', () => {
      const seed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      codeInput.node.value = seed;
      regenerateAndPreview(seed);
    });

    regenerateAndPreview(firstSeed);

    /* ========================= HOST GAME ========================= */

    const hostBtn = this.add.dom(
      540, 480, 'button',
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
    ).setDepth(1200);

    const joinBtn = this.add.dom(
      720, 480, 'button',
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
    ).setDepth(1200);

    hostBtn.addListener('click');
    joinBtn.addListener('click');

    this.waitStatusText = this.add.text(
      480, 530, '',
      { fontSize: '18px', fill: '#ffd27f' }
    );

    /* ===== HOST HANDLER ===== */
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
      const faction = this.selectedFaction || 'Admiralty';

      const initialState = {
        seed,
        mapConfig: { width: 29, height: 29 },
        maxPlayers,
        missionType,
        players: [{
          id: hostPlayerId,
          name,
          slot: 0,
          isHost: true,
          isConnected: true,
          faction,
          resources: { food: 200, scrap: 200, money: 200, influence: 200 },
        }],
        currentTurnPlayerId: hostPlayerId,
        turnNumber: 1,
        units: [],
        buildings: [],
        haulers: [],
        enemies: [],
        status: 'waiting',
        lastUpdatedAt: new Date().toISOString(),
      };

      try {
        const { error } = await supabase
          .from('lobbies')
          .upsert(
            { room_code: roomCode, state: initialState },
            { onConflict: 'room_code' }
          );

        if (error) {
          console.error('[Supabase ERROR] Create lobby:', error.message);
          alert('Failed to create lobby.');
          return;
        }

        this.startWaitingForFullLobby({
          seed,
          playerName: name,
          playerId: hostPlayerId,
          roomCode,
          isHost: true,
          faction,
        });

      } catch (err) {
        console.error('[Supabase EXCEPTION] Create lobby failed:', err.message);
        alert('Failed to create lobby (exception).');
      }
    });

    /* ===== JOIN HANDLER ===== */
    joinBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      let code = codeInput.node.value.trim().replace(/\D/g, '');
      code = code.slice(0, 6).padStart(6, '0');

      if (!name || !/^\d{6}$/.test(code)) {
        alert('Enter your name and a 6-digit numeric seed.');
        return;
      }

      const roomCode = code;
      const faction = this.selectedFaction || 'Admiralty';

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
        if (!Array.isArray(state.players)) state.players = [];

        const maxPlayers = Math.min(4, Math.max(1, state.maxPlayers || 1));
        if (state.players.length >= maxPlayers) {
          alert(`This game already has ${maxPlayers} players (maximum).`);
          return;
        }

        const existing = state.players.find(p => p.name === name);
        let newId;
        if (existing) {
          newId = existing.id;
          existing.isConnected = true;
          existing.faction = existing.faction || faction;
        } else {
          newId = `p${state.players.length + 1}`;
          state.players.push({
            id: newId,
            name,
            slot: state.players.length,
            isHost: false,
            isConnected: true,
            faction,
            resources: { food: 200, scrap: 200, money: 200, influence: 200 },
          });
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
        const missionType = state.missionType || 'big_construction';

        this.startWaitingForFullLobby({
          seed,
          playerName: name,
          playerId: newId,
          roomCode,
          isHost: false,
          faction,
        });

      } catch (err) {
        console.error('[Supabase EXCEPTION] Join lobby failed:', err.message);
        alert('Failed to join lobby (exception).');
      }
    });
  }

  /* ==========================
     WAITING FOR PLAYERS LOOP
     ========================== */

  startWaitingForFullLobby(cfg) {
    const { seed, playerName, playerId, roomCode, isHost, faction } = cfg;

    if (this.waitEvent) this.waitEvent.remove(false);

    this.waitStatusText?.setText('Waiting for players…');

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

          this.waitStatusText?.setText(
            `Waiting for players ${players.length}/${maxPlayers}…`
          );

          if (players.length >= maxPlayers) {
            this.waitEvent?.remove(false);
            this.waitEvent = null;

            this.scene.start('WorldScene', {
              seed: state.seed || seed,
              playerName,
              playerId,
              roomCode,
              isHost,
              supabase,
              lobbyState: state,
              missionType,
              faction: faction || this.selectedFaction || 'Admiralty',
            });
          }
        } catch (err) {
          console.error('[Supabase EXCEPTION] Poll lobby failed:', err.message);
        }
      },
    });
  }

  /* ==========================
     PREVIEW RENDERER
     ========================== */

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
      const color = getFillForTile(t);
      this.drawHex(this.previewGraphics, x + offsetX, y + offsetY, size, color);
    }
  }

  drawHex(g, x, y, size, color) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Phaser.Math.DegToRad(60 * i - 30);
      corners.push({ x: x + size * Math.cos(a), y: y + size * Math.sin(a) });
    }
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.fillPath();
  }
}
