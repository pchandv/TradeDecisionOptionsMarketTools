(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const SOURCE_TYPES = {
        CHART: "chart-source",
        OPTION_CHAIN: "option-chain-source",
        CUSTOM_SIGNAL: "custom-signal-source",
        GLOBAL_CUES: "global-cues-source",
        NEWS: "news-source",
        UNKNOWN: "unknown-source"
    };

    const HISTORY_STORAGE_PREFIX = "liveSnapshotHistory_";
    const DEFAULT_HISTORY_LIMIT = 200;

    function detectSourceType(url, documentText, pageTitle) {
        const haystack = `${String(url || "")} ${String(pageTitle || "")} ${String(documentText || "")}`.toLowerCase();

        if (isOptionChainSource(haystack)) {
            return SOURCE_TYPES.OPTION_CHAIN;
        }
        if (isCustomSignalSource(haystack)) {
            return SOURCE_TYPES.CUSTOM_SIGNAL;
        }
        if (isGlobalCueSource(haystack)) {
            return SOURCE_TYPES.GLOBAL_CUES;
        }
        if (isNewsSource(haystack)) {
            return SOURCE_TYPES.NEWS;
        }
        if (isChartSource(haystack)) {
            return SOURCE_TYPES.CHART;
        }
        return SOURCE_TYPES.UNKNOWN;
    }

    function buildLiveSnapshot(args) {
        const payload = args || {};
        const sourceType = payload.sourceType || detectSourceType(payload.url, payload.documentText, payload.title);
        const values = Object.assign(Utils.createEmptyValues(), payload.values || {});
        const optionChain = Utils.normalizeOptionChain(payload.optionChain);

        return {
            tabId: payload.tabId || null,
            sourceType: sourceType,
            siteType: sourceType,
            url: payload.url || "",
            title: payload.title || "",
            pageTitle: payload.title || "",
            timestamp: payload.timestamp || new Date().toISOString(),
            instrument: payload.instrument || "UNKNOWN",
            values: values,
            optionChain: optionChain.strikes.length ? optionChain : null,
            rawSignals: Array.isArray(payload.rawSignals) ? payload.rawSignals.slice(0, 20) : [],
            headlines: Array.isArray(payload.headlines) ? payload.headlines.slice(0, 20) : [],
            extractionMeta: Object.assign({
                method: "generic-scan",
                confidence: 0,
                warnings: []
            }, payload.extractionMeta || {}),
            extractorMeta: Object.assign({
                method: "generic-scan",
                confidence: 0,
                warnings: []
            }, payload.extractionMeta || payload.extractorMeta || {}),
            extractedOptionPremiums: Utils.normalizeExtractedOptionPremiums(payload.extractedOptionPremiums)
        };
    }

    function mergeSnapshots(snapshots, selectedInstrument) {
        const source = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
        const filtered = selectedInstrument
            ? source.filter((snapshot) => snapshotMatchesInstrument(snapshot, selectedInstrument))
            : source;

        const values = Utils.createEmptyValues();
        Object.keys(values).forEach((field) => {
            values[field] = Utils.averageNumbers(filtered.map((snapshot) => snapshot.values && snapshot.values[field]));
        });

        const optionChains = filtered
            .map((snapshot) => Utils.normalizeOptionChain(snapshot.optionChain))
            .filter((chain) => chain.strikes.length);
        const optionChain = optionChains.sort((left, right) => right.strikes.length - left.strikes.length)[0] || Utils.createEmptyOptionChain();

        const sourceTypeCounts = {};
        filtered.forEach((snapshot) => {
            const key = String(snapshot.sourceType || SOURCE_TYPES.UNKNOWN);
            sourceTypeCounts[key] = (sourceTypeCounts[key] || 0) + 1;
        });

        return {
            sourceType: pickMaxCountKey(sourceTypeCounts) || SOURCE_TYPES.UNKNOWN,
            values: values,
            optionChain: optionChain,
            tabCount: filtered.length
        };
    }

    function updateSnapshotHistoryMap(snapshotsByTab, tabId, snapshot, settings) {
        const key = String(tabId);
        const next = Array.isArray(snapshotsByTab && snapshotsByTab[key]) ? snapshotsByTab[key].slice() : [];
        next.push(buildLiveSnapshot(snapshot));

        const maxItems = Math.max(20, Utils.toNumber(settings && settings.maxSnapshotsPerTab) || DEFAULT_HISTORY_LIMIT);
        const retentionDays = Math.max(1, Utils.toNumber(settings && settings.historyRetentionDays) || Utils.DEFAULT_SETTINGS.historyRetentionDays);

        const pruned = Utils.pruneHistoryByDays(next, retentionDays).slice(-maxItems);
        snapshotsByTab[key] = pruned;
        return pruned;
    }

    function getSnapshotHistoryMap(snapshotsByTab, tabId) {
        const key = String(tabId);
        return Array.isArray(snapshotsByTab && snapshotsByTab[key]) ? snapshotsByTab[key].slice() : [];
    }

    async function updateSnapshotHistory(tabId, snapshot, settings) {
        if (tabId == null) {
            return [];
        }
        const key = `${HISTORY_STORAGE_PREFIX}${tabId}`;
        const stored = await storageGet(key);
        const current = Array.isArray(stored[key]) ? stored[key] : [];
        const next = current.concat([buildLiveSnapshot(snapshot)]);
        const maxItems = Math.max(20, Utils.toNumber(settings && settings.maxSnapshotsPerTab) || DEFAULT_HISTORY_LIMIT);
        const retentionDays = Math.max(1, Utils.toNumber(settings && settings.historyRetentionDays) || Utils.DEFAULT_SETTINGS.historyRetentionDays);
        const pruned = Utils.pruneHistoryByDays(next, retentionDays).slice(-maxItems);
        await storageSet({ [key]: pruned });
        return pruned;
    }

    async function getSnapshotHistory(tabId) {
        if (tabId == null) {
            return [];
        }
        const key = `${HISTORY_STORAGE_PREFIX}${tabId}`;
        const stored = await storageGet(key);
        return Array.isArray(stored[key]) ? stored[key] : [];
    }

    async function clearSnapshotHistory(tabId) {
        if (tabId == null) {
            return;
        }
        const key = `${HISTORY_STORAGE_PREFIX}${tabId}`;
        await storageRemove(key);
    }

    function snapshotMatchesInstrument(snapshot, selectedInstrument) {
        if (!snapshot) {
            return false;
        }

        const instrument = Utils.normalizeInstrumentSelection(selectedInstrument);
        const snapshotInstrument = snapshot.instrument
            ? Utils.normalizeInstrumentSelection(snapshot.instrument)
            : "UNKNOWN";
        if (snapshotInstrument === instrument) {
            return true;
        }

        const title = `${snapshot.title || ""} ${snapshot.url || ""}`.toUpperCase();
        return title.includes(instrument);
    }

    function isOptionChainSource(text) {
        return /\boption\s*chain\b|\bmax\s*pain\b|\bpcr\b|\bput\s*call\b|\bcall\s*oi\b|\bput\s*oi\b/.test(text)
            || /\bce\b.*\bpe\b.*\bstrike\b/.test(text);
    }

    function isChartSource(text) {
        return /\btradingview\b|\bkite\b|\bchart\b|\bohlc\b|\bcandles?\b|\bvwap\b|\btimeframe\b|\b5m\b|\b15m\b|\b1h\b/.test(text);
    }

    function isCustomSignalSource(text) {
        return /\bdata-ota-field\b|\bfinal action\b|\btrade readiness\b|\bmarket bias\b|\bconfidence\b|\bif\/else\b/.test(text);
    }

    function isGlobalCueSource(text) {
        return /\bgift\s*nifty\b|\bcrude\b|\bdxy\b|\bdollar\s*index\b|\b10y\b|\bus\s*yield\b|\bdow\b|\bnasdaq\b/.test(text);
    }

    function isNewsSource(text) {
        return /\bnews\b|\bheadline\b|\brss\b|\breport\b|\bmarket mood\b|\beconomic times\b|\bmoneycontrol\b/.test(text);
    }

    function pickMaxCountKey(counts) {
        let bestKey = "";
        let bestCount = 0;
        Object.keys(counts || {}).forEach((key) => {
            if (counts[key] > bestCount) {
                bestKey = key;
                bestCount = counts[key];
            }
        });
        return bestKey || null;
    }

    function storageGet(keys) {
        if (Utils && typeof Utils.storageGet === "function") {
            return Utils.storageGet(keys);
        }
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(result || {});
            });
        });
    }

    function storageSet(payload) {
        if (Utils && typeof Utils.storageSet === "function") {
            return Utils.storageSet(payload);
        }
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
        if (Utils && typeof Utils.storageRemove === "function") {
            return Utils.storageRemove(keys);
        }
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

    global.OptionsLiveExtractionEngine = {
        DEFAULT_HISTORY_LIMIT: DEFAULT_HISTORY_LIMIT,
        HISTORY_STORAGE_PREFIX: HISTORY_STORAGE_PREFIX,
        SOURCE_TYPES: SOURCE_TYPES,
        buildLiveSnapshot: buildLiveSnapshot,
        clearSnapshotHistory: clearSnapshotHistory,
        detectSourceType: detectSourceType,
        getSnapshotHistory: getSnapshotHistory,
        getSnapshotHistoryMap: getSnapshotHistoryMap,
        mergeSnapshots: mergeSnapshots,
        updateSnapshotHistory: updateSnapshotHistory,
        updateSnapshotHistoryMap: updateSnapshotHistoryMap
    };
})(typeof globalThis !== "undefined" ? globalThis : this);

