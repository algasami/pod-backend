import { extname } from "path";

const MIME_BY_EXTENSION: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
};

const EXTENSION_BY_MIME: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
    "video/x-msvideo": ".avi",
};

export const ALLOWED_UPLOAD_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

export const resolveUploadExtension = (originalname: string, mimetype: string): string | null => {
    const ext = extname(originalname).toLowerCase();
    if (ext in MIME_BY_EXTENSION) return ext;

    const type = mimetype.split(";")[0]!.trim().toLowerCase();
    return EXTENSION_BY_MIME[type] ?? null;
};

export const serveTypeForExtension = (ext: string) =>
    MIME_BY_EXTENSION[ext.toLowerCase()] ?? "application/octet-stream";
