const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);

export const renderDownloadPage = (filename: string, rawUrl: string) => {
    const name = escapeHtml(filename);
    const url = escapeHtml(rawUrl);

    return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<title>下載${name}</title>
<style>
    :root {
        --bg: #d6d6d6;
        --panel: #ececec;
        --ink: #101010;
        --muted: #4a4a4a;
        --line: #101010;
        --bar: #101010;
        --track: #bcbcbc;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --bg: #171717;
            --panel: #232323;
            --ink: #ededed;
            --muted: #a8a8a8;
            --line: #ededed;
            --bar: #ededed;
            --track: #3a3a3a;
        }
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
        margin: 0;
        min-height: 100dvh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: var(--bg);
        color: var(--ink);
        font: 16px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace;
        -webkit-font-smoothing: antialiased;
    }
    .card {
        width: 100%;
        max-width: 460px;
        background: var(--panel);
        border: 3px solid var(--line);
        box-shadow: 8px 8px 0 var(--line);
    }
    .bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 16px;
        border-bottom: 3px solid var(--line);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: .14em;
        text-transform: uppercase;
    }
    .body { padding: 20px 16px 24px; }
    h1 {
        margin: 0 0 14px;
        font-size: 26px;
        line-height: 1.25;
        font-weight: 700;
        letter-spacing: -.01em;
    }
    .meta {
        margin: 0 0 6px;
        font-size: 12px;
        letter-spacing: .14em;
        text-transform: uppercase;
        color: var(--muted);
    }
    .filename {
        margin: 0 0 20px;
        padding: 12px 14px;
        border: 2px solid var(--line);
        background: var(--bg);
        font-size: 15px;
        line-height: 1.45;
        word-break: break-all;
    }
    .track {
        height: 16px;
        margin: 0 0 20px;
        border: 2px solid var(--line);
        background: var(--track);
        overflow: hidden;
    }
    .track > i {
        display: block;
        width: 40%;
        height: 100%;
        background: var(--bar);
        animation: slide 1.1s linear infinite;
    }
    @keyframes slide {
        from { transform: translateX(-100%); }
        to { transform: translateX(250%); }
    }
    @media (prefers-reduced-motion: reduce) {
        .track > i { animation: none; width: 100%; }
    }
    .hint {
        margin: 0 0 16px;
        font-size: 15px;
        color: var(--muted);
    }
    a.btn {
        display: block;
        padding: 16px;
        border: 3px solid var(--line);
        background: var(--ink);
        color: var(--panel);
        font: inherit;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: .1em;
        text-align: center;
        text-transform: uppercase;
        text-decoration: none;
        box-shadow: 5px 5px 0 var(--line);
    }
    a.btn:active {
        transform: translate(5px, 5px);
        box-shadow: 0 0 0 var(--line);
    }
    a.btn:focus-visible { outline: 3px solid var(--line); outline-offset: 4px; }
    @media (max-width: 380px) {
        body { padding: 14px; }
        .card { box-shadow: 6px 6px 0 var(--line); }
        h1 { font-size: 22px; }
    }
</style>
</head>
<body>
    <main class="card">
        <div class="bar"><span>下載中</span><span aria-hidden="true">///</span></div>
        <div class="body">
            <h1>下載影片中</h1>
            <p class="meta">檔案名稱</p>
            <p class="filename">${name}</p>
            <div class="track" role="img" aria-label="下載中"><i></i></div>
            <p class="hint">下載正在開始… 沒在下載嗎?</p>
            <a class="btn" id="manual" href="${url}" download="${name}">點這裡下載</a>
        </div>
    </main>
    <script>
        setTimeout(function () {
            window.location.href = document.getElementById("manual").href;
        }, 600);
    </script>
</body>
</html>
`;
};
