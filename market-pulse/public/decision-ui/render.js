import {
    compactDirection,
    escapeHtml,
    formatCurrency,
    formatNumber,
    formatPercent,
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

function updateHeroStatus(payload) {
    const decision = payload.dashboard.decision;
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    document.getElementById("heroStatusCard").className = `hero-status-card ${tone}`;
    document.getElementById("heroStatusCard").innerHTML = `
        <span class="mini-label">Live status</span>
        <strong>${escapeHtml(decision.status)}</strong>
        <p>${escapeHtml(decision.summary)}</p>
    `;
}

function renderDecisionStatus(payload) {
    const decision = payload.dashboard.decision;
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    const selectedMove = payload.dashboard.decision.marketContext.selectedChangePercent;

    document.getElementById("decisionStatusPanel").innerHTML = `
        <div class="status-card ${tone}">
            <div class="decision-top">
                <div>
                    <p class="mini-label">Status</p>
                    <h3 class="status-headline">${escapeHtml(decision.headline)}</h3>
                </div>
                <div class="inline-tags">
                    ${createStatusChip(decision.status, tone)}
                    ${createStatusChip(compactDirection(decision.direction), tone)}
                    ${createStatusChip(`${decision.confidence}% confidence`, "neutral")}
                </div>
            </div>

            <div class="decision-summary">
                <p class="summary-copy">${escapeHtml(decision.summary)}</p>
                <div class="trade-stats">
                    ${createStatBox("Instrument", decision.selectedInstrumentLabel)}
                    ${createStatBox("Spot move", formatSignedPercent(selectedMove))}
                    ${createStatBox("Strike style", decision.suggestedStrikeStyle)}
                    ${createStatBox("Score", formatSignedNumber(decision.score))}
                </div>
                <div class="chip-row">
                    ${createStatusChip(decision.trend.badge, toneFromScore(decision.trend.regime === "DOWNTREND" ? -1 : decision.trend.regime === "UPTREND" ? 1 : 0))}
                    ${createStatusChip(decision.opening.title, toneFromScore(decision.opening.score))}
                    ${createStatusChip(decision.riskMeter.level, decision.riskMeter.level === "High" ? "negative" : decision.riskMeter.level === "Moderate" ? "warn" : "positive")}
                </div>
                <ul class="checklist">
                    ${decision.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
                </ul>
            </div>
        </div>
    `;
}

function renderTradeSuggestion(payload, activeTrade) {
    const plan = payload.dashboard.tradePlan;
    const decision = payload.dashboard.decision;
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    const alreadyActive = activeTrade?.planId && activeTrade.planId === plan?.planId;

    if (!plan?.actionable) {
        document.getElementById("tradeSuggestionPanel").innerHTML = `
            <div class="trade-card neutral">
                <div class="trade-head">
                    <div>
                        <p class="mini-label">Suggested trade</p>
                        <h3 class="status-headline">WAIT</h3>
                    </div>
                    ${createStatusChip(decision.status, tone)}
                </div>
                <p class="summary-copy">${escapeHtml(plan?.reason || decision.summary)}</p>
                <ul class="checklist">
                    ${(decision.noTradeZone.reasons.length ? decision.noTradeZone.reasons : ["No-trade zone is active until price separates cleanly from VWAP or the opening range."]).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
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
                    <h3 class="status-headline">${escapeHtml(plan.contract.optionType)}</h3>
                </div>
                <div class="inline-tags">
                    ${createStatusChip(plan.notation, tone)}
                    ${createStatusChip(plan.instrumentLabel, "neutral")}
                </div>
            </div>

            <p class="summary-copy">${escapeHtml(plan.reason)}</p>
            <div class="trade-stats">
                ${createStatBox("Contract", plan.contract.label)}
                ${createStatBox("Current premium", formatCurrency(plan.contract.lastPrice))}
                ${createStatBox("Entry zone", plan.entry.zoneLabel)}
                ${createStatBox("Spot trigger", formatNumber(plan.entry.spotTrigger))}
                ${createStatBox("Stop loss", formatCurrency(plan.exit.stopLoss))}
                ${createStatBox("Target 1 / 2", `${formatCurrency(plan.exit.target1)} / ${formatCurrency(plan.exit.target2)}`)}
                ${createStatBox("Max lots", plan.sizing.maxLots !== null ? String(plan.sizing.maxLots) : "Set lot size")}
                ${createStatBox("Confidence", `${decision.confidence}%`)}
            </div>

            <div class="active-trade-meta">
                <p class="detail-copy"><strong>Trigger:</strong> ${escapeHtml(plan.entry.triggerText)}</p>
                <p class="detail-copy"><strong>Invalidation:</strong> ${escapeHtml(plan.exit.invalidationText)}</p>
                <p class="detail-copy"><strong>Trail:</strong> ${escapeHtml(plan.exit.trailText)}</p>
                <p class="detail-copy">${escapeHtml(plan.sizing.note)}</p>
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
    const dashboard = payload.dashboard;
    const decision = dashboard.decision;
    const vwap = decision.vwap;

    document.getElementById("marketOverviewPanel").innerHTML = `
        <div class="overview-grid">
            ${createStatBox(decision.selectedInstrumentLabel, formatNumber(decision.marketContext.selectedPrice), `Move ${formatSignedPercent(decision.marketContext.selectedChangePercent)}`)}
            ${createStatBox(`${vwap.proxyLabel} VWAP`, Number.isFinite(vwap.vwap) ? formatNumber(vwap.vwap) : "Unavailable", Number.isFinite(vwap.distancePercent) ? `${formatSignedPercent(vwap.distancePercent)} from VWAP` : "VWAP proxy unavailable")}
            ${createStatBox("PCR", Number.isFinite(decision.levels.pcr) ? formatNumber(decision.levels.pcr) : "Unavailable")}
            ${createStatBox("Support / Resistance", `${decision.levels.support || "NA"} / ${decision.levels.resistance || "NA"}`)}
            ${createStatBox("India VIX", formatNumber(dashboard.india.indiaVix?.price), `Move ${formatSignedPercent(dashboard.india.indiaVix?.changePercent)}`)}
            ${createStatBox("Macro backdrop", dashboard.signal.marketSignal || "Unavailable", dashboard.signal.summary?.plainEnglish || "")}
        </div>
    `;
}

function renderTrendOpening(payload) {
    const decision = payload.dashboard.decision;
    const tone = toneFromStatus(decision.status, compactDirection(decision.direction));
    const noTradeItems = decision.noTradeZone.reasons.length
        ? decision.noTradeZone.reasons
        : ["No no-trade warning is dominant right now."];

    document.getElementById("trendOpeningPanel").innerHTML = `
        <div class="trend-stack">
            <div class="trend-card ${tone}">
                <div class="signal-head">
                    <div>
                        <span>Trend structure</span>
                        <strong>${escapeHtml(decision.trend.badge)}</strong>
                    </div>
                    ${createStatusChip(decision.trend.regime, toneFromScore(decision.trend.regime === "DOWNTREND" ? -1 : decision.trend.regime === "UPTREND" ? 1 : 0))}
                </div>
                <p class="signal-detail">${escapeHtml(decision.trend.detail)}</p>
            </div>

            <div class="trend-card ${toneFromScore(decision.opening.score)}">
                <div class="signal-head">
                    <div>
                        <span>Opening engine</span>
                        <strong>${escapeHtml(decision.opening.title)}</strong>
                    </div>
                    ${createStatusChip(decision.opening.gapType, toneFromScore(decision.opening.score))}
                </div>
                <p class="signal-detail">${escapeHtml(decision.opening.detail)}</p>
            </div>

            <div class="trend-card ${decision.noTradeZone.active ? "warn" : "neutral"}">
                <div class="signal-head">
                    <div>
                        <span>No-trade zone</span>
                        <strong>${escapeHtml(decision.noTradeZone.active ? "Active" : "Clear")}</strong>
                    </div>
                    ${createStatusChip(decision.noTradeZone.active ? "WAIT" : "READY", decision.noTradeZone.active ? "warn" : "positive")}
                </div>
                <ul class="checklist">
                    ${noTradeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
            </div>
        </div>
    `;
}

function renderSignalEngine(payload) {
    const components = payload.dashboard.decision.components || [];

    document.getElementById("signalEnginePanel").innerHTML = `
        <div class="signal-grid">
            ${components.map((component) => `
                <article class="signal-card ${component.tone}">
                    <div class="signal-head">
                        <div>
                            <span>${escapeHtml(component.label)}</span>
                            <strong>${escapeHtml(component.value)}</strong>
                        </div>
                        <span class="component-score ${component.tone}">${escapeHtml(formatSignedNumber(component.score))}</span>
                    </div>
                    <p class="signal-detail">${escapeHtml(component.detail)}</p>
                </article>
            `).join("")}
        </div>
    `;
}

function renderActiveTrade(payload, activeTrade) {
    const monitor = payload.dashboard.tradeMonitor;
    const decision = payload.dashboard.decision;

    if (!activeTrade) {
        document.getElementById("activeTradePanel").innerHTML = `
            <div class="active-trade-card neutral">
                <h3 class="status-headline">No active trade</h3>
                <p class="summary-copy">Use “I took this trade” after entry and the dashboard will start telling you whether to keep holding or exit.</p>
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
                ${createStatusChip(monitor?.action || decision.status, tone)}
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
    const decision = payload.dashboard.decision;
    const risks = payload.dashboard.signal?.risks || [];

    document.getElementById("riskMeterPanel").innerHTML = `
        <div class="risk-card ${decision.riskMeter.level === "High" ? "warn" : toneFromStatus(decision.status, compactDirection(decision.direction))}">
            <div class="signal-head">
                <div>
                    <span>Execution risk</span>
                    <strong>${escapeHtml(decision.riskMeter.level)}</strong>
                </div>
                <div class="risk-score">${escapeHtml(String(decision.riskMeter.score))}</div>
            </div>
            <p class="risk-copy">${escapeHtml(decision.riskMeter.detail)}</p>
            <div class="risk-bar">
                <div class="risk-fill" style="width: ${decision.riskMeter.score}%"></div>
            </div>
            <ul class="checklist">
                ${risks.slice(0, 3).map((risk) => `<li>${escapeHtml(risk.detail)}</li>`).join("")}
            </ul>
        </div>
    `;
}

function renderSourceHealth(payload) {
    const statuses = payload.sourceStatuses || [];
    document.getElementById("sourceHealthPanel").innerHTML = `
        <div class="source-list">
            ${statuses.map((source) => `
                <article class="source-card">
                    <div class="source-head">
                        <div>
                            <span>${escapeHtml(source.label)}</span>
                            <strong>${escapeHtml(source.source || "Unknown source")}</strong>
                        </div>
                        ${createStatusChip(source.status, source.status === "error" ? "negative" : source.status === "live" ? "positive" : source.status === "partial" ? "warn" : "neutral")}
                    </div>
                    <p class="source-note">${escapeHtml(source.message)}</p>
                    <p class="source-note">${escapeHtml(source.lastUpdated ? `Updated ${formatTimestamp(source.lastUpdated)}` : "No timestamp available")}</p>
                    ${createLink(source.sourceUrl, "Open source")}
                </article>
            `).join("")}
        </div>
    `;
}

function renderAlertBanner(payload, activeTrade) {
    const banner = document.getElementById("alertBanner");
    const monitor = payload.dashboard.tradeMonitor;

    if (!activeTrade || !monitor) {
        banner.hidden = true;
        banner.textContent = "";
        return;
    }

    banner.hidden = false;
    banner.textContent = `${monitor.action}: ${monitor.headline}. ${monitor.detail}`;
}

export function renderDashboard(state, payload) {
    document.getElementById("lastUpdated").textContent = formatTimestamp(payload.generatedAt);
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
