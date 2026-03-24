importScripts(
    "utils.js",
    "ai-engine.js",
    "live-extraction-engine.js",
    "diagnostics-engine.js",
    "support-resistance-engine.js",
    "structure-engine.js",
    "decision-engine.js",
    "news-engine.js",
    "market-context.js",
    "trend-engine.js",
    "gap-engine.js",
    "trade-engine.js",
    "option-premium-engine.js",
    "postmarket-engine.js",
    "mpev-engine.js"
);

const Utils = self.OptionsAssistantUtils;
const AIEngine = self.OptionsAIEngine;
const LiveExtractionEngine = self.OptionsLiveExtractionEngine;
const DiagnosticsEngine = self.OptionsDiagnosticsEngine;
const SupportResistanceEngine = self.OptionsSupportResistanceEngine;
const StructureEngine = self.OptionsStructureEngine;
const DecisionEngine = self.OptionsDecisionEngine;
const NewsEngine = self.OptionsNewsEngine;
const MarketContext = self.OptionsMarketContext;
const TrendEngine = self.OptionsTrendEngine;
const GapEngine = self.OptionsGapEngine;
const TradeEngine = self.OptionsTradeEngine;
const OptionPremiumEngine = self.OptionsOptionPremiumEngine;
const PostMarketEngine = self.OptionsPostMarketEngine;
const MPEVEngine = self.OptionsMPEVEngine;
const CHATGPT_HOSTS = ["chat.openai.com", "chatgpt.com"];
const CHATGPT_ENTRY_URL = "https://chat.openai.com/";
const CHATGPT_ACTIONS = {
    PING: "OTA_CHATGPT_PING",
    RUN_PROMPT: "OTA_CHATGPT_RUN_PROMPT"
};

chrome.runtime.onInstalled.addListener(() => {
    bootstrapExtension(true).catch(logError);
});

