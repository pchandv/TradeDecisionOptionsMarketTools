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
        thresholdStatusList: document.getElementById("thresholdStatusList"),
        reasoningList: document.getElementById("reasoningList"),
        riskList: document.getElementById("riskList"),
        siteSummaryList: document.getElementById("siteSummaryList"),
        alertHistoryList: document.getElementById("alertHistoryList"),
        tabTableBody: document.getElementById("tabTableBody"),
        signalHistoryList: document.getElementById("signalHistoryList"),
        refreshAllBtn: document.getElementById("refreshAllBtn"),
        clearHistoryBtn: document.getElementById("clearHistoryBtn"),
        exportJsonBtn: document.getElementById("exportJsonBtn")
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

        refs.reportMeta.textContent = overall.updatedAt
            ? `Last overall update: ${Utils.formatDateTime(overall.updatedAt)} | ${monitoredTabs.length} monitored tabs`
            : "No scans have completed yet.";

        renderOverall(overall);
        renderList(refs.reasoningList, overall.reasoning, "No reasoning available yet.");
        renderList(refs.riskList, overall.riskFlags, "No risk flags are active yet.");
        renderThresholds(state.settings, overall);
        renderSiteSummary(monitoredTabs);
        renderAlertHistory(state.alertHistory || []);
        renderTabTable(tabRows);
        renderSignalHistory(state.signalHistory || []);
    }

    function renderOverall(overall) {
        const signalClass = normalizeSignalClass(overall.signal);
        refs.overallSignalBadge.textContent = overall.signal || "WAIT";
        refs.overallSignalBadge.className = `signal-badge ${signalClass}`;
        refs.overallSignalText.textContent = overall.signal || "WAIT";
        refs.confidenceValue.textContent = `${overall.confidence || 0}%`;
        refs.confidenceMeterBar.style.width = `${overall.confidence || 0}%`;
        refs.recommendedStance.textContent = overall.recommendedStance || "Wait for confirmation.";
    }

    function renderThresholds(settings, overall) {
        const items = [
            `Strength: ${overall.strength || "WEAK"}`,
            `Bullish score: ${overall.bullishScore || 0}`,
            `Bearish score: ${overall.bearishScore || 0}`,
            `Net score: ${overall.score || 0}`,
            `Confidence threshold: ${settings.confidenceThreshold}%`,
            `Monitoring interval: ${settings.monitoringIntervalSeconds}s`,
            `Sustained duration: ${settings.sustainedConditionMinutes} min`
        ];
        refs.thresholdStatusList.innerHTML = items.map((item) => `<li class="summary-item">${escapeHtml(item)}</li>`).join("");
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
            refs.tabTableBody.innerHTML = `<tr><td colspan="9">No tab snapshots available yet.</td></tr>`;
            return;
        }

        refs.tabTableBody.innerHTML = rows.map((row) => `
            <tr>
                <td>
                    <strong>${escapeHtml(row.instrument)}</strong><br>
                    <span class="muted">${escapeHtml(row.pageTitle || "Untitled tab")}</span>
                </td>
                <td>${escapeHtml(row.siteType)}</td>
                <td><span class="tag ${normalizeTagClass(row.signal)}">${escapeHtml(row.signal)}</span></td>
                <td>${row.confidence}%</td>
                <td>${formatMaybeNumber(row.values.spotPrice)}</td>
                <td>${formatMaybeNumber(row.values.pcr)}</td>
                <td>${formatMaybeNumber(row.values.vix)}</td>
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
                <strong>${escapeHtml(entry.signal)}</strong> with ${entry.confidence}% confidence<br>
                <span class="muted">${escapeHtml(Utils.formatDateTime(entry.timestamp))} | ${entry.tabCount || 0} tab(s)</span>
            </li>
        `).join("");
    }

    function renderList(container, items, emptyText) {
        const list = Array.isArray(items) && items.length ? items : [emptyText];
        container.innerHTML = list.map((item) => `<li class="summary-item">${escapeHtml(item)}</li>`).join("");
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
        if (upper === "NEUTRAL") {
            return "neutral";
        }
        return "wait";
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

    function formatMaybeNumber(value) {
        return Number.isFinite(value) ? Utils.formatNumber(value, 2) : "--";
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
