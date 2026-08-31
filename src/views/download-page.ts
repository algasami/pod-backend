const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);

export const renderDownloadPage = (filename: string, rawUrl: string, expiresAtMs: number) => {
    const name = escapeHtml(filename);
    const url = escapeHtml(rawUrl);
    // An absolute instant, not a duration: a duration would restart from zero in
    // any copy of this page the browser replays (reload, bfcache, proxy cache),
    // which is what made the countdown appear to reset on refresh.
    const expiresAt = Math.round(expiresAtMs);

    return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<title>下載${name}</title>
<style>
    :root {
        --bg: #dcdcdc;
        --panel: #efefef;
        --fg: #1f1f1f;
        --muted: #5a5a5a;
        --line: #c4c4c4;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --bg: #141414;
            --panel: #1f1f1f;
            --fg: #e4e4e4;
            --muted: #9c9c9c;
            --line: #333333;
        }
    }
    body {
        margin: 0;
        min-height: 100dvh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: var(--bg);
        color: var(--fg);
        font: 17px/1.7 system-ui, -apple-system, "Segoe UI", "Noto Sans TC", sans-serif;
        -webkit-text-size-adjust: 100%;
    }
    .panel {
        box-sizing: border-box;
        width: 100%;
        max-width: 420px;
        padding: 24px 20px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
    }
    h1 { margin: 0 0 16px; font-size: 20px; font-weight: 600; }
    p { margin: 0 0 14px; }
    p:last-child { margin-bottom: 0; }
    .filename {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 15px;
        word-break: break-all;
    }
    .hint { color: var(--muted); font-size: 15px; }
    a { color: var(--fg); }
</style>
</head>
<body>
    <main class="panel">
        <h1>下載影片中</h1>
        <p class="filename">${name}</p>
        <p class="hint">下載正在開始…</p>
        <p class="hint">此連結將在 <span id="expiry"></span> 後失效。</p>
        <p>沒在下載嗎? <a id="manual" href="${url}" download="${name}">點這裡下載</a></p>
    </main>
    <script>
        var expiresAt = ${expiresAt};
        var expiry = document.getElementById("expiry");
        (function tick() {
            var left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
            expiry.textContent =
                Math.floor(left / 3600) + " 時 " +
                Math.floor((left % 3600) / 60) + " 分 " +
                (left % 60) + " 秒";
            if (left > 0) setTimeout(tick, 1000);
        })();
        setTimeout(function () {
            window.location.href = document.getElementById("manual").href;
        }, 600);
    </script>
</body>
</html>
`;
};
