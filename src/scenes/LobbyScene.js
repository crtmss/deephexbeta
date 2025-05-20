import { createLobby, joinLobby } from '../net/LobbyManager.js';

export default class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
    }

    preload() {}

    create() {
        this.add.text(500, 60, 'DeepHex Multiplayer Lobby', {
            fontSize: '28px',
            fill: '#ffffff'
        });

        this.add.text(460, 130, 'Your Name:', { fontSize: '18px', fill: '#ffffff' });
        const nameInput = this.add.dom(640, 160, 'input');
        nameInput.setOrigin(0.5);

        this.add.text(430, 220, 'Room Code (4 letters):', { fontSize: '18px', fill: '#ffffff' });
        const codeInput = this.add.dom(640, 250, 'input');
        codeInput.setOrigin(0.5);

        const hostBtn = this.add.dom(540, 330, 'button', {
            backgroundColor: '#006400',
            color: '#fff',
            fontSize: '18px',
            padding: '10px 20px',
            border: 'none',
            cursor: 'pointer'
        }, 'Host Game');

        const joinBtn = this.add.dom(720, 330, 'button', {
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
            if (!error) this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: true });
        });

        joinBtn.addListener('click');
        joinBtn.on('click', async () => {
            const name = nameInput.node.value.trim();
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');
            const { data, error } = await joinLobby(name, code);
            if (!error) this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: false });
        });
    }
}
    
