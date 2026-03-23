(function (global) {
    "use strict";

    const STORAGE_VERSION = 1;
    const ALARM_NAME = "options-trading-assistant-monitor";
    const MAX_TEXT_SCAN_LENGTH = 150000;

    const ACTIONS = {
        PING: "OTA_PING",
        EXTRACT_PAGE_SNAPSHOT: "OTA_EXTRACT_PAGE_SNAPSHOT",
        SCAN_TAB: "OTA_SCAN_TAB",
        SCAN_ALL_MONITORED_TABS: "OTA_SCAN_ALL_MONITORED_TABS",
        START_MONITOR_TAB: "OTA_START_MONITOR_TAB",
        STOP_MONITOR_TAB: "OTA_STOP_MONITOR_TAB",
        TOGGLE_MONITOR_TAB: "OTA_TOGGLE_MONITOR_TAB",
        CLEAR_HISTORY: "OTA_CLEAR_HISTORY",
        SETTINGS_UPDATED: "OTA_SETTINGS_UPDATED"
    };

    const DEFAULT_SETTINGS = {
        bullishPcrThreshold: 1.15,
        bearishPcrThreshold: 0.85,
        highVixThreshold: 18,
        elevatedVixThreshold: 15,
        confidenceThreshold: 60,
        monitoringIntervalSeconds: 60,
        sustainedConditionMinutes: 2,
        notificationsEnabled: true,
        soundEnabled: false,
        enabledSiteAdapters: ["tradingview", "zerodha-kite", "custom-page", "generic"],
        retentionHistoryLimit: 120,
        alertCooldownMinutes: 10,
        supportResistanceBufferPercent: 0.4,
        highIvThreshold: 25,
        extremeIvThreshold: 35,
        maxPainBiasPercent: 0.35,
        oiBullishRatio: 1.15,
        oiBearishRatio: 0.87,
        minimumDataPoints: 2
    };

    function createEmptyValues() {
        return {
            spotPrice: null,
            changePercent: null,
            pcr: null,
            vix: null,
            atmIv: null,
            maxPain: null,
            support: null,
            resistance: null,
            callOi: null,
            putOi: null
        };
    }

    function createEmptySnapshot(partial) {
        const payload = partial || {};
        return {
            tabId: payload.tabId || null,
            url: payload.url || "",
            siteType: payload.siteType || "generic",
            timestamp: payload.timestamp || new Date().toISOString(),
            instrument: payload.instrument || "UNKNOWN",
            pageTitle: payload.pageTitle || "",
            values: Object.assign(createEmptyValues(), payload.values || {}),
            rawSignals: Array.isArray(payload.rawSignals) ? payload.rawSignals.slice(0, 10) : [],
            extractorMeta: Object.assign({
                method: "unknown",
                confidence: 0,
                warnings: []
            }, payload.extractorMeta || {})
        };
    }

    function createEmptyOverallSignal() {
        return {
            signal: "WAIT",
            confidence: 0,
            score: 0,
            reasoning: ["No monitored data has been evaluated yet."],
            riskFlags: ["Data is not available yet."],
            recommendedStance: "Wait for visible market data before acting.",
            updatedAt: null,
            tabCount: 0
        };
    }

    function createInitialState() {
        return {
            version: STORAGE_VERSION,
            settings: Object.assign({}, DEFAULT_SETTINGS),
            monitoredTabs: {},
            latestSnapshots: {},
            latestEvaluations: {},
            overallSignal: createEmptyOverallSignal(),
            signalHistory: [],
            alertHistory: [],
            lastAlertMap: {}
        };
    }

    function normalizeStoredState(rawState) {
        const state = rawState || {};
        const settings = mergeSettings(state.settings || {});
        return {
            version: STORAGE_VERSION,
            settings,
            monitoredTabs: normalizeMonitoredTabs(state.monitoredTabs),
            latestSnapshots: normalizeSnapshotMap(state.latestSnapshots),
            latestEvaluations: normalizeRecord(state.latestEvaluations),
            overallSignal: normalizeOverallSignal(state.overallSignal),
            signalHistory: Array.isArray(state.signalHistory) ? limitArray(state.signalHistory, settings.retentionHistoryLimit) : [],
            alertHistory: Array.isArray(state.alertHistory) ? limitArray(state.alertHistory, settings.retentionHistoryLimit) : [],
            lastAlertMap: normalizeRecord(state.lastAlertMap)
        };
    }

    function normalizeOverallSignal(signal) {
        return Object.assign(createEmptyOverallSignal(), signal || {});
    }

    function normalizeMonitoredTabs(record) {
        const normalized = {};
        Object.keys(record || {}).forEach((key) => {
            const source = record[key];
            if (!source || !source.tabId) {
                return;
            }
            normalized[source.tabId] = Object.assign({
                tabId: source.tabId,
                url: source.url || "",
                title: source.title || "Untitled tab",
                siteType: source.siteType || "generic",
                addedAt: source.addedAt || new Date().toISOString(),
                lastScanAt: source.lastScanAt || null,
                lastError: source.lastError || "",
                monitored: source.monitored !== false
            }, source);
        });
        return normalized;
    }

    function normalizeSnapshotMap(record) {
        const normalized = {};
        Object.keys(record || {}).forEach((key) => {
            normalized[key] = createEmptySnapshot(record[key]);
        });
        return normalized;
    }

    function normalizeRecord(record) {
        return record && typeof record === "object" ? Object.assign({}, record) : {};
    }

    function mergeSettings(overrides) {
        const merged = Object.assign({}, DEFAULT_SETTINGS, overrides || {});
        merged.monitoringIntervalSeconds = clamp(toNumber(merged.monitoringIntervalSeconds) || DEFAULT_SETTINGS.monitoringIntervalSeconds, 30, 3600);
        merged.sustainedConditionMinutes = clamp(toNumber(merged.sustainedConditionMinutes) || DEFAULT_SETTINGS.sustainedConditionMinutes, 1, 60);
        merged.retentionHistoryLimit = clamp(toNumber(merged.retentionHistoryLimit) || DEFAULT_SETTINGS.retentionHistoryLimit, 20, 500);
        merged.alertCooldownMinutes = clamp(toNumber(merged.alertCooldownMinutes) || DEFAULT_SETTINGS.alertCooldownMinutes, 1, 180);
        merged.enabledSiteAdapters = Array.isArray(merged.enabledSiteAdapters) && merged.enabledSiteAdapters.length
            ? merged.enabledSiteAdapters
            : DEFAULT_SETTINGS.enabledSiteAdapters.slice();
        return merged;
    }

    function limitArray(items, limit) {
        const safeLimit = Math.max(1, toNumber(limit) || DEFAULT_SETTINGS.retentionHistoryLimit);
        return items.slice(-safeLimit);
    }

    function appendLimitedHistory(history, item, limit) {
        const next = Array.isArray(history) ? history.slice() : [];
        next.push(item);
        return limitArray(next, limit);
    }

    function toNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function round(value, digits) {
        if (!Number.isFinite(value)) {
            return null;
        }
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    function createId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    function dedupeStrings(items) {
        return Array.from(new Set((items || []).filter(Boolean)));
    }

    function isAccessibleUrl(url) {
        return typeof url === "string"
            && url.startsWith("http")
            && !url.startsWith("https://chrome.google.com/webstore");
    }

    function inferSiteTypeFromUrl(url) {
        if (!url) {
            return "generic";
        }
        if (url.includes("tradingview.com")) {
            return "tradingview";
        }
        if (url.includes("kite.zerodha.com")) {
            return "zerodha-kite";
        }
        if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("github.io")) {
            return "custom-page";
        }
        return "generic";
    }

    function formatDateTime(value) {
        if (!value) {
            return "Never";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        return new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function formatRelativeTime(value) {
        if (!value) {
            return "Never";
        }
        const date = new Date(value);
        const deltaMs = Date.now() - date.getTime();
        if (!Number.isFinite(deltaMs)) {
            return "Unknown";
        }
        const seconds = Math.floor(deltaMs / 1000);
        if (seconds < 60) {
            return `${seconds}s ago`;
        }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes}m ago`;
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours}h ago`;
        }
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    function formatNumber(value, digits) {
        if (!Number.isFinite(value)) {
            return "--";
        }
        return new Intl.NumberFormat("en-IN", {
            maximumFractionDigits: digits == null ? 2 : digits
        }).format(value);
    }

    function formatSignedNumber(value, digits) {
        if (!Number.isFinite(value)) {
            return "--";
        }
        const rounded = round(value, digits == null ? 2 : digits);
        return `${rounded > 0 ? "+" : ""}${rounded}`;
    }

    function parseNumberFromText(text) {
        if (!text) {
            return null;
        }

        const cleaned = String(text)
            .replace(/,/g, "")
            .replace(/₹/g, "")
            .replace(/Rs\.?/gi, "")
            .replace(/\u20B9/g, "")
            .trim();

        const match = cleaned.match(/(-?\d+(?:\.\d+)?)(?:\s*(K|M|B|L|CR))?/i);
        if (!match) {
            return null;
        }

        let value = Number(match[1]);
        if (!Number.isFinite(value)) {
            return null;
        }

        const suffix = (match[2] || "").toUpperCase();
        if (suffix === "K") {
            value *= 1000;
        } else if (suffix === "M") {
            value *= 1000000;
        } else if (suffix === "B") {
            value *= 1000000000;
        } else if (suffix === "L") {
            value *= 100000;
        } else if (suffix === "CR") {
            value *= 10000000;
        }

        return value;
    }

    function extractFirstMatch(text, patterns, mapper) {
        const body = String(text || "");
        for (let index = 0; index < patterns.length; index += 1) {
            const pattern = patterns[index];
            const match = body.match(pattern);
            if (match) {
                return mapper ? mapper(match) : match[1];
            }
        }
        return null;
    }

    function getVisibleText(documentRef) {
        const doc = documentRef || (typeof document !== "undefined" ? document : null);
        if (!doc || !doc.body) {
            return "";
        }
        return String(doc.body.innerText || "").slice(0, MAX_TEXT_SCAN_LENGTH);
    }

    function storageGet(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(result);
            });
        });
    }

    function storageSet(payload) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(payload, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    function storageRemove(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    async function loadState() {
        const state = await storageGet(null);
        return normalizeStoredState(state);
    }

    async function saveState(state) {
        const normalized = normalizeStoredState(state);
        await storageSet(normalized);
        return normalized;
    }

    function tabsQuery(query) {
        return new Promise((resolve, reject) => {
            chrome.tabs.query(query, (tabs) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(tabs || []);
            });
        });
    }

    function tabsGet(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(tab);
            });
        });
    }

    function tabsSendMessage(tabId, message) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    function executeScript(tabId, files) {
        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: files
        });
    }

    function createNotification(id, options) {
        return new Promise((resolve, reject) => {
            chrome.notifications.create(id, options, (createdId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(createdId);
            });
        });
    }

    function createOrUpdateAlarm(periodSeconds) {
        const minutes = Math.max((periodSeconds || DEFAULT_SETTINGS.monitoringIntervalSeconds) / 60, 0.5);
        chrome.alarms.create(ALARM_NAME, {
            periodInMinutes: minutes
        });
    }

    function clearAlarm() {
        return new Promise((resolve) => {
            chrome.alarms.clear(ALARM_NAME, resolve);
        });
    }

    function downloadJson(filename, payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function pickSummaryReasoning(reasons, limit) {
        return dedupeStrings(reasons).slice(0, limit || 4);
    }

    function countPresentValues(values) {
        return Object.values(values || {}).filter((value) => Number.isFinite(value)).length;
    }

    global.OptionsAssistantUtils = {
        ACTIONS,
        ALARM_NAME,
        DEFAULT_SETTINGS,
        MAX_TEXT_SCAN_LENGTH,
        STORAGE_VERSION,
        appendLimitedHistory,
        clamp,
        clearAlarm,
        countPresentValues,
        createEmptyOverallSignal,
        createEmptySnapshot,
        createEmptyValues,
        createId,
        createInitialState,
        createNotification,
        createOrUpdateAlarm,
        dedupeStrings,
        downloadJson,
        executeScript,
        extractFirstMatch,
        formatDateTime,
        formatNumber,
        formatRelativeTime,
        formatSignedNumber,
        getVisibleText,
        inferSiteTypeFromUrl,
        isAccessibleUrl,
        limitArray,
        loadState,
        mergeSettings,
        normalizeStoredState,
        parseNumberFromText,
        pickSummaryReasoning,
        round,
        saveState,
        storageGet,
        storageRemove,
        storageSet,
        tabsGet,
        tabsQuery,
        tabsSendMessage,
        toNumber
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
