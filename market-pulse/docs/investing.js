const investingPageState = {
    isLoading: false,
    isProcessingCsv: false,
    uploadedCsvAnalysis: null,
    csvUploadError: "",
    csvUploadMessage: ""
};

const INVESTING_STORAGE_KEY = "market-signal.investingSnapshot";

const investingNumberFormatter = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
});

const CSV_COLUMN_SPECS = [
    { key: "name", label: "Name", aliases: ["name", "company name", "stock name", "company"], importance: "required" },
    { key: "symbol", label: "Ticker", aliases: ["ticker", "symbol", "stock", "nse code"], importance: "required" },
    { key: "subSector", label: "Sub-Sector", aliases: ["sub sector", "sub-sector", "sector", "industry"], importance: "recommended" },
    { key: "marketCap", label: "Market Cap", aliases: ["market cap", "market capitalization", "mcap"], importance: "recommended" },
    { key: "closePrice", label: "Close Price", aliases: ["close price", "cmp", "current price", "price"], importance: "recommended" },
    { key: "peRatio", label: "PE Ratio", aliases: ["pe ratio", "p e ratio", "p/e", "pe"], importance: "recommended" },
    { key: "pbRatio", label: "PB Ratio", aliases: ["pb ratio", "price to book", "p b ratio", "p/b"], importance: "recommended" },
    { key: "roe", label: "Return on Equity", aliases: ["return on equity", "roe", "roe %"], importance: "recommended" },
    { key: "roce", label: "Return on Capital Employed", aliases: ["return on capital employed", "roce", "roce %"], importance: "helpful" },
    { key: "debtToEquity", label: "Debt to Equity", aliases: ["debt to equity", "debt equity", "debt/equity"], importance: "helpful" },
    { key: "salesGrowth", label: "Sales Growth", aliases: ["sales growth", "revenue growth", "sales growth %"], importance: "helpful" },
    { key: "profitGrowth", label: "Profit Growth", aliases: ["profit growth", "earnings growth", "profit growth %"], importance: "helpful" },
    { key: "opm", label: "Operating Profit Margin", aliases: ["operating profit margin", "operating margin", "opm", "opm %"], importance: "helpful" },
    { key: "oneMonthReturn", label: "1M Return", aliases: ["1m return", "1 month return", "one month return"], importance: "context" },
    { key: "oneDayReturn", label: "1D Return", aliases: ["1d return", "1 day return", "day return"], importance: "context" },
    { key: "oneYearReturn", label: "1Y Return", aliases: ["1y return", "1 year return", "one year return"], importance: "context" },
    { key: "threeYearSalesCagr", label: "3Y Sales CAGR", aliases: ["3y sales cagr", "3 year sales cagr", "sales cagr 3y"], importance: "helpful" },
    { key: "threeYearProfitCagr", label: "3Y Profit CAGR", aliases: ["3y profit cagr", "3 year profit cagr", "profit cagr 3y"], importance: "helpful" }
];

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

