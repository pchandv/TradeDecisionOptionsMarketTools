const fs = require("node:fs/promises");
const path = require("node:path");
const { round } = require("../utils/formatters");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const LOG_PATH = path.join(DATA_DIR, "decision-learning-log.json");
const BUCKET_MS = 5 * 60 * 1000;
const HORIZON_MS = 20 * 60 * 1000;
const MAX_ENTRIES = 600;

let writeQueue = Promise.resolve();

function createEmptySummary() {
    return {
        trackedPredictions: 0,
        resolvedPredictions: 0,
        accuracyPercent: null,
        wins: 0,
        losses: 0,
        strongestSignals: []
    };
}

function createEmptyLog() {
    return {
        version: 1,
        updatedAt: null,
        entries: []
    };
}

async function readLogFile() {
    try {
        const raw = await fs.readFile(LOG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return {
            version: 1,
            updatedAt: parsed?.updatedAt || null,
            entries: Array.isArray(parsed?.entries) ? parsed.entries : []
        };
    } catch (error) {
        return createEmptyLog();
    }
}

async function writeLogFile(payload) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(LOG_PATH, JSON.stringify(payload, null, 2));
}

function normalizeBucket(timestamp) {
    const time = new Date(timestamp || Date.now()).getTime();
    return Math.floor(time / BUCKET_MS) * BUCKET_MS;
}

function normalizeComponents(components = []) {
    return components
        .filter((component) => component && component.key)
        .map((component) => ({
            key: component.key,
            label: component.label || component.key,
            signal: Number(component.signal) || 0,
            score: Number(component.score) || 0
        }));
}

function resolveEntry(entry, currentPrice, resolvedAt) {
    if (entry?.resolvedAt || !Number.isFinite(currentPrice) || !Number.isFinite(entry?.referencePrice)) {
        return entry;
    }

    const movePercent = entry.referencePrice
        ? round(((currentPrice - entry.referencePrice) / entry.referencePrice) * 100, 2)
        : null;
    let outcome = "UNRESOLVED";

    if (entry.action === "CE") {
        outcome = currentPrice > entry.referencePrice ? "WIN" : "LOSS";
    } else if (entry.action === "PE") {
        outcome = currentPrice < entry.referencePrice ? "WIN" : "LOSS";
    } else if (entry.action === "WAIT") {
        outcome = Math.abs(movePercent || 0) <= 0.35 ? "WIN" : "LOSS";
    }

    return {
        ...entry,
        resolvedAt,
        actualPrice: currentPrice,
        actualMovePercent: movePercent,
        outcome
    };
}

function updateResolvedEntries(entries, instrument, currentPrice, nowIso) {
    const now = new Date(nowIso).getTime();
    return entries.map((entry) => {
        if (entry.instrument !== instrument || entry.resolvedAt) {
            return entry;
        }
        if ((entry.expiresAt || 0) > now) {
            return entry;
        }
        return resolveEntry(entry, currentPrice, nowIso);
    });
}

function buildEntryId(engineVersion, instrument, bucketStart) {
    return `${engineVersion}:${instrument}:${bucketStart}`;
}

function buildTrackedSignals(entries = []) {
    const signalMap = new Map();

    entries.forEach((entry) => {
        if (entry.outcome !== "WIN" && entry.outcome !== "LOSS") {
            return;
        }

        (entry.components || []).forEach((component) => {
            if (Math.abs(component.score) < 4) {
                return;
            }

            const record = signalMap.get(component.key) || {
                key: component.key,
                label: component.label || component.key,
                wins: 0,
                count: 0,
                averageContribution: 0
            };

            record.count += 1;
            if (entry.outcome === "WIN") {
                record.wins += 1;
            }
            record.averageContribution += Math.abs(component.score);
            signalMap.set(component.key, record);
        });
    });

    return [...signalMap.values()]
        .map((item) => ({
            key: item.key,
            label: item.label,
            hitRate: item.count ? round((item.wins / item.count) * 100, 0) : 0,
            averageContribution: item.count ? round(item.averageContribution / item.count, 2) : 0
        }))
        .sort((left, right) => {
            if (right.hitRate !== left.hitRate) {
                return right.hitRate - left.hitRate;
            }
            return right.averageContribution - left.averageContribution;
        })
        .slice(0, 3);
}

function buildLearningSummary(entries, engineVersion, instrument) {
    const relevantEntries = entries
        .filter((entry) => entry.engineVersion === engineVersion && entry.instrument === instrument)
        .slice(-80);
    const resolvedEntries = relevantEntries.filter((entry) => entry.outcome === "WIN" || entry.outcome === "LOSS");
    const wins = resolvedEntries.filter((entry) => entry.outcome === "WIN").length;
    const losses = resolvedEntries.filter((entry) => entry.outcome === "LOSS").length;
    const accuracy = resolvedEntries.length ? round((wins / resolvedEntries.length) * 100, 0) : null;

    return {
        trackedPredictions: relevantEntries.length,
        resolvedPredictions: resolvedEntries.length,
        accuracyPercent: accuracy,
        wins,
        losses,
        strongestSignals: buildTrackedSignals(resolvedEntries)
    };
}

async function recordLearningSnapshot({ decision, traderProfile, currentPrice, generatedAt }) {
    if (!decision || !traderProfile?.preferredInstrument || !Number.isFinite(currentPrice)) {
        return createEmptySummary();
    }

    const engineVersion = traderProfile.engineVersion;
    const instrument = traderProfile.preferredInstrument;

    writeQueue = writeQueue
        .catch(() => createEmptySummary())
        .then(async () => {
        const log = await readLogFile();
        const updatedEntries = updateResolvedEntries(log.entries, instrument, currentPrice, generatedAt);
        const bucketStart = normalizeBucket(generatedAt);
        const entryId = buildEntryId(engineVersion, instrument, bucketStart);
        const entryIndex = updatedEntries.findIndex((entry) => entry.id === entryId);
        const nextEntry = {
            id: entryId,
            engineVersion,
            instrument,
            createdAt: generatedAt,
            expiresAt: bucketStart + HORIZON_MS,
            action: decision.action || "WAIT",
            bias: decision.bias || "NEUTRAL",
            score: Number(decision.score) || 0,
            confidence: Number(decision.confidence) || 0,
            referencePrice: currentPrice,
            outcome: null,
            components: normalizeComponents(decision.components)
        };

        if (entryIndex >= 0) {
            updatedEntries[entryIndex] = {
                ...updatedEntries[entryIndex],
                ...nextEntry
            };
        } else {
            updatedEntries.push(nextEntry);
        }

        const trimmedEntries = updatedEntries.slice(-MAX_ENTRIES);
        const nextLog = {
            version: 1,
            updatedAt: generatedAt,
            entries: trimmedEntries
        };

        await writeLogFile(nextLog);
        return buildLearningSummary(trimmedEntries, engineVersion, instrument);
    })
        .catch(() => createEmptySummary());

    return writeQueue;
}

module.exports = {
    recordLearningSnapshot
};
