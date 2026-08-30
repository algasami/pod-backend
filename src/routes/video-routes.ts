import { Router } from "express";
import { videoPostController, videoRootController } from "../controllers/video-controller.js";
import multer from "multer";
import { randomUUIDv7 } from "crypto";

const upload = multer({
    storage: multer.diskStorage({
        destination: "user-uploads",
        filename(req, file, callback) {
            callback(null, randomUUIDv7());
        },
    }),
});

export const videoRoutes = Router()
    .get("/", videoRootController)
    .post("/", upload.single("file"), videoPostController);
