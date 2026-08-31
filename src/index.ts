import express from "express";
import cors from "cors";
import { errorHandler } from "./middlewares/error-handler.js";
import { videoRoutes } from "./routes/video-routes.js";
import { authRoutes } from "./routes/auth-routes.js";
import { startUploadCleanup } from "./services/upload-cleanup.js";
import { securityHeaders } from "./middlewares/security-headers.js";
import { loadAuthorizedKeys } from "./services/auth-keys.js";
import {
    AUTHORIZED_KEYS_PATH,
    AUTH_REQUIRED,
    AUTH_TOKEN_TTL_MINUTES,
    PORT,
    TRUST_PROXY,
    UPLOAD_COOLDOWN_SECONDS,
    UPLOAD_MAX_MB,
    UPLOAD_TTL_MINUTES,
} from "./config.js";

const app = express();
app.set("trust proxy", TRUST_PROXY);
// The browser has to be allowed to send Authorization and to read nothing
// else; the handshake is two plain JSON calls, so no credentials mode is needed.
app.use(cors({ allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(securityHeaders);
// Mounted ahead of videoRoutes, whose GET /:id would otherwise swallow /auth/*.
app.use(authRoutes);
app.use(videoRoutes);

app.use(errorHandler);

// const stopUploadCleanup = startUploadCleanup();
if (AUTH_REQUIRED) {
    const keys = loadAuthorizedKeys();
    if (keys.size === 0) {
        console.warn(
            `No authorized keys in ${AUTHORIZED_KEYS_PATH}; every upload will be rejected.`,
        );
    }
    console.log(`Uploads require a signed challenge; sessions last ${AUTH_TOKEN_TTL_MINUTES} minute(s).`);
} else {
    console.warn("AUTH_REQUIRED=false — uploads are open to anyone who can reach this server.");
}
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
