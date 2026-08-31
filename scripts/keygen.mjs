#!/usr/bin/env node
/**
 * Generates one client identity: an Ed25519 key pair, split the way ssh-keygen
 * splits one.
 *
 *   node scripts/keygen.mjs "alice@laptop"
 *
 * The public half is printed as an authorized_keys line for the server. The
 * private half is written as a JSON identity file for the frontend to hold —
 * it never goes to the server, and the server can do nothing with it.
 */
import { generateKeyPairSync, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const comment = process.argv[2] ?? "";
const out = process.argv[3] ?? "pod-identity.json";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const spki = publicKey.export({ format: "der", type: "spki" });
const fingerprint = "SHA256:" + createHash("sha256").update(spki).digest("base64url");

const identity = {
    fingerprint,
    comment,
    // A JWK is what the browser's WebCrypto imports directly.
    privateJwk: privateKey.export({ format: "jwk" }),
};

writeFileSync(out, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });

console.log("authorized_keys line (copy this to the server):\n");
console.log(`ed25519 ${spki.toString("base64")} ${comment}`.trim());
console.log(`\nprivate identity written to ${out} (keep it on the client only)`);
console.log(`fingerprint: ${fingerprint}`);
