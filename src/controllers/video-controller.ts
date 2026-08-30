import type { RequestHandler } from "express";
import { UPLOAD_DIR } from "../config.js";

const ID_PATTERN = /^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/i;

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

    res.sendFile(id, { root: UPLOAD_DIR }, (err) => {
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
