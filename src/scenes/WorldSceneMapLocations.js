// Spawns locations (forest/ruin/crash/vehicle/mountainIcon) and draws roads.
// Call from your scene AFTER drawHexMap(), e.g.:
//
// import { drawLocationsAndRoads } from './worldscenemaplocations.js';
// drawHexMap.call(this);
// drawLocationsAndRoads.call(this);

import { getHexNeighbors, effectiveElevation, isoOffset, LIFT_PER_LVL } from './WorldSceneMap.js';

/** Local helper: place decorative objects and roads for the current scene */
export function drawLocationsAndRoads() {
  // defaults in case drawHexMap() wasn’t called yet (should be called first)
  const offX = this.mapOffsetX ?? 0;
  const offY = this.mapOffsetY ?? 0;

  // --- Decorative locations on tiles ---
  this.mapData.forEach(hex => {
    const { q, r, hasForest, hasRuin, hasCrashSite, hasVehicle, hasMountainIcon } = hex;

    const eff = effectiveElevation(hex);
    const base = this.hexToPixel(q, r, this.hexSize);
    const x = base.x + offX;
    const y = base.y + offY - LIFT_PER_LVL * eff;

    // Forest
    if (hasForest) {
      const treeCount = Phaser.Math.Between(2, 4);
      const placed = [];
      let attempts = 0;

      while (placed.length < treeCount && attempts < 40) {
        const angle = Phaser.Math.FloatBetween(0, 2 * Math.PI);
        const radius = Phaser.Math.FloatBetween(this.hexSize * 0.35, 0.65 * this.hexSize);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const o = isoOffset(dx, dy);
        const posX = x + o.x;
        const posY = y + o.y;
        const minDist = this.hexSize * 0.3;

        const tooClose = placed.some(p => Phaser.Math.Distance.Between(posX, posY, p.x, p.y) < minDist);
        if (!tooClose) {
          const sizePercent = 0.45 + Phaser.Math.FloatBetween(-0.05, 0.05);
          const size = this.hexSize * sizePercent;

          const tree = this.add.text(posX, posY, '🌲', { fontSize: `${size}px` })
            .setOrigin(0.5)
            .setDepth(5);

          this.tweens.add({
            targets: tree,
            angle: { from: -1.5, to: 1.5 },
            duration: Phaser.Math.Between(2500, 4000),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Phaser.Math.Between(0, 1000)
          });

          this.objects.push(tree);
          placed.push({ x: posX, y: posY });
        }
        attempts++;
      }
    }

    if (hasRuin) {
      this.objects.push(
        this.add.text(x, y, '🏛️', { fontSize: `${this.hexSize * 0.8}px` })
          .setOrigin(0.5).setDepth(5)
      );
    }
    if (hasCrashSite) {
      this.objects.push(
        this.add.text(x, y, '🚀', { fontSize: `${this.hexSize * 0.8}px` })
          .setOrigin(0.5).setDepth(5)
      );
    }
    if (hasVehicle) {
      this.objects.push(
        this.add.text(x, y, '🚙', { fontSize: `${this.hexSize * 0.8}px` })
          .setOrigin(0.5).setDepth(5)
      );
    }
    if (hasMountainIcon) {
      this.objects.push(
        this.add.text(x, y, '🏔️', {
          fontSize: `${this.hexSize * 0.9}px`,
          fontFamily: 'Arial, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
        }).setOrigin(0.5).setDepth(5)
      );
    }
  });

  // --- Roads: connect effective-elevation centers for adjacent road tiles ---
  this.mapData.forEach(hex => {
    if (!hex.hasRoad) return;
    const { q, r } = hex;

    const neighbors = getHexNeighbors(q, r)
      .map(n => this.mapData.find(h => h.q === n.q && h.r === n.r && h.hasRoad))
      .filter(Boolean);

    neighbors.forEach(n => {
      // draw each segment once (only if neighbor is "after" this one)
      if (n.r < r || (n.r === r && n.q <= q)) return;

      const p1 = this.hexToPixel(q, r, this.hexSize);
      const p2 = this.hexToPixel(n.q, n.r, this.hexSize);

      const e1 = effectiveElevation(hex);
      const e2 = effectiveElevation(n);

      const y1 = p1.y + offY - LIFT_PER_LVL * e1;
      const y2 = p2.y + offY - LIFT_PER_LVL * e2;

      const line = this.add.graphics().setDepth(3);
      line.lineStyle(2, 0x999999, 0.7);
      line.beginPath();
      line.moveTo(p1.x + offX, y1);
      line.lineTo(p2.x + offX, y2);
      line.strokePath();
      this.objects.push(line);
    });
  });
}
