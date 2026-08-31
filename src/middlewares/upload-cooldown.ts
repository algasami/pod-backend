import type { RequestHandler } from "express";
import { UPLOAD_COOLDOWN_MS, UPLOAD_COOLDOWN_SECONDS } from "../config.js";

// Entries only matter for one cooldown window, so the map is bounded by the
// number of distinct callers inside that window. The cap is a backstop for a
// caller cycling addresses faster than entries age out.
const MAX_TRACKED_CLIENTS = 4096;

const lastUploadAt = new Map<string, number>();

const dropExpired = (now: number) => {
    for (const [client, at] of lastUploadAt) {
        if (now - at >= UPLOAD_COOLDOWN_MS) lastUploadAt.delete(client);
    }
};

/**
 * Rejects an upload that arrives before the caller's cooldown has elapsed.
 *
 * Runs ahead of multer so a throttled caller never gets to stream a body onto
 * disk, and claims the slot on the way in rather than on the way out, so a
 * burst of parallel uploads cannot all pass the check together. The stamp is
 * refreshed once the response is done, which measures the cooldown from the end
 * of the previous transfer instead of its start.
 */
export const uploadCooldown: RequestHandler = (req, res, next) => {
    if (UPLOAD_COOLDOWN_MS <= 0) return next();

    const client = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const last = lastUploadAt.get(client);

    if (last !== undefined && now - last < UPLOAD_COOLDOWN_MS) {
        const retryAfter = Math.ceil((UPLOAD_COOLDOWN_MS - (now - last)) / 1000);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({
            message: `Uploads are limited to one every ${UPLOAD_COOLDOWN_SECONDS} second(s). Try again in ${retryAfter} second(s).`,
            id: "",
        });
    }

    lastUploadAt.set(client, now);
    // "close" fires whether the response finished or the caller hung up, so an
    // abandoned upload still leaves a stamp behind rather than a free retry.
    res.on("close", () => lastUploadAt.set(client, Date.now()));

    if (lastUploadAt.size > MAX_TRACKED_CLIENTS) dropExpired(now);

    next();
};
