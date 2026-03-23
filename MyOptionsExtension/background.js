importScripts(
    "utils.js",
    "support-resistance-engine.js",
    "structure-engine.js",
    "decision-engine.js",
    "market-context.js",
    "trend-engine.js",
    "gap-engine.js",
    "trade-engine.js",
    "mpev-engine.js"
);

const Utils = self.OptionsAssistantUtils;
const SupportResistanceEngine = self.OptionsSupportResistanceEngine;
const StructureEngine = self.OptionsStructureEngine;
const DecisionEngine = self.OptionsDecisionEngine;
const MarketContext = self.OptionsMarketContext;
const TrendEngine = self.OptionsTrendEngine;
const GapEngine = self.OptionsGapEngine;
const TradeEngine = self.OptionsTradeEngine;
const MPEVEngine = self.OptionsMPEVEngine;

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

    const snapshot = Utils.createEmptySnapshot(response.payload);
    snapshot.tabId = tabId;
    snapshot.url = tab.url || snapshot.url;
    snapshot.pageTitle = tab.title || snapshot.pageTitle;
    snapshot.siteType = snapshot.siteType || Utils.inferSiteTypeFromUrl(tab.url);
    snapshot.supportResistance = Utils.createEmptySupportResistance();
    snapshot.structureAnalysis = Utils.createEmptyStructureAnalysis();

    if (Number.isFinite(snapshot.values.spotPrice)) {
        const priceHistory = await SupportResistanceEngine.updatePriceHistory(snapshot.values.spotPrice, tabId);
        snapshot.supportResistance = SupportResistanceEngine.calculateSupportResistance({
            currentPrice: snapshot.values.spotPrice,
            history: priceHistory,
            maxPain: snapshot.values.maxPain,
            changePercent: snapshot.values.changePercent
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
    Utils.appendSnapshotHistory(state.snapshotsByTab, tabId, snapshot, state.settings);

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
        tradePlan: derived.tradePlan
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
    state.signalHistory = [];
    state.alertHistory = [];
    state.mpHistory = [];
    state.evHistory = [];
    state.snapshotsByTab = {};
    state.latestSupportResistance = Utils.createEmptySupportResistance();
    state.latestStructureAnalysis = Utils.createEmptyStructureAnalysis();
    state.accuracyMetrics = Utils.createEmptyAccuracyMetrics();
    state.lastAlertMap = {};
    if (priceHistoryKeys.length) {
        await Utils.storageRemove(priceHistoryKeys);
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
        await Utils.executeScript(tabId, ["utils.js", "selectors.js", "content.js"]);
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

async function saveDerivedState(state, previousOverall, previousSnapshots, source) {
    const snapshots = Object.values(state.latestSnapshots || {}).filter(Boolean);
    const aggregate = DecisionEngine.evaluateAll(snapshots, state.settings);
    const marketContext = MarketContext.buildMarketContext({
        snapshots: snapshots,
        evaluations: aggregate.byTab,
        snapshotsByTab: state.snapshotsByTab,
        settings: state.settings
    });
    const trendAnalysis = TrendEngine.evaluate(marketContext, state.settings);
    const gapPredictionResult = GapEngine.evaluate({
        marketContext: marketContext,
        overallSignal: aggregate.overall,
        trendAnalysis: trendAnalysis
    }, state.settings);
    const tradePlanResult = TradeEngine.evaluate({
        marketContext: marketContext,
        overallSignal: aggregate.overall,
        trendAnalysis: trendAnalysis,
        gapPrediction: gapPredictionResult.gapPrediction
    }, state.settings);

    state.latestEvaluations = aggregate.byTab;
    state.overallSignal = aggregate.overall;
    state.latestTrendAnalysis = trendAnalysis;
    state.latestGapPrediction = gapPredictionResult.gapPrediction;
    state.latestTradePlan = tradePlanResult.tradePlan;
    state.latestSupportResistance = marketContext.supportResistance || Utils.createEmptySupportResistance();
    state.latestStructureAnalysis = StructureEngine.aggregateAnalyses(snapshots.map((snapshot) => snapshot.structureAnalysis));
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
        tradePlan: tradePlanResult.tradePlan
    };
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
    const snapshots = Object.values(state.latestSnapshots || {}).filter(Boolean);
    return MarketContext.buildMarketContext({
        snapshots: snapshots,
        evaluations: state.latestEvaluations || {},
        snapshotsByTab: state.snapshotsByTab || {},
        settings: state.settings
    });
}

function logError(error) {
    console.error("[Options Trading Assistant]", error);
}
