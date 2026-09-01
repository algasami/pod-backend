import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUploadExtension, serveTypeForExtension } from "../src/services/video-types.js";

test("a known extension wins regardless of the declared type", () => {
    assert.equal(resolveUploadExtension("take.MOV", "application/octet-stream"), ".mov");
    assert.equal(resolveUploadExtension("clip.mp4", "video/mp4"), ".mp4");
});

test("a known MIME type fills in when the name has no usable extension", () => {
    assert.equal(resolveUploadExtension("blob", "video/webm"), ".webm");
    assert.equal(resolveUploadExtension("blob", "video/mp4; codecs=avc1"), ".mp4");
});

test("anything else is rejected", () => {
    assert.equal(resolveUploadExtension("notes.txt", "text/plain"), null);
    assert.equal(resolveUploadExtension("page.html", "text/html"), null);
    assert.equal(resolveUploadExtension("blob", "application/octet-stream"), null);
});

test("serving falls back to octet-stream for unknown extensions", () => {
    assert.equal(serveTypeForExtension(".mp4"), "video/mp4");
    assert.equal(serveTypeForExtension(".MKV"), "video/x-matroska");
    assert.equal(serveTypeForExtension(".exe"), "application/octet-stream");
    assert.equal(serveTypeForExtension(""), "application/octet-stream");
});
