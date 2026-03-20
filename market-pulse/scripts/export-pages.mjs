import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const docsDir = path.join(projectRoot, "docs");
const { buildInvestingPayload } = require("../src/services/investingService");

const filesToCopy = [
    ["browser-standalone.html", "index.html"],
    ["browser-investing.html", "investing.html"],
    ["app.js", "app.js"],
    ["build-info.json", "build-info.json"],
    ["investing.js", "investing.js"],
    ["browser-standalone-loader.js", "browser-standalone-loader.js"],
    ["pwa.js", "pwa.js"],
    ["styles.css", "styles.css"],
    ["manifest.webmanifest", "manifest.webmanifest"],
    ["sw.js", "sw.js"],
    ["icon.svg", "icon.svg"]
];

function buildStaticSnapshotPayload(payload) {
    return {
        ...payload,
        metadata: {
            ...(payload?.metadata || {}),
            mode: "published-snapshot",
            publishedTo: "github-pages",
            snapshotPath: "./investing-data.json"
        }
    };
}

fs.mkdirSync(docsDir, { recursive: true });

for (const [sourceName, targetName] of filesToCopy) {
    const sourcePath = path.join(publicDir, sourceName);
    const targetPath = path.join(docsDir, targetName);
    fs.copyFileSync(sourcePath, targetPath);
}

const investingPayload = await buildInvestingPayload();
const staticSnapshotPayload = buildStaticSnapshotPayload(investingPayload);
fs.writeFileSync(
    path.join(docsDir, "investing-data.json"),
    JSON.stringify(staticSnapshotPayload, null, 2)
);

fs.writeFileSync(path.join(docsDir, ".nojekyll"), "");

console.log(`GitHub Pages bundle exported to ${docsDir}`);
