// deephexbeta/src/scenes/WorldSceneResources.js
//
// Fully deterministic resource spawning.
// NOTHING is generated randomly — we only read:
//   scene.mapInfo.objects   (from HexMap.js generation)
//   scene.mapData           (tiles for terrain checks)
//
// Supported object types in __worldObjects:
//   - fish
//   - ruin
//   - crash_site
//   - ancient_site
//   - vehicle_wreck
//   - scrap_node    (optional future)
//   - anything else you define
//
// All objects are placed in the same order on all clients with the same seed.

export function spawnWorldResourcesDeterministic() {
    const scene = /** @type {Phaser.Scene & any} */ (this);
    if (!scene.mapInfo || !Array.isArray(scene.mapInfo.objects)) return;

    scene.resources = scene.resources || [];

    // Clear any previous objects (important on re-entry)
    for (const r of scene.resources) {
        if (r.obj?.destroy) r.obj.destroy();
    }
    scene.resources = [];

    const objects = scene.mapInfo.objects;

    for (const obj of objects) {
        if (typeof obj.q !== "number" || typeof obj.r !== "number") continue;

        const { q, r } = obj;
        const pos = scene.axialToWorld(q, r);

        let sprite = null;
        let type = obj.type;

        // Normalize type (lowercase)
        const T = String(type || "").toLowerCase();

        /* ===========================================================
           FISH
        ============================================================ */
        if (T === "fish") {
            sprite = scene.add.text(pos.x, pos.y, "🐟", {
                fontSize: "18px",
                color: "#ffffff"
            })
            .setOrigin(0.5)
            .setDepth(2050);

            scene.resources.push({
                type: "fish",
                q, r,
                obj: sprite
            });
            continue;
        }

        /* ===========================================================
           RUIN
        ============================================================ */
        if (T === "ruin" || T === "ancient_ruin") {
            sprite = scene.add.text(pos.x, pos.y, "🏚️", {
                fontSize: "18px",
                color: "#d6c7a1"
            })
            .setOrigin(0.5)
            .setDepth(2050);

            scene.resources.push({
                type: "ruin",
                q, r,
                obj: sprite
            });
            continue;
        }

        /* ===========================================================
           CRASH SITE
        ============================================================ */
        if (T === "crash_site" || T === "crashsite") {
            sprite = scene.add.text(pos.x, pos.y, "🔥", {
                fontSize: "20px",
                color: "#ff8844"
            })
            .setOrigin(0.5)
            .setDepth(2050);

            scene.resources.push({
                type: "crash_site",
                q, r,
                obj: sprite
            });
            continue;
        }

        /* ===========================================================
           ANCIENT SITE / ARTEFACT
        ============================================================ */
        if (T === "ancient_site" || T === "artefact") {
            sprite = scene.add.text(pos.x, pos.y, "🗿", {
                fontSize: "20px",
                color: "#bbb"
            })
            .setOrigin(0.5)
            .setDepth(2050);

            scene.resources.push({
                type: "ancient_site",
                q, r,
                obj: sprite
            });
            continue;
        }

        /* ===========================================================
           VEHICLE WRECK
        ============================================================ */
        if (T === "vehicle_wreck" || T === "wreck" || T === "vehicle") {
            sprite = scene.add.text(pos.x, pos.y, "🚙", {
                fontSize: "18px",
                color: "#cccccc"
            })
            .setOrigin(0.5)
            .setDepth(2050);

            scene.resources.push({
                type: "vehicle_wreck",
                q, r,
                obj: sprite
            });
            continue;
        }

        /* ===========================================================
           FALLBACK: unknown resource type
           (Won’t break multiplayer, but logs a warning)
        ============================================================ */
        console.warn("[Resources] Unrecognized object type:", type, obj);
    }

    console.log(`[Resources] Deterministic spawn complete: ${scene.resources.length} objects.`);
}

/* ===========================================================
   Backward compatibility: alias old function name
   =========================================================== */
export function spawnFishResources() {
    console.warn("[Resources] spawnFishResources() was called — now deterministic.");
    spawnWorldResourcesDeterministic.call(this);
}
