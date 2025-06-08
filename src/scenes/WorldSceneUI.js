// deephexbeta/src/scenes/WorldSceneUI.js

export function setupCameraControls(scene) {
    scene.input.setDefaultCursor('grab');
    scene.isDragging = false;

    scene.input.on('pointerdown', pointer => {
        if (pointer.rightButtonDown()) {
            scene.isDragging = true;
            scene.input.setDefaultCursor('grabbing');
            scene.dragStartX = pointer.x;
            scene.dragStartY = pointer.y;
            scene.cameraStartX = scene.cameras.main.scrollX;
            scene.cameraStartY = scene.cameras.main.scrollY;
        }
    });

    scene.input.on('pointerup', pointer => {
        if (scene.isDragging) {
            scene.isDragging = false;
            scene.input.setDefaultCursor('grab');
        }
    });

    scene.input.on('pointermove', pointer => {
        if (scene.isDragging) {
            const dx = pointer.x - scene.dragStartX;
            const dy = pointer.y - scene.dragStartY;
            scene.cameras.main.scrollX = scene.cameraStartX - dx;
            scene.cameras.main.scrollY = scene.cameraStartY - dy;
        }
    });
}

export function setupTurnUI(scene) {
    scene.turnText = scene.add.text(20, 20, `Player Turn: ${scene.lobbyState.currentTurn}`, {
        fontSize: '18px',
        fill: '#ffffff',
        backgroundColor: '#222',
        padding: { x: 10, y: 5 }
    }).setScrollFactor(0).setDepth(100);

    scene.endTurnButton = scene.add.text(20, 50, 'End Turn', {
        fontSize: '18px',
        fill: '#fff',
        backgroundColor: '#555',
        padding: { x: 10, y: 5 }
    }).setScrollFactor(0).setDepth(100).setInteractive();

    scene.endTurnButton.on('pointerdown', () => {
        scene.endTurn();
    });

    scene.refreshButton = scene.add.text(20, 85, 'Refresh', {
        fontSize: '18px',
        fill: '#fff',
        backgroundColor: '#444',
        padding: { x: 10, y: 5 }
    }).setScrollFactor(0).setDepth(100).setInteractive();

    scene.refreshButton.on('pointerdown', () => {
        const { refreshUnits } = require('./WorldSceneActions.js');
        refreshUnits(scene);
    });
}

export function updateTurnText(scene, currentTurn) {
    if (scene.turnText) {
        scene.turnText.setText('Player Turn: ' + currentTurn);
    }
}
