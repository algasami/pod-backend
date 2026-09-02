import type { ErrorRequestHandler } from "express";
import { STATUS_CODES } from "http";

/**
 * The status an error carries, if it is one a client should see.
 *
 * Express's own body parser attaches one — 400 for malformed JSON, 413 for a
 * body over the route's limit — and those are the caller's fault, not ours.
 * Anything without a 4xx status is treated as a genuine server failure.
 */
const clientStatusOf = (err: unknown) => {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === "number" && status >= 400 && status < 500 ? status : null;
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    const status = clientStatusOf(err);
    if (status !== null) {
        // The generic reason phrase rather than err.message: the parser's
        // message quotes the offending body back, and nothing here needs that.
        return res.status(status).json({ message: `${STATUS_CODES[status] ?? "Bad request"}.` });
    }

    console.error(err);
    res.status(500).json({ message: "Internal server error." });
};
