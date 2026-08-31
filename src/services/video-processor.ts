import { spawn } from "child_process";
import { randomUUIDv7 } from "crypto";
import { rm } from "fs/promises";
import path, { resolve } from "path";
import {
    FFMPEG_BIN,
    FFPROBE_BIN,
    LOGO_PATH,
    OUT_AUDIO_BITRATE,
    OUT_MAX_SHORT_SIDE,
    OUT_SAMPLE_RATE,
    OUT_VIDEO_BITRATE,
    UPLOAD_DIR,
    WATERMARK_MARGIN_RATIO,
    WATERMARK_WIDTH_RATIO,
} from "../config.js";

export type ProcessOptions = {
    watermark: boolean;
    /**
     * The take was shot vertically. Cameras like the Osmo Pocket keep sending a
     * 16:9 frame when they rotate and pillarbox the picture inside it, so the
     * 9:16 crop cannot be inferred from the stream's dimensions — the operator
     * has to say so.
     */
    vertical: boolean;
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

// yuv420p cannot represent an odd width or height, and nothing guarantees an
// upload has even ones — WebM in particular allows odd.
const toEven = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const VERTICAL_ASPECT = 9 / 16;

/**
 * Centre-crop that turns a frame into exactly 9:16.
 *
 * On a pillarboxed Osmo take this discards the black bars and leaves the real
 * picture; on a frame that is already 9:16 it is a no-op. Cropping happens
 * before the 1080p fit, so the ceiling applies to the picture that survives
 * rather than to the padding around it — a 4K pillarboxed take crops to
 * 1216x2160 and then lands on a true 1080x1920.
 */
function verticalCrop(width: number, height: number) {
    const cropWidth = Math.min(width, toEven(height * VERTICAL_ASPECT));
    const cropHeight = Math.min(height, toEven(cropWidth / VERTICAL_ASPECT));
    return {
        width: cropWidth,
        height: cropHeight,
        x: Math.round((width - cropWidth) / 2),
        y: Math.round((height - cropHeight) / 2),
    };
}

/**
 * Output size for a take the operator flagged as vertical.
 *
 * The height is derived from the aspect rather than by scaling the crop on each
 * axis, because independent rounding drifts: a 4K pillarbox crops to 1216x2160,
 * whose ratio is already a shade off 9:16, and scaling that lands on 1080x1918
 * instead of 1080x1920.
 *
 * Exact 9:16 in even integers only lands when the width is a multiple of 18, so
 * the result is the closest even pair rather than a guaranteed 0.5625 — 1080p in
 * gives 608x1080, 4K in gives a true 1080x1920. The height is clamped to the
 * crop so the derived value can never stretch the picture: a 406x720 crop asks
 * for 722 rows and must not be handed them.
 *
 * Below the ceiling the native crop is kept rather than upscaled — a 1080p
 * pillarboxed source only holds 608 columns of real picture, and inventing the
 * missing ones would not add detail.
 */
function fitVerticalSize(cropWidth: number, cropHeight: number) {
    const width = toEven(Math.min(OUT_MAX_SHORT_SIDE, cropWidth));
    const height = Math.min(toEven(cropHeight), toEven(width / VERTICAL_ASPECT));
    return { width, height };
}

/**
 * Fits a frame under the 1080p ceiling without imposing a shape on it.
 *
 * The constraint is on the *short* side, which is what makes it aspect-neutral:
 * capping width and height independently at 1920x1080 is the same thing as
 * demanding landscape, because it squeezes a 9:16 frame down to 607x1080.
 * Bounding the short side instead sends 16:9 to 1920x1080 and 9:16 to 1080x1920
 * — both genuinely "1080p", neither reshaped.
 *
 * Sources already under the ceiling keep their size; nothing is ever upscaled.
 */
function fitOutputSize(width: number, height: number) {
    const scale = Math.min(1, OUT_MAX_SHORT_SIDE / Math.min(width, height));
    return { width: toEven(width * scale), height: toEven(height * scale) };
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
 * Builds the deliverable for an upload and returns its filename.
 *
 * The frame keeps its shape: the only geometry applied is the optional 9:16
 * crop the operator asked for and the 1080p ceiling, both of which scale or
 * trim rather than pad. When a take needs none of that — no crop, no watermark,
 * and already under the ceiling — the upload is its own deliverable and no
 * re-encode happens at all.
 *
 * Otherwise the raw upload is removed once the deliverable is safely written,
 * so `user-uploads` holds one file per recording.
 */
export async function processVideo(inputFilename: string, opts: ProcessOptions): Promise<string> {
    const input = resolve(UPLOAD_DIR, inputFilename);

    const { width, height, hasAudio } = await probeInput(input);

    // Work out the geometry first: it decides whether there is anything to do.
    let cropped = { width, height, x: 0, y: 0 };
    if (opts.vertical) {
        cropped = verticalCrop(width, height);
    }
    const needsCrop = cropped.width !== width || cropped.height !== height;

    const out = opts.vertical
        ? fitVerticalSize(cropped.width, cropped.height)
        : fitOutputSize(cropped.width, cropped.height);
    const needsScale = out.width !== cropped.width || out.height !== cropped.height;

    if (!needsCrop && !needsScale && !opts.watermark) {
        return inputFilename;
    }

    const outputFilename = path.parse(inputFilename).name + "-edit.mp4";
    const output = resolve(UPLOAD_DIR, outputFilename);

    let idx = 0;
    const args: string[] = ["-y", "-i", input];
    const recIdx = idx++;

    let logoIdx = -1;
    if (opts.watermark) {
        args.push("-i", LOGO_PATH);
        logoIdx = idx++;
    }

    let silenceIdx = -1;
    if (!hasAudio) {
        // a recording whose mic delivered nothing has no audio track at all;
        // synthesise silence rather than ship a video-only file
        args.push(
            "-f",
            "lavfi",
            "-i",
            `anullsrc=channel_layout=stereo:sample_rate=${OUT_SAMPLE_RATE}`,
        );
        silenceIdx = idx++;
    }

    const filters: string[] = [];
    let label = `${recIdx}:v`;

    if (needsCrop) {
        filters.push(
            `[${label}]crop=${cropped.width}:${cropped.height}:${cropped.x}:${cropped.y}[cropped]`,
        );
        label = "cropped";
    }
    if (needsScale) {
        filters.push(`[${label}]scale=${out.width}:${out.height}[scaled]`);
        label = "scaled";
    }
    if (opts.watermark) {
        // sized against the delivered frame, so the badge keeps the same
        // relative footprint whether the output came out landscape or portrait
        const logoWidth = Math.round(out.width * WATERMARK_WIDTH_RATIO);
        const margin = Math.round(out.width * WATERMARK_MARGIN_RATIO);
        filters.push(`[${logoIdx}:v]scale=${logoWidth}:-2[logo]`);
        filters.push(`[${label}][logo]overlay=x=W-w-${margin}:y=${margin}[stamped]`);
        label = "stamped";
    }
    filters.push(`[${label}]format=yuv420p[v]`);

    args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[v]",
        "-map",
        hasAudio ? `${recIdx}:a` : `${silenceIdx}:a`,
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
