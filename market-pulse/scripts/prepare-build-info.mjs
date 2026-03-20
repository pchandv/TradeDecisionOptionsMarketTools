import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const srcBuildInfoPath = path.join(projectRoot, "src", "config", "build-info.json");
const publicBuildInfoPath = path.join(projectRoot, "public", "build-info.json");

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        return fallback;
    }
}

function normalizeBuildNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

const packageJson = readJson(packageJsonPath, { version: "1.0.0" });
const previousBuildInfo = readJson(srcBuildInfoPath, {
    baseVersion: packageJson.version,
    buildNumber: 0
});

const ciBuildNumber = normalizeBuildNumber(
    process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER,
    null
);

const buildNumber = ciBuildNumber !== null
    ? ciBuildNumber
    : normalizeBuildNumber(previousBuildInfo.buildNumber, 0) + 1;
const buildSource = ciBuildNumber !== null
    ? (process.env.GITHUB_RUN_NUMBER ? "github-actions" : "ci")
    : "local";
const buildInfo = {
    baseVersion: packageJson.version,
    buildNumber,
    version: `${packageJson.version}-b${buildNumber}`,
    builtAt: new Date().toISOString(),
    source: buildSource
};

fs.mkdirSync(path.dirname(srcBuildInfoPath), { recursive: true });
fs.mkdirSync(path.dirname(publicBuildInfoPath), { recursive: true });
fs.writeFileSync(srcBuildInfoPath, JSON.stringify(buildInfo, null, 2));
fs.writeFileSync(publicBuildInfoPath, JSON.stringify(buildInfo, null, 2));

console.log(`Prepared build info ${buildInfo.version} (${buildInfo.source})`);
