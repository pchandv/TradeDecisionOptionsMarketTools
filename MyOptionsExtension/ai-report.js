(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;

    const refs = {
        aiStateBadge: document.getElementById("aiStateBadge"),
        aiStatusText: document.getElementById("aiStatusText"),
        runAiAnalysisBtn: document.getElementById("runAiAnalysisBtn"),
        refreshViewBtn: document.getElementById("refreshViewBtn"),
        openMainReportBtn: document.getElementById("openMainReportBtn"),
        summaryText: document.getElementById("summaryText"),
        beginnerAdviceText: document.getElementById("beginnerAdviceText"),
        proInsightText: document.getElementById("proInsightText"),
        tradeSuggestionText: document.getElementById("tradeSuggestionText"),
        riskWarningText: document.getElementById("riskWarningText"),
        lastUpdatedText: document.getElementById("lastUpdatedText"),
        parseModeText: document.getElementById("parseModeText"),
        rawOutputText: document.getElementById("rawOutputText")
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
        refs.runAiAnalysisBtn.addEventListener("click", async () => {
            toggleBusy(true);
            try {
                await sendAction(Utils.ACTIONS.RUN_AI_ANALYSIS);
                await refreshView();
            } catch (error) {
                renderError(error);
            } finally {
                toggleBusy(false);
            }
        });

        refs.refreshViewBtn.addEventListener("click", () => {
            refreshView().catch(renderError);
        });

        refs.openMainReportBtn.addEventListener("click", () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
        });
    }

    async function refreshView() {
        const state = await Utils.loadState();
        const aiAnalysis = state.aiAnalysis || Utils.createEmptyAIAnalysis();
        renderAnalysis(aiAnalysis);
    }

    function renderAnalysis(aiAnalysis) {
        refs.aiStateBadge.textContent = aiAnalysis.state || "IDLE";
        refs.aiStateBadge.className = `signal-badge ${resolveBadgeClass(aiAnalysis.state)}`;
        refs.aiStatusText.textContent = aiAnalysis.statusText || "AI not available";
        refs.summaryText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.summary
            ? aiAnalysis.parsed.summary
            : "No AI summary available yet.";
        refs.beginnerAdviceText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.beginnerAdvice
            ? aiAnalysis.parsed.beginnerAdvice
            : "No beginner advice yet.";
        refs.proInsightText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.proInsight
            ? aiAnalysis.parsed.proInsight
            : "No pro insight yet.";
        refs.tradeSuggestionText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.tradeSuggestion
            ? aiAnalysis.parsed.tradeSuggestion
            : "WAIT";
        refs.tradeSuggestionText.className = `hero-value ${resolveTradeSuggestionClass(aiAnalysis.parsed && aiAnalysis.parsed.tradeSuggestion)}`;
        refs.riskWarningText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.riskWarning
            ? aiAnalysis.parsed.riskWarning
            : "No AI risk warning yet.";
        refs.lastUpdatedText.textContent = aiAnalysis.updatedAt ? Utils.formatDateTime(aiAnalysis.updatedAt) : "Never";
        refs.parseModeText.textContent = aiAnalysis.parsed && aiAnalysis.parsed.parseMode ? aiAnalysis.parsed.parseMode : "NONE";
        refs.rawOutputText.textContent = aiAnalysis.rawOutput || "No raw AI output captured yet.";
    }

    function resolveBadgeClass(state) {
        const upper = String(state || "").toUpperCase();
        if (upper === "DONE") {
            return "bullish";
        }
        if (upper === "RUNNING") {
            return "neutral";
        }
        if (upper === "ERROR" || upper === "TIMEOUT" || upper === "UNAVAILABLE") {
            return "bearish";
        }
        return "neutral";
    }

    function resolveTradeSuggestionClass(value) {
        const upper = String(value || "WAIT").toUpperCase();
        if (upper === "BUY CE") {
            return "text-positive";
        }
        if (upper === "BUY PE") {
            return "text-negative";
        }
        return "text-neutral";
    }

    function toggleBusy(isBusy) {
        refs.runAiAnalysisBtn.disabled = isBusy;
        refs.runAiAnalysisBtn.textContent = isBusy ? "Waiting for response..." : "Run AI Analysis";
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
        refs.aiStatusText.textContent = error instanceof Error ? error.message : String(error);
    }
})();
