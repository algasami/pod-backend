import express from "express";
import { errorHandler } from "./middlewares/error-handler.js";
import { videoRoutes } from "./routes/video-routes.js";

const app = express();
app.use(videoRoutes);

app.use(errorHandler);
app.listen(3000);
