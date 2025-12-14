// src/scenes/WorldSceneCombatFX.js
//
// Stage F: Floating damage numbers & simple hit/death effects.
// Phaser-dependent (uses scene.add / scene.tweens / scene.hexSize / scene.axialToWorld).
//
// Safe-by-default:
//  - does nothing if scene is missing required helpers
//  - no assumptions about unit sprites/containers

export function spawnDamageNumber(scene, q, r, amount, opts = {}) {
  if (!scene || !scene.add || !scene.tweens) return;
  if (!Number.isFinite(q) || !Number.isFinite(r)) return;

  const amt = Number.isFinite(amount) ? amount : 0;

  const world =
    (typeof scene.axialToWorld === 'function')
      ? scene.axialToWorld(q, r)
      : { x: 0, y: 0 };

  const size = Number.isFinite(scene.hexSize) ? scene.hexSize : 22;

  // Color heuristic (you can replace later with more meaningful scaling)
  const color =
    opts.color ||
    (amt >= 9 ? '#ffd166' : (amt <= 2 ? '#aaaaaa' : '#ffffff'));

  const text = scene.add.text(world.x, world.y - size * 0.2, `-${amt}`, {
    fontFamily: 'monospace',
    fontSize: '18px',
    fontStyle: 'bold',
    color,
    stroke: '#000000',
    strokeThickness: 3,
  });

  text.setOrigin(0.5);
  text.setDepth((opts.depth ?? 3000));

  // Small pop
  text.setScale(0.95);
  scene.tweens.add({
    targets: text,
    scale: 1.15,
    duration: 120,
    yoyo: true,
    ease: 'Quad.easeOut',
  });

  // Float up + fade
  scene.tweens.add({
    targets: text,
    y: world.y - size * 1.2,
    alpha: 0,
    duration: 700,
    ease: 'Cubic.easeOut',
    onComplete: () => {
      try { text.destroy(); } catch (e) {}
    },
  });
}

export function spawnDeathFX(scene, unitOrPos, opts = {}) {
  if (!scene || !scene.add || !scene.tweens) return;

  const q = Number.isFinite(unitOrPos?.q) ? unitOrPos.q : unitOrPos?.q;
  const r = Number.isFinite(unitOrPos?.r) ? unitOrPos.r : unitOrPos?.r;

  if (!Number.isFinite(q) || !Number.isFinite(r)) return;

  const world =
    (typeof scene.axialToWorld === 'function')
      ? scene.axialToWorld(q, r)
      : { x: 0, y: 0 };

  const size = Number.isFinite(scene.hexSize) ? scene.hexSize : 22;

  const g = scene.add.graphics();
  g.setDepth(opts.depth ?? 2800);

  // Red flash ring + fill
  g.fillStyle(0xff3b3b, 0.65);
  g.fillCircle(world.x, world.y, size * 0.75);

  g.lineStyle(3, 0xffffff, 0.85);
  g.strokeCircle(world.x, world.y, size * 0.85);

  // Fade out quickly
  scene.tweens.add({
    targets: g,
    alpha: 0,
    duration: 520,
    ease: 'Quad.easeOut',
    onComplete: () => {
      try { g.destroy(); } catch (e) {}
    },
  });

  // Optional: also fade the unit visuals if present
  const unit = unitOrPos;
  const target =
    unit?.container ||
    (typeof unit?.setAlpha === 'function' ? unit : null);

  if (target) {
    try {
      scene.tweens.add({
        targets: target,
        alpha: 0,
        duration: 380,
        ease: 'Quad.easeOut',
      });
    } catch (e) {}
  }
}

export default {
  spawnDamageNumber,
  spawnDeathFX,
};
