export default class CombatScene extends Phaser.Scene {
    constructor() {
        super('CombatScene');
    }

    create() {
        this.add.text(400, 300, 'Combat Begins', {
            fontSize: '32px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        this.cameras.main.setBackgroundColor('#000');
    }
}
