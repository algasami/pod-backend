import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { UPLOAD_DIR, UPLOAD_TTL_MS } from "./config.js";

/**
 * One-off sweep: deletes every upload whose last-modified time is older than
 * the configured TTL. The server never deletes anything itself — it only stops
 * serving expired files — so disk is reclaimed by running this by hand or from
 * a scheduled task:
 *
 *     npm run cleanup
 */
const now = Date.now();

let entries;
try {
    entries = await readdir(UPLOAD_DIR, { withFileTypes: true });
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.log("Nothing to sweep: upload directory does not exist.");
    process.exit(0);
}

let removed = 0;
for (const entry of entries) {
    if (!entry.isFile()) continue;

    const path = join(UPLOAD_DIR, entry.name);
    try {
        const { mtimeMs } = await stat(path);
        if (now - mtimeMs < UPLOAD_TTL_MS) continue;
        await unlink(path);
        removed += 1;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        console.error(`Failed to remove expired upload ${entry.name}:`, err);
        process.exitCode = 1;
    }
}

console.log(`Removed ${removed} expired upload(s).`);
