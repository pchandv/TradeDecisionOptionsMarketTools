const { fetchNseSnapshot } = require("./nseService");
const { fetchIntradayContext } = require("./intradayService");
const { fetchYahooQuotes } = require("./yahooService");
const { fetchNewsData: fetchRawNewsData } = require("./newsService");
const { processNewsSentiment } = require("../engine/newsEngine");
const { calculateSignalScore } = require("../engine/signalEngine");
const { buildDecisionEngine } = require("../engine/decisionEngine");
const {
    buildOptionsPlaybook,
    buildTradePlan,
    monitorActiveTrade,
    normalizeActiveTrade,
    normalizeTraderProfile
} = require("../engine/tradePlanEngine");
const { recordLearningSnapshot } = require("./learningLogService");
const { createUnavailableInstrument, formatValue, round } = require("../utils/formatters");
const { INSTRUMENTS, SOURCE_LINKS } = require("../config/sources");
const { getBuildInfo } = require("../config/buildInfo");

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
    news: new Map(),
    intraday: new Map()
};

const FEED_STALE_LIMITS_MS = {
    yahooIntraday: 12 * 60 * 1000,
    nseOptionChain: 6 * 60 * 1000,
    nseBankOptionChain: 6 * 60 * 1000,
    nseIndices: 8 * 60 * 1000,
    nseMarketStatus: 15 * 60 * 1000,
    nseFiiDii: 24 * 60 * 60 * 1000,
    nseOiSpurts: 24 * 60 * 60 * 1000,
    yahooMarket: 20 * 60 * 1000,
    yahooMacro: 30 * 60 * 1000,
    indiaNews: 12 * 60 * 60 * 1000,
    usNews: 12 * 60 * 60 * 1000,
    macroNews: 12 * 60 * 60 * 1000
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

async function fetchIntradayData() {
    return getCachedFeed("intraday", "default", 10000, 60000, fetchIntradayContext);
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

function parseBooleanFlag(value) {
    return value === true
        || value === "true"
        || value === "1"
        || value === 1
        || value === "yes";
}

function getAlternateEngineVersion(engineVersion) {
    return engineVersion === "adaptive-v2" ? "institutional-v1" : "adaptive-v2";
}

function buildEngineCompare(primaryDecision, alternateDecision) {
    if (!primaryDecision || !alternateDecision) {
        return {
            enabled: false
        };
    }

    const primaryAction = primaryDecision.action || "WAIT";
    const alternateAction = alternateDecision.action || "WAIT";
    const primaryState = primaryDecision.status || "WAIT";
    const alternateState = alternateDecision.status || "WAIT";
    const conflict = primaryAction !== alternateAction || primaryState !== alternateState || primaryDecision.bias !== alternateDecision.bias;

    return {
        enabled: true,
        conflict,
        summary: conflict
            ? `${primaryDecision.engineLabel} and ${alternateDecision.engineLabel} disagree on direction or readiness.`
            : `${primaryDecision.engineLabel} and ${alternateDecision.engineLabel} are aligned.`,
        primary: {
            engineVersion: primaryDecision.engineVersion,
            engineLabel: primaryDecision.engineLabel,
            status: primaryState,
            action: primaryAction,
            bias: primaryDecision.bias || "NEUTRAL",
            confidence: Number(primaryDecision.confidence || 0),
            score: Number(primaryDecision.score || 0),
            summary: primaryDecision.summary || ""
        },
        alternate: {
            engineVersion: alternateDecision.engineVersion,
            engineLabel: alternateDecision.engineLabel,
            status: alternateState,
            action: alternateAction,
            bias: alternateDecision.bias || "NEUTRAL",
            confidence: Number(alternateDecision.confidence || 0),
            score: Number(alternateDecision.score || 0),
            summary: alternateDecision.summary || ""
        }
    };
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

function getFreshnessSummary(source, nowMs) {
    if (!source?.lastUpdated) {
        return {
            freshnessMinutes: null,
            freshnessLabel: "No timestamp",
            stale: ["error", "unavailable"].includes(String(source?.status || "").toLowerCase())
        };
    }

    const ageMs = Math.max(0, nowMs - new Date(source.lastUpdated).getTime());
    const freshnessMinutes = round(ageMs / 60000, 1);
    const staleLimit = FEED_STALE_LIMITS_MS[source.key] || (30 * 60 * 1000);
    return {
        freshnessMinutes,
        freshnessLabel: freshnessMinutes < 1 ? "<1 min old" : `${freshnessMinutes} min old`,
        stale: ageMs > staleLimit
    };
}

function buildFeedHealth(sourceStatuses = [], traderProfile = {}) {
    const nowMs = Date.now();
    const preferredOptionChainKey = traderProfile.preferredInstrument === "BANKNIFTY"
        ? "nseBankOptionChain"
        : "nseOptionChain";
    const criticalKeys = new Set(["yahooIntraday", preferredOptionChainKey, "nseIndices"]);

    const sources = sourceStatuses.map((source) => {
        const freshness = getFreshnessSummary(source, nowMs);
        return {
            ...source,
            ...freshness,
            critical: criticalKeys.has(source.key)
        };
    });

    const staleCriticalSources = sources.filter((source) => source.critical && (source.stale || ["error", "unavailable"].includes(String(source.status || "").toLowerCase())));
    return {
        proxy: {
            connected: true,
            mode: "server-side",
            label: "Server-side live fetch",
            detail: "The main app is fetching live sources server-side, so browser CORS is not part of the data path."
        },
        sources,
        staleCriticalSources,
        blocksTradeSignals: staleCriticalSources.length > 0,
        summary: staleCriticalSources.length
            ? `Critical feeds are stale: ${staleCriticalSources.map((source) => source.label).join(", ")}.`
            : "Critical feeds are fresh enough for live decision support."
    };
}

function applyFeedHealthGuard(payload, feedHealth) {
    if (!feedHealth?.blocksTradeSignals || !payload?.decision) {
        return;
    }

    payload.decision.status = "WAIT";
    payload.decision.mode = "WAIT";
    payload.decision.action = "WAIT";
    payload.decision.headline = "WAIT";
    payload.decision.summary = `${feedHealth.summary} Actionable trade signals are paused until freshness recovers.`;
    payload.decision.noTradeZone = {
        active: true,
        reasons: [
            ...(payload.decision.noTradeZone?.reasons || []),
            ...feedHealth.staleCriticalSources.map((source) => `${source.label} is stale (${source.freshnessLabel || "timestamp unavailable"}).`)
        ]
    };
    payload.decision.optionsIntelligence = {
        ...(payload.decision.optionsIntelligence || {}),
        suggestedStructure: "WAIT",
        warnings: [
            ...(payload.decision.optionsIntelligence?.warnings || []),
            feedHealth.summary
        ]
    };
    payload.decision.quick = {
        ...(payload.decision.quick || {}),
        status: "WAIT",
        optionType: "WAIT"
    };
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
    const compareMode = parseBooleanFlag(options.compareMode);
    const buildInfo = getBuildInfo();
    const [marketData, macroData, newsData, intradayData] = await Promise.all([
        fetchMarketData(traderProfile),
        fetchMacroData(),
        fetchNewsData(),
        fetchIntradayData()
    ]);

    const news = processNewsSentiment(newsData.buckets);
    const payload = {
        ...marketData,
        ...macroData,
        news,
        intraday: intradayData.instruments,
        session: deriveTradingSession(marketData.marketStatus),
        traderProfile,
        summaryCards: [],
        narrative: {},
        decision: null,
        tradePlan: null,
        optionsPlaybook: null,
        tradeMonitor: null
    };

    const signal = calculateSignalScore({
        india: payload.india,
        global: payload.global,
        macro: payload.macro,
        internals: payload.internals,
        news: payload.news,
        session: payload.session
    });

    payload.signal = signal;
    const decisionContext = {
        traderProfile,
        activeTrade,
        session: payload.session,
        india: payload.india,
        global: payload.global,
        macro: payload.macro,
        internals: payload.internals,
        news: payload.news,
        intraday: intradayData,
        signal
    };
    const sourceStatuses = [
        ...marketData.sourceStatuses,
        ...macroData.sourceStatuses,
        ...newsData.sourceStatuses,
        ...intradayData.sourceStatuses
    ];
    payload.feedHealth = buildFeedHealth(sourceStatuses, traderProfile);
    payload.decision = buildDecisionEngine(decisionContext);
    applyFeedHealthGuard(payload, payload.feedHealth);
    if (compareMode) {
        const alternateProfile = {
            ...traderProfile,
            engineVersion: getAlternateEngineVersion(traderProfile.engineVersion)
        };
        const alternateContainer = {
            decision: buildDecisionEngine({
                ...decisionContext,
                traderProfile: alternateProfile
            })
        };
        applyFeedHealthGuard(alternateContainer, payload.feedHealth);
        payload.engineCompare = buildEngineCompare(payload.decision, alternateContainer.decision);
    } else {
        payload.engineCompare = {
            enabled: false
        };
    }
    payload.decision.learning = await recordLearningSnapshot({
        decision: payload.decision,
        traderProfile,
        currentPrice: payload.decision?.marketContext?.selectedPrice,
        generatedAt: new Date().toISOString()
    });
    payload.summaryCards = buildSummaryCards(payload);
    payload.narrative = buildNarrative(payload);
    payload.tradePlan = buildTradePlan(payload, traderProfile);
    payload.optionsPlaybook = buildOptionsPlaybook(payload, traderProfile);
    payload.tradeMonitor = monitorActiveTrade(payload, activeTrade);

    if (activeTrade && payload.tradeMonitor) {
        if (["FULL_EXIT", "INVALIDATED"].includes(payload.tradeMonitor.action)) {
            payload.decision.status = "EXIT";
            payload.decision.headline = "EXIT";
            payload.decision.summary = payload.tradeMonitor.detail;
            payload.decision.quick.status = "EXIT";
        } else if (["HOLD", "TRAIL", "PARTIAL_EXIT"].includes(payload.tradeMonitor.action)) {
            payload.decision.status = "TRADE";
            payload.decision.quick.status = "TRADE";
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        dashboard: payload,
        sourceStatuses: payload.feedHealth.sources,
        metadata: {
            version: buildInfo.version,
            builtAt: buildInfo.builtAt,
            buildSource: buildInfo.source,
            coverage: round((signal.breakdown.filter((item) => item.currentValue !== "Unavailable").length / signal.breakdown.length) * 100, 0),
            proxy: payload.feedHealth.proxy,
            compareMode
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
