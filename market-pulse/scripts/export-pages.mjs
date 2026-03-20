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
    ["decision-engine.css", "decision-engine.css"],
    ["investing.js", "investing.js"],
    ["browser-standalone-loader.js", "browser-standalone-loader.js"],
    ["pwa.js", "pwa.js"],
    ["styles.css", "styles.css"],
    ["manifest.webmanifest", "manifest.webmanifest"],
    ["sw.js", "sw.js"],
    ["icon.svg", "icon.svg"]
];

function copyRecursive(sourcePath, targetPath) {
    const stats = fs.statSync(sourcePath);

    if (stats.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        for (const entry of fs.readdirSync(sourcePath)) {
            copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
        }
        return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
}

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

copyRecursive(path.join(publicDir, "decision-ui"), path.join(docsDir, "decision-ui"));

const investingPayload = await buildInvestingPayload();
const staticSnapshotPayload = buildStaticSnapshotPayload(investingPayload);
fs.writeFileSync(
    path.join(docsDir, "investing-data.json"),
    JSON.stringify(staticSnapshotPayload, null, 2)
);

fs.writeFileSync(path.join(docsDir, ".nojekyll"), "");

console.log(`GitHub Pages bundle exported to ${docsDir}`);
