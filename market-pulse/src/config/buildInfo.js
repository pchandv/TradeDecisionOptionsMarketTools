const fs = require("fs");
const path = require("path");

const packageJson = require("../../package.json");

const buildInfoPath = path.join(__dirname, "build-info.json");

function normalizeBuildNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

function createFallbackBuildInfo() {
    const baseVersion = packageJson.version || "1.0.0";
    const buildNumber = 0;

    return {
        baseVersion,
        buildNumber,
        version: `${baseVersion}-b${buildNumber}`,
        builtAt: null,
        source: "fallback"
    };
}

function normalizeBuildInfo(rawBuildInfo = {}) {
    const fallback = createFallbackBuildInfo();
    const baseVersion = String(rawBuildInfo.baseVersion || fallback.baseVersion);
    const buildNumber = normalizeBuildNumber(rawBuildInfo.buildNumber, fallback.buildNumber);

    return {
        baseVersion,
        buildNumber,
        version: String(rawBuildInfo.version || `${baseVersion}-b${buildNumber}`),
        builtAt: rawBuildInfo.builtAt || fallback.builtAt,
        source: String(rawBuildInfo.source || fallback.source)
    };
}

function getBuildInfo() {
    try {
        const raw = fs.readFileSync(buildInfoPath, "utf8");
        return normalizeBuildInfo(JSON.parse(raw));
    } catch (error) {
        return createFallbackBuildInfo();
    }
}

module.exports = {
    getBuildInfo
};
