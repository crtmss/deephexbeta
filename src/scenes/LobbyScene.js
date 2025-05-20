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

        // Room code input
        this.add.text(430, 220, 'Room Code (4 letters):', { fontSize: '18px', fill: '#ffffff' });
        const codeInput = this.add.dom(640, 250, 'input');
        codeInput.setOrigin(0.5);
        codeInput.setDepth(1000);
        codeInput.node.placeholder = 'ABCD';
        codeInput.node.maxLength = 4;

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
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');

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
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');

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
