// deephexbeta/src/scenes/WorldSceneUnits.js

export function spawnPlayerUnit(scene, playerName, spawnTile, color = 0xff0000) {
    const { x, y } = scene.hexToPixel(spawnTile.q, spawnTile.r, scene.hexSize);
    const unit = scene.add.circle(x, y, 10, color).setDepth(10);
    unit.q = spawnTile.q;
    unit.r = spawnTile.r;
    unit.playerName = playerName;
    unit.setInteractive();
    unit.on('pointerdown', (pointer) => {
        if (pointer.rightButtonDown()) return;
        pointer.event.stopPropagation();
        scene.selectedUnit = scene.selectedUnit === unit ? null : unit;
    });
    scene.players.push(unit);
    return unit;
}

export function spawnEnemyUnits(scene, tiles) {
    const enemies = [];
    for (let tile of tiles) {
        const { x, y } = scene.hexToPixel(tile.q, tile.r, scene.hexSize);
        const enemy = scene.add.circle(x, y, 8, 0x0000ff).setDepth(10);
        enemy.q = tile.q;
        enemy.r = tile.r;
        enemies.push(enemy);
    }
    return enemies;
}

export function moveEnemiesRandomly(scene) {
    const directions = [
        { dq: +1, dr: 0 }, { dq: -1, dr: 0 }, { dq: 0, dr: +1 },
        { dq: 0, dr: -1 }, { dq: +1, dr: -1 }, { dq: -1, dr: +1 }
    ];
    scene.enemies.forEach(enemy => {
        Phaser.Utils.Array.Shuffle(directions);
        for (const dir of directions) {
            const newQ = enemy.q + dir.dq;
            const newR = enemy.r + dir.dr;
            const tile = scene.mapData.find(t => t.q === newQ && t.r === newR);
            if (tile && !['water', 'mountain'].includes(tile.type)) {
                const { x, y } = scene.hexToPixel(newQ, newR, scene.hexSize);
                enemy.setPosition(x, y);
                enemy.q = newQ;
                enemy.r = newR;
                break;
            }
        }
    });
}
