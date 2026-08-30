import { Router } from "express";
import { videoPostController, videoRootController } from "../controllers/video-controller.js";
import multer from "multer";
import { randomUUIDv7 } from "crypto";
import { mkdirSync } from "fs";

const UPLOAD_DIR = "user-uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename(req, file, callback) {
            callback(null, randomUUIDv7());
        },
    }),
});

export const videoRoutes = Router()
    .get("/", videoRootController)
    .post("/", upload.single("file"), videoPostController);
