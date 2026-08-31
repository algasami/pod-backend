import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { CLEANUP_INTERVAL_MS, UPLOAD_DIR, UPLOAD_TTL_MS } from "../config.js";

/**
 * Deletes every upload whose last-modified time is older than the configured TTL.
 *
 * The file's mtime is the only piece of state this relies on, and it lives on disk
 * alongside the file itself. Nothing is tracked in memory, so a crash or a shutdown
 * cannot lose track of a pending deletion: the next sweep sees the same ages the
 * previous process saw, plus whatever time passed while the server was down.
 *
 * @returns the number of files removed.
 */
export const sweepExpiredUploads = async (now = Date.now()) => {
    let entries;
    try {
        entries = await readdir(UPLOAD_DIR, { withFileTypes: true });
    } catch (err) {
        // The directory is created at boot; if it is missing there is nothing to sweep.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw err;
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
            // Already gone (raced with another sweep or a manual delete) is not an error.
            if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
            console.error(`Failed to remove expired upload ${entry.name}:`, err);
        }
    }
    return removed;
};

/**
 * Sweeps once immediately — catching files that expired while the process was not
 * running — then keeps sweeping on an interval.
 *
 * @returns a function that stops the scheduled sweeps.
 */
export const startUploadCleanup = () => {
    let sweeping = false;

    const runSweep = async () => {
        // Skip a tick rather than stacking sweeps if a previous one is still going.
        if (sweeping) return;
        sweeping = true;
        try {
            const removed = await sweepExpiredUploads();
            if (removed > 0) {
                console.log(`Removed ${removed} expired upload(s).`);
            }
        } catch (err) {
            // Never let a sweep failure take the process down; the next tick retries.
            console.error("Upload cleanup sweep failed:", err);
        } finally {
            sweeping = false;
        }
    };

    void runSweep();

    const timer = setInterval(runSweep, CLEANUP_INTERVAL_MS);
    timer.unref();

    return () => clearInterval(timer);
};
