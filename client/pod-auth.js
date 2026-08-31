/**
 * Browser half of the SSH-style handshake.
 *
 * The private key lives here and is only ever used to sign a nonce the server
 * chose; the signature and the key's fingerprint are all that go over the wire.
 * In exchange the server hands back a bearer token, which is what actually
 * accompanies an upload.
 *
 * Ed25519 in WebCrypto needs Chrome 137+, Firefox 130+ or Safari 17+.
 */

const TEXT = new TextEncoder();

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export class PodAuth {
    /**
     * @param baseUrl origin of the pod backend, e.g. "https://pod.example.com"
     * @param identity the JSON written by the frontend repo's scripts/keygen.mjs
     */
    constructor(baseUrl, identity) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.fingerprint = identity.fingerprint;
        this.privateJwk = identity.privateJwk;
        this.key = null;
        this.session = null;
        this.pending = null;
    }

    async #signingKey() {
        // `extractable: false` — once imported, the key can sign but cannot be
        // read back out, not even by this page's own code.
        this.key ??= await crypto.subtle.importKey(
            "jwk",
            this.privateJwk,
            { name: "Ed25519" },
            false,
            ["sign"],
        );
        return this.key;
    }

    async #handshake() {
        const res = await fetch(`${this.baseUrl}/auth/challenge`, { cache: "no-store" });
        if (!res.ok) throw new Error(`challenge failed: ${res.status}`);
        const { challenge } = await res.json();

        // Must match challengeMessage() in services/auth-session.ts byte for byte.
        const message = TEXT.encode(`pod-auth-v1\n${challenge}\n${this.fingerprint}`);
        const signature = await crypto.subtle.sign("Ed25519", await this.#signingKey(), message);

        const verify = await fetch(`${this.baseUrl}/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fingerprint: this.fingerprint,
                challenge,
                signature: b64(signature),
            }),
        });
        if (!verify.ok) throw new Error("this client is not authorized to upload");

        const { token, expiresAt } = await verify.json();
        return { token, expiresAt };
    }

    /**
     * Returns a valid token, re-running the handshake when the current one is
     * within a minute of expiring. Concurrent callers share one handshake
     * rather than each burning a challenge.
     */
    async token() {
        if (this.session && this.session.expiresAt - Date.now() > 60_000) {
            return this.session.token;
        }
        this.pending ??= this.#handshake()
            .then((session) => {
                this.session = session;
                return session.token;
            })
            .finally(() => {
                this.pending = null;
            });
        return this.pending;
    }

    /** fetch() with the bearer token attached, retrying once if it was stale. */
    async fetch(path, init = {}) {
        const send = async (token) =>
            fetch(`${this.baseUrl}${path}`, {
                ...init,
                headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
            });

        let res = await send(await this.token());
        if (res.status === 401) {
            // The server restarted, or the token aged out mid-flight.
            this.session = null;
            res = await send(await this.token());
        }
        return res;
    }

    /** @param form a FormData carrying the "file" field the backend expects. */
    upload(form) {
        return this.fetch("/", { method: "POST", body: form });
    }
}
