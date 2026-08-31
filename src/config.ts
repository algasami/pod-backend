import { randomBytes } from "crypto";
import { resolve } from "path";

export const UPLOAD_DIR = resolve(process.cwd(), "user-uploads");
export const RESOURCES_DIR = resolve(process.cwd(), "resources");

export const LOGO_PATH = resolve(RESOURCES_DIR, "logo_text_only.png");

export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
export const FFPROBE_BIN = process.env.FFPROBE_BIN ?? "ffprobe";

// A 1080p ceiling that does not impose a shape: whatever the source's aspect
// ratio, the *short* side is brought down to at most this, and the long side
// follows the ratio. 16:9 lands on 1920x1080, 9:16 on 1080x1920. Sources below
// the ceiling are never upscaled.
export const OUT_MAX_SHORT_SIDE = 1080;

export const OUT_VIDEO_BITRATE = "8M";
export const OUT_AUDIO_BITRATE = "384k";
export const OUT_SAMPLE_RATE = 48000;

// The output keeps whatever shape the source has, so the watermark is sized
// against each frame rather than a fixed canvas. The frontend preview mirrors
// these ratios — see .wm-preview in index.html.
export const WATERMARK_WIDTH_RATIO = 0.1;
export const WATERMARK_MARGIN_RATIO = 0.0167;

export const PORT = readPositiveNumber("PORT", 3380);

export const UPLOAD_TTL_MINUTES = readPositiveNumber("UPLOAD_TTL_MINUTES", 24 * 60);

export const UPLOAD_MAX_MB = readPositiveNumber("UPLOAD_MAX_MB", 256);

export const UPLOAD_COOLDOWN_SECONDS = readNonNegativeNumber("UPLOAD_COOLDOWN_SECONDS", 10);

// The cooldown keys on the caller's address, so it is only meaningful if the
// address is the caller's and not the tunnel's. The default trusts an
// X-Forwarded-For only when the connection itself came from loopback, which is
// exactly the shape of a local tunnel client (cloudflared, ngrok) and nothing
// reachable from outside the box.
export const TRUST_PROXY = readTrustProxy("TRUST_PROXY", "loopback");

export const CLEANUP_INTERVAL_MINUTES = readPositiveNumber(
    "CLEANUP_INTERVAL_MINUTES",
    Math.min(5, UPLOAD_TTL_MINUTES),
);

// Authentication is SSH-shaped: the server keeps the clients' public keys and
// a client proves it holds the matching private key. See services/auth-keys.ts
// for the file format.
export const AUTHORIZED_KEYS_PATH =
    process.env.AUTHORIZED_KEYS_PATH?.trim() || resolve(process.cwd(), "authorized_keys");

// Auth can be switched off for local work, but never silently: leaving it on
// with an empty key file locks everyone out, which is the safer accident.
export const AUTH_REQUIRED = process.env.AUTH_REQUIRED?.trim().toLowerCase() !== "false";

// A challenge only has to survive one round trip.
export const AUTH_CHALLENGE_TTL_SECONDS = readPositiveNumber("AUTH_CHALLENGE_TTL_SECONDS", 60);

export const AUTH_TOKEN_TTL_MINUTES = readPositiveNumber("AUTH_TOKEN_TTL_MINUTES", 60);

// Without a configured secret the server picks one at boot, which is fine for a
// single process — it just means every restart invalidates outstanding tokens
// and clients have to sign a fresh challenge.
export const AUTH_TOKEN_SECRET = (() => {
    const configured = process.env.AUTH_TOKEN_SECRET?.trim();
    if (configured) return Buffer.from(configured, "utf8");
    console.warn("[auth] AUTH_TOKEN_SECRET is unset; tokens will not survive a restart.");
    return randomBytes(32);
})();

// Pending challenges are unauthenticated state, so they are capped.
export const AUTH_MAX_PENDING_CHALLENGES = 1024;

export const AUTH_CHALLENGE_TTL_MS = AUTH_CHALLENGE_TTL_SECONDS * 1000;
export const AUTH_TOKEN_TTL_MS = AUTH_TOKEN_TTL_MINUTES * 60_000;

export const UPLOAD_MAX_BYTES = Math.floor(UPLOAD_MAX_MB * 1024 * 1024);
export const UPLOAD_COOLDOWN_MS = UPLOAD_COOLDOWN_SECONDS * 1000;

export const UPLOAD_TTL_MS = UPLOAD_TTL_MINUTES * 60_000;
export const CLEANUP_INTERVAL_MS = CLEANUP_INTERVAL_MINUTES * 60_000;

function readPositiveNumber(name: string, fallback: number) {
    return readNumber(name, fallback, (value) => value > 0, "a positive number");
}

function readNonNegativeNumber(name: string, fallback: number) {
    return readNumber(name, fallback, (value) => value >= 0, "zero or a positive number");
}

function readNumber(
    name: string,
    fallback: number,
    accept: (value: number) => boolean,
    expected: string,
) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value) || !accept(value)) {
        throw new Error(`${name} must be ${expected}, received "${raw}".`);
    }
    return value;
}

function readTrustProxy(name: string, fallback: string): boolean | number | string {
    const raw = process.env[name]?.trim();
    if (raw === undefined || raw === "") return fallback;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
}
