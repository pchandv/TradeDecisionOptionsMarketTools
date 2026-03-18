const { fetchNseSnapshot } = require("./nseService");
const { fetchYahooQuotes } = require("./yahooService");
const { fetchNewsData: fetchRawNewsData } = require("./newsService");
const { processNewsSentiment } = require("../engine/newsEngine");
const { calculateSignalScore } = require("../engine/signalEngine");
const {
    buildTradePlan,
    monitorActiveTrade,
    normalizeActiveTrade,
    normalizeTraderProfile
} = require("../engine/tradePlanEngine");
const { createUnavailableInstrument, formatValue, round } = require("../utils/formatters");
const { INSTRUMENTS, SOURCE_LINKS } = require("../config/sources");

const INDIA_INSTRUMENT_FALLBACKS = {
    nifty: {
        key: "nifty",
        label: "NIFTY 50",
        symbol: "NIFTY 50",
        source: "NSE India",
        sourceUrl: SOURCE_LINKS.nseIndices
    },
    bankNifty: {
        key: "bankNifty",
        label: "BANK NIFTY",
        symbol: "NIFTY BANK",
        source: "NSE India",
        sourceUrl: SOURCE_LINKS.nseIndices
    },
    indiaVix: {
        key: "indiaVix",
        label: "INDIA VIX",
        symbol: "INDIA VIX",
        source: "NSE India",
        sourceUrl: SOURCE_LINKS.nseIndices
    },
    giftNifty: {
        key: "giftNifty",
        label: "GIFT NIFTY",
        symbol: "GIFT NIFTY",
        source: "NSE India",
        sourceUrl: SOURCE_LINKS.nseMarketStatus
    }
};

const feedCache = {
    market: new Map(),
    macro: new Map(),
    news: new Map()
};

function buildCacheKey(parts) {
    return parts.filter(Boolean).join(":");
}

function refreshCachedFeed(entry, loader, freshTtlMs, staleTtlMs) {
    entry.inFlight = (async () => {
        try {
            const value = await loader();
            entry.value = value;
            entry.expiresAt = Date.now() + freshTtlMs;
            entry.staleUntil = Date.now() + staleTtlMs;
            return value;
        } catch (error) {
            if (entry.value && entry.staleUntil > Date.now()) {
                return entry.value;
            }
            throw error;
        } finally {
            entry.inFlight = null;
        }
    })();

    return entry.inFlight;
}

async function getCachedFeed(cacheName, cacheKey, freshTtlMs, staleTtlMs, loader) {
    const cacheBucket = feedCache[cacheName];
    const now = Date.now();
    const existing = cacheBucket.get(cacheKey);

    if (existing?.value && existing.expiresAt > now) {
        return existing.value;
    }

    if (existing?.inFlight) {
        if (existing.value && existing.staleUntil > now) {
            return existing.value;
        }
        return existing.inFlight;
    }

    const entry = existing || {
        value: null,
        expiresAt: 0,
        staleUntil: 0,
        inFlight: null
    };

    cacheBucket.set(cacheKey, entry);
    const refreshPromise = refreshCachedFeed(entry, loader, freshTtlMs, staleTtlMs);

    if (entry.value && entry.staleUntil > now) {
        refreshPromise.catch(() => {});
        return entry.value;
    }

    return refreshPromise;
}

function withFallbackInstrument(instrument, definition, reason) {
    return instrument || createUnavailableInstrument(definition, reason);
}

