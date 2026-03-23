(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;

    const refs = {
        overallSignalBadge: document.getElementById("overallSignalBadge"),
        overallSignalText: document.getElementById("overallSignalText"),
        confidenceValue: document.getElementById("confidenceValue"),
        confidenceMeterBar: document.getElementById("confidenceMeterBar"),
        recommendedStance: document.getElementById("recommendedStance"),
        reportMeta: document.getElementById("reportMeta"),
        reasoningList: document.getElementById("reasoningList"),
        riskList: document.getElementById("riskList"),
        siteSummaryList: document.getElementById("siteSummaryList"),
        alertHistoryList: document.getElementById("alertHistoryList"),
        tabTableBody: document.getElementById("tabTableBody"),
        signalHistoryList: document.getElementById("signalHistoryList"),
        chartReadyData: document.getElementById("chartReadyData"),
        refreshAllBtn: document.getElementById("refreshAllBtn"),
        saveMorningProjectionBtn: document.getElementById("saveMorningProjectionBtn"),
        runEvValidationBtn: document.getElementById("runEvValidationBtn"),
        clearHistoryBtn: document.getElementById("clearHistoryBtn"),
        exportJsonBtn: document.getElementById("exportJsonBtn"),
        trend15Signal: document.getElementById("trend15Signal"),
        trend15Confidence: document.getElementById("trend15Confidence"),
        trend15Reasoning: document.getElementById("trend15Reasoning"),
        trend1hSignal: document.getElementById("trend1hSignal"),
        trend1hConfidence: document.getElementById("trend1hConfidence"),
        trend1hReasoning: document.getElementById("trend1hReasoning"),
        alignmentStatus: document.getElementById("alignmentStatus"),
        alignmentNotes: document.getElementById("alignmentNotes"),
        gapPrimary: document.getElementById("gapPrimary"),
        gapConfidence: document.getElementById("gapConfidence"),
        gapProbabilities: document.getElementById("gapProbabilities"),
        gapReasoning: document.getElementById("gapReasoning"),
        gapWarnings: document.getElementById("gapWarnings"),
        keySupportValue: document.getElementById("keySupportValue"),
        keyResistanceValue: document.getElementById("keyResistanceValue"),
        keyBreakoutValue: document.getElementById("keyBreakoutValue"),
        keyBreakdownValue: document.getElementById("keyBreakdownValue"),
        keySupportStrength: document.getElementById("keySupportStrength"),
        keyResistanceStrength: document.getElementById("keyResistanceStrength"),
        keyLevelsReasoning: document.getElementById("keyLevelsReasoning"),
        structureTrendValue: document.getElementById("structureTrendValue"),
        structurePatternValue: document.getElementById("structurePatternValue"),
        structureZoneValue: document.getElementById("structureZoneValue"),
        structureMomentumValue: document.getElementById("structureMomentumValue"),
        structureExhaustionValue: document.getElementById("structureExhaustionValue"),
        structureActionValue: document.getElementById("structureActionValue"),
        structureActionReason: document.getElementById("structureActionReason"),
        structureReasoning: document.getElementById("structureReasoning"),
        tradeStatus: document.getElementById("tradeStatus"),
        tradeDirection: document.getElementById("tradeDirection"),
        tradeQuality: document.getElementById("tradeQuality"),
        tradeEntryType: document.getElementById("tradeEntryType"),
        tradeEntryZone: document.getElementById("tradeEntryZone"),
        tradeStopLoss: document.getElementById("tradeStopLoss"),
        tradeTarget1: document.getElementById("tradeTarget1"),
        tradeTarget2: document.getElementById("tradeTarget2"),
        tradeRiskReward: document.getElementById("tradeRiskReward"),
        tradeSuggestedContract: document.getElementById("tradeSuggestedContract"),
        tradeProjectedValue: document.getElementById("tradeProjectedValue"),
        tradeStretchValue: document.getElementById("tradeStretchValue"),
        tradeInvalidation: document.getElementById("tradeInvalidation"),
        tradeReasoning: document.getElementById("tradeReasoning"),
        tradeWarnings: document.getElementById("tradeWarnings"),
        mpDate: document.getElementById("mpDate"),
        mpSignal: document.getElementById("mpSignal"),
        mpGap: document.getElementById("mpGap"),
        mpConfidence: document.getElementById("mpConfidence"),
        mpReasoning: document.getElementById("mpReasoning"),
        accuracyMetricsList: document.getElementById("accuracyMetricsList"),
        evTableBody: document.getElementById("evTableBody")
    };

    init().catch(renderError);

    function init() {
        bindEvents();
        chrome.storage.onChanged.addListener(() => {
            refreshView().catch(renderError);
        });
        return refreshView();
    }

    function bindEvents() {
        refs.refreshAllBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.SCAN_ALL_MONITORED_TABS).then(refreshView).catch(renderError);
        });

        refs.saveMorningProjectionBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.SAVE_MORNING_PROJECTION).then(refreshView).catch(renderError);
        });

        refs.runEvValidationBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.RUN_EV_VALIDATION).then(refreshView).catch(renderError);
        });

        refs.clearHistoryBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.CLEAR_HISTORY).then(refreshView).catch(renderError);
        });

        refs.exportJsonBtn.addEventListener("click", async () => {
            const state = await Utils.loadState();
            Utils.downloadJson("options-trading-assistant-report.json", state);
        });
    }

    async function refreshView() {
        const state = await Utils.loadState();
        const overall = state.overallSignal || Utils.createEmptyOverallSignal();
        const monitoredTabs = Object.values(state.monitoredTabs || {});
        const tabRows = buildTabRows(state);
        const trendAnalysis = state.latestTrendAnalysis || Utils.createEmptyTrendAnalysis();
        const gapPrediction = state.latestGapPrediction || Utils.createEmptyGapPrediction();
        const keyLevels = state.latestSupportResistance || Utils.createEmptySupportResistance();
        const structureAnalysis = state.latestStructureAnalysis || Utils.createEmptyStructureAnalysis();
        const tradePlan = state.latestTradePlan || Utils.createEmptyTradePlan();
        const todayProjection = getTodayProjection(state.mpHistory || [], overall.updatedAt);

        refs.reportMeta.textContent = overall.updatedAt
            ? `Last overall update: ${Utils.formatDateTime(overall.updatedAt)} | ${monitoredTabs.length} monitored tabs`
            : "No scans have completed yet.";

        renderOverall(overall);
        renderTrend(trendAnalysis);
        renderGap(gapPrediction);
        renderKeyLevels(keyLevels);
        renderStructure(structureAnalysis);
        renderTrade(tradePlan);
        renderMorningProjection(todayProjection);
        renderAccuracyMetrics(state.accuracyMetrics || Utils.createEmptyAccuracyMetrics());
        renderEvHistory(state.mpHistory || [], state.evHistory || []);
        renderList(refs.reasoningList, overall.reasoning, "No reasoning available yet.");
        renderList(refs.riskList, overall.riskFlags, "No risk flags are active yet.");
        renderSiteSummary(monitoredTabs);
        renderAlertHistory(state.alertHistory || []);
        renderTabTable(tabRows);
        renderSignalHistory(state.signalHistory || []);
        renderChartData(state.signalHistory || []);
    }

    function renderOverall(overall) {
        const signalClass = normalizeSignalClass(overall.signal);
        refs.overallSignalBadge.textContent = Utils.formatSignalLabel(overall.signal || "WAIT");
        refs.overallSignalBadge.className = `signal-badge ${signalClass}`;
        refs.overallSignalText.textContent = Utils.formatSignalLabel(overall.signal || "WAIT");
        refs.confidenceValue.textContent = `${overall.confidence || 0}%`;
        refs.confidenceMeterBar.style.width = `${overall.confidence || 0}%`;
        refs.recommendedStance.textContent = Utils.humanizeAssistantText(overall.recommendedStance || "Wait for confirmation.");
    }

    function renderTrend(trendAnalysis) {
        refs.trend15Signal.textContent = Utils.formatSignalLabel(trendAnalysis.bias15m.signal);
        refs.trend15Confidence.textContent = `${trendAnalysis.bias15m.confidence}% confidence`;
        refs.trend1hSignal.textContent = Utils.formatSignalLabel(trendAnalysis.bias1h.signal);
        refs.trend1hConfidence.textContent = `${trendAnalysis.bias1h.confidence}% confidence`;
        refs.alignmentStatus.textContent = Utils.formatAlignmentLabel(trendAnalysis.alignment.status);

        renderList(refs.trend15Reasoning, trendAnalysis.bias15m.reasoning, "No 15-minute trend reasoning yet.");
        renderList(refs.trend1hReasoning, trendAnalysis.bias1h.reasoning, "No 1-hour trend reasoning yet.");
        renderList(refs.alignmentNotes, trendAnalysis.alignment.notes, "Alignment notes are not available yet.");
    }

    function renderGap(gapPrediction) {
        refs.gapPrimary.textContent = Utils.formatGapLabel(gapPrediction.primary);
        refs.gapConfidence.textContent = `${gapPrediction.confidence}% confidence`;
        refs.gapProbabilities.textContent = `Gap Up ${gapPrediction.probabilities.gapUp}% | Gap Down ${gapPrediction.probabilities.gapDown}% | Flat Open ${gapPrediction.probabilities.flatOpen}%`;
        renderList(refs.gapReasoning, gapPrediction.reasoning, "Gap prediction is not available yet.");
        renderList(refs.gapWarnings, gapPrediction.warnings, "No gap warnings are active.");
    }

    function renderKeyLevels(levels) {
        refs.keySupportValue.textContent = formatMaybeNumber(levels.nearestSupport);
        refs.keyResistanceValue.textContent = formatMaybeNumber(levels.nearestResistance);
        refs.keyBreakoutValue.textContent = formatBoolean(levels.breakout);
        refs.keyBreakdownValue.textContent = formatBoolean(levels.breakdown);
        refs.keySupportStrength.textContent = (levels.strength && levels.strength.support) || "WEAK";
        refs.keyResistanceStrength.textContent = (levels.strength && levels.strength.resistance) || "WEAK";
        renderList(refs.keyLevelsReasoning, levels.reasoning, "Key levels will appear after enough price history is collected.");
    }

    function renderStructure(structureAnalysis) {
        refs.structureTrendValue.textContent = structureAnalysis.trend || "SIDEWAYS";
        refs.structurePatternValue.textContent = structureAnalysis.structure || "MIXED";
        refs.structureZoneValue.textContent = structureAnalysis.zone || "MID";
        refs.structureMomentumValue.textContent = structureAnalysis.momentum || "NONE";
        refs.structureExhaustionValue.textContent = formatBoolean(structureAnalysis.exhaustion);
        refs.structureActionValue.textContent = structureAnalysis.tradeSuggestion && structureAnalysis.tradeSuggestion.action
            ? structureAnalysis.tradeSuggestion.action
            : "WAIT";
        refs.structureActionReason.textContent = structureAnalysis.tradeSuggestion && structureAnalysis.tradeSuggestion.reason
            ? structureAnalysis.tradeSuggestion.reason
            : "Structure analysis needs more price history.";
        renderList(refs.structureReasoning, structureAnalysis.reasoning, "Structure analysis will appear after enough price history is collected.");
    }

    function renderTrade(tradePlan) {
        refs.tradeStatus.textContent = Utils.formatTradeStatusLabel(tradePlan.status);
        refs.tradeDirection.textContent = Utils.formatDirectionLabel(tradePlan.direction);
        refs.tradeQuality.textContent = tradePlan.setupQuality;
        refs.tradeEntryType.textContent = formatEntryType(tradePlan.entryType);
        refs.tradeEntryZone.textContent = formatRange(tradePlan.entryZone);
        refs.tradeStopLoss.textContent = formatStopLoss(tradePlan.stopLoss);
        refs.tradeTarget1.textContent = formatTarget(tradePlan.targets[0]);
        refs.tradeTarget2.textContent = formatTarget(tradePlan.targets[1]);
        refs.tradeRiskReward.textContent = tradePlan.riskReward || "N/A";
        refs.tradeSuggestedContract.textContent = formatSuggestedContract(tradePlan.suggestedContract);
        refs.tradeProjectedValue.textContent = formatProjectedValue(tradePlan.projectedMove && tradePlan.projectedMove.primaryValue);
        refs.tradeStretchValue.textContent = formatProjectedValue(tradePlan.projectedMove && tradePlan.projectedMove.stretchValue);
        refs.tradeInvalidation.textContent = Utils.humanizeAssistantText(tradePlan.invalidation || "Wait for a cleaner setup.");

        renderList(refs.tradeReasoning, tradePlan.reasoning, "Trade plan is not ready yet.");
        renderList(refs.tradeWarnings, tradePlan.warnings, "No trade warnings are active.");
    }

    function renderMorningProjection(todayProjection) {
        if (!todayProjection) {
            refs.mpDate.textContent = "No projection";
            refs.mpSignal.textContent = "Signal: --";
            refs.mpGap.textContent = "Gap: --";
            refs.mpConfidence.textContent = "Confidence: --";
            renderList(refs.mpReasoning, [], "Save a morning projection to start the feedback loop.");
            return;
        }

        refs.mpDate.textContent = todayProjection.dateKey;
        refs.mpSignal.textContent = `Signal: ${Utils.formatSignalLabel(todayProjection.mp.projectedSignal)}`;
        refs.mpGap.textContent = `Gap: ${Utils.formatGapLabel(todayProjection.mp.projectedGap)}`;
        refs.mpConfidence.textContent = `Confidence: ${todayProjection.mp.confidence}%`;
        renderList(refs.mpReasoning, todayProjection.mp.reasoning, "No projection reasoning stored.");
    }

    function renderAccuracyMetrics(metrics) {
        const items = [
            `Total projections: ${metrics.totalProjections || 0}`,
            `Hit rate: ${metrics.hitRate || 0}%`,
            `Partial hit rate: ${metrics.partialHitRate || 0}%`,
            `Gap accuracy: ${metrics.gapAccuracy || 0}%`,
            `Average confidence: ${metrics.averageConfidence || 0}%`,
            `Confidence vs accuracy correlation: ${metrics.confidenceAccuracyCorrelation || 0}`
        ];
        refs.accuracyMetricsList.innerHTML = items.map((item) => `<li class="summary-item">${escapeHtml(item)}</li>`).join("");
    }

    function renderEvHistory(mpHistory, evHistory) {
        if (!evHistory.length) {
            refs.evTableBody.innerHTML = `<tr><td colspan="7">No EV validation history has been stored yet.</td></tr>`;
            return;
        }

        const mpMap = {};
        mpHistory.forEach((entry) => {
            mpMap[entry.dateKey] = entry;
        });

        refs.evTableBody.innerHTML = evHistory.slice().reverse().slice(0, 10).map((entry) => {
            const projection = mpMap[entry.dateKey];
            return `
                <tr>
                    <td>${escapeHtml(entry.dateKey)}</td>
                    <td>${escapeHtml(Utils.formatSignalLabel(projection && projection.mp ? projection.mp.projectedSignal : "--"))}</td>
                    <td>${escapeHtml(entry.ev.actualDirection || "--")}</td>
                    <td>${escapeHtml(Utils.formatGapLabel(projection && projection.mp ? projection.mp.projectedGap : "--"))}</td>
                    <td>${escapeHtml(entry.ev.actualGap || "--")}</td>
                    <td><span class="tag ${normalizeOutcomeClass(entry.ev.predictionResult)}">${escapeHtml(entry.ev.predictionResult || "--")}</span></td>
                    <td>${escapeHtml(String(entry.ev.validationScore || 0))}</td>
                </tr>
            `;
        }).join("");
    }

    function renderSiteSummary(monitoredTabs) {
        if (!monitoredTabs.length) {
            refs.siteSummaryList.innerHTML = `<li class="summary-item">No tabs are being monitored yet.</li>`;
            return;
        }

        const counts = {};
        monitoredTabs.forEach((tab) => {
            counts[tab.siteType] = (counts[tab.siteType] || 0) + 1;
        });

        refs.siteSummaryList.innerHTML = Object.keys(counts).map((key) => {
            return `<li class="summary-item">${escapeHtml(key)}: ${counts[key]} tab(s)</li>`;
        }).join("");
    }

    function renderAlertHistory(alertHistory) {
        if (!alertHistory.length) {
            refs.alertHistoryList.innerHTML = `<li class="summary-item">No alerts have been emitted yet.</li>`;
            return;
        }

        refs.alertHistoryList.innerHTML = alertHistory.slice().reverse().slice(0, 10).map((alert) => `
            <li class="summary-item">
                <strong>${escapeHtml(alert.title)}</strong><br>
                <span class="muted">${escapeHtml(alert.message)}</span><br>
                <span class="muted">${escapeHtml(Utils.formatDateTime(alert.timestamp))}</span>
            </li>
        `).join("");
    }

    function renderTabTable(rows) {
        if (!rows.length) {
            refs.tabTableBody.innerHTML = `<tr><td colspan="10">No tab snapshots available yet.</td></tr>`;
            return;
        }

        refs.tabTableBody.innerHTML = rows.map((row) => `
            <tr>
                <td>
                    <strong>${escapeHtml(row.instrument)}</strong><br>
                    <span class="muted">${escapeHtml(row.pageTitle || "Untitled tab")}</span>
                </td>
                <td>${escapeHtml(row.siteType)}</td>
                <td><span class="tag ${normalizeTagClass(row.signal)}">${escapeHtml(Utils.formatSignalLabel(row.signal))}</span></td>
                <td>${row.confidence}%</td>
                <td>${formatMaybeNumber(row.values.spotPrice)}</td>
                <td>${formatMaybeNumber(row.values.pcr)}</td>
                <td>${formatMaybeNumber(row.values.vix)}</td>
                <td>${formatMaybeNumber(row.values.vwap)}</td>
                <td>${formatMaybeNumber(row.values.support)} / ${formatMaybeNumber(row.values.resistance)}</td>
                <td>${escapeHtml(Utils.formatDateTime(row.timestamp))}</td>
            </tr>
        `).join("");
    }

    function renderSignalHistory(signalHistory) {
        if (!signalHistory.length) {
            refs.signalHistoryList.innerHTML = `<li class="summary-item">No signal history has been stored yet.</li>`;
            return;
        }

        refs.signalHistoryList.innerHTML = signalHistory.slice().reverse().slice(0, 12).map((entry) => `
            <li class="summary-item">
                <strong>${escapeHtml(Utils.formatSignalLabel(entry.signal))}</strong> with ${entry.confidence}% confidence<br>
                <span class="muted">${escapeHtml(Utils.formatDateTime(entry.timestamp))} | ${entry.tabCount || 0} tab(s)</span>
            </li>
        `).join("");
    }

    function renderChartData(signalHistory) {
        const chartReady = signalHistory.slice(-20).map((entry) => ({
            timestamp: entry.timestamp,
            signal: entry.signal,
            confidence: entry.confidence,
            score: entry.score,
            strength: entry.strength || "WEAK"
        }));
        refs.chartReadyData.textContent = JSON.stringify(chartReady, null, 2);
    }

    function renderList(container, items, emptyText) {
        const list = Array.isArray(items) && items.length ? items : [emptyText];
        container.innerHTML = list.map((item) => `<li class="summary-item">${escapeHtml(Utils.humanizeAssistantText(item))}</li>`).join("");
    }

    function buildTabRows(state) {
        const evaluations = state.latestEvaluations || {};
        const snapshots = state.latestSnapshots || {};

        return Object.keys(snapshots).map((tabId) => {
            const snapshot = snapshots[tabId];
            const evaluation = evaluations[tabId] || {};
            return {
                tabId: tabId,
                instrument: snapshot.instrument || "UNKNOWN",
                pageTitle: snapshot.pageTitle || "",
                siteType: snapshot.siteType || "generic",
                signal: evaluation.signal || "WAIT",
                confidence: evaluation.confidence || 0,
                timestamp: snapshot.timestamp,
                values: snapshot.values || Utils.createEmptyValues()
            };
        });
    }

    function getTodayProjection(mpHistory, timestamp) {
        const dateKey = Utils.toDateKey(timestamp || new Date().toISOString());
        return (mpHistory || []).find((entry) => entry.dateKey === dateKey) || null;
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

    function normalizeTagClass(signal) {
        const upper = String(signal || "WAIT").toUpperCase();
        if (upper === "BULLISH" || upper === "WEAK_BULLISH") {
            return "positive";
        }
        if (upper === "BEARISH" || upper === "WEAK_BEARISH") {
            return "negative";
        }
        return "neutral";
    }

    function normalizeOutcomeClass(outcome) {
        const upper = String(outcome || "").toUpperCase();
        if (upper === "HIT") {
            return "positive";
        }
        if (upper === "MISS") {
            return "negative";
        }
        return "neutral";
    }

    function formatMaybeNumber(value) {
        return Number.isFinite(value) ? Utils.formatNumber(value, 2) : "--";
    }

    function formatRange(entryZone) {
        if (!entryZone || (!Number.isFinite(entryZone.min) && !Number.isFinite(entryZone.max))) {
            return "--";
        }
        if (Number.isFinite(entryZone.min) && Number.isFinite(entryZone.max)) {
            return `${Utils.formatNumber(entryZone.min, 2)} - ${Utils.formatNumber(entryZone.max, 2)}`;
        }
        return Number.isFinite(entryZone.min)
            ? Utils.formatNumber(entryZone.min, 2)
            : Utils.formatNumber(entryZone.max, 2);
    }

    function formatEntryType(value) {
        return String(value || "NONE").replace(/_/g, " ");
    }

    function formatStopLoss(stopLoss) {
        if (!stopLoss || !Number.isFinite(stopLoss.value)) {
            return "--";
        }
        return `${Utils.formatNumber(stopLoss.value, 2)} (${stopLoss.type})`;
    }

    function formatSuggestedContract(contract) {
        if (!contract || !contract.symbol || contract.symbol === "--") {
            return "--";
        }
        return `${contract.symbol} (${contract.moneyness || "ATM"})`;
    }

    function formatProjectedValue(value) {
        return Number.isFinite(value) ? Utils.formatNumber(value, 2) : "--";
    }

    function formatTarget(target) {
        if (!target || !Number.isFinite(target.value)) {
            return "--";
        }
        return `${Utils.formatNumber(target.value, 2)} (${target.label})`;
    }

    function formatBoolean(value) {
        return value ? "YES" : "NO";
    }

    function renderError(error) {
        refs.reportMeta.textContent = error instanceof Error ? error.message : String(error);
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
