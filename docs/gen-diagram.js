// Generates the Daybook architecture diagram (standalone page + fragment spliced into build-plan.html)
const fs = require("fs");
const OUT = require("path").join(__dirname, "/");

const css = `/* dd:start — diagram-design skin matched to the Daybook plan page */
.dd{--dd-paper:#ffffff;--dd-node:#ffffff;--dd-ink:#1b2430;--dd-muted:#4a586a;--dd-soft:#5d6b7c;--dd-line:#dde2e9;
  --dd-accent:#1f6feb;--dd-tint:rgba(31,111,235,.08);--dd-link:#0b7285;--dd-store:#eef1f5;--dd-ext:#f6f7f9;--dd-ext-line:#8793a3;--dd-zone:rgba(27,36,48,.02);--dd-zone2:rgba(27,36,48,.035);--dd-zone-line:rgba(27,36,48,.14);--dd-leader:rgba(27,36,48,.4)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .dd{--dd-paper:#171e28;--dd-node:#1d2633;--dd-ink:#e6ebf2;--dd-muted:#aab6c5;--dd-soft:#93a1b3;--dd-line:#273140;
  --dd-accent:#5b9bff;--dd-tint:rgba(91,155,255,.14);--dd-link:#4fc3d0;--dd-store:#212b3a;--dd-ext:#141a23;--dd-ext-line:#6c7a8c;--dd-zone:rgba(230,235,242,.025);--dd-zone2:rgba(230,235,242,.045);--dd-zone-line:rgba(230,235,242,.16);--dd-leader:rgba(230,235,242,.45)}}
:root[data-theme="dark"] .dd{--dd-paper:#171e28;--dd-node:#1d2633;--dd-ink:#e6ebf2;--dd-muted:#aab6c5;--dd-soft:#93a1b3;--dd-line:#273140;
  --dd-accent:#5b9bff;--dd-tint:rgba(91,155,255,.14);--dd-link:#4fc3d0;--dd-store:#212b3a;--dd-ext:#141a23;--dd-ext-line:#6c7a8c;--dd-zone:rgba(230,235,242,.025);--dd-zone2:rgba(230,235,242,.045);--dd-zone-line:rgba(230,235,242,.16);--dd-leader:rgba(230,235,242,.45)}
.dd{align-self:center;width:min(1320px,calc(100vw - 40px));background:var(--dd-paper);border:1px solid var(--dd-line);border-radius:8px;padding:16px;overflow-x:auto;margin:0}
.dd svg{width:100%;min-width:1280px;display:block}
@media print{.dd{overflow-x:visible}.dd svg{min-width:0}}
.dd .bg{fill:var(--dd-paper)}
.dd .zone{fill:var(--dd-zone);stroke:var(--dd-zone-line);stroke-width:.8}
.dd .zone2{fill:var(--dd-zone2);stroke:var(--dd-zone-line);stroke-width:.8}
.dd .mask{fill:var(--dd-paper)}
.dd .ey{fill:var(--dd-soft);font-family:'IBM Plex Mono',ui-monospace,monospace}
.dd .al{fill:var(--dd-soft);font-family:'IBM Plex Mono',ui-monospace,monospace}
.dd .al-acc{fill:var(--dd-accent)}.dd .al-link{fill:var(--dd-link)}
.dd .nm{fill:var(--dd-ink);font-family:'IBM Plex Sans',system-ui,sans-serif}
.dd .sb{fill:var(--dd-muted);font-family:'IBM Plex Mono',ui-monospace,monospace}
.dd .lg{fill:var(--dd-muted);font-family:'IBM Plex Sans',system-ui,sans-serif}
.dd .co{fill:var(--dd-ink);font-family:'IBM Plex Serif',Georgia,serif;font-style:italic}
.dd .box{stroke-width:1}
.dd .back{color:var(--dd-ink)}.dd .back .box{fill:var(--dd-node);stroke:var(--dd-ink)}
.dd .store{color:var(--dd-muted)}.dd .store .box{fill:var(--dd-store);stroke:var(--dd-muted)}
.dd .ext{color:var(--dd-soft)}.dd .ext .box{fill:var(--dd-ext);stroke:var(--dd-ext-line)}
.dd .focal{color:var(--dd-accent)}.dd .focal .box{fill:var(--dd-tint);stroke:var(--dd-accent)}
.dd .tag{fill:none;stroke:currentColor;stroke-opacity:.5;stroke-width:.8}
.dd .tt{fill:currentColor;font-family:'IBM Plex Mono',ui-monospace,monospace}
.dd .a{fill:none;stroke-width:1.2}
.dd .a-m{stroke:var(--dd-muted)}.dd .a-acc{stroke:var(--dd-accent);stroke-width:1.4}.dd .a-link{stroke:var(--dd-link)}
.dd .dash{stroke-dasharray:4,3;stroke-width:1}
.dd .mk-m{fill:var(--dd-muted)}.dd .mk-acc{fill:var(--dd-accent)}.dd .mk-link{fill:var(--dd-link)}
.dd .rule{stroke:var(--dd-zone-line);stroke-width:.8}
.dd .leader{fill:none;stroke:var(--dd-leader);stroke-width:1;stroke-dasharray:4,3}
.dd .dot{fill:var(--dd-ink)}
/* dd:end */`;