async function loadMarketData(traderProfile = {}) {
    const [nseSnapshot, yahooMarkets] = await Promise.all([
        fetchNseSnapshot({
            preferredInstrument: traderProfile.preferredInstrument,
            expiryPreference: traderProfile.expiryPreference
        }),
        fetchYahooQuotes("yahooMarket")
    ]);

    const sensex = yahooMarkets.quotes.sensex || createUnavailableInstrument(INSTRUMENTS.yahooMarket.sensex, "Unavailable");
    const indian = {
        nifty: withFallbackInstrument(nseSnapshot.indian?.nifty, INDIA_INSTRUMENT_FALLBACKS.nifty, "NSE index feed unavailable."),
        bankNifty: withFallbackInstrument(nseSnapshot.indian?.bankNifty, INDIA_INSTRUMENT_FALLBACKS.bankNifty, "NSE index feed unavailable."),
        indiaVix: withFallbackInstrument(nseSnapshot.indian?.indiaVix, INDIA_INSTRUMENT_FALLBACKS.indiaVix, "NSE volatility feed unavailable."),
        giftNifty: withFallbackInstrument(nseSnapshot.indian?.giftNifty, INDIA_INSTRUMENT_FALLBACKS.giftNifty, "NSE market status feed unavailable.")
    };

    return {
        india: {
            ...indian,
            sensex
        },
        global: {
            nasdaqFutures: yahooMarkets.quotes.nasdaqFutures,
            sp500Futures: yahooMarkets.quotes.sp500Futures,
            dowFutures: yahooMarkets.quotes.dowFutures,
            nikkei: yahooMarkets.quotes.nikkei,
            hangSeng: yahooMarkets.quotes.hangSeng,
            asx200: yahooMarkets.quotes.asx200
        },
        internals: {
            breadth: nseSnapshot.breadth,
            optionChain: nseSnapshot.optionChain,
            optionChains: nseSnapshot.optionChains,
            fiiDii: nseSnapshot.fiiDii,
            oiSpurts: nseSnapshot.oiSpurts
        },
        marketStatus: nseSnapshot.marketStatus,
        sourceStatuses: [
            ...nseSnapshot.sourceStatuses,
            yahooMarkets.sourceStatus
        ]
    };
}

async function fetchMarketData(traderProfile = {}) {
    const cacheKey = buildCacheKey([
        traderProfile.preferredInstrument || "NIFTY",
        traderProfile.expiryPreference || "current"
    ]);

    return getCachedFeed("market", cacheKey, 15000, 180000, () => loadMarketData(traderProfile));
}

async function loadMacroData() {
    const yahooMacro = await fetchYahooQuotes("yahooMacro");
    return {
        macro: {
            us10y: yahooMacro.quotes.us10y,
            dxy: yahooMacro.quotes.dxy,
            crude: yahooMacro.quotes.crude,
            brent: yahooMacro.quotes.brent,
            gold: yahooMacro.quotes.gold,
            silver: yahooMacro.quotes.silver,
            naturalGas: yahooMacro.quotes.naturalGas
        },
        sourceStatuses: [yahooMacro.sourceStatus]
    };
}

async function fetchMacroData() {
    return getCachedFeed("macro", "default", 30000, 300000, loadMacroData);
}

async function fetchNewsData() {
    return getCachedFeed("news", "default", 45000, 300000, fetchRawNewsData);
}

function buildSummaryCards(payload) {
    return [
        payload.india.nifty,
        payload.india.bankNifty,
        payload.india.giftNifty,
        payload.india.indiaVix,
        payload.macro.crude,
        payload.macro.us10y,
        payload.macro.dxy,
        payload.macro.gold
    ];
}

function formatMacroNarrativeValue(instrument, suffix = "") {
    return Number.isFinite(instrument?.price)
        ? `${formatValue(instrument.price)}${suffix}`
        : "Unavailable";
}

function getIstTimeParts() {
    const formatter = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
    const parts = formatter.formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return {
        weekday: map.weekday,
        hour: Number(map.hour),
        minute: Number(map.minute)
    };
}

function deriveSessionFromClock() {
    const { weekday, hour, minute } = getIstTimeParts();
    const totalMinutes = (hour * 60) + minute;
    const isWeekend = weekday === "Sat" || weekday === "Sun";

    if (isWeekend) {
        return {
            mode: "CLOSED",
            label: "Closed",
            estimated: true,
            note: "Exchange is likely closed. Use the dashboard for planning, not live execution."
        };
    }

    if (totalMinutes < 555) {
        return {
            mode: "PREOPEN",
            label: "Pre-open",
            estimated: true,
            note: "Use this for prep and opening levels. Wait for the first 15 minutes after the open."
        };
    }

    if (totalMinutes < 930) {
        return {
            mode: "LIVE",
            label: "Live market",
            estimated: true,
            note: "Use live price confirmation before entering."
        };
    }

    return {
        mode: "POSTCLOSE",
        label: "Post-close",
        estimated: true,
        note: "Treat this as next-session prep, not immediate execution."
    };
}

