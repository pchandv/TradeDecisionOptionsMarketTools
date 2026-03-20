import {
    compactDirection,
    escapeHtml,
    formatCurrency,
    formatNumber,
    formatSignedNumber,
    formatSignedPercent,
    formatTimestamp,
    toneFromScore,
    toneFromStatus
} from "./format.js";

function createStatusChip(label, tone) {
    return `<span class="status-chip ${tone}">${escapeHtml(label)}</span>`;
}

function createStatBox(label, value, note = "") {
    return `
        <div class="stat-box">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            ${note ? `<p class="stat-note">${escapeHtml(note)}</p>` : ""}
        </div>
    `;
}

function createLink(url, label) {
    if (!url) {
        return "";
    }

    return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function toneFromBias(bias) {
    if (bias === "UP") {
        return "positive";
    }
    if (bias === "DOWN") {
        return "negative";
    }
    return "warn";
}

function toneFromTrap(trap) {
    if (trap === "BULL TRAP") {
        return "negative";
    }
    if (trap === "BEAR TRAP") {
        return "positive";
    }
    return "neutral";
}

function updateHeroStatus(payload) {
    const decision = payload?.dashboard?.decision || {};
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    document.getElementById("heroStatusCard").className = `hero-status-card ${tone}`;
    document.getElementById("heroStatusCard").innerHTML = `
        <span class="mini-label">Live status</span>
        <strong>${escapeHtml(decision.status || "WAIT")}</strong>
        <p>${escapeHtml(decision.summary || "Waiting for the next decision refresh.")}</p>
    `;
}

function renderDecisionStatus(payload) {
    const decision = payload?.dashboard?.decision || {};
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    const notes = Array.isArray(decision.notes) ? decision.notes : [];

    document.getElementById("decisionStatusPanel").innerHTML = `
        <div class="status-card ${tone}">
            <div class="decision-top">
                <div>
                    <p class="mini-label">Final decision</p>
                    <h3 class="status-headline">${escapeHtml(decision.headline || "WAIT")}</h3>
                </div>
                <div class="inline-tags">
                    ${createStatusChip(decision.status || "WAIT", tone)}
                    ${createStatusChip(`Mode ${decision.mode || "WAIT"}`, (decision.mode || "WAIT") === "TRADE" ? "positive" : "warn")}
                    ${createStatusChip(`Bias ${decision.bias || "NEUTRAL"}`, toneFromBias(decision.bias))}
                    ${createStatusChip(`${decision.confidence ?? 0}% confidence`, "neutral")}
                </div>
            </div>

            <div class="decision-summary">
                <p class="summary-copy">${escapeHtml(decision.summary || "No decision is available yet.")}</p>
                <div class="trade-stats">
                    ${createStatBox("Action", decision.action || "WAIT")}
                    ${createStatBox("Bias", decision.bias || "NEUTRAL")}
                    ${createStatBox("Score", formatSignedNumber(decision.score))}
                    ${createStatBox("Trap", decision.trap || "NONE", decision.trapDetail || "")}
                    ${createStatBox("Buy CE above", formatNumber(decision.entry?.CE_above))}
                    ${createStatBox("Buy PE below", formatNumber(decision.entry?.PE_below))}
                    ${createStatBox("Instrument", decision.selectedInstrumentLabel || "Unavailable")}
                    ${createStatBox("Strike style", decision.suggestedStrikeStyle || "ATM")}
                </div>
                <div class="chip-row">
                    ${createStatusChip(decision.trend?.badge || "Sideways", toneFromScore(decision.trend?.regime === "DOWNTREND" ? -1 : decision.trend?.regime === "UPTREND" ? 1 : 0))}
                    ${createStatusChip(decision.opening?.title || "Opening range unavailable", toneFromScore(decision.opening?.score))}
                    ${createStatusChip(decision.trap || "NONE", toneFromTrap(decision.trap))}
                    ${createStatusChip(decision.riskMeter?.level || "Controlled", decision.riskMeter?.level === "High" ? "negative" : decision.riskMeter?.level === "Moderate" ? "warn" : "positive")}
                </div>
                <ul class="checklist">
                    ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
                </ul>
            </div>
        </div>
    `;
}

function renderTradeSuggestion(payload, activeTrade) {
    const plan = payload?.dashboard?.tradePlan;
    const decision = payload?.dashboard?.decision || {};
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    const alreadyActive = activeTrade?.planId && activeTrade.planId === plan?.planId;

    if (!plan?.actionable) {
        const reasons = decision.noTradeZone?.reasons?.length
            ? decision.noTradeZone.reasons
            : ["No clean price confirmation is active yet."];

        document.getElementById("tradeSuggestionPanel").innerHTML = `
            <div class="trade-card neutral">
                <div class="trade-head">
                    <div>
                        <p class="mini-label">Suggested trade</p>
                        <h3 class="status-headline">WAIT</h3>
                    </div>
                    ${createStatusChip(decision.status || "WAIT", tone)}
                </div>
                <p class="summary-copy">${escapeHtml(plan?.reason || decision.summary || "Wait for a clean trigger.")}</p>
                <ul class="checklist">
                    ${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
                </ul>
            </div>
        `;
        return;
    }

    document.getElementById("tradeSuggestionPanel").innerHTML = `
        <div class="trade-card ${tone}">
            <div class="trade-head">
                <div>
                    <p class="mini-label">Suggested trade</p>
                    <h3 class="status-headline">${escapeHtml(plan.contract?.optionType || decision.action || "WAIT")}</h3>
                </div>
                <div class="inline-tags">
                    ${createStatusChip(plan.notation || decision.action || "WAIT", tone)}
                    ${createStatusChip(plan.instrumentLabel || decision.selectedInstrumentLabel || "Instrument", "neutral")}
                </div>
            </div>

            <p class="summary-copy">${escapeHtml(plan.reason || decision.summary || "")}</p>
            <div class="trade-stats">
                ${createStatBox("Contract", plan.contract?.label || "Unavailable")}
                ${createStatBox("Current premium", formatCurrency(plan.contract?.lastPrice))}
                ${createStatBox("Entry zone", plan.entry?.zoneLabel || "Unavailable")}
                ${createStatBox(plan.contract?.optionType === "CE" ? "CE above" : "PE below", formatNumber(plan.entry?.spotTrigger))}
                ${createStatBox("Stop loss", formatCurrency(plan.exit?.stopLoss))}
                ${createStatBox("Target 1 / 2", `${formatCurrency(plan.exit?.target1)} / ${formatCurrency(plan.exit?.target2)}`)}
                ${createStatBox("Max lots", plan.sizing?.maxLots !== null && plan.sizing?.maxLots !== undefined ? String(plan.sizing.maxLots) : "Set lot size")}
                ${createStatBox("Confidence", `${decision.confidence ?? 0}%`)}
            </div>

            <div class="active-trade-meta">
                <p class="detail-copy"><strong>Trigger:</strong> ${escapeHtml(plan.entry?.triggerText || "Wait for live entry confirmation.")}</p>
                <p class="detail-copy"><strong>Invalidation:</strong> ${escapeHtml(plan.exit?.invalidationText || "Unavailable")}</p>
                <p class="detail-copy"><strong>Trail:</strong> ${escapeHtml(plan.exit?.trailText || "Unavailable")}</p>
                <p class="detail-copy">${escapeHtml(plan.sizing?.note || "")}</p>
            </div>

            <div class="toolbar-actions">
                <button
                    type="button"
                    class="primary-button"
                    data-action="take-trade"
                    ${alreadyActive ? "disabled" : ""}
                >${alreadyActive ? "Trade active" : "I took this trade"}</button>
                ${createLink(plan.sourceUrl, "Open live chain")}
            </div>
        </div>
    `;
}

function renderMarketOverview(payload) {
    const decision = payload?.dashboard?.decision || {};
    const scorecard = decision.scorecard || {};

    document.getElementById("marketOverviewPanel").innerHTML = `
        <div class="overview-grid">
            ${createStatBox(decision.selectedInstrumentLabel || "Spot", formatNumber(decision.marketContext?.selectedPrice), `Move ${formatSignedPercent(decision.marketContext?.selectedChangePercent)}`)}
            ${createStatBox("GIFT Gap", Number.isFinite(scorecard.giftGapPercent) ? formatSignedPercent(scorecard.giftGapPercent) : "Unavailable", `Signal ${formatSignalValue(scorecard.giftSignal)}`)}
            ${createStatBox("India VIX", formatNumber(scorecard.vix), `Signal ${formatSignalValue(scorecard.vixSignal)}`)}
            ${createStatBox("PCR", formatNumber(scorecard.pcr), `Signal ${formatSignalValue(scorecard.pcrSignal)}`)}
            ${createStatBox("Breadth Ratio", Number.isFinite(scorecard.breadthRatio) ? formatNumber(scorecard.breadthRatio) : scorecard.breadthRatio === Infinity ? "All advances" : "Unavailable", `Signal ${formatSignalValue(scorecard.breadthSignal)}`)}
            ${createStatBox("FII Flow", Number.isFinite(scorecard.fiiFlow) ? `${formatCurrency(scorecard.fiiFlow)} Cr` : "Unavailable", `Signal ${formatSignalValue(scorecard.flowSignal)}`)}
            ${createStatBox("1st 15m High", formatNumber(scorecard.first15MinHigh))}
            ${createStatBox("1st 15m Low", formatNumber(scorecard.first15MinLow))}
        </div>
    `;
}

function formatSignalValue(signal) {
    if (!Number.isFinite(signal)) {
        return "Unavailable";
    }
    if (signal > 0) {
        return "+1";
    }
    if (signal < 0) {
        return "-1";
    }
    return "0";
}

function renderTrendOpening(payload) {
    const decision = payload?.dashboard?.decision || {};
    const noTradeItems = decision.noTradeZone?.reasons?.length
        ? decision.noTradeZone.reasons
        : ["No wait condition is dominant right now."];

    document.getElementById("trendOpeningPanel").innerHTML = `
        <div class="trend-stack">
            <div class="trend-card ${toneFromScore(decision.trend?.regime === "DOWNTREND" ? -1 : decision.trend?.regime === "UPTREND" ? 1 : 0)}">
                <div class="signal-head">
                    <div>
                        <span>Trend structure</span>
                        <strong>${escapeHtml(decision.trend?.badge || "Sideways")}</strong>
                    </div>
                    ${createStatusChip(decision.trend?.regime || "SIDEWAYS", toneFromScore(decision.trend?.regime === "DOWNTREND" ? -1 : decision.trend?.regime === "UPTREND" ? 1 : 0))}
                </div>
                <p class="signal-detail">${escapeHtml(decision.trend?.detail || "Trend structure is unavailable.")}</p>
            </div>

            <div class="trend-card ${toneFromTrap(decision.trap)}">
                <div class="signal-head">
                    <div>
                        <span>Trap detection</span>
                        <strong>${escapeHtml(decision.trap || "NONE")}</strong>
                    </div>
                    ${createStatusChip(decision.trap || "NONE", toneFromTrap(decision.trap))}
                </div>
                <p class="signal-detail">${escapeHtml(decision.trapDetail || "No trap detail is available.")}</p>
            </div>

            <div class="trend-card ${decision.noTradeZone?.active ? "warn" : toneFromScore(decision.opening?.score)}">
                <div class="signal-head">
                    <div>
                        <span>Entry gate</span>
                        <strong>${escapeHtml(decision.opening?.title || "Opening range unavailable")}</strong>
                    </div>
                    ${createStatusChip(decision.noTradeZone?.active ? "WAIT" : "READY", decision.noTradeZone?.active ? "warn" : "positive")}
                </div>
                <p class="signal-detail">${escapeHtml(decision.opening?.detail || "Wait for the first 15-minute range.")}</p>
                <ul class="checklist">
                    ${noTradeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
            </div>
        </div>
    `;
}

function renderSignalEngine(payload) {
    const components = Array.isArray(payload?.dashboard?.decision?.components)
        ? payload.dashboard.decision.components
        : [];

    document.getElementById("signalEnginePanel").innerHTML = `
        <div class="signal-grid">
            ${components.map((component) => `
                <article class="signal-card ${component.tone}">
                    <div class="signal-head">
                        <div>
                            <span>${escapeHtml(component.label)}</span>
                            <strong>${escapeHtml(component.value)}</strong>
                            <p class="stat-note">Signal ${escapeHtml(formatSignalValue(component.signal))} • Weight ${escapeHtml(component.weight?.toFixed?.(2) || "0.00")}</p>
                        </div>
                        <span class="component-score ${component.tone}">${escapeHtml(formatSignedNumber(component.score))}</span>
                    </div>
                    <p class="signal-detail">${escapeHtml(component.detail || "")}</p>
                </article>
            `).join("")}
        </div>
    `;
}

function renderActiveTrade(payload, activeTrade) {
    const monitor = payload?.dashboard?.tradeMonitor;
    const decision = payload?.dashboard?.decision || {};

    if (!activeTrade) {
        document.getElementById("activeTradePanel").innerHTML = `
            <div class="active-trade-card neutral">
                <h3 class="status-headline">No active trade</h3>
                <p class="summary-copy">Use "I took this trade" after entry and the dashboard will start telling you whether to hold or exit.</p>
            </div>
        `;
        return;
    }

    const tone = toneFromStatus(
        monitor?.action === "EXIT" || monitor?.action === "INVALIDATED" ? "EXIT" : "TRADE",
        activeTrade.optionType
    );

    document.getElementById("activeTradePanel").innerHTML = `
        <div class="active-trade-card ${tone}">
            <div class="trade-head">
                <div>
                    <p class="mini-label">Tracked contract</p>
                    <h3 class="status-headline">${escapeHtml(activeTrade.label || `${activeTrade.instrument} ${activeTrade.strikePrice} ${activeTrade.optionType}`)}</h3>
                </div>
                ${createStatusChip(monitor?.action || decision.status || "WAIT", tone)}
            </div>

            <div class="trade-stats">
                ${createStatBox("Entry", formatCurrency(activeTrade.entryPrice))}
                ${createStatBox("Stop", formatCurrency(activeTrade.stopLoss))}
                ${createStatBox("Target 1", formatCurrency(activeTrade.target1))}
                ${createStatBox("Target 2", formatCurrency(activeTrade.target2))}
                ${createStatBox("Current premium", formatCurrency(monitor?.currentPremium))}
                ${createStatBox("P/L", formatSignedPercent(monitor?.pnlPercent))}
            </div>

            <div class="active-trade-meta">
                <p class="detail-copy"><strong>Status:</strong> ${escapeHtml(monitor?.headline || "Waiting for the next refresh.")}</p>
                <p class="detail-copy">${escapeHtml(monitor?.detail || "The dashboard will evaluate the trade again on the next refresh.")}</p>
                <p class="stat-note">Acknowledged ${escapeHtml(formatTimestamp(activeTrade.acknowledgedAt))}</p>
            </div>
        </div>
    `;
}

function renderRiskMeter(payload) {
    const decision = payload?.dashboard?.decision || {};
    const risks = Array.isArray(payload?.dashboard?.signal?.risks) ? payload.dashboard.signal.risks : [];

    document.getElementById("riskMeterPanel").innerHTML = `
        <div class="risk-card ${decision.riskMeter?.level === "High" ? "warn" : toneFromStatus(decision.status, compactDirection(decision.direction))}">
            <div class="signal-head">
                <div>
                    <span>Execution risk</span>
                    <strong>${escapeHtml(decision.riskMeter?.level || "Controlled")}</strong>
                </div>
                <div class="risk-score">${escapeHtml(String(decision.riskMeter?.score ?? 0))}</div>
            </div>
            <p class="risk-copy">${escapeHtml(decision.riskMeter?.detail || "Risk meter unavailable.")}</p>
            <div class="risk-bar">
                <div class="risk-fill" style="width: ${decision.riskMeter?.score ?? 0}%"></div>
            </div>
            <ul class="checklist">
                ${(risks.length ? risks.slice(0, 3).map((risk) => risk.detail) : [decision.trapDetail || "No macro risk note is active."]).map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}
            </ul>
        </div>
    `;
}

function renderSourceHealth(payload) {
    const statuses = Array.isArray(payload?.sourceStatuses) ? payload.sourceStatuses : [];
    document.getElementById("sourceHealthPanel").innerHTML = `
        <div class="source-list">
            ${statuses.map((source) => `
                <article class="source-card">
                    <div class="source-head">
                        <div>
                            <span>${escapeHtml(source.label || "Source")}</span>
                            <strong>${escapeHtml(source.source || "Unknown source")}</strong>
                        </div>
                        ${createStatusChip(source.status || "unavailable", source.status === "error" ? "negative" : source.status === "live" ? "positive" : source.status === "partial" ? "warn" : "neutral")}
                    </div>
                    <p class="source-note">${escapeHtml(source.message || "No source message available.")}</p>
                    <p class="source-note">${escapeHtml(source.lastUpdated ? `Updated ${formatTimestamp(source.lastUpdated)}` : "No timestamp available")}</p>
                    ${createLink(source.sourceUrl, "Open source")}
                </article>
            `).join("")}
        </div>
    `;
}

function renderAlertBanner(payload, activeTrade) {
    const banner = document.getElementById("alertBanner");
    const monitor = payload?.dashboard?.tradeMonitor;

    if (!activeTrade || !monitor) {
        banner.hidden = true;
        banner.textContent = "";
        return;
    }

    banner.hidden = false;
    banner.textContent = `${monitor.action}: ${monitor.headline}. ${monitor.detail}`;
}

export function renderDashboard(state, payload) {
    document.getElementById("lastUpdated").textContent = formatTimestamp(payload?.generatedAt);
    document.getElementById("buildVersion").textContent = payload?.metadata?.version || "unknown";
    updateHeroStatus(payload);
    renderDecisionStatus(payload);
    renderTradeSuggestion(payload, state.activeTrade);
    renderMarketOverview(payload);
    renderTrendOpening(payload);
    renderSignalEngine(payload);
    renderActiveTrade(payload, state.activeTrade);
    renderRiskMeter(payload);
    renderSourceHealth(payload);
    renderAlertBanner(payload, state.activeTrade);
}
