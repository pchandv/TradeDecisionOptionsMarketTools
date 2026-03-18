const STORAGE_KEYS = {
    settings: "live-market-dashboard.settings",
    activeTrade: "live-market-dashboard.activeTrade",
    lastAlert: "live-market-dashboard.lastAlert"
};

const DEFAULT_SETTINGS = {
    capital: 100000,
    riskPercent: 1,
    instrument: "NIFTY",
    strikeStyle: "ATM",
    expiryPreference: "current",
    lotSize: ""
};

const state = {
    timerId: null,
    autoRefresh: false,
    intervalMs: 60000,
    newsTab: "india",
    newsCategories: null,
    dashboardPayload: null,
    settings: { ...DEFAULT_SETTINGS },
    activeTrade: null,
    deferredInstallPrompt: null,
    isLoading: false,
    pendingReload: false,
    requestController: null
};

const numberFormatter = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
});

function isBrowserStandaloneMode() {
    return document.body?.dataset?.appMode === "browser-standalone";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function readStorageJson(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeStorageJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function removeStorageKey(key) {
    localStorage.removeItem(key);
}

function normalizePositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function hasUsablePrice(item) {
    return Boolean(item) && Number.isFinite(item.price);
}

function formatMarketValue(item) {
    if (!hasUsablePrice(item)) {
        return "Unavailable";
    }
    return numberFormatter.format(item.price);
}

function formatNumber(value) {
    return Number.isFinite(value) ? numberFormatter.format(value) : "Unavailable";
}

function formatCurrency(value) {
    return Number.isFinite(value) ? `Rs ${numberFormatter.format(value)}` : "Unavailable";
}

function formatSignedPercent(value) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(2)}%`;
}

function formatSignedNumber(value) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${numberFormatter.format(Number(value.toFixed(2)))}`;
}

