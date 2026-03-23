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
        strikeSuggestionText: document.getElementById("strikeSuggestionText"),
        strikeSuggestionMeta: document.getElementById("strikeSuggestionMeta"),
        projectedValueText: document.getElementById("projectedValueText"),
        projectedValueMeta: document.getElementById("projectedValueMeta"),
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
        refs.trend15Text.textContent = Utils.formatSignalLabel(trendAnalysis.bias15m.signal);
        refs.trend15Meta.textContent = `${trendAnalysis.bias15m.confidence}% confidence`;
        refs.trend1hText.textContent = Utils.formatSignalLabel(trendAnalysis.bias1h.signal);
        refs.trend1hMeta.textContent = `${trendAnalysis.bias1h.confidence}% confidence`;
        refs.gapPrimaryText.textContent = Utils.formatGapLabel(gapPrediction.primary);
        refs.gapMeta.textContent = `${gapPrediction.confidence}% confidence`;
        refs.tradeStatusText.textContent = Utils.formatTradeStatusLabel(tradePlan.status);
        refs.tradeMeta.textContent = `${Utils.formatDirectionLabel(tradePlan.direction)} | ${formatEntryType(tradePlan.entryType)}`;
        renderContractSuggestion(tradePlan);
        renderProjectedValue(tradePlan);
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
        refs.overallSignalBadge.textContent = Utils.formatSignalLabel(overall.signal || "WAIT");
        refs.overallSignalBadge.className = `signal-badge ${signalClass}`;
        refs.overallSignalText.textContent = Utils.formatSignalLabel(overall.signal || "WAIT");
        refs.confidenceValue.textContent = `${overall.confidence || 0}%`;
        refs.confidenceMeterBar.style.width = `${overall.confidence || 0}%`;
        refs.lastUpdateText.textContent = overall.updatedAt
            ? `Last update: ${Utils.formatDateTime(overall.updatedAt)}`
            : "No scans have completed yet.";
        refs.reasoningList.innerHTML = (overall.reasoning || []).slice(0, 3).map((item) => `<li class="summary-item">${escapeHtml(Utils.humanizeAssistantText(item))}</li>`).join("")
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
        const proximity = resolveLevelProximity(spot, levels, state.settings.supportResistanceBufferPercent);

        if (levels.breakout) {
            text = "BREAKOUT";
            className = "positive";
        } else if (levels.breakdown) {
            text = "BREAKDOWN";
            className = "negative";
        } else if (proximity === "support") {
            text = "NEAR SUPPORT";
            className = "positive";
        } else if (proximity === "resistance") {
            text = "NEAR RESISTANCE";
            className = "negative";
        } else if (proximity === "compressed") {
            text = "RANGE MID";
        } else if (Number.isFinite(levels.nearestSupport) || Number.isFinite(levels.nearestResistance)) {
            text = "LEVELS READY";
        }

        refs.levelStatusBadge.textContent = text;
        refs.levelStatusBadge.className = `tag ${className}`;
    }

    function renderContractSuggestion(tradePlan) {
        const contract = tradePlan && tradePlan.suggestedContract ? tradePlan.suggestedContract : null;
        refs.strikeSuggestionText.textContent = contract && contract.symbol && contract.symbol !== "--"
            ? contract.symbol
            : "--";
        refs.strikeSuggestionMeta.textContent = contract
            ? `${contract.moneyness || "NONE"} | ${Utils.humanizeAssistantText(contract.note || "No contract suggestion yet.")}`
            : "No contract suggestion yet.";
    }

    function renderProjectedValue(tradePlan) {
        const projectedMove = tradePlan && tradePlan.projectedMove ? tradePlan.projectedMove : null;
        const primary = projectedMove && Number.isFinite(projectedMove.primaryValue)
            ? Utils.formatNumber(projectedMove.primaryValue, 2)
            : "--";
        refs.projectedValueText.textContent = primary;
        refs.projectedValueMeta.textContent = projectedMove
            ? buildProjectedMeta(projectedMove)
            : "Projected spot path is not ready yet.";
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

    function formatEntryType(value) {
        return String(value || "NONE").replace(/_/g, " ");
    }

    function buildProjectedMeta(projectedMove) {
        const stretch = Number.isFinite(projectedMove.stretchValue)
            ? `Stretch ${Utils.formatNumber(projectedMove.stretchValue, 2)}`
            : "No stretch target";
        const points = Number.isFinite(projectedMove.expectedPoints)
            ? `${projectedMove.expectedPoints > 0 ? "+" : ""}${Utils.formatNumber(projectedMove.expectedPoints, 2)} pts`
            : "No point estimate";
        return `${points} | ${stretch}`;
    }

    function isNearLevel(spot, level, bufferPercent) {
        if (!Number.isFinite(spot) || !Number.isFinite(level) || !Number.isFinite(bufferPercent) || spot === 0) {
            return false;
        }
        return Math.abs(((spot - level) / spot) * 100) <= bufferPercent;
    }

    function resolveLevelProximity(spot, levels, bufferPercent) {
        const support = levels ? levels.nearestSupport : null;
        const resistance = levels ? levels.nearestResistance : null;
        const nearSupport = Number.isFinite(support) && isNearLevel(spot, support, bufferPercent);
        const nearResistance = Number.isFinite(resistance) && isNearLevel(spot, resistance, bufferPercent);

        if (nearSupport && nearResistance) {
            const supportDistance = Math.abs(spot - support);
            const resistanceDistance = Math.abs(resistance - spot);
            if (supportDistance + 1 < resistanceDistance) {
                return "support";
            }
            if (resistanceDistance + 1 < supportDistance) {
                return "resistance";
            }
            return "compressed";
        }

        if (nearSupport) {
            return "support";
        }
        if (nearResistance) {
            return "resistance";
        }
        return "none";
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
