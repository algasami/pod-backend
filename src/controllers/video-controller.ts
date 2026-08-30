import type { RequestHandler } from "express";

export const videoRootController: RequestHandler = (req, res, next) => {
    res.json({
        message: "video root get",
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
