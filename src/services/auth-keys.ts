import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "crypto";
import { readFileSync, statSync } from "fs";
import { AUTHORIZED_KEYS_PATH } from "../config.js";

/**
 * An entry from the authorized-keys file: the key itself, the fingerprint the
 * client names itself by, and the trailing comment (kept only for logging).
 */
export type AuthorizedKey = {
    fingerprint: string;
    comment: string;
    key: KeyObject;
};

/**
 * The line format mirrors OpenSSH's authorized_keys closely enough to be
 * familiar: a type, the key, and a free-form comment.
 *
 *     ed25519 <base64 SPKI DER> alice@laptop
 *
 * Blank lines and `#` comments are skipped. The key is a plain SPKI export
 * rather than the SSH wire format, because that is what both Node's
 * createPublicKey and the browser's WebCrypto hand you directly.
 */
const KEY_TYPE = "ed25519";

/**
 * SSH names a key by the base64 SHA-256 of its wire bytes; the same idea over
 * the SPKI bytes gives a stable, collision-resistant handle the client can send
 * without revealing anything the server does not already know.
 */
export const fingerprintOf = (spki: Buffer) =>
    "SHA256:" + createHash("sha256").update(spki).digest("base64url");

const parseAuthorizedKeys = (contents: string) => {
    const keys = new Map<string, AuthorizedKey>();

    contents.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) return;

        const [type, encoded, ...rest] = trimmed.split(/\s+/);
        const lineNo = index + 1;

        if (type?.toLowerCase() !== KEY_TYPE || !encoded) {
            console.warn(`[auth] ignoring line ${lineNo}: expected "${KEY_TYPE} <base64> [comment]".`);
            return;
        }

        let spki: Buffer;
        let key: KeyObject;
        try {
            spki = Buffer.from(encoded, "base64");
            key = createPublicKey({ key: spki, format: "der", type: "spki" });
        } catch (err) {
            console.warn(`[auth] ignoring line ${lineNo}: key is not a readable SPKI blob.`, err);
            return;
        }

        if (key.asymmetricKeyType !== "ed25519") {
            console.warn(`[auth] ignoring line ${lineNo}: key is ${key.asymmetricKeyType}, not ed25519.`);
            return;
        }

        const fingerprint = fingerprintOf(spki);
        keys.set(fingerprint, { fingerprint, comment: rest.join(" "), key });
    });

    return keys;
};

let cache: { mtimeMs: number; size: number; keys: Map<string, AuthorizedKey> } | null = null;

/**
 * Reads the authorized-keys file, re-reading it whenever it changes on disk so
 * a key can be added or revoked without a restart. A missing file is not an
 * error — it simply means nobody is authorized yet.
 */
export const loadAuthorizedKeys = () => {
    let stats;
    try {
        stats = statSync(AUTHORIZED_KEYS_PATH);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            cache = null;
            return new Map<string, AuthorizedKey>();
        }
        throw err;
    }

    if (cache && cache.mtimeMs === stats.mtimeMs && cache.size === stats.size) {
        return cache.keys;
    }

    const keys = parseAuthorizedKeys(readFileSync(AUTHORIZED_KEYS_PATH, "utf8"));
    cache = { mtimeMs: stats.mtimeMs, size: stats.size, keys };
    console.log(`[auth] loaded ${keys.size} authorized key(s) from ${AUTHORIZED_KEYS_PATH}.`);
    return keys;
};

export const findAuthorizedKey = (fingerprint: string) =>
    loadAuthorizedKeys().get(fingerprint) ?? null;

/**
 * Ed25519 signs the message itself rather than a digest of it, so there is no
 * hash argument here — `null` is what Node expects for this curve.
 */
export const verifyWithKey = (entry: AuthorizedKey, message: Buffer, signature: Buffer) => {
    // A malformed signature makes the verifier throw rather than return false.
    try {
        return verifySignature(null, message, entry.key, signature);
    } catch {
        return false;
    }
};
