import express from "express";
import cors from "cors";
import { errorHandler } from "./middlewares/error-handler.js";
import { videoRoutes } from "./routes/video-routes.js";

const app = express();
app.use(cors());
app.use(videoRoutes);

app.use(errorHandler);
app.listen(3000);
