import { resolve } from "path";

export const UPLOAD_DIR = resolve(process.cwd(), "user-uploads");
export const RESOURCES_DIR = resolve(process.cwd(), "resources");

export const LOGO_PATH = resolve(RESOURCES_DIR, "logo_resource.png");
export const INTRO_PATH = resolve(RESOURCES_DIR, "YT片頭.mp4");

export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
export const FFPROBE_BIN = process.env.FFPROBE_BIN ?? "ffprobe";

export const OUT_WIDTH = 1920;
export const OUT_HEIGHT = 1080;
export const OUT_FPS = 30;
export const OUT_VIDEO_BITRATE = "8M";
export const OUT_AUDIO_BITRATE = "384k";
export const OUT_SAMPLE_RATE = 48000;

export const WATERMARK_WIDTH = Math.round(OUT_WIDTH * 0.1);
export const WATERMARK_MARGIN = Math.round(OUT_WIDTH * 0.0167);
