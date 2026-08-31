import express from "express";
import cors from "cors";
import { errorHandler } from "./middlewares/error-handler.js";
import { videoRoutes } from "./routes/video-routes.js";
import { startUploadCleanup } from "./services/upload-cleanup.js";
import { securityHeaders } from "./middlewares/security-headers.js";
import {
    PORT,
    TRUST_PROXY,
    UPLOAD_COOLDOWN_SECONDS,
    UPLOAD_MAX_MB,
    UPLOAD_TTL_MINUTES,
} from "./config.js";

const app = express();
app.set("trust proxy", TRUST_PROXY);
app.use(cors());
app.use(securityHeaders);
app.use(videoRoutes);

app.use(errorHandler);

// const stopUploadCleanup = startUploadCleanup();
console.log(`Uploads are removed ${UPLOAD_TTL_MINUTES} minute(s) after they are stored.`);
console.log(
    `Uploads are capped at ${UPLOAD_MAX_MB} MB, one every ${UPLOAD_COOLDOWN_SECONDS} second(s) per client.`,
);

const server = app.listen(PORT);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        // stopUploadCleanup();
        server.close(() => process.exit(0));
    });
}
