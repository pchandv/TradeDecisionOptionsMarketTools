import { STORAGE_KEYS } from "./state.js";
import { readStorageJson, writeStorageJson } from "./storage.js";

const MAX_DECISION_HISTORY = 24;

function getHistoryBucketKey(settings = {}) {
    return `${settings.instrument || "NIFTY"}:${settings.engineVersion || "adaptive-v2"}:${settings.compareMode ? "compare" : "single"}`;
}

function readHistoryMap() {
    return readStorageJson(STORAGE_KEYS.decisionHistory, {}) || {};
}

function writeHistoryMap(historyMap) {
    writeStorageJson(STORAGE_KEYS.decisionHistory, historyMap);
}

export function readDecisionHistory(settings = {}) {
    const historyMap = readHistoryMap();
    const key = getHistoryBucketKey(settings);
    return Array.isArray(historyMap[key]) ? historyMap[key] : [];
}

export function appendDecisionHistory(settings = {}, payload) {
    const decision = payload?.dashboard?.decision;
    if (!decision) {
        return readDecisionHistory(settings);
    }

    const historyMap = readHistoryMap();
    const key = getHistoryBucketKey(settings);
    const history = Array.isArray(historyMap[key]) ? historyMap[key] : [];
    const nextEntry = {
        generatedAt: payload?.generatedAt || new Date().toISOString(),
        score: Number(decision.score) || 0,
        confidence: Number(decision.confidence) || 0,
        action: decision.stability?.rawAction || decision.action || "WAIT",
        bias: decision.bias || "NEUTRAL",
        status: decision.stability?.rawStatus || decision.status || "WAIT"
    };
    const nextHistory = [...history, nextEntry].slice(-MAX_DECISION_HISTORY);
    historyMap[key] = nextHistory;
    writeHistoryMap(historyMap);
    return nextHistory;
}

export function buildDecisionTrend(history = []) {
    const recent = Array.isArray(history) ? history.slice(-10) : [];
    const current = recent[recent.length - 1] || null;
    const previous = recent[recent.length - 2] || null;
    const scoreDelta = current && previous ? current.score - previous.score : null;
    const confidenceDelta = current && previous ? current.confidence - previous.confidence : null;

    let confidenceDirection = "FLAT";
    if (Number.isFinite(confidenceDelta)) {
        confidenceDirection = confidenceDelta >= 4 ? "RISING" : confidenceDelta <= -4 ? "FALLING" : "FLAT";
    }

    let scoreDirection = "FLAT";
    if (Number.isFinite(scoreDelta)) {
        scoreDirection = scoreDelta >= 6 ? "RISING" : scoreDelta <= -6 ? "FALLING" : "FLAT";
    }

    return {
        series: recent,
        current,
        previous,
        scoreDelta,
        confidenceDelta,
        confidenceDirection,
        scoreDirection
    };
}
