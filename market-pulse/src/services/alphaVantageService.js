const {
    ALPHA_VANTAGE_BASE_URL,
    SOURCE_LABELS,
    SOURCE_LINKS,
    TIMEOUTS,
    TOKENS
} = require("../config/sources");
const { fetchJson, normalizeError } = require("../utils/http");
const { createSourceStatus, round } = require("../utils/formatters");

const overviewCache = new Map();

function parseNumericString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    if (!normalized || /^none$/i.test(normalized) || normalized === "-") {
        return null;
    }

    const numeric = Number(normalized.replace(/,/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
}

function parsePercentString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    if (!normalized || /^none$/i.test(normalized) || normalized === "-") {
        return null;
    }

    const numeric = Number(normalized.replace(/%/g, "").replace(/,/g, ""));
    if (!Number.isFinite(numeric)) {
        return null;
    }

    return normalized.includes("%") ? numeric : round(numeric * 100, 2);
}

function mapOverview(symbol, apiSymbol, rawOverview, fetchedAt) {
    return {
        symbol,
        apiSymbol,
        updatedAt: fetchedAt,
        name: rawOverview.Name || symbol,
        description: rawOverview.Description || null,
        exchange: rawOverview.Exchange || null,
        currency: rawOverview.Currency || null,
        country: rawOverview.Country || null,
        sector: rawOverview.Sector || null,
        industry: rawOverview.Industry || null,
        marketCapitalization: parseNumericString(rawOverview.MarketCapitalization),
        peRatio: parseNumericString(rawOverview.PERatio),
        forwardPe: parseNumericString(rawOverview.ForwardPE),
        pegRatio: parseNumericString(rawOverview.PEGRatio),
        priceToBookRatio: parseNumericString(rawOverview.PriceToBookRatio),
        analystTargetPrice: parseNumericString(rawOverview.AnalystTargetPrice),
        bookValue: parseNumericString(rawOverview.BookValue),
        dividendYield: parsePercentString(rawOverview.DividendYield),
        profitMargin: parsePercentString(rawOverview.ProfitMargin),
        operatingMarginTTM: parsePercentString(rawOverview.OperatingMarginTTM),
        returnOnAssetsTTM: parsePercentString(rawOverview.ReturnOnAssetsTTM),
        returnOnEquityTTM: parsePercentString(rawOverview.ReturnOnEquityTTM),
        quarterlyRevenueGrowthYOY: parsePercentString(rawOverview.QuarterlyRevenueGrowthYOY),
        quarterlyEarningsGrowthYOY: parsePercentString(rawOverview.QuarterlyEarningsGrowthYOY),
        evToRevenue: parseNumericString(rawOverview.EVToRevenue),
        evToEbitda: parseNumericString(rawOverview.EVToEBITDA),
        beta: parseNumericString(rawOverview.Beta),
        fiftyTwoWeekHigh: parseNumericString(rawOverview["52WeekHigh"]),
        fiftyTwoWeekLow: parseNumericString(rawOverview["52WeekLow"]),
        source: "Alpha Vantage",
        sourceUrl: SOURCE_LINKS.alphaVantageDocs
    };
}

async function fetchAlphaVantageOverview(symbol, apiSymbol) {
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=OVERVIEW&symbol=${encodeURIComponent(apiSymbol)}&apikey=${encodeURIComponent(TOKENS.alphaVantageApiKey)}`;
    const { data } = await fetchJson(url, { timeoutMs: 30000 });

    if (data.Note) {
        throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
    }

    if (data.Information) {
        throw new Error(data.Information);
    }

    if (data["Error Message"]) {
        throw new Error(data["Error Message"]);
    }

    if (!data.Symbol) {
        throw new Error(`Alpha Vantage returned no symbol profile for ${apiSymbol}.`);
    }

    const fetchedAt = new Date().toISOString();
    return mapOverview(symbol, apiSymbol, data, fetchedAt);
}

function getCacheEntry(symbol) {
    const cached = overviewCache.get(symbol);
    const cacheHours = Number.isFinite(TIMEOUTS.alphaVantageCacheHours) ? TIMEOUTS.alphaVantageCacheHours : 24;
    const cacheMs = Math.max(1, cacheHours) * 60 * 60 * 1000;

    if (!cached) {
        return null;
    }

    if ((Date.now() - cached.fetchedAt) > cacheMs) {
        return null;
    }

    return cached.data;
}

function setCacheEntry(symbol, data) {
    overviewCache.set(symbol, {
        fetchedAt: Date.now(),
        data
    });
}

async function fetchAlphaVantageFundamentals(universe = []) {
    if (!TOKENS.alphaVantageApiKey) {
        return {
            bySymbol: {},
            sourceStatus: createSourceStatus(
                "alphaVantageFundamentals",
                SOURCE_LABELS.alphaVantageFundamentals,
                "unavailable",
                "ALPHA_VANTAGE_API_KEY is not configured, so the investing page is using the NSE-only fallback model.",
                null,
                "Alpha Vantage",
                SOURCE_LINKS.alphaVantageKeySignup
            ),
            coverage: {
                available: 0,
                cached: 0,
                total: universe.length
            }
        };
    }

    const bySymbol = {};
    const errors = [];
    let cachedCount = 0;
    let rateLimitReached = false;

    for (const item of universe) {
        const symbol = String(item?.symbol || "").trim().toUpperCase();
        const apiSymbol = String(item?.alphaVantageSymbol || "").trim();

        if (!symbol || !apiSymbol) {
            continue;
        }

        const cached = getCacheEntry(symbol);
        if (cached) {
            bySymbol[symbol] = cached;
            cachedCount += 1;
            continue;
        }

        if (rateLimitReached) {
            errors.push(`${symbol}: skipped because the Alpha Vantage free-tier limit was already reached during this refresh.`);
            continue;
        }

        try {
            const overview = await fetchAlphaVantageOverview(symbol, apiSymbol);
            bySymbol[symbol] = overview;
            setCacheEntry(symbol, overview);
        } catch (error) {
            const message = normalizeError(error);
            if (/rate limit/i.test(message)) {
                rateLimitReached = true;
            }
            errors.push(`${symbol}: ${message}`);
        }
    }

    const available = Object.keys(bySymbol).length;
    const lastUpdated = Object.values(bySymbol)
        .map((item) => item.updatedAt)
        .find(Boolean) || null;

    let status = "live";
    let message = `Loaded ${available}/${universe.length} Alpha Vantage overview profiles for the investing page.`;

    if (!available) {
        status = "error";
        message = errors[0] || "Alpha Vantage did not return any overview profiles.";
    } else if (available < universe.length) {
        status = "partial";
        message = `Loaded ${available}/${universe.length} Alpha Vantage overview profiles. ${errors[0] || "Some symbols are still missing deep fundamentals."}`;
    } else if (cachedCount) {
        message = `Loaded ${available}/${universe.length} Alpha Vantage overview profiles, reusing ${cachedCount} cached entries to stay within free-tier limits.`;
    }

    return {
        bySymbol,
        sourceStatus: createSourceStatus(
            "alphaVantageFundamentals",
            SOURCE_LABELS.alphaVantageFundamentals,
            status,
            message,
            lastUpdated,
            "Alpha Vantage",
            SOURCE_LINKS.alphaVantageDocs
        ),
        coverage: {
            available,
            cached: cachedCount,
            total: universe.length
        }
    };
}

module.exports = {
    fetchAlphaVantageFundamentals
};
