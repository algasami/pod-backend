import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The service reads AUTHORIZED_KEYS_PATH from config, and config reads the
// environment at import time — so the fixture file must exist and the variable
// must point at it before the module is (dynamically) imported below.
const keysPath = join(mkdtempSync(join(tmpdir(), "pod-auth-test-")), "authorized_keys");
process.env.AUTHORIZED_KEYS_PATH = keysPath;

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
const rawKey = spki.subarray(spki.length - 32);

const wireString = (value: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
};
const blob = Buffer.concat([wireString(Buffer.from("ssh-ed25519", "utf8")), wireString(rawKey)]);

writeFileSync(
    keysPath,
    [
        "# a comment and a blank line must be skipped",
        "",
        "ssh-rsa AAAAB3NzaC1yc2E= wrong-type@example",
        "garbage that is not a key line at all",
        `ssh-ed25519 ${blob.toString("base64")} tester@example`,
    ].join("\n"),
);

const { fingerprintOf, findAuthorizedKey, verifyWithKey } = await import(
    "../src/services/auth-keys.js"
);

const fingerprint = fingerprintOf(rawKey);

test("only the well-formed ed25519 line is loaded, addressable by fingerprint", () => {
    const entry = findAuthorizedKey(fingerprint);
    assert.ok(entry, "expected the fixture key to be found");
    assert.equal(entry.comment, "tester@example");
    assert.equal(findAuthorizedKey("SHA256:doesnotexist"), null);
});

test("the fingerprint has the ssh-keygen -lf shape", () => {
    assert.match(fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
});

test("a genuine signature verifies; a forged or malformed one does not", () => {
    const entry = findAuthorizedKey(fingerprint)!;
    const message = Buffer.from("pod-auth-v1\nchallenge\n" + fingerprint, "utf8");
    const signature = sign(null, message, privateKey);

    assert.equal(verifyWithKey(entry, message, signature), true);
    assert.equal(verifyWithKey(entry, Buffer.from("something else"), signature), false);

    const flipped = Buffer.from(signature);
    flipped[0]! ^= 0xff;
    assert.equal(verifyWithKey(entry, message, flipped), false);
    // Garbage length: the verifier throws internally and must report false.
    assert.equal(verifyWithKey(entry, message, Buffer.from("short")), false);
});
