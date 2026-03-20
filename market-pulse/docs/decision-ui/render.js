import {
    compactDirection,
    escapeHtml,
    formatCurrency,
    formatNumber,
    formatSignedNumber,
    formatSignedPercent,
    formatTimestamp,
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

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function riskLabel(score) {
    if (!Number.isFinite(score)) {
        return "MEDIUM";
    }
    if (score >= 75) {
        return "HIGH";
    }
    if (score >= 45) {
        return "MEDIUM";
    }
    return "LOW";
}

function riskTone(label) {
    if (label === "HIGH") {
        return "negative";
    }
    if (label === "MEDIUM") {
        return "warn";
    }
    return "positive";
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

function toneFromMarketType(marketType) {
    if (marketType === "TRENDING") {
        return "positive";
    }
    if (marketType === "VOLATILE") {
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

function getImpactLabel(component = {}) {
    const signal = Number(component.signal || 0);
    const weight = Math.abs(Number(component.weight || 0));
    const score = Number(component.score || 0);
    const ratio = weight > 0 ? Math.abs(score) / weight : Math.abs(signal);
    const strength = ratio >= 0.75 ? "strong" : ratio >= 0.35 ? "mild" : "neutral";

    if (signal > 0) {
        return strength === "strong" ? "strong bullish" : strength === "mild" ? "bullish" : "neutral";
    }
    if (signal < 0) {
        return strength === "strong" ? "strong bearish" : strength === "mild" ? "bearish pressure" : "neutral";
    }
    return "neutral";
}

function getDirectionLabel(bias) {
    if (bias === "UP") {
        return "BULLISH";
    }
    if (bias === "DOWN") {
        return "BEARISH";
    }
    return "NEUTRAL";
}

function buildRiskDimensions(payload) {
    const decision = payload?.dashboard?.decision || {};
    const feedHealth = payload?.dashboard?.feedHealth || {};
    const marketScore = clamp(
        28
        + (decision.marketType?.code === "VOLATILE" ? 28 : 0)
        + (decision.trap && decision.trap !== "NONE" ? 14 : 0)
        + (decision.bias === "NEUTRAL" ? 12 : 0),
        8,
        95
    );
    const optionScore = clamp(
        24
        + (Number(decision.optionsIntelligence?.ivPercentile || 0) >= 90 ? 40 : Number(decision.optionsIntelligence?.ivPercentile || 0) >= 75 ? 22 : 0)
        + (decision.optionsIntelligence?.thetaRisk === "High" ? 18 : 0)
        + (decision.optionsIntelligence?.ivTrend === "FALLING" ? 10 : 0),
        6,
        95
    );
    const executionScore = clamp(
        Number(decision.riskMeter?.score || 45)
        + (decision.marketType?.code === "SIDEWAYS" ? 12 : 0)
        + (decision.stability?.locked ? 10 : 0),
        8,
        95
    );
    const dataScore = clamp(
        (feedHealth.blocksTradeSignals ? 92 : 12)
        + ((feedHealth.staleCriticalSources?.length || 0) * 6),
        5,
        95
    );
    const overallScore = Math.round(Math.max(
        dataScore,
        (marketScore * 0.28) + (optionScore * 0.26) + (executionScore * 0.28) + (dataScore * 0.18)
    ));

    return {
        overallScore,
        overallLabel: riskLabel(overallScore),
        positionSizeHint: overallScore >= 80
            ? "Block new trades until risk normalizes."
            : overallScore >= 65
                ? "Cut position size and prefer spreads or ITM."
                : overallScore >= 45
                    ? "Trade only the clean trigger with standard size discipline."
                    : "Normal intraday sizing is acceptable if triggers stay intact.",
        dimensions: [
            {
                key: "market",
                label: "Market Risk",
                score: marketScore,
                level: riskLabel(marketScore),
                detail: decision.marketType?.detail || decision.trapDetail || "Trend and volatility are stable."
            },
            {
                key: "option",
                label: "Option Risk",
                score: optionScore,
                level: riskLabel(optionScore),
                detail: decision.optionsIntelligence?.warnings?.[0] || "IV and theta conditions are manageable."
            },
            {
                key: "execution",
                label: "Execution Risk",
                score: executionScore,
                level: riskLabel(executionScore),
                detail: decision.riskMeter?.detail || "Execution quality is acceptable."
            },
            {
                key: "data",
                label: "Data Risk",
                score: dataScore,
                level: riskLabel(dataScore),
                detail: feedHealth.blocksTradeSignals
                    ? "Critical feeds are stale, so actionable signals are disabled."
                    : (feedHealth.summary || "Critical feeds are fresh enough.")
            }
        ]
    };
}

function getStatusBlockers(decision, payload) {
    const feedHealth = payload?.dashboard?.feedHealth || {};
    const blockers = [];

    if (feedHealth.blocksTradeSignals) {
        blockers.push("Critical spot or options data is stale.");
    }
    if (decision.stability?.locked) {
        blockers.push(decision.stability.detail);
    }
    if (Array.isArray(decision.noTradeZone?.reasons)) {
        blockers.push(...decision.noTradeZone.reasons);
    }
    if (payload?.dashboard?.engineCompare?.enabled && payload.dashboard.engineCompare.conflict) {
        blockers.push("Engine compare mode shows a disagreement between speed and quality models.");
    }

    return [...new Set(blockers.filter(Boolean))].slice(0, 4);
}

function getTradeTriggers(decision, payload) {
    const feedHealth = payload?.dashboard?.feedHealth || {};
    const triggers = [];

    if (feedHealth.blocksTradeSignals) {
        triggers.push("Wait for fresh spot, intraday proxy VWAP, and option-chain data before acting.");
    }
    if (decision.stability?.locked) {
        triggers.push(`Need ${decision.stability.confirmationsNeeded} matching refreshes. Current count: ${decision.stability.confirmations}.`);
    }
    if (decision.bias === "UP" && Number.isFinite(decision.entry?.CE_above)) {
        triggers.push(`Break above ${formatNumber(decision.entry.CE_above)} with VWAP support intact.`);
    }
    if (decision.bias === "DOWN" && Number.isFinite(decision.entry?.PE_below)) {
        triggers.push(`Break below ${formatNumber(decision.entry.PE_below)} with VWAP pressure intact.`);
    }
    if (decision.bias === "NEUTRAL") {
        triggers.push("Wait for score expansion and a clean breakout from the opening range.");
    }
    if (decision.marketType?.code === "SIDEWAYS") {
        triggers.push("Avoid entries until the market exits chop and the score expands.");
    }

    return [...new Set(triggers.filter(Boolean))].slice(0, 3);
}

function getDecisionState(decision, payload) {
    const blockers = getStatusBlockers(decision, payload);

    if (decision.status === "EXIT") {
        return {
            label: "NO TRADE",
            tone: "negative",
            reason: decision.summary || "The current setup is invalidated."
        };
    }
    if (decision.status === "TRADE" && (decision.action === "CE" || decision.action === "PE")) {
        return {
            label: "TRADE",
            tone: toneFromStatus("TRADE", compactDirection(decision.action)),
            reason: decision.summary || "Directional setup is actionable."
        };
    }
    if (decision.status === "CONDITIONAL" && (decision.action === "CE" || decision.action === "PE")) {
        return {
            label: "CONDITIONAL TRADE",
            tone: "warn",
            reason: blockers[0] || decision.summary || "Direction is clear, but the trigger still needs confirmation."
        };
    }

    return {
        label: "WAIT",
        tone: "warn",
        reason: blockers[0] || decision.summary || "Wait for a cleaner trigger."
    };
}

function createScoreMeter(scoreMeter) {
    const minimum = Number(scoreMeter?.minimum);
    const maximum = Number(scoreMeter?.maximum);
    const value = Number(scoreMeter?.value);
    const width = Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum && Number.isFinite(value)
        ? Math.max(0, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100))
        : 50;

    return `
        <div class="score-meter">
            <div class="score-meter-head">
                <span class="mini-label">Score meter</span>
                <strong>${escapeHtml(scoreMeter?.label || "Neutral")}</strong>
            </div>
            <div class="score-meter-track">
                <div class="score-meter-fill" style="width: ${width}%"></div>
            </div>
            <div class="score-meter-scale">
                <span>${escapeHtml(String(scoreMeter?.minimum ?? "-100"))}</span>
                <strong>${escapeHtml(formatSignedNumber(scoreMeter?.value))}</strong>
                <span>${escapeHtml(String(scoreMeter?.maximum ?? "100"))}</span>
            </div>
        </div>
    `;
}

function createSparkline(series = [], key = "confidence") {
    const recent = Array.isArray(series) ? series.slice(-8) : [];
    if (!recent.length) {
        return `<div class="sparkline empty"><span>No trend yet</span></div>`;
    }

    const values = recent.map((item) => Number(item?.[key]) || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);

    return `
        <div class="sparkline" aria-hidden="true">
            ${values.map((value) => {
                const height = Math.round(24 + (((value - min) / range) * 44));
                return `<span style="height:${height}%"></span>`;
            }).join("")}
        </div>
    `;
}

function buildOpeningPlaybook(decision) {
    const gap = Number(decision.opening?.gapPercent);
    const priceSignal = Number(decision.marketContext?.priceSignal || 0);
    const vwapDistance = Number(decision.vwap?.distancePercent || 0);
    const gateLocked = !Number.isFinite(decision.opening?.first15High)
        || !Number.isFinite(decision.opening?.first15Low)
        || priceSignal === 0;
    let pattern = "Sideways chop";
    let summary = "The open is still unresolved. Let the first clear acceptance decide direction.";
    const suggestions = [];

    if (decision.trap === "BULL TRAP") {
        pattern = "Fake breakout";
        summary = "Gap-up optimism is being rejected. Favor fades only after bearish confirmation.";
        suggestions.push(`Fade below ${formatNumber(decision.entry?.PE_below)} if VWAP stays weak.`);
    } else if (decision.trap === "BEAR TRAP") {
        pattern = "Gap fill rejection";
        summary = "Gap-down fear is being rejected. Favor bullish continuation only after confirmation.";
        suggestions.push(`Buy above ${formatNumber(decision.entry?.CE_above)} if VWAP support holds.`);
    } else if (gap >= 0.25 && priceSignal > 0 && vwapDistance > 0) {
        pattern = "Gap up continuation";
        summary = "The open is behaving like a bullish continuation with spot holding above the gate.";
        suggestions.push(`Continuation above ${formatNumber(decision.entry?.CE_above)} with VWAP hold.`);
    } else if (gap <= -0.25 && priceSignal < 0 && vwapDistance < 0) {
        pattern = "Open drive down";
        summary = "The open is behaving like a downside drive with structure aligned below VWAP.";
        suggestions.push(`Downside continuation below ${formatNumber(decision.entry?.PE_below)}.`);
    } else if (gap >= 0.25 && priceSignal < 0) {
        pattern = "Gap fill";
        summary = "The gap-up is failing and price is rotating back into the prior range.";
        suggestions.push(`Fade only if price accepts below ${formatNumber(decision.entry?.PE_below)}.`);
    } else if (gap <= -0.25 && priceSignal > 0) {
        pattern = "Gap fill";
        summary = "The gap-down is being reclaimed and price is attempting a bullish reversal.";
        suggestions.push(`Reclaim above ${formatNumber(decision.entry?.CE_above)} before taking CE.`);
    } else if (!gateLocked && priceSignal > 0) {
        pattern = "Open drive up";
        summary = "Price is expanding above the opening structure with bullish control.";
        suggestions.push("Hold or enter only while VWAP remains supportive.");
    }

    suggestions.push(gateLocked ? "First 15-minute gate is still locked." : "First 15-minute gate is unlocked.");

    return {
        gate: gateLocked ? "LOCKED" : "UNLOCKED",
        pattern,
        summary,
        suggestions
    };
}

function buildMarketInterpretation(decision) {
    const components = Array.isArray(decision.components) ? decision.components : [];
    return components.map((component) => ({
        name: component.label,
        value: component.value,
        score: component.score,
        impact: getImpactLabel(component),
        interpretation: component.detail || "No interpretation available."
    }));
}

function renderEngineCompare(compare) {
    if (!compare?.enabled) {
        return "";
    }

    return `
        <div class="compare-block ${compare.conflict ? "warn" : "neutral"}">
            <div class="signal-head">
                <div>
                    <span>Compare mode</span>
                    <strong>${escapeHtml(compare.conflict ? "Engine conflict" : "Engine alignment")}</strong>
                </div>
                ${createStatusChip(compare.conflict ? "Conflict" : "Aligned", compare.conflict ? "warn" : "positive")}
            </div>
            <p class="signal-detail">${escapeHtml(compare.summary || "No compare summary is available.")}</p>
            <div class="compare-grid">
                <div class="compare-card">
                    <span>${escapeHtml(compare.primary?.engineLabel || "Primary")}</span>
                    <strong>${escapeHtml(compare.primary?.action || compare.primary?.status || "WAIT")}</strong>
                    <p class="stat-note">${escapeHtml(`${compare.primary?.confidence ?? 0}% | ${formatSignedNumber(compare.primary?.score)}`)}</p>
                </div>
                <div class="compare-card">
                    <span>${escapeHtml(compare.alternate?.engineLabel || "Alternate")}</span>
                    <strong>${escapeHtml(compare.alternate?.action || compare.alternate?.status || "WAIT")}</strong>
                    <p class="stat-note">${escapeHtml(`${compare.alternate?.confidence ?? 0}% | ${formatSignedNumber(compare.alternate?.score)}`)}</p>
                </div>
            </div>
        </div>
    `;
}

function updateHeroStatus(state, payload) {
    const decision = payload?.dashboard?.decision || {};
    const riskModel = buildRiskDimensions(payload);
    const decisionState = getDecisionState(decision, payload);
    const directionLabel = getDirectionLabel(decision.bias);
    const trend = state.decisionTrend || {};
    const confidenceTrend = trend.confidenceDirection || "FLAT";

    document.getElementById("heroStatusCard").className = `hero-status-card ${decisionState.tone}`;
    document.getElementById("heroStatusCard").innerHTML = `
        <div class="hero-status-top">
            <div>
                <span class="mini-label">V3 Decision Card</span>
                <strong>${escapeHtml(decisionState.label)}</strong>
            </div>
            <div class="inline-tags">
                ${createStatusChip(directionLabel, toneFromBias(decision.bias))}
                ${createStatusChip(`${decision.confidence ?? 0}% confidence`, "neutral")}
                ${createStatusChip(`Risk ${riskModel.overallLabel}`, riskTone(riskModel.overallLabel))}
            </div>
        </div>
        <div class="hero-metrics">
            ${createStatBox("State", decisionState.label)}
            ${createStatBox("Direction", directionLabel)}
            ${createStatBox("Confidence", `${decision.confidence ?? 0}%`, confidenceTrend)}
            ${createStatBox("Risk", riskModel.overallLabel, riskModel.positionSizeHint)}
        </div>
        <p class="hero-reason">${escapeHtml(decisionState.reason)}</p>
        <div class="hero-trend-row">
            <div>
                <span class="mini-label">Confidence trend</span>
                <strong>${escapeHtml(confidenceTrend)}</strong>
            </div>
            ${createSparkline(trend.series, "confidence")}
        </div>
    `;
}

function renderDecisionStatus(state, payload) {
    const decision = payload?.dashboard?.decision || {};
    const decisionState = getDecisionState(decision, payload);
    const blockers = getStatusBlockers(decision, payload);
    const triggers = getTradeTriggers(decision, payload);
    const riskModel = buildRiskDimensions(payload);
    const trend = state.decisionTrend || {};

    document.getElementById("decisionStatusPanel").innerHTML = `
        <div class="status-card ${decisionState.tone}">
            <div class="decision-top">
                <div>
                    <p class="mini-label">Status engine</p>
                    <h3 class="status-headline">${escapeHtml(decisionState.label)}</h3>
                </div>
                <div class="inline-tags">
                    ${createStatusChip(getDirectionLabel(decision.bias), toneFromBias(decision.bias))}
                    ${createStatusChip(`${decision.confidence ?? 0}%`, "neutral")}
                    ${createStatusChip(`Risk ${riskModel.overallLabel}`, riskTone(riskModel.overallLabel))}
                    ${createStatusChip(decision.engineLabel || "Engine", "neutral")}
                </div>
            </div>
            <div class="decision-summary">
                <p class="summary-copy">${escapeHtml(decision.summary || decisionState.reason || "No decision is available yet.")}</p>
                ${createScoreMeter(decision.scoreMeter || { minimum: -100, maximum: 100, value: decision.score || 0, label: decision.confidenceTag || "Neutral" })}
                <div class="trade-stats">
                    ${createStatBox("Current state", decisionState.label)}
                    ${createStatBox("Confidence", `${decision.confidence ?? 0}%`, decision.confidenceTag || "Weak")}
                    ${createStatBox("Previous confidence", trend.previous ? `${trend.previous.confidence}%` : "Unavailable", trend.confidenceDirection || "FLAT")}
                    ${createStatBox("Score delta", Number.isFinite(trend.scoreDelta) ? formatSignedNumber(trend.scoreDelta) : "Unavailable", Number.isFinite(trend.confidenceDelta) ? `Confidence ${formatSignedNumber(trend.confidenceDelta)}` : "")}
                    ${createStatBox("Direction", getDirectionLabel(decision.bias))}
                    ${createStatBox("Primary trigger", triggers[0] || "Wait for the next clean trigger.")}
                </div>
                <div class="status-columns">
                    <div class="status-block">
                        <span class="mini-label">Blockers</span>
                        <ul class="checklist">
                            ${(blockers.length ? blockers : ["No major blocker is active."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                        </ul>
                    </div>
                    <div class="status-block">
                        <span class="mini-label">Trigger conditions</span>
                        <ul class="checklist">
                            ${(triggers.length ? triggers : ["Wait for better alignment between trend, score, and price."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                        </ul>
                    </div>
                </div>
                ${renderEngineCompare(payload?.dashboard?.engineCompare)}
            </div>
        </div>
    `;
}

function renderTradeSuggestion(payload, activeTrade) {
    const plan = payload?.dashboard?.tradePlan;
    const decision = payload?.dashboard?.decision || {};
    const decisionState = getDecisionState(decision, payload);
    const tradeState = plan?.tradeState || decision.status || "WAIT";
    const tone = tradeState === "TRADE"
        ? toneFromStatus("TRADE", compactDirection(decision.action || decision.direction))
        : tradeState === "CONDITIONAL"
            ? "warn"
            : decisionState.tone;
    const alreadyActive = activeTrade?.planId && activeTrade.planId === plan?.planId;
    const contractType = plan?.contract?.optionType || decision.action || "WAIT";
    const stateLabel = tradeState === "CONDITIONAL" ? "CONDITIONAL TRADE" : tradeState;

    if (!plan?.contract) {
        document.getElementById("tradeSuggestionPanel").innerHTML = `
            <div class="trade-card ${decisionState.tone}">
                <div class="trade-head">
                    <div>
                        <p class="mini-label">Executable trade</p>
                        <h3 class="status-headline">${escapeHtml(decisionState.label)}</h3>
                    </div>
                    ${createStatusChip(decisionState.label, decisionState.tone)}
                </div>
                <p class="summary-copy">${escapeHtml(plan?.reason || decision.summary || "No high-quality setup is active.")}</p>
                <ul class="checklist">
                    ${(getTradeTriggers(decision, payload)).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
                </ul>
            </div>
        `;
        return;
    }

    document.getElementById("tradeSuggestionPanel").innerHTML = `
        <div class="trade-card ${tone}">
            <div class="trade-head">
                <div>
                    <p class="mini-label">Executable trade</p>
                    <h3 class="status-headline">${escapeHtml(stateLabel)}</h3>
                </div>
                <div class="inline-tags">
                    ${createStatusChip(decision.bias === "UP" ? "UP" : decision.bias === "DOWN" ? "DOWN" : "NEUTRAL", toneFromBias(decision.bias))}
                    ${createStatusChip(contractType, toneFromStatus("TRADE", compactDirection(contractType)))}
                    ${createStatusChip(decision.suggestedStrikeStyle || "ATM", "neutral")}
                </div>
            </div>
            <p class="summary-copy">${escapeHtml(plan.reason || decision.summary || "")}</p>
            <div class="trade-stats">
                ${createStatBox("Contract", plan.contract?.label || "Unavailable")}
                ${createStatBox("Strike type", decision.suggestedStrikeStyle || "ATM")}
                ${createStatBox("Entry condition", plan.entry?.triggerText || "Unavailable")}
                ${createStatBox("Stop loss", formatCurrency(plan.exit?.stopLoss))}
                ${createStatBox("Target 1", formatCurrency(plan.exit?.target1))}
                ${createStatBox("Target 2", formatCurrency(plan.exit?.target2))}
                ${createStatBox("Invalidation", formatNumber(plan.exit?.spotInvalidation), plan.exit?.invalidationText || "")}
                ${createStatBox("Structure", decision.optionsIntelligence?.suggestedStructure || "Unavailable")}
            </div>
            <div class="active-trade-meta">
                <p class="detail-copy"><strong>Entry:</strong> ${escapeHtml(plan.entry?.triggerText || "Wait for a clean entry.")}</p>
                <p class="detail-copy"><strong>Trail:</strong> ${escapeHtml(plan.exit?.trailText || "Unavailable")}</p>
                <p class="detail-copy">${escapeHtml(plan.sizing?.note || "")}</p>
            </div>
            <div class="toolbar-actions">
                <button type="button" class="primary-button" data-action="take-trade" ${(alreadyActive || !plan.actionable) ? "disabled" : ""}>${alreadyActive ? "Trade active" : plan.actionable ? "I took this trade" : tradeState === "CONDITIONAL" ? "Wait for trigger" : "Setup not ready"}</button>
                ${createLink(plan.sourceUrl, "Open live chain")}
            </div>
        </div>
    `;
}

function renderMarketOverview(payload) {
    const decision = payload?.dashboard?.decision || {};
    const interpretations = buildMarketInterpretation(decision);

    document.getElementById("marketOverviewPanel").innerHTML = `
        <div class="signal-grid">
            ${interpretations.map((item) => `
                <article class="signal-card ${item.score > 0 ? "bullish" : item.score < 0 ? "bearish" : "neutral"}">
                    <div class="signal-head">
                        <div>
                            <span>${escapeHtml(item.name)}</span>
                            <strong>${escapeHtml(item.value || "Unavailable")}</strong>
                            <p class="stat-note">${escapeHtml(item.impact)}</p>
                        </div>
                        <span class="component-score ${item.score > 0 ? "bullish" : item.score < 0 ? "bearish" : "neutral"}">${escapeHtml(formatSignedNumber(item.score))}</span>
                    </div>
                    <p class="signal-detail">${escapeHtml(item.interpretation)}</p>
                </article>
            `).join("")}
        </div>
    `;
}

function renderTrendOpening(payload) {
    const decision = payload?.dashboard?.decision || {};
    const playbook = buildOpeningPlaybook(decision);

    document.getElementById("trendOpeningPanel").innerHTML = `
        <div class="trend-stack">
            <div class="trend-card ${toneFromMarketType(decision.marketType?.code)}">
                <div class="signal-head">
                    <div>
                        <span>Market regime</span>
                        <strong>${escapeHtml(decision.marketType?.label || "Unavailable")}</strong>
                    </div>
                    ${createStatusChip(decision.marketType?.code || "SIDEWAYS", toneFromMarketType(decision.marketType?.code))}
                </div>
                <p class="signal-detail">${escapeHtml(decision.marketType?.detail || "Market regime is unavailable.")}</p>
            </div>

            <div class="trend-card ${toneFromTrap(decision.trap)}">
                <div class="signal-head">
                    <div>
                        <span>Opening playbook</span>
                        <strong>${escapeHtml(playbook.pattern)}</strong>
                    </div>
                    ${createStatusChip(`Gate ${playbook.gate}`, playbook.gate === "UNLOCKED" ? "positive" : "warn")}
                </div>
                <p class="signal-detail">${escapeHtml(playbook.summary)}</p>
                <ul class="checklist">
                    ${playbook.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
            </div>

            <div class="trend-card ${toneFromStatus(decision.hold?.status === "EXIT" ? "EXIT" : "TRADE", compactDirection(decision.action || decision.direction))}">
                <div class="signal-head">
                    <div>
                        <span>Trend structure</span>
                        <strong>${escapeHtml(decision.trend?.badge || "Sideways")}</strong>
                    </div>
                    ${createStatusChip(decision.trend?.regime || "SIDEWAYS", toneFromMarketType(decision.marketType?.code))}
                </div>
                <p class="signal-detail">${escapeHtml(decision.trend?.detail || "Trend structure is unavailable.")}</p>
            </div>

            <div class="trend-card ${decision.hold?.status === "EXIT" ? "negative" : decision.hold?.status === "HOLD" ? "positive" : "neutral"}">
                <div class="signal-head">
                    <div>
                        <span>Hold logic</span>
                        <strong>${escapeHtml(decision.hold?.headline || "Watch")}</strong>
                    </div>
                    ${createStatusChip(decision.hold?.status || "WATCH", decision.hold?.status === "EXIT" ? "negative" : decision.hold?.status === "HOLD" ? "positive" : "neutral")}
                </div>
                <p class="signal-detail">${escapeHtml(decision.hold?.detail || "No hold guidance is active.")}</p>
            </div>
        </div>
    `;
}

function renderSignalEngine(state, payload) {
    const decision = payload?.dashboard?.decision || {};
    const components = Array.isArray(decision.components) ? decision.components : [];
    const sortedComponents = [...components].sort((left, right) => Math.abs(Number(right.score || 0)) - Math.abs(Number(left.score || 0)));
    const trend = state.decisionTrend || {};
    const plainEnglish = [decision.summary, decision.marketType?.detail, decision.hold?.detail].filter(Boolean);

    document.getElementById("signalEnginePanel").innerHTML = `
        <div class="trend-stack">
            <div class="trend-card neutral">
                <div class="signal-head">
                    <div>
                        <span>Explainability</span>
                        <strong>Score breakdown</strong>
                    </div>
                    ${createStatusChip(`Net ${formatSignedNumber(decision.score)}`, decision.score > 0 ? "positive" : decision.score < 0 ? "negative" : "neutral")}
                </div>
                <div class="trade-stats">
                    ${createStatBox("Total score", formatSignedNumber(decision.score))}
                    ${createStatBox("Previous score", trend.previous ? formatSignedNumber(trend.previous.score) : "Unavailable")}
                    ${createStatBox("Score delta", Number.isFinite(trend.scoreDelta) ? formatSignedNumber(trend.scoreDelta) : "Unavailable", trend.scoreDirection || "FLAT")}
                    ${createStatBox("Confidence trend", trend.confidenceDirection || "FLAT", Number.isFinite(trend.confidenceDelta) ? formatSignedNumber(trend.confidenceDelta) : "")}
                </div>
                <div class="explainability-list">
                    ${sortedComponents.map((component) => `
                        <div class="explainability-row">
                            <div>
                                <span>${escapeHtml(component.label)}</span>
                                <p class="stat-note">${escapeHtml(`${component.value || "Unavailable"} | ${getImpactLabel(component)} | weight ${Number(component.weight || 0).toFixed(2)}`)}</p>
                            </div>
                            <strong class="${component.tone}">${escapeHtml(formatSignedNumber(component.score))}</strong>
                        </div>
                    `).join("")}
                </div>
                <ul class="checklist">
                    ${plainEnglish.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
                </ul>
            </div>

            <div class="signal-grid">
                ${components.map((component) => `
                    <article class="signal-card ${component.tone}">
                        <div class="signal-head">
                            <div>
                                <span>${escapeHtml(component.label)}</span>
                                <strong>${escapeHtml(component.value || "Unavailable")}</strong>
                                <p class="stat-note">${escapeHtml(`${getImpactLabel(component)} | weight ${Number(component.weight || 0).toFixed(2)}`)}</p>
                            </div>
                            <span class="component-score ${component.tone}">${escapeHtml(formatSignedNumber(component.score))}</span>
                        </div>
                        <p class="signal-detail">${escapeHtml(component.detail || "")}</p>
                    </article>
                `).join("")}
            </div>
        </div>
    `;
}

function renderActiveTrade(state, payload, activeTrade) {
    const monitor = payload?.dashboard?.tradeMonitor;

    if (!activeTrade) {
        document.getElementById("activeTradePanel").innerHTML = `
            <div class="active-trade-card neutral">
                <h3 class="status-headline">No active trade</h3>
                <p class="summary-copy">Use "I took this trade" after entry and the workstation will manage hold, trail, partial exit, or invalidation.</p>
            </div>
        `;
        return;
    }

    const actionTone = monitor?.action === "FULL_EXIT" || monitor?.action === "INVALIDATED"
        ? "negative"
        : monitor?.action === "TRAIL" || monitor?.action === "PARTIAL_EXIT"
            ? "warn"
            : "positive";

    document.getElementById("activeTradePanel").innerHTML = `
        <div class="active-trade-card ${actionTone}">
            <div class="trade-head">
                <div>
                    <p class="mini-label">Active trade state machine</p>
                    <h3 class="status-headline">${escapeHtml(monitor?.label || monitor?.action || "HOLD")}</h3>
                </div>
                ${createStatusChip(monitor?.label || monitor?.action || "HOLD", actionTone)}
            </div>
            <div class="trade-stats">
                ${createStatBox("Contract", activeTrade.label || `${activeTrade.instrument} ${activeTrade.strikePrice} ${activeTrade.optionType}`)}
                ${createStatBox("Entry", formatCurrency(activeTrade.entryPrice))}
                ${createStatBox("Current premium", formatCurrency(monitor?.currentPremium))}
                ${createStatBox("P/L", formatSignedPercent(monitor?.pnlPercent))}
                ${createStatBox("Current confidence", Number.isFinite(monitor?.currentConfidence) ? `${monitor.currentConfidence}%` : "Unavailable")}
                ${createStatBox("Previous confidence", Number.isFinite(state.decisionTrend?.previous?.confidence) ? `${state.decisionTrend.previous.confidence}%` : "Unavailable")}
                ${createStatBox("Trend", monitor?.confidenceTrend >= 4 ? "Rising" : monitor?.confidenceTrend <= -4 ? "Falling" : "Flat", Number.isFinite(monitor?.confidenceTrend) ? formatSignedNumber(monitor.confidenceTrend) : "")}
                ${createStatBox("Premium trend", monitor?.premiumTrend || "Unavailable", monitor?.timePressure ? `Time ${monitor.timePressure}` : "")}
            </div>
            <div class="hero-trend-row">
                <div>
                    <span class="mini-label">Confidence sparkline</span>
                    <strong>${escapeHtml(state.decisionTrend?.confidenceDirection || "FLAT")}</strong>
                </div>
                ${createSparkline(state.decisionTrend?.series, "confidence")}
            </div>
            <div class="active-trade-meta">
                <p class="detail-copy"><strong>Status:</strong> ${escapeHtml(monitor?.headline || "Waiting for the next refresh.")}</p>
                <p class="detail-copy">${escapeHtml(monitor?.detail || "The workstation will evaluate the trade again on the next refresh.")}</p>
                <p class="stat-note">Acknowledged ${escapeHtml(formatTimestamp(activeTrade.acknowledgedAt))}</p>
            </div>
        </div>
    `;
}

function renderRiskMeter(payload) {
    const riskModel = buildRiskDimensions(payload);
    const decision = payload?.dashboard?.decision || {};

    document.getElementById("riskMeterPanel").innerHTML = `
        <div class="risk-card neutral">
            <div class="signal-head">
                <div>
                    <span>Multi-dimensional risk</span>
                    <strong>${escapeHtml(riskModel.overallLabel)}</strong>
                </div>
                <div class="risk-score">${escapeHtml(String(riskModel.overallScore))}</div>
            </div>
            <p class="risk-copy">${escapeHtml(riskModel.positionSizeHint)}</p>
            <div class="risk-grid">
                ${riskModel.dimensions.map((item) => `
                    <div class="risk-dimension ${riskTone(item.level)}">
                        <div class="signal-head">
                            <div>
                                <span>${escapeHtml(item.label)}</span>
                                <strong>${escapeHtml(item.level)}</strong>
                            </div>
                            <span class="risk-mini-score">${escapeHtml(String(item.score))}</span>
                        </div>
                        <p class="signal-detail">${escapeHtml(item.detail)}</p>
                    </div>
                `).join("")}
            </div>
            <div class="chip-row">
                ${createStatusChip(`IV ${decision.optionsIntelligence?.ivTrend || "FLAT"}`, decision.optionsIntelligence?.ivTrend === "RISING" ? "positive" : decision.optionsIntelligence?.ivTrend === "FALLING" ? "warn" : "neutral")}
                ${createStatusChip(`Theta ${decision.optionsIntelligence?.thetaRisk || "Controlled"}`, decision.optionsIntelligence?.thetaRisk === "High" ? "negative" : "positive")}
                ${createStatusChip(decision.optionsIntelligence?.suggestedStructure || "WAIT", "neutral")}
            </div>
        </div>
    `;
}

function renderSourceHealth(payload) {
    const statuses = Array.isArray(payload?.sourceStatuses) ? payload.sourceStatuses : [];
    const feedHealth = payload?.dashboard?.feedHealth || {};
    const proxy = payload?.metadata?.proxy || feedHealth?.proxy || null;

    document.getElementById("sourceHealthPanel").innerHTML = `
        <div class="trend-stack">
            <div class="trend-card ${feedHealth.blocksTradeSignals ? "negative" : "neutral"}">
                <div class="signal-head">
                    <div>
                        <span>Feed guard</span>
                        <strong>${escapeHtml(feedHealth.blocksTradeSignals ? "NO ACTIONABLE SIGNAL - DATA STALE" : "Actionable data live")}</strong>
                    </div>
                    ${createStatusChip(proxy?.connected ? "Proxy connected" : "Proxy disconnected", proxy?.connected ? "positive" : "negative")}
                </div>
                <p class="signal-detail">${escapeHtml(feedHealth.summary || proxy?.detail || "Feed health is unavailable.")}</p>
                <div class="chip-row">
                    ${proxy ? createStatusChip(proxy.label || proxy.mode || "Proxy", proxy.connected ? "positive" : "negative") : ""}
                    ${feedHealth.staleCriticalSources?.length ? createStatusChip(`${feedHealth.staleCriticalSources.length} critical stale`, "negative") : createStatusChip("Critical fresh", "positive")}
                </div>
            </div>

            <div class="source-list">
                ${statuses.map((source) => {
                    const sourceState = source.stale
                        ? "Stale"
                        : source.status === "live"
                            ? "Live"
                            : source.status === "delayed" || source.status === "partial"
                                ? "Delayed"
                                : "Failed";
                    const sourceTone = sourceState === "Live" ? "positive" : sourceState === "Delayed" ? "warn" : "negative";

                    return `
                        <article class="source-card">
                            <div class="source-head">
                                <div>
                                    <span>${escapeHtml(source.label || "Source")}</span>
                                    <strong>${escapeHtml(source.source || "Unknown source")}</strong>
                                </div>
                                ${createStatusChip(sourceState, sourceTone)}
                            </div>
                            <p class="source-note">${escapeHtml(source.message || "No source message available.")}</p>
                            <p class="source-note">${escapeHtml(source.lastUpdated ? `Updated ${formatTimestamp(source.lastUpdated)}` : "No timestamp available")}</p>
                            <p class="source-note">${escapeHtml(source.freshnessLabel || "No freshness label")}${source.critical ? " | critical" : ""}</p>
                            ${createLink(source.sourceUrl, "Open source")}
                        </article>
                    `;
                }).join("")}
            </div>
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
    banner.textContent = `${monitor.label || monitor.action}: ${monitor.headline}. ${monitor.detail}`;
}

export function renderDashboard(state, payload) {
    document.getElementById("lastUpdated").textContent = formatTimestamp(payload?.generatedAt);
    document.getElementById("buildVersion").textContent = payload?.metadata?.version || "unknown";
    updateHeroStatus(state, payload);
    renderDecisionStatus(state, payload);
    renderTradeSuggestion(payload, state.activeTrade);
    renderMarketOverview(payload);
    renderTrendOpening(payload);
    renderSignalEngine(state, payload);
    renderActiveTrade(state, payload, state.activeTrade);
    renderRiskMeter(payload);
    renderSourceHealth(payload);
    renderAlertBanner(payload, state.activeTrade);
}
