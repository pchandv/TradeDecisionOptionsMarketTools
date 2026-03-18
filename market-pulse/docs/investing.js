const investingPageState = {
    isLoading: false
};

const investingNumberFormatter = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
});

function isBrowserStandaloneInvestingMode() {
    return document.body?.dataset?.appMode === "browser-standalone";
}

function escapeInvestingHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatInvestingNumber(value) {
    return Number.isFinite(value) ? investingNumberFormatter.format(value) : "Unavailable";
}

function formatInvestingPercent(value, digits = 2) {
    return Number.isFinite(value) ? `${value.toFixed(digits)}%` : "Unavailable";
}

function formatInvestingSignedPercent(value, digits = 2) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(digits)}%`;
}

function formatInvestingTimestamp(timestamp) {
    if (!timestamp) {
        return "Unavailable";
    }
    return new Date(timestamp).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function createInvestingSourceLink(url, label = "View source") {
    if (!url) {
        return "";
    }

    return `<a class="source-link" href="${escapeInvestingHtml(url)}" target="_blank" rel="noreferrer">${escapeInvestingHtml(label)}</a>`;
}

function createInvestingChecklist(items) {
    return `
        <ul class="checklist">
            ${items.map((item) => `<li>${escapeInvestingHtml(item)}</li>`).join("")}
        </ul>
    `;
}

function formatInvestingStatusLabel(status) {
    const raw = String(status || "unavailable");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function toneFromInvestingScore(score) {
    if (!Number.isFinite(score)) {
        return "neutral";
    }
    if (score >= 72) {
        return "positive";
    }
    if (score >= 55) {
        return "neutral";
    }
    return "negative";
}

function analysisModeLabel(mode) {
    return mode === "fundamentals-enriched" ? "Fundamentals Enriched" : "NSE Fallback";
}

function analysisModeTone(mode) {
    return mode === "fundamentals-enriched" ? "live" : "partial";
}

function scoreOrNeedsKey(score) {
    return Number.isFinite(score) ? `${score}/100` : "Needs deeper data";
}

function setInvestingError(message) {
    const banner = document.getElementById("investingPageError");
    banner.hidden = !message;
    banner.textContent = message || "";
}

function renderInvestingFeedStrip(payload) {
    const container = document.getElementById("investingFeedHealthStrip");
    if (!container) {
        return;
    }

    if (isBrowserStandaloneInvestingMode()) {
        container.innerHTML = `
            <article class="feed-health-card mode">
                <div class="feed-health-topline">
                    <h3>Mode</h3>
                    <span class="status-chip delayed">Browser Standalone</span>
                </div>
                <p class="feed-health-copy">This page is exported for static hosting, but live investing ideas need the server API.</p>
                <p class="feed-health-foot">Methodology only in static mode.</p>
            </article>
            <article class="feed-health-card">
                <div class="feed-health-topline">
                    <h3>NSE Quotes</h3>
                    <span class="status-chip unavailable">Unavailable</span>
                </div>
                <p class="feed-health-copy">Server-assisted NSE quote fetch is not available in browser-only mode.</p>
                <p class="feed-health-foot">Use the local/server app for live ideas.</p>
            </article>
            <article class="feed-health-card">
                <div class="feed-health-topline">
                    <h3>Fundamentals</h3>
                    <span class="status-chip unavailable">Unavailable</span>
                </div>
                <p class="feed-health-copy">Deep fundamentals are also unavailable in static mode.</p>
                <p class="feed-health-foot">The guide below still explains the model.</p>
            </article>
        `;
        return;
    }

    const sourceStatuses = Array.isArray(payload?.sourceStatuses) ? payload.sourceStatuses : [];
    const sourceCards = sourceStatuses.map((source) => `
        <article class="feed-health-card">
            <div class="feed-health-topline">
                <h3>${escapeInvestingHtml(source?.label || "Investing Data")}</h3>
                <span class="status-chip ${escapeInvestingHtml(source?.status || "unavailable")}">${escapeInvestingHtml(formatInvestingStatusLabel(source?.status))}</span>
            </div>
            <p class="feed-health-copy">${escapeInvestingHtml(source?.message || "No source message available.")}</p>
            <p class="feed-health-foot">${source?.lastUpdated ? `Updated ${escapeInvestingHtml(formatInvestingTimestamp(source.lastUpdated))}` : "No timestamp available"}</p>
        </article>
    `);

    container.innerHTML = `
        <article class="feed-health-card mode">
            <div class="feed-health-topline">
                <h3>Mode</h3>
                <span class="status-chip live">Server Assisted</span>
            </div>
            <p class="feed-health-copy">This page fetches a dedicated investing payload from the app server.</p>
            <p class="feed-health-foot">Version ${escapeInvestingHtml(payload?.metadata?.version || "unknown")}</p>
        </article>
        ${sourceCards.join("")}
    `;
}

function renderCandidateMetrics(candidate) {
    return `
        <div class="investing-metrics">
            <div class="plan-item">
                <span>Price</span>
                <strong>${escapeInvestingHtml(formatInvestingNumber(candidate.price))}</strong>
            </div>
            <div class="plan-item">
                <span>1D Move</span>
                <strong>${escapeInvestingHtml(formatInvestingSignedPercent(candidate.changePercent))}</strong>
            </div>
            <div class="plan-item">
                <span>PE Discount</span>
                <strong>${escapeInvestingHtml(formatInvestingPercent(candidate.discountToSectorPe))}</strong>
            </div>
            <div class="plan-item">
                <span>From 52W High</span>
                <strong>${escapeInvestingHtml(Number.isFinite(candidate.drawdownFrom52WeekHigh) ? `${candidate.drawdownFrom52WeekHigh.toFixed(2)}% below` : "Unavailable")}</strong>
            </div>
            <div class="plan-item">
                <span>Quality</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.quality))}</strong>
            </div>
            <div class="plan-item">
                <span>Growth</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.growth))}</strong>
            </div>
            <div class="plan-item">
                <span>Valuation</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.valuation))}</strong>
            </div>
            <div class="plan-item">
                <span>Opportunity</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.opportunity))}</strong>
            </div>
        </div>
    `;
}

function renderCandidateFundamentals(candidate) {
    const fundamentals = candidate.fundamentals || {};

    if (candidate.analysisMode !== "fundamentals-enriched") {
        return createInvestingChecklist([
            "Deep fundamentals were not available for this card during the current refresh.",
            "The score is using the NSE valuation fallback model for this name.",
            "Configure ALPHA_VANTAGE_API_KEY on the server to unlock richer compounder checks."
        ]);
    }

    return `
        <div class="investing-metrics">
            <div class="plan-item">
                <span>ROE</span>
                <strong>${escapeInvestingHtml(formatInvestingPercent(fundamentals.returnOnEquityTTM))}</strong>
            </div>
            <div class="plan-item">
                <span>Profit Margin</span>
                <strong>${escapeInvestingHtml(formatInvestingPercent(fundamentals.profitMargin))}</strong>
            </div>
            <div class="plan-item">
                <span>Operating Margin</span>
                <strong>${escapeInvestingHtml(formatInvestingPercent(fundamentals.operatingMarginTTM))}</strong>
            </div>
            <div class="plan-item">
                <span>Revenue Growth</span>
                <strong>${escapeInvestingHtml(formatInvestingPercent(fundamentals.quarterlyRevenueGrowthYOY))}</strong>
            </div>
            <div class="plan-item">
                <span>Earnings Growth</span>
                <strong>${escapeInvestingHtml(formatInvestingPercent(fundamentals.quarterlyEarningsGrowthYOY))}</strong>
            </div>
            <div class="plan-item">
                <span>Price To Book</span>
                <strong>${escapeInvestingHtml(formatInvestingNumber(fundamentals.priceToBookRatio))}</strong>
            </div>
            <div class="plan-item">
                <span>Target Gap</span>
                <strong>${escapeInvestingHtml(formatInvestingSignedPercent(candidate.targetUpsidePercent))}</strong>
            </div>
            <div class="plan-item">
                <span>Coverage</span>
                <strong>${escapeInvestingHtml(`${candidate.fundamentalCoverage || 0} core checks`)}</strong>
            </div>
        </div>
    `;
}

function renderInvestingIdeasPage(payload) {
    const container = document.getElementById("investingIdeasPagePanel");
    if (!container) {
        return;
    }

    const investing = payload?.investing || {
        available: false,
        title: "Investment Ideas Unavailable",
        summary: "Live investment ideas are unavailable right now.",
        dataTier: "Unavailable",
        limitations: [
            "The investing ideas payload is unavailable."
        ],
        candidates: []
    };

    if (!investing.available || !investing.candidates?.length) {
        container.innerHTML = `
            <div class="investing-intro">
                <p class="eyebrow">Status</p>
                <h3>${escapeInvestingHtml(investing.title)}</h3>
                <p class="summary-note">${escapeInvestingHtml(investing.summary)}</p>
                <div class="investing-limitations">
                    ${(investing.limitations || []).map((item) => `<p class="summary-note">${escapeInvestingHtml(item)}</p>`).join("")}
                </div>
            </div>
        `;
        return;
    }

    const enrichedCount = investing.qualityCoverage?.enrichedCount || 0;
    const totalUniverseCount = investing.qualityCoverage?.totalUniverseCount || investing.candidates.length;

    container.innerHTML = `
        <div class="investing-intro">
            <p class="eyebrow">Universe</p>
            <h3>${escapeInvestingHtml(investing.title)}</h3>
            <p class="summary-note">${escapeInvestingHtml(investing.summary)}</p>
            <div class="tag-row">
                <span class="status-chip ${escapeInvestingHtml(investing.strategyMode === "fundamentals-enriched" ? "live" : "partial")}">${escapeInvestingHtml(investing.methodologyBadge || "Watchlist mode")}</span>
                <span class="driver-pill">${escapeInvestingHtml(investing.dataTier || "Unknown data tier")}</span>
                <span class="driver-pill">${escapeInvestingHtml(`${enrichedCount}/${totalUniverseCount} names with deeper fundamentals`)}</span>
            </div>
        </div>

        <div class="education-columns">
            <article class="education-card">
                <h3>What the ranking is optimizing for</h3>
                ${createInvestingChecklist(investing.criteria || ["The current investing criteria are unavailable."])}
            </article>
            <article class="education-card">
                <h3>How to read the shortlist</h3>
                ${createInvestingChecklist([
                    "Higher score means stronger fit inside the current compounder watchlist model.",
                    "Fundamentals Enriched cards have enough business-quality data to go beyond PE and price range.",
                    "NSE Fallback cards are still useful, but they need manual fundamental validation before you trust the ranking."
                ])}
            </article>
        </div>

        <div class="investing-grid">
            ${investing.candidates.map((candidate) => `
                <article class="investing-card ${toneFromInvestingScore(candidate.score)}">
                    <div class="investing-topline">
                        <div>
                            <p class="eyebrow">${escapeInvestingHtml(candidate.symbol)}</p>
                            <h3>${escapeInvestingHtml(candidate.companyName)}</h3>
                            <p class="summary-note">${escapeInvestingHtml(candidate.verdict)}</p>
                        </div>
                        <div class="tag-row">
                            <span class="score-tag ${toneFromInvestingScore(candidate.score)}">${escapeInvestingHtml(String(candidate.score))}/100</span>
                            <span class="status-chip ${escapeInvestingHtml(analysisModeTone(candidate.analysisMode))}">${escapeInvestingHtml(analysisModeLabel(candidate.analysisMode))}</span>
                        </div>
                    </div>

                    ${renderCandidateMetrics(candidate)}

                    <div class="education-columns">
                        <div class="education-card">
                            <h3>Why it stands out</h3>
                            ${createInvestingChecklist(candidate.reasons?.length ? candidate.reasons : ["No strong positive signal is standing out right now."])}
                        </div>
                        <div class="education-card">
                            <h3>What to verify before acting</h3>
                            ${createInvestingChecklist(candidate.cautions?.length ? candidate.cautions : ["No major caution is visible from the current data snapshot."])}
                        </div>
                    </div>

                    <div class="education-columns">
                        <div class="education-card">
                            <h3>Deep fundamentals snapshot</h3>
                            ${renderCandidateFundamentals(candidate)}
                        </div>
                        <div class="education-card">
                            <h3>Context</h3>
                            ${createInvestingChecklist([
                                `Industry: ${candidate.industry || "Unavailable"}`,
                                `Sector: ${candidate.sector || "Unavailable"}`,
                                candidate.analysisMode === "fundamentals-enriched"
                                    ? "This card had enough fundamentals coverage to score business quality, growth, valuation, and opportunity together."
                                    : "This card is still in fallback mode, so treat it as a watchlist lead rather than a true compounder verdict."
                            ])}
                        </div>
                    </div>

                    <div class="card-actions">
                        <span class="card-source">${escapeInvestingHtml(candidate.analysisMode === "fundamentals-enriched" ? "NSE + Alpha Vantage" : "NSE-only fallback")}</span>
                        ${createInvestingSourceLink(candidate.sourceUrl, "Open NSE quote")}
                    </div>
                </article>
            `).join("")}
        </div>

        <div class="investing-limitations">
            ${(investing.limitations || []).map((item) => `<p class="summary-note">${escapeInvestingHtml(item)}</p>`).join("")}
        </div>
    `;
}

function renderInvestingGuide(payload) {
    const container = document.getElementById("investingGuidePanel");
    if (!container) {
        return;
    }

    const investing = payload?.investing;
    const candidateCount = investing?.candidates?.length || 0;
    const strategyMode = investing?.strategyMode || "nse-valuation-fallback";
    const guideCards = [
        {
            title: "1. Start from a curated quality universe",
            detail: "This page does not scan the full market yet. It starts with a curated liquid large-cap universe so the shortlist stays readable for new investors."
        },
        {
            title: "2. Check the business quality layer first",
            detail: strategyMode === "fundamentals-enriched"
                ? "When the fundamentals provider is available, the model scores ROE, profit margin, operating margin, revenue growth, and earnings growth before it gives extra credit to valuation."
                : "If the fundamentals provider is unavailable, the page falls back to PE and annual price-range context only. That is still useful, but it is not enough to call something a true long-term compounder."
        },
        {
            title: "3. Add valuation and timing context",
            detail: `After business quality, the model checks live PE vs sector PE, 52-week range position, and analyst target gap where available. Today it ranked ${candidateCount} candidates.`
        },
        {
            title: "4. Treat this as a research shortlist",
            detail: "The goal is to surface names worth deeper study, not to claim automatic buy recommendations. Balance sheet, management quality, capital allocation, and cash flow should still be reviewed."
        }
    ];

    const faqItems = [
        {
            question: "What makes a stock look like a compounder here?",
            answer: "The strongest cards combine healthy profitability, healthy growth, reasonable valuation, and a price that is not already overly stretched."
        },
        {
            question: "Why might a quality company still rank lower?",
            answer: "Because the page is looking for both quality and current opportunity. A great business can still rank lower if it looks expensive or is trading near the top of its yearly range."
        },
        {
            question: "What does NSE fallback mean?",
            answer: "It means the app only had the NSE quote feed, so it could score valuation context and yearly price location but not deep business quality. Those cards are watchlist leads, not full compounder verdicts."
        },
        {
            question: "How do I unlock the deeper fundamental mode?",
            answer: "Run the server app with ALPHA_VANTAGE_API_KEY configured. The page will then try to enrich the watchlist with overview fundamentals and cache them to reduce repeated free-tier requests."
        },
        {
            question: "Does a high score mean I should buy immediately?",
            answer: "No. A high score means the stock deserves deeper study under this model. It does not replace annual reports, management checks, or portfolio sizing decisions."
        }
    ];

    const limitations = investing?.limitations || [
        "Live investing ideas are unavailable right now."
    ];

    container.innerHTML = `
        <div class="faq-intro">
            <p class="eyebrow">How It Works</p>
            <h3>How this page decides what looks attractive</h3>
            <p class="summary-note">This investing page is designed to help new users understand not just the shortlist, but also the logic behind it.</p>
        </div>

        <div class="faq-grid">
            ${guideCards.map((card) => `
                <article class="faq-card">
                    <h3>${escapeInvestingHtml(card.title)}</h3>
                    <p class="narrative-copy">${escapeInvestingHtml(card.detail)}</p>
                </article>
            `).join("")}
        </div>

        <div class="education-columns">
            <article class="education-card">
                <h3>Current limitations</h3>
                ${createInvestingChecklist(limitations)}
            </article>
            <article class="education-card">
                <h3>How to use this page well</h3>
                ${createInvestingChecklist([
                    "Use the ranking to shortlist names, not to outsource conviction.",
                    "Open the NSE quote page and validate live price and valuation context.",
                    "Prefer Fundamentals Enriched cards when you want a stronger business-quality signal.",
                    "Review cash flow, debt, governance, and annual reports before treating any name as a real long-term candidate."
                ])}
            </article>
        </div>

        <div class="faq-list">
            ${faqItems.map((item) => `
                <details class="faq-item">
                    <summary>${escapeInvestingHtml(item.question)}</summary>
                    <div class="faq-answer">
                        <p class="summary-note">${escapeInvestingHtml(item.answer)}</p>
                    </div>
                </details>
            `).join("")}
        </div>
    `;
}

function getStandaloneInvestingPayload() {
    return {
        generatedAt: null,
        investing: {
            available: false,
            title: "Investment Ideas For Fundamentally Strong Compounders",
            summary: "Live investing ideas need the server-assisted app because both the NSE quote fetch and the optional fundamentals fetch are performed server-side.",
            strategyMode: "nse-valuation-fallback",
            methodologyBadge: "Browser Standalone",
            dataTier: "Browser standalone",
            criteria: [
                "Guide-only mode in static hosting",
                "No live NSE quote fetch",
                "No live fundamentals fetch"
            ],
            limitations: [
                "This static page does not call the server investing API.",
                "Use the local/server app to see live ranked ideas.",
                "The guide below still explains the intended methodology."
            ],
            qualityCoverage: {
                enrichedCount: 0,
                totalUniverseCount: 0
            },
            candidates: []
        },
        sourceStatuses: [],
        metadata: {
            version: "investing-beta-2.0.0",
            mode: "browser-standalone",
            strategyMode: "nse-valuation-fallback"
        }
    };
}

function getUnavailableServerInvestingPayload(message) {
    return {
        generatedAt: null,
        investing: {
            available: false,
            title: "Investment Ideas For Fundamentally Strong Compounders",
            summary: "The investing ideas page could not load live rankings from the server right now.",
            strategyMode: "nse-valuation-fallback",
            methodologyBadge: "Server unavailable",
            dataTier: "Server-assisted mode",
            criteria: [
                "Quality and growth scoring when providers are available",
                "Valuation and range context from live NSE quotes",
                "Research shortlist, not direct recommendations"
            ],
            limitations: [
                message || "The investing ideas payload is temporarily unavailable.",
                "Try refreshing again in a few seconds.",
                "The methodology guide below is still available."
            ],
            qualityCoverage: {
                enrichedCount: 0,
                totalUniverseCount: 0
            },
            candidates: []
        },
        sourceStatuses: [],
        metadata: {
            version: "investing-beta-2.0.0",
            mode: "server-assisted",
            strategyMode: "nse-valuation-fallback"
        }
    };
}

async function fetchInvestingPayload() {
    if (isBrowserStandaloneInvestingMode()) {
        return getStandaloneInvestingPayload();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        const response = await fetch(`/api/investing?ts=${Date.now()}`, {
            cache: "no-store",
            signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.message || "Failed to fetch investing ideas.");
        }
        return payload;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function loadInvestingPage() {
    if (investingPageState.isLoading) {
        return;
    }

    const refreshButton = document.getElementById("refreshIdeasBtn");
    investingPageState.isLoading = true;
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    setInvestingError("");

    try {
        const payload = await fetchInvestingPayload();
        document.getElementById("ideasLastUpdated").textContent = payload.generatedAt
            ? formatInvestingTimestamp(payload.generatedAt)
            : "Server-assisted mode required";
        renderInvestingFeedStrip(payload);
        renderInvestingIdeasPage(payload);
        renderInvestingGuide(payload);
    } catch (error) {
        setInvestingError(error?.name === "AbortError"
            ? "Investing request took too long. Please try again."
            : (error.message || "Unable to load investing ideas."));
        const fallbackPayload = isBrowserStandaloneInvestingMode()
            ? getStandaloneInvestingPayload()
            : getUnavailableServerInvestingPayload(error.message);
        renderInvestingFeedStrip(fallbackPayload);
        renderInvestingIdeasPage(fallbackPayload);
        renderInvestingGuide(fallbackPayload);
    } finally {
        investingPageState.isLoading = false;
        refreshButton.disabled = isBrowserStandaloneInvestingMode();
        refreshButton.textContent = isBrowserStandaloneInvestingMode() ? "Live Ideas Need Server Mode" : "Refresh Ideas";
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const refreshButton = document.getElementById("refreshIdeasBtn");
    refreshButton.addEventListener("click", () => {
        if (!isBrowserStandaloneInvestingMode()) {
            loadInvestingPage();
        }
    });
    loadInvestingPage();
});
