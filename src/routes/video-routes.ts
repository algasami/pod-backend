import { Router, type RequestHandler } from "express";
import {
    videoGetController,
    videoPostController,
    videoRootController,
} from "../controllers/video-controller.js";
import multer from "multer";
import { randomUUIDv7 } from "crypto";
import { mkdirSync } from "fs";
import { UPLOAD_DIR, UPLOAD_MAX_BYTES, UPLOAD_MAX_MB } from "../config.js";
import { uploadCooldown } from "../middlewares/upload-cooldown.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { ALLOWED_UPLOAD_EXTENSIONS, resolveUploadExtension } from "../services/video-types.js";

mkdirSync(UPLOAD_DIR, { recursive: true });

class UnsupportedUploadError extends Error {}

const upload = multer({
    limits: {
        fileSize: UPLOAD_MAX_BYTES,
        files: 1,
        parts: 8,
    },
    fileFilter(req, file, callback) {
        if (resolveUploadExtension(file.originalname, file.mimetype) === null) {
            return callback(
                new UnsupportedUploadError(
                    `Only video uploads are accepted (${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}).`,
                ),
            );
        }
        callback(null, true);
    },
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename(req, file, callback) {
            const ext = resolveUploadExtension(file.originalname, file.mimetype);
            if (ext === null) {
                return callback(new UnsupportedUploadError("Unsupported upload type."), "");
            }
            callback(null, randomUUIDv7() + ext);
        },
    }),
});

const uploadSingle: RequestHandler = (req, res, next) =>
    upload.single("file")(req, res, (err: unknown) => {
        if (!err) return next();

        // The caller hung up mid-transfer (closed the tab, lost the network,
        // cancelled). Multer has already discarded the partial file and there
        // is nobody left to answer, so this is not a server error — it just
        // must not reach the 500 handler as one.
        if (req.destroyed || res.destroyed) {
            console.warn(`[upload] client ${req.ip ?? "unknown"} disconnected mid-upload.`);
            return res.end();
        }

        if (err instanceof UnsupportedUploadError) {
            return res.status(415).json({ message: err.message, id: "" });
        }
        if (err instanceof multer.MulterError) {
            const message =
                err.code === "LIMIT_FILE_SIZE"
                    ? `Upload exceeds the ${UPLOAD_MAX_MB} MB limit.`
                    : `Upload rejected: ${err.code}.`;
            return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message, id: "" });
        }
        next(err);
    });

export const videoRoutes = Router()
    .get("/", videoRootController)
    .get("/:id", videoGetController)
    // requireAuth runs first so an unauthenticated caller neither claims a
    // cooldown slot nor streams a body onto disk.
    .post("/", requireAuth, uploadCooldown, uploadSingle, videoPostController);