function deriveTradingSession(marketStatus) {
    const capitalMarketState = marketStatus?.marketState?.find((item) => item.market === "Capital Market");
    const rawState = `${capitalMarketState?.marketStatus || ""} ${capitalMarketState?.marketStatusMessage || ""}`.toUpperCase();

    if (rawState.includes("PRE")) {
        return {
            mode: "PREOPEN",
            label: "Pre-open",
            estimated: false,
            note: "Use this for prep and opening levels. Wait for the first 15 minutes after the open."
        };
    }

    if (rawState.includes("OPEN") || rawState.includes("REGULAR")) {
        return {
            mode: "LIVE",
            label: "Live market",
            estimated: false,
            note: "Use live price confirmation before entering."
        };
    }

    if (rawState.includes("CLOSE") || rawState.includes("POST")) {
        return {
            mode: "POSTCLOSE",
            label: "Post-close",
            estimated: false,
            note: "Treat this as next-session prep, not immediate execution."
        };
    }

    return deriveSessionFromClock();
}

function buildNarrative(payload) {
    const optionChain = payload.internals.optionChain;
    const fii = payload.internals.fiiDii.combined || [];
    const fiiNet = fii.find((item) => item.category === "FII/FPI")?.netValue;
    const diiNet = fii.find((item) => item.category === "DII")?.netValue;

    return {
        optionLevels: optionChain ? {
            support: optionChain.support ? `${optionChain.support.strike} (${optionChain.support.openInterest.toLocaleString("en-IN")} PE OI)` : "Unavailable",
            resistance: optionChain.resistance ? `${optionChain.resistance.strike} (${optionChain.resistance.openInterest.toLocaleString("en-IN")} CE OI)` : "Unavailable",
            sourceUrl: optionChain.sourceUrl || null
        } : {
            support: "Unavailable",
            resistance: "Unavailable",
            sourceUrl: null
        },
        institutionalFlows: {
            fii: fiiNet !== undefined ? `Rs ${formatValue(Number(fiiNet))} Cr` : "Unavailable",
            dii: diiNet !== undefined ? `Rs ${formatValue(Number(diiNet))} Cr` : "Unavailable",
            sourceUrl: "https://www.nseindia.com/reports/fii-dii"
        },
        macroSummary: `DXY ${formatMacroNarrativeValue(payload.macro.dxy)}, US10Y ${formatMacroNarrativeValue(payload.macro.us10y, "%")}, Brent ${formatMacroNarrativeValue(payload.macro.brent)}.`
    };
}

async function buildDashboardPayload(options = {}) {
    const traderProfile = normalizeTraderProfile(options);
    const activeTrade = normalizeActiveTrade(options);
    const [marketData, macroData, newsData] = await Promise.all([
        fetchMarketData(traderProfile),
        fetchMacroData(),
        fetchNewsData()
    ]);

    const news = processNewsSentiment(newsData.buckets);
    const payload = {
        ...marketData,
        ...macroData,
        news,
        session: deriveTradingSession(marketData.marketStatus),
        traderProfile,
        summaryCards: [],
        narrative: {},
        tradePlan: null,
        tradeMonitor: null
    };

    const signal = calculateSignalScore({
        india: payload.india,
        global: payload.global,
        macro: payload.macro,
        internals: payload.internals,
        news: payload.news
    });

    payload.signal = signal;
    payload.summaryCards = buildSummaryCards(payload);
    payload.narrative = buildNarrative(payload);
    payload.tradePlan = buildTradePlan(payload, traderProfile);
    payload.tradeMonitor = monitorActiveTrade(payload, activeTrade);

    return {
        generatedAt: new Date().toISOString(),
        dashboard: payload,
        sourceStatuses: [
            ...marketData.sourceStatuses,
            ...macroData.sourceStatuses,
            ...newsData.sourceStatuses
        ],
        metadata: {
            version: "1.1.0",
            coverage: round((signal.breakdown.filter((item) => item.currentValue !== "Unavailable").length / signal.breakdown.length) * 100, 0)
        }
    };
}

module.exports = {
    buildDashboardPayload,
    fetchMacroData,
    fetchMarketData,
    fetchNewsData,
    processNewsSentiment,
    calculateSignalScore
};
