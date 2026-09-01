import type { RequestHandler } from "express";
import { AUTH_RATE_LIMIT_PER_MINUTE } from "../config.js";

const WINDOW_MS = 60_000;

// Same backstop shape as upload-cooldown: entries only matter for one window,
// so the map is bounded by distinct callers per minute plus this cap.
const MAX_TRACKED_CLIENTS = 4096;

const windows = new Map<string, { start: number; count: number }>();

const dropExpired = (now: number) => {
    for (const [client, w] of windows) {
        if (now - w.start >= WINDOW_MS) windows.delete(client);
    }
};

/**
 * Fixed-window per-client cap on the auth endpoints.
 *
 * The challenge pool drops its oldest entry when full, so without this an
 * unauthenticated flood of /auth/challenge could evict legitimate pending
 * challenges and lock everyone out of uploading. It also keeps /auth/verify
 * from being used to grind signatures.
 */
export const authThrottle: RequestHandler = (req, res, next) => {
    const client = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const w = windows.get(client);

    if (w === undefined || now - w.start >= WINDOW_MS) {
        windows.set(client, { start: now, count: 1 });
        if (windows.size > MAX_TRACKED_CLIENTS) dropExpired(now);
        return next();
    }

    if (w.count >= AUTH_RATE_LIMIT_PER_MINUTE) {
        const retryAfter = Math.ceil((w.start + WINDOW_MS - now) / 1000);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({
            message: `Too many authentication requests. Try again in ${retryAfter} second(s).`,
        });
    }

    w.count += 1;
    next();
};
