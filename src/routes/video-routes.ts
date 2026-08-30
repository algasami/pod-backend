import { Router } from "express";
import {
    videoGetController,
    videoPostController,
    videoRootController,
} from "../controllers/video-controller.js";
import multer from "multer";
import { randomUUIDv7 } from "crypto";
import { mkdirSync } from "fs";
import { extname } from "path";
import { UPLOAD_DIR } from "../config.js";

mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename(req, file, callback) {
            const ext = extname(file.originalname).toLowerCase();
            callback(null, randomUUIDv7() + (/^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ""));
        },
    }),
});

export const videoRoutes = Router()
    .get("/", videoRootController)
    .get("/:id", videoGetController)
    .post("/", upload.single("file"), videoPostController);
