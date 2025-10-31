import { createLobby, joinLobby } from '../net/LobbyManager.js';
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getColorForTerrain } from './WorldSceneMap.js'; // use existing terrain colors

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
            if (pingError) {
                console.error('[Supabase ERROR] Cannot connect:', pingError.message);
            } else {
                console.log('[Supabase OK] Connection active.');
            }
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

        // Room seed input (6 digits)
        this.add.text(400, 220, 'Map Seed (6 digits):', { fontSize: '18px', fill: '#ffffff' });
        const codeInput = this.add.dom(640, 250, 'input');
        codeInput.setOrigin(0.5);
        codeInput.setDepth(1000);
        codeInput.node.placeholder = '000000';
        codeInput.node.maxLength = 6;
        codeInput.node.style.textAlign = 'center';
        codeInput.node.style.width = '100px';
        codeInput.node.inputMode = 'numeric';
        codeInput.node.pattern = '\\d{6}';

        // 🎲 Random Seed Button
        const randomBtn = this.add.dom(760, 250, 'button', {
            backgroundColor: '#444',
            color: '#fff',
            fontSize: '14px',
            padding: '6px 10px',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '6px',
            marginLeft: '8px'
        }, '🎲 Random');
        randomBtn.setOrigin(0.5);
        randomBtn.setDepth(1000);

        const randSeed6 = () => String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

        // Random 6-digit seed suggestion on load
        const randomSeed = randSeed6();
        codeInput.node.value = randomSeed;

        // enforce numeric only + live preview update
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

        // Random button click: set a new seed and refresh preview
        randomBtn.addListener('click');
        randomBtn.on('click', () => {
            const s = randSeed6();
            codeInput.node.value = s;
            this.updatePreview(s);
        });

        // 🗺️ Create preview area
        this.previewSize = 80; // hex radius in pixels (scaled down)
        this.previewContainer = this.add.container(900, 200); // position right of inputs
        this.previewGraphics = this.add.graphics();
        this.previewContainer.add(this.previewGraphics);

        this.add.text(870, 130, 'Map Preview', {
            fontSize: '18px',
            fill: '#ffffff'
        });

        // draw first preview
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

        // Host game logic
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

        // Join game logic
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

    // ==========================
    // 🔍 Preview mini island draw
    // ==========================
    updatePreview(seedString) {
        if (!this.previewGraphics) return;

        this.previewGraphics.clear();

        // create small hex map using this seed
        const hexMap = new HexMap(25, 25, seedString);
        const mapData = hexMap.getMap();

        const size = 6; // small hexes
        const startX = 0;
        const startY = 0;

        // helper: convert q,r to pixel (odd-r)
        const hexToPixel = (q, r, size) => {
            const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1));
            const y = size * 1.5 * r;
            return { x, y };
        };

        // center map on preview
        const w = this.previewSize;
        const offsetX = -w;
        const offsetY = -w / 1.2;

        for (const tile of mapData) {
            const { q, r, type /*, elevation*/ } = tile;
            const { x, y } = hexToPixel(q, r, size);
            // Keep palette consistent with in-game terrain render
            const color = getColorForTerrain ? getColorForTerrain(type) : 0x999999;

            this.drawHex(this.previewGraphics, x + offsetX, y + offsetY, size, color);
        }
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