let s = "";
const add = (x) => (s += x + "\n");

function label(cx, y, w, text, cls = "") {
  // mask rect above/beside a connector, then the label text
  add(`<rect class="mask" x="${cx - w / 2}" y="${y}" width="${w}" height="12" rx="2"/>`);
  add(`<text class="al ${cls}" x="${cx}" y="${y + 9}" font-size="8" text-anchor="middle" letter-spacing="0.06em">${text}</text>`);
}
function zoneLabel(x, y, w, text) {
  add(`<text class="ey" x="${x}" y="${y + 9}" font-size="8" letter-spacing="0.14em">${text}</text>`);
}
function node(cls, x, y, w, h, tag, tagW, name, subs, nameY) {
  const cx = x + w / 2;
  add(`<g class="${cls}">`);
  add(`<rect class="mask" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`);
  add(`<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`);
  add(`<rect class="tag" x="${x + 8}" y="${y + 8}" width="${tagW}" height="12" rx="2"/>`);
  add(`<text class="tt" x="${x + 8 + tagW / 2}" y="${y + 17}" font-size="7" text-anchor="middle" letter-spacing="0.08em">${tag}</text>`);
  add(`<text class="nm" x="${cx}" y="${y + nameY}" font-size="12" font-weight="600" text-anchor="middle">${name}</text>`);
  subs.forEach((t, i) => add(`<text class="sb" x="${cx}" y="${y + nameY + 16 + i * 14}" font-size="9" text-anchor="middle">${t}</text>`));
  add(`</g>`);
}

add(`<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="daybook-architecture-title daybook-architecture-desc">`);
add(`<title id="daybook-architecture-title">Daybook architecture</title>`);
add(`<desc id="daybook-architecture-desc">Architecture diagram of the installed browser app syncing through three endpoints to one Rust container that stores notes in SQLite and images on a volume, replicated to object storage by Litestream.</desc>`);
add(`<defs>
<marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon class="mk-m" points="0 0, 8 3, 0 6"/></marker>
<marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon class="mk-acc" points="0 0, 8 3, 0 6"/></marker>
<marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon class="mk-link" points="0 0, 8 3, 0 6"/></marker>
</defs>`);
add(`<rect class="bg" width="100%" height="100%"/>`);

add(`<!-- Zones (drawn first) -->`);
add(`<rect class="zone" x="40" y="72" width="300" height="440" rx="8"/>`);
zoneLabel(56, 76, 96, "ON YOUR DEVICE");
add(`<rect class="zone" x="520" y="72" width="552" height="440" rx="8"/>`);
zoneLabel(536, 76, 88, "ONE CONTAINER");
add(`<rect class="zone2" x="856" y="136" width="192" height="228" rx="8"/>`);
zoneLabel(872, 140, 84, "VOLUME /DATA");

