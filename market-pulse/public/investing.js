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

function formatInvestingSignedPercent(value) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(2)}%`;
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
    if (score >= 70) {
        return "positive";
    }
    if (score >= 55) {
        return "neutral";
    }
    return "negative";
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
                    <h3>Investing Data</h3>
                    <span class="status-chip unavailable">Unavailable</span>
                </div>
                <p class="feed-health-copy">Server-assisted NSE quote fetch is not available in browser-only mode.</p>
                <p class="feed-health-foot">Use the local/server app for live ideas.</p>
            </article>
        `;
        return;
    }

    const source = payload?.sourceStatuses?.[0];
    container.innerHTML = `
        <article class="feed-health-card mode">
            <div class="feed-health-topline">
                <h3>Mode</h3>
                <span class="status-chip live">Server Assisted</span>
            </div>
            <p class="feed-health-copy">This page fetches a dedicated investing payload from the app server.</p>
            <p class="feed-health-foot">Version ${escapeInvestingHtml(payload?.metadata?.version || "unknown")}</p>
        </article>
        <article class="feed-health-card">
            <div class="feed-health-topline">
                <h3>${escapeInvestingHtml(source?.label || "Investing Data")}</h3>
                <span class="status-chip ${escapeInvestingHtml(source?.status || "unavailable")}">${escapeInvestingHtml(formatInvestingStatusLabel(source?.status))}</span>
            </div>
            <p class="feed-health-copy">${escapeInvestingHtml(source?.message || "No source message available.")}</p>
            <p class="feed-health-foot">${source?.lastUpdated ? `Updated ${escapeInvestingHtml(formatInvestingTimestamp(source.lastUpdated))}` : "No timestamp available"}</p>
        </article>
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

    container.innerHTML = `
        <div class="investing-intro">
            <p class="eyebrow">Universe</p>
            <h3>${escapeInvestingHtml(investing.title)}</h3>
            <p class="summary-note">${escapeInvestingHtml(investing.summary)}</p>
            <p class="summary-note"><strong>${escapeInvestingHtml(investing.dataTier)}</strong></p>
        </div>

        <div class="investing-grid">
            ${investing.candidates.map((candidate) => `
                <article class="investing-card ${toneFromInvestingScore(candidate.score)}">
                    <div class="investing-topline">
                        <div>
                            <p class="eyebrow">${escapeInvestingHtml(candidate.symbol)}</p>
                            <h3>${escapeInvestingHtml(candidate.companyName)}</h3>
                        </div>
                        <span class="score-tag ${toneFromInvestingScore(candidate.score)}">${escapeInvestingHtml(String(candidate.score))}/100</span>
                    </div>
                    <p class="summary-note">${escapeInvestingHtml(candidate.verdict)}</p>

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
                            <span>Stock PE</span>
                            <strong>${escapeInvestingHtml(formatInvestingNumber(candidate.symbolPe))}</strong>
                        </div>
                        <div class="plan-item">
                            <span>Sector PE</span>
                            <strong>${escapeInvestingHtml(formatInvestingNumber(candidate.sectorPe))}</strong>
                        </div>
                        <div class="plan-item">
                            <span>PE Discount</span>
                            <strong>${escapeInvestingHtml(Number.isFinite(candidate.discountToSectorPe) ? `${formatInvestingNumber(candidate.discountToSectorPe)}%` : "Unavailable")}</strong>
                        </div>
                        <div class="plan-item">
                            <span>From 52W High</span>
                            <strong>${escapeInvestingHtml(Number.isFinite(candidate.drawdownFrom52WeekHigh) ? `${formatInvestingNumber(candidate.drawdownFrom52WeekHigh)}% below` : "Unavailable")}</strong>
                        </div>
                    </div>

                    <div class="education-columns">
                        <div class="education-card">
                            <h3>Why it looks interesting</h3>
                            ${createInvestingChecklist(candidate.reasons?.length ? candidate.reasons : ["No positive valuation signal stands out right now."])}
                        </div>
                        <div class="education-card">
                            <h3>What to be careful about</h3>
                            ${createInvestingChecklist(candidate.cautions?.length ? candidate.cautions : ["No major caution is visible from the current free NSE snapshot."])}
                        </div>
                    </div>

                    <div class="card-actions">
                        <span class="card-source">${escapeInvestingHtml(candidate.industry || "Industry unavailable")}</span>
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
    const guideCards = [
        {
            title: "1. Start from a curated quality universe",
            detail: "This beta does not scan the full market yet. It starts with a curated list of liquid large-cap names that are often considered long-term quality candidates."
        },
        {
            title: "2. Rank by live discount context",
            detail: `The current model compares stock PE vs sector PE and also checks where price is sitting versus the 52-week high and low. Today it ranked ${candidateCount} candidates.`
        },
        {
            title: "3. Surface watchlist ideas, not buy orders",
            detail: "The page is designed to help you shortlist candidates for deeper study. It does not claim that a stock is automatically a safe long-term buy just because it ranks well here."
        },
        {
            title: "4. Add deeper fundamentals next",
            detail: "True compounder analysis needs growth, ROE/ROCE, debt, margins, and cash flow. Those need an extra fundamentals provider beyond the current free NSE quote feed."
        }
    ];

    const faqItems = [
        {
            question: "Why is this called beta?",
            answer: "Because the free NSE quote feed gives useful valuation context but not full balance-sheet and cash-flow fundamentals. The page is honest about that limitation."
        },
        {
            question: "What does a high score mean?",
            answer: "A higher score means the stock currently looks more interesting within this curated universe based on live PE context and where price sits inside the yearly range."
        },
        {
            question: "Does this guarantee a long-term compounder?",
            answer: "No. It is a watchlist signal, not a guarantee. A real compounder thesis still needs business quality, management quality, capital allocation, growth durability, and deeper financial statements."
        },
        {
            question: "Why might a famous quality stock still rank only average?",
            answer: "Because the page is looking for opportunity plus valuation context. A strong business can still rank lower if it is near highs or expensive versus its sector today."
        },
        {
            question: "What should be added next to improve this page?",
            answer: "ROE, ROCE, debt/equity, sales and profit growth, operating cash flow, free cash flow, margin trend, and historical valuation bands would make this much more useful."
        }
    ];

    const limitations = investing?.limitations || [
        "Live investing ideas are unavailable right now."
    ];

    container.innerHTML = `
        <div class="faq-intro">
            <p class="eyebrow">How It Works</p>
            <h3>What this investing page is actually doing</h3>
            <p class="summary-note">This page is meant to surface investment ideas for further research. It is intentionally stricter about what it can and cannot claim with free data.</p>
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
                    "Use the ranking to shortlist names, not to skip research.",
                    "Open the NSE quote page and verify price, PE, and sector context.",
                    "Prefer names where business quality is already familiar or easy to validate.",
                    "Wait for the next version before treating this as a full fundamentals screener."
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
            title: "Long-Term Compounder Watchlist Beta",
            summary: "Live investing ideas need the server-assisted app because the free NSE quote fetch is performed server-side.",
            dataTier: "Browser standalone",
            limitations: [
                "This static page does not call the server investing API.",
                "Use the local/server app to see live ranked ideas.",
                "The guide below still explains the intended methodology."
            ],
            candidates: []
        },
        sourceStatuses: [],
        metadata: {
            version: "investing-beta-1.0.0",
            mode: "browser-standalone"
        }
    };
}

function getUnavailableServerInvestingPayload(message) {
    return {
        generatedAt: null,
        investing: {
            available: false,
            title: "Long-Term Compounder Watchlist Beta",
            summary: "The investing ideas page could not load live rankings from the server right now.",
            dataTier: "Server-assisted mode",
            limitations: [
                message || "The investing ideas payload is temporarily unavailable.",
                "Try refreshing again in a few seconds.",
                "The methodology guide below is still available."
            ],
            candidates: []
        },
        sourceStatuses: [],
        metadata: {
            version: "investing-beta-1.0.0",
            mode: "server-assisted"
        }
    };
}

async function fetchInvestingPayload() {
    if (isBrowserStandaloneInvestingMode()) {
        return getStandaloneInvestingPayload();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

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
