import { resolve } from "path";

export const UPLOAD_DIR = resolve(process.cwd(), "user-uploads");

export const PORT = readPositiveNumber("PORT", 3380);

export const UPLOAD_TTL_MINUTES = readPositiveNumber("UPLOAD_TTL_MINUTES", 30);

export const CLEANUP_INTERVAL_MINUTES = readPositiveNumber(
    "CLEANUP_INTERVAL_MINUTES",
    Math.min(5, UPLOAD_TTL_MINUTES),
);

export const UPLOAD_TTL_MS = UPLOAD_TTL_MINUTES * 60_000;
export const CLEANUP_INTERVAL_MS = CLEANUP_INTERVAL_MINUTES * 60_000;

function readPositiveNumber(name: string, fallback: number) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive number, received "${raw}".`);
    }
    return value;
}
