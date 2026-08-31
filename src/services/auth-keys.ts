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
 * The file is an OpenSSH authorized_keys file, so `ssh-keygen -t ed25519` output
 * can be copied in as it stands:
 *
 *     ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... alice@laptop
 *
 * Blank lines and `#` comments are skipped, as are keys of any other type.
 */
const KEY_TYPE = "ssh-ed25519";

/** Ed25519 SPKI is a fixed 12-byte prefix followed by the 32-byte key. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Reads one SSH wire-format string: a 32-bit big-endian length, then that many
 * bytes.
 */
const readWireString = (buf: Buffer, offset: number) => {
    if (offset + 4 > buf.length) throw new Error("truncated key blob");
    const length = buf.readUInt32BE(offset);
    const start = offset + 4;
    const end = start + length;
    if (end > buf.length) throw new Error("truncated key blob");
    return { value: buf.subarray(start, end), next: end };
};

/** The inverse: length-prefixes a chunk the way the SSH wire format wants. */
const wireString = (value: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
};

/** The blob an OpenSSH public key base64-encodes: the type, then the key. */
const wireBlobFor = (rawKey: Buffer) =>
    Buffer.concat([wireString(Buffer.from(KEY_TYPE, "utf8")), wireString(rawKey)]);

/**
 * The same fingerprint `ssh-keygen -lf` prints — the base64 SHA-256 of the wire
 * blob, without padding — so what the page displays can be checked against the
 * key file by eye.
 */
export const fingerprintOf = (rawKey: Buffer) =>
    "SHA256:" +
    createHash("sha256").update(wireBlobFor(rawKey)).digest("base64").replace(/=+$/, "");

/**
 * Pulls the raw 32-byte key out of a base64 OpenSSH public key, rejecting
 * anything whose blob does not describe an Ed25519 key of the right size.
 */
const rawKeyFromEncoded = (encoded: string) => {
    const blob = Buffer.from(encoded, "base64");

    const type = readWireString(blob, 0);
    if (type.value.toString("utf8") !== KEY_TYPE) {
        throw new Error(`blob declares ${type.value.toString("utf8")}, not ${KEY_TYPE}`);
    }

    const key = readWireString(blob, type.next);
    if (key.next !== blob.length) throw new Error("trailing bytes after key");
    if (key.value.length !== 32) throw new Error(`key is ${key.value.length} bytes, expected 32`);

    return key.value;
};

const parseAuthorizedKeys = (contents: string) => {
    const keys = new Map<string, AuthorizedKey>();

    contents.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) return;

        const [type, encoded, ...rest] = trimmed.split(/\s+/);
        const lineNo = index + 1;

        if (type !== KEY_TYPE || !encoded) {
            console.warn(
                `[auth] ignoring line ${lineNo}: expected "${KEY_TYPE} <base64> [comment]".`,
            );
            return;
        }

        let rawKey: Buffer;
        let key: KeyObject;
        try {
            rawKey = rawKeyFromEncoded(encoded);
            key = createPublicKey({
                key: Buffer.concat([SPKI_PREFIX, rawKey]),
                format: "der",
                type: "spki",
            });
        } catch (err) {
            console.warn(`[auth] ignoring line ${lineNo}: ${(err as Error).message}.`);
            return;
        }

        const fingerprint = fingerprintOf(rawKey);
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
