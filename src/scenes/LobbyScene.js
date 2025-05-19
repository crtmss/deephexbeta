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
        const nameInput = this.add.dom(640, 160, 'input', {
            type: 'text',
            fontSize: '18px',
            width: '200px'
        });

        this.add.text(460, 200, 'Room Code (4 letters):', { fontSize: '18px', fill: '#ffffff' });
        const codeInput = this.add.dom(640, 230, 'input', {
            type: 'text',
            fontSize: '18px',
            width: '200px'
        });

        const hostBtn = this.add.text(480, 300, 'Host Game', {
            fontSize: '22px',
            backgroundColor: '#006400',
            color: '#fff',
            padding: { x: 20, y: 10 }
        }).setInteractive();

        const joinBtn = this.add.text(660, 300, 'Join Game', {
            fontSize: '22px',
            backgroundColor: '#1E90FF',
            color: '#fff',
            padding: { x: 20, y: 10 }
        }).setInteractive();

        hostBtn.on('pointerdown', async () => {
            const name = nameInput.node.value.trim();
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');
            const { data, error } = await createLobby(name, code);
            if (!error) this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: true });
        });

        joinBtn.on('pointerdown', async () => {
            const name = nameInput.node.value.trim();
            const code = codeInput.node.value.trim().toUpperCase();
            if (!name || code.length !== 4) return alert('Enter name and 4-letter room code');
            const { data, error } = await joinLobby(name, code);
            if (!error) this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: false });
        });
    }
}
