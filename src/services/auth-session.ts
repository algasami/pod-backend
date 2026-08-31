import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
    AUTH_CHALLENGE_TTL_MS,
    AUTH_TOKEN_SECRET,
    AUTH_TOKEN_TTL_MS,
    AUTH_MAX_PENDING_CHALLENGES,
} from "../config.js";

/**
 * The string the client actually signs.
 *
 * Three things are baked in deliberately. The version prefix keeps a signature
 * from this protocol from ever being replayed into a future one. The
 * fingerprint binds the signature to the key that produced it, so a signature
 * lifted off the wire cannot be presented as a different client's. The
 * challenge is server-issued and single-use, so a captured signature is worth
 * nothing the second time.
 */
export const challengeMessage = (challenge: string, fingerprint: string) =>
    Buffer.from(`pod-auth-v1\n${challenge}\n${fingerprint}`, "utf8");

const pending = new Map<string, number>();

const dropExpiredChallenges = (now: number) => {
    for (const [challenge, expiresAt] of pending) {
        if (expiresAt <= now) pending.delete(challenge);
    }
};

/**
 * Issues a fresh nonce. Nothing about the caller is recorded — the nonce is
 * only proof that the server, not the client, chose what would be signed.
 */
export const issueChallenge = () => {
    const now = Date.now();
    if (pending.size >= AUTH_MAX_PENDING_CHALLENGES) dropExpiredChallenges(now);
    // Still full after the sweep means someone is farming challenges; drop the
    // oldest rather than growing without bound.
    if (pending.size >= AUTH_MAX_PENDING_CHALLENGES) {
        const oldest = pending.keys().next();
        if (!oldest.done) pending.delete(oldest.value);
    }

    const challenge = randomBytes(32).toString("base64url");
    pending.set(challenge, now + AUTH_CHALLENGE_TTL_MS);
    return { challenge, expiresAt: now + AUTH_CHALLENGE_TTL_MS };
};

/**
 * Spends a challenge. Returns false if it was never issued, has expired, or has
 * already been used — deleting on first sight is what makes it single-use even
 * when two requests arrive together.
 */
export const consumeChallenge = (challenge: string) => {
    const expiresAt = pending.get(challenge);
    if (expiresAt === undefined) return false;
    pending.delete(challenge);
    return expiresAt > Date.now();
};

const sign = (payload: string) =>
    createHmac("sha256", AUTH_TOKEN_SECRET).update(payload).digest("base64url");

/**
 * Tokens are self-contained: `<fingerprint>.<expiry>.<hmac>`. Verification is a
 * signature check and a clock read, so nothing has to be kept in memory and a
 * restart with a stable AUTH_TOKEN_SECRET does not log everyone out.
 */
export const issueToken = (fingerprint: string) => {
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_MS;
    const payload = `${Buffer.from(fingerprint, "utf8").toString("base64url")}.${expiresAt}`;
    return { token: `${payload}.${sign(payload)}`, expiresAt };
};

/**
 * @returns the fingerprint the token was issued to, or null if it is malformed,
 * forged, or past its expiry.
 */
export const verifyToken = (token: string) => {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedFingerprint, expiry, mac] = parts as [string, string, string];
    const expected = sign(`${encodedFingerprint}.${expiry}`);

    // Length is compared first because timingSafeEqual throws on a mismatch;
    // the length of a token is not a secret.
    const given = Buffer.from(mac, "utf8");
    const want = Buffer.from(expected, "utf8");
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

    const expiresAt = Number(expiry);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    return Buffer.from(encodedFingerprint, "base64url").toString("utf8");
};
