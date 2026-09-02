import type { RequestHandler } from "express";
import { AUTH_REQUIRED } from "../config.js";
import { findAuthorizedKey } from "../services/auth-keys.js";
import { verifyToken } from "../services/auth-session.js";

declare global {
    namespace Express {
        interface Request {
            /** Fingerprint of the key this request was authenticated with. */
            clientFingerprint?: string;
        }
    }
}

/**
 * Gates a route behind a token from the challenge-response handshake.
 *
 * The signature was verified once, at /auth/verify, and the token is the
 * server's own statement that it went through, so no signature is re-checked
 * here. The key itself is looked up again, though: the authorized-keys file is
 * re-read whenever it changes, so removing a line revokes that client on its
 * very next request rather than when its token happens to expire.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
    if (!AUTH_REQUIRED) return next();

    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");

    if (scheme?.toLowerCase() !== "bearer" || !token) {
        res.set("WWW-Authenticate", "Bearer");
        return res.status(401).json({ message: "Authentication required.", id: "" });
    }

    const fingerprint = verifyToken(token);
    if (fingerprint === null || findAuthorizedKey(fingerprint) === null) {
        res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
        return res.status(401).json({ message: "Session expired or invalid.", id: "" });
    }

    req.clientFingerprint = fingerprint;
    next();
};