chrome.runtime.onStartup.addListener(() => {
    bootstrapExtension(false).catch(logError);
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === Utils.ALARM_NAME) {
        scanAllMonitoredTabs("alarm").catch(logError);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    removeTabFromState(tabId).catch(logError);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
        rescanIfMonitored(tabId).catch(logError);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request || {}, sender)
        .then((payload) => sendResponse({ ok: true, payload: payload }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
});

async function bootstrapExtension(openOptionsOnInstall) {
    const state = await Utils.loadState();
    await Utils.saveState(state);
    Utils.createOrUpdateAlarm(state.settings.monitoringIntervalSeconds);

    if (openOptionsOnInstall) {
        chrome.runtime.openOptionsPage();
    }
}

async function handleMessage(request, sender) {
    if (request.type === "AI_RESPONSE") {
        return handleAIResponseMessage(request, sender);
    }

    switch (request.action) {
    case Utils.ACTIONS.SCAN_TAB:
        return scanSingleTab(request.tabId, { source: "manual" });
    case Utils.ACTIONS.SCAN_ALL_MONITORED_TABS:
        return scanAllMonitoredTabs("manual");
    case Utils.ACTIONS.START_MONITOR_TAB:
        return startMonitoringTab(request.tabId);
    case Utils.ACTIONS.STOP_MONITOR_TAB:
        return stopMonitoringTab(request.tabId);
    case Utils.ACTIONS.TOGGLE_MONITOR_TAB:
        return toggleMonitoringTab(request.tabId);
    case Utils.ACTIONS.CLEAR_HISTORY:
        return clearHistory();
    case Utils.ACTIONS.SETTINGS_UPDATED:
        return applyUpdatedSettings(request.settings || {});
    case Utils.ACTIONS.SAVE_MORNING_PROJECTION:
        return saveMorningProjection();
    case Utils.ACTIONS.RUN_EV_VALIDATION:
        return runEvValidation();
    case Utils.ACTIONS.REFRESH_NEWS:
        return refreshNews();
    case Utils.ACTIONS.GENERATE_TOMORROW_VIEW:
        return generateTomorrowView();
    case Utils.ACTIONS.RUN_AI_ANALYSIS:
        return runAIAnalysis();
    case Utils.ACTIONS.SET_SELECTED_INSTRUMENT:
        return setSelectedInstrument(request.instrument);
    default:
        return {
            message: "Background worker received the request.",
            senderTabId: sender && sender.tab ? sender.tab.id : null
        };
    }
}

async function scanAllMonitoredTabs(source) {
    const state = await Utils.loadState();
    const monitoredIds = Object.keys(state.monitoredTabs).map((key) => Number(key)).filter(Number.isFinite);
    const results = [];

    for (let index = 0; index < monitoredIds.length; index += 1) {
        const tabId = monitoredIds[index];
        try {
            const result = await scanSingleTab(tabId, { source: source || "alarm" }, state);
            results.push(result);
        } catch (error) {
            results.push({
                tabId: tabId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return {
        scannedCount: results.length,
        results: results
    };
}

async function scanSingleTab(tabId, options, preloadedState) {
    const state = preloadedState || await Utils.loadState();
    const previousOverall = Object.assign({}, state.overallSignal);
    const previousSnapshots = JSON.parse(JSON.stringify(state.latestSnapshots || {}));
    let tab;

    try {
        tab = await Utils.tabsGet(tabId);
    } catch (error) {
        await removeTabFromState(tabId, state);
        throw new Error(`Tab ${tabId} is not available anymore.`);
    }

    if (!tab || !Utils.isAccessibleUrl(tab.url)) {
        updateTabErrorState(state, tabId, "This tab cannot be scanned because Chrome blocks extension access on this URL.");
        await saveDerivedState(state, previousOverall, previousSnapshots, options && options.source);
        return {
            tabId: tabId,
            ok: false,
            error: "Tab is not accessible."
        };
    }

    await ensureContentScriptReady(tabId);

    const response = await Utils.tabsSendMessage(tabId, {
        action: Utils.ACTIONS.EXTRACT_PAGE_SNAPSHOT,
        settings: state.settings
    });

    if (!response || !response.ok || !response.payload) {
        const message = response && response.error ? response.error : "Content script did not return a valid payload.";
        updateTabErrorState(state, tabId, message, tab);
        await saveDerivedState(state, previousOverall, previousSnapshots, options && options.source);
        throw new Error(message);
    }

    const payloadSnapshot = Utils.createEmptySnapshot(response.payload);
    const snapshot = LiveExtractionEngine && typeof LiveExtractionEngine.buildLiveSnapshot === "function"
        ? LiveExtractionEngine.buildLiveSnapshot(payloadSnapshot)
        : payloadSnapshot;
    snapshot.tabId = tabId;
    snapshot.url = tab.url || snapshot.url;
    snapshot.pageTitle = tab.title || snapshot.pageTitle || snapshot.title || "";
    snapshot.title = snapshot.pageTitle;
    snapshot.sourceType = snapshot.sourceType || snapshot.siteType || Utils.inferSiteTypeFromUrl(tab.url);
    snapshot.siteType = snapshot.sourceType;
    snapshot.supportResistance = Utils.createEmptySupportResistance();
    snapshot.structureAnalysis = Utils.createEmptyStructureAnalysis();

    const localHistory = LiveExtractionEngine && typeof LiveExtractionEngine.updateSnapshotHistoryMap === "function"
        ? LiveExtractionEngine.updateSnapshotHistoryMap(state.snapshotsByTab, tabId, snapshot, state.settings)
        : Utils.appendSnapshotHistory(state.snapshotsByTab, tabId, snapshot, state.settings);

    if (LiveExtractionEngine && typeof LiveExtractionEngine.updateSnapshotHistory === "function") {
        LiveExtractionEngine.updateSnapshotHistory(tabId, snapshot, state.settings).catch(logError);
    }

    if (Number.isFinite(snapshot.values.spotPrice)) {
        const priceHistory = localHistory
            .map((entry) => entry && entry.values ? entry.values.spotPrice : null)
            .filter(Number.isFinite);
        const sessionHigh = priceHistory.length ? Math.max(...priceHistory) : snapshot.values.dayHigh;
        const sessionLow = priceHistory.length ? Math.min(...priceHistory) : snapshot.values.dayLow;

        snapshot.supportResistance = SupportResistanceEngine.calculateSupportResistance({
            currentPrice: snapshot.values.spotPrice,
            history: priceHistory,
            maxPain: snapshot.values.maxPain,
            changePercent: snapshot.values.changePercent,
            sessionHigh: sessionHigh,
            sessionLow: sessionLow
        });

        if (!Number.isFinite(snapshot.values.support) && Number.isFinite(snapshot.supportResistance.nearestSupport)) {
            snapshot.values.support = snapshot.supportResistance.nearestSupport;
        }
        if (!Number.isFinite(snapshot.values.resistance) && Number.isFinite(snapshot.supportResistance.nearestResistance)) {
            snapshot.values.resistance = snapshot.supportResistance.nearestResistance;
        }

        snapshot.structureAnalysis = StructureEngine.analyze({
            priceHistory: priceHistory,
            currentPrice: snapshot.values.spotPrice,
            supportResistance: snapshot.supportResistance
        });
    } else {
        snapshot.supportResistance.reasoning = ["Spot price is not available, so derived support and resistance could not be calculated."];
        snapshot.structureAnalysis.reasoning = ["Spot price is not available, so structure analysis could not be calculated."];
    }

    state.latestSnapshots[tabId] = snapshot;

    if (state.monitoredTabs[tabId]) {
        state.monitoredTabs[tabId] = Object.assign({}, state.monitoredTabs[tabId], {
            url: tab.url,
            title: tab.title || state.monitoredTabs[tabId].title,
            siteType: snapshot.siteType,
            lastScanAt: snapshot.timestamp,
            lastError: ""
        });
    }

    const derived = await saveDerivedState(state, previousOverall, previousSnapshots, options && options.source);
    return {
        tabId: tabId,
        ok: true,
        snapshot: snapshot,
        evaluation: derived.aggregate.byTab[tabId] || null,
        overall: derived.aggregate.overall,
        structureAnalysis: snapshot.structureAnalysis,
        trendAnalysis: derived.trendAnalysis,
        gapPrediction: derived.gapPrediction,
        tradePlan: derived.tradePlan,
        newsSentiment: derived.newsSentiment,
        tomorrowPrediction: derived.tomorrowPrediction,
        diagnostics: derived.diagnostics
    };
}

async function startMonitoringTab(tabId) {
    const state = await Utils.loadState();
    const tab = await Utils.tabsGet(tabId);

    if (!tab || !Utils.isAccessibleUrl(tab.url)) {
        throw new Error("This tab cannot be monitored because Chrome does not expose its contents to extensions.");
    }

    state.monitoredTabs[tabId] = {
        tabId: tabId,
        url: tab.url,
        title: tab.title || "Untitled tab",
        siteType: Utils.inferSiteTypeFromUrl(tab.url),
        addedAt: new Date().toISOString(),
        lastScanAt: null,
        lastError: "",
        monitored: true
    };

    await Utils.saveState(state);
    return scanSingleTab(tabId, { source: "monitor-start" });
}

async function stopMonitoringTab(tabId) {
    const state = await Utils.loadState();
    delete state.monitoredTabs[tabId];
    delete state.latestSnapshots[tabId];
    delete state.latestEvaluations[tabId];
    delete state.snapshotsByTab[tabId];
    await Utils.storageRemove(SupportResistanceEngine.getStorageKey(tabId));
    if (LiveExtractionEngine && typeof LiveExtractionEngine.clearSnapshotHistory === "function") {
        await LiveExtractionEngine.clearSnapshotHistory(tabId);
    }
    const previousOverall = Object.assign({}, state.overallSignal);
    const previousSnapshots = JSON.parse(JSON.stringify(state.latestSnapshots || {}));
    const derived = await saveDerivedState(state, previousOverall, previousSnapshots, "monitor-stop");
    return {
        stopped: true,
        tabId: tabId,
        overall: derived.aggregate.overall
    };
}

async function toggleMonitoringTab(tabId) {
    const state = await Utils.loadState();
    if (state.monitoredTabs[tabId]) {
        return stopMonitoringTab(tabId);
    }
    return startMonitoringTab(tabId);
}

async function clearHistory() {
    const state = await Utils.loadState();
    const allStorage = await Utils.storageGet(null);
    const priceHistoryKeys = Object.keys(allStorage || {}).filter((key) => key.startsWith(SupportResistanceEngine.STORAGE_PREFIX));
    const liveHistoryKeys = Object.keys(allStorage || {}).filter((key) => key.startsWith(LiveExtractionEngine.HISTORY_STORAGE_PREFIX));
    state.signalHistory = [];
    state.alertHistory = [];
    state.mpHistory = [];
    state.evHistory = [];
    state.latestSnapshots = {};
    state.latestEvaluations = {};
    state.snapshotsByTab = {};
    state.overallSignal = Utils.createEmptyOverallSignal();
    state.latestTrendAnalysis = Utils.createEmptyTrendAnalysis();
    state.latestGapPrediction = Utils.createEmptyGapPrediction();
    state.latestTradePlan = Utils.createEmptyTradePlan();
    state.latestSupportResistance = Utils.createEmptySupportResistance();
    state.latestStructureAnalysis = Utils.createEmptyStructureAnalysis();
    state.latestNewsSentiment = Utils.createEmptyNewsSentiment();
    state.latestTomorrowPrediction = Utils.createEmptyTomorrowPrediction();
    state.aiAnalysis = Utils.createEmptyAIAnalysis();
    state.accuracyMetrics = Utils.createEmptyAccuracyMetrics();
    state.latestDiagnostics = Utils.createEmptyDiagnostics ? Utils.createEmptyDiagnostics() : {};
    state.lastAlertMap = {};
    const storageKeysToRemove = priceHistoryKeys.concat(liveHistoryKeys);
    if (storageKeysToRemove.length) {
        await Utils.storageRemove(storageKeysToRemove);
    }
    await Utils.saveState(state);
    return {
        cleared: true
    };
}

async function applyUpdatedSettings(nextSettings) {
    const state = await Utils.loadState();
    state.settings = Utils.mergeSettings(nextSettings);
    Utils.createOrUpdateAlarm(state.settings.monitoringIntervalSeconds);
    const derived = await saveDerivedState(state, state.overallSignal, state.latestSnapshots, "settings-updated");
    return {
        settings: state.settings,
        overall: derived.aggregate.overall
    };
}

async function setSelectedInstrument(instrument) {
    const state = await Utils.loadState();
    const nextInstrument = Utils.normalizeInstrumentSelection(instrument);
    const previousOverall = Object.assign({}, state.overallSignal);
    const previousSnapshots = JSON.parse(JSON.stringify(state.latestSnapshots || {}));
    state.selectedInstrument = nextInstrument;

    const derived = await saveDerivedState(state, previousOverall, previousSnapshots, "instrument-updated");
    return {
        selectedInstrument: state.selectedInstrument,
        tradePlan: derived.tradePlan
    };
}

async function saveMorningProjection() {
    const state = await Utils.loadState();
    const projection = MPEVEngine.buildMorningProjection({
        overallSignal: state.overallSignal,
        trendAnalysis: state.latestTrendAnalysis,
        gapPrediction: state.latestGapPrediction,
        marketContext: buildCurrentMarketContext(state)
    });
    state.mpHistory = Utils.pruneHistoryByDays(
        MPEVEngine.upsertEntry(state.mpHistory, projection),
        state.settings.historyRetentionDays
    );
    state.accuracyMetrics = MPEVEngine.computeAccuracyMetrics(state.mpHistory, state.evHistory);
    await Utils.saveState(state);
    return projection;
}

async function runEvValidation() {
    const state = await Utils.loadState();
    const marketContext = buildCurrentMarketContext(state);
    const mpEntry = MPEVEngine.getTodayProjection(state.mpHistory, marketContext.latestTimestamp);
    const validation = MPEVEngine.buildEndOfDayValidation({
        mpEntry: mpEntry,
        marketContext: marketContext,
        overallSignal: state.overallSignal
    });
    state.evHistory = Utils.pruneHistoryByDays(
        MPEVEngine.upsertEntry(state.evHistory, validation),
        state.settings.historyRetentionDays
    );
    state.accuracyMetrics = MPEVEngine.computeAccuracyMetrics(state.mpHistory, state.evHistory);
    await Utils.saveState(state);
    return validation;
}

async function refreshNews() {
    const state = await Utils.loadState();
    const previousOverall = Object.assign({}, state.overallSignal);
    const previousSnapshots = JSON.parse(JSON.stringify(state.latestSnapshots || {}));
    const derived = await saveDerivedState(state, previousOverall, previousSnapshots, "news-refresh", {
        forceNewsRefresh: true
    });
    return derived.newsSentiment;
}

async function generateTomorrowView() {
    const state = await Utils.loadState();
    const snapshots = Object.values(state.latestSnapshots || {}).filter(Boolean);
    if (!snapshots.length) {
        throw new Error("Tomorrow view needs at least one monitored snapshot.");
    }

    const previousOverall = Object.assign({}, state.overallSignal);
    const previousSnapshots = JSON.parse(JSON.stringify(state.latestSnapshots || {}));
    const derived = await saveDerivedState(state, previousOverall, previousSnapshots, "manual-tomorrow", {
        forceNewsRefresh: true,
        forceTomorrowGeneration: true,
        autoGeneratedTomorrow: false
    });
    return derived.tomorrowPrediction;
}

async function runAIAnalysis() {
    const state = await Utils.loadState();
    const cooldownSeconds = Utils.toNumber(state.settings.aiBridgeCooldownSeconds) || 30;
    const timeoutMs = (Utils.toNumber(state.settings.aiBridgeTimeoutSeconds) || 20) * 1000;
    const now = Date.now();
    const current = state.aiAnalysis || Utils.createEmptyAIAnalysis();

    if (current.state === "RUNNING" && current.lastRunAt) {
        const elapsed = now - new Date(current.lastRunAt).getTime();
        if (elapsed < Math.max(15000, timeoutMs + 5000)) {
            return current;
        }
    }

    if (current.cooldownUntil && now < new Date(current.cooldownUntil).getTime()) {
        const remainingSeconds = Math.max(1, Math.ceil((new Date(current.cooldownUntil).getTime() - now) / 1000));
        state.aiAnalysis = Object.assign({}, current, {
            state: "COOLDOWN",
            statusText: `AI cooldown active. Try again in ${remainingSeconds}s.`,
            updatedAt: new Date().toISOString()
        });
        await Utils.saveState(state);
        return state.aiAnalysis;
    }

    const runId = Utils.createId("ai");
    const marketContext = buildCurrentMarketContext(state);
    const aiPayload = AIEngine.buildAIMarketPayload({
        marketContext: marketContext,
        overallSignal: state.overallSignal,
        trendAnalysis: state.latestTrendAnalysis,
        gapPrediction: state.latestGapPrediction,
        tradePlan: state.latestTradePlan,
        supportResistance: state.latestSupportResistance,
        structureAnalysis: state.latestStructureAnalysis,
        newsSentiment: state.latestNewsSentiment,
        tomorrowPrediction: state.latestTomorrowPrediction
    });
    const prompt = AIEngine.buildAIPrompt(aiPayload);

    state.aiAnalysis = Object.assign({}, Utils.createEmptyAIAnalysis(), current, {
        state: "RUNNING",
        statusText: "Waiting for response",
        lastRunAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runId: runId,
        sourceTabId: null,
        cooldownUntil: new Date(now + (cooldownSeconds * 1000)).toISOString(),
        error: "",
        rawOutput: ""
    });
    await Utils.saveState(state);

    try {
        const chatTab = await findOrCreateChatGPTTab();
        await ensureChatGPTContentScriptReady(chatTab.id);

        const response = await Utils.tabsSendMessage(chatTab.id, {
            action: CHATGPT_ACTIONS.RUN_PROMPT,
            runId: runId,
            prompt: prompt,
            timeoutMs: timeoutMs
        });

        if (!response || !response.ok || !response.payload || !response.payload.text) {
            throw new Error(response && response.error ? response.error : "AI not available");
        }

        const saved = await persistAIResponse({
            runId: runId,
            text: response.payload.text,
            sourceTabId: chatTab.id,
            source: "direct-return"
        });

        return saved;
    } catch (error) {
        const latest = await Utils.loadState();
        latest.aiAnalysis = Object.assign({}, latest.aiAnalysis || Utils.createEmptyAIAnalysis(), {
            state: /timeout/i.test(error instanceof Error ? error.message : String(error)) ? "TIMEOUT" : "UNAVAILABLE",
            statusText: /timeout/i.test(error instanceof Error ? error.message : String(error))
                ? "AI not available: response timeout."
                : "AI not available",
            updatedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error)
        });
        await Utils.saveState(latest);
        throw error;
    }
}

async function handleAIResponseMessage(request, sender) {
    const payload = request && request.payload ? request.payload : {};
    const text = typeof payload === "string" ? payload : payload.text;
    const runId = request && request.runId ? request.runId : payload && payload.runId ? payload.runId : null;

    if (!text) {
        return { received: false, message: "No AI text payload." };
    }

    const saved = await persistAIResponse({
        runId: runId,
        text: text,
        sourceTabId: sender && sender.tab ? sender.tab.id : null,
        source: "runtime-message"
    });
    return {
        received: true,
        state: saved.state
    };
}

async function persistAIResponse(args) {
    const state = await Utils.loadState();
    const current = state.aiAnalysis || Utils.createEmptyAIAnalysis();
    const runId = args && args.runId ? args.runId : null;
    const text = String(args && args.text || "").trim();
    if (!text) {
        return current;
    }

    // Ignore stale asynchronous callbacks from a previous run.
    if (runId && current.runId && runId !== current.runId) {
        return current;
    }

    const parsed = AIEngine.parseAIResponse(text);
    state.aiAnalysis = Object.assign({}, current, {
        state: "DONE",
        statusText: "Response received",
        updatedAt: new Date().toISOString(),
        sourceTabId: args && Number.isFinite(args.sourceTabId) ? args.sourceTabId : current.sourceTabId,
        error: "",
        rawOutput: text,
        parsed: {
            summary: parsed.summary,
            beginnerAdvice: parsed.beginnerAdvice,
            proInsight: parsed.proInsight,
            tradeSuggestion: parsed.tradeSuggestion,
            riskWarning: parsed.riskWarning,
            parseMode: parsed.parseMode || "RAW_FALLBACK"
        }
    });

    await Utils.saveState(state);
    return state.aiAnalysis;
}

async function findOrCreateChatGPTTab() {
    const tabs = await Utils.tabsQuery({});
    const existing = tabs.find((tab) => isChatGPTUrl(tab.url));
    let tab = existing;

    if (!tab) {
        tab = await new Promise((resolve) => {
            chrome.tabs.create({ url: CHATGPT_ENTRY_URL, active: true }, resolve);
        });
    }

    return waitForTabReady(tab.id, 20000);
}

async function waitForTabReady(tabId, timeoutMs) {
    const initial = await Utils.tabsGet(tabId);
    if (initial && initial.status === "complete" && isChatGPTUrl(initial.url)) {
        return initial;
    }

    return new Promise((resolve, reject) => {
        let timeoutHandle = null;

        function cleanup() {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }

        function onUpdated(updatedTabId, changeInfo, updatedTab) {
            if (updatedTabId !== tabId) {
                return;
            }
            if (changeInfo.status === "complete" && isChatGPTUrl(updatedTab && updatedTab.url)) {
                cleanup();
                resolve(updatedTab);
            }
        }

        chrome.tabs.onUpdated.addListener(onUpdated);
        timeoutHandle = setTimeout(async () => {
            cleanup();
            try {
                const latest = await Utils.tabsGet(tabId);
                if (latest && isChatGPTUrl(latest.url)) {
                    resolve(latest);
                    return;
                }
            } catch (error) {
                // Fall through to rejection.
            }
            reject(new Error("ChatGPT tab did not finish loading in time."));
        }, timeoutMs);
    });
}

async function ensureChatGPTContentScriptReady(tabId) {
    try {
        const ping = await Utils.tabsSendMessage(tabId, { action: CHATGPT_ACTIONS.PING });
        if (ping && ping.ok) {
            return;
        }
    } catch (error) {
        await Utils.executeScript(tabId, ["chatgpt-content.js"]);
    }

    const secondPing = await Utils.tabsSendMessage(tabId, { action: CHATGPT_ACTIONS.PING });
    if (!secondPing || !secondPing.ok) {
        throw new Error("AI not available: ChatGPT bridge content script is unreachable.");
    }
}

function isChatGPTUrl(url) {
    const value = String(url || "");
    return CHATGPT_HOSTS.some((host) => value.includes(host));
}

async function removeTabFromState(tabId, preloadedState) {
    const state = preloadedState || await Utils.loadState();
    const previousOverall = Object.assign({}, state.overallSignal);
    const previousSnapshots = JSON.parse(JSON.stringify(state.latestSnapshots || {}));
    let changed = false;

    if (state.monitoredTabs[tabId]) {
        delete state.monitoredTabs[tabId];
        changed = true;
    }
    if (state.latestSnapshots[tabId]) {
        delete state.latestSnapshots[tabId];
        changed = true;
    }
    if (state.latestEvaluations[tabId]) {
        delete state.latestEvaluations[tabId];
        changed = true;
    }
    if (state.snapshotsByTab[tabId]) {
        delete state.snapshotsByTab[tabId];
        changed = true;
    }

    if (changed) {
        await Utils.storageRemove(SupportResistanceEngine.getStorageKey(tabId));
        if (LiveExtractionEngine && typeof LiveExtractionEngine.clearSnapshotHistory === "function") {
            await LiveExtractionEngine.clearSnapshotHistory(tabId);
        }
        await saveDerivedState(state, previousOverall, previousSnapshots, "tab-removed");
    }
}

async function rescanIfMonitored(tabId) {
    const state = await Utils.loadState();
    if (!state.monitoredTabs[tabId]) {
        return;
    }
    await scanSingleTab(tabId, { source: "tab-updated" }, state);
}

async function ensureContentScriptReady(tabId) {
    try {
        const ping = await Utils.tabsSendMessage(tabId, { action: Utils.ACTIONS.PING });
        if (ping && ping.ok) {
            return;
        }
    } catch (error) {
        await Utils.executeScript(tabId, ["utils.js", "selectors.js", "live-extraction-engine.js", "option-chain-extractor.js", "content.js"]);
    }
}

function updateTabErrorState(state, tabId, message, tab) {
    if (state.monitoredTabs[tabId]) {
        state.monitoredTabs[tabId] = Object.assign({}, state.monitoredTabs[tabId], {
            url: tab && tab.url ? tab.url : state.monitoredTabs[tabId].url,
            title: tab && tab.title ? tab.title : state.monitoredTabs[tabId].title,
            lastScanAt: new Date().toISOString(),
            lastError: message
        });
    }
}

async function saveDerivedState(state, previousOverall, previousSnapshots, source, options) {
    const selectedInstrument = Utils.normalizeInstrumentSelection(state.selectedInstrument);
    const snapshots = getSnapshotsForInstrument(state.latestSnapshots, selectedInstrument);
    const newsSentiment = await resolveNewsSentiment(state, options);
    const aggregate = DecisionEngine.evaluateAll(snapshots, state.settings, {
        newsSentiment: newsSentiment,
        selectedInstrument: selectedInstrument
    });
    const marketContext = MarketContext.buildMarketContext({
        snapshots: snapshots,
        evaluations: aggregate.byTab,
        snapshotsByTab: state.snapshotsByTab,
        settings: state.settings,
        selectedInstrument: selectedInstrument,
        newsSentiment: newsSentiment
    });
    const trendAnalysis = TrendEngine.evaluate(marketContext, state.settings);
    const gapPredictionResult = GapEngine.evaluate({
        marketContext: marketContext,
        overallSignal: aggregate.overall,
        trendAnalysis: trendAnalysis
    }, state.settings);
    const structureAnalysis = StructureEngine.aggregateAnalyses(snapshots.map((snapshot) => snapshot.structureAnalysis));
    const optionChain = pickBestOptionChain(snapshots);
    const extractedOptionPremiums = aggregateExtractedOptionPremiums(snapshots);

    const tradePlanBase = TradeEngine.evaluate({
        marketContext: marketContext,
        overallSignal: aggregate.overall,
        trendAnalysis: trendAnalysis,
        gapPrediction: gapPredictionResult.gapPrediction
    }, state.settings);

    const premiumTradePlan = OptionPremiumEngine && typeof OptionPremiumEngine.evaluate === "function"
        ? OptionPremiumEngine.evaluate({
            instrument: marketContext.instrument,
            instrumentType: marketContext.type,
            spotPrice: marketContext.spotPrice,
            marketBias: aggregate.overall.signal,
            confidence: aggregate.overall.confidence,
            trend15m: trendAnalysis.bias15m.signal,
            trend1h: trendAnalysis.bias1h.signal,
            support: marketContext.support,
            resistance: marketContext.resistance,
            breakout: Boolean(marketContext.supportResistance && marketContext.supportResistance.breakout),
            breakdown: Boolean(marketContext.supportResistance && marketContext.supportResistance.breakdown),
            structure: structureAnalysis.structure,
            vix: marketContext.aggregateValues.vix,
            pcr: marketContext.aggregateValues.pcr,
            maxPain: marketContext.aggregateValues.maxPain,
            selectedRiskMode: state.settings.defaultPremiumRiskMode,
            optionChain: optionChain,
            extractedPageData: extractedOptionPremiums,
            entryType: tradePlanBase.tradePlan.entryType,
            tradeStatus: tradePlanBase.tradePlan.status
        }, state.settings)
        : Utils.createEmptyPremiumTradePlan();

    const tradePlanResult = TradeEngine.evaluate({
        marketContext: marketContext,
        overallSignal: aggregate.overall,
        trendAnalysis: trendAnalysis,
        gapPrediction: gapPredictionResult.gapPrediction,
        premiumTradePlan: premiumTradePlan
    }, state.settings);

    tradePlanResult.tradePlan.optionPlan = buildLegacyOptionPlan(tradePlanResult.tradePlan.premiumTradePlan);

    state.latestEvaluations = aggregate.byTab;
    state.overallSignal = aggregate.overall;
    state.latestTrendAnalysis = trendAnalysis;
    state.latestGapPrediction = gapPredictionResult.gapPrediction;
    state.latestTradePlan = tradePlanResult.tradePlan;
    state.latestSupportResistance = marketContext.supportResistance || Utils.createEmptySupportResistance();
    state.latestStructureAnalysis = structureAnalysis;
    state.latestNewsSentiment = newsSentiment;
    maybeGenerateTomorrowPrediction(state, marketContext, aggregate.overall, trendAnalysis, gapPredictionResult.gapPrediction, options);
    state.latestDiagnostics = DiagnosticsEngine && typeof DiagnosticsEngine.buildDiagnostics === "function"
        ? DiagnosticsEngine.buildDiagnostics({
            state: state,
            snapshots: snapshots,
            marketContext: marketContext,
            aggregate: aggregate,
            trendAnalysis: trendAnalysis,
            tradePlan: tradePlanResult.tradePlan,
            premiumTradePlan: premiumTradePlan
        })
        : (Utils.createEmptyDiagnostics ? Utils.createEmptyDiagnostics() : {});

    if (aggregate.overall.updatedAt) {
        state.signalHistory = Utils.appendLimitedHistory(state.signalHistory, {
            id: Utils.createId("signal"),
            timestamp: aggregate.overall.updatedAt,
            signal: aggregate.overall.signal,
            confidence: aggregate.overall.confidence,
            strength: aggregate.overall.strength,
            score: aggregate.overall.score,
            tabCount: aggregate.overall.tabCount,
            source: source || "scan"
        }, Math.max(state.settings.retentionHistoryLimit, 180));
        state.signalHistory = Utils.pruneHistoryByDays(state.signalHistory, state.settings.historyRetentionDays);
    }

    const alerts = determineAlerts(state, previousOverall || Utils.createEmptyOverallSignal(), previousSnapshots || {}, aggregate, tradePlanResult.tradePlan);
    await emitAlerts(state, alerts);

    maybeAutoSaveMorningProjection(state, marketContext);
    state.accuracyMetrics = MPEVEngine.computeAccuracyMetrics(state.mpHistory, state.evHistory);
    await Utils.saveState(state);

    return {
        aggregate: aggregate,
        supportResistance: marketContext.supportResistance || Utils.createEmptySupportResistance(),
        structureAnalysis: state.latestStructureAnalysis,
        trendAnalysis: trendAnalysis,
        gapPrediction: gapPredictionResult.gapPrediction,
        tradePlan: tradePlanResult.tradePlan,
        newsSentiment: state.latestNewsSentiment,
        tomorrowPrediction: state.latestTomorrowPrediction,
        diagnostics: state.latestDiagnostics
    };
}

async function resolveNewsSentiment(state, options) {
    const newsSentiment = await NewsEngine.refreshNewsWithCache(
        state.latestNewsSentiment,
        state.settings,
        {
            forceRefresh: Boolean(options && options.forceNewsRefresh)
        }
    );
    return newsSentiment;
}

function maybeGenerateTomorrowPrediction(state, marketContext, overallSignal, trendAnalysis, gapPrediction, options) {
    const shouldGenerate = Boolean(options && options.forceTomorrowGeneration)
        || (marketContext.snapshots && marketContext.snapshots.length && PostMarketEngine.shouldAutoGenerate(state.settings, new Date()));

    if (!shouldGenerate) {
        if (!state.latestTomorrowPrediction || !state.latestTomorrowPrediction.generatedAt) {
            state.latestTomorrowPrediction = Utils.createEmptyTomorrowPrediction();
        }
        return;
    }

    state.latestTomorrowPrediction = PostMarketEngine.evaluate({
        marketContext: marketContext,
        overallSignal: overallSignal,
        trendAnalysis: trendAnalysis,
        gapPrediction: gapPrediction,
        structureAnalysis: state.latestStructureAnalysis,
        newsSentiment: state.latestNewsSentiment
    }, state.settings, {
        autoGenerated: options && Object.prototype.hasOwnProperty.call(options, "autoGeneratedTomorrow")
            ? Boolean(options.autoGeneratedTomorrow)
            : true
    });
}

function maybeAutoSaveMorningProjection(state, marketContext) {
    if (!state.settings.autoSaveMorningProjection) {
        return;
    }

    const currentHour = new Date().getHours();
    if (currentHour > 11) {
        return;
    }

    const existing = MPEVEngine.getTodayProjection(state.mpHistory, marketContext.latestTimestamp);
    if (existing) {
        return;
    }

    const projection = MPEVEngine.buildMorningProjection({
        overallSignal: state.overallSignal,
        trendAnalysis: state.latestTrendAnalysis,
        gapPrediction: state.latestGapPrediction,
        marketContext: marketContext
    });
    state.mpHistory = Utils.pruneHistoryByDays(
        MPEVEngine.upsertEntry(state.mpHistory, projection),
        state.settings.historyRetentionDays
    );
}

function pickBestOptionChain(snapshots) {
    const source = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
    let best = Utils.createEmptyOptionChain();
    let bestCount = 0;

    source.forEach((snapshot) => {
        const optionChain = Utils.normalizeOptionChain(snapshot.optionChain);
        const count = optionChain.strikes.length;
        if (count > bestCount) {
            best = optionChain;
            bestCount = count;
        }
    });

    return best;
}

function aggregateExtractedOptionPremiums(snapshots) {
    const source = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
    const aggregated = {};

    source.forEach((snapshot) => {
        const scraped = Utils.normalizeExtractedOptionPremiums(snapshot.extractedOptionPremiums);
        Object.keys(scraped).forEach((key) => {
            aggregated[key] = scraped[key];
        });

        const optionChain = Utils.normalizeOptionChain(snapshot.optionChain);
        optionChain.strikes.forEach((row) => {
            if (!Number.isFinite(row.strike)) {
                return;
            }
            const strike = String(Math.round(row.strike));
            if (Number.isFinite(row.ceLtp)) {
                aggregated[`${strike}-CE`] = row.ceLtp;
            }
            if (Number.isFinite(row.peLtp)) {
                aggregated[`${strike}-PE`] = row.peLtp;
            }
        });
    });

    return aggregated;
}

function buildLegacyOptionPlan(premiumTradePlan) {
    const premium = Utils.normalizePremiumTradePlan(premiumTradePlan);
    if (!premium || !premium.contract || premium.contract.side === "NONE") {
        return {
            symbol: "--",
            strike: null,
            type: "NONE",
            strategyProfile: "CONSERVATIVE",
            entryPriceRange: null,
            stopLoss: null,
            targets: [],
            premiumSource: "NONE",
            needsUserPremiumInput: true,
            message: premium && premium.statusNote ? premium.statusNote : "No premium setup."
        };
    }

    const entryMin = premium.pricing && premium.pricing.entryZone ? premium.pricing.entryZone.min : null;
    const entryMax = premium.pricing && premium.pricing.entryZone ? premium.pricing.entryZone.max : null;
    const entryText = Number.isFinite(entryMin) && Number.isFinite(entryMax)
        ? `₹${Utils.formatNumber(entryMin, 2)} - ₹${Utils.formatNumber(entryMax, 2)}`
        : "--";

    return {
        symbol: premium.contract.label,
        strike: premium.contract.strike,
        type: premium.contract.side,
        strategyProfile: premium.shouldWaitForConfirmation ? "CONSERVATIVE" : "BALANCED",
        entryPriceRange: {
            min: entryMin,
            max: entryMax,
            text: entryText
        },
        stopLoss: premium.pricing && premium.pricing.stopLoss ? premium.pricing.stopLoss.value : null,
        targets: [
            premium.pricing && Array.isArray(premium.pricing.targets) && premium.pricing.targets[0] ? premium.pricing.targets[0].value : null,
            premium.pricing && Array.isArray(premium.pricing.targets) && premium.pricing.targets[1] ? premium.pricing.targets[1].value : null
        ].filter(Number.isFinite),
        premiumSource: premium.contract.premiumSource || "NONE",
        needsUserPremiumInput: premium.contract.premiumSource === "NONE",
        message: premium.statusNote || "Premium setup generated."
    };
}

function determineAlerts(state, previousOverall, previousSnapshots, aggregate, tradePlan) {
    const alerts = [];
    const now = Date.now();
    const signalHistoryWithCurrent = Utils.appendLimitedHistory(state.signalHistory, {
        timestamp: aggregate.overall.updatedAt,
        signal: aggregate.overall.signal,
        confidence: aggregate.overall.confidence
    }, state.settings.retentionHistoryLimit);

    if (aggregate.overall.signal === "BULLISH"
        && previousOverall.signal !== "BULLISH"
        && aggregate.overall.confidence >= state.settings.confidenceThreshold
        && isSignalSustained(signalHistoryWithCurrent, "BULLISH", state.settings)) {
        alerts.push(buildAlert("overall-bullish", "Bullish threshold crossed", `Overall bias is bullish with ${aggregate.overall.confidence}% confidence.`, null, now));
    }

    if (aggregate.overall.signal === "BEARISH"
        && previousOverall.signal !== "BEARISH"
        && aggregate.overall.confidence >= state.settings.confidenceThreshold
        && isSignalSustained(signalHistoryWithCurrent, "BEARISH", state.settings)) {
        alerts.push(buildAlert("overall-bearish", "Bearish threshold crossed", `Overall bias is bearish with ${aggregate.overall.confidence}% confidence.`, null, now));
    }

    if ((tradePlan.status === "READY" || tradePlan.status === "AGGRESSIVE_READY")
        && previousOverall.signal !== aggregate.overall.signal) {
        alerts.push(buildAlert(
            `trade-ready-${tradePlan.direction}`,
            "Trade setup available",
            `${tradePlan.direction} setup is ${tradePlan.status.toLowerCase().replace(/_/g, " ")} with ${aggregate.overall.signal} bias.`,
            null,
            now
        ));
    }

    aggregate.rows.forEach((row) => {
        const previous = previousSnapshots[row.tabId] && previousSnapshots[row.tabId].values
            ? previousSnapshots[row.tabId].values
            : null;
        const values = row.values || {};

        if (Number.isFinite(values.pcr) && values.pcr >= state.settings.bullishPcrThreshold && (!previous || !Number.isFinite(previous.pcr) || previous.pcr < state.settings.bullishPcrThreshold)) {
            alerts.push(buildAlert(`pcr-bullish-${row.tabId}`, `${row.instrument} PCR bullish`, `PCR moved into the bullish zone on ${row.instrument}.`, row.tabId, now));
        }

        if (Number.isFinite(values.pcr) && values.pcr <= state.settings.bearishPcrThreshold && (!previous || !Number.isFinite(previous.pcr) || previous.pcr > state.settings.bearishPcrThreshold)) {
            alerts.push(buildAlert(`pcr-bearish-${row.tabId}`, `${row.instrument} PCR bearish`, `PCR moved into the bearish zone on ${row.instrument}.`, row.tabId, now));
        }

        if (Number.isFinite(values.vix) && values.vix >= state.settings.highVixThreshold && (!previous || !Number.isFinite(previous.vix) || previous.vix < state.settings.highVixThreshold)) {
            alerts.push(buildAlert(`vix-spike-${row.tabId}`, `${row.instrument} VIX spike`, `Visible VIX moved above the high-risk threshold on ${row.instrument}.`, row.tabId, now));
        }
    });

    return alerts.filter((alert) => shouldEmitAlert(state, alert));
}

function buildAlert(key, title, message, tabId, timestamp) {
    return {
        id: Utils.createId("alert"),
        cooldownKey: key,
        title: title,
        message: message,
        tabId: tabId,
        timestamp: new Date(timestamp).toISOString()
    };
}

function shouldEmitAlert(state, alert) {
    const previousTimestamp = state.lastAlertMap[alert.cooldownKey];
    if (!previousTimestamp) {
        return true;
    }
    const cooldownMs = state.settings.alertCooldownMinutes * 60 * 1000;
    return (Date.now() - new Date(previousTimestamp).getTime()) >= cooldownMs;
}

function isSignalSustained(history, signal, settings) {
    const windowMs = settings.sustainedConditionMinutes * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const relevant = history.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
    if (!relevant.length) {
        return false;
    }
    return relevant.every((entry) => entry.signal === signal && entry.confidence >= settings.confidenceThreshold);
}

async function emitAlerts(state, alerts) {
    if (!alerts.length) {
        return;
    }

    for (let index = 0; index < alerts.length; index += 1) {
        const alert = alerts[index];
        state.alertHistory = Utils.appendLimitedHistory(state.alertHistory, alert, Math.max(state.settings.retentionHistoryLimit, 180));
        state.alertHistory = Utils.pruneHistoryByDays(state.alertHistory, state.settings.historyRetentionDays);
        state.lastAlertMap[alert.cooldownKey] = alert.timestamp;

        if (state.settings.notificationsEnabled) {
            try {
                await Utils.createNotification(alert.id, {
                    type: "basic",
                    iconUrl: "icons/icon128.png",
                    title: alert.title,
                    message: alert.message
                });
            } catch (error) {
                logError(error);
            }
        }
    }
}

function buildCurrentMarketContext(state) {
    const selectedInstrument = Utils.normalizeInstrumentSelection(state.selectedInstrument);
    const snapshots = getSnapshotsForInstrument(state.latestSnapshots, selectedInstrument);
    return MarketContext.buildMarketContext({
        snapshots: snapshots,
        evaluations: state.latestEvaluations || {},
        snapshotsByTab: state.snapshotsByTab || {},
        settings: state.settings,
        selectedInstrument: selectedInstrument,
        newsSentiment: state.latestNewsSentiment
    });
}

function getSnapshotsForInstrument(snapshotMap, selectedInstrument) {
    const snapshots = Object.values(snapshotMap || {}).filter(Boolean);
    if (!snapshots.length) {
        return [];
    }

    const normalizedInstrument = Utils.normalizeInstrumentSelection(selectedInstrument);
    return snapshots.filter((snapshot) => snapshotMatchesInstrument(snapshot, normalizedInstrument));
}

function snapshotMatchesInstrument(snapshot, selectedInstrument) {
    if (!snapshot) {
        return false;
    }

    const normalizedInstrument = Utils.normalizeInstrumentSelection(selectedInstrument);
    const rawInstrument = String(snapshot.instrument || "").trim().toUpperCase();
    if (rawInstrument && rawInstrument !== "UNKNOWN" && rawInstrument !== "--") {
        const snapshotInstrument = Utils.normalizeInstrumentSelection(rawInstrument);
        if (snapshotInstrument === normalizedInstrument) {
            return true;
        }
    }

    const aliases = getInstrumentAliases(normalizedInstrument);
    const haystack = `${snapshot.pageTitle || ""} ${snapshot.url || ""} ${snapshot.instrument || ""}`.toUpperCase();
    return aliases.some((alias) => hasInstrumentAlias(haystack, alias));
}

function getInstrumentAliases(instrument) {
    const normalizedInstrument = Utils.normalizeInstrumentSelection(instrument);
    const meta = Utils.getInstrumentMeta(normalizedInstrument);
    const aliasMap = {
        NIFTY: ["NIFTY", "NIFTY 50"],
        BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
        RELIANCE: ["RELIANCE", "RELIANCE INDUSTRIES"],
        HDFCBANK: ["HDFCBANK", "HDFC BANK", "HDFC"],
        TCS: ["TCS", "TATA CONSULTANCY SERVICES"],
        INFY: ["INFY", "INFOSYS"],
        ICICIBANK: ["ICICIBANK", "ICICI BANK", "ICICI"],
        SBIN: ["SBIN", "STATE BANK", "STATE BANK OF INDIA"],
        LT: ["L&T", "LT", "LARSEN", "LARSEN & TOUBRO"]
    };

    const defaults = [meta.id, meta.label, String(meta.label || "").replace(/\s+/g, "")];
    return Utils.dedupeStrings(defaults.concat(aliasMap[normalizedInstrument] || []).filter(Boolean));
}

function hasInstrumentAlias(haystack, alias) {
    const target = String(alias || "").trim().toUpperCase();
    if (!target) {
        return false;
    }

    if (/^[A-Z0-9]+$/.test(target)) {
        return new RegExp(`\\b${escapeRegExp(target)}\\b`, "i").test(haystack);
    }
    return haystack.includes(target);
}

function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function logError(error) {
    console.error("[Options Trading Assistant]", error);
}
