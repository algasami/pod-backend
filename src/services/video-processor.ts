import { spawn } from "child_process";
import { randomUUIDv7 } from "crypto";
import { rm } from "fs/promises";
import { resolve } from "path";
import {
    FFMPEG_BIN,
    FFPROBE_BIN,
    LOGO_PATH,
    OUT_AUDIO_BITRATE,
    OUT_SAMPLE_RATE,
    OUT_VIDEO_BITRATE,
    UPLOAD_DIR,
    WATERMARK_MARGIN_RATIO,
    WATERMARK_WIDTH_RATIO,
} from "../config.js";

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

type InputInfo = {
    /** Frame size as the filter graph will see it, i.e. after autorotation. */
    width: number;
    height: number;
    hasAudio: boolean;
};

type ProbedStream = {
    codec_type?: string;
    width?: number;
    height?: number;
    side_data_list?: { rotation?: number }[];
};

async function probeInput(path: string): Promise<InputInfo> {
    const out = await run(FFPROBE_BIN, [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height:stream_side_data=rotation",
        "-of",
        "json",
        path,
    ]);

    const streams: ProbedStream[] = JSON.parse(out).streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    if (!video?.width || !video?.height) {
        throw new Error("Upload has no decodable video stream.");
    }

    // ffmpeg autorotates on decode, so a 90°/270° stream reaches the filter
    // graph with its axes already swapped. Size the overlay against that, not
    // against the stored dimensions.
    const rotation = video.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation;
    const swapped = Math.abs(rotation ?? 0) % 180 === 90;

    return {
        width: swapped ? video.height : video.width,
        height: swapped ? video.width : video.height,
        hasAudio: streams.some((s) => s.codec_type === "audio"),
    };
}

const ENCODE_ARGS = [
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    // no explicit -level: the output takes the source's shape, so a level that
    // fits one upload can be violated by the next. x264 picks a conformant one.
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
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
 * Stamps the logo into the top-right corner of the upload and returns the
 * deliverable's filename.
 *
 * The frame is left exactly as it arrived — no scaling, padding or frame-rate
 * conversion — so a 9:16 recording stays 9:16. On success the raw upload is
 * removed: the deliverable replaces it rather than sitting beside it, so
 * `user-uploads` holds one file per recording.
 */
export async function processVideo(inputFilename: string): Promise<string> {
    const input = resolve(UPLOAD_DIR, inputFilename);
    const outputFilename = randomUUIDv7() + ".mp4";
    const output = resolve(UPLOAD_DIR, outputFilename);

    const { width, height, hasAudio } = await probeInput(input);

    const args: string[] = ["-y", "-i", input, "-i", LOGO_PATH];
    if (!hasAudio) {
        // a recording whose mic delivered nothing has no audio track at all;
        // synthesise silence rather than ship a video-only file
        args.push(
            "-f",
            "lavfi",
            "-i",
            `anullsrc=channel_layout=stereo:sample_rate=${OUT_SAMPLE_RATE}`,
        );
    }

    // yuv420p cannot represent an odd width or height, and nothing guarantees
    // an upload has even ones — WebM in particular allows odd. Trimming a pixel
    // is the smallest correction that keeps the shape.
    const evenWidth = width - (width % 2);
    const evenHeight = height - (height % 2);

    const filters: string[] = [];
    let base = "0:v";
    if (evenWidth !== width || evenHeight !== height) {
        filters.push(`[0:v]scale=${evenWidth}:${evenHeight}[base]`);
        base = "base";
    }

    const logoWidth = Math.round(evenWidth * WATERMARK_WIDTH_RATIO);
    const margin = Math.round(evenWidth * WATERMARK_MARGIN_RATIO);
    filters.push(`[1:v]scale=${logoWidth}:-2[logo]`);
    filters.push(`[${base}][logo]overlay=x=W-w-${margin}:y=${margin},format=yuv420p[v]`);

    args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[v]",
        "-map",
        hasAudio ? "0:a" : "2:a",
    );
    if (!hasAudio) {
        // anullsrc never ends on its own
        args.push("-shortest");
    }
    args.push(...ENCODE_ARGS, output);

    try {
        await run(FFMPEG_BIN, args);
    } catch (err) {
        // never leave a half-written file behind for the GET route to serve
        await rm(output, { force: true });
        throw err;
    }

    // only once the deliverable is safely on disk: a failure above falls back
    // to serving the raw upload, which has to still be there
    await rm(input, { force: true });

    return outputFilename;
}