function readInvestingSnapshot() {
    try {
        const raw = localStorage.getItem(INVESTING_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function writeInvestingSnapshot(payload) {
    if (!payload?.investing) {
        return;
    }

    localStorage.setItem(INVESTING_STORAGE_KEY, JSON.stringify(payload));
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function pushUnique(list, message) {
    if (message && !list.includes(message)) {
        list.push(message);
    }
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
    if (mode === "manual-csv-upload") {
        return "Manual CSV";
    }
    return mode === "fundamentals-enriched" ? "Fundamentals Enriched" : "NSE Fallback";
}

function analysisModeTone(mode) {
    if (mode === "manual-csv-upload") {
        return "live";
    }
    return mode === "fundamentals-enriched" ? "live" : "partial";
}

function scoreOrNeedsKey(score, fallback = "Needs deeper data") {
    return Number.isFinite(score) ? `${score}/100` : fallback;
}

function normalizeCsvHeader(value) {
    return String(value ?? "")
        .replace(/^\uFEFF/, "")
        .toLowerCase()
        .replace(/[%()]/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function parseLooseNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw || /^(na|n\/a|none|null|nil|--|-)$|^not available$/i.test(raw)) {
        return null;
    }

    const numeric = Number(
        raw
            .replace(/₹/g, "")
            .replace(/\bRs\.?\b/gi, "")
            .replace(/,/g, "")
            .replace(/%/g, "")
            .replace(/\s+/g, "")
    );

    return Number.isFinite(numeric) ? numeric : null;
}

function parseCsvText(text) {
    const rows = [];
    let row = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (character === "\"") {
            if (inQuotes && text[index + 1] === "\"") {
                current += "\"";
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (character === "," && !inQuotes) {
            row.push(current);
            current = "";
            continue;
        }

        if ((character === "\n" || character === "\r") && !inQuotes) {
            if (character === "\r" && text[index + 1] === "\n") {
                index += 1;
            }
            row.push(current);
            rows.push(row);
            row = [];
            current = "";
            continue;
        }

        current += character;
    }

    if (current.length || row.length) {
        row.push(current);
        rows.push(row);
    }

    if (rows[0]?.[0]) {
        rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
    }

    return rows.filter((entry) => entry.some((cell) => String(cell ?? "").trim()));
}

function findCsvColumnIndex(headers, aliases = []) {
    const normalizedHeaders = headers.map(normalizeCsvHeader);
    const normalizedAliases = aliases.map(normalizeCsvHeader).filter(Boolean);

    for (const alias of normalizedAliases) {
        const exactIndex = normalizedHeaders.findIndex((header) => header === alias);
        if (exactIndex >= 0) {
            return exactIndex;
        }
    }

    for (const alias of normalizedAliases) {
        const fuzzyIndex = normalizedHeaders.findIndex((header) => header.includes(alias) || alias.includes(header));
        if (fuzzyIndex >= 0) {
            return fuzzyIndex;
        }
    }

    return -1;
}

function buildCsvColumnMap(headers) {
    return Object.fromEntries(CSV_COLUMN_SPECS.map((spec) => [spec.key, findCsvColumnIndex(headers, spec.aliases)]));
}

function readCsvTextValue(row, columnMap, key) {
    const index = columnMap[key];
    return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function readCsvNumberValue(row, columnMap, key) {
    return parseLooseNumber(readCsvTextValue(row, columnMap, key));
}

function roundScore(value) {
    return Number.isFinite(value) ? Math.round(value) : null;
}

function weightedAverageScores(parts) {
    let weightedSum = 0;
    let totalWeight = 0;

    parts.forEach((part) => {
        if (Number.isFinite(part.score)) {
            weightedSum += part.score * part.weight;
            totalWeight += part.weight;
        }
    });

    return totalWeight ? roundScore(weightedSum / totalWeight) : null;
}

function scoreUploadedQuality(candidate) {
    let score = 50;
    let available = 0;
    const reasons = [];
    const cautions = [];

    if (Number.isFinite(candidate.roe)) {
        available += 1;
        if (candidate.roe >= 20) {
            score += 22;
            pushUnique(reasons, "ROE is comfortably strong.");
        } else if (candidate.roe >= 15) {
            score += 14;
            pushUnique(reasons, "ROE is healthy for a quality screen.");
        } else if (candidate.roe >= 10) {
            score += 6;
        } else {
            score -= 12;
            pushUnique(cautions, "ROE is on the weaker side for a compounder screen.");
        }
    }

    if (Number.isFinite(candidate.roce)) {
        available += 1;
        if (candidate.roce >= 20) {
            score += 18;
            pushUnique(reasons, "ROCE supports strong capital efficiency.");
        } else if (candidate.roce >= 15) {
            score += 12;
        } else if (candidate.roce < 10) {
            score -= 10;
            pushUnique(cautions, "ROCE is not yet strong enough.");
        }
    }

    if (Number.isFinite(candidate.debtToEquity)) {
        available += 1;
        if (candidate.debtToEquity <= 0.3) {
            score += 16;
            pushUnique(reasons, "Debt is low relative to equity.");
        } else if (candidate.debtToEquity <= 0.6) {
            score += 10;
        } else if (candidate.debtToEquity <= 1) {
            score += 4;
        } else if (candidate.debtToEquity <= 2) {
            score -= 10;
            pushUnique(cautions, "Debt to equity is elevated.");
        } else {
            score -= 18;
            pushUnique(cautions, "Debt to equity is high for a conservative long-term screen.");
        }
    }

    if (Number.isFinite(candidate.opm)) {
        available += 1;
        if (candidate.opm >= 20) {
            score += 14;
            pushUnique(reasons, "Operating margin shows good business quality.");
        } else if (candidate.opm >= 12) {
            score += 8;
        } else if (candidate.opm < 8) {
            score -= 10;
            pushUnique(cautions, "Operating margin is thin.");
        }
    }

    return {
        score: available ? clamp(roundScore(score), 0, 100) : null,
        reasons,
        cautions
    };
}

function scoreUploadedGrowth(candidate) {
    let score = 50;
    let available = 0;
    const reasons = [];
    const cautions = [];

    if (Number.isFinite(candidate.salesGrowth)) {
        available += 1;
        if (candidate.salesGrowth >= 15) {
            score += 14;
            pushUnique(reasons, "Sales growth is healthy.");
        } else if (candidate.salesGrowth >= 8) {
            score += 8;
        } else if (candidate.salesGrowth < 0) {
            score -= 12;
            pushUnique(cautions, "Sales growth is negative.");
        }
    }

    if (Number.isFinite(candidate.profitGrowth)) {
        available += 1;
        if (candidate.profitGrowth >= 15) {
            score += 16;
            pushUnique(reasons, "Profit growth supports the thesis.");
        } else if (candidate.profitGrowth >= 8) {
            score += 10;
        } else if (candidate.profitGrowth < 0) {
            score -= 16;
            pushUnique(cautions, "Profit growth is negative.");
        }
    }

    if (Number.isFinite(candidate.threeYearSalesCagr)) {
        available += 1;
        if (candidate.threeYearSalesCagr >= 10) {
            score += 8;
            pushUnique(reasons, "3Y sales CAGR shows sustained expansion.");
        } else if (candidate.threeYearSalesCagr >= 5) {
            score += 4;
        } else if (candidate.threeYearSalesCagr < 0) {
            score -= 8;
            pushUnique(cautions, "3Y sales CAGR is negative.");
        }
    }

    if (Number.isFinite(candidate.threeYearProfitCagr)) {
        available += 1;
        if (candidate.threeYearProfitCagr >= 12) {
            score += 10;
            pushUnique(reasons, "3Y profit CAGR shows compounding potential.");
        } else if (candidate.threeYearProfitCagr >= 6) {
            score += 5;
        } else if (candidate.threeYearProfitCagr < 0) {
            score -= 10;
            pushUnique(cautions, "3Y profit CAGR is negative.");
        }
    }

    return {
        score: available ? clamp(roundScore(score), 0, 100) : null,
        reasons,
        cautions
    };
}

function scoreUploadedValuation(candidate) {
    let score = 50;
    let available = 0;
    const reasons = [];
    const cautions = [];

    if (Number.isFinite(candidate.peRatio)) {
        available += 1;
        if (candidate.peRatio <= 15) {
            score += 15;
            pushUnique(reasons, "PE is still reasonable.");
        } else if (candidate.peRatio <= 25) {
            score += 10;
        } else if (candidate.peRatio <= 35) {
            score += 4;
        } else if (candidate.peRatio <= 45) {
            score -= 4;
            pushUnique(cautions, "PE is starting to look expensive.");
        } else {
            score -= 12;
            pushUnique(cautions, "PE is rich for a conservative fundamental screen.");
        }
    }

    if (Number.isFinite(candidate.pbRatio)) {
        available += 1;
        if (candidate.pbRatio <= 3) {
            score += 12;
            pushUnique(reasons, "PB is still under control.");
        } else if (candidate.pbRatio <= 6) {
            score += 8;
        } else if (candidate.pbRatio <= 10) {
            score += 2;
        } else {
            score -= 12;
            pushUnique(cautions, "PB is stretched.");
        }
    }

    return {
        score: available ? clamp(roundScore(score), 0, 100) : null,
        reasons,
        cautions
    };
}

function scoreUploadedOpportunity(candidate) {
    let score = 50;
    let available = 0;
    const reasons = [];
    const cautions = [];

    if (Number.isFinite(candidate.oneMonthReturn)) {
        available += 1;
        if (candidate.oneMonthReturn >= -15 && candidate.oneMonthReturn <= 5) {
            score += 12;
            pushUnique(reasons, "Recent 1M pullback keeps entry expectations more reasonable.");
        } else if (candidate.oneMonthReturn > 5 && candidate.oneMonthReturn <= 15) {
            score += 5;
        } else if (candidate.oneMonthReturn > 20) {
            score -= 8;
            pushUnique(cautions, "1M return is already very hot.");
        } else if (candidate.oneMonthReturn < -20) {
            score -= 10;
            pushUnique(cautions, "1M weakness is steep, so the trend needs more checking.");
        }
    }

    if (Number.isFinite(candidate.oneYearReturn)) {
        available += 1;
        if (candidate.oneYearReturn >= 5 && candidate.oneYearReturn <= 60) {
            score += 6;
            pushUnique(reasons, "Longer-term trend is still constructive.");
        } else if (candidate.oneYearReturn > 80) {
            score -= 6;
            pushUnique(cautions, "1Y return is already very extended.");
        } else if (candidate.oneYearReturn < -10) {
            score -= 6;
            pushUnique(cautions, "1Y trend is weak.");
        }
    }

    if (Number.isFinite(candidate.oneDayReturn)) {
        available += 1;
        if (Math.abs(candidate.oneDayReturn) <= 2) {
            score += 2;
        } else if (Math.abs(candidate.oneDayReturn) >= 5) {
            score -= 3;
            pushUnique(cautions, "1D move is sharp, so near-term entry risk is higher.");
        }
    }

    if (Number.isFinite(candidate.marketCap)) {
        available += 1;
        if (candidate.marketCap >= 100000) {
            score += 8;
            pushUnique(reasons, "Large market cap improves stability for a conservative shortlist.");
        } else if (candidate.marketCap >= 10000) {
            score += 4;
        } else if (candidate.marketCap < 2000) {
            score -= 5;
            pushUnique(cautions, "Smaller market cap can raise execution and durability risk.");
        }
    }

    return {
        score: available ? clamp(roundScore(score), 0, 100) : null,
        reasons,
        cautions
    };
}

function metricCoverageCount(candidate) {
    return [
        candidate.marketCap,
        candidate.closePrice,
        candidate.peRatio,
        candidate.pbRatio,
        candidate.roe,
        candidate.roce,
        candidate.debtToEquity,
        candidate.salesGrowth,
        candidate.profitGrowth,
        candidate.opm,
        candidate.oneMonthReturn,
        candidate.oneYearReturn,
        candidate.threeYearSalesCagr,
        candidate.threeYearProfitCagr
    ].filter((value) => Number.isFinite(value)).length;
}

function buildUploadedCsvCandidate(row, columnMap) {
    const companyName = readCsvTextValue(row, columnMap, "name") || readCsvTextValue(row, columnMap, "symbol");
    const symbol = readCsvTextValue(row, columnMap, "symbol") || companyName;

    if (!companyName) {
        return null;
    }

    const candidate = {
        companyName,
        symbol,
        subSector: readCsvTextValue(row, columnMap, "subSector") || "Unavailable",
        marketCap: readCsvNumberValue(row, columnMap, "marketCap"),
        closePrice: readCsvNumberValue(row, columnMap, "closePrice"),
        peRatio: readCsvNumberValue(row, columnMap, "peRatio"),
        pbRatio: readCsvNumberValue(row, columnMap, "pbRatio"),
        roe: readCsvNumberValue(row, columnMap, "roe"),
        roce: readCsvNumberValue(row, columnMap, "roce"),
        debtToEquity: readCsvNumberValue(row, columnMap, "debtToEquity"),
        salesGrowth: readCsvNumberValue(row, columnMap, "salesGrowth"),
        profitGrowth: readCsvNumberValue(row, columnMap, "profitGrowth"),
        opm: readCsvNumberValue(row, columnMap, "opm"),
        oneMonthReturn: readCsvNumberValue(row, columnMap, "oneMonthReturn"),
        oneDayReturn: readCsvNumberValue(row, columnMap, "oneDayReturn"),
        oneYearReturn: readCsvNumberValue(row, columnMap, "oneYearReturn"),
        threeYearSalesCagr: readCsvNumberValue(row, columnMap, "threeYearSalesCagr"),
        threeYearProfitCagr: readCsvNumberValue(row, columnMap, "threeYearProfitCagr")
    };

    const coverageCount = metricCoverageCount(candidate);
    if (coverageCount < 3) {
        return null;
    }

    const quality = scoreUploadedQuality(candidate);
    const growth = scoreUploadedGrowth(candidate);
    const valuation = scoreUploadedValuation(candidate);
    const opportunity = scoreUploadedOpportunity(candidate);

    const score = weightedAverageScores([
        { score: quality.score, weight: 0.42 },
        { score: growth.score, weight: 0.23 },
        { score: valuation.score, weight: 0.23 },
        { score: opportunity.score, weight: 0.12 }
    ]);

    if (!Number.isFinite(score)) {
        return null;
    }

    const reasons = [];
    const cautions = [];
    [...quality.reasons, ...growth.reasons, ...valuation.reasons, ...opportunity.reasons].forEach((item) => pushUnique(reasons, item));
    [...quality.cautions, ...growth.cautions, ...valuation.cautions, ...opportunity.cautions].forEach((item) => pushUnique(cautions, item));

    return {
        ...candidate,
        analysisMode: "manual-csv-upload",
        coverageCount,
        score,
        verdict: score >= 78
            ? "Top Compounder Fit"
            : score >= 68
                ? "Strong Candidate"
                : score >= 58
                    ? "Research Further"
                    : "Needs More Work",
        scoreBreakdown: {
            quality: quality.score,
            growth: growth.score,
            valuation: valuation.score,
            opportunity: opportunity.score
        },
        reasons: reasons.slice(0, 5),
        cautions: cautions.slice(0, 5)
    };
}

function buildUploadedCsvAnalysis(text, fileName) {
    const rows = parseCsvText(text);
    if (rows.length < 2) {
        throw new Error("The CSV needs a header row and at least one stock row.");
    }

    const headers = rows[0].map((value) => String(value ?? "").trim());
    const columnMap = buildCsvColumnMap(headers);
    const dataRows = rows.slice(1);

    const candidates = dataRows
        .map((row) => buildUploadedCsvCandidate(row, columnMap))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

    if (!candidates.length) {
        throw new Error("No usable stock rows were found. Export at least Name, Ticker, PE Ratio, PB Ratio, Return on Equity, and Market Cap.");
    }

    const detectedColumns = CSV_COLUMN_SPECS
        .filter((spec) => columnMap[spec.key] >= 0)
        .map((spec) => spec.label);
    const missingRecommendedColumns = CSV_COLUMN_SPECS
        .filter((spec) => spec.importance === "helpful" && columnMap[spec.key] < 0)
        .map((spec) => spec.label);

    return {
        fileName,
        rowCount: dataRows.length,
        rankedCount: candidates.length,
        generatedAt: new Date().toISOString(),
        detectedColumns,
        missingRecommendedColumns,
        topCandidates: candidates.slice(0, 5),
        summary: `Processed ${dataRows.length} rows from ${fileName}. Ranked ${candidates.length} names with at least three usable metrics and selected the top 5 based on quality, valuation, and entry context.`
    };
}

function setInvestingError(message) {
    const banner = document.getElementById("investingPageError");
    banner.hidden = !message;
    banner.textContent = message || "";
}

function renderCsvUploadGuide() {
    const container = document.getElementById("csvUploadGuide");
    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="csv-guide-grid">
            <div class="csv-guide-block">
                <h4>Minimum useful columns</h4>
                ${createInvestingChecklist([
                    "Name",
                    "Ticker",
                    "Market Cap",
                    "Close Price",
                    "PE Ratio",
                    "PB Ratio",
                    "Return on Equity"
                ])}
            </div>
            <div class="csv-guide-block">
                <h4>Best extra columns to bring</h4>
                ${createInvestingChecklist([
                    "Return on Capital Employed",
                    "Debt to Equity",
                    "Sales Growth",
                    "Profit Growth",
                    "Operating Profit Margin",
                    "1Y Return",
                    "3Y Sales CAGR and 3Y Profit CAGR"
                ])}
            </div>
        </div>
        <p class="summary-note">
            Your sample Tickertape export already gives a strong start with Name, Ticker, Sub-Sector, Market Cap, Close Price, PE Ratio, 1M Return, 1D Return, Return on Equity, and PB Ratio.
            If you add ROCE, Debt to Equity, and growth columns, the top-5 shortlist becomes much stronger.
        </p>
    `;
}

function renderCsvUploadStatus() {
    const container = document.getElementById("csvUploadStatus");
    const clearButton = document.getElementById("clearCsvBtn");
    if (!container || !clearButton) {
        return;
    }

    clearButton.disabled = !investingPageState.uploadedCsvAnalysis && !investingPageState.isProcessingCsv;

    if (investingPageState.isProcessingCsv) {
        container.innerHTML = `
            <article class="feed-health-card mode">
                <div class="feed-health-topline">
                    <h3>Processing CSV</h3>
                    <span class="status-chip delayed">Working</span>
                </div>
                <p class="feed-health-copy">Reading the uploaded file and ranking the best fundamental candidates.</p>
            </article>
        `;
        return;
    }

    if (investingPageState.csvUploadError) {
        container.innerHTML = `
            <article class="feed-health-card">
                <div class="feed-health-topline">
                    <h3>Upload Error</h3>
                    <span class="status-chip error">Error</span>
                </div>
                <p class="feed-health-copy">${escapeInvestingHtml(investingPageState.csvUploadError)}</p>
            </article>
        `;
        return;
    }

    if (!investingPageState.uploadedCsvAnalysis) {
        container.innerHTML = `
            <article class="feed-health-card mode">
                <div class="feed-health-topline">
                    <h3>No CSV Yet</h3>
                    <span class="status-chip unavailable">Waiting</span>
                </div>
                <p class="feed-health-copy">Upload a Tickertape CSV and this page will suggest the top 5 fundamental names from your file.</p>
            </article>
        `;
        return;
    }

    const analysis = investingPageState.uploadedCsvAnalysis;
    container.innerHTML = `
        <article class="feed-health-card mode">
            <div class="feed-health-topline">
                <h3>${escapeInvestingHtml(analysis.fileName)}</h3>
                <span class="status-chip live">Processed</span>
            </div>
            <p class="feed-health-copy">${escapeInvestingHtml(analysis.summary)}</p>
            <p class="feed-health-foot">Detected ${escapeInvestingHtml(String(analysis.detectedColumns.length))} useful columns.</p>
        </article>
    `;
}

function renderUploadedCandidateMetrics(candidate) {
    const metricItems = [
        { label: "Price", value: formatInvestingNumber(candidate.closePrice) },
        { label: "Market Cap", value: formatInvestingNumber(candidate.marketCap) },
        { label: "PE", value: formatInvestingNumber(candidate.peRatio) },
        { label: "PB", value: formatInvestingNumber(candidate.pbRatio) },
        { label: "ROE", value: formatInvestingPercent(candidate.roe) },
        { label: "ROCE", value: formatInvestingPercent(candidate.roce) },
        { label: "Debt / Equity", value: formatInvestingNumber(candidate.debtToEquity) },
        { label: "Sales Growth", value: formatInvestingPercent(candidate.salesGrowth) },
        { label: "Profit Growth", value: formatInvestingPercent(candidate.profitGrowth) },
        { label: "1M Return", value: formatInvestingSignedPercent(candidate.oneMonthReturn) }
    ].filter((item) => item.value !== "Unavailable");

    return `
        <div class="investing-metrics">
            ${metricItems.map((item) => `
                <div class="plan-item">
                    <span>${escapeInvestingHtml(item.label)}</span>
                    <strong>${escapeInvestingHtml(item.value)}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function renderUploadedScoreBreakdown(candidate) {
    return `
        <div class="investing-metrics">
            <div class="plan-item">
                <span>Quality</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.quality, "Need more quality data"))}</strong>
            </div>
            <div class="plan-item">
                <span>Growth</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.growth, "Growth data missing"))}</strong>
            </div>
            <div class="plan-item">
                <span>Valuation</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.valuation, "Need valuation data"))}</strong>
            </div>
            <div class="plan-item">
                <span>Opportunity</span>
                <strong>${escapeInvestingHtml(scoreOrNeedsKey(candidate.scoreBreakdown?.opportunity, "Context data missing"))}</strong>
            </div>
        </div>
    `;
}

function renderUploadedCsvIdeas() {
    const section = document.getElementById("csvIdeasSection");
    const container = document.getElementById("csvIdeasPanel");
    if (!section || !container) {
        return;
    }

    const analysis = investingPageState.uploadedCsvAnalysis;
    if (!analysis) {
        section.hidden = true;
        container.innerHTML = "";
        return;
    }

    section.hidden = false;
    container.innerHTML = `
        <div class="investing-intro">
            <p class="eyebrow">Manual CSV</p>
            <h3>Top 5 from ${escapeInvestingHtml(analysis.fileName)}</h3>
            <p class="summary-note">${escapeInvestingHtml(analysis.summary)}</p>
            <div class="tag-row">
                <span class="status-chip live">Browser Processed</span>
                <span class="driver-pill">${escapeInvestingHtml(`${analysis.topCandidates.length} shown`)}</span>
                <span class="driver-pill">${escapeInvestingHtml(`${analysis.rankedCount} ranked`)}</span>
            </div>
        </div>

        <div class="education-columns">
            <article class="education-card">
                <h3>Detected columns</h3>
                ${createInvestingChecklist(analysis.detectedColumns)}
            </article>
            <article class="education-card">
                <h3>Helpful extra columns still missing</h3>
                ${createInvestingChecklist(analysis.missingRecommendedColumns.length
                    ? analysis.missingRecommendedColumns
                    : ["You already included the main helpful columns for this local shortlist."])}
            </article>
        </div>

        <div class="investing-grid">
            ${analysis.topCandidates.map((candidate) => `
                <article class="investing-card ${toneFromInvestingScore(candidate.score)}">
                    <div class="investing-topline">
                        <div>
                            <p class="eyebrow">${escapeInvestingHtml(candidate.symbol)}</p>
                            <h3>${escapeInvestingHtml(candidate.companyName)}</h3>
                            <p class="summary-note">${escapeInvestingHtml(candidate.verdict)}</p>
                        </div>
                        <div class="tag-row">
                            <span class="score-tag ${toneFromInvestingScore(candidate.score)}">${escapeInvestingHtml(String(candidate.score))}/100</span>
                            <span class="status-chip live">Manual CSV</span>
                        </div>
                    </div>

                    ${renderUploadedCandidateMetrics(candidate)}

                    <div class="education-columns">
                        <div class="education-card">
                            <h3>Why it scores well</h3>
                            ${createInvestingChecklist(candidate.reasons.length
                                ? candidate.reasons
                                : ["This stock mainly ranked well because the uploaded file had enough good quality and valuation signals."])}
                        </div>
                        <div class="education-card">
                            <h3>What to double-check</h3>
                            ${createInvestingChecklist(candidate.cautions.length
                                ? candidate.cautions
                                : ["No major caution stood out from the uploaded columns, but annual-report review is still important."])}
                        </div>
                    </div>

                    <div class="education-columns">
                        <div class="education-card">
                            <h3>Score breakdown</h3>
                            ${renderUploadedScoreBreakdown(candidate)}
                        </div>
                        <div class="education-card">
                            <h3>Context</h3>
                            ${createInvestingChecklist([
                                `Sub-Sector: ${candidate.subSector || "Unavailable"}`,
                                `${candidate.coverageCount} usable metrics were found for this stock.`,
                                "This ranking was computed entirely from your uploaded CSV inside the browser."
                            ])}
                        </div>
                    </div>

                    <div class="card-actions">
                        <span class="card-source">${escapeInvestingHtml("Tickertape CSV Upload")}</span>
                    </div>
                </article>
            `).join("")}
        </div>
    `;
}

function renderInvestingFeedStrip(payload) {
    const container = document.getElementById("investingFeedHealthStrip");
    if (!container) {
        return;
    }

    const sourceStatuses = Array.isArray(payload?.sourceStatuses) ? payload.sourceStatuses : [];
    const isPublishedSnapshot = isBrowserStandaloneInvestingMode() && payload?.metadata?.mode === "published-snapshot";

    if (isBrowserStandaloneInvestingMode() && !isPublishedSnapshot) {
        container.innerHTML = `
            <article class="feed-health-card mode">
                <div class="feed-health-topline">
                    <h3>Mode</h3>
                    <span class="status-chip delayed">Browser Standalone</span>
                </div>
                <p class="feed-health-copy">This page is exported for static hosting, but live investing ideas still need either a published snapshot or your own CSV upload.</p>
                <p class="feed-health-foot">Use the upload area above to process your own file right here.</p>
            </article>
            <article class="feed-health-card">
                <div class="feed-health-topline">
                    <h3>NSE Snapshot</h3>
                    <span class="status-chip unavailable">Unavailable</span>
                </div>
                <p class="feed-health-copy">No published investing snapshot was found yet.</p>
                <p class="feed-health-foot">Upload a CSV or publish investing-data.json.</p>
            </article>
        `;
        return;
    }

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
                <span class="status-chip ${escapeInvestingHtml(isPublishedSnapshot ? "delayed" : "live")}">${escapeInvestingHtml(isPublishedSnapshot ? "Published Snapshot" : "Server Assisted")}</span>
            </div>
            <p class="feed-health-copy">${escapeInvestingHtml(isPublishedSnapshot
                ? "This page is reading a generated investing-data.json snapshot published with GitHub Pages."
                : "This page fetches a dedicated investing payload from the app server.")}</p>
            <p class="feed-health-foot">Version ${escapeInvestingHtml(payload?.metadata?.version || "unknown")}</p>
        </article>
        ${sourceCards.join("")}
    `;
}