add(`<!-- Arrows (behind boxes) -->`);
// A: service worker -> web app (dashed)
add(`<line class="a a-m dash" x1="190" y1="168" x2="190" y2="232" marker-end="url(#arrow)"/>`);
// B: web app -> IndexedDB
add(`<line class="a a-m" x1="190" y1="344" x2="190" y2="408" marker-end="url(#arrow)"/>`);
// C1-C3: three endpoints, fanned ports 28px apart
add(`<line class="a a-acc" x1="316" y1="260" x2="560" y2="260" marker-end="url(#arrow-accent)"/>`);
add(`<line class="a a-link" x1="316" y1="288" x2="560" y2="288" marker-end="url(#arrow-link)"/>`);
add(`<line class="a a-link" x1="316" y1="316" x2="560" y2="316" marker-end="url(#arrow-link)"/>`);
// D1: daybook -> files/ (elbow up), D2: daybook -> SQLite (straight)
add(`<path class="a a-m" d="M 768,268 H 816 Q 824,268 824,260 V 208 Q 824,200 832,200 H 880" marker-end="url(#arrow)"/>`);
add(`<line class="a a-m" x1="768" y1="308" x2="880" y2="308" marker-end="url(#arrow)"/>`);
// E: SQLite -> Litestream, F: Litestream -> object storage
add(`<line class="a a-m" x1="952" y1="340" x2="952" y2="424" marker-end="url(#arrow)"/>`);
add(`<line class="a a-link" x1="1024" y1="456" x2="1112" y2="456" marker-end="url(#arrow-link)"/>`);

add(`<!-- Arrow labels -->`);
label(236, 194, 76, "SERVES SHELL");
label(232, 370, 68, "LOCAL WRITE");
label(438, 242, 84, "POST /API/SYNC", "al-acc");
label(438, 270, 64, "/API/LOGIN", "al-link");
label(438, 298, 68, "/FILES/:SHA", "al-link");
label(798, 228, 36, "BLOBS");
label(820, 290, 24, "SQL");
label(992, 376, 64, "WAL STREAM");
label(1068, 438, 60, "REPLICATE", "al-link");

add(`<!-- Nodes -->`);
node("back", 64, 104, 252, 64, "PWA", 28, "Service worker", ["offline app shell"], 36);
node("back", 64, 232, 252, 112, "UI", 28, "Web app", ["React + TipTap"], 60);
node("store", 64, 408, 252, 80, "STORE", 36, "IndexedDB", ["Dexie · pages · outbox · images"], 44);
node("focal", 560, 232, 208, 112, "BIN", 28, "daybook", ["Rust · axum · rust-embed", "serves app + API"], 54);
node("store", 880, 168, 144, 64, "DISK", 32, "files/", ["sha256 blobs"], 36);
node("store", 880, 276, 144, 64, "DB", 24, "SQLite", ["WAL · FTS5"], 36);
node("back", 880, 424, 144, 64, "PROC", 32, "Litestream", ["WAL replication"], 36);
node("ext", 1112, 424, 128, 64, "EXT", 28, "Object storage", ["S3-compatible"], 36);

add(`<!-- Callout -->`);
add(`<text class="co" x="40" y="584" font-size="14">Every edit saves locally first. Sync runs behind it.</text>`);
add(`<path class="leader" d="M 150,568 Q 150,520 190,488"/>`);
add(`<circle class="dot" cx="190" cy="488" r="2"/>`);

