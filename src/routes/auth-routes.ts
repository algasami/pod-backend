import express, { Router } from "express";
import {
    AUTH_CHALLENGE_TTL_SECONDS,
    AUTH_REQUIRED,
    AUTH_TOKEN_TTL_MINUTES,
} from "../config.js";
import { findAuthorizedKey, verifyWithKey } from "../services/auth-keys.js";
import {
    challengeMessage,
    consumeChallenge,
    issueChallenge,
    issueToken,
} from "../services/auth-session.js";

const asString = (value: unknown) => (typeof value === "string" ? value : "");

export const authRoutes = Router()
    // Only the handshake needs a JSON body; the upload route stays multipart.
    .use("/auth", express.json({ limit: "8kb" }))

    .get("/auth/challenge", (req, res) => {
        const { challenge, expiresAt } = issueChallenge();
        // A challenge is single-use; a cached one is a challenge already spent.
        res.set("Cache-Control", "no-store");
        res.json({
            challenge,
            expiresAt,
            ttlSeconds: AUTH_CHALLENGE_TTL_SECONDS,
            required: AUTH_REQUIRED,
        });
    })

    .post("/auth/verify", (req, res) => {
        const fingerprint = asString(req.body?.fingerprint);
        const challenge = asString(req.body?.challenge);
        const signature = asString(req.body?.signature);

        if (!fingerprint || !challenge || !signature) {
            return res
                .status(400)
                .json({ message: "fingerprint, challenge and signature are required." });
        }

        // Spend the challenge before anything else can fail, so a wrong
        // signature burns the nonce instead of leaving it open for retries.
        const fresh = consumeChallenge(challenge);
        const entry = findAuthorizedKey(fingerprint);

        const ok =
            fresh &&
            entry !== null &&
            verifyWithKey(
                entry,
                challengeMessage(challenge, fingerprint),
                Buffer.from(signature, "base64"),
            );

        if (!ok) {
            // One message for every failure: an unknown key, a stale challenge
            // and a bad signature are indistinguishable from the outside, so
            // this endpoint cannot be used to enumerate authorized keys.
            return res.status(401).json({ message: "Authentication failed." });
        }

        const { token, expiresAt } = issueToken(entry.fingerprint);
        console.log(`[auth] ${entry.comment || entry.fingerprint} authenticated.`);
        res.set("Cache-Control", "no-store");
        res.json({ token, expiresAt, ttlMinutes: AUTH_TOKEN_TTL_MINUTES });
    });