function renderLiveCandidateMetrics(candidate) {
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
                    "NSE Fallback cards are still useful, but they need manual fundamental validation before you trust the ranking.",
                    "You can also upload your own Tickertape CSV above to get a browser-only top-5 shortlist."
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

                    ${renderLiveCandidateMetrics(candidate)}

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
    const csvAnalysis = investingPageState.uploadedCsvAnalysis;
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
            title: "3. Or upload your own Tickertape CSV",
            detail: csvAnalysis
                ? `Your uploaded file ${csvAnalysis.fileName} was processed locally in the browser and produced a top-${csvAnalysis.topCandidates.length} shortlist.`
                : "The upload area above can rank your own Tickertape export entirely in the browser, which is ideal for GitHub Pages."
        },
        {
            title: "4. Treat this as a research shortlist",
            detail: `After quality, the model checks valuation and entry context. The live feed currently ranked ${candidateCount} names, while the manual CSV tool can shortlist the top 5 from your own export.`
        }
    ];

    const faqItems = [
        {
            question: "What should I export from Tickertape?",
            answer: "At minimum bring Name, Ticker, Market Cap, Close Price, PE Ratio, PB Ratio, and Return on Equity. If Tickertape can also export ROCE, Debt to Equity, Sales Growth, Profit Growth, OPM, and 3Y CAGRs, the ranking becomes much stronger."
        },
        {
            question: "Is my uploaded CSV sent anywhere?",
            answer: "No. The manual CSV ranking happens only inside your browser on this page. It is not uploaded to the app server."
        },
        {
            question: "What makes a stock look like a compounder here?",
            answer: "The strongest cards combine healthy profitability, healthy growth, reasonable valuation, and an entry point that is not already too stretched."
        },
        {
            question: "Why might a quality company still rank lower?",
            answer: "Because the page is looking for both quality and current opportunity. A great business can still rank lower if it looks expensive or is trading after a very extended move."
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
                    "If you upload a CSV, try to include ROCE, debt, and growth columns in addition to PE, PB, and ROE.",
                    "Prefer Fundamentals Enriched live cards or richer CSV exports when you want a stronger business-quality signal.",
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

function getStandaloneInvestingPayload(message = "Published investing snapshot is not available yet.") {
    return {
        generatedAt: null,
        investing: {
            available: false,
            title: "Investment Ideas For Fundamentally Strong Compounders",
            summary: "This static page looks for a published investing snapshot JSON file and also supports manual CSV upload if that file is missing.",
            strategyMode: "nse-valuation-fallback",
            methodologyBadge: "Browser Standalone",
            dataTier: "Browser standalone",
            criteria: [
                "Reads ./investing-data.json when it is published",
                "Supports manual Tickertape CSV upload locally in the browser",
                "Shows the guide even if the snapshot is missing"
            ],
            limitations: [
                message,
                "Run the export or GitHub Pages workflow to generate investing-data.json.",
                "Or upload your own Tickertape CSV above."
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

async function fetchStandaloneSnapshotPayload() {
    const response = await fetch(`./investing-data.json?ts=${Date.now()}`, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("Published investing snapshot is not available yet.");
    }

    return response.json();
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
                "Or upload your own Tickertape CSV above."
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
        try {
            return await fetchStandaloneSnapshotPayload();
        } catch (error) {
            return getStandaloneInvestingPayload(error?.message);
        }
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
        writeInvestingSnapshot(payload);
        document.getElementById("ideasLastUpdated").textContent = payload.generatedAt
            ? formatInvestingTimestamp(payload.generatedAt)
            : "Upload CSV or publish snapshot";
        renderInvestingFeedStrip(payload);
        renderInvestingIdeasPage(payload);
        renderInvestingGuide(payload);
    } catch (error) {
        const cachedPayload = readInvestingSnapshot();
        const fallbackPayload = cachedPayload?.investing
            ? cachedPayload
            : (isBrowserStandaloneInvestingMode()
                ? getStandaloneInvestingPayload(error.message)
                : getUnavailableServerInvestingPayload(error.message));
        setInvestingError(cachedPayload?.investing
            ? (error?.name === "AbortError"
                ? "Investing request took too long. Showing the last saved snapshot."
                : "Unable to refresh live investing ideas. Showing the last saved snapshot.")
            : (error?.name === "AbortError"
                ? "Investing request took too long. Please try again."
                : (error.message || "Unable to load investing ideas.")));
        document.getElementById("ideasLastUpdated").textContent = fallbackPayload.generatedAt
            ? formatInvestingTimestamp(fallbackPayload.generatedAt)
            : "Upload CSV or publish snapshot";
        renderInvestingFeedStrip(fallbackPayload);
        renderInvestingIdeasPage(fallbackPayload);
        renderInvestingGuide(fallbackPayload);
    } finally {
        investingPageState.isLoading = false;
        refreshButton.disabled = false;
        refreshButton.textContent = isBrowserStandaloneInvestingMode() ? "Reload Snapshot" : "Refresh Ideas";
    }
}

async function handleCsvUpload(file) {
    if (!file) {
        return;
    }

    investingPageState.isProcessingCsv = true;
    investingPageState.csvUploadError = "";
    investingPageState.csvUploadMessage = "";
    renderCsvUploadStatus();

    try {
        const text = await file.text();
        investingPageState.uploadedCsvAnalysis = buildUploadedCsvAnalysis(text, file.name);
        investingPageState.csvUploadMessage = `Processed ${file.name}.`;
    } catch (error) {
        investingPageState.uploadedCsvAnalysis = null;
        investingPageState.csvUploadError = error?.message || "Unable to process the uploaded CSV.";
    } finally {
        investingPageState.isProcessingCsv = false;
        renderCsvUploadStatus();
        renderUploadedCsvIdeas();
    }
}

function clearUploadedCsv() {
    investingPageState.uploadedCsvAnalysis = null;
    investingPageState.csvUploadError = "";
    investingPageState.csvUploadMessage = "";
    renderCsvUploadStatus();
    renderUploadedCsvIdeas();
}

window.addEventListener("DOMContentLoaded", () => {
    const refreshButton = document.getElementById("refreshIdeasBtn");
    const chooseCsvButton = document.getElementById("chooseCsvBtn");
    const clearCsvButton = document.getElementById("clearCsvBtn");
    const csvInput = document.getElementById("tickertapeCsvInput");

    renderCsvUploadGuide();
    renderCsvUploadStatus();
    renderUploadedCsvIdeas();

    const cachedPayload = readInvestingSnapshot();
    if (cachedPayload?.investing) {
        document.getElementById("ideasLastUpdated").textContent = cachedPayload.generatedAt
            ? formatInvestingTimestamp(cachedPayload.generatedAt)
            : "Upload CSV or publish snapshot";
        renderInvestingFeedStrip(cachedPayload);
        renderInvestingIdeasPage(cachedPayload);
        renderInvestingGuide(cachedPayload);
        setInvestingError("Showing the last saved investing snapshot while live data refreshes.");
    }

    refreshButton.addEventListener("click", () => {
        loadInvestingPage();
    });

    chooseCsvButton.addEventListener("click", () => {
        csvInput.click();
    });

    clearCsvButton.addEventListener("click", () => {
        clearUploadedCsv();
        csvInput.value = "";
    });

    csvInput.addEventListener("change", async () => {
        const file = csvInput.files?.[0];
        await handleCsvUpload(file);
        csvInput.value = "";
    });

    loadInvestingPage();
});
