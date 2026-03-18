import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const docsDir = path.join(projectRoot, "docs");

const filesToCopy = [
    ["browser-standalone.html", "index.html"],
    ["app.js", "app.js"],
    ["browser-standalone-loader.js", "browser-standalone-loader.js"],
    ["styles.css", "styles.css"],
    ["icon.svg", "icon.svg"]
];

fs.mkdirSync(docsDir, { recursive: true });

for (const [sourceName, targetName] of filesToCopy) {
    const sourcePath = path.join(publicDir, sourceName);
    const targetPath = path.join(docsDir, targetName);
    fs.copyFileSync(sourcePath, targetPath);
}

fs.writeFileSync(path.join(docsDir, ".nojekyll"), "");

console.log(`GitHub Pages bundle exported to ${docsDir}`);
