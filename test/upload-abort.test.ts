import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
import { readdirSync } from "node:fs";

// The route stack is exercised without the auth handshake or the cooldown in
// the way; both read the environment at import time, so set it before loading.
process.env.AUTH_REQUIRED = "false";
process.env.UPLOAD_COOLDOWN_SECONDS = "0";

const { default: express } = await import("express");
const { videoRoutes } = await import("../src/routes/video-routes.js");
const { errorHandler } = await import("../src/middlewares/error-handler.js");
const { UPLOAD_DIR } = await import("../src/config.js");

test("an upload cut off mid-transfer is not a server error", async (t) => {
    const errors = t.mock.method(console, "error");
    const warns = t.mock.method(console, "warn");

    const app = express().use(videoRoutes).use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());

    const filesBefore = new Set(readdirSync(UPLOAD_DIR));

    const boundary = "----abort-test-boundary";
    const partialBody =
        [
            `--${boundary}`,
            'Content-Disposition: form-data; name="file"; filename="clip.mp4"',
            "Content-Type: video/mp4",
            "",
            "",
        ].join("\r\n") + "x".repeat(4096);

    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write(
        [
            "POST / HTTP/1.1",
            "Host: 127.0.0.1",
            `Content-Type: multipart/form-data; boundary=${boundary}`,
            // A claimed length far beyond what is sent keeps the request open.
            `Content-Length: ${partialBody.length + 1_000_000}`,
            "",
            partialBody,
        ].join("\r\n"),
    );

    // Give multer a moment to start streaming the part, then hang up the way
    // a closed tab does.
    await new Promise((resolve) => setTimeout(resolve, 150));
    socket.destroy();

    // The disconnect path announces itself with a one-line warning; wait for
    // that rather than for a response that will never come.
    const sawDisconnectWarning = () =>
        warns.mock.calls.some((call) =>
            String(call.arguments[0]).includes("disconnected mid-upload"),
        );
    const deadline = Date.now() + 2000;
    while (!sawDisconnectWarning() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(sawDisconnectWarning(), "expected the disconnect to be logged as a warning");
    assert.equal(errors.mock.calls.length, 0, "a client disconnect must not reach the 500 handler");

    // Multer discards the partial file; nothing new may be left behind.
    for (const name of readdirSync(UPLOAD_DIR)) {
        assert.ok(filesBefore.has(name), `partial upload left behind: ${name}`);
    }
});