add(`<!-- Legend strip -->`);
add(`<line class="rule" x1="40" y1="632" x2="1240" y2="632"/>`);
add(`<text class="ey" x="40" y="650" font-size="8" letter-spacing="0.18em">LEGEND</text>`);
const sw = (cls, x, t) => {
  add(`<g class="${cls}"><rect class="box" x="${x}" y="662" width="14" height="10" rx="2"/></g>`);
  add(`<text class="lg" x="${x + 20}" y="671" font-size="8.5">${t}</text>`);
};
sw("focal", 40, "Focal binary");
sw("back", 190, "Component");
sw("store", 330, "Store");
sw("ext", 420, "External");
const ar = (cls, mk, x, t, dash = "") => {
  add(`<line class="a ${cls} ${dash}" x1="${x}" y1="667" x2="${x + 28}" y2="667" marker-end="url(#${mk})"/>`);
  add(`<text class="lg" x="${x + 36}" y="671" font-size="8.5">${t}</text>`);
};
ar("a-acc", "arrow-accent", 560, "Primary sync");
ar("a-link", "arrow-link", 700, "HTTP request");
ar("a-m", "arrow", 850, "Internal write");
ar("a-m", "arrow", 1000, "Served from cache", "dash");
add(`</svg>`);

const svg = s;
const figure = `<!-- dd:figure:start -->\n<figure class="dd">\n${svg}</figure>\n<!-- dd:figure:end -->`;

const standalone = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daybook Architecture</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:ital,wght@1,400&display=swap" rel="stylesheet">
<style>
:root{--page:#f6f7f9;--page-ink:#1b2430;--page-muted:#5d6b7c}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--page:#0f141b;--page-ink:#e6ebf2;--page-muted:#93a1b3;color-scheme:dark}}
:root[data-theme="dark"]{--page:#0f141b;--page-ink:#e6ebf2;--page-muted:#93a1b3;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--page-ink);font:16px/1.5 'IBM Plex Sans',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:32px 20px 48px;gap:12px}
.eyebrow{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--page-muted);align-self:center;width:min(1320px,calc(100vw - 40px))}
h1{font-size:28px;line-height:1.2;margin:0 0 8px;font-weight:600;align-self:center;width:min(1320px,calc(100vw - 40px));text-wrap:balance}
${css}
</style>
</head>
<body>
<p class="eyebrow">Architecture · Daybook</p>
<h1>One Rust binary, one SQLite file</h1>
${figure}
</body>
</html>
`;
fs.writeFileSync(OUT + "daybook-architecture.html", standalone);

// splice into the plan
let plan = fs.readFileSync(OUT + "build-plan.html", "utf8");
plan = plan.replace(/\n\/\* dd:start[\s\S]*?\/\* dd:end \*\//, "");
plan = plan.replace(/<!-- dd:figure:start -->[\s\S]*?<!-- dd:figure:end -->/, "@@FIG@@");
if (!plan.includes("@@FIG@@")) {
  const a = plan.indexOf("<h2>Architecture</h2>");
  const p0 = plan.indexOf("<pre>", a), p1 = plan.indexOf("</pre>", p0) + 6;
  plan = plan.slice(0, p0) + "@@FIG@@" + plan.slice(p1);
}
plan = plan.replace("@@FIG@@", () => figure);
plan = plan.replace(":focus-visible{outline:2px solid var(--accent);outline-offset:2px}", () => css + "\n:focus-visible{outline:2px solid var(--accent);outline-offset:2px}");
plan = plan.replace("family=IBM+Plex+Mono:wght@400;500&display=swap", "family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:ital,wght@1,400&display=swap");
fs.writeFileSync(OUT + "build-plan.html", plan);
console.log("ok", standalone.length, plan.length);

// Standalone SVG for the README: the same drawing with the skin inlined (light by default, dark by media query)
const light = /\.dd\{(--dd-paper[^}]*)\}/.exec(css)[1];
const dark = /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\) \.dd\{([^}]*)\}\}/.exec(css)[1];
const rules = css.split("\n").filter((l) => l.startsWith(".dd .")).join("\n");
const svgFile = svg
  .replace("<svg ", '<svg class="dd" ')
  .replace("<defs>", `<style>\n.dd{${light}}\n@media (prefers-color-scheme:dark){.dd{${dark}}}\n${rules}\n</style>\n<defs>`);
fs.writeFileSync(OUT + "architecture.svg", svgFile);
console.log("svg", svgFile.length);
