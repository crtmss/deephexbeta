import { createLobby, joinLobby } from '../net/LobbyManager.js';

export default class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
    }

    preload() {}

    async create() {

        const { supabase } = await import('../net/SupabaseClient.js');
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

        this.add.text(500, 60, 'DeepHex Multiplayer Lobby', {
            fontSize: '28px',
            fill: '#ffffff'
        });

        this.add.text(460, 130, 'Your Name:', { fontSize: '18px', fill: '#ffffff' });
        const nameInput = this.add.dom(640, 160, 'input', 'maxlength="16"');
        nameInput.setOrigin(0.5);

        this.add.text(430, 220, 'Room Code (4 letters):', { fontSize: '18px', fill: '#ffffff' });
        const codeInput = this.add.dom(640, 250, 'input', 'maxlength="4" pattern="[A-Za-z]{4}"');
        codeInput.setOrigin(0.5);

        const hostBtn = this.add.dom(540, 330, 'button', {
            zIndex: 1000,
            backgroundColor: '#006400',
            color: '#fff',
            fontSize: '18px',
            padding: '10px 20px',
            border: 'none',
            cursor: 'pointer'
        }, 'Host Game');

        const joinBtn = this.add.dom(720, 330, 'button', {
            zIndex: 1000,
            backgroundColor: '#1E90FF',
            color: '#fff',
            fontSize: '18px',
            padding: '10px 20px',
            border: 'none',
            cursor: 'pointer'
        }, 'Join Game');

        hostBtn.addListener('click');
        hostBtn.on('click', async () => {
            const name = nameInput.node.value.trim();
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');
            const { data, error } = await createLobby(name, code);
            if (error) {
                alert('Failed to create lobby: ' + (error.message || error));
                return;
            }
            this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: true });
        });

        joinBtn.addListener('click');
        joinBtn.on('click', async () => {
            const name = nameInput.node.value.trim();
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');
            const { data, error } = await joinLobby(name, code);
            if (error) {
                alert('Failed to join lobby: ' + (error.message || error));
                return;
            }
            this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: false });
        });
    }
}
