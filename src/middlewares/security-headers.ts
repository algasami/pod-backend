import type { RequestHandler } from "express";

/**
 * Uploads are served from the same origin as everything else, so the stored
 * Content-Type has to be the last word — without this a caller could still get
 * a mislabelled file sniffed into active content.
 */
export const securityHeaders: RequestHandler = (req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    next();
};
