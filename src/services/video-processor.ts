import { spawn } from "child_process";
import { randomUUIDv7 } from "crypto";
import { rm } from "fs/promises";
import { resolve } from "path";
import {
    FFMPEG_BIN,
    FFPROBE_BIN,
    INTRO_PATH,
    LOGO_PATH,
    OUT_AUDIO_BITRATE,
    OUT_FPS,
    OUT_HEIGHT,
    OUT_SAMPLE_RATE,
    OUT_VIDEO_BITRATE,
    OUT_WIDTH,
    UPLOAD_DIR,
    WATERMARK_MARGIN,
    WATERMARK_WIDTH,
} from "../config.js";

export type ProcessOptions = {
    watermark: boolean;
    intro: boolean;
};

function run(bin: string, args: string[]): Promise<string> {
    return new Promise((res, rej) => {
        const child = spawn(bin, args);
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", rej);
        child.on("close", (code) => {
            if (code === 0) return res(out.trim());
            rej(
                new Error(`${bin} exited ${code}: ${err.trim().split("\n").slice(-6).join(" | ")}`),
            );
        });
    });
}

async function hasAudioStream(path: string): Promise<boolean> {
    const out = await run(FFPROBE_BIN, [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        path,
    ]);
    return out.length > 0;
}

function normaliseVideo(label: string, out: string) {
    return (
        `[${label}]scale=${OUT_WIDTH}:${OUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${OUT_WIDTH}:${OUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${OUT_FPS},` +
        `format=yuv420p[${out}]`
    );
}

function normaliseAudio(label: string, out: string) {
    return (
        `[${label}]aformat=sample_rates=${OUT_SAMPLE_RATE}:channel_layouts=stereo,` +
        `asetpts=N/SR/TB[${out}]`
    );
}

const ENCODE_ARGS = [
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(OUT_FPS),
    "-b:v",
    OUT_VIDEO_BITRATE,
    "-maxrate",
    OUT_VIDEO_BITRATE,
    "-bufsize",
    "16M",
    "-c:a",
    "aac",
    "-b:a",
    OUT_AUDIO_BITRATE,
    "-ar",
    String(OUT_SAMPLE_RATE),
    "-ac",
    "2",
    // moov atom up front so a phone can start playing before the whole file
    // has arrived — this is what makes the QR link feel instant
    "-movflags",
    "+faststart",
];

/**
 * Builds the processed deliverable next to the raw upload and returns its
 * filename. The raw upload is left in place as the master.
 */
export async function processVideo(inputFilename: string, opts: ProcessOptions): Promise<string> {
    const input = resolve(UPLOAD_DIR, inputFilename);
    const outputFilename = randomUUIDv7() + ".mp4";
    const output = resolve(UPLOAD_DIR, outputFilename);

    const recHasAudio = await hasAudioStream(input);

    const args: string[] = ["-y"];
    const filters: string[] = [];

    // input order: [intro?] recording [logo?] [silence?]
    let idx = 0;
    let introIdx = -1;
    if (opts.intro) {
        args.push("-i", INTRO_PATH);
        introIdx = idx++;
    }
    args.push("-i", input);
    const recIdx = idx++;
    let logoIdx = -1;
    if (opts.watermark) {
        args.push("-i", LOGO_PATH);
        logoIdx = idx++;
    }
    // a recording whose mic delivered nothing has no audio track at all; concat
    // still needs one, so synthesise silence rather than failing the upload
    let silenceIdx = -1;
    if (!recHasAudio) {
        args.push(
            "-f",
            "lavfi",
            "-t",
            "0.1",
            "-i",
            `anullsrc=channel_layout=stereo:sample_rate=${OUT_SAMPLE_RATE}`,
        );
        silenceIdx = idx++;
    }

    filters.push(normaliseVideo(`${recIdx}:v`, "recbase"));
    let recVideo = "recbase";

    if (opts.watermark) {
        filters.push(`[${logoIdx}:v]scale=${WATERMARK_WIDTH}:-1[logo]`);
        filters.push(
            `[recbase][logo]overlay=W-w-${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}[recwm]`,
        );
        recVideo = "recwm";
    }

    const recAudioSrc = recHasAudio ? `${recIdx}:a` : `${silenceIdx}:a`;
    filters.push(normaliseAudio(recAudioSrc, "reca"));

    let vOut: string;
    let aOut: string;

    if (opts.intro) {
        filters.push(normaliseVideo(`${introIdx}:v`, "introv"));
        filters.push(normaliseAudio(`${introIdx}:a`, "introa"));
        filters.push(`[introv][introa][${recVideo}][reca]concat=n=2:v=1:a=1[v][a]`);
        vOut = "[v]";
        aOut = "[a]";
    } else {
        vOut = `[${recVideo}]`;
        aOut = "[reca]";
    }

    args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        vOut,
        "-map",
        aOut,
        ...ENCODE_ARGS,
        output,
    );

    try {
        await run(FFMPEG_BIN, args);
    } catch (err) {
        // never leave a half-written file behind for the GET route to serve
        await rm(output, { force: true });
        throw err;
    }

    return outputFilename;
}
