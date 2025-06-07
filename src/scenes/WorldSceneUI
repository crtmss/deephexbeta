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
    scene.turnText = scene.add.text(10, 10, 'Player Turn: 1', {
        fontSize: '20px',
        fill: '#ffffff'
    }).setDepth(100);

    scene.endTurnButton = scene.add.text(1150, 20, 'End Turn', {
        fontSize: '22px',
        backgroundColor: '#222',
        color: '#fff',
        padding: { x: 12, y: 6 }
    }).setInteractive().setDepth(100);

    scene.endTurnButton.on('pointerdown', () => {
        scene.endTurn();
    });

    scene.refreshButton = scene.add.text(1150, 60, 'Refresh', {
        fontSize: '22px',
        backgroundColor: '#444',
        color: '#fff',
        padding: { x: 12, y: 6 }
    }).setInteractive().setDepth(100);

    scene.refreshButton.on('pointerdown', () => {
        scene.refreshUnits();
    });
}

export function updateTurnText(scene, currentTurn) {
    if (scene.turnText) {
        scene.turnText.setText('Player Turn: ' + currentTurn);
    }
}