function formatTimestamp(timestamp) {
    if (!timestamp) {
        return "Unavailable";
    }
    return new Date(timestamp).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function toneFromNumber(value) {
    if (!Number.isFinite(value)) {
        return "neutral";
    }
    if (value > 0) {
        return "positive";
    }
    if (value < 0) {
        return "negative";
    }
    return "neutral";
}

function toneFromSignal(signal) {
    const normalized = String(signal || "").toLowerCase();
    if (normalized.includes("bull") || normalized.includes("ce") || normalized.includes("call")) {
        return "bullish";
    }
    if (normalized.includes("bear") || normalized.includes("pe") || normalized.includes("put")) {
        return "bearish";
    }
    if (normalized.includes("exit") || normalized.includes("risk") || normalized.includes("invalid")) {
        return "risk";
    }
    return "sideways";
}

function formatStatusLabel(status) {
    const raw = String(status || "unavailable");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function createSourceLink(url, label = "View source") {
    if (!url) {
        return "";
    }

    return `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function createSourceFooter(source, sourceUrl, label = "View source") {
    if (!source && !sourceUrl) {
        return "";
    }

    return `
        <div class="card-actions">
            <span class="card-source">${escapeHtml(source || "Source unavailable")}</span>
            ${createSourceLink(sourceUrl, label)}
        </div>
    `;
}

function createPrimaryNote(item) {
    if (!item) {
        return "Unavailable";
    }

    if (item.reason && item.status !== "live") {
        return item.reason;
    }

    if (item.updatedAt) {
        return `Updated ${formatTimestamp(item.updatedAt)}`;
    }

    return "Timestamp unavailable";
}

function getTopDrivers(signal) {
    return (signal.breakdown || [])
        .filter((row) => Number.isFinite(row.score) && row.score !== 0)
        .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
        .slice(0, 3);
}

function toQuickLabel(value, neutralLabel = "WAIT") {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("bull")) {
        return "UP";
    }
    if (normalized.includes("bear")) {
        return "DOWN";
    }
    if (normalized.includes("neutral") || normalized.includes("sideways") || normalized.includes("mixed")) {
        return neutralLabel;
    }
    return String(value || neutralLabel);
}

function toQuickEffect(value) {
    return toQuickLabel(value, "WAIT");
}

function getCoreFeedGaps(dashboard) {
    const checks = [
        dashboard.india.nifty,
        dashboard.india.bankNifty,
        dashboard.india.giftNifty,
        dashboard.india.indiaVix,
        dashboard.macro.dxy,
        dashboard.macro.us10y,
        dashboard.macro.crude
    ];

    return checks.filter((item) => !hasUsablePrice(item)).map((item) => item?.label || "Unavailable feed");
}

function aggregateFeedStatus(statuses) {
    const counts = {
        live: statuses.filter((item) => item.status === "live").length,
        delayed: statuses.filter((item) => item.status === "delayed").length,
        error: statuses.filter((item) => item.status === "error").length,
        unavailable: statuses.filter((item) => item.status === "unavailable").length
    };
    const total = statuses.length;
    const healthy = counts.live + counts.delayed;

    if (!total) {
        return { status: "unavailable", counts, total, healthy };
    }
    if (healthy === 0 && (counts.error > 0 || counts.unavailable > 0)) {
        return { status: counts.error > 0 ? "error" : "unavailable", counts, total, healthy };
    }
    if (healthy === total && counts.live === total) {
        return { status: "live", counts, total, healthy };
    }
    if (healthy === total) {
        return { status: "delayed", counts, total, healthy };
    }
    return { status: "partial", counts, total, healthy };
}

function buildFeedHealthGroups(sourceStatuses) {
    const groups = [
        {
            key: "nse",
            label: "NSE",
            hint: isBrowserStandaloneMode() ? "India cash, options, flows" : "India cash, options, flows",
            items: (sourceStatuses || []).filter((item) => item.key.startsWith("nse"))
        },
        {
            key: "yahoo",
            label: "Yahoo",
            hint: "Global and macro",
            items: (sourceStatuses || []).filter((item) => item.key.startsWith("yahoo"))
        },
        {
            key: "news",
            label: "News",
            hint: "India, US, macro headlines",
            items: (sourceStatuses || []).filter((item) => item.key.endsWith("News"))
        }
    ];

    return groups.map((group) => {
        const summary = aggregateFeedStatus(group.items);
        let note = `${summary.healthy}/${summary.total} feeds ready.`;

        if (group.key === "nse" && isBrowserStandaloneMode() && (summary.status === "partial" || summary.status === "error" || summary.status === "unavailable")) {
            note = "Browser-mode NSE can be partial or blocked on some refreshes.";
        } else if (summary.status === "live") {
            note = `${summary.total}/${summary.total} feeds live.`;
        } else if (summary.status === "delayed") {
            note = `${summary.healthy}/${summary.total} feeds ready, some delayed.`;
        } else if (summary.status === "partial") {
            note = `${summary.healthy}/${summary.total} feeds ready, some blocked.`;
        } else if (summary.status === "error" || summary.status === "unavailable") {
            note = "No reliable live feeds right now.";
        }

        return {
            ...group,
            ...summary,
            note
        };
    });
}

function renderFeedHealthStrip(sourceStatuses, metadata = {}) {
    const container = document.getElementById("feedHealthStrip");
    if (!container) {
        return;
    }

    const groups = buildFeedHealthGroups(sourceStatuses);
    const modeLabel = isBrowserStandaloneMode()
        ? "Browser Standalone"
        : "Server Assisted";
    const modeNote = isBrowserStandaloneMode()
        ? "Direct browser fetches. Best for GitHub Pages or static hosting."
        : "Uses the local Node proxy for source access.";

    container.innerHTML = `
        <article class="feed-health-card mode">
            <div class="feed-health-topline">
                <h3>Mode</h3>
                <span class="status-chip ${isBrowserStandaloneMode() ? "delayed" : "live"}">${escapeHtml(modeLabel)}</span>
            </div>
            <p class="feed-health-copy">${escapeHtml(modeNote)}</p>
            <p class="feed-health-foot">Version ${escapeHtml(metadata.version || "unknown")}</p>
        </article>
        ${groups.map((group) => `
            <article class="feed-health-card">
                <div class="feed-health-topline">
                    <h3>${escapeHtml(group.label)}</h3>
                    <span class="status-chip ${group.status}">${escapeHtml(formatStatusLabel(group.status))}</span>
                </div>
                <p class="feed-health-copy">${escapeHtml(group.hint)}</p>
                <p class="feed-health-foot">${escapeHtml(group.note)}</p>
            </article>
        `).join("")}
    `;
}

function buildTraderAction(signal, session, dashboard) {
    const feedGaps = getCoreFeedGaps(dashboard);
    const leadRisk = signal.risks && signal.risks.length ? signal.risks[0].label : "Price action rejects the current bias.";
    const sessionMode = session?.mode || "UNKNOWN";

    if (sessionMode === "POSTCLOSE" || sessionMode === "CLOSED") {
        return {
            label: "PLAN NEXT SESSION",
            tone: "wait",
            note: "Use this dashboard to prepare the next session, not to force a fresh options entry now.",
            trigger: "Carry forward only setups that still align after the next open.",
            invalidation: "Overnight macro, global cues, and opening price action can reset the setup."
        };
    }

    if (feedGaps.length >= 3) {
        return {
            label: "STAND ASIDE",
            tone: "risk",
            note: "Too many core feeds are missing to trust an aggressive options entry.",
            trigger: "Wait for feed recovery or clean post-open structure.",
            invalidation: "Any fresh trade before feed recovery has low reliability."
        };
    }

    if (signal.cePeBias === "No trade" || signal.confidence < 55) {
        return {
            label: sessionMode === "PREOPEN" ? "WAIT FOR OPEN" : "WAIT FOR CONFIRMATION",
            tone: "wait",
            note: "The edge is not clean enough for a fresh trade. Let price confirm direction first.",
            trigger: "Only act when price action and the live bias agree.",
            invalidation: leadRisk
        };
    }

    if (signal.cePeBias === "CE bias") {
        return {
            label: sessionMode === "PREOPEN" ? "CALLS IF OPEN CONFIRMS" : "CALLS ON CONFIRMATION",
            tone: "bullish",
            note: "Bias is up, but wait for strength to hold before buying calls.",
            trigger: "Look for the opening range to hold and banks to support.",
            invalidation: leadRisk
        };
    }

    if (signal.cePeBias === "PE bias") {
        return {
            label: sessionMode === "PREOPEN" ? "PUTS IF OPEN CONFIRMS" : "PUTS ON CONFIRMATION",
            tone: "bearish",
            note: "Bias is down, but wait for weakness to hold before buying puts.",
            trigger: "Look for rejection of the opening range with weak breadth.",
            invalidation: leadRisk
        };
    }

    return {
        label: "WAIT",
        tone: "wait",
        note: "There is no actionable edge yet.",
        trigger: "Stand aside until signal quality improves.",
        invalidation: leadRisk
    };
}

function renderDataGapBanner(dashboard, sourceStatuses) {
    const banner = document.getElementById("dataGapBanner");
    const coreFeedGaps = getCoreFeedGaps(dashboard);
    const brokenSources = (sourceStatuses || [])
        .filter((source) => source.status === "error" || source.status === "unavailable")
        .map((source) => source.label);
    const uniqueItems = [...new Set([...coreFeedGaps, ...brokenSources])];

    if (!uniqueItems.length) {
        banner.hidden = true;
        banner.innerHTML = "";
        return;
    }

    banner.hidden = false;
    banner.innerHTML = `
        <div class="data-gap-content">
            <strong>Read with caution:</strong>
            <span>${escapeHtml(uniqueItems.slice(0, 5).join(", "))}${uniqueItems.length > 5 ? " and more" : ""} are currently missing or degraded.</span>
        </div>
    `;
}

function createSummaryCard(item) {
    return `
        <article class="summary-card">
            <div class="card-topline">
                <h3>${escapeHtml(item.label)}</h3>
                <span class="mini-status ${item.status || "unavailable"}">${escapeHtml(formatStatusLabel(item.status))}</span>
            </div>
            <div class="summary-price">${formatMarketValue(item)}</div>
            <div class="summary-change ${toneFromNumber(item.changePercent)}">${formatSignedPercent(item.changePercent)}</div>
            <p class="summary-note">${escapeHtml(createPrimaryNote(item))}</p>
            ${createSourceFooter(item.source, item.sourceUrl)}
        </article>
    `;
}

function renderSummaryCards(cards) {
    document.getElementById("summaryCards").innerHTML = cards.map(createSummaryCard).join("");
}

function renderSignalOverview(signal, session, dashboard) {
    const topDrivers = getTopDrivers(signal);
    const traderAction = buildTraderAction(signal, session, dashboard);
    const quickDirection = signal.quick?.direction || toQuickLabel(signal.marketSignal);
    const quickOptions = signal.quick?.options || "WAIT";
    const quickConviction = signal.quick?.conviction || "LOW";
    const sessionLabel = session?.label ? session.label.toUpperCase() : "SESSION UNKNOWN";
    const sessionNote = session?.note || "Use the dashboard with confirmation from live price action.";

    document.getElementById("signalOverview").innerHTML = `
        <div class="decision-grid">
            <div class="signal-banner ${toneFromSignal(signal.marketSignal)}">
                <div class="signal-headline">
                    <div>
                        <p class="eyebrow">Direction</p>
                        <h2>${escapeHtml(quickDirection)}</h2>
                        <p class="signal-summary-copy">${escapeHtml(signal.summary?.plainEnglish || "Live direction summary is unavailable right now.")}</p>
                    </div>
                    <div class="confidence-orb">
                        <span>Conviction</span>
                        <strong>${escapeHtml(quickConviction)}</strong>
                    </div>
                </div>
                <div class="tag-row">
                    <span class="signal-chip">${escapeHtml(sessionLabel)}</span>
                    <span class="signal-chip ${toneFromSignal(signal.cePeBias)}">${escapeHtml(quickOptions)}</span>
                    <span class="signal-chip">${escapeHtml(signal.openingBias.toUpperCase())}</span>
                    <span class="signal-chip">${escapeHtml(signal.intradayBias.toUpperCase())}</span>
                </div>
                ${topDrivers.length ? `
                    <div class="driver-strip">
                        ${topDrivers.map((row) => `<span class="driver-pill">${escapeHtml(row.parameter)}</span>`).join("")}
                    </div>
                ` : ""}
                <p class="summary-note">${escapeHtml(sessionNote)}${session?.estimated ? " Session estimated from India time because the live market status feed is unavailable." : ""}</p>
            </div>

            <div class="trade-plan-card ${traderAction.tone}">
                <p class="eyebrow">Trader Action</p>
                <h3>${escapeHtml(traderAction.label)}</h3>
                <p class="signal-summary-copy">${escapeHtml(traderAction.note)}</p>
                <div class="plan-grid">
                    <div class="plan-item">
                        <span>Direction</span>
                        <strong>${escapeHtml(quickDirection)}</strong>
                    </div>
                    <div class="plan-item">
                        <span>Options</span>
                        <strong>${escapeHtml(quickOptions)}</strong>
                    </div>
                    <div class="plan-item">
                        <span>Session</span>
                        <strong>${escapeHtml(sessionLabel)}</strong>
                    </div>
                    <div class="plan-item">
                        <span>Confidence</span>
                        <strong>${escapeHtml(String(signal.confidence))}%</strong>
                    </div>
                </div>
                <p class="plan-copy"><strong>Trigger:</strong> ${escapeHtml(traderAction.trigger)}</p>
                <p class="plan-copy"><strong>Invalidation:</strong> ${escapeHtml(traderAction.invalidation)}</p>
            </div>
        </div>

        <div class="signal-metrics">
            <div class="metric-card">
                <h3>Why now</h3>
                <p class="signal-summary-copy">${escapeHtml(signal.summary?.whyItLooksThisWay || "No clear driver summary is available.")}</p>
            </div>
            <div class="metric-card">
                <h3>What to do now</h3>
                <p class="signal-summary-copy">${escapeHtml(signal.summary?.tradePosture || "Wait until the live setup becomes clearer.")}</p>
            </div>
        </div>
    `;
}

function renderSignalBreakdown(breakdown) {
    document.getElementById("signalBreakdownBody").innerHTML = breakdown.map((row) => `
        <tr>
            <td><strong>${escapeHtml(row.parameter)}</strong></td>
            <td>${escapeHtml(row.currentValue)}</td>
            <td>${escapeHtml(row.interpretation)}</td>
            <td><span class="score-tag ${toneFromNumber(row.score)}">${formatSignedNumber(row.score)}</span></td>
            <td>${escapeHtml(toQuickEffect(row.effect))}</td>
        </tr>
    `).join("");
}

function renderNarrative(narrative) {
    document.getElementById("narrativePanel").innerHTML = `
        <div class="narrative-card">
            <h3>Options map</h3>
            <p class="narrative-copy"><strong>Support:</strong> ${escapeHtml(narrative.optionLevels.support)}</p>
            <p class="narrative-copy"><strong>Resistance:</strong> ${escapeHtml(narrative.optionLevels.resistance)}</p>
            ${createSourceFooter("NSE Option Chain", narrative.optionLevels.sourceUrl)}
        </div>
        <div class="narrative-card">
            <h3>Institutional flows</h3>
            <p class="narrative-copy"><strong>FII/FPI:</strong> ${escapeHtml(narrative.institutionalFlows.fii)}</p>
            <p class="narrative-copy"><strong>DII:</strong> ${escapeHtml(narrative.institutionalFlows.dii)}</p>
            ${createSourceFooter("NSE FII/DII", narrative.institutionalFlows.sourceUrl)}
        </div>
        <div class="narrative-card">
            <h3>Macro snapshot</h3>
            <p class="narrative-copy">${escapeHtml(narrative.macroSummary)}</p>
            <p class="summary-note">Direct links are available in the expanded macro section below.</p>
        </div>
    `;
}

function createMarketRow(item) {
    return `
        <article class="market-row">
            <div class="market-row-main">
                <div class="row-title">
                    <strong>${escapeHtml(item.label)}</strong>
                    <span class="mini-status ${item.status || "unavailable"}">${escapeHtml(formatStatusLabel(item.status))}</span>
                </div>
                <p class="row-note">${escapeHtml(createPrimaryNote(item))}</p>
            </div>
            <div class="market-row-side">
                <strong>${formatMarketValue(item)}</strong>
                <span class="market-change ${toneFromNumber(item.changePercent)}">${formatSignedPercent(item.changePercent)}</span>
                ${createSourceLink(item.sourceUrl, "Source")}
            </div>
        </article>
    `;
}

function renderGlobalAndMacro(dashboard) {
    document.getElementById("globalMarketGrid").innerHTML = Object.values(dashboard.global).map(createMarketRow).join("");
    document.getElementById("macroGrid").innerHTML = Object.values(dashboard.macro).map(createMarketRow).join("");
}

function createNewsCard(item) {
    return `
        <article class="news-card">
            <div class="tag-row">
                <span class="sentiment-tag ${item.sentiment.toLowerCase()}">${escapeHtml(item.sentiment)}</span>
                <span class="impact-tag">${escapeHtml(item.impact)}</span>
            </div>
            <h4>${escapeHtml(item.title)}</h4>
            <p class="news-effect">${escapeHtml(item.likelyMarketEffect)}</p>
            <div class="card-actions">
                <span class="card-source">${escapeHtml(item.source || "Unknown source")} | ${escapeHtml(formatTimestamp(item.publishedAt))}</span>
                ${createSourceLink(item.link, "Read article")}
            </div>
        </article>
    `;
}

function renderActiveNewsTab() {
    const container = document.getElementById("activeNewsList");
    const categories = state.newsCategories || {};
    const activeBucket = categories[state.newsTab];
    const fallbackBucket = categories.india || categories.us || categories.macro || { items: [] };
    const bucket = activeBucket && Array.isArray(activeBucket.items) ? activeBucket : fallbackBucket;
    const items = (bucket.items || []).slice(0, 3);

    container.innerHTML = items.length
        ? items.map(createNewsCard).join("")
        : `<article class="news-card"><p class="news-effect">No live headlines available right now.</p></article>`;
}

function syncNewsTabs() {
    document.querySelectorAll(".news-tab").forEach((button) => {
        const isActive = button.dataset.newsTab === state.newsTab;
        button.classList.toggle("is-active", isActive);
    });
}

function renderNews(news) {
    state.newsCategories = news.categories || {};
    const quickNews = toQuickLabel(news.aggregate.stance, "MIXED");

    document.getElementById("newsImpactSummary").innerHTML = `
        <div class="news-impact-head">
            <div>
                <p class="eyebrow">News-only signal</p>
                <h3>${escapeHtml(quickNews)}</h3>
            </div>
            <div class="tag-row">
                <span class="signal-chip">${formatSignedNumber(news.aggregate.score)} score</span>
                <span class="signal-chip">${news.aggregate.highImpactCount} high-impact</span>
            </div>
        </div>
        <p class="signal-summary-copy">${escapeHtml(news.aggregate.summary)}</p>
        <p class="summary-note">This changes the setup, but it does not replace the main market call above.</p>
    `;

    const counts = {
        india: state.newsCategories.india?.items?.length || 0,
        us: state.newsCategories.us?.items?.length || 0,
        macro: state.newsCategories.macro?.items?.length || 0
    };

    document.querySelector('[data-news-tab="india"]').textContent = `India (${counts.india})`;
    document.querySelector('[data-news-tab="us"]').textContent = `US (${counts.us})`;
    document.querySelector('[data-news-tab="macro"]').textContent = `Macro (${counts.macro})`;

    syncNewsTabs();
    renderActiveNewsTab();
}

function createChecklist(items) {
    return `
        <ul class="checklist">
            ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
    `;
}

function renderStrategy(strategy) {
    document.getElementById("strategyPanel").innerHTML = `
        <div class="strategy-card">
            <h3>CE conditions</h3>
            ${createChecklist(strategy.ceConditions)}
        </div>
        <div class="strategy-card">
            <h3>PE conditions</h3>
            ${createChecklist(strategy.peConditions)}
        </div>
        <div class="strategy-card">
            <h3>No-trade conditions</h3>
            ${createChecklist(strategy.noTradeConditions)}
        </div>
        <div class="strategy-card">
            <h3>Volatility warning</h3>
            <p class="narrative-copy">${escapeHtml(strategy.volatilityWarning)}</p>
            <p class="narrative-copy">${escapeHtml(strategy.first15MinuteRule)}</p>
        </div>
    `;
}

function renderRisks(risks) {
    document.getElementById("riskPanel").innerHTML = risks.map((risk) => `
        <div class="risk-card ${risk.severity}">
            <h3>${escapeHtml(risk.label)}</h3>
            <p class="narrative-copy">${escapeHtml(risk.detail)}</p>
        </div>
    `).join("");
}

function renderSourceStatuses(sourceStatuses) {
    document.getElementById("sourceStatusList").innerHTML = sourceStatuses.map((source) => `
        <article class="source-row">
            <div class="source-row-main">
                <div class="row-title">
                    <strong>${escapeHtml(source.label)}</strong>
                    <span class="status-chip ${source.status}">${escapeHtml(formatStatusLabel(source.status))}</span>
                </div>
                <p class="row-note">${escapeHtml(source.message)}</p>
                <p class="row-note">${source.lastUpdated ? `Updated ${escapeHtml(formatTimestamp(source.lastUpdated))}` : "No timestamp available"}</p>
            </div>
            <div class="source-row-side">
                <span class="card-source">${escapeHtml(source.source || "Unknown source")}</span>
                ${createSourceLink(source.sourceUrl, "Open source")}
            </div>
        </article>
    `).join("");
}

function createActionBadge(label, tone = "sideways") {
    return `<span class="action-badge ${tone}">${escapeHtml(label)}</span>`;
}

function bindTakeTradeButton() {
    const button = document.getElementById("takeTradeBtn");
    if (!button) {
        return;
    }

    button.addEventListener("click", () => {
        const plan = state.dashboardPayload?.dashboard?.tradePlan;
        if (!plan?.actionable) {
            return;
        }

        state.activeTrade = {
            planId: plan.planId,
            instrument: plan.contract.symbol,
            optionType: plan.contract.optionType,
            strikePrice: plan.contract.strikePrice,
            expiry: plan.contract.expiry,
            entryPrice: plan.entry.premiumReference,
            stopLoss: plan.exit.stopLoss,
            target1: plan.exit.target1,
            target2: plan.exit.target2,
            spotInvalidation: plan.exit.spotInvalidation,
            lotSize: normalizePositiveNumber(state.settings.lotSize),
            maxLots: plan.sizing.maxLots,
            acknowledgedAt: new Date().toISOString(),
            label: plan.contract.label
        };

        writeStorageJson(STORAGE_KEYS.activeTrade, state.activeTrade);
        removeStorageKey(STORAGE_KEYS.lastAlert);
        loadDashboard({ userInitiated: true });
    });
}

function renderTradePlan(plan) {
    const panel = document.getElementById("tradePlanPanel");

    if (!plan?.actionable) {
        panel.innerHTML = `
            <div class="trade-suggestion-card wait">
                <div class="trade-suggestion-head">
                    <div>
                        <p class="eyebrow">Trade Suggestion</p>
                        <h3>${escapeHtml(plan?.notation || "WAIT")}</h3>
                    </div>
                    ${createActionBadge(plan?.notation || "WAIT", "sideways")}
                </div>
                <p class="signal-summary-copy">${escapeHtml(plan?.reason || "The app cannot suggest a live options trade right now.")}</p>
                ${plan?.sourceUrl ? createSourceFooter("Live option chain", plan.sourceUrl) : ""}
            </div>
        `;
        return;
    }

    const activePlanId = state.activeTrade?.planId;
    const alreadyTaken = activePlanId && activePlanId === plan.planId;

    panel.innerHTML = `
        <div class="trade-suggestion-card ${toneFromSignal(plan.notation)}">
            <div class="trade-suggestion-head">
                <div>
                    <p class="eyebrow">Trade Suggestion</p>
                    <h3>${escapeHtml(plan.title)}</h3>
                </div>
                ${createActionBadge(plan.notation, toneFromSignal(plan.notation))}
            </div>
            <p class="signal-summary-copy">${escapeHtml(plan.reason)}</p>

            <div class="trade-contract-grid">
                <div class="trade-stat">
                    <span>Contract</span>
                    <strong>${escapeHtml(plan.contract.label)}</strong>
                </div>
                <div class="trade-stat">
                    <span>Current premium</span>
                    <strong>${escapeHtml(formatCurrency(plan.contract.lastPrice))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Entry zone</span>
                    <strong>${escapeHtml(plan.entry.zoneLabel)}</strong>
                </div>
                <div class="trade-stat">
                    <span>Spot trigger</span>
                    <strong>${escapeHtml(formatNumber(plan.entry.spotTrigger))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Stop loss</span>
                    <strong>${escapeHtml(formatCurrency(plan.exit.stopLoss))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Target 1 / Target 2</span>
                    <strong>${escapeHtml(`${formatCurrency(plan.exit.target1)} / ${formatCurrency(plan.exit.target2)}`)}</strong>
                </div>
                <div class="trade-stat">
                    <span>Max contracts</span>
                    <strong>${escapeHtml(plan.sizing.maxContracts !== null ? String(plan.sizing.maxContracts) : "Unavailable")}</strong>
                </div>
                <div class="trade-stat">
                    <span>Max lots</span>
                    <strong>${escapeHtml(plan.sizing.maxLots !== null ? String(plan.sizing.maxLots) : "Set lot size")}</strong>
                </div>
            </div>

            <div class="trade-guidance">
                <p class="plan-copy"><strong>Trigger:</strong> ${escapeHtml(plan.entry.triggerText)}</p>
                <p class="plan-copy"><strong>Invalidation:</strong> ${escapeHtml(plan.exit.invalidationText)}</p>
                <p class="plan-copy"><strong>Trail:</strong> ${escapeHtml(plan.exit.trailText)}</p>
                <p class="plan-copy"><strong>Time exit:</strong> ${escapeHtml(plan.exit.timeExitText)}</p>
                <p class="summary-note">${escapeHtml(plan.sizing.note)}</p>
            </div>

            <div class="checklist-card">
                <h4>Before you take it</h4>
                ${createChecklist(plan.checklist || [])}
            </div>

            <div class="trade-plan-actions">
                <button id="takeTradeBtn" type="button">${alreadyTaken ? "Trade Already Active" : "I Took This Trade"}</button>
                ${createSourceLink(plan.sourceUrl, "Open live chain")}
            </div>
        </div>
    `;

    const button = document.getElementById("takeTradeBtn");
    if (button && alreadyTaken) {
        button.disabled = true;
    }

    bindTakeTradeButton();
}

function renderTradeAlert(monitor) {
    const banner = document.getElementById("tradeAlertBanner");

    if (!state.activeTrade || !monitor) {
        banner.hidden = true;
        banner.innerHTML = "";
        return;
    }

    const tone = toneFromSignal(monitor.action);
    banner.hidden = false;
    banner.innerHTML = `
        <div class="trade-alert-content ${tone}">
            ${createActionBadge(monitor.action, tone)}
            <div>
                <strong>${escapeHtml(monitor.headline)}</strong>
                <p>${escapeHtml(monitor.detail)}</p>
            </div>
        </div>
    `;
}

function renderActiveTrade(monitor) {
    const panel = document.getElementById("activeTradePanel");

    if (!state.activeTrade) {
        panel.innerHTML = `
            <div class="active-trade-card">
                <h3>No active trade stored</h3>
                <p class="summary-note">When you click <strong>I Took This Trade</strong>, the dashboard will start checking hold versus exit on every refresh.</p>
            </div>
        `;
        return;
    }

    const monitorAction = monitor?.action || "CHECK";
    const tone = toneFromSignal(monitorAction);

    panel.innerHTML = `
        <div class="active-trade-card ${tone}">
            <div class="trade-suggestion-head">
                <div>
                    <p class="eyebrow">Tracked contract</p>
                    <h3>${escapeHtml(state.activeTrade.label || `${state.activeTrade.instrument} ${state.activeTrade.strikePrice} ${state.activeTrade.optionType}`)}</h3>
                </div>
                ${createActionBadge(monitorAction, tone)}
            </div>
            <div class="trade-contract-grid compact">
                <div class="trade-stat">
                    <span>Entry</span>
                    <strong>${escapeHtml(formatCurrency(state.activeTrade.entryPrice))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Stop</span>
                    <strong>${escapeHtml(formatCurrency(state.activeTrade.stopLoss))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Target 1</span>
                    <strong>${escapeHtml(formatCurrency(state.activeTrade.target1))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Target 2</span>
                    <strong>${escapeHtml(formatCurrency(state.activeTrade.target2))}</strong>
                </div>
                <div class="trade-stat">
                    <span>Current premium</span>
                    <strong>${escapeHtml(formatCurrency(monitor?.currentPremium))}</strong>
                </div>
                <div class="trade-stat">
                    <span>P/L %</span>
                    <strong>${escapeHtml(formatSignedPercent(monitor?.pnlPercent))}</strong>
                </div>
            </div>
            <p class="plan-copy"><strong>Status:</strong> ${escapeHtml(monitor?.headline || "Waiting for the next live refresh.")}</p>
            <p class="summary-note">${escapeHtml(monitor?.detail || "The app will evaluate this trade again on the next refresh.")}</p>
            <p class="summary-note">Acknowledged ${escapeHtml(formatTimestamp(state.activeTrade.acknowledgedAt))}</p>
            <div class="trade-plan-actions">
                <button id="clearTradeInlineBtn" type="button" class="secondary-button">Clear Active Trade</button>
                ${createSourceLink(monitor?.sourceUrl, "View live chain")}
            </div>
        </div>
    `;

    const clearInline = document.getElementById("clearTradeInlineBtn");
    if (clearInline) {
        clearInline.addEventListener("click", clearActiveTrade);
    }
}

function maybeNotifyTradeMonitor(monitor) {
    if (!state.activeTrade || !monitor?.alertKey) {
        return;
    }

    const previous = localStorage.getItem(STORAGE_KEYS.lastAlert);
    if (previous === monitor.alertKey) {
        return;
    }

    localStorage.setItem(STORAGE_KEYS.lastAlert, monitor.alertKey);

    if ("Notification" in window && Notification.permission === "granted") {
        const title = `Trade update: ${monitor.action}`;
        const body = `${monitor.headline}. ${monitor.detail}`;
        new Notification(title, {
            body,
            icon: isBrowserStandaloneMode() ? "./icon.svg" : "/icon.svg",
            tag: monitor.planId || "trade-monitor"
        });
    }
}

function renderSettingsForm() {
    document.getElementById("capitalInput").value = state.settings.capital;
    document.getElementById("riskPercentInput").value = state.settings.riskPercent;
    document.getElementById("instrumentInput").value = state.settings.instrument;
    document.getElementById("strikeStyleInput").value = state.settings.strikeStyle;
    document.getElementById("expiryPreferenceInput").value = state.settings.expiryPreference;
    document.getElementById("lotSizeInput").value = state.settings.lotSize;
}

function buildQueryString() {
    const params = new URLSearchParams();
    params.set("ts", String(Date.now()));
    params.set("capital", String(state.settings.capital));
    params.set("riskPercent", String(state.settings.riskPercent));
    params.set("instrument", state.settings.instrument);
    params.set("strikeStyle", state.settings.strikeStyle);
    params.set("expiryPreference", state.settings.expiryPreference);

    if (normalizePositiveNumber(state.settings.lotSize)) {
        params.set("lotSize", String(state.settings.lotSize));
    }

    if (state.activeTrade) {
        params.set("activePlanId", state.activeTrade.planId);
        params.set("activeInstrument", state.activeTrade.instrument);
        params.set("activeOptionType", state.activeTrade.optionType);
        params.set("activeStrike", String(state.activeTrade.strikePrice));
        params.set("activeExpiry", state.activeTrade.expiry);
        params.set("activeEntry", String(state.activeTrade.entryPrice));

        if (normalizePositiveNumber(state.activeTrade.stopLoss)) {
            params.set("activeStop", String(state.activeTrade.stopLoss));
        }
        if (normalizePositiveNumber(state.activeTrade.target1)) {
            params.set("activeTarget1", String(state.activeTrade.target1));
        }
        if (normalizePositiveNumber(state.activeTrade.target2)) {
            params.set("activeTarget2", String(state.activeTrade.target2));
        }
        if (normalizePositiveNumber(state.activeTrade.spotInvalidation)) {
            params.set("activeSpotInvalidation", String(state.activeTrade.spotInvalidation));
        }
        if (normalizePositiveNumber(state.activeTrade.lotSize)) {
            params.set("activeLotSize", String(state.activeTrade.lotSize));
        }
        if (normalizePositiveNumber(state.activeTrade.maxLots)) {
            params.set("activeMaxLots", String(state.activeTrade.maxLots));
        }
        if (state.activeTrade.acknowledgedAt) {
            params.set("activeTakenAt", state.activeTrade.acknowledgedAt);
        }
    }

    return params.toString();
}

async function fetchDashboardPayload(controller) {
    if (isBrowserStandaloneMode()) {
        if (typeof window.buildStandaloneDashboardPayload !== "function") {
            throw new Error("Browser standalone loader is not available.");
        }

        return window.buildStandaloneDashboardPayload({
            settings: state.settings,
            activeTrade: state.activeTrade,
            signal: controller.signal
        });
    }

    const response = await fetch(`/api/dashboard?${buildQueryString()}`, {
        cache: "no-store",
        signal: controller.signal
    });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.message || "Failed to fetch dashboard payload.");
    }

    return payload;
}

function renderDashboard(payload) {
    state.dashboardPayload = payload;

    const dashboard = payload.dashboard;
    document.getElementById("lastUpdated").textContent = formatTimestamp(payload.generatedAt);
    document.getElementById("coverageBadge").textContent = `Live coverage ${payload.metadata.coverage}%`;

    renderFeedHealthStrip(payload.sourceStatuses, payload.metadata);
    renderDataGapBanner(dashboard, payload.sourceStatuses);
    renderTradeAlert(dashboard.tradeMonitor);
    renderSummaryCards(dashboard.summaryCards);
    renderSignalOverview(dashboard.signal, dashboard.session, dashboard);
    renderTradePlan(dashboard.tradePlan);
    renderActiveTrade(dashboard.tradeMonitor);
    renderSignalBreakdown(dashboard.signal.breakdown);
    renderNarrative(dashboard.narrative);
    renderGlobalAndMacro(dashboard);
    renderNews(dashboard.news);
    renderStrategy(dashboard.signal.strategy);
    renderRisks(dashboard.signal.risks);
    renderSourceStatuses(payload.sourceStatuses);
    maybeNotifyTradeMonitor(dashboard.tradeMonitor);
}

function setError(message) {
    const errorBanner = document.getElementById("globalError");
    errorBanner.hidden = !message;
    errorBanner.textContent = message || "";
}

async function loadDashboard(options = {}) {
    const isUserInitiated = options.userInitiated === true;
    if (state.isLoading) {
        if (isUserInitiated) {
            state.pendingReload = true;
        }
        return;
    }

    const refreshButton = document.getElementById("manualRefreshBtn");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    state.isLoading = true;
    state.requestController = controller;
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    setError("");

    try {
        const payload = await fetchDashboardPayload(controller);
        renderDashboard(payload);
    } catch (error) {
        if (error?.name === "AbortError") {
            setError("Live request took too long. The dashboard kept the last good snapshot.");
        } else {
            setError(error.message || "Unable to load the live dashboard.");
        }
    } finally {
        clearTimeout(timeoutId);
        state.isLoading = false;
        if (state.requestController === controller) {
            state.requestController = null;
        }
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh Now";

        if (state.pendingReload) {
            state.pendingReload = false;
            loadDashboard();
        }
    }
}

function resetAutoRefreshTimer() {
    if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
    }

    if (state.autoRefresh) {
        state.timerId = setInterval(loadDashboard, state.intervalMs);
    }
}

function setupAutoRefresh() {
    const autoRefreshToggle = document.getElementById("autoRefreshToggle");
    const refreshInterval = document.getElementById("refreshInterval");
    const manualRefreshBtn = document.getElementById("manualRefreshBtn");

    autoRefreshToggle.checked = state.autoRefresh;
    refreshInterval.value = String(state.intervalMs);

    autoRefreshToggle.addEventListener("change", () => {
        state.autoRefresh = autoRefreshToggle.checked;
        resetAutoRefreshTimer();
    });

    refreshInterval.addEventListener("change", () => {
        state.intervalMs = Number(refreshInterval.value);
        resetAutoRefreshTimer();
    });

    manualRefreshBtn.addEventListener("click", () => {
        loadDashboard({ userInitiated: true });
    });

    resetAutoRefreshTimer();
}

function setupNewsTabs() {
    document.getElementById("newsTabs").addEventListener("click", (event) => {
        const button = event.target.closest(".news-tab");
        if (!button) {
            return;
        }

        state.newsTab = button.dataset.newsTab || "india";
        syncNewsTabs();
        renderActiveNewsTab();
    });
}

function saveSettingsFromForm() {
    state.settings = {
        capital: normalizePositiveNumber(document.getElementById("capitalInput").value) || DEFAULT_SETTINGS.capital,
        riskPercent: normalizePositiveNumber(document.getElementById("riskPercentInput").value) || DEFAULT_SETTINGS.riskPercent,
        instrument: document.getElementById("instrumentInput").value || DEFAULT_SETTINGS.instrument,
        strikeStyle: document.getElementById("strikeStyleInput").value || DEFAULT_SETTINGS.strikeStyle,
        expiryPreference: document.getElementById("expiryPreferenceInput").value || DEFAULT_SETTINGS.expiryPreference,
        lotSize: document.getElementById("lotSizeInput").value
    };

    writeStorageJson(STORAGE_KEYS.settings, state.settings);
}

function clearActiveTrade() {
    state.activeTrade = null;
    removeStorageKey(STORAGE_KEYS.activeTrade);
    removeStorageKey(STORAGE_KEYS.lastAlert);
    renderTradeAlert(null);
    renderActiveTrade(null);
    loadDashboard({ userInitiated: true });
}

function freshStart() {
    state.settings = { ...DEFAULT_SETTINGS };
    state.activeTrade = null;
    removeStorageKey(STORAGE_KEYS.settings);
    removeStorageKey(STORAGE_KEYS.activeTrade);
    removeStorageKey(STORAGE_KEYS.lastAlert);
    renderSettingsForm();
    renderTradeAlert(null);
    renderActiveTrade(null);
    loadDashboard({ userInitiated: true });
}

function setupTraderSettings() {
    renderSettingsForm();

    document.getElementById("traderSettingsForm").addEventListener("change", () => {
        saveSettingsFromForm();
        loadDashboard({ userInitiated: true });
    });

    document.getElementById("clearTradeBtn").addEventListener("click", clearActiveTrade);
    document.getElementById("freshStartBtn").addEventListener("click", freshStart);
    document.getElementById("enableAlertsBtn").addEventListener("click", async () => {
        if (!("Notification" in window)) {
            setError("Browser notifications are not supported on this device.");
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            setError("Browser alerts were not enabled.");
            return;
        }

        setError("");
    });
}

function loadLocalState() {
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...(readStorageJson(STORAGE_KEYS.settings, {}) || {})
    };
    state.activeTrade = readStorageJson(STORAGE_KEYS.activeTrade, null);
}

function setupInstallPrompt() {
    const installButton = document.getElementById("installAppBtn");

    if (isBrowserStandaloneMode() || window.location.protocol === "file:") {
        installButton.hidden = true;
        return;
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        state.deferredInstallPrompt = event;
        installButton.hidden = false;
    });

    installButton.addEventListener("click", async () => {
        if (!state.deferredInstallPrompt) {
            return;
        }

        state.deferredInstallPrompt.prompt();
        await state.deferredInstallPrompt.userChoice;
        state.deferredInstallPrompt = null;
        installButton.hidden = true;
    });

    window.addEventListener("appinstalled", () => {
        state.deferredInstallPrompt = null;
        installButton.hidden = true;
    });
}

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || isBrowserStandaloneMode() || window.location.protocol === "file:") {
        return;
    }

    try {
        await navigator.serviceWorker.register("/sw.js");
    } catch (error) {
        // Ignore registration failures so the live dashboard still works normally.
    }
}

window.addEventListener("DOMContentLoaded", () => {
    loadLocalState();
    setupAutoRefresh();
    setupNewsTabs();
    setupTraderSettings();
    setupInstallPrompt();
    registerServiceWorker();

    if (isBrowserStandaloneMode() && typeof window.readStandaloneDashboardSnapshot === "function") {
        const cachedPayload = window.readStandaloneDashboardSnapshot();
        if (cachedPayload?.dashboard) {
            renderDashboard(cachedPayload);
            setError("Showing the last saved browser snapshot while live sources refresh.");
        }
    }

    loadDashboard();
});
