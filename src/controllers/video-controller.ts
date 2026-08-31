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
        message: "video root get",
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
            // The cleanup sweep expires files by mtime, so the same clock drives the
            // countdown the page shows.
            const remainingMs = stats.mtimeMs + UPLOAD_TTL_MS - Date.now();
            res.type("html").send(renderDownloadPage(filename, rawUrl, remainingMs));
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

    if (!watermark) {
        return res.json({ message: "Success", id: raw });
    }

    try {
        const id = await processVideo(raw);
        res.json({ message: "Success", id });
    } catch (err) {
        console.error("[process] failed, serving raw upload", err);
        res.json({ message: "Processed failed; raw recording returned.", id: raw });
    }
};
