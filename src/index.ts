import express from "express";
import cors from "cors";
import { errorHandler } from "./middlewares/error-handler.js";
import { videoRoutes } from "./routes/video-routes.js";
import { startUploadCleanup } from "./services/upload-cleanup.js";
import { PORT, UPLOAD_TTL_MINUTES } from "./config.js";

const app = express();
app.use(cors());
app.use(videoRoutes);

app.use(errorHandler);

const stopUploadCleanup = startUploadCleanup();
console.log(`Uploads are removed ${UPLOAD_TTL_MINUTES} minute(s) after they are stored.`);

const server = app.listen(PORT);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        stopUploadCleanup();
        server.close(() => process.exit(0));
    });
}
