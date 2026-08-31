import type { RequestHandler } from "express";
import { stat } from "fs";
import { extname, join } from "path";
import { UPLOAD_DIR } from "../config.js";
import { renderDownloadPage } from "../views/download-page.js";

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
        return stat(join(UPLOAD_DIR, id), (err) => {
            if (err) {
                if (err.code === "ENOENT") {
                    return res.status(404).json({ message: "Video not found." });
                }
                return next(err);
            }
            res.type("html").send(renderDownloadPage(filename, rawUrl));
        });
    }

    const headers: Record<string, string> = {};
    if (!inline) {
        headers["Content-Disposition"] = `attachment; filename="${filename}"`;
    }
    if (!ext) {
        headers["Content-Type"] = "video/mp4";
    }

    res.sendFile(id, { root: UPLOAD_DIR, headers }, (err) => {
        if (!err || res.headersSent) return;
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return res.status(404).json({ message: "Video not found." });
        }
        next(err);
    });
};

export const videoPostController: RequestHandler = (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded.", id: "" });
    }
    res.json({
        message: "Success",
        id: req.file.filename,
    });
};
