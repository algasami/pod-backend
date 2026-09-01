import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_CHALLENGE_TTL_MS, AUTH_TOKEN_TTL_MS } from "../src/config.js";
import {
    challengeMessage,
    consumeChallenge,
    issueChallenge,
    issueToken,
    verifyToken,
} from "../src/services/auth-session.js";

test("a challenge can be spent exactly once", () => {
    const { challenge } = issueChallenge();
    assert.equal(consumeChallenge(challenge), true);
    assert.equal(consumeChallenge(challenge), false);
});

test("a challenge the server never issued does not verify", () => {
    assert.equal(consumeChallenge("made-up-challenge"), false);
});

test("an expired challenge does not verify", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { challenge, expiresAt } = issueChallenge();
    t.mock.timers.setTime(expiresAt + 1);
    assert.equal(consumeChallenge(challenge), false);
});

test("challenge expiry matches the configured TTL", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { expiresAt } = issueChallenge();
    assert.equal(expiresAt, 1_000_000 + AUTH_CHALLENGE_TTL_MS);
});

test("the signed message binds version, challenge and fingerprint", () => {
    assert.deepEqual(
        challengeMessage("abc", "SHA256:xyz"),
        Buffer.from("pod-auth-v1\nabc\nSHA256:xyz", "utf8"),
    );
});

test("a token round-trips back to the fingerprint it was issued to", () => {
    const fingerprint = "SHA256:0123456789abcdef";
    const { token } = issueToken(fingerprint);
    assert.equal(verifyToken(token), fingerprint);
});

test("a tampered token is rejected", () => {
    const { token } = issueToken("SHA256:legit");
    const [payload, expiry, mac] = token.split(".") as [string, string, string];

    const forgedPayload = Buffer.from("SHA256:other", "utf8").toString("base64url");
    assert.equal(verifyToken(`${forgedPayload}.${expiry}.${mac}`), null);
    assert.equal(verifyToken(`${payload}.${Number(expiry) + 1}.${mac}`), null);
    assert.equal(verifyToken(`${payload}.${expiry}.${mac.slice(0, -2)}xx`), null);
    assert.equal(verifyToken("not-even-shaped-right"), null);
});

test("an expired token is rejected", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { token, expiresAt } = issueToken("SHA256:legit");
    assert.equal(expiresAt, Date.now() + AUTH_TOKEN_TTL_MS);
    t.mock.timers.setTime(expiresAt + 1);
    assert.equal(verifyToken(token), null);
});
