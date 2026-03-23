(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;

    const refs = {
        overallSignalBadge: document.getElementById("overallSignalBadge"),
        overallSignalText: document.getElementById("overallSignalText"),
        confidenceValue: document.getElementById("confidenceValue"),
        confidenceMeterBar: document.getElementById("confidenceMeterBar"),
        lastUpdateText: document.getElementById("lastUpdateText"),
        reasoningList: document.getElementById("reasoningList"),
        trend15Text: document.getElementById("trend15Text"),
        trend15Meta: document.getElementById("trend15Meta"),
        trend1hText: document.getElementById("trend1hText"),
        trend1hMeta: document.getElementById("trend1hMeta"),
        gapPrimaryText: document.getElementById("gapPrimaryText"),
        gapMeta: document.getElementById("gapMeta"),
        tradeStatusText: document.getElementById("tradeStatusText"),
        tradeMeta: document.getElementById("tradeMeta"),
        supportValueText: document.getElementById("supportValueText"),
        resistanceValueText: document.getElementById("resistanceValueText"),
        levelStatusBadge: document.getElementById("levelStatusBadge"),
        monitoredTabsCount: document.getElementById("monitoredTabsCount"),
        currentTabStatus: document.getElementById("currentTabStatus"),
        currentTabMeta: document.getElementById("currentTabMeta"),
        scanCurrentTabBtn: document.getElementById("scanCurrentTabBtn"),
        toggleMonitorBtn: document.getElementById("toggleMonitorBtn"),
        openReportBtn: document.getElementById("openReportBtn"),
        saveMorningProjectionBtn: document.getElementById("saveMorningProjectionBtn"),
        runEvValidationBtn: document.getElementById("runEvValidationBtn"),
        openSettingsBtn: document.getElementById("openSettingsBtn")
    };

    let activeTab = null;

    init().catch(renderError);

    function init() {
        bindEvents();
        chrome.storage.onChanged.addListener(() => {
            refreshView().catch(renderError);
        });
        return refreshView();
    }

    function bindEvents() {
        refs.scanCurrentTabBtn.addEventListener("click", () => {
            if (!activeTab) {
                return;
            }
            sendAction(Utils.ACTIONS.SCAN_TAB, { tabId: activeTab.id }).then(refreshView).catch(renderError);
        });

        refs.toggleMonitorBtn.addEventListener("click", () => {
            if (!activeTab) {
                return;
            }
            sendAction(Utils.ACTIONS.TOGGLE_MONITOR_TAB, { tabId: activeTab.id }).then(refreshView).catch(renderError);
        });

        refs.openReportBtn.addEventListener("click", () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
        });

        refs.saveMorningProjectionBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.SAVE_MORNING_PROJECTION).then(refreshView).catch(renderError);
        });

        refs.runEvValidationBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.RUN_EV_VALIDATION).then(refreshView).catch(renderError);
        });

        refs.openSettingsBtn.addEventListener("click", () => {
            chrome.runtime.openOptionsPage();
        });
    }

    async function refreshView() {
        const [state, tabs] = await Promise.all([
            Utils.loadState(),
            Utils.tabsQuery({ active: true, currentWindow: true })
        ]);

        activeTab = tabs[0] || null;
        const overall = state.overallSignal || Utils.createEmptyOverallSignal();
        const monitoredTabs = Object.values(state.monitoredTabs || {});
        const currentMonitored = activeTab ? state.monitoredTabs[activeTab.id] : null;
        const trendAnalysis = state.latestTrendAnalysis || Utils.createEmptyTrendAnalysis();
        const gapPrediction = state.latestGapPrediction || Utils.createEmptyGapPrediction();
        const tradePlan = state.latestTradePlan || Utils.createEmptyTradePlan();
        const keyLevels = resolveDisplayedLevels(state, activeTab);

        renderOverall(overall);
        refs.trend15Text.textContent = trendAnalysis.bias15m.signal;
        refs.trend15Meta.textContent = `${trendAnalysis.bias15m.confidence}% confidence`;
        refs.trend1hText.textContent = trendAnalysis.bias1h.signal;
        refs.trend1hMeta.textContent = `${trendAnalysis.bias1h.confidence}% confidence`;
        refs.gapPrimaryText.textContent = gapPrediction.primary;
        refs.gapMeta.textContent = `${gapPrediction.confidence}% confidence`;
        refs.tradeStatusText.textContent = tradePlan.status;
        refs.tradeMeta.textContent = `Direction ${tradePlan.direction} | ${tradePlan.entryType}`;
        refs.supportValueText.textContent = formatMaybeNumber(keyLevels.nearestSupport);
        refs.resistanceValueText.textContent = formatMaybeNumber(keyLevels.nearestResistance);
        renderLevelBadge(keyLevels, state, activeTab);
        refs.monitoredTabsCount.textContent = String(monitoredTabs.length);
        refs.currentTabStatus.textContent = currentMonitored ? "Monitoring" : "Not monitored";
        refs.currentTabMeta.textContent = activeTab
            ? `${activeTab.title || activeTab.url || "Current tab"} | ${currentMonitored && currentMonitored.lastScanAt ? `last scan ${Utils.formatRelativeTime(currentMonitored.lastScanAt)}` : "not scanned yet"}`
            : "No active tab detected.";
        refs.toggleMonitorBtn.textContent = currentMonitored ? "Stop Monitoring" : "Start Monitoring";
    }

    function renderOverall(overall) {
        const signalClass = normalizeSignalClass(overall.signal);
        refs.overallSignalBadge.textContent = overall.signal || "WAIT";
        refs.overallSignalBadge.className = `signal-badge ${signalClass}`;
        refs.overallSignalText.textContent = overall.signal || "WAIT";
        refs.confidenceValue.textContent = `${overall.confidence || 0}%`;
        refs.confidenceMeterBar.style.width = `${overall.confidence || 0}%`;
        refs.lastUpdateText.textContent = overall.updatedAt
            ? `Last update: ${Utils.formatDateTime(overall.updatedAt)}`
            : "No scans have completed yet.";
        refs.reasoningList.innerHTML = (overall.reasoning || []).slice(0, 3).map((item) => `<li class="summary-item">${escapeHtml(item)}</li>`).join("")
            || `<li class="summary-item">Wait: no usable monitored data is available yet.</li>`;
    }

    function normalizeSignalClass(signal) {
        const upper = String(signal || "WAIT").toUpperCase();
        if (upper === "BULLISH" || upper === "WEAK_BULLISH") {
            return "bullish";
        }
        if (upper === "BEARISH" || upper === "WEAK_BEARISH") {
            return "bearish";
        }
        return "neutral";
    }

    function resolveDisplayedLevels(state, activeTabRef) {
        if (activeTabRef && state.latestSnapshots && state.latestSnapshots[activeTabRef.id] && state.latestSnapshots[activeTabRef.id].supportResistance) {
            return state.latestSnapshots[activeTabRef.id].supportResistance;
        }
        return state.latestSupportResistance || Utils.createEmptySupportResistance();
    }

    function renderLevelBadge(levels, state, activeTabRef) {
        const snapshot = activeTabRef && state.latestSnapshots ? state.latestSnapshots[activeTabRef.id] : null;
        const spot = snapshot && snapshot.values ? snapshot.values.spotPrice : null;
        let text = "LEVELS WAITING";
        let className = "neutral";

        if (levels.breakout) {
            text = "BREAKOUT";
            className = "positive";
        } else if (levels.breakdown) {
            text = "BREAKDOWN";
            className = "negative";
        } else if (Number.isFinite(spot) && Number.isFinite(levels.nearestSupport) && isNearLevel(spot, levels.nearestSupport, state.settings.supportResistanceBufferPercent)) {
            text = "NEAR SUPPORT";
            className = "positive";
        } else if (Number.isFinite(spot) && Number.isFinite(levels.nearestResistance) && isNearLevel(spot, levels.nearestResistance, state.settings.supportResistanceBufferPercent)) {
            text = "NEAR RESISTANCE";
            className = "negative";
        } else if (Number.isFinite(levels.nearestSupport) || Number.isFinite(levels.nearestResistance)) {
            text = "LEVELS READY";
        }

        refs.levelStatusBadge.textContent = text;
        refs.levelStatusBadge.className = `tag ${className}`;
    }

    function sendAction(action, payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(Object.assign({ action: action }, payload || {}), (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response || !response.ok) {
                    reject(new Error(response && response.error ? response.error : "Unknown background error"));
                    return;
                }
                resolve(response.payload);
            });
        });
    }

    function renderError(error) {
        refs.currentTabMeta.textContent = error instanceof Error ? error.message : String(error);
    }

    function formatMaybeNumber(value) {
        return Number.isFinite(value) ? Utils.formatNumber(value, 2) : "--";
    }

    function isNearLevel(spot, level, bufferPercent) {
        if (!Number.isFinite(spot) || !Number.isFinite(level) || !Number.isFinite(bufferPercent) || spot === 0) {
            return false;
        }
        return Math.abs(((spot - level) / spot) * 100) <= bufferPercent;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
