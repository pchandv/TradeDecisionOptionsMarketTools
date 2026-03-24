(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;
    const ProfileEngine = window.OptionsProfileEngine;

    const refs = {
        overallSignalBadge: document.getElementById("overallSignalBadge"),
        profileBadge: document.getElementById("profileBadge"),
        switchProfileBtn: document.getElementById("switchProfileBtn"),
        selectedInstrumentSelect: document.getElementById("selectedInstrumentSelect"),
        finalActionText: document.getElementById("finalActionText"),
        trafficLightBadge: document.getElementById("trafficLightBadge"),
        confidenceBandText: document.getElementById("confidenceBandText"),
        beginnerSummaryText: document.getElementById("beginnerSummaryText"),
        executionLogicText: document.getElementById("executionLogicText"),
        beginnerSupportText: document.getElementById("beginnerSupportText"),
        beginnerResistanceText: document.getElementById("beginnerResistanceText"),
        instrumentDisplayText: document.getElementById("instrumentDisplayText"),
        optionSymbolText: document.getElementById("optionSymbolText"),
        optionPremiumSourceText: document.getElementById("optionPremiumSourceText"),
        optionSetupQualityText: document.getElementById("optionSetupQualityText"),
        optionEntryText: document.getElementById("optionEntryText"),
        optionStopLossText: document.getElementById("optionStopLossText"),
        optionTargetText: document.getElementById("optionTargetText"),
        optionRrText: document.getElementById("optionRrText"),
        optionEngineMessageText: document.getElementById("optionEngineMessageText"),
        optionActionNoteText: document.getElementById("optionActionNoteText"),
        newsSentimentText: document.getElementById("newsSentimentText"),
        newsSummaryText: document.getElementById("newsSummaryText"),
        newsTopList: document.getElementById("newsTopList"),
        tomorrowBiasText: document.getElementById("tomorrowBiasText"),
        tomorrowGapText: document.getElementById("tomorrowGapText"),
        tomorrowConfidenceText: document.getElementById("tomorrowConfidenceText"),
        tomorrowOpenPlanText: document.getElementById("tomorrowOpenPlanText"),
        tomorrowHoldAdviceText: document.getElementById("tomorrowHoldAdviceText"),
        aiBridgeStateText: document.getElementById("aiBridgeStateText"),
        aiBridgeStatusText: document.getElementById("aiBridgeStatusText"),
        aiBridgeTradeSuggestionText: document.getElementById("aiBridgeTradeSuggestionText"),
        runAiAnalysisBtn: document.getElementById("runAiAnalysisBtn"),
        openAiReportBtn: document.getElementById("openAiReportBtn"),
        refreshNewsBtn: document.getElementById("refreshNewsBtn"),
        generateTomorrowViewBtn: document.getElementById("generateTomorrowViewBtn"),
        professionalSection: document.getElementById("professionalSection"),
        overallSignalText: document.getElementById("overallSignalText"),
        confidenceValue: document.getElementById("confidenceValue"),
        confidenceMeterBar: document.getElementById("confidenceMeterBar"),
        lastUpdateText: document.getElementById("lastUpdateText"),
        reasoningList: document.getElementById("reasoningList"),
        riskList: document.getElementById("riskList"),
        trend15Text: document.getElementById("trend15Text"),
        trend15Meta: document.getElementById("trend15Meta"),
        trend1hText: document.getElementById("trend1hText"),
        trend1hMeta: document.getElementById("trend1hMeta"),
        gapPrimaryText: document.getElementById("gapPrimaryText"),
        gapMeta: document.getElementById("gapMeta"),
        alignmentText: document.getElementById("alignmentText"),
        alignmentMeta: document.getElementById("alignmentMeta"),
        tradeStatusText: document.getElementById("tradeStatusText"),
        tradeMeta: document.getElementById("tradeMeta"),
        strikeSuggestionText: document.getElementById("strikeSuggestionText"),
        strikeSuggestionMeta: document.getElementById("strikeSuggestionMeta"),
        projectedValueText: document.getElementById("projectedValueText"),
        projectedValueMeta: document.getElementById("projectedValueMeta"),
        supportValueText: document.getElementById("supportValueText"),
        resistanceValueText: document.getElementById("resistanceValueText"),
        levelStatusBadge: document.getElementById("levelStatusBadge"),
        structureActionText: document.getElementById("structureActionText"),
        proPremiumContractText: document.getElementById("proPremiumContractText"),
        proPremiumSourceText: document.getElementById("proPremiumSourceText"),
        proPremiumCurrentText: document.getElementById("proPremiumCurrentText"),
        proPremiumEntryText: document.getElementById("proPremiumEntryText"),
        proPremiumStopText: document.getElementById("proPremiumStopText"),
        proPremiumTargetsText: document.getElementById("proPremiumTargetsText"),
        proPremiumRrText: document.getElementById("proPremiumRrText"),
        proPremiumWarningsList: document.getElementById("proPremiumWarningsList"),
        proPremiumReasoningList: document.getElementById("proPremiumReasoningList"),
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
        refs.switchProfileBtn.addEventListener("click", async () => {
            const state = await Utils.loadState();
            const currentProfile = ProfileEngine.getActiveProfile(state);
            const nextProfile = currentProfile === Utils.USER_PROFILES.BEGINNER
                ? Utils.USER_PROFILES.PROFESSIONAL
                : Utils.USER_PROFILES.BEGINNER;
            await Utils.setUserProfile(nextProfile);
        });

        refs.selectedInstrumentSelect.addEventListener("change", () => {
            sendAction(Utils.ACTIONS.SET_SELECTED_INSTRUMENT, {
                instrument: refs.selectedInstrumentSelect.value
            }).then(refreshView).catch(renderError);
        });

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

        refs.refreshNewsBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.REFRESH_NEWS).then(refreshView).catch(renderError);
        });

        refs.generateTomorrowViewBtn.addEventListener("click", () => {
            sendAction(Utils.ACTIONS.GENERATE_TOMORROW_VIEW).then(refreshView).catch(renderError);
        });

        refs.runAiAnalysisBtn.addEventListener("click", () => {
            refs.runAiAnalysisBtn.disabled = true;
            refs.runAiAnalysisBtn.textContent = "Waiting for response...";
            sendAction(Utils.ACTIONS.RUN_AI_ANALYSIS)
                .then(refreshView)
                .catch(renderError)
                .finally(() => {
                    refs.runAiAnalysisBtn.disabled = false;
                    refs.runAiAnalysisBtn.textContent = "Run AI Analysis";
                });
        });

        refs.openAiReportBtn.addEventListener("click", () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("ai-report.html") });
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

        const activeProfile = ProfileEngine.getActiveProfile(state);
        const beginnerSnapshot = ProfileEngine.buildBeginnerSnapshot(state);
        const overall = state.overallSignal || Utils.createEmptyOverallSignal();
        const trendAnalysis = state.latestTrendAnalysis || Utils.createEmptyTrendAnalysis();
        const gapPrediction = state.latestGapPrediction || Utils.createEmptyGapPrediction();
        const tradePlan = state.latestTradePlan || Utils.createEmptyTradePlan();
        const premiumPlan = normalizePremiumPlan(tradePlan);
        const keyLevels = resolveDisplayedLevels(state, activeTab);
        const currentMonitored = activeTab ? state.monitoredTabs[activeTab.id] : null;
        const selectedInstrument = state.selectedInstrument || "NIFTY";

        refs.selectedInstrumentSelect.value = selectedInstrument;
        renderHeader(activeProfile, overall);
        renderBeginner(beginnerSnapshot);
        renderOptionSuggestion(selectedInstrument, premiumPlan);
        renderNews(state.latestNewsSentiment || Utils.createEmptyNewsSentiment());
        renderTomorrow(state.latestTomorrowPrediction || Utils.createEmptyTomorrowPrediction());
        renderAIBridge(state.aiAnalysis || Utils.createEmptyAIAnalysis());
        renderProfessional(activeProfile, overall, trendAnalysis, gapPrediction, tradePlan, keyLevels, state.latestStructureAnalysis || Utils.createEmptyStructureAnalysis(), premiumPlan);
        renderCurrentTab(state, currentMonitored);
    }

    function renderHeader(activeProfile, overall) {
        const signalClass = normalizeSignalClass(overall.signal);
        refs.overallSignalBadge.textContent = Utils.formatSignalLabel(overall.signal || "WAIT");
        refs.overallSignalBadge.className = `signal-badge ${signalClass}`;
        refs.profileBadge.textContent = activeProfile;
        refs.profileBadge.className = `tag ${activeProfile === Utils.USER_PROFILES.PROFESSIONAL ? "positive" : "neutral"}`;
        refs.switchProfileBtn.textContent = activeProfile === Utils.USER_PROFILES.BEGINNER
            ? "Switch to Professional Mode"
            : "Switch to Beginner Mode";
        refs.professionalSection.classList.toggle("is-hidden", activeProfile !== Utils.USER_PROFILES.PROFESSIONAL);
    }

    function renderBeginner(snapshot) {
        refs.finalActionText.textContent = snapshot.finalAction;
        refs.trafficLightBadge.textContent = `${snapshot.trafficLight.icon} ${snapshot.trafficLight.label}`;
        refs.trafficLightBadge.className = `traffic-light ${snapshot.trafficLight.color}`;
        refs.confidenceBandText.textContent = snapshot.confidenceBand.display;
        refs.confidenceBandText.className = `confidence-chip ${snapshot.confidenceBand.className}`;
        refs.beginnerSummaryText.textContent = snapshot.summary;
        refs.executionLogicText.textContent = snapshot.executionLogic;
        refs.beginnerSupportText.textContent = formatMaybeNumber(snapshot.quickLevels.support);
        refs.beginnerResistanceText.textContent = formatMaybeNumber(snapshot.quickLevels.resistance);
    }

    function renderNews(news) {
        refs.newsSentimentText.textContent = news.sentiment || "NEUTRAL";
        refs.newsSummaryText.textContent = news.summary || "No major news detected.";
        renderList(
            refs.newsTopList,
            (news.topNews || []).map((item) => `${item.sentiment}/${item.impact || "LOW"}: ${item.title} (${item.source})`),
            "No major news detected."
        );
    }

    function renderTomorrow(tomorrowState) {
        const predictionState = tomorrowState || Utils.createEmptyTomorrowPrediction();
        const prediction = predictionState.tomorrowPrediction || Utils.createEmptyTomorrowPrediction().tomorrowPrediction;
        refs.tomorrowBiasText.textContent = prediction.bias || "SIDEWAYS";
        refs.tomorrowGapText.textContent = prediction.gapExpectation || "FLAT";
        refs.tomorrowConfidenceText.textContent = `${prediction.confidence || 0}%`;
        refs.tomorrowOpenPlanText.textContent = prediction.strategy && prediction.strategy.openPlan
            ? prediction.strategy.openPlan
            : "Generate tomorrow view after market close or from the manual button.";
        refs.tomorrowHoldAdviceText.textContent = `CE: ${(prediction.holdAdvice && prediction.holdAdvice.CE) || "AVOID"} | PE: ${(prediction.holdAdvice && prediction.holdAdvice.PE) || "AVOID"}`;
    }

    function renderAIBridge(aiAnalysis) {
        const state = String(aiAnalysis.state || "IDLE").toUpperCase();
        refs.aiBridgeStateText.textContent = state;
        refs.aiBridgeStateText.className = `metric-value ${resolveAiStateClass(state)}`;
        refs.aiBridgeStatusText.textContent = aiAnalysis.statusText || "AI not available";
        refs.aiBridgeTradeSuggestionText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.tradeSuggestion
            ? aiAnalysis.parsed.tradeSuggestion
            : "WAIT";
    }

    function renderOptionSuggestion(instrument, premiumPlan) {
        const plan = premiumPlan || Utils.createEmptyPremiumTradePlan();
        const contract = plan.contract || {};
        const pricing = plan.pricing || {};
        const entryZone = pricing.entryZone || {};
        const stopLoss = pricing.stopLoss || {};
        const targets = Array.isArray(pricing.targets) ? pricing.targets : [];
        const t1 = targets[0] && Number.isFinite(targets[0].value) ? targets[0].value : null;
        const t2 = targets[1] && Number.isFinite(targets[1].value) ? targets[1].value : null;
        refs.instrumentDisplayText.textContent = instrument || "NIFTY";
        refs.optionSymbolText.textContent = plan && plan.symbol ? plan.symbol : "--";
        refs.optionEntryText.textContent = plan && plan.entryPriceRange && plan.entryPriceRange.text
            ? plan.entryPriceRange.text
            : "--";
        refs.optionStopLossText.textContent = plan && Number.isFinite(plan.stopLoss)
            ? `₹${Utils.formatNumber(plan.stopLoss, 2)}`
            : "--";
        refs.optionTargetText.textContent = plan && Array.isArray(plan.targets) && plan.targets.length
            ? plan.targets.filter(Number.isFinite).map((target) => `₹${Utils.formatNumber(target, 2)}`).join(" / ")
            : "--";
        refs.optionEngineMessageText.textContent = plan && plan.message
            ? plan.message
            : "Data not sufficient for option analysis.";

        refs.optionSymbolText.textContent = contract.label || refs.optionSymbolText.textContent;
        refs.optionPremiumSourceText.textContent = contract.premiumSource || "NONE";
        refs.optionSetupQualityText.textContent = plan.setupQuality || "AVOID";
        refs.optionEntryText.textContent = formatPremiumRange(entryZone);
        refs.optionStopLossText.textContent = Number.isFinite(stopLoss.value)
            ? `₹${Utils.formatNumber(stopLoss.value, 2)}`
            : refs.optionStopLossText.textContent;
        refs.optionTargetText.textContent = [t1, t2]
            .filter(Number.isFinite)
            .map((target) => `₹${Utils.formatNumber(target, 2)}`)
            .join(" / ") || refs.optionTargetText.textContent;
        refs.optionRrText.textContent = plan.riskReward
            ? `${plan.riskReward.rrToT1 || "N/A"} | ${plan.riskReward.rrToT2 || "N/A"}`
            : "N/A";
        refs.optionEngineMessageText.textContent = plan.reasoning && plan.reasoning[0]
            ? plan.reasoning[0]
            : refs.optionEngineMessageText.textContent;
        refs.optionActionNoteText.textContent = plan.executionPlan && Array.isArray(plan.executionPlan.ifElsePlan) && plan.executionPlan.ifElsePlan.length
            ? plan.executionPlan.ifElsePlan.join(" | ")
            : (plan.statusNote || "Candidate only. Wait for confirmation.");
    }

    function renderProfessional(activeProfile, overall, trendAnalysis, gapPrediction, tradePlan, keyLevels, structureAnalysis, premiumPlan) {
        if (activeProfile !== Utils.USER_PROFILES.PROFESSIONAL) {
            return;
        }

        refs.overallSignalText.textContent = Utils.formatSignalLabel(overall.signal || "WAIT");
        refs.confidenceValue.textContent = `${overall.confidence || 0}%`;
        refs.confidenceMeterBar.style.width = `${overall.confidence || 0}%`;
        refs.lastUpdateText.textContent = overall.updatedAt
            ? `Last update: ${Utils.formatDateTime(overall.updatedAt)}`
            : "No scans have completed yet.";
        renderList(refs.reasoningList, overall.reasoning, "No reasoning available yet.");
        renderList(refs.riskList, overall.riskFlags, "No risk flags are active.");

        refs.trend15Text.textContent = Utils.formatSignalLabel(trendAnalysis.bias15m.signal);
        refs.trend15Meta.textContent = `${trendAnalysis.bias15m.confidence}% confidence`;
        refs.trend1hText.textContent = Utils.formatSignalLabel(trendAnalysis.bias1h.signal);
        refs.trend1hMeta.textContent = `${trendAnalysis.bias1h.confidence}% confidence`;
        refs.gapPrimaryText.textContent = Utils.formatGapLabel(gapPrediction.primary);
        refs.gapMeta.textContent = `${gapPrediction.confidence}% confidence`;
        refs.alignmentText.textContent = Utils.formatAlignmentLabel(trendAnalysis.alignment.status);
        refs.alignmentMeta.textContent = trendAnalysis.alignment.notes && trendAnalysis.alignment.notes[0]
            ? trendAnalysis.alignment.notes[0]
            : "Trend alignment is not available yet.";

        refs.tradeStatusText.textContent = Utils.formatTradeStatusLabel(tradePlan.status);
        refs.tradeMeta.textContent = `${Utils.formatDirectionLabel(tradePlan.direction)} | ${formatEntryType(tradePlan.entryType)}`;
        renderContractSuggestion(tradePlan);
        renderProjectedValue(tradePlan);
        refs.supportValueText.textContent = formatMaybeNumber(keyLevels.nearestSupport);
        refs.resistanceValueText.textContent = formatMaybeNumber(keyLevels.nearestResistance);
        renderLevelBadge(keyLevels);
        refs.structureActionText.textContent = structureAnalysis.tradeSuggestion && structureAnalysis.tradeSuggestion.action
            ? structureAnalysis.tradeSuggestion.action
            : "WAIT";
        renderPremiumDetails(premiumPlan);
    }

    function renderCurrentTab(state, currentMonitored) {
        const monitoredTabs = Object.values(state.monitoredTabs || {});
        refs.monitoredTabsCount.textContent = String(monitoredTabs.length);
        refs.currentTabStatus.textContent = currentMonitored ? "Monitoring" : "Not monitored";
        refs.currentTabMeta.textContent = activeTab
            ? `${activeTab.title || activeTab.url || "Current tab"} | ${currentMonitored && currentMonitored.lastScanAt ? `last scan ${Utils.formatRelativeTime(currentMonitored.lastScanAt)}` : "not scanned yet"}`
            : "No active tab detected.";
        refs.toggleMonitorBtn.textContent = currentMonitored ? "Stop Monitoring" : "Start Monitoring";
    }

    function resolveDisplayedLevels(state, activeTabRef) {
        if (activeTabRef && state.latestSnapshots && state.latestSnapshots[activeTabRef.id] && state.latestSnapshots[activeTabRef.id].supportResistance) {
            return state.latestSnapshots[activeTabRef.id].supportResistance;
        }
        return state.latestSupportResistance || Utils.createEmptySupportResistance();
    }

    function renderLevelBadge(levels) {
        let text = "LEVELS WAITING";
        let className = "neutral";

        if (levels.breakout) {
            text = "BREAKOUT";
            className = "positive";
        } else if (levels.breakdown) {
            text = "BREAKDOWN";
            className = "negative";
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

    function renderPremiumDetails(premiumPlan) {
        const plan = premiumPlan || Utils.createEmptyPremiumTradePlan();
        const contract = plan.contract || {};
        const pricing = plan.pricing || {};
        const targets = Array.isArray(pricing.targets) ? pricing.targets : [];
        const targetText = targets
            .map((target) => Number.isFinite(target.value) ? `${target.label}: ₹${Utils.formatNumber(target.value, 2)}` : null)
            .filter(Boolean)
            .join(" | ");

        refs.proPremiumContractText.textContent = contract.label || "--";
        refs.proPremiumSourceText.textContent = contract.premiumSource || "NONE";
        refs.proPremiumCurrentText.textContent = Number.isFinite(pricing.currentPremium)
            ? `₹${Utils.formatNumber(pricing.currentPremium, 2)}`
            : "--";
        refs.proPremiumEntryText.textContent = formatPremiumRange(pricing.entryZone || {});
        refs.proPremiumStopText.textContent = pricing.stopLoss && Number.isFinite(pricing.stopLoss.value)
            ? `₹${Utils.formatNumber(pricing.stopLoss.value, 2)} (${pricing.stopLoss.type || "NONE"})`
            : "--";
        refs.proPremiumTargetsText.textContent = targetText || "--";
        refs.proPremiumRrText.textContent = plan.riskReward
            ? `${plan.riskReward.rrToT1 || "N/A"} | ${plan.riskReward.rrToT2 || "N/A"}`
            : "N/A";
        renderList(refs.proPremiumWarningsList, plan.warnings, "No premium warnings.");
        renderList(refs.proPremiumReasoningList, plan.reasoning, "No premium reasoning.");
    }

    function normalizePremiumPlan(tradePlan) {
        if (tradePlan && tradePlan.premiumTradePlan) {
            return tradePlan.premiumTradePlan;
        }
        return Utils.createEmptyPremiumTradePlan();
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

    function renderList(container, items, emptyText) {
        const list = Array.isArray(items) && items.length ? items : [emptyText];
        container.innerHTML = list.map((item) => `<li class="summary-item">${escapeHtml(Utils.humanizeAssistantText(item))}</li>`).join("");
    }

    function renderError(error) {
        refs.currentTabMeta.textContent = error instanceof Error ? error.message : String(error);
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

    function formatMaybeNumber(value) {
        return Number.isFinite(value) ? Utils.formatNumber(value, 2) : "--";
    }

    function formatPremiumRange(entryZone) {
        if (!entryZone || (!Number.isFinite(entryZone.min) && !Number.isFinite(entryZone.max))) {
            return "--";
        }
        if (Number.isFinite(entryZone.min) && Number.isFinite(entryZone.max)) {
            return `₹${Utils.formatNumber(entryZone.min, 2)} - ₹${Utils.formatNumber(entryZone.max, 2)}`;
        }
        const value = Number.isFinite(entryZone.max) ? entryZone.max : entryZone.min;
        return `₹${Utils.formatNumber(value, 2)}`;
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

    function resolveAiStateClass(state) {
        if (state === "DONE") {
            return "text-positive";
        }
        if (state === "RUNNING" || state === "COOLDOWN") {
            return "text-neutral";
        }
        if (state === "ERROR" || state === "TIMEOUT" || state === "UNAVAILABLE") {
            return "text-negative";
        }
        return "text-neutral";
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
