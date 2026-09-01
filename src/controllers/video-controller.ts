import type { RequestHandler } from "express";
import { processVideo } from "../services/video-processor.js";
import { stat } from "fs";
import { extname, join } from "path";
import { UPLOAD_DIR, UPLOAD_TTL_MS } from "../config.js";
import { renderDownloadPage } from "../views/download-page.js";
import { serveTypeForExtension } from "../services/video-types.js";

const ID_PATTERN = /^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/i;

const isTruthy = (value: unknown) => value === "1" || value === "true";

export const videoRootController: RequestHandler = (req, res, next) => {
    res.json({
        message: "Don't do anything please :( It's a hobby project",
    });
};

export const videoGetController: RequestHandler<{ id: string }> = (req, res, next) => {
    const { id } = req.params;

    if (!ID_PATTERN.test(id)) {
        return res.status(400).json({ message: "Invalid video id." });
    }

    const ext = extname(id);
    const filename = ext ? id : `${id}.mp4`;
    const inline = isTruthy(req.query.inline);
    const raw = isTruthy(req.query.raw);

    const wantsHtml = req.headers.accept?.includes("text/html") ?? false;

    if (wantsHtml && !raw && !inline) {
        const rawUrl = `${req.baseUrl}/${encodeURIComponent(id)}?raw=1`;
        return stat(join(UPLOAD_DIR, id), (err, stats) => {
            if (err) {
                if (err.code === "ENOENT") {
                    return res.status(404).json({ message: "Video not found." });
                }
                return next(err);
            }
            // Expiry is enforced here at serve time, not by a deletion sweep,
            // so the file may still exist on disk past its deadline.
            const expiresAtMs = stats.mtimeMs + UPLOAD_TTL_MS;
            if (expiresAtMs <= Date.now()) {
                return res.status(404).json({ message: "Video not found." });
            }
            // The page is a snapshot of a deadline; a cached copy would show a
            // stale countdown, so every reload has to come back here.
            res.set("Cache-Control", "no-store");
            res.type("html").send(renderDownloadPage(filename, rawUrl, expiresAtMs));
        });
    }
    stat(join(UPLOAD_DIR, id), (err, stats) => {
        if (err) {
            return next(err);
        }
        if (stats.mtimeMs + UPLOAD_TTL_MS - Date.now() <= 0) {
            return res.status(404).json({ message: "Video not found." });
        }
        const headers: Record<string, string> = {
            "Content-Type": serveTypeForExtension(ext),
        };
        if (!inline) {
            headers["Content-Disposition"] = `attachment; filename="${filename}"`;
        }

        res.sendFile(id, { root: UPLOAD_DIR, headers }, (err) => {
            if (!err || res.headersSent) return;
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return res.status(404).json({ message: "Video not found." });
            }
            next(err);
        });
    });
};

export const videoPostController: RequestHandler = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded.", id: "" });
    }

    const raw = req.file.filename;
    const watermark = req.body?.watermark === "1";
    const vertical = req.body?.vertical === "1";

    try {
        // Always offered to the processor, even with both flags off: it still
        // has to bring anything above 1080p down. It returns the upload
        // untouched when there is genuinely nothing to do.
        const id = await processVideo(raw, { watermark, vertical });
        res.json({ message: "Success", id });
    } catch (err) {
        console.error("[process] failed, serving raw upload", err);
        res.json({ message: "Processed failed; raw recording returned.", id: raw });
    }
};
