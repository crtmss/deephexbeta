import { createLobby, joinLobby } from '../net/LobbyManager.js';
import { supabase } from '../net/SupabaseClient.js';

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

        // Suggest a random 6-digit seed every time
        const randomSeed = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
        codeInput.node.value = randomSeed;

        // Enforce numeric input only
        codeInput.node.addEventListener('input', () => {
            let value = codeInput.node.value.replace(/\D/g, '');
            if (value.length > 6) value = value.slice(0, 6);
            codeInput.node.value = value;
        });

        // Pad to 6 digits on blur (leaving input)
        codeInput.node.addEventListener('blur', () => {
            let value = codeInput.node.value.trim();
            if (!value) value = '000000';
            codeInput.node.value = value.padStart(6, '0');
        });

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
}
