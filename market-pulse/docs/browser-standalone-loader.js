(function browserStandaloneLoader() {
    const SNAPSHOT_KEY = "live-market-dashboard.browser-standalone.snapshot";
    const PROXY_ORIGIN_KEY = "live-market-dashboard.browser-standalone.proxy-origin";
    const PROXY_ORIGIN_QUERY_KEY = "proxyOrigin";
    const BUILD_INFO_PATH = "./build-info.json";
    const HTTP_TIMEOUT_MS = 20000;
    const SAME_ORIGIN_PROXY_PATH = "/api/proxy";
    const SAME_ORIGIN_HEALTH_PATH = "/api/health";
    const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
    const NSE_BASE_URL = "https://www.nseindia.com";
    const USE_NSE_CREDENTIALS = false;

    const MONTHS = {
        Jan: 0,
        Feb: 1,
        Mar: 2,
        Apr: 3,
        May: 4,
        Jun: 5,
        Jul: 6,
        Aug: 7,
        Sep: 8,
        Oct: 9,
        Nov: 10,
        Dec: 11
    };

    const SIGNAL_CONFIG = {
        maxAbsoluteScore: 91,
        weights: {
            giftNifty: 14,
            niftyPriceAction: 8,
            indiaVix: 12,
            bankStrength: 8,
            breadth: 8,
            pcr: 10,
            fiiDii: 8,
            globalCues: 11,
            dxy: 5,
            us10y: 7,
            crude: 6,
            news: 12
        },
        openingGapPct: {
            bullish: 0.35,
            bearish: -0.35
        }
    };

    const DECISION_CONFIG = {
        defaultVersion: "adaptive-v2",
        engineVersions: {
            "institutional-v1": {
                key: "institutional-v1",
                label: "Institutional v1"
            },
            "adaptive-v2": {
                key: "adaptive-v2",
                label: "Adaptive AI v2"
            }
        },
        minimumConfidence: 64,
        vwapBandPercent: 0.18,
        institutionalModel: {
            giftFlatThreshold: 0.2,
            vixBullishThreshold: 13,
            vixBearishThreshold: 20,
            pcrBullishThreshold: 0.7,
            pcrBearishThreshold: 1.2,
            breadthBullishThreshold: 1.2,
            breadthBearishThreshold: 0.8,
            tradeScoreThreshold: 0.4,
            trapGapThreshold: 0.5,
            weights: {
                gift: 0.2,
                vix: 0.15,
                pcr: 0.15,
                breadth: 0.15,
                flows: 0.15,
                price: 0.2
            }
        },
        adaptiveModel: {
            scoreRange: {
                minimum: -100,
                maximum: 100
            },
            scoreBands: {
                strongBullish: 70,
                mildBullish: 40,
                mildBearish: -40,
                strongBearish: -70
            },
            tradeThreshold: 40,
            globalOverlayMax: 8,
            maxPainNeutralBandPercent: 0.15,
            vwapTrendBandPercent: 0.18,
            priceBreakBufferPercent: 0.08,
            ivHighPercentile: 75,
            ivExtremePercentile: 90,
            riskRewardFloor: 2,
            pcr: {
                bullish: 0.7,
                bearish: 1.2
            },
            regime: {
                atrExpansionVolatile: 1.22,
                ivPercentileVolatile: 80,
                oiDirectionalTrending: 0.3,
                rsiTrendFloor: 55,
                rsiTrendCeiling: 45
            },
            weights: {
                pcr: 14,
                maxPain: 12,
                oiBalance: 16,
                vwap: 16,
                rsi: 14,
                iv: 12,
                priceAction: 16
            }
        }
    };

    const INSTRUMENTS = {
        yahooMarket: {
            sensex: { key: "sensex", label: "SENSEX", symbol: "^BSESN", source: "Yahoo Finance" },
            nasdaqFutures: { key: "nasdaqFutures", label: "Nasdaq Futures", symbol: "NQ=F", source: "Yahoo Finance" },
            sp500Futures: { key: "sp500Futures", label: "S&P 500 Futures", symbol: "ES=F", source: "Yahoo Finance" },
            dowFutures: { key: "dowFutures", label: "Dow Futures", symbol: "YM=F", source: "Yahoo Finance" },
            nikkei: { key: "nikkei", label: "Nikkei 225", symbol: "^N225", source: "Yahoo Finance" },
            hangSeng: { key: "hangSeng", label: "Hang Seng", symbol: "^HSI", source: "Yahoo Finance" },
            asx200: { key: "asx200", label: "ASX 200", symbol: "^AXJO", source: "Yahoo Finance" }
        },
        yahooMacro: {
            us10y: { key: "us10y", label: "US 10Y Yield", symbol: "^TNX", source: "Yahoo Finance" },
            dxy: { key: "dxy", label: "Dollar Index (DXY Proxy)", symbol: "DX=F", source: "Yahoo Finance" },
            crude: { key: "crude", label: "WTI Crude", symbol: "CL=F", source: "Yahoo Finance" },
            brent: { key: "brent", label: "Brent Crude", symbol: "BZ=F", source: "Yahoo Finance" },
            gold: { key: "gold", label: "Gold", symbol: "GC=F", source: "Yahoo Finance" },
            silver: { key: "silver", label: "Silver", symbol: "SI=F", source: "Yahoo Finance" },
            naturalGas: { key: "naturalGas", label: "Natural Gas", symbol: "NG=F", source: "Yahoo Finance" }
        }
    };

    const INTRADAY_MARKET_SYMBOLS = {
        NIFTY: {
            key: "NIFTY",
            label: "NIFTY 50",
            indexSymbol: "^NSEI",
            vwapProxySymbol: "NIFTYBEES.NS",
            vwapProxyLabel: "NIFTYBEES"
        },
        BANKNIFTY: {
            key: "BANKNIFTY",
            label: "BANK NIFTY",
            indexSymbol: "^NSEBANK",
            vwapProxySymbol: "BANKBEES.NS",
            vwapProxyLabel: "BANKBEES"
        },
        INDIA_VIX: {
            key: "INDIA_VIX",
            label: "INDIA VIX",
            indexSymbol: "^INDIAVIX"
        }
    };

    const NEWS_FEEDS = {
        india: {
            key: "indiaNews",
            label: "India Market News",
            source: "Google News RSS",
            url: "https://news.google.com/rss/search?q=(Indian%20stock%20market%20OR%20Nifty%20OR%20Sensex%20OR%20RBI%20OR%20Bank%20Nifty)%20when:2d&hl=en-IN&gl=IN&ceid=IN:en"
        },
        us: {
            key: "usNews",
            label: "US Market News",
            source: "Google News RSS",
            url: "https://news.google.com/rss/search?q=(Nasdaq%20OR%20S%26P%20500%20OR%20Dow%20Jones%20OR%20Fed%20OR%20Wall%20Street)%20when:2d&hl=en-US&gl=US&ceid=US:en"
        },
        macro: {
            key: "macroNews",
            label: "Global Macro News",
            source: "Google News RSS",
            url: "https://news.google.com/rss/search?q=(inflation%20OR%20treasury%20yields%20OR%20crude%20oil%20OR%20Brent%20OR%20war%20OR%20tariffs%20OR%20geopolitics%20OR%20RBI%20OR%20Fed)%20when:2d&hl=en-US&gl=US&ceid=US:en"
        }
    };

    const SOURCE_LABELS = {
        yahooMarket: "Yahoo Finance Markets",
        yahooMacro: "Yahoo Finance Macro",
        yahooIntraday: "Yahoo Finance Intraday",
        nseIndices: "NSE All Indices",
        nseMarketStatus: "NSE Market Status",
        nseOptionChain: "NSE Option Chain",
        nseBankOptionChain: "NSE BankNifty Option Chain",
        nseFiiDii: "NSE FII/DII",
        nseOiSpurts: "NSE OI Spurts",
        indiaNews: "India News Feed",
        usNews: "US News Feed",
        macroNews: "Global Macro News Feed"
    };

    const SOURCE_LINKS = {
        yahooFinance: "https://finance.yahoo.com/",
        nseIndices: `${NSE_BASE_URL}/api/allIndices`,
        nseMarketStatus: `${NSE_BASE_URL}/api/marketStatus`,
        nseOptionChain: `${NSE_BASE_URL}/option-chain`,
        nseBankOptionChain: `${NSE_BASE_URL}/option-chain`,
        nseFiiDii: `${NSE_BASE_URL}/reports/fii-dii`,
        nseOiSpurts: `${NSE_BASE_URL}/market-data/analysis-and-tools-derivatives-market-snapshot`,
        indiaNews: NEWS_FEEDS.india.url,
        usNews: NEWS_FEEDS.us.url,
        macroNews: NEWS_FEEDS.macro.url
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

    const INDIA_FALLBACKS = {
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

    const POSITIVE_PATTERNS = [
        /rate cut/i,
        /easing/i,
        /inflation cool/i,
        /disinflation/i,
        /beats? estimates/i,
        /record high/i,
        /surge/i,
        /strong earnings/i,
        /stimulus/i,
        /liquidity/i,
        /inflows?/i,
        /ceasefire/i,
        /de-escalat/i,
        /rebound/i,
        /upgrade/i
    ];

    const NEGATIVE_PATTERNS = [
        /hawkish/i,
        /rate hike/i,
        /inflation (?:up|hot|sticky|rises?)/i,
        /yields? (?:rise|jump|surge|spike)/i,
        /crude (?:up|higher|jump|spike|surge)/i,
        /brent (?:up|higher|jump|spike|surge)/i,
        /war/i,
        /attack/i,
        /tariffs?/i,
        /sanctions?/i,
        /slump/i,
        /sell[- ]off/i,
        /miss(?:es|ed)? estimates/i,
        /downgrade/i,
        /outflows?/i,
        /volatility/i,
        /risk[- ]off/i,
        /default/i
    ];

    const HIGH_IMPACT_PATTERNS = [
        /fed/i,
        /fomc/i,
        /rbi/i,
        /cpi/i,
        /ppi/i,
        /inflation/i,
        /treasury/i,
        /yield/i,
        /crude/i,
        /brent/i,
        /war/i,
        /tariff/i,
        /geopolit/i,
        /jobs/i,
        /payroll/i,
        /gdp/i,
        /rate/i
    ];

    let nseSessionWarmedAt = 0;
    let proxyAvailabilityPromise = null;
    let buildInfoPromise = null;

    function toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function round(value, digits = 2) {
        if (!Number.isFinite(value)) {
            return null;
        }
        const scale = 10 ** digits;
        return Math.round(value * scale) / scale;
    }

    function formatValue(value, digits = 2) {
        return Number.isFinite(value) ? value.toFixed(digits) : "Unavailable";
    }

    function positiveNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    }

    function parseMarketDate(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString();
        }

        if (typeof value !== "string") {
            return null;
        }

        const match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) {
            const fallback = new Date(value);
            return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
        }

        const [, dayValue, monthToken, yearValue, hourValue = "00", minuteValue = "00", secondValue = "00"] = match;
        const monthIndex = MONTHS[monthToken];
        if (monthIndex === undefined) {
            return null;
        }

        const date = new Date(Date.UTC(
            Number(yearValue),
            monthIndex,
            Number(dayValue),
            Number(hourValue),
            Number(minuteValue),
            Number(secondValue)
        ));

        return date.toISOString();
    }

    function statusFromTimestamp(timestamp, state = "") {
        if (!timestamp) {
            return "unavailable";
        }

        const ageMinutes = (Date.now() - new Date(timestamp).getTime()) / 60000;
        const normalized = String(state || "").toUpperCase();
        const liveStates = ["REGULAR", "OPEN", "PRE", "POST", "STREAMING"];

        if (liveStates.some((token) => normalized.includes(token)) && ageMinutes <= 30) {
            return "live";
        }

        if (ageMinutes <= 24 * 60) {
            return "delayed";
        }

        return "unavailable";
    }

    function normalizeError(error) {
        if (error?.name === "AbortError") {
            return "Request timed out";
        }
        return error?.message || "Unknown fetch error";
    }

    function createSourceStatus(key, label, status, message, lastUpdated, source, sourceUrl) {
        return {
            key,
            label,
            status,
            message,
            lastUpdated: lastUpdated || null,
            source: source || null,
            sourceUrl: sourceUrl || null
        };
    }

    function createUnavailableInstrument(definition, reason) {
        return {
            key: definition.key,
            label: definition.label,
            symbol: definition.symbol || definition.key,
            source: definition.source,
            sourceUrl: definition.sourceUrl || null,
            price: null,
            change: null,
            changePercent: null,
            previousClose: null,
            open: null,
            high: null,
            low: null,
            updatedAt: null,
            status: "unavailable",
            reason
        };
    }

    function readSnapshot() {
        try {
            const raw = localStorage.getItem(SNAPSHOT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function writeSnapshot(payload) {
        try {
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
        } catch (error) {
            // Ignore storage failures in standalone mode.
        }
    }

    function readStoredProxyOrigin() {
        try {
            return localStorage.getItem(PROXY_ORIGIN_KEY) || "";
        } catch (error) {
            return "";
        }
    }

    function writeStoredProxyOrigin(value) {
        try {
            if (!value) {
                localStorage.removeItem(PROXY_ORIGIN_KEY);
                return;
            }
            localStorage.setItem(PROXY_ORIGIN_KEY, value);
        } catch (error) {
            // Ignore storage failures in standalone mode.
        }
    }

    function stripTrailingSlash(value) {
        return String(value || "").replace(/\/+$/, "");
    }

    function normalizeProxyOrigin(value) {
        const raw = String(value || "").trim();
        if (!raw) {
            return "";
        }

        try {
            const normalized = new URL(raw, window.location.href);
            if (!/^https?:$/i.test(normalized.protocol)) {
                return "";
            }
            return stripTrailingSlash(normalized.toString());
        } catch (error) {
            return "";
        }
    }

    function readQueryProxyOrigin() {
        const params = new URLSearchParams(window.location.search);
        const value = params.get(PROXY_ORIGIN_QUERY_KEY);
        if (value === null) {
            return "";
        }
        if (!value || /^off$/i.test(value)) {
            writeStoredProxyOrigin("");
            return "";
        }

        const normalized = normalizeProxyOrigin(value);
        if (normalized) {
            writeStoredProxyOrigin(normalized);
        }
        return normalized;
    }

    function readMetaProxyOrigin() {
        const tag = document.querySelector('meta[name="market-pulse-proxy-origin"]');
        return normalizeProxyOrigin(tag?.content || "");
    }

    function isKnownStaticHost(hostname) {
        return /(^|\.)github\.io$/i.test(hostname)
            || /(^|\.)netlify\.app$/i.test(hostname)
            || /(^|\.)pages\.dev$/i.test(hostname)
            || /(^|\.)vercel\.app$/i.test(hostname);
    }

    function getConfiguredProxyOrigin() {
        return readQueryProxyOrigin()
            || normalizeProxyOrigin(window.MARKET_PULSE_PROXY_ORIGIN || "")
            || readMetaProxyOrigin()
            || normalizeProxyOrigin(readStoredProxyOrigin());
    }

    function getDefaultProxyOrigin() {
        if (!canAttemptSameOriginProxy()) {
            return "";
        }

        if (isKnownStaticHost(window.location.hostname)) {
            return "";
        }

        return stripTrailingSlash(window.location.origin);
    }

    function getProxyOrigin() {
        return getConfiguredProxyOrigin() || getDefaultProxyOrigin();
    }

    function buildProxyApiUrl(proxyOrigin, path) {
        const origin = stripTrailingSlash(proxyOrigin);
        if (origin.endsWith("/api")) {
            return `${origin}${path.replace(/^\/api/, "")}`;
        }
        return `${origin}${path}`;
    }

    async function fetchWithTimeout(url, options = {}, externalSignal) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);
        let externalAbortHandler = null;

        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            } else {
                externalAbortHandler = () => controller.abort();
                externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
            }
        }

        try {
            return await fetch(url, {
                ...options,
                cache: options.cache || "no-store",
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
            if (externalSignal && externalAbortHandler) {
                externalSignal.removeEventListener("abort", externalAbortHandler);
            }
        }
    }

    function canAttemptSameOriginProxy() {
        return window.location.protocol === "http:" || window.location.protocol === "https:";
    }

    function createFallbackBuildInfo() {
        return {
            baseVersion: "1.0.0",
            buildNumber: 0,
            version: "1.0.0-b0",
            builtAt: null,
            source: "fallback"
        };
    }

    function normalizeBuildInfo(rawBuildInfo = {}) {
        const fallback = createFallbackBuildInfo();
        const buildNumber = Number(rawBuildInfo.buildNumber);

        return {
            baseVersion: rawBuildInfo.baseVersion || fallback.baseVersion,
            buildNumber: Number.isFinite(buildNumber) && buildNumber >= 0 ? Math.floor(buildNumber) : fallback.buildNumber,
            version: rawBuildInfo.version || fallback.version,
            builtAt: rawBuildInfo.builtAt || fallback.builtAt,
            source: rawBuildInfo.source || fallback.source
        };
    }

    async function getBuildInfo(externalSignal) {
        if (!buildInfoPromise) {
            buildInfoPromise = fetchWithTimeout(`${BUILD_INFO_PATH}?ts=${Date.now()}`, {
                timeoutMs: 4000,
                cache: "no-store"
            }, externalSignal)
                .then(async (response) => {
                    if (!response.ok) {
                        return createFallbackBuildInfo();
                    }

                    return normalizeBuildInfo(await response.json());
                })
                .catch(() => createFallbackBuildInfo());
        }

        return buildInfoPromise;
    }

    async function hasSameOriginProxy(externalSignal) {
        const proxyOrigin = getProxyOrigin();
        if (!proxyOrigin) {
            return {
                available: false,
                proxyOrigin: ""
            };
        }

        if (!proxyAvailabilityPromise) {
            const healthUrl = buildProxyApiUrl(proxyOrigin, SAME_ORIGIN_HEALTH_PATH);
            proxyAvailabilityPromise = fetchWithTimeout(healthUrl, {
                timeoutMs: 4000,
                cache: "no-store"
            }, externalSignal)
                .then(async (response) => {
                    if (!response.ok) {
                        return {
                            available: false,
                            proxyOrigin
                        };
                    }

                    try {
                        const payload = await response.json();
                        return {
                            available: Boolean(payload?.ok),
                            proxyOrigin
                        };
                    } catch (error) {
                        return {
                            available: false,
                            proxyOrigin
                        };
                    }
                })
                .catch(() => ({
                    available: false,
                    proxyOrigin
                }));
        }

        return proxyAvailabilityPromise;
    }

    async function resolveRequestUrl(url, externalSignal) {
        const proxyState = await hasSameOriginProxy(externalSignal);
        if (!proxyState.available || !proxyState.proxyOrigin) {
            return url;
        }

        const proxyUrl = new URL(buildProxyApiUrl(proxyState.proxyOrigin, SAME_ORIGIN_PROXY_PATH));
        proxyUrl.searchParams.set("url", url);
        return proxyUrl.toString();
    }

    async function shouldBlockDirectCrossOriginRequest(url, externalSignal) {
        if (document.body?.dataset?.appMode !== "browser-standalone") {
            return false;
        }

        const proxyState = await hasSameOriginProxy(externalSignal);
        if (proxyState.available) {
            return false;
        }

        try {
            const requestUrl = new URL(url, window.location.href);
            return requestUrl.origin !== window.location.origin;
        } catch (error) {
            return false;
        }
    }

    async function fetchJson(url, options = {}, externalSignal) {
        if (await shouldBlockDirectCrossOriginRequest(url, externalSignal)) {
            throw new Error("Static bundle has no proxy backend. Cross-origin live requests are disabled in the browser.");
        }

        const requestUrl = await resolveRequestUrl(url, externalSignal);
        const response = await fetchWithTimeout(requestUrl, options, externalSignal);
        const text = await response.text();

        if (!response.ok) {
            throw new Error(`Request failed (${response.status}) for ${url}`);
        }

        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
        }
    }

    async function fetchText(url, options = {}, externalSignal) {
        if (await shouldBlockDirectCrossOriginRequest(url, externalSignal)) {
            throw new Error("Static bundle has no proxy backend. Cross-origin live requests are disabled in the browser.");
        }

        const requestUrl = await resolveRequestUrl(url, externalSignal);
        const response = await fetchWithTimeout(requestUrl, options, externalSignal);
        const text = await response.text();

        if (!response.ok) {
            throw new Error(`Request failed (${response.status}) for ${url}`);
        }

        return text;
    }

    function buildYahooQuoteUrl(symbol) {
        return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
    }

    async function fetchYahooChart(symbol, interval = "5m", range = "1d", externalSignal) {
        const url = `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=true`;
        return fetchJson(url, {
            headers: {
                accept: "application/json, text/plain, */*",
                referer: "https://finance.yahoo.com/"
            }
        }, externalSignal);
    }

    function buildCandles(rawChart) {
        const result = rawChart?.chart?.result?.[0];
        const quote = result?.indicators?.quote?.[0] || {};
        const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];

        return timestamps
            .map((timestamp, index) => {
                const open = toNumber(quote.open?.[index]);
                const high = toNumber(quote.high?.[index]);
                const low = toNumber(quote.low?.[index]);
                const close = toNumber(quote.close?.[index]);
                const volume = toNumber(quote.volume?.[index]);

                if (![open, high, low, close].every(Number.isFinite)) {
                    return null;
                }

                return {
                    timestamp: new Date(timestamp * 1000).toISOString(),
                    open,
                    high,
                    low,
                    close,
                    volume
                };
            })
            .filter(Boolean);
    }

    function getAverage(values) {
        const usable = values.filter((value) => Number.isFinite(value));
        if (!usable.length) {
            return null;
        }

        return round(usable.reduce((sum, value) => sum + value, 0) / usable.length, 4);
    }

    function summarizeCandleSeries(candles) {
        if (!candles.length) {
            return {
                candles: [],
                last: null,
                open: null,
                high: null,
                low: null,
                changePercent: null,
                openingRange: null,
                averageVolume: null,
                lastVolume: null,
                relativeVolume: null,
                vwap: null
            };
        }

        const first = candles[0];
        const last = candles[candles.length - 1];
        const openingWindow = candles.slice(0, Math.min(3, candles.length));
        const high = Math.max(...candles.map((candle) => candle.high));
        const low = Math.min(...candles.map((candle) => candle.low));
        const volumes = candles
            .map((candle) => candle.volume)
            .filter((value) => Number.isFinite(value) && value > 0);
        const averageVolume = getAverage(volumes);
        const recentVolumes = candles
            .slice(-Math.min(3, candles.length))
            .map((candle) => candle.volume)
            .filter((value) => Number.isFinite(value) && value > 0);
        const recentAverageVolume = getAverage(recentVolumes);

        let weightedValue = 0;
        let weightedVolume = 0;
        candles.forEach((candle) => {
            if (!Number.isFinite(candle.volume) || candle.volume <= 0) {
                return;
            }

            const typicalPrice = (candle.high + candle.low + candle.close) / 3;
            weightedValue += typicalPrice * candle.volume;
            weightedVolume += candle.volume;
        });

        return {
            candles,
            last,
            open: first.open,
            high: round(high, 2),
            low: round(low, 2),
            changePercent: first.close
                ? round(((last.close - first.close) / first.close) * 100, 2)
                : null,
            openingRange: openingWindow.length ? {
                high: round(Math.max(...openingWindow.map((candle) => candle.high)), 2),
                low: round(Math.min(...openingWindow.map((candle) => candle.low)), 2),
                close: round(openingWindow[openingWindow.length - 1].close, 2),
                completed: openingWindow.length >= 3
            } : null,
            averageVolume,
            lastVolume: recentVolumes.length ? recentVolumes[recentVolumes.length - 1] : null,
            relativeVolume: averageVolume && recentAverageVolume
                ? round(recentAverageVolume / averageVolume, 2)
                : null,
            vwap: weightedVolume > 0 ? round(weightedValue / weightedVolume, 2) : null
        };
    }

    function buildInstrumentContext(definition, rawIndexChart, rawProxyChart = null) {
        const indexResult = rawIndexChart?.chart?.result?.[0];
        const indexMeta = indexResult?.meta || {};
        const indexCandles = summarizeCandleSeries(buildCandles(rawIndexChart));
        const proxyCandles = rawProxyChart ? summarizeCandleSeries(buildCandles(rawProxyChart)) : null;
        const currentPrice = toNumber(indexMeta.regularMarketPrice) || indexCandles.last?.close || null;
        const previousClose = toNumber(indexMeta.previousClose) || toNumber(indexMeta.chartPreviousClose) || null;
        const updatedAt = Number.isFinite(indexMeta.regularMarketTime)
            ? new Date(indexMeta.regularMarketTime * 1000).toISOString()
            : indexCandles.last?.timestamp || null;
        const vwap = proxyCandles?.vwap ?? null;
        const proxyCurrentPrice = proxyCandles?.last?.close ?? null;
        const vwapDistancePercent = Number.isFinite(vwap) && Number.isFinite(proxyCurrentPrice) && vwap
            ? round(((proxyCurrentPrice - vwap) / vwap) * 100, 2)
            : null;

        return {
            key: definition.key,
            label: definition.label,
            symbol: definition.indexSymbol,
            source: "Yahoo Finance",
            sourceUrl: buildYahooQuoteUrl(definition.indexSymbol),
            price: currentPrice,
            previousClose,
            open: toNumber(indexMeta.regularMarketOpen) || indexCandles.open || null,
            high: toNumber(indexMeta.regularMarketDayHigh) || indexCandles.high || null,
            low: toNumber(indexMeta.regularMarketDayLow) || indexCandles.low || null,
            updatedAt,
            marketState: indexMeta.marketState || "",
            status: statusFromTimestamp(updatedAt, indexMeta.marketState),
            series: indexCandles.candles,
            openingRange: indexCandles.openingRange,
            sessionChangePercent: indexCandles.changePercent,
            proxy: definition.vwapProxySymbol ? {
                label: definition.vwapProxyLabel,
                symbol: definition.vwapProxySymbol,
                sourceUrl: buildYahooQuoteUrl(definition.vwapProxySymbol),
                price: proxyCurrentPrice,
                vwap,
                vwapDistancePercent,
                relativeVolume: proxyCandles?.relativeVolume ?? null,
                averageVolume: proxyCandles?.averageVolume ?? null,
                updatedAt: proxyCandles?.last?.timestamp || null
            } : null
        };
    }

    async function loadIntradayData(externalSignal) {
        const chartRequests = [
            { key: "NIFTY", symbol: INTRADAY_MARKET_SYMBOLS.NIFTY.indexSymbol },
            { key: "NIFTY_PROXY", symbol: INTRADAY_MARKET_SYMBOLS.NIFTY.vwapProxySymbol },
            { key: "BANKNIFTY", symbol: INTRADAY_MARKET_SYMBOLS.BANKNIFTY.indexSymbol },
            { key: "BANKNIFTY_PROXY", symbol: INTRADAY_MARKET_SYMBOLS.BANKNIFTY.vwapProxySymbol },
            { key: "INDIA_VIX", symbol: INTRADAY_MARKET_SYMBOLS.INDIA_VIX.indexSymbol }
        ];

        const responses = await Promise.allSettled(chartRequests.map(async (request) => {
            const data = await fetchYahooChart(request.symbol, "5m", "1d", externalSignal);
            return [request.key, data];
        }));

        const charts = new Map();
        responses.forEach((response) => {
            if (response.status === "fulfilled") {
                charts.set(response.value[0], response.value[1]);
            }
        });

        const contexts = {
            NIFTY: charts.has("NIFTY")
                ? buildInstrumentContext(INTRADAY_MARKET_SYMBOLS.NIFTY, charts.get("NIFTY"), charts.get("NIFTY_PROXY") || null)
                : null,
            BANKNIFTY: charts.has("BANKNIFTY")
                ? buildInstrumentContext(INTRADAY_MARKET_SYMBOLS.BANKNIFTY, charts.get("BANKNIFTY"), charts.get("BANKNIFTY_PROXY") || null)
                : null,
            INDIA_VIX: charts.has("INDIA_VIX")
                ? buildInstrumentContext(INTRADAY_MARKET_SYMBOLS.INDIA_VIX, charts.get("INDIA_VIX"))
                : null
        };

        const liveContexts = Object.values(contexts).filter((context) => context?.price);
        const lastUpdated = liveContexts.map((context) => context.updatedAt).find(Boolean) || null;

        return {
            instruments: contexts,
            sourceStatuses: [
                createSourceStatus(
                    "yahooIntraday",
                    SOURCE_LABELS.yahooIntraday,
                    liveContexts.length >= 2 ? "live" : (liveContexts.length ? "delayed" : "error"),
                    liveContexts.length
                        ? `Fetched ${liveContexts.length}/3 intraday market contexts from Yahoo Finance.`
                        : "Intraday chart feeds are currently unavailable.",
                    lastUpdated,
                    "Yahoo Finance",
                    SOURCE_LINKS.yahooFinance
                )
            ]
        };
    }

    function mapYahooQuote(definition, rawChart) {
        const meta = rawChart?.chart?.result?.[0]?.meta;
        const quoteSeries = rawChart?.chart?.result?.[0]?.indicators?.quote?.[0];
        const closes = Array.isArray(quoteSeries?.close)
            ? quoteSeries.close.filter((value) => Number.isFinite(value))
            : [];

        if (!meta) {
            return createUnavailableInstrument({
                ...definition,
                sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(definition.symbol)}`
            }, "Yahoo Finance did not return this symbol.");
        }

        const lastPrice = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes.at(-1);
        const previousClose = Number.isFinite(meta.previousClose)
            ? meta.previousClose
            : (Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : closes.at(-2));
        const timestamp = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
        const change = Number.isFinite(lastPrice) && Number.isFinite(previousClose) ? lastPrice - previousClose : null;
        const changePercent = Number.isFinite(change) && Number.isFinite(previousClose) && previousClose !== 0
            ? (change / previousClose) * 100
            : null;

        return {
            key: definition.key,
            label: definition.label,
            symbol: definition.symbol,
            source: definition.source,
            sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(definition.symbol)}`,
            price: round(Number(lastPrice), 2),
            change: round(Number(change), 2),
            changePercent: round(Number(changePercent), 2),
            previousClose: round(Number(previousClose), 2),
            open: round(Number(meta.regularMarketOpen), 2),
            high: round(Number(meta.regularMarketDayHigh), 2),
            low: round(Number(meta.regularMarketDayLow), 2),
            updatedAt: timestamp,
            marketState: meta.marketState || "",
            status: statusFromTimestamp(timestamp, meta.marketState),
            reason: null
        };
    }

    async function fetchYahooCollection(collectionName, externalSignal) {
        const definitions = Object.values(INSTRUMENTS[collectionName] || {});
        const quotes = {};

        const responses = await Promise.allSettled(definitions.map(async (definition) => {
            const url = `${YAHOO_BASE_URL}/${encodeURIComponent(definition.symbol)}?interval=1d&range=5d&includePrePost=true`;
            const data = await fetchJson(url, {
                headers: {
                    accept: "application/json, text/plain, */*"
                }
            }, externalSignal);
            return [definition.key, data];
        }));

        const resultMap = new Map();
        responses.forEach((response) => {
            if (response.status === "fulfilled") {
                resultMap.set(response.value[0], response.value[1]);
            }
        });

        definitions.forEach((definition) => {
            quotes[definition.key] = resultMap.has(definition.key)
                ? mapYahooQuote(definition, resultMap.get(definition.key))
                : createUnavailableInstrument({
                    ...definition,
                    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(definition.symbol)}`
                }, "Yahoo Finance did not return a usable chart payload.");
        });

        const lastUpdated = definitions.map((definition) => quotes[definition.key]?.updatedAt).find(Boolean) || null;

        return {
            quotes,
            sourceStatus: createSourceStatus(
                collectionName,
                SOURCE_LABELS[collectionName],
                lastUpdated ? "live" : "unavailable",
                lastUpdated ? "Yahoo chart data fetched successfully." : "No Yahoo Finance quotes were returned.",
                lastUpdated,
                "Yahoo Finance",
                SOURCE_LINKS.yahooFinance
            )
        };
    }

    async function warmNseSession(externalSignal) {
        if (!USE_NSE_CREDENTIALS) {
            return;
        }

        if ((Date.now() - nseSessionWarmedAt) < (15 * 60 * 1000)) {
            return;
        }

        const warmups = await Promise.allSettled([
            fetchText(`${NSE_BASE_URL}/`, {
                credentials: "include",
                headers: {
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            }, externalSignal),
            fetchText(`${NSE_BASE_URL}/option-chain`, {
                credentials: "include",
                headers: {
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            }, externalSignal)
        ]);

        if (warmups.some((item) => item.status === "fulfilled")) {
            nseSessionWarmedAt = Date.now();
        }
    }

    async function fetchNseJson(url, options = {}, externalSignal) {
        const proxyState = await hasSameOriginProxy(externalSignal);
        if (proxyState.available) {
            const data = await fetchJson(url, {
                timeoutMs: options.timeoutMs || 30000,
                headers: {
                    accept: "application/json, text/plain, */*"
                }
            }, externalSignal);

            if (data && (Array.isArray(data) || Object.keys(data).length > 0 || options.allowEmpty)) {
                return data;
            }

            throw new Error("NSE returned an empty payload.");
        }

        if (USE_NSE_CREDENTIALS) {
            await warmNseSession(externalSignal);
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const data = await fetchJson(url, {
                    timeoutMs: options.timeoutMs || 30000,
                    credentials: USE_NSE_CREDENTIALS ? "include" : "omit",
                    headers: {
                        accept: "application/json, text/plain, */*"
                    }
                }, externalSignal);

                if (data && (Array.isArray(data) || Object.keys(data).length > 0 || options.allowEmpty)) {
                    return data;
                }

                throw new Error("NSE returned an empty payload.");
            } catch (error) {
                const message = normalizeError(error);
                const shouldRetry = attempt === 0 && /403|401|empty payload|Unexpected token/i.test(message);
                if (!shouldRetry) {
                    throw error;
                }
                if (USE_NSE_CREDENTIALS) {
                    nseSessionWarmedAt = 0;
                    await warmNseSession(externalSignal);
                }
            }
        }

        throw new Error("Unable to establish a usable NSE browser session.");
    }

    function mapIndexInstrument(rawIndex, key, label, fetchedAt, marketState) {
        const updatedAt = fetchedAt || parseMarketDate(rawIndex.previousDay);
        return {
            key,
            label,
            symbol: rawIndex.indexSymbol || rawIndex.index,
            source: "NSE India",
            sourceUrl: SOURCE_LINKS.nseIndices,
            price: toNumber(rawIndex.last),
            change: toNumber(rawIndex.variation),
            changePercent: toNumber(rawIndex.percentChange),
            previousClose: toNumber(rawIndex.previousClose),
            open: toNumber(rawIndex.open),
            high: toNumber(rawIndex.high),
            low: toNumber(rawIndex.low),
            updatedAt,
            status: statusFromTimestamp(updatedAt, marketState || "OPEN"),
            advances: toNumber(rawIndex.advances),
            declines: toNumber(rawIndex.declines),
            unchanged: toNumber(rawIndex.unchanged),
            reason: null
        };
    }

    function mapOptionLeg(leg, optionType) {
        if (!leg) {
            return null;
        }

        return {
            optionType,
            identifier: leg.identifier || null,
            strikePrice: toNumber(leg.strikePrice),
            underlying: leg.underlying || null,
            openInterest: toNumber(leg.openInterest),
            changeInOpenInterest: toNumber(leg.changeinOpenInterest),
            changeInOpenInterestPercent: toNumber(leg.pchangeinOpenInterest),
            totalTradedVolume: toNumber(leg.totalTradedVolume),
            impliedVolatility: toNumber(leg.impliedVolatility),
            lastPrice: toNumber(leg.lastPrice),
            change: toNumber(leg.change),
            changePercent: toNumber(leg.pchange),
            totalBuyQuantity: toNumber(leg.totalBuyQuantity),
            totalSellQuantity: toNumber(leg.totalSellQuantity),
            buyPrice1: toNumber(leg.buyPrice1),
            buyQuantity1: toNumber(leg.buyQuantity1),
            sellPrice1: toNumber(leg.sellPrice1),
            sellQuantity1: toNumber(leg.sellQuantity1),
            underlyingValue: toNumber(leg.underlyingValue)
        };
    }

    function deriveStrikeStep(contractInfo, rows) {
        const source = (contractInfo?.strikePrice || rows.map((row) => row.strikePrice))
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
            .sort((left, right) => left - right);

        if (source.length < 2) {
            return null;
        }

        let step = null;
        for (let index = 1; index < source.length; index += 1) {
            const difference = source[index] - source[index - 1];
            if (difference > 0 && (!step || difference < step)) {
                step = difference;
            }
        }

        return step;
    }

    function buildOptionChainData(symbol, contractInfo, optionChains) {
        const rawChains = Array.isArray(optionChains) ? optionChains : [optionChains];
        const primaryChain = rawChains[0] || null;
        const rows = primaryChain?.records?.data || [];
        const allRows = rawChains.flatMap((chain) => chain?.records?.data || []);
        const underlyingValue = toNumber(primaryChain?.records?.underlyingValue);

        let callOpenInterest = 0;
        let putOpenInterest = 0;
        let bestCall = null;
        let bestPut = null;

        rows.forEach((row) => {
            if (row.CE) {
                callOpenInterest += Number(row.CE.openInterest || 0);
                if (!bestCall || Number(row.CE.openInterest || 0) > Number(bestCall.openInterest || 0)) {
                    bestCall = row.CE;
                }
            }

            if (row.PE) {
                putOpenInterest += Number(row.PE.openInterest || 0);
                if (!bestPut || Number(row.PE.openInterest || 0) > Number(bestPut.openInterest || 0)) {
                    bestPut = row.PE;
                }
            }
        });

        const pcr = callOpenInterest ? round(putOpenInterest / callOpenInterest, 2) : null;
        const contracts = allRows
            .map((row) => ({
                expiryDate: row.expiryDates || row.expiryDate || null,
                strikePrice: toNumber(row.strikePrice),
                CE: mapOptionLeg(row.CE, "CE"),
                PE: mapOptionLeg(row.PE, "PE")
            }))
            .filter((row) => Number.isFinite(row.strikePrice));
        const expiries = (contractInfo?.expiryDates || []).filter((value) => typeof value === "string" && value.trim());
        const lotSize = toNumber(
            contractInfo?.lotSize
            || contractInfo?.marketLot
            || contractInfo?.marketLotSize
            || contractInfo?.contractSize
            || primaryChain?.records?.lotSize
        );

        return {
            symbol,
            sourceUrl: SOURCE_LINKS.nseOptionChain,
            timestamp: parseMarketDate(primaryChain?.records?.timestamp),
            underlyingValue,
            putCallRatio: pcr,
            totalPutOpenInterest: putOpenInterest,
            totalCallOpenInterest: callOpenInterest,
            expiries,
            stepSize: deriveStrikeStep(contractInfo, contracts),
            lotSize,
            contracts,
            support: bestPut ? {
                strike: Number(bestPut.strikePrice),
                openInterest: Number(bestPut.openInterest)
            } : null,
            resistance: bestCall ? {
                strike: Number(bestCall.strikePrice),
                openInterest: Number(bestCall.openInterest)
            } : null
        };
    }

    async function fetchOptionChain(symbol, options = {}, externalSignal) {
        const contractInfo = await fetchNseJson(`${NSE_BASE_URL}/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`, {
            timeoutMs: 30000
        }, externalSignal);
        const expiryCount = Number.isFinite(Number(options.expiryCount)) ? Number(options.expiryCount) : 1;
        const expiryDates = (contractInfo.expiryDates || []).slice(0, Math.max(1, expiryCount));

        if (!expiryDates.length) {
            throw new Error(`No expiry dates returned for ${symbol}.`);
        }

        const optionChains = await Promise.all(expiryDates.map((expiry) => fetchNseJson(
            `${NSE_BASE_URL}/api/option-chain-v3?type=Indices&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`,
            { timeoutMs: 30000 },
            externalSignal
        )));

        return buildOptionChainData(symbol, contractInfo, optionChains);
    }

    async function fetchNseSnapshot(options = {}, externalSignal) {
        const snapshotFetchedAt = new Date().toISOString();
        const preferredInstrument = String(options.preferredInstrument || "NIFTY").toUpperCase();
        const expiryPreference = String(options.expiryPreference || "current").toLowerCase();
        const needsBankTradePlan = preferredInstrument === "BANKNIFTY";
        const preferredExpiryCount = expiryPreference === "next" ? 2 : 1;

        const coreTasks = await Promise.allSettled([
            fetchNseJson(`${NSE_BASE_URL}/api/allIndices`, {}, externalSignal),
            fetchNseJson(`${NSE_BASE_URL}/api/marketStatus`, {}, externalSignal)
        ]);
        const optionTasks = await Promise.allSettled([
            fetchOptionChain("NIFTY", { expiryCount: needsBankTradePlan ? 1 : preferredExpiryCount }, externalSignal),
            needsBankTradePlan ? fetchOptionChain("BANKNIFTY", { expiryCount: preferredExpiryCount }, externalSignal) : Promise.resolve(null)
        ]);
        const flowTasks = await Promise.allSettled([
            fetchNseJson(`${NSE_BASE_URL}/api/fiidiiTradeReact`, {}, externalSignal),
            fetchNseJson(`${NSE_BASE_URL}/api/fiidiiTradeNse`, {}, externalSignal),
            fetchNseJson(`${NSE_BASE_URL}/api/live-analysis-oi-spurts-underlyings`, { allowEmpty: true }, externalSignal)
        ]);

        const [allIndicesResult, marketStatusResult] = coreTasks;
        const [optionChainResult, bankOptionChainResult] = optionTasks;
        const [fiiCombinedResult, fiiNseResult, oiSpurtsResult] = flowTasks;

        const indexData = allIndicesResult.status === "fulfilled" ? allIndicesResult.value?.data || [] : [];
        const marketStatus = marketStatusResult.status === "fulfilled" ? marketStatusResult.value : null;
        const niftyRaw = indexData.find((item) => item.index === "NIFTY 50");
        const bankNiftyRaw = indexData.find((item) => item.index === "NIFTY BANK");
        const vixRaw = indexData.find((item) => item.index === "INDIA VIX");
        const capitalMarketState = marketStatus?.marketState?.find((item) => item.market === "Capital Market");
        const giftNiftyRaw = marketStatus?.giftnifty || null;
        const giftTimestamp = parseMarketDate(giftNiftyRaw?.TIMESTMP);
        const sourceStatuses = [];

        sourceStatuses.push(
            allIndicesResult.status === "fulfilled"
                ? createSourceStatus("nseIndices", SOURCE_LABELS.nseIndices, "live", "NSE index snapshot loaded.", snapshotFetchedAt, "NSE India", SOURCE_LINKS.nseIndices)
                : createSourceStatus("nseIndices", SOURCE_LABELS.nseIndices, "error", normalizeError(allIndicesResult.reason), null, "NSE India", SOURCE_LINKS.nseIndices)
        );

        sourceStatuses.push(
            marketStatusResult.status === "fulfilled"
                ? createSourceStatus(
                    "nseMarketStatus",
                    SOURCE_LABELS.nseMarketStatus,
                    statusFromTimestamp(giftTimestamp || parseMarketDate(capitalMarketState?.tradeDate), capitalMarketState?.marketStatus),
                    capitalMarketState?.marketStatusMessage || "NSE market status loaded.",
                    giftTimestamp || parseMarketDate(capitalMarketState?.tradeDate),
                    "NSE India",
                    SOURCE_LINKS.nseMarketStatus
                )
                : createSourceStatus("nseMarketStatus", SOURCE_LABELS.nseMarketStatus, "error", normalizeError(marketStatusResult.reason), null, "NSE India", SOURCE_LINKS.nseMarketStatus)
        );

        sourceStatuses.push(
            optionChainResult.status === "fulfilled"
                ? createSourceStatus(
                    "nseOptionChain",
                    SOURCE_LABELS.nseOptionChain,
                    statusFromTimestamp(optionChainResult.value.timestamp, "CLOSED"),
                    "NSE option chain loaded for the nearest NIFTY expiries.",
                    optionChainResult.value.timestamp,
                    "NSE India",
                    SOURCE_LINKS.nseOptionChain
                )
                : createSourceStatus("nseOptionChain", SOURCE_LABELS.nseOptionChain, "error", normalizeError(optionChainResult.reason), null, "NSE India", SOURCE_LINKS.nseOptionChain)
        );

        if (needsBankTradePlan) {
            sourceStatuses.push(
                bankOptionChainResult.status === "fulfilled"
                    ? createSourceStatus(
                        "nseBankOptionChain",
                        SOURCE_LABELS.nseBankOptionChain,
                        statusFromTimestamp(bankOptionChainResult.value.timestamp, "CLOSED"),
                        "NSE option chain loaded for the nearest BANKNIFTY expiries.",
                        bankOptionChainResult.value.timestamp,
                        "NSE India",
                        SOURCE_LINKS.nseBankOptionChain
                    )
                    : createSourceStatus("nseBankOptionChain", SOURCE_LABELS.nseBankOptionChain, "error", normalizeError(bankOptionChainResult.reason), null, "NSE India", SOURCE_LINKS.nseBankOptionChain)
            );
        }

        sourceStatuses.push(
            (fiiCombinedResult.status === "fulfilled" || fiiNseResult.status === "fulfilled")
                ? createSourceStatus(
                    "nseFiiDii",
                    SOURCE_LABELS.nseFiiDii,
                    "delayed",
                    "NSE FII/DII activity loaded.",
                    parseMarketDate((fiiCombinedResult.value?.[0] || fiiNseResult.value?.[0])?.date),
                    "NSE India",
                    SOURCE_LINKS.nseFiiDii
                )
                : createSourceStatus("nseFiiDii", SOURCE_LABELS.nseFiiDii, "error", normalizeError(fiiCombinedResult.reason || fiiNseResult.reason), null, "NSE India", SOURCE_LINKS.nseFiiDii)
        );

        sourceStatuses.push(
            oiSpurtsResult.status === "fulfilled"
                ? createSourceStatus(
                    "nseOiSpurts",
                    SOURCE_LABELS.nseOiSpurts,
                    "delayed",
                    "NSE OI spurt data loaded.",
                    parseMarketDate(oiSpurtsResult.value?.timestamp),
                    "NSE India",
                    SOURCE_LINKS.nseOiSpurts
                )
                : createSourceStatus("nseOiSpurts", SOURCE_LABELS.nseOiSpurts, "error", normalizeError(oiSpurtsResult.reason), null, "NSE India", SOURCE_LINKS.nseOiSpurts)
        );

        return {
            indian: {
                nifty: niftyRaw ? mapIndexInstrument(niftyRaw, "nifty", "NIFTY 50", snapshotFetchedAt, capitalMarketState?.marketStatus) : null,
                bankNifty: bankNiftyRaw ? mapIndexInstrument(bankNiftyRaw, "bankNifty", "BANK NIFTY", snapshotFetchedAt, capitalMarketState?.marketStatus) : null,
                indiaVix: vixRaw ? mapIndexInstrument(vixRaw, "indiaVix", "INDIA VIX", snapshotFetchedAt, capitalMarketState?.marketStatus) : null,
                giftNifty: giftNiftyRaw ? {
                    key: "giftNifty",
                    label: "GIFT NIFTY",
                    symbol: giftNiftyRaw.SYMBOL,
                    source: "NSE India",
                    sourceUrl: SOURCE_LINKS.nseMarketStatus,
                    price: toNumber(giftNiftyRaw.LASTPRICE),
                    change: toNumber(giftNiftyRaw.DAYCHANGE),
                    changePercent: toNumber(giftNiftyRaw.PERCHANGE),
                    previousClose: null,
                    open: null,
                    high: null,
                    low: null,
                    updatedAt: giftTimestamp,
                    status: statusFromTimestamp(giftTimestamp, "OPEN"),
                    expiryDate: giftNiftyRaw.EXPIRYDATE,
                    reason: null
                } : null
            },
            breadth: niftyRaw ? {
                advances: toNumber(niftyRaw.advances),
                declines: toNumber(niftyRaw.declines),
                unchanged: toNumber(niftyRaw.unchanged),
                advDeclineRatio: niftyRaw.declines ? round(Number(niftyRaw.advances) / Number(niftyRaw.declines), 2) : null
            } : null,
            optionChain: optionChainResult.status === "fulfilled" ? optionChainResult.value : null,
            optionChains: {
                NIFTY: optionChainResult.status === "fulfilled" ? optionChainResult.value : null,
                BANKNIFTY: needsBankTradePlan && bankOptionChainResult.status === "fulfilled" ? bankOptionChainResult.value : null
            },
            fiiDii: {
                combined: fiiCombinedResult.status === "fulfilled" ? fiiCombinedResult.value : [],
                nseOnly: fiiNseResult.status === "fulfilled" ? fiiNseResult.value : []
            },
            oiSpurts: oiSpurtsResult.status === "fulfilled" ? oiSpurtsResult.value : null,
            marketStatus,
            sourceStatuses
        };
    }

    function cleanTitle(rawTitle) {
        return String(rawTitle || "").replace(/\s+/g, " ").trim();
    }

    function splitGoogleNewsTitle(rawTitle) {
        const title = cleanTitle(rawTitle);
        const parts = title.split(" - ");
        if (parts.length < 2) {
            return {
                title,
                source: "Unknown"
            };
        }

        return {
            title: parts.slice(0, -1).join(" - "),
            source: parts[parts.length - 1]
        };
    }

    function parseFeedItems(xmlText, category) {
        const documentNode = new DOMParser().parseFromString(xmlText, "application/xml");
        const items = Array.from(documentNode.querySelectorAll("item"));
        const seen = new Set();

        return items.map((item) => {
            const titleText = item.querySelector("title")?.textContent || "";
            const link = item.querySelector("link")?.textContent || "";
            const guid = item.querySelector("guid")?.textContent || link;
            const pubDate = item.querySelector("pubDate")?.textContent || "";
            const split = splitGoogleNewsTitle(titleText);
            const dedupeKey = `${split.title}::${pubDate}`;

            if (seen.has(dedupeKey)) {
                return null;
            }
            seen.add(dedupeKey);

            return {
                id: guid || dedupeKey,
                title: split.title,
                source: split.source,
                link,
                publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
                category
            };
        }).filter(Boolean).slice(0, 8);
    }

    async function fetchSingleFeed(feedDefinition, category, externalSignal) {
        try {
            const xmlText = await fetchText(feedDefinition.url, {
                headers: {
                    accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
                }
            }, externalSignal);
            const items = parseFeedItems(xmlText, category);
            const lastUpdated = items[0]?.publishedAt || null;

            return {
                items,
                status: createSourceStatus(
                    feedDefinition.key,
                    SOURCE_LABELS[feedDefinition.key],
                    items.length ? "live" : "unavailable",
                    items.length ? "News feed fetched successfully." : "News feed returned no items.",
                    lastUpdated,
                    feedDefinition.source,
                    SOURCE_LINKS[feedDefinition.key]
                )
            };
        } catch (error) {
            return {
                items: [],
                status: createSourceStatus(
                    feedDefinition.key,
                    SOURCE_LABELS[feedDefinition.key],
                    "error",
                    normalizeError(error),
                    null,
                    feedDefinition.source,
                    SOURCE_LINKS[feedDefinition.key]
                )
            };
        }
    }

    async function fetchNewsData(externalSignal) {
        const [india, us, macro] = await Promise.all([
            fetchSingleFeed(NEWS_FEEDS.india, "india", externalSignal),
            fetchSingleFeed(NEWS_FEEDS.us, "us", externalSignal),
            fetchSingleFeed(NEWS_FEEDS.macro, "macro", externalSignal)
        ]);

        return {
            buckets: {
                india: india.items,
                us: us.items,
                macro: macro.items
            },
            sourceStatuses: [india.status, us.status, macro.status]
        };
    }

    function inferEffect(sentiment, title, category) {
        if (/rbi|nifty|sensex|bank nifty/i.test(title) || category === "india") {
            if (sentiment === "Bullish") {
                return "Supportive for Indian equities, banks, and opening sentiment.";
            }
            if (sentiment === "Bearish") {
                return "Adds pressure to Indian index sentiment and options risk appetite.";
            }
            return "Mixed India-specific read with limited directional conviction.";
        }

        if (/fed|nasdaq|s&p|dow|wall street/i.test(title) || category === "us") {
            if (sentiment === "Bullish") {
                return "Constructive for overnight global cues and risk appetite.";
            }
            if (sentiment === "Bearish") {
                return "Could weigh on overnight futures and India opening bias.";
            }
            return "US cue looks mixed and may not give a clean directional handoff.";
        }

        if (sentiment === "Bullish") {
            return "Macro backdrop tilts risk-on for equities.";
        }
        if (sentiment === "Bearish") {
            return "Macro backdrop leans risk-off for equities and high beta names.";
        }
        return "Macro headlines are mixed with no dominant directional impulse.";
    }

    function scoreHeadline(item, category) {
        const title = item.title || "";
        let rawScore = 0;

        POSITIVE_PATTERNS.forEach((pattern) => {
            if (pattern.test(title)) {
                rawScore += 1;
            }
        });

        NEGATIVE_PATTERNS.forEach((pattern) => {
            if (pattern.test(title)) {
                rawScore -= 1;
            }
        });

        const impactHits = HIGH_IMPACT_PATTERNS.filter((pattern) => pattern.test(title)).length;
        const impact = impactHits >= 2 || Math.abs(rawScore) >= 2
            ? "High impact / risk event"
            : impactHits === 1 || rawScore !== 0
                ? "Medium impact"
                : "Low impact";

        const sentiment = rawScore >= 1 ? "Bullish" : rawScore <= -1 ? "Bearish" : "Neutral";
        const publishedTime = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
        const ageHours = publishedTime ? Math.max(0, (Date.now() - publishedTime) / 3600000) : 24;
        const recencyMultiplier = clamp(1.3 - (ageHours * 0.05), 0.5, 1.25);
        const impactMultiplier = impact === "High impact / risk event" ? 1.8 : impact === "Medium impact" ? 1.2 : 0.7;
        const weightedScore = round(clamp(rawScore * recencyMultiplier * impactMultiplier * 8, -22, 22), 2);

        return {
            ...item,
            category,
            sentiment,
            impact,
            likelyMarketEffect: inferEffect(sentiment, title, category),
            score: weightedScore
        };
    }

    function aggregateNewsCategory(items) {
        const scoredItems = items.map((item) => scoreHeadline(item, item.category));
        const totalScore = round(scoredItems.reduce((sum, item) => sum + (item.score || 0), 0), 2);
        const averageScore = round(scoredItems.length ? totalScore / scoredItems.length : 0, 2);

        return {
            items: scoredItems,
            totalScore,
            averageScore,
            bullishCount: scoredItems.filter((item) => item.sentiment === "Bullish").length,
            bearishCount: scoredItems.filter((item) => item.sentiment === "Bearish").length,
            highImpactCount: scoredItems.filter((item) => item.impact === "High impact / risk event").length
        };
    }

    function summarizeNewsEffect(categoryResults) {
        const combinedItems = Object.values(categoryResults).flatMap((bucket) => bucket.items);
        const total = combinedItems.reduce((sum, item) => sum + (item.score || 0), 0);
        const normalized = round(clamp(total, -100, 100), 2);
        const stance = normalized >= 18 ? "Bullish" : normalized <= -18 ? "Bearish" : "Neutral";

        const topPositive = combinedItems
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 2)
            .map((item) => item.title);

        const topNegative = combinedItems
            .filter((item) => item.score < 0)
            .sort((left, right) => left.score - right.score)
            .slice(0, 2)
            .map((item) => item.title);

        let summary = "Headlines are mixed and do not yet establish a dominant market narrative.";
        if (stance === "Bullish") {
            summary = topPositive.length
                ? `Supportive headlines are dominating, led by: ${topPositive.join(" | ")}`
                : "Headline flow is modestly supportive for risk appetite.";
        } else if (stance === "Bearish") {
            summary = topNegative.length
                ? `Risk-off headlines are dominating, led by: ${topNegative.join(" | ")}`
                : "Headline flow is leaning defensive and could cap upside risk appetite.";
        }

        return {
            score: normalized,
            stance,
            summary,
            highImpactCount: combinedItems.filter((item) => item.impact === "High impact / risk event").length
        };
    }

    function processNewsSentiment(newsBuckets) {
        const categoryResults = {
            india: aggregateNewsCategory(newsBuckets.india || []),
            us: aggregateNewsCategory(newsBuckets.us || []),
            macro: aggregateNewsCategory(newsBuckets.macro || [])
        };

        return {
            categories: categoryResults,
            aggregate: summarizeNewsEffect(categoryResults)
        };
    }

    function scoreAgainstBands(value, bands) {
        if (!Number.isFinite(value)) {
            return {
                score: 0,
                interpretation: "Signal unavailable.",
                effect: "Neutral"
            };
        }

        for (const band of bands) {
            if (band.test(value)) {
                return band.output;
            }
        }

        return {
            score: 0,
            interpretation: "Signal unavailable.",
            effect: "Neutral"
        };
    }

    function buildComponent(parameter, valueText, output) {
        return {
            parameter,
            currentValue: valueText,
            interpretation: output.interpretation,
            score: output.score,
            effect: output.effect
        };
    }

    function scaleOutput(output, multiplier = 1) {
        if (!Number.isFinite(multiplier) || multiplier === 1) {
            return output;
        }

        return {
            ...output,
            score: Math.round(output.score * multiplier)
        };
    }

    function getSessionScoringProfile(sessionMode) {
        const normalized = String(sessionMode || "LIVE").toUpperCase();
        const isOvernightLens = normalized === "PREOPEN" || normalized === "POSTCLOSE" || normalized === "CLOSED";

        return {
            isOvernightLens,
            decisionWindow: isOvernightLens ? "for the next open" : "right now",
            multipliers: isOvernightLens
                ? {
                    giftNifty: 1.35,
                    niftyPriceAction: 0.2,
                    indiaVix: 1,
                    bankStrength: 0.35,
                    breadth: 0.35,
                    pcr: 0.65,
                    fiiDii: 0.8,
                    globalCues: 1.15,
                    dxy: 1,
                    us10y: 1,
                    crude: 1,
                    news: 1.1
                }
                : {
                    giftNifty: 1,
                    niftyPriceAction: 1,
                    indiaVix: 1,
                    bankStrength: 1,
                    breadth: 1,
                    pcr: 1,
                    fiiDii: 1,
                    globalCues: 1,
                    dxy: 1,
                    us10y: 1,
                    crude: 1,
                    news: 1
                }
        };
    }

    function classifySignal(score) {
        if (score >= 55) {
            return "Strong Bullish";
        }
        if (score >= 20) {
            return "Bullish";
        }
        if (score <= -55) {
            return "Strong Bearish";
        }
        if (score <= -20) {
            return "Bearish";
        }
        return "Sideways";
    }

    function buildQuickNotation(marketSignal, cePeBias, confidence) {
        const direction = marketSignal.includes("Bullish")
            ? "UP"
            : marketSignal.includes("Bearish")
                ? "DOWN"
                : "WAIT";
        const options = cePeBias === "CE bias"
            ? "CALLS"
            : cePeBias === "PE bias"
                ? "PUTS"
                : "WAIT";
        const conviction = confidence >= 75 ? "HIGH" : confidence >= 55 ? "MED" : "LOW";

        return {
            direction,
            options,
            conviction
        };
    }

    function calculateSignalScore(context) {
        const nifty = context.india.nifty;
        const bankNifty = context.india.bankNifty;
        const giftNifty = context.india.giftNifty;
        const indiaVix = context.india.indiaVix;
        const breadth = context.internals.breadth;
        const optionChain = context.internals.optionChain;
        const macro = context.macro;
        const news = context.news.aggregate;
        const global = context.global;
        const sessionProfile = getSessionScoringProfile(context.session?.mode);
        const multipliers = sessionProfile.multipliers;
        const fiiCombined = context.internals.fiiDii.combined || [];
        const indiaVixPrice = indiaVix?.price;
        const dxyPrice = macro.dxy?.price;
        const us10yPrice = macro.us10y?.price;
        const crudeChangePercent = macro.crude?.changePercent ?? 0;

        const giftGapPct = giftNifty?.price && nifty?.previousClose
            ? round(((giftNifty.price - nifty.previousClose) / nifty.previousClose) * 100, 2)
            : null;
        const niftyMovePct = nifty?.changePercent ?? null;
        const bankRelativeStrength = bankNifty?.changePercent !== null && niftyMovePct !== null
            ? round(bankNifty.changePercent - niftyMovePct, 2)
            : null;
        const breadthPct = breadth?.advances && (breadth.advances + (breadth.declines || 0))
            ? round((breadth.advances / (breadth.advances + breadth.declines)) * 100, 2)
            : null;
        const pcr = optionChain?.putCallRatio ?? null;
        const fiiNet = fiiCombined.find((entry) => entry.category === "FII/FPI")?.netValue;
        const diiNet = fiiCombined.find((entry) => entry.category === "DII")?.netValue;
        const hasFlowData = Number.isFinite(Number(fiiNet)) || Number.isFinite(Number(diiNet));
        const combinedFlow = hasFlowData ? Number(fiiNet || 0) + Number(diiNet || 0) : null;
        const globalCompositeValues = Object.values(global).map((item) => item.changePercent).filter((value) => Number.isFinite(value));
        const globalComposite = globalCompositeValues.length
            ? round(globalCompositeValues.reduce((sum, value) => sum + value, 0) / globalCompositeValues.length, 2)
            : null;

        const weights = SIGNAL_CONFIG.weights;
        const breakdown = [];

        const giftComponent = scaleOutput(scoreAgainstBands(giftGapPct, [
            { test: (value) => value >= 0.6, output: { score: weights.giftNifty, interpretation: "GIFT Nifty signals a firm positive opening setup.", effect: "Bullish" } },
            { test: (value) => value >= 0.2, output: { score: Math.round(weights.giftNifty * 0.65), interpretation: "GIFT Nifty is mildly positive versus NIFTY close.", effect: "Bullish" } },
            { test: (value) => value <= -0.6, output: { score: -weights.giftNifty, interpretation: "GIFT Nifty signals a weak or gap-down opening bias.", effect: "Bearish" } },
            { test: (value) => value <= -0.2, output: { score: -Math.round(weights.giftNifty * 0.65), interpretation: "GIFT Nifty is mildly negative versus NIFTY close.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "GIFT Nifty is near flat versus the NIFTY close.", effect: "Neutral" } }
        ]), multipliers.giftNifty);
        breakdown.push(buildComponent("GIFT Nifty Gap", giftGapPct !== null ? `${formatValue(giftGapPct)}%` : "Unavailable", giftComponent));

        const cashComponent = scaleOutput(scoreAgainstBands(niftyMovePct, [
            { test: (value) => value >= 1, output: { score: weights.niftyPriceAction, interpretation: "Cash index action confirms strong buying participation.", effect: "Bullish" } },
            { test: (value) => value >= 0.3, output: { score: Math.round(weights.niftyPriceAction * 0.5), interpretation: "Cash index action is positive but not impulsive.", effect: "Bullish" } },
            { test: (value) => value <= -1, output: { score: -weights.niftyPriceAction, interpretation: "Cash index action confirms downside pressure.", effect: "Bearish" } },
            { test: (value) => value <= -0.3, output: { score: -Math.round(weights.niftyPriceAction * 0.5), interpretation: "Cash index action is modestly weak.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Cash index action is balanced and non-directional.", effect: "Neutral" } }
        ]), multipliers.niftyPriceAction);
        breakdown.push(buildComponent("NIFTY Cash Action", niftyMovePct !== null ? `${formatValue(niftyMovePct)}%` : "Unavailable", cashComponent));

        const vixComponent = scaleOutput(scoreAgainstBands(indiaVixPrice, [
            { test: (value) => value <= 14, output: { score: Math.round(weights.indiaVix * 0.8), interpretation: "Low volatility is supportive for directional continuation.", effect: "Bullish" } },
            { test: (value) => value <= 18, output: { score: Math.round(weights.indiaVix * 0.35), interpretation: "Volatility is contained and manageable.", effect: "Bullish" } },
            { test: (value) => value >= 22, output: { score: -weights.indiaVix, interpretation: "High volatility raises whipsaw and gap risk.", effect: "Bearish" } },
            { test: (value) => value >= 19, output: { score: -Math.round(weights.indiaVix * 0.55), interpretation: "Volatility is elevated and warrants caution.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Volatility is in a middle regime with no clear edge.", effect: "Neutral" } }
        ]), multipliers.indiaVix);
        breakdown.push(buildComponent("INDIA VIX", Number.isFinite(indiaVixPrice) ? formatValue(indiaVixPrice) : "Unavailable", vixComponent));

        const bankComponent = scaleOutput(scoreAgainstBands(bankRelativeStrength, [
            { test: (value) => value >= 0.4, output: { score: weights.bankStrength, interpretation: "BANK NIFTY is outperforming and confirming risk appetite.", effect: "Bullish" } },
            { test: (value) => value >= 0.15, output: { score: Math.round(weights.bankStrength * 0.5), interpretation: "BANK NIFTY is modestly stronger than NIFTY.", effect: "Bullish" } },
            { test: (value) => value <= -0.4, output: { score: -weights.bankStrength, interpretation: "BANK NIFTY is lagging and weakening market leadership.", effect: "Bearish" } },
            { test: (value) => value <= -0.15, output: { score: -Math.round(weights.bankStrength * 0.5), interpretation: "BANK NIFTY is slightly weaker than NIFTY.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Banks are not providing a decisive leadership signal.", effect: "Neutral" } }
        ]), multipliers.bankStrength);
        breakdown.push(buildComponent("Bank Relative Strength", bankRelativeStrength !== null ? `${formatValue(bankRelativeStrength)}%` : "Unavailable", bankComponent));

        const breadthComponent = scaleOutput(scoreAgainstBands(breadthPct, [
            { test: (value) => value >= 65, output: { score: weights.breadth, interpretation: "Breadth is strong with broad-based participation.", effect: "Bullish" } },
            { test: (value) => value >= 55, output: { score: Math.round(weights.breadth * 0.5), interpretation: "Breadth is positive but not dominant.", effect: "Bullish" } },
            { test: (value) => value <= 35, output: { score: -weights.breadth, interpretation: "Breadth is weak and points to defensive participation.", effect: "Bearish" } },
            { test: (value) => value <= 45, output: { score: -Math.round(weights.breadth * 0.5), interpretation: "Breadth is slightly negative.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Breadth is balanced and does not add conviction.", effect: "Neutral" } }
        ]), multipliers.breadth);
        breakdown.push(buildComponent("Breadth", breadthPct !== null ? `${formatValue(breadthPct)}% advancers` : "Unavailable", breadthComponent));

        const pcrComponent = scaleOutput(scoreAgainstBands(pcr, [
            { test: (value) => value >= 0.95 && value <= 1.3, output: { score: weights.pcr, interpretation: "PCR sits in a constructive zone for balanced bullish positioning.", effect: "Bullish" } },
            { test: (value) => value >= 0.8 && value < 0.95, output: { score: -Math.round(weights.pcr * 0.55), interpretation: "Low PCR reflects heavier call positioning and caution.", effect: "Bearish" } },
            { test: (value) => value < 0.8, output: { score: -weights.pcr, interpretation: "PCR is weak and indicates a bearish options posture.", effect: "Bearish" } },
            { test: (value) => value > 1.3, output: { score: 0, interpretation: "PCR is elevated, which can indicate hedging rather than clean risk-on conviction.", effect: "Neutral" } },
            { test: () => true, output: { score: 0, interpretation: "PCR is neutral.", effect: "Neutral" } }
        ]), multipliers.pcr);
        breakdown.push(buildComponent("Put Call Ratio", pcr !== null ? formatValue(pcr) : "Unavailable", pcrComponent));

        const flowComponent = scaleOutput(scoreAgainstBands(combinedFlow, [
            { test: (value) => value >= 1500, output: { score: weights.fiiDii, interpretation: "Institutional flows are strongly net supportive.", effect: "Bullish" } },
            { test: (value) => value >= 300, output: { score: Math.round(weights.fiiDii * 0.5), interpretation: "Institutional flows have a mild positive bias.", effect: "Bullish" } },
            { test: (value) => value <= -1500, output: { score: -weights.fiiDii, interpretation: "Institutional flows are decisively risk-off.", effect: "Bearish" } },
            { test: (value) => value <= -300, output: { score: -Math.round(weights.fiiDii * 0.5), interpretation: "Institutional flows are mildly negative.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Institutional flows are mixed.", effect: "Neutral" } }
        ]), multipliers.fiiDii);
        breakdown.push(buildComponent("FII + DII Net", Number.isFinite(combinedFlow) ? `Rs ${formatValue(combinedFlow)} Cr` : "Unavailable", flowComponent));

        const globalComponent = scaleOutput(scoreAgainstBands(globalComposite, [
            { test: (value) => value >= 0.6, output: { score: weights.globalCues, interpretation: "Global futures and Asia are broadly supportive.", effect: "Bullish" } },
            { test: (value) => value >= 0.2, output: { score: Math.round(weights.globalCues * 0.55), interpretation: "Global cues are modestly positive.", effect: "Bullish" } },
            { test: (value) => value <= -0.6, output: { score: -weights.globalCues, interpretation: "Global cues are decisively risk-off.", effect: "Bearish" } },
            { test: (value) => value <= -0.2, output: { score: -Math.round(weights.globalCues * 0.55), interpretation: "Global cues are mildly negative.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Global cues are mixed.", effect: "Neutral" } }
        ]), multipliers.globalCues);
        breakdown.push(buildComponent("Global Cues", globalComposite !== null ? `${formatValue(globalComposite)}% avg` : "Unavailable", globalComponent));

        const dxyComponent = scaleOutput(scoreAgainstBands(dxyPrice, [
            { test: (value) => value <= 100, output: { score: weights.dxy, interpretation: "A softer dollar supports EM risk appetite.", effect: "Bullish" } },
            { test: (value) => value >= 105, output: { score: -weights.dxy, interpretation: "A strong dollar can pressure emerging market flows.", effect: "Bearish" } },
            { test: (value) => value >= 103, output: { score: -Math.round(weights.dxy * 0.6), interpretation: "Dollar strength is a moderate headwind.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Dollar index is not giving a strong edge.", effect: "Neutral" } }
        ]), multipliers.dxy);
        breakdown.push(buildComponent("DXY", Number.isFinite(dxyPrice) ? formatValue(dxyPrice) : "Unavailable", dxyComponent));

        const yieldComponent = scaleOutput(scoreAgainstBands(us10yPrice, [
            { test: (value) => value <= 3.7, output: { score: Math.round(weights.us10y * 0.55), interpretation: "Lower treasury yields are supportive for equities.", effect: "Bullish" } },
            { test: (value) => value >= 4.4, output: { score: -weights.us10y, interpretation: "High treasury yields tighten financial conditions.", effect: "Bearish" } },
            { test: (value) => value >= 4.1, output: { score: -Math.round(weights.us10y * 0.55), interpretation: "Yields are elevated enough to pressure multiples.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Treasury yields are in a middle range.", effect: "Neutral" } }
        ]), multipliers.us10y);
        breakdown.push(buildComponent("US 10Y Yield", Number.isFinite(us10yPrice) ? `${formatValue(us10yPrice)}%` : "Unavailable", yieldComponent));

        const crudeReference = macro.brent?.price ?? macro.crude?.price ?? null;
        const crudeComponent = scaleOutput(scoreAgainstBands(crudeReference, [
            { test: (value) => value <= 70, output: { score: Math.round(weights.crude * 0.55), interpretation: "Benign crude pricing helps inflation and import costs.", effect: "Bullish" } },
            { test: (value) => value >= 90, output: { score: -weights.crude, interpretation: "A crude spike is a macro headwind for India.", effect: "Bearish" } },
            { test: (value) => value >= 80, output: { score: -Math.round(weights.crude * 0.55), interpretation: "Crude is elevated and deserves caution.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Crude is not flashing an extreme macro signal.", effect: "Neutral" } }
        ]), multipliers.crude);
        breakdown.push(buildComponent("Crude / Brent", crudeReference !== null ? formatValue(crudeReference) : "Unavailable", crudeComponent));

        const newsComponent = scaleOutput(scoreAgainstBands(news.score, [
            { test: (value) => value >= 18, output: { score: weights.news, interpretation: "Headline flow is clearly supportive for risk appetite.", effect: "Bullish" } },
            { test: (value) => value >= 6, output: { score: Math.round(weights.news * 0.5), interpretation: "Headline flow leans constructive.", effect: "Bullish" } },
            { test: (value) => value <= -18, output: { score: -weights.news, interpretation: "Headline flow is clearly risk-off.", effect: "Bearish" } },
            { test: (value) => value <= -6, output: { score: -Math.round(weights.news * 0.5), interpretation: "Headline flow leans defensive.", effect: "Bearish" } },
            { test: () => true, output: { score: 0, interpretation: "Headline flow is mixed and non-directional.", effect: "Neutral" } }
        ]), multipliers.news);
        breakdown.push(buildComponent("News Sentiment", news.score !== null ? formatValue(news.score) : "Unavailable", newsComponent));

        const totalScore = breakdown.reduce((sum, component) => sum + component.score, 0);
        const normalizedScore = round((totalScore / SIGNAL_CONFIG.maxAbsoluteScore) * 100, 2);
        const openingBias = giftGapPct >= SIGNAL_CONFIG.openingGapPct.bullish
            ? "Gap Up"
            : giftGapPct <= SIGNAL_CONFIG.openingGapPct.bearish
                ? "Gap Down"
                : "Flat";
        const hasOvernightConflict = sessionProfile.isOvernightLens
            && ((openingBias === "Gap Down" && normalizedScore > 0 && normalizedScore < 55)
                || (openingBias === "Gap Up" && normalizedScore < 0 && normalizedScore > -55));
        const decisionScore = hasOvernightConflict
            ? round(openingBias === "Gap Down" ? Math.min(normalizedScore, 19) : Math.max(normalizedScore, -19), 2)
            : normalizedScore;
        const marketSignal = classifySignal(decisionScore);
        const availableComponents = breakdown.filter((item) => item.currentValue !== "Unavailable").length;
        const coverage = availableComponents / breakdown.length;
        const sameDirectionCount = breakdown.filter((item) => Math.sign(item.score) === Math.sign(totalScore) && item.score !== 0).length;
        const confidence = Math.round(clamp((coverage * 45) + ((Math.abs(decisionScore) / 100) * 35) + ((sameDirectionCount / breakdown.length) * 20), 18, 96));
        const effectiveConfidence = hasOvernightConflict ? Math.min(confidence, 54) : confidence;
        const intradayBias = normalizedScore >= 20 ? "Trend Up" : normalizedScore <= -20 ? "Trend Down" : "Sideways";
        const overnightBullishVeto = sessionProfile.isOvernightLens && openingBias === "Gap Down";
        const overnightBearishVeto = sessionProfile.isOvernightLens && openingBias === "Gap Up";
        const cePeBias = marketSignal.includes("Bullish") && effectiveConfidence >= 55 && (indiaVixPrice || 0) < 22 && !overnightBullishVeto
            ? "CE bias"
            : marketSignal.includes("Bearish") && effectiveConfidence >= 55 && (indiaVixPrice || 0) < 22 && !overnightBearishVeto
                ? "PE bias"
                : "No trade";

        const riskFlags = [];
        if ((indiaVixPrice || 0) >= 22) {
            riskFlags.push({ label: "High VIX warning", detail: `INDIA VIX at ${formatValue(indiaVixPrice)} is elevated and can amplify whipsaws.`, severity: "high" });
        }
        if ((macro.brent?.price || 0) >= 90 || crudeChangePercent >= 2) {
            riskFlags.push({ label: "Crude spike warning", detail: "Energy prices are elevated and can pressure inflation-sensitive sectors.", severity: "medium" });
        }
        if ((us10yPrice || 0) >= 4.4) {
            riskFlags.push({ label: "Yield spike warning", detail: "US 10Y yields are elevated, which can compress equity risk appetite.", severity: "medium" });
        }
        if ((news.highImpactCount || 0) > 0 && news.score < 0) {
            riskFlags.push({ label: "Risk-off alert", detail: "Negative high-impact headlines are active in the news flow.", severity: "high" });
        }
        if (!riskFlags.length) {
            riskFlags.push({ label: "Risk panel", detail: "No extreme macro or volatility warning is dominating right now.", severity: "low" });
        }

        const strategy = {
            ceConditions: [
                `Prefer calls when ${openingBias === "Gap Up" ? "overnight cues remain supportive" : "post-open confirmation improves"} and BANK NIFTY stays stronger than NIFTY.`,
                "Look for breadth above 55% advancers with PCR staying above 0.95.",
                "Favor CE setups only when INDIA VIX remains controlled and high-impact news does not flip risk-off."
            ],
            peConditions: [
                `Prefer puts when ${openingBias === "Gap Down" ? "weak overnight cues persist" : "cash market breaks lower after the open"} and BANK NIFTY lags.`,
                "Look for weak breadth, lower PCR, and negative institutional or global signals.",
                "Favor PE setups when yields, DXY, or crude are pressuring risk assets."
            ],
            noTradeConditions: [
                "Avoid forcing trades when the total score stays near neutral or sources are degraded.",
                "Stand aside when high-impact macro headlines are active and volatility is elevated.",
                "No-trade remains the default if CE/PE bias and confidence do not align."
            ],
            volatilityWarning: (indiaVixPrice || 0) >= 22
                ? "Volatility is high. Reduce size, widen stops, or skip the trade."
                : "Volatility is manageable, but still require price confirmation before execution.",
            first15MinuteRule: "Wait for the first 15 minutes after the cash open to confirm whether the opening gap is accepting or fading."
        };

        const topDrivers = breakdown
            .filter((item) => Number.isFinite(item.score) && item.score !== 0)
            .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
            .slice(0, 3)
            .map((item) => item.parameter);

        const quick = buildQuickNotation(marketSignal, cePeBias, effectiveConfidence);
        const summary = {
            plainEnglish: marketSignal === "Strong Bullish" || marketSignal === "Bullish"
                ? `The dashboard sees more positive signals than negative ones ${sessionProfile.decisionWindow}.`
                : marketSignal === "Strong Bearish" || marketSignal === "Bearish"
                    ? `The dashboard sees more negative signals than positive ones ${sessionProfile.decisionWindow}.`
                    : `The dashboard sees mixed signals, so direction is not clean ${sessionProfile.decisionWindow}.`,
            whyItLooksThisWay: topDrivers.length ? `Biggest drivers: ${topDrivers.join(", ")}.` : "No dominant driver is available yet.",
            tradePosture: sessionProfile.isOvernightLens
                ? (cePeBias === "CE bias"
                    ? "Calls stay on watch only if overnight strength survives the next open and the first 15 minutes confirm."
                    : cePeBias === "PE bias"
                        ? "Puts stay on watch only if overnight weakness carries into the next open and the first 15 minutes confirm."
                        : "No-trade is preferred until the next session opens and the live signals align more clearly.")
                : (cePeBias === "CE bias"
                    ? "Calls are favored only if the opening move confirms after the first 15 minutes."
                    : cePeBias === "PE bias"
                        ? "Puts are favored only if weakness confirms after the first 15 minutes."
                        : "No-trade is preferred until the live signals align more clearly.")
        };

        return {
            score: decisionScore,
            marketSignal,
            confidence: effectiveConfidence,
            cePeBias,
            openingBias,
            intradayBias,
            quick,
            breakdown,
            summary,
            strategy,
            risks: riskFlags
        };
    }

    function getSelectedSpot(india, symbol) {
        return symbol === "BANKNIFTY" ? india?.bankNifty : india?.nifty;
    }

    function getSelectedIntraday(intraday, symbol) {
        return intraday?.instruments?.[symbol] || null;
    }

    function getCurrentPrice(spot, intraday) {
        const lastCandle = intraday?.series?.[intraday.series.length - 1];
        return Number.isFinite(lastCandle?.close) ? lastCandle.close : (spot?.price ?? null);
    }

    function getSeriesCloses(series = []) {
        return series.map((candle) => candle.close).filter((value) => Number.isFinite(value));
    }

    function findPivots(series = []) {
        const highs = [];
        const lows = [];

        for (let index = 1; index < series.length - 1; index += 1) {
            const previous = series[index - 1];
            const current = series[index];
            const next = series[index + 1];

            if (current.high > previous.high && current.high >= next.high) {
                highs.push({ index, value: current.high });
            }
            if (current.low < previous.low && current.low <= next.low) {
                lows.push({ index, value: current.low });
            }
        }

        return { highs, lows };
    }

    function detectTrendStructure(series = []) {
        const recentSeries = series.slice(-14);
        if (recentSeries.length < 5) {
            return {
                regime: "SIDEWAYS",
                badge: "Sideways",
                score: 0,
                strength: 0.3,
                detail: "Not enough intraday candles to validate HH/HL or LH/LL."
            };
        }

        const pivots = findPivots(recentSeries);
        const lastHighs = pivots.highs.slice(-2);
        const lastLows = pivots.lows.slice(-2);
        let regime = "SIDEWAYS";
        let score = 0;
        let detail = "Recent swing highs and lows are overlapping.";
        let strength = 0.45;

        if (lastHighs.length >= 2 && lastLows.length >= 2) {
            const higherHighs = lastHighs[1].value > lastHighs[0].value;
            const higherLows = lastLows[1].value > lastLows[0].value;
            const lowerHighs = lastHighs[1].value < lastHighs[0].value;
            const lowerLows = lastLows[1].value < lastLows[0].value;

            if (higherHighs && higherLows) {
                regime = "UPTREND";
                score = 1;
                strength = 0.85;
                detail = "Higher highs and higher lows are active.";
            } else if (lowerHighs && lowerLows) {
                regime = "DOWNTREND";
                score = -1;
                strength = 0.85;
                detail = "Lower highs and lower lows are active.";
            }
        }

        if (score === 0) {
            const closes = getSeriesCloses(recentSeries);
            const first = closes[0];
            const last = closes[closes.length - 1];
            const movePercent = Number.isFinite(first) && first
                ? round(((last - first) / first) * 100, 2)
                : null;

            if (movePercent >= 0.45) {
                regime = "UPTREND";
                score = 0.5;
                strength = 0.65;
                detail = "Closes are drifting higher even though pivots are not fully clean yet.";
            } else if (movePercent <= -0.45) {
                regime = "DOWNTREND";
                score = -0.5;
                strength = 0.65;
                detail = "Closes are drifting lower even though pivots are not fully clean yet.";
            }
        }

        return {
            regime,
            badge: regime === "UPTREND" ? "Uptrend Active" : regime === "DOWNTREND" ? "Downtrend Active" : "Sideways",
            score,
            strength,
            detail
        };
    }

    function getGiftGapPercent(context, selectedSpot) {
        const giftPrice = context?.india?.giftNifty?.price;
        const referenceClose = context?.india?.nifty?.previousClose ?? selectedSpot?.previousClose;

        if (!Number.isFinite(giftPrice) || !Number.isFinite(referenceClose) || !referenceClose) {
            return null;
        }

        return round(((giftPrice - referenceClose) / referenceClose) * 100, 2);
    }

    function getBreadthRatio(breadth) {
        const advancing = Number(breadth?.advances);
        const declining = Number(breadth?.declines);

        if (!Number.isFinite(advancing) || !Number.isFinite(declining) || advancing < 0 || declining < 0) {
            return null;
        }

        if (declining === 0) {
            return advancing > 0 ? Number.POSITIVE_INFINITY : null;
        }

        return round(advancing / declining, 2);
    }

    function getFiiNetFlow(internals) {
        const combinedFlows = Array.isArray(internals?.fiiDii?.combined) ? internals.fiiDii.combined : [];
        const fiiRow = combinedFlows.find((item) => item.category === "FII/FPI");
        const fiiNet = Number(fiiRow?.netValue);

        if (Number.isFinite(fiiNet)) {
            return fiiNet;
        }

        return combinedFlows.length
            ? combinedFlows.reduce((sum, item) => {
                const value = Number(item?.netValue);
                return Number.isFinite(value) ? sum + value : sum;
            }, 0)
            : null;
    }

    function normalizeGiftSignal(gapPercent) {
        if (!Number.isFinite(gapPercent)) {
            return 0;
        }
        if (Math.abs(gapPercent) < DECISION_CONFIG.institutionalModel.giftFlatThreshold) {
            return 0;
        }
        return gapPercent > 0 ? 1 : -1;
    }

    function normalizeVixSignal(vixPrice) {
        if (!Number.isFinite(vixPrice)) {
            return 0;
        }
        if (vixPrice > DECISION_CONFIG.institutionalModel.vixBearishThreshold) {
            return -1;
        }
        if (vixPrice < DECISION_CONFIG.institutionalModel.vixBullishThreshold) {
            return 1;
        }
        return 0;
    }

    function normalizePcrSignal(pcr) {
        if (!Number.isFinite(pcr)) {
            return 0;
        }
        if (pcr > DECISION_CONFIG.institutionalModel.pcrBearishThreshold) {
            return -1;
        }
        if (pcr < DECISION_CONFIG.institutionalModel.pcrBullishThreshold) {
            return 1;
        }
        return 0;
    }

    function normalizeBreadthSignal(breadthRatio) {
        if (breadthRatio === Number.POSITIVE_INFINITY) {
            return 1;
        }
        if (!Number.isFinite(breadthRatio)) {
            return 0;
        }
        if (breadthRatio > DECISION_CONFIG.institutionalModel.breadthBullishThreshold) {
            return 1;
        }
        if (breadthRatio < DECISION_CONFIG.institutionalModel.breadthBearishThreshold) {
            return -1;
        }
        return 0;
    }

    function normalizeFlowSignal(fiiFlow) {
        if (!Number.isFinite(fiiFlow)) {
            return 0;
        }
        return fiiFlow > 0 ? 1 : fiiFlow < 0 ? -1 : 0;
    }

    function normalizePriceSignal(currentPrice, openingRange) {
        const first15High = openingRange?.high;
        const first15Low = openingRange?.low;
        if (!openingRange?.completed || !Number.isFinite(currentPrice) || !Number.isFinite(first15High) || !Number.isFinite(first15Low)) {
            return 0;
        }

        if (currentPrice > first15High) {
            return 1;
        }
        if (currentPrice < first15Low) {
            return -1;
        }
        return 0;
    }

    function determineBias(score) {
        if (score > DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
            return "UP";
        }
        if (score < -DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
            return "DOWN";
        }
        return "NEUTRAL";
    }

    function determineAction(score, priceSignal) {
        if (priceSignal === 0) {
            return "WAIT";
        }
        if (score > DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
            return "CE";
        }
        if (score < -DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
            return "PE";
        }
        return "WAIT";
    }

    function detectTrap(gapPercent, vixPrice, priceSignal) {
        if (Number.isFinite(gapPercent) && gapPercent > DECISION_CONFIG.institutionalModel.trapGapThreshold
            && Number.isFinite(vixPrice) && vixPrice > DECISION_CONFIG.institutionalModel.vixBearishThreshold && priceSignal <= 0) {
            return {
                label: "BULL TRAP",
                tone: "negative",
                detail: "Gap-up optimism is not being accepted while VIX stays elevated."
            };
        }

        if (Number.isFinite(gapPercent) && gapPercent < -DECISION_CONFIG.institutionalModel.trapGapThreshold
            && Number.isFinite(vixPrice) && vixPrice > DECISION_CONFIG.institutionalModel.vixBearishThreshold && priceSignal >= 0) {
            return {
                label: "BEAR TRAP",
                tone: "positive",
                detail: "Gap-down fear is being rejected while VIX stays elevated."
            };
        }

        return {
            label: "NONE",
            tone: "neutral",
            detail: "No opening trap is currently active."
        };
    }

    function buildDecisionComponent(key, label, signal, weight, value, detail) {
        return {
            key,
            label,
            signal,
            weight,
            score: round(signal * weight, 2),
            value,
            detail: `Signal ${signal > 0 ? "+" : ""}${signal} x weight ${weight.toFixed(2)}. ${detail}`,
            tone: signal > 0 ? "bullish" : signal < 0 ? "bearish" : "neutral"
        };
    }

    function describePriceLocation(priceSignal, openingRange) {
        if (!openingRange?.completed) {
            return "Waiting for first 15-minute range";
        }
        if (priceSignal > 0) {
            return "Above first 15-minute high";
        }
        if (priceSignal < 0) {
            return "Below first 15-minute low";
        }
        return "Inside first 15-minute range";
    }

    function buildOpeningState(gapPercent, currentPrice, openingRange) {
        const priceSignal = normalizePriceSignal(currentPrice, openingRange);
        const gapType = !Number.isFinite(gapPercent) || Math.abs(gapPercent) < DECISION_CONFIG.institutionalModel.giftFlatThreshold
            ? "FLAT"
            : gapPercent > 0
                ? "GAP_UP"
                : "GAP_DOWN";

        if (!openingRange?.completed || !Number.isFinite(currentPrice)) {
            return {
                gapType,
                gapPercent,
                first15High: openingRange?.high ?? null,
                first15Low: openingRange?.low ?? null,
                score: 0,
                title: "Opening range not ready",
                detail: "Wait for the first 15-minute high and low before taking a directional option trade."
            };
        }

        if (priceSignal > 0) {
            return {
                gapType,
                gapPercent,
                first15High: openingRange.high,
                first15Low: openingRange.low,
                score: 1,
                title: "Price confirmed above first 15-minute high",
                detail: `Spot is trading above ${formatValue(openingRange.high)}, so bullish continuation is confirmed.`
            };
        }

        if (priceSignal < 0) {
            return {
                gapType,
                gapPercent,
                first15High: openingRange.high,
                first15Low: openingRange.low,
                score: -1,
                title: "Price confirmed below first 15-minute low",
                detail: `Spot is trading below ${formatValue(openingRange.low)}, so bearish continuation is confirmed.`
            };
        }

        return {
            gapType,
            gapPercent,
            first15High: openingRange.high,
            first15Low: openingRange.low,
            score: 0,
            title: "Price is still inside the first 15-minute range",
            detail: `Wait for acceptance above ${formatValue(openingRange.high)} or below ${formatValue(openingRange.low)}.`
        };
    }

    function buildNoTradeZone(action, bias, score, priceSignal, opening, trap) {
        const reasons = [];

        if (!opening?.first15High || !opening?.first15Low) {
            reasons.push("Opening range is not complete yet.");
        }
        if (priceSignal === 0) {
            reasons.push("Price is still inside the first 15-minute range.");
        }
        if (Math.abs(score) <= DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
            reasons.push("Weighted score is not strong enough for a trade.");
        }
        if (trap.label !== "NONE" && action === "WAIT") {
            reasons.push(`${trap.label} is active, but price has not confirmed the reversal entry yet.`);
        }
        if (action === "WAIT" && bias !== "NEUTRAL" && priceSignal === 0) {
            reasons.push(`Bias is ${bias}, but confirmation is missing.`);
        }

        return {
            active: action === "WAIT",
            reasons
        };
    }

    function buildDecisionRiskMeter(vixPrice, trap, priceSignal, score) {
        let raw = 38;
        if (Number.isFinite(vixPrice) && vixPrice > DECISION_CONFIG.institutionalModel.vixBearishThreshold) {
            raw += 24;
        } else if (Number.isFinite(vixPrice) && vixPrice < DECISION_CONFIG.institutionalModel.vixBullishThreshold) {
            raw -= 8;
        }
        if (trap.label !== "NONE") {
            raw += 14;
        }
        if (priceSignal === 0) {
            raw += 12;
        }
        if (Math.abs(score) >= 0.6) {
            raw -= 8;
        } else if (Math.abs(score) < 0.25) {
            raw += 8;
        }

        const scoreValue = Math.round(clamp(raw, 12, 95));
        return {
            score: scoreValue,
            level: scoreValue >= 70 ? "High" : scoreValue >= 45 ? "Moderate" : "Controlled",
            detail: scoreValue >= 70
                ? "Volatility or trap conditions are elevated. Confirm every level before entering."
                : scoreValue >= 45
                    ? "The setup is tradable, but it still needs disciplined entry and stop execution."
                    : "Risk conditions are relatively stable for a directional attempt."
        };
    }

    function determineSuggestedStrikeStyle(action, score, confidence, trend, trap) {
        if (action === "WAIT") {
            return "ATM";
        }
        if (trap.label !== "NONE" || confidence < 55) {
            return "ITM";
        }
        if (Math.abs(score) >= 0.7 && ((action === "CE" && trend.regime === "UPTREND") || (action === "PE" && trend.regime === "DOWNTREND"))) {
            return "OTM";
        }
        if (Math.abs(score) >= 0.5) {
            return "ATM";
        }
        return "ITM";
    }

    function buildMode(action) {
        return action === "WAIT" ? "WAIT" : "TRADE";
    }

    function buildStatusEngine(action, activeTrade) {
        if (!activeTrade) {
            return {
                status: action === "WAIT" ? "WAIT" : "TRADE",
                detail: null
            };
        }

        if (action === "WAIT") {
            return {
                status: "EXIT",
                detail: "Live confirmation is gone. Exit the active trade."
            };
        }

        if (activeTrade.optionType !== action) {
            return {
                status: "EXIT",
                detail: `Live action flipped to ${action}. Exit the active ${activeTrade.optionType} trade.`
            };
        }

        return {
            status: "TRADE",
            detail: "The active trade still aligns with the live decision engine."
        };
    }

    function buildDecisionHeadline(status, action) {
        if (status === "EXIT") {
            return "EXIT";
        }
        if (action === "CE") {
            return "BUY CE";
        }
        if (action === "PE") {
            return "BUY PE";
        }
        return "WAIT";
    }

    function buildDecisionSummary(status, mode, action, bias, trap, opening, selectedInstrumentLabel) {
        if (status === "EXIT") {
            return "Exit the active trade and wait for a fresh confirmed entry.";
        }

        if (action === "CE") {
            return trap.label === "BEAR TRAP"
                ? `${trap.label} confirmed. Bias is ${bias}. Buy ${selectedInstrumentLabel} CE only above ${formatValue(opening.first15High)}.`
                : `Bias is ${bias}. Buy ${selectedInstrumentLabel} CE only above ${formatValue(opening.first15High)}.`;
        }

        if (action === "PE") {
            return trap.label === "BULL TRAP"
                ? `${trap.label} confirmed. Bias is ${bias}. Buy ${selectedInstrumentLabel} PE only below ${formatValue(opening.first15Low)}.`
                : `Bias is ${bias}. Buy ${selectedInstrumentLabel} PE only below ${formatValue(opening.first15Low)}.`;
        }

        if (mode === "WAIT" && bias === "UP" && Number.isFinite(opening.first15High)) {
            return `Bias is UP, but price is still inside the first 15-minute range. Wait for CE above ${formatValue(opening.first15High)}.`;
        }

        if (mode === "WAIT" && bias === "DOWN" && Number.isFinite(opening.first15Low)) {
            return `Bias is DOWN, but price is still inside the first 15-minute range. Wait for PE below ${formatValue(opening.first15Low)}.`;
        }

        return "Signals are mixed. Stay in WAIT mode until the weighted score and price confirmation align.";
    }

    function buildDecisionNotes(gapPercent, vixPrice, pcr, breadthRatio, fiiFlow, bias, trap, opening, score) {
        const notes = [];
        notes.push(`Weighted score ${formatValue(score)} with bias ${bias}.`);
        notes.push(`GIFT gap ${Number.isFinite(gapPercent) ? `${formatValue(gapPercent)}%` : "Unavailable"}, VIX ${Number.isFinite(vixPrice) ? formatValue(vixPrice) : "Unavailable"}, PCR ${Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable"}.`);
        notes.push(`Breadth ratio ${breadthRatio === Number.POSITIVE_INFINITY ? "All advances" : (Number.isFinite(breadthRatio) ? formatValue(breadthRatio) : "Unavailable")}, FII flow ${Number.isFinite(fiiFlow) ? `Rs ${formatValue(fiiFlow)} Cr` : "Unavailable"}.`);

        if (Number.isFinite(opening?.first15High) && Number.isFinite(opening?.first15Low)) {
            notes.push(`No trade until spot accepts above ${formatValue(opening.first15High)} or below ${formatValue(opening.first15Low)}.`);
        }

        if (trap.label !== "NONE") {
            notes.push(`${trap.label}: ${trap.detail}`);
        }

        return notes;
    }

    function buildInstitutionalDecisionEngine(context) {
        const selectedInstrument = context.traderProfile?.preferredInstrument || "NIFTY";
        const selectedSpot = getSelectedSpot(context.india, selectedInstrument);
        const selectedIntraday = getSelectedIntraday(context.intraday, selectedInstrument);
        const selectedPrice = getCurrentPrice(selectedSpot, selectedIntraday);
        const openingRange = selectedIntraday?.openingRange || null;
        const chain = context.internals?.optionChains?.[selectedInstrument] || context.internals?.optionChain || null;
        const trend = detectTrendStructure(selectedIntraday?.series || []);
        const gapPercent = getGiftGapPercent(context, selectedSpot);
        const vixPrice = context.india?.indiaVix?.price ?? context.intraday?.instruments?.INDIA_VIX?.price ?? null;
        const pcr = chain?.putCallRatio ?? null;
        const breadthRatio = getBreadthRatio(context.internals?.breadth);
        const fiiFlow = getFiiNetFlow(context.internals);
        const giftSignal = normalizeGiftSignal(gapPercent);
        const vixSignal = normalizeVixSignal(vixPrice);
        const pcrSignal = normalizePcrSignal(pcr);
        const breadthSignal = normalizeBreadthSignal(breadthRatio);
        const flowSignal = normalizeFlowSignal(fiiFlow);
        const priceSignal = normalizePriceSignal(selectedPrice, openingRange);
        const weights = DECISION_CONFIG.institutionalModel.weights;
        const score = round(
            (giftSignal * weights.gift)
            + (vixSignal * weights.vix)
            + (pcrSignal * weights.pcr)
            + (breadthSignal * weights.breadth)
            + (flowSignal * weights.flows)
            + (priceSignal * weights.price),
            2
        );
        const bias = determineBias(score);
        const action = determineAction(score, priceSignal);
        const mode = buildMode(action);
        const confidence = Math.min(95, Math.round(Math.abs(score) * 100));
        const trap = detectTrap(gapPercent, vixPrice, priceSignal);
        const opening = buildOpeningState(gapPercent, selectedPrice, openingRange);
        const noTradeZone = buildNoTradeZone(action, bias, score, priceSignal, opening, trap);
        const statusEngine = buildStatusEngine(action, context.activeTrade);
        const riskMeter = buildDecisionRiskMeter(vixPrice, trap, priceSignal, score);
        const suggestedStrikeStyle = determineSuggestedStrikeStyle(action, score, confidence, trend, trap);
        const headline = buildDecisionHeadline(statusEngine.status, action);

        return {
            status: statusEngine.status,
            mode,
            bias,
            action,
            direction: action === "WAIT" ? "WAIT" : action,
            headline,
            confidence,
            score,
            selectedInstrument,
            selectedInstrumentLabel: getInstrumentLabel(selectedInstrument),
            suggestedStrikeStyle,
            trap: trap.label,
            trapDetail: trap.detail,
            trapTone: trap.tone,
            summary: statusEngine.detail || buildDecisionSummary(statusEngine.status, mode, action, bias, trap, opening, getInstrumentLabel(selectedInstrument)),
            trend: {
                regime: trend.regime,
                badge: trend.badge,
                detail: trend.detail
            },
            opening,
            noTradeZone,
            entry: {
                CE_above: opening.first15High ?? null,
                PE_below: opening.first15Low ?? null
            },
            levels: {
                support: chain?.support?.strike ?? null,
                resistance: chain?.resistance?.strike ?? null,
                pcr,
                breadthRatio,
                fiiFlow
            },
            marketContext: {
                selectedPrice,
                selectedChangePercent: selectedSpot?.changePercent ?? selectedIntraday?.sessionChangePercent ?? null,
                first15High: opening.first15High ?? null,
                first15Low: opening.first15Low ?? null,
                priceSignal
            },
            scorecard: {
                giftGapPercent: gapPercent,
                giftSignal,
                vix: vixPrice,
                vixSignal,
                pcr,
                pcrSignal,
                breadthRatio,
                breadthSignal,
                fiiFlow,
                flowSignal,
                currentPrice: selectedPrice,
                priceSignal,
                first15MinHigh: opening.first15High ?? null,
                first15MinLow: opening.first15Low ?? null,
                weights
            },
            riskMeter,
            components: [
                buildDecisionComponent("gift", "GIFT NIFTY Gap", giftSignal, weights.gift, Number.isFinite(gapPercent) ? `${formatValue(gapPercent)}%` : "Unavailable", "Gap versus prior NIFTY close."),
                buildDecisionComponent("vix", "INDIA VIX", vixSignal, weights.vix, Number.isFinite(vixPrice) ? formatValue(vixPrice) : "Unavailable", `Below ${DECISION_CONFIG.institutionalModel.vixBullishThreshold} is bullish, above ${DECISION_CONFIG.institutionalModel.vixBearishThreshold} is bearish.`),
                buildDecisionComponent("pcr", "PCR", pcrSignal, weights.pcr, Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable", "Put OI divided by Call OI."),
                buildDecisionComponent("breadth", "Market Breadth", breadthSignal, weights.breadth, breadthRatio === Number.POSITIVE_INFINITY ? "All advances" : (Number.isFinite(breadthRatio) ? formatValue(breadthRatio) : "Unavailable"), "Advancing stocks divided by declining stocks."),
                buildDecisionComponent("flows", "FII Flow", flowSignal, weights.flows, Number.isFinite(fiiFlow) ? `Rs ${formatValue(fiiFlow)} Cr` : "Unavailable", "Net positive FII flow supports CE, net negative flow supports PE."),
                buildDecisionComponent("price", "Price Action", priceSignal, weights.price, describePriceLocation(priceSignal, openingRange), opening.detail)
            ],
            quick: {
                status: statusEngine.status,
                mode,
                direction: bias,
                optionType: action,
                conviction: confidence >= 70 ? "High" : confidence >= 40 ? "Medium" : "Low",
                trap: trap.label
            },
            notes: buildDecisionNotes(gapPercent, vixPrice, pcr, breadthRatio, fiiFlow, bias, trap, opening, score)
        };
    }

    function decorateInstitutionalDecision(decision, context) {
        const selectedPrice = decision?.marketContext?.selectedPrice;
        const vwapPrice = decision?.vwap?.vwap;
        const confidenceTag = decision?.confidence > 70 ? "Strong" : decision?.confidence >= 40 ? "Moderate" : "Weak";
        const marketType = decision?.trap !== "NONE" || decision?.riskMeter?.level === "High"
            ? { code: "VOLATILE", label: "Volatile", detail: "Trap or volatility risk is elevated." }
            : decision?.trend?.regime === "SIDEWAYS" || decision?.marketContext?.priceSignal === 0
                ? { code: "SIDEWAYS", label: "Sideways", detail: "Price is still inside the first 15-minute range or structure is overlapping." }
                : { code: "TRENDING", label: "Trending", detail: "Price confirmation and structure are aligned." };
        const hold = !context?.activeTrade
            ? { status: "WATCH", headline: "Wait for a live position", detail: "Hold guidance will activate after a CE or PE trade is acknowledged." }
            : context.activeTrade.optionType === "CE"
                ? (Number.isFinite(selectedPrice) && Number.isFinite(vwapPrice) && selectedPrice >= vwapPrice
                    ? { status: "HOLD", headline: "HOLD CE", detail: "Spot is still above the VWAP proxy." }
                    : { status: "EXIT", headline: "EXIT CE", detail: "Spot lost the VWAP proxy or live confirmation." })
                : (Number.isFinite(selectedPrice) && Number.isFinite(vwapPrice) && selectedPrice <= vwapPrice
                    ? { status: "HOLD", headline: "HOLD PE", detail: "Spot is still below the VWAP proxy." }
                    : { status: "EXIT", headline: "EXIT PE", detail: "Spot reclaimed the VWAP proxy or live confirmation." });
        const tradeFramework = {
            entryStyle: decision?.action === "WAIT" ? "Wait" : "Breakout",
            entryLevel: decision?.action === "CE" ? decision?.entry?.CE_above ?? null : decision?.action === "PE" ? decision?.entry?.PE_below ?? null : null,
            stopLoss: decision?.action === "CE"
                ? decision?.levels?.support ?? null
                : decision?.action === "PE"
                    ? decision?.levels?.resistance ?? null
                    : null,
            target: decision?.action === "CE"
                ? decision?.levels?.resistance ?? null
                : decision?.action === "PE"
                    ? decision?.levels?.support ?? null
                    : null,
            riskReward: decision?.action === "WAIT" ? null : 2,
            optionSuggestion: decision?.riskMeter?.level === "High" ? "SPREAD" : decision?.action
        };

        return {
            ...decision,
            engineVersion: "institutional-v1",
            engineLabel: DECISION_CONFIG.engineVersions["institutional-v1"]?.label || "Institutional v1",
            direction: decision?.bias || "NEUTRAL",
            optionType: decision?.action || "WAIT",
            confidenceTag,
            scoreMeter: {
                minimum: -100,
                maximum: 100,
                value: round((Number(decision?.score) || 0) * 100, 0),
                label: confidenceTag
            },
            marketType,
            hold,
            optionsIntelligence: {
                suggestedStructure: tradeFramework.optionSuggestion,
                directionalOption: decision?.action || "WAIT",
                ivPercentile: null,
                ivTrend: Number.isFinite(decision?.scorecard?.vix) ? (decision?.scorecard?.vixSignal > 0 ? "FALLING" : decision?.scorecard?.vixSignal < 0 ? "RISING" : "FLAT") : "FLAT",
                thetaRisk: String(context?.session?.mode || "").toUpperCase() === "LIVE" ? "Controlled" : "High",
                warnings: [
                    decision?.riskMeter?.level === "High" ? "Volatility risk is elevated. Defined-risk spreads are safer than naked option buying." : null,
                    decision?.action === "WAIT" ? "Price confirmation is missing. Avoid forcing a trade." : null
                ].filter(Boolean)
            },
            tradeFramework,
            learning: {
                trackedPredictions: 0,
                resolvedPredictions: 0,
                accuracyPercent: null,
                wins: 0,
                losses: 0,
                strongestSignals: []
            },
            quick: {
                ...(decision?.quick || {}),
                direction: decision?.bias || "NEUTRAL",
                optionType: decision?.action || "WAIT",
                conviction: confidenceTag
            }
        };
    }

    function calculateAdaptiveRsi(series = [], period = 14) {
        const closes = getSeriesCloses(series);
        if (closes.length <= period) {
            return null;
        }

        let gains = 0;
        let losses = 0;
        for (let index = 1; index <= period; index += 1) {
            const change = closes[index] - closes[index - 1];
            if (change >= 0) {
                gains += change;
            } else {
                losses += Math.abs(change);
            }
        }

        let averageGain = gains / period;
        let averageLoss = losses / period;
        for (let index = period + 1; index < closes.length; index += 1) {
            const change = closes[index] - closes[index - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;
            averageGain = ((averageGain * (period - 1)) + gain) / period;
            averageLoss = ((averageLoss * (period - 1)) + loss) / period;
        }

        if (averageLoss === 0) {
            return 100;
        }

        const relativeStrength = averageGain / averageLoss;
        return round(100 - (100 / (1 + relativeStrength)), 2);
    }

    function calculateAdaptiveAtr(series = [], period = 14) {
        if (series.length <= period) {
            return null;
        }

        const trueRanges = [];
        for (let index = 1; index < series.length; index += 1) {
            const current = series[index];
            const previous = series[index - 1];
            if (![current?.high, current?.low, previous?.close].every(Number.isFinite)) {
                continue;
            }
            trueRanges.push(Math.max(
                current.high - current.low,
                Math.abs(current.high - previous.close),
                Math.abs(current.low - previous.close)
            ));
        }

        if (trueRanges.length < period) {
            return null;
        }

        let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
        for (let index = period; index < trueRanges.length; index += 1) {
            atr = ((atr * (period - 1)) + trueRanges[index]) / period;
        }
        return round(atr, 2);
    }

    function calculateAdaptiveAtrExpansion(series = [], period = 14) {
        if (series.length < (period * 2)) {
            return null;
        }
        const currentAtr = calculateAdaptiveAtr(series, period);
        const priorAtr = calculateAdaptiveAtr(series.slice(0, -period), period);
        if (!Number.isFinite(currentAtr) || !Number.isFinite(priorAtr) || !priorAtr) {
            return null;
        }
        return round(currentAtr / priorAtr, 2);
    }

    function getAdaptiveSwingLevels(series = []) {
        const pivots = findPivots(series.slice(-20));
        const recentHigh = pivots.highs.length
            ? pivots.highs[pivots.highs.length - 1].value
            : (series.slice(-10).reduce((max, candle) => (Number.isFinite(candle?.high) ? Math.max(max, candle.high) : max), Number.NEGATIVE_INFINITY));
        const recentLow = pivots.lows.length
            ? pivots.lows[pivots.lows.length - 1].value
            : (series.slice(-10).reduce((min, candle) => (Number.isFinite(candle?.low) ? Math.min(min, candle.low) : min), Number.POSITIVE_INFINITY));
        return {
            recentHigh: Number.isFinite(recentHigh) ? round(recentHigh, 2) : null,
            recentLow: Number.isFinite(recentLow) ? round(recentLow, 2) : null
        };
    }

    function getAdaptiveExpiryRows(chain, traderProfile = {}) {
        const expiries = Array.isArray(chain?.expiries) ? chain.expiries.filter(Boolean) : [];
        const selectedExpiry = String(traderProfile?.expiryPreference || "").toLowerCase() === "next" && expiries[1]
            ? expiries[1]
            : expiries[0] || null;
        const rows = Array.isArray(chain?.contracts)
            ? chain.contracts
                .filter((row) => !selectedExpiry || row.expiryDate === selectedExpiry)
                .filter((row) => Number.isFinite(Number(row?.strikePrice)))
                .sort((left, right) => left.strikePrice - right.strikePrice)
            : [];
        return { selectedExpiry, rows };
    }

    function calculateAdaptiveMaxPain(chain, traderProfile = {}) {
        const { selectedExpiry, rows } = getAdaptiveExpiryRows(chain, traderProfile);
        if (!rows.length) {
            return { expiry: selectedExpiry, strike: null };
        }

        let best = null;
        rows.forEach((candidate) => {
            const candidateStrike = Number(candidate.strikePrice);
            let totalPain = 0;
            rows.forEach((row) => {
                const strikePrice = Number(row.strikePrice);
                totalPain += Math.max(0, candidateStrike - strikePrice) * Number(row?.CE?.openInterest || 0);
                totalPain += Math.max(0, strikePrice - candidateStrike) * Number(row?.PE?.openInterest || 0);
            });
            if (!best || totalPain < best.totalPain) {
                best = { expiry: selectedExpiry, strike: candidateStrike, totalPain };
            }
        });
        return best || { expiry: selectedExpiry, strike: null };
    }

    function calculateAdaptiveOiBalance(chain, traderProfile = {}) {
        const { selectedExpiry, rows } = getAdaptiveExpiryRows(chain, traderProfile);
        if (!rows.length) {
            return { expiry: selectedExpiry, directionalRatio: null };
        }

        const totals = rows.reduce((accumulator, row) => {
            accumulator.totalCallOi += Number(row?.CE?.openInterest || 0);
            accumulator.totalPutOi += Number(row?.PE?.openInterest || 0);
            accumulator.totalCallChangeOi += Number(row?.CE?.changeInOpenInterest || 0);
            accumulator.totalPutChangeOi += Number(row?.PE?.changeInOpenInterest || 0);
            return accumulator;
        }, {
            totalCallOi: 0,
            totalPutOi: 0,
            totalCallChangeOi: 0,
            totalPutChangeOi: 0
        });

        const oiDenominator = Math.abs(totals.totalCallOi) + Math.abs(totals.totalPutOi);
        const changeDenominator = Math.abs(totals.totalCallChangeOi) + Math.abs(totals.totalPutChangeOi);
        const oiBias = oiDenominator ? (totals.totalPutOi - totals.totalCallOi) / oiDenominator : 0;
        const changeBias = changeDenominator ? (totals.totalPutChangeOi - totals.totalCallChangeOi) / changeDenominator : 0;

        return {
            expiry: selectedExpiry,
            directionalRatio: round((changeBias * 0.65) + (oiBias * 0.35), 4)
        };
    }

    function calculateAdaptiveIvPercentile(chain, traderProfile = {}) {
        const { selectedExpiry, rows } = getAdaptiveExpiryRows(chain, traderProfile);
        if (!rows.length) {
            return { expiry: selectedExpiry, percentile: null };
        }

        const allIvs = [];
        rows.forEach((row) => {
            [row?.CE?.impliedVolatility, row?.PE?.impliedVolatility].forEach((value) => {
                const numeric = Number(value);
                if (Number.isFinite(numeric) && numeric > 0) {
                    allIvs.push(numeric);
                }
            });
        });

        if (!allIvs.length) {
            return { expiry: selectedExpiry, percentile: null };
        }

        const underlyingValue = Number(chain?.underlyingValue);
        const nearest = rows.reduce((best, row) => {
            if (!Number.isFinite(underlyingValue)) {
                return best;
            }
            const distance = Math.abs(Number(row.strikePrice) - underlyingValue);
            return !best || distance < best.distance ? { row, distance } : best;
        }, null);
        const atmRow = nearest?.row || rows[Math.floor(rows.length / 2)];
        const atmValues = [atmRow?.CE?.impliedVolatility, atmRow?.PE?.impliedVolatility]
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
        const atmIv = atmValues.length ? atmValues.reduce((sum, value) => sum + value, 0) / atmValues.length : null;
        if (!Number.isFinite(atmIv)) {
            return { expiry: selectedExpiry, percentile: null };
        }

        const below = allIvs.filter((value) => value <= atmIv).length;
        return { expiry: selectedExpiry, percentile: round((below / allIvs.length) * 100, 2) };
    }

    function calculateAdaptiveGlobalCue(context = {}) {
        const contributions = [];
        const push = (value) => {
            if (Number.isFinite(value)) {
                contributions.push(value);
            }
        };

        push(Number.isFinite(context?.global?.nasdaqFutures?.changePercent) ? Math.max(-1, Math.min(1, context.global.nasdaqFutures.changePercent / 1.2)) : null);
        push(Number.isFinite(context?.global?.sp500Futures?.changePercent) ? Math.max(-1, Math.min(1, context.global.sp500Futures.changePercent / 1.1)) : null);
        push(Number.isFinite(context?.macro?.dxy?.changePercent) ? Math.max(-1, Math.min(1, -(context.macro.dxy.changePercent / 0.5))) : null);
        push(Number.isFinite(context?.macro?.crude?.changePercent) ? Math.max(-1, Math.min(1, -(context.macro.crude.changePercent / 2))) : null);

        if (!contributions.length) {
            return { score: 0, sentiment: "Neutral" };
        }

        const score = round(contributions.reduce((sum, value) => sum + value, 0) / contributions.length, 2);
        return {
            score,
            sentiment: score >= 0.25 ? "Supportive" : score <= -0.25 ? "Risk-off" : "Neutral"
        };
    }

    function getAdaptiveSessionTiming(selectedExpiry) {
        const parts = new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            hour12: false,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const minutes = (Number(map.hour) * 60) + Number(map.minute);
        const expiryDate = selectedExpiry ? parseMarketDate(selectedExpiry) : null;
        const nearExpiryDays = expiryDate
            ? Math.round((new Date(expiryDate).getTime() - new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day))).getTime()) / 86400000)
            : null;
        return {
            lateSession: minutes >= ((14 * 60) + 30),
            nearExpiry: Number.isFinite(nearExpiryDays) ? nearExpiryDays <= 1 : false
        };
    }

    function determineStrength(score) {
        const bands = DECISION_CONFIG.adaptiveModel.scoreBands;
        if (score >= bands.strongBullish) {
            return "Strong Bullish";
        }
        if (score >= bands.mildBullish) {
            return "Mild Bullish";
        }
        if (score <= bands.strongBearish) {
            return "Strong Bearish";
        }
        if (score <= bands.mildBearish) {
            return "Mild Bearish";
        }
        return "No Trade Zone";
    }

    function buildIvSignal(ivPercentile, ivTrendDirection, directionalBias) {
        if (!directionalBias) {
            return 0;
        }

        let quality = 0;
        if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile) {
            quality = -0.95;
        } else if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivHighPercentile) {
            quality = -0.35;
        } else if (Number.isFinite(ivPercentile) && ivPercentile <= 35) {
            quality = 0.35;
        }

        if (ivTrendDirection === "RISING") {
            quality += 0.2;
        } else if (ivTrendDirection === "FALLING") {
            quality -= 0.25;
        }

        return round(clamp(quality, -1, 1) * Math.sign(directionalBias), 2);
    }

    function buildTradeLevels(action, currentPrice, breakLevels, vwapPrice, swings, marketType) {
        const entryLevel = action === "CE" ? breakLevels.bullish : action === "PE" ? breakLevels.bearish : null;
        const fallbackEntry = action === "CE"
            ? (Number.isFinite(vwapPrice) ? vwapPrice : swings?.recentHigh)
            : action === "PE"
                ? (Number.isFinite(vwapPrice) ? vwapPrice : swings?.recentLow)
                : null;
        const chosenEntry = Number.isFinite(entryLevel) ? entryLevel : fallbackEntry;
        const stopLoss = action === "CE"
            ? [vwapPrice, swings?.recentLow].filter((value) => Number.isFinite(value) && value < chosenEntry).sort((a, b) => b - a)[0] ?? null
            : action === "PE"
                ? [vwapPrice, swings?.recentHigh].filter((value) => Number.isFinite(value) && value > chosenEntry).sort((a, b) => a - b)[0] ?? null
                : null;
        const riskDistance = Number.isFinite(chosenEntry) && Number.isFinite(stopLoss) ? Math.abs(chosenEntry - stopLoss) : null;
        const target = action === "CE"
            ? (Number.isFinite(chosenEntry) && Number.isFinite(riskDistance) ? round(chosenEntry + (riskDistance * DECISION_CONFIG.adaptiveModel.riskRewardFloor), 2) : null)
            : action === "PE"
                ? (Number.isFinite(chosenEntry) && Number.isFinite(riskDistance) ? round(chosenEntry - (riskDistance * DECISION_CONFIG.adaptiveModel.riskRewardFloor), 2) : null)
                : null;

        return {
            style: action === "WAIT"
                ? "Wait"
                : marketType.code === "TRENDING" && Number.isFinite(currentPrice) && Number.isFinite(vwapPrice) && Math.abs(currentPrice - vwapPrice) <= Math.abs(currentPrice * 0.0025)
                    ? "Pullback"
                    : "Breakout",
            CE_above: breakLevels.bullish,
            PE_below: breakLevels.bearish,
            entryLevel: chosenEntry,
            stopLoss,
            target,
            riskReward: Number.isFinite(riskDistance) && riskDistance > 0 ? DECISION_CONFIG.adaptiveModel.riskRewardFloor : null
        };
    }

    function buildHold(action, activeTrade, currentPrice, vwapPrice, rsi, sessionTiming) {
        const liveOption = activeTrade?.optionType || action;
        if (!liveOption || liveOption === "WAIT" || !Number.isFinite(currentPrice) || !Number.isFinite(vwapPrice)) {
            return {
                status: "WATCH",
                headline: "Wait for a live position",
                detail: "Hold guidance will activate after a CE or PE trade is acknowledged."
            };
        }

        const pullbackBand = Math.abs(vwapPrice) * 0.0018;
        if (liveOption === "CE") {
            if (currentPrice > vwapPrice && Number(rsi) > 55) {
                return { status: "HOLD", headline: "HOLD CE", detail: "Spot is above VWAP and momentum is intact." };
            }
            if (currentPrice >= (vwapPrice - pullbackBand) && Number(rsi) >= 50) {
                return { status: "HOLD", headline: "CONTINUE HOLD", detail: "Pullback is shallow and VWAP still holds." };
            }
            return { status: "EXIT", headline: "EXIT CE", detail: "VWAP support failed or momentum faded." };
        }

        if (currentPrice < vwapPrice && Number(rsi) < 45) {
            return { status: "HOLD", headline: "HOLD PE", detail: "Spot is below VWAP and downside momentum is intact." };
        }
        if (currentPrice <= (vwapPrice + pullbackBand) && Number(rsi) <= 50) {
            return { status: "HOLD", headline: "CONTINUE HOLD", detail: "Pullback is contained below VWAP." };
        }
        return {
            status: "EXIT",
            headline: "EXIT PE",
            detail: sessionTiming?.lateSession || sessionTiming?.nearExpiry
                ? "VWAP reclaim or theta risk is invalidating the bearish hold."
                : "VWAP reclaim or momentum fade is invalidating the bearish hold."
        };
    }

    function buildRiskWarnings(ivPercentile, ivTrendDirection, sessionTiming, marketType) {
        const warnings = [];
        if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile) {
            warnings.push("IV percentile is above 90. Prefer spreads over naked option buying.");
        } else if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivHighPercentile) {
            warnings.push("IV percentile is elevated. Avoid paying up after the move extends.");
        }
        if (ivTrendDirection === "FALLING") {
            warnings.push("IV is falling. Avoid late premium entries.");
        } else if (ivTrendDirection === "RISING") {
            warnings.push("IV is rising. Early momentum entries are favored.");
        }
        if (sessionTiming?.lateSession) {
            warnings.push("It is after 2:30 PM IST. Reduce holding duration.");
        }
        if (sessionTiming?.nearExpiry) {
            warnings.push("Near-expiry theta risk is high. Avoid long holds.");
        }
        if (marketType.code === "VOLATILE") {
            warnings.push("Volatile regime is active. Use smaller size and cleaner triggers.");
        }
        return warnings;
    }

    function buildAdaptiveStandaloneDecisionEngine(context) {
        const selectedInstrument = context.traderProfile?.preferredInstrument || "NIFTY";
        const selectedSpot = getSelectedSpot(context.india, selectedInstrument);
        const selectedIntraday = getSelectedIntraday(context.intraday, selectedInstrument);
        const selectedPrice = getCurrentPrice(selectedSpot, selectedIntraday);
        const chain = context.internals?.optionChains?.[selectedInstrument] || context.internals?.optionChain || null;
        const trend = detectTrendStructure(selectedIntraday?.series || []);
        const swings = getAdaptiveSwingLevels(selectedIntraday?.series || []);
        const openingRange = selectedIntraday?.openingRange || null;
        const vwapDistancePercent = selectedIntraday?.proxy?.vwapDistancePercent ?? null;
        const vwapPrice = selectedIntraday?.proxy?.vwap ?? null;
        const rsi = calculateAdaptiveRsi(selectedIntraday?.series || []);
        const atrExpansion = calculateAdaptiveAtrExpansion(selectedIntraday?.series || []);
        const maxPain = calculateAdaptiveMaxPain(chain, context.traderProfile);
        const oiBalance = calculateAdaptiveOiBalance(chain, context.traderProfile);
        const ivPercentile = calculateAdaptiveIvPercentile(chain, context.traderProfile);
        const ivTrend = normalizeVixSignal(context.intraday?.instruments?.INDIA_VIX?.price ?? context.india?.indiaVix?.price ?? null) > 0 ? "FALLING" : normalizeVixSignal(context.intraday?.instruments?.INDIA_VIX?.price ?? context.india?.indiaVix?.price ?? null) < 0 ? "RISING" : "FLAT";
        const gapPercent = getGiftGapPercent(context, selectedSpot);
        const vixPrice = context.india?.indiaVix?.price ?? context.intraday?.instruments?.INDIA_VIX?.price ?? null;
        const pcr = chain?.putCallRatio ?? null;
        const breadthRatio = getBreadthRatio(context.internals?.breadth);
        const fiiFlow = getFiiNetFlow(context.internals);
        const globalCue = calculateAdaptiveGlobalCue(context);
        const band = Number(context.traderProfile?.vwapBandPercent) || DECISION_CONFIG.adaptiveModel.vwapTrendBandPercent;
        const vwapSignal = !Number.isFinite(vwapDistancePercent) ? 0 : Math.abs(vwapDistancePercent) <= band ? 0 : round(clamp(vwapDistancePercent / (band * 2.4), -1, 1), 2);
        const oiSignal = Number.isFinite(oiBalance.directionalRatio) ? round(clamp(oiBalance.directionalRatio / 0.45, -1, 1), 2) : 0;
        const marketType = (
            (Number.isFinite(ivPercentile.percentile) && ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.regime.ivPercentileVolatile)
            || (Number.isFinite(atrExpansion) && atrExpansion >= DECISION_CONFIG.adaptiveModel.regime.atrExpansionVolatile)
            || (Number.isFinite(vixPrice) && vixPrice >= 18)
        )
            ? { code: "VOLATILE", label: "Volatile", detail: "IV or ATR expansion is elevated." }
            : (
                Math.abs(trend?.score || 0) >= 0.5
                && Math.abs(vwapSignal || 0) >= 0.55
                && Math.abs(oiSignal || 0) >= DECISION_CONFIG.adaptiveModel.regime.oiDirectionalTrending
                && ((Number.isFinite(rsi) && rsi >= DECISION_CONFIG.adaptiveModel.regime.rsiTrendFloor) || (Number.isFinite(rsi) && rsi <= DECISION_CONFIG.adaptiveModel.regime.rsiTrendCeiling))
            )
                ? { code: "TRENDING", label: "Trending", detail: "Trend structure, VWAP, and OI are aligned." }
                : { code: "SIDEWAYS", label: "Sideways", detail: "Spot is oscillating around VWAP with muted momentum." };
        const weights = adjustWeights(DECISION_CONFIG.adaptiveModel.weights, marketType, globalCue.score);
        const breakLevels = getBreakLevels(openingRange, swings);
        const priceAction = getPriceActionState(selectedPrice, breakLevels, trend);
        const pcrSignal = normalizePcrSignal(pcr);
        const maxPainSignal = normalizeMaxPainSignal(selectedPrice, maxPain.strike);
        const rsiSignal = Number.isFinite(rsi) ? round(clamp((rsi - 50) / 15, -1, 1), 2) : 0;
        const directionalBias = priceAction.breakoutDirection || Math.sign((oiSignal * 0.45) + (vwapSignal * 0.35) + ((trend?.score || 0) * 0.2));
        const ivSignal = buildIvSignal(ivPercentile.percentile, ivTrend, directionalBias);
        const score = round(clamp(
            (pcrSignal * weights.pcr)
            + (maxPainSignal * weights.maxPain)
            + (oiSignal * weights.oiBalance)
            + (vwapSignal * weights.vwap)
            + (rsiSignal * weights.rsi)
            + (ivSignal * weights.iv)
            + (priceAction.signal * weights.priceAction)
            + ((globalCue.score || 0) * DECISION_CONFIG.adaptiveModel.globalOverlayMax),
            DECISION_CONFIG.adaptiveModel.scoreRange.minimum,
            DECISION_CONFIG.adaptiveModel.scoreRange.maximum
        ), 2);
        const confidence = Math.round(Math.abs(score));
        const confidenceTag = confidence > 70 ? "Strong" : confidence >= 40 ? "Moderate" : "Weak";
        const bias = determineBias(score);
        const trap = detectTrap(gapPercent, vixPrice, priceAction.signal);
        const tradeThreshold = Math.max(DECISION_CONFIG.adaptiveModel.tradeThreshold, Number(context.traderProfile?.minimumConfidence) || 0);
        const directionalReady = bias !== "NEUTRAL" && confidence >= tradeThreshold;
        const breakoutReady = priceAction.breakoutDirection === (bias === "UP" ? 1 : bias === "DOWN" ? -1 : 0);
        const pullbackReady = marketType.code === "TRENDING" && Math.abs(priceAction.signal) >= 0.45;
        const action = directionalReady && (breakoutReady || pullbackReady) ? (score > 0 ? "CE" : "PE") : "WAIT";
        const selectedExpiry = getAdaptiveExpiryRows(chain, context.traderProfile).selectedExpiry;
        const sessionTiming = getAdaptiveSessionTiming(selectedExpiry);
        const tradeFramework = buildTradeLevels(action, selectedPrice, breakLevels, vwapPrice, swings, marketType);
        const hold = buildHold(action, context.activeTrade, selectedPrice, vwapPrice, rsi, sessionTiming);
        const warnings = buildRiskWarnings(ivPercentile.percentile, ivTrend, sessionTiming, marketType);
        const riskScore = Math.round(clamp(
            34
            + (marketType.code === "VOLATILE" ? 26 : 0)
            + (trap.label !== "NONE" ? 14 : 0)
            + (ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile ? 18 : ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivHighPercentile ? 10 : 0)
            + (sessionTiming?.lateSession ? 8 : 0)
            - Math.min(18, Math.round(confidence / 6)),
            12,
            95
        ));

        return {
            engineVersion: "adaptive-v2",
            engineLabel: DECISION_CONFIG.engineVersions["adaptive-v2"]?.label || "Adaptive AI v2",
            status: action === "WAIT" ? "WAIT" : "TRADE",
            mode: action === "WAIT" ? "WAIT" : "TRADE",
            bias,
            action,
            direction: bias,
            optionType: action,
            headline: action === "WAIT" ? "WAIT" : action === "CE" ? "BUY CE" : "BUY PE",
            confidence,
            confidenceTag,
            score,
            scoreMeter: {
                minimum: DECISION_CONFIG.adaptiveModel.scoreRange.minimum,
                maximum: DECISION_CONFIG.adaptiveModel.scoreRange.maximum,
                value: score,
                label: determineStrength(score)
            },
            selectedInstrument,
            selectedInstrumentLabel: getInstrumentLabel(selectedInstrument),
            suggestedStrikeStyle: action === "WAIT" ? "ATM" : confidence >= 75 ? "OTM" : confidence >= 55 ? "ATM" : "ITM",
            trap: trap.label,
            trapDetail: trap.detail,
            trapTone: trap.tone,
            summary: action === "WAIT"
                ? `Bias is ${bias}, confidence is ${confidenceTag.toLowerCase()}, and the market is ${marketType.label.toLowerCase()}. Stay in WAIT until the trigger improves.`
                : `${bias} bias with ${confidenceTag.toLowerCase()} confidence in a ${marketType.label.toLowerCase()} regime. Buy ${action} on the ${tradeFramework.style.toLowerCase()} trigger and hold while VWAP stays intact.`,
            trend: {
                regime: trend.regime,
                badge: trend.badge,
                detail: trend.detail
            },
            marketType,
            hold,
            optionsIntelligence: {
                suggestedStructure: action === "WAIT" ? "WAIT" : ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile ? "SPREAD" : action,
                directionalOption: action,
                ivPercentile: ivPercentile.percentile ?? null,
                ivTrend,
                thetaRisk: sessionTiming?.lateSession || sessionTiming?.nearExpiry ? "High" : "Controlled",
                warnings
            },
            opening: {
                title: priceAction.state,
                detail: priceAction.detail,
                score: priceAction.signal,
                gapPercent,
                first15High: openingRange?.high ?? null,
                first15Low: openingRange?.low ?? null
            },
            noTradeZone: {
                active: action === "WAIT",
                reasons: action === "WAIT"
                    ? [
                        confidence < tradeThreshold ? "Score confidence is below the trade threshold." : null,
                        bias === "NEUTRAL" ? "Directional bias is still neutral." : null,
                        priceAction.breakoutDirection === 0 ? "Breakout or pullback confirmation is not clean yet." : null,
                        marketType.code === "SIDEWAYS" ? "Sideways regime is active." : null
                    ].filter(Boolean)
                    : []
            },
            entry: {
                CE_above: tradeFramework.CE_above,
                PE_below: tradeFramework.PE_below
            },
            tradeFramework: {
                entryStyle: tradeFramework.style,
                entryLevel: tradeFramework.entryLevel,
                stopLoss: tradeFramework.stopLoss,
                target: tradeFramework.target,
                riskReward: tradeFramework.riskReward,
                optionSuggestion: ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile ? "SPREAD" : action
            },
            vwap: {
                proxyLabel: selectedIntraday?.proxy?.label || "Proxy",
                price: selectedIntraday?.proxy?.price ?? null,
                vwap: vwapPrice,
                distancePercent: vwapDistancePercent,
                relativeVolume: selectedIntraday?.proxy?.relativeVolume ?? null
            },
            levels: {
                support: chain?.support?.strike ?? swings?.recentLow ?? null,
                resistance: chain?.resistance?.strike ?? swings?.recentHigh ?? null,
                pcr,
                breadthRatio,
                fiiFlow,
                maxPain: maxPain.strike ?? null
            },
            marketContext: {
                selectedPrice,
                selectedChangePercent: selectedSpot?.changePercent ?? selectedIntraday?.sessionChangePercent ?? null,
                first15High: openingRange?.high ?? null,
                first15Low: openingRange?.low ?? null,
                priceSignal: priceAction.signal,
                rsi,
                atrExpansion,
                ivPercentile: ivPercentile.percentile ?? null
            },
            scorecard: {
                weights,
                pcr,
                pcrSignal,
                maxPain: maxPain.strike ?? null,
                maxPainSignal,
                oiDirectionalRatio: oiBalance.directionalRatio ?? null,
                oiSignal,
                vwapDistancePercent,
                vwapSignal,
                rsi,
                rsiSignal,
                ivPercentile: ivPercentile.percentile ?? null,
                ivSignal,
                currentPrice: selectedPrice,
                priceSignal: priceAction.signal,
                first15MinHigh: openingRange?.high ?? null,
                first15MinLow: openingRange?.low ?? null,
                marketType: marketType.code,
                globalCueScore: globalCue.score ?? 0
            },
            riskMeter: {
                score: riskScore,
                level: riskScore >= 72 ? "High" : riskScore >= 46 ? "Moderate" : "Controlled",
                detail: riskScore >= 72 ? "Volatility, timing, or trap risk is elevated. Size down and demand cleaner entries." : riskScore >= 46 ? "The setup is tradable, but execution still needs discipline." : "Execution risk is relatively contained for an intraday attempt."
            },
            components: [
                buildDecisionComponent("pcr", "PCR", pcrSignal, weights.pcr, Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable", "PCR uses Put OI / Call OI."),
                buildDecisionComponent("maxPain", "Max Pain Distance", maxPainSignal, weights.maxPain, Number.isFinite(maxPain.strike) ? formatValue(maxPain.strike) : "Unavailable", "Price above max pain is bullish drift; below max pain is bearish drift."),
                buildDecisionComponent("oiBalance", "OI Buildup", oiSignal, weights.oiBalance, Number.isFinite(oiBalance.directionalRatio) ? formatValue(oiBalance.directionalRatio, 4) : "Unavailable", "Positive OI balance means put-side participation is stronger."),
                buildDecisionComponent("vwap", "VWAP Position", vwapSignal, weights.vwap, Number.isFinite(vwapDistancePercent) ? `${formatValue(vwapDistancePercent)}%` : "Unavailable", "Spot above proxy VWAP is bullish; below proxy VWAP is bearish."),
                buildDecisionComponent("rsi", "RSI", rsiSignal, weights.rsi, Number.isFinite(rsi) ? formatValue(rsi) : "Unavailable", "Momentum above 55 is bullish and below 45 is bearish."),
                buildDecisionComponent("iv", "IV Quality", ivSignal, weights.iv, Number.isFinite(ivPercentile.percentile) ? `IVP ${formatValue(ivPercentile.percentile)} | ${ivTrend}` : "Unavailable", "IV percentile and IV trend decide whether buying premium or using spreads is better."),
                buildDecisionComponent("priceAction", "Price Action", priceAction.signal, weights.priceAction, priceAction.state, priceAction.detail)
            ],
            quick: {
                status: action === "WAIT" ? "WAIT" : "TRADE",
                mode: action === "WAIT" ? "WAIT" : "TRADE",
                direction: bias,
                optionType: action,
                conviction: confidenceTag,
                trap: trap.label
            },
            notes: [
                `Adaptive score ${formatValue(score)} maps to ${determineStrength(score)}.`,
                `Global cue overlay is ${globalCue.sentiment.toLowerCase()} (${formatValue(globalCue.score)}).`,
                `Breadth ratio ${breadthRatio === Number.POSITIVE_INFINITY ? "all advances" : (Number.isFinite(breadthRatio) ? formatValue(breadthRatio) : "Unavailable")}, FII flow ${Number.isFinite(fiiFlow) ? `Rs ${formatValue(fiiFlow)} Cr` : "Unavailable"}, VIX ${Number.isFinite(vixPrice) ? formatValue(vixPrice) : "Unavailable"}, PCR ${Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable"}.`,
                ...warnings.slice(0, 3)
            ],
            learning: {
                trackedPredictions: 0,
                resolvedPredictions: 0,
                accuracyPercent: null,
                wins: 0,
                losses: 0,
                strongestSignals: []
            }
        };
    }

    function buildDecisionEngine(context) {
        const engineVersion = context?.traderProfile?.engineVersion || DECISION_CONFIG.defaultVersion;
        if (engineVersion === "adaptive-v2") {
            return buildAdaptiveStandaloneDecisionEngine(context);
        }
        return decorateInstitutionalDecision(buildInstitutionalDecisionEngine(context), context);
    }

    const DEFAULT_TRADER_PROFILE = {
        capital: 100000,
        riskPercent: 1,
        preferredInstrument: "NIFTY",
        engineVersion: DECISION_CONFIG.defaultVersion,
        sessionPreset: "CUSTOM",
        tradeAggressiveness: "BALANCED",
        strikeStyle: "AUTO",
        expiryPreference: "current",
        lotSize: null,
        minimumConfidence: 64,
        vwapBandPercent: 0.18
    };

    function normalizeChoice(value, allowed, fallback) {
        const normalized = String(value || "").toUpperCase();
        return allowed.includes(normalized) ? normalized : fallback;
    }

    function normalizeExpiryChoice(value) {
        return String(value || "").toLowerCase() === "next" ? "next" : "current";
    }

    function normalizeBoundedNumber(value, fallback, minimum, maximum) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }

        return clamp(numeric, minimum, maximum);
    }

    function normalizeTraderProfile(rawProfile = {}) {
        const capital = positiveNumber(rawProfile.capital) || DEFAULT_TRADER_PROFILE.capital;
        const riskPercent = positiveNumber(rawProfile.riskPercent) || DEFAULT_TRADER_PROFILE.riskPercent;

        return {
            capital,
            riskPercent,
            preferredInstrument: normalizeChoice(rawProfile.preferredInstrument || rawProfile.instrument, ["NIFTY", "BANKNIFTY"], DEFAULT_TRADER_PROFILE.preferredInstrument),
            engineVersion: normalizeChoice(rawProfile.engineVersion, Object.keys(DECISION_CONFIG.engineVersions), DEFAULT_TRADER_PROFILE.engineVersion),
            sessionPreset: normalizeChoice(rawProfile.sessionPreset, ["CUSTOM", "OPEN_DRIVE", "MIDDAY_CHOP", "EXPIRY_FAST", "RISK_OFF"], DEFAULT_TRADER_PROFILE.sessionPreset),
            tradeAggressiveness: normalizeChoice(rawProfile.tradeAggressiveness, ["DEFENSIVE", "BALANCED", "AGGRESSIVE"], DEFAULT_TRADER_PROFILE.tradeAggressiveness),
            strikeStyle: normalizeChoice(rawProfile.strikeStyle, ["AUTO", "ATM", "ITM", "OTM"], DEFAULT_TRADER_PROFILE.strikeStyle),
            expiryPreference: normalizeExpiryChoice(rawProfile.expiryPreference),
            lotSize: positiveNumber(rawProfile.lotSize),
            minimumConfidence: normalizeBoundedNumber(
                rawProfile.minimumConfidence,
                DEFAULT_TRADER_PROFILE.minimumConfidence,
                50,
                90
            ),
            vwapBandPercent: normalizeBoundedNumber(
                rawProfile.vwapBandPercent,
                DEFAULT_TRADER_PROFILE.vwapBandPercent,
                0.05,
                0.5
            )
        };
    }

    function normalizeActiveTrade(rawTrade = {}) {
        const instrument = normalizeChoice(rawTrade.activeInstrument || rawTrade.instrument, ["NIFTY", "BANKNIFTY"], "");
        const optionType = normalizeChoice(rawTrade.activeOptionType || rawTrade.optionType, ["CE", "PE"], "");
        const strikePrice = positiveNumber(rawTrade.activeStrike || rawTrade.strikePrice);
        const expiry = String(rawTrade.activeExpiry || rawTrade.expiry || "");
        const entryPrice = positiveNumber(rawTrade.activeEntry || rawTrade.entryPrice);

        if (!instrument || !optionType || !strikePrice || !expiry || !entryPrice) {
            return null;
        }

        return {
            planId: String(rawTrade.activePlanId || rawTrade.planId || `${instrument}:${expiry}:${strikePrice}:${optionType}`),
            instrument,
            optionType,
            strikePrice,
            expiry,
            entryPrice,
            stopLoss: positiveNumber(rawTrade.activeStop || rawTrade.stopLoss),
            target1: positiveNumber(rawTrade.activeTarget1 || rawTrade.target1),
            target2: positiveNumber(rawTrade.activeTarget2 || rawTrade.target2),
            spotInvalidation: positiveNumber(rawTrade.activeSpotInvalidation || rawTrade.spotInvalidation),
            entryConfidence: positiveNumber(rawTrade.activeEntryConfidence || rawTrade.entryConfidence),
            lastConfidence: positiveNumber(rawTrade.activeLastConfidence || rawTrade.lastConfidence),
            acknowledgedAt: rawTrade.activeTakenAt || rawTrade.acknowledgedAt || null,
            lotSize: positiveNumber(rawTrade.activeLotSize || rawTrade.lotSize),
            maxLots: positiveNumber(rawTrade.activeMaxLots || rawTrade.maxLots)
        };
    }

    function getDecisionSignal(payload) {
        if (payload?.decision && payload.decision.status !== "TRADE") {
            return {
                optionType: null,
                quickOptions: "WAIT",
                quickDirection: "WAIT",
                confidence: payload.decision.confidence || 0
            };
        }

        if (payload?.decision?.action === "CE" || payload?.decision?.direction === "CE") {
            return {
                optionType: "CE",
                quickOptions: "CALLS",
                quickDirection: payload?.decision?.bias || "UP",
                confidence: payload.decision.confidence || 0
            };
        }

        if (payload?.decision?.action === "PE" || payload?.decision?.direction === "PE") {
            return {
                optionType: "PE",
                quickOptions: "PUTS",
                quickDirection: payload?.decision?.bias || "DOWN",
                confidence: payload.decision.confidence || 0
            };
        }

        const quickOption = payload?.signal?.quick?.options || "WAIT";
        if (quickOption === "CALLS") {
            return {
                optionType: "CE",
                quickOptions: quickOption,
                quickDirection: payload?.signal?.quick?.direction || "UP",
                confidence: payload?.signal?.confidence || 0
            };
        }

        if (quickOption === "PUTS") {
            return {
                optionType: "PE",
                quickOptions: quickOption,
                quickDirection: payload?.signal?.quick?.direction || "DOWN",
                confidence: payload?.signal?.confidence || 0
            };
        }

        return {
            optionType: null,
            quickOptions: "WAIT",
            quickDirection: "WAIT",
            confidence: payload?.decision?.confidence || payload?.signal?.confidence || 0
        };
    }

    function optionBiasFromPayload(payload) {
        const decisionSignal = getDecisionSignal(payload);
        if (decisionSignal.optionType === "CE") {
            return "CE";
        }
        if (decisionSignal.optionType === "PE") {
            return "PE";
        }
        return null;
    }

    function getInstrumentLabel(symbol) {
        return symbol === "BANKNIFTY" ? "BANK NIFTY" : "NIFTY";
    }

    function getUnderlyingInstrument(payload, symbol) {
        return symbol === "BANKNIFTY" ? payload.india.bankNifty : payload.india.nifty;
    }

    function getOptionChain(payload, symbol) {
        return payload.internals.optionChains?.[symbol] || null;
    }

    function getLeg(row, optionType) {
        return optionType === "CE" ? row.CE : row.PE;
    }

    function findNearestStrikeIndex(rows, underlyingValue) {
        if (!rows.length || !Number.isFinite(underlyingValue)) {
            return 0;
        }

        let bestIndex = 0;
        let bestDistance = Infinity;
        rows.forEach((row, index) => {
            const distance = Math.abs(row.strikePrice - underlyingValue);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });
        return bestIndex;
    }

    function buildCandidateOrder(baseIndex, total) {
        const order = [];
        for (let offset = 0; offset < total; offset += 1) {
            const lower = baseIndex - offset;
            const higher = baseIndex + offset;
            if (lower >= 0) {
                order.push(lower);
            }
            if (offset > 0 && higher < total) {
                order.push(higher);
            }
        }
        return order;
    }

    function isLiquidLeg(leg) {
        if (!leg || !Number.isFinite(leg.lastPrice) || leg.lastPrice <= 0) {
            return false;
        }

        return (Number(leg.totalTradedVolume || 0) > 0)
            || (Number(leg.openInterest || 0) > 0)
            || (Number(leg.buyPrice1 || 0) > 0)
            || (Number(leg.sellPrice1 || 0) > 0);
    }

    function chooseContract(chain, optionType, strikeStyle, underlyingValue, selectedExpiry) {
        const rows = (chain?.contracts || [])
            .filter((row) => row.expiryDate === selectedExpiry)
            .sort((left, right) => left.strikePrice - right.strikePrice);

        if (!rows.length) {
            return null;
        }

        const atmIndex = findNearestStrikeIndex(rows, underlyingValue);
        const desiredShift = strikeStyle === "ATM"
            ? 0
            : optionType === "CE"
                ? (strikeStyle === "ITM" ? -1 : 1)
                : (strikeStyle === "ITM" ? 1 : -1);
        const desiredIndex = Math.min(rows.length - 1, Math.max(0, atmIndex + desiredShift));
        const searchOrder = buildCandidateOrder(desiredIndex, rows.length);

        for (const index of searchOrder) {
            const row = rows[index];
            const leg = getLeg(row, optionType);
            if (isLiquidLeg(leg)) {
                return { row, leg };
            }
        }

        return null;
    }

    function buildPremiumReference(leg) {
        const buy = positiveNumber(leg?.buyPrice1);
        const sell = positiveNumber(leg?.sellPrice1);

        if (buy && sell && sell >= buy) {
            return {
                reference: round((buy + sell) / 2, 2),
                zoneLow: round(buy, 2),
                zoneHigh: round(sell, 2),
                zoneLabel: `Rs ${formatValue(buy)} to Rs ${formatValue(sell)}`
            };
        }

        const lastPrice = positiveNumber(leg?.lastPrice);
        if (!lastPrice) {
            return null;
        }

        const buffer = lastPrice * 0.02;
        return {
            reference: round(lastPrice, 2),
            zoneLow: round(lastPrice - buffer, 2),
            zoneHigh: round(lastPrice + buffer, 2),
            zoneLabel: `Around Rs ${formatValue(lastPrice)}`
        };
    }

    function buildRiskLevels(referencePrice, signal, decision, chain, optionType, underlyingValue, vixPrice) {
        if (!Number.isFinite(referencePrice)) {
            return null;
        }

        const confidence = Number(signal?.confidence || 0);
        const vix = positiveNumber(vixPrice);
        const stopLossPct = vix && vix >= 18 ? 0.2 : confidence >= 70 ? 0.16 : 0.14;
        const target1Pct = confidence >= 70 ? 0.16 : 0.12;
        const target2Pct = confidence >= 70 ? 0.28 : 0.22;
        const stepSize = positiveNumber(chain?.stepSize) || 1;
        const ceEntry = positiveNumber(decision?.entry?.CE_above);
        const peEntry = positiveNumber(decision?.entry?.PE_below);

        return {
            stopLoss: round(referencePrice * (1 - stopLossPct), 2),
            target1: round(referencePrice * (1 + target1Pct), 2),
            target2: round(referencePrice * (1 + target2Pct), 2),
            spotInvalidation: optionType === "CE"
                ? round(peEntry || chain?.support?.strike || (underlyingValue - stepSize), 2)
                : round(ceEntry || chain?.resistance?.strike || (underlyingValue + stepSize), 2),
            spotTrigger: optionType === "CE"
                ? round(ceEntry || Math.max(chain?.support?.strike || underlyingValue, underlyingValue), 2)
                : round(peEntry || Math.min(chain?.resistance?.strike || underlyingValue, underlyingValue), 2)
        };
    }

    function buildSizing(profile, entryReference, stopLoss) {
        const riskBudget = round((profile.capital * profile.riskPercent) / 100, 2);
        const perUnitRisk = Number.isFinite(entryReference) && Number.isFinite(stopLoss) ? round(entryReference - stopLoss, 2) : null;
        const maxContracts = perUnitRisk && perUnitRisk > 0 ? Math.floor(riskBudget / perUnitRisk) : null;
        const maxLots = profile.lotSize && maxContracts !== null ? Math.floor(maxContracts / profile.lotSize) : null;
        const perLotRisk = profile.lotSize && perUnitRisk ? round(perUnitRisk * profile.lotSize, 2) : null;

        return {
            capital: profile.capital,
            riskPercent: profile.riskPercent,
            riskBudget,
            lotSize: profile.lotSize,
            perUnitRisk,
            perLotRisk,
            maxContracts,
            maxLots,
            requiresLotSize: !profile.lotSize,
            note: profile.lotSize
                ? (maxLots > 0
                    ? `Risk budget supports up to ${maxLots} lot(s) at the current stop distance.`
                    : "Risk budget is too small for one full lot at the current stop distance.")
                : "Enter your broker lot size to convert the risk budget into lots."
        };
    }

    function buildContractLabel(symbol, expiry, strikePrice, optionType) {
        return `${getInstrumentLabel(symbol)} ${expiry} ${strikePrice} ${optionType}`;
    }

    function resolveStrikeStyle(profile, payload) {
        if (profile.strikeStyle && profile.strikeStyle !== "AUTO") {
            return profile.strikeStyle;
        }

        if (profile.tradeAggressiveness === "DEFENSIVE") {
            return payload?.decision?.action === "WAIT" ? "ATM" : "ITM";
        }
        if (profile.tradeAggressiveness === "AGGRESSIVE" && Number(payload?.decision?.confidence || 0) >= 70) {
            return "OTM";
        }

        return payload?.decision?.suggestedStrikeStyle || "ATM";
    }

    function normalizeEffectiveProfile(profile, chain) {
        return {
            ...profile,
            lotSize: profile.lotSize || positiveNumber(chain?.lotSize)
        };
    }

    function resolveTradeSetup(payload, profile) {
        const decisionSignal = getDecisionSignal(payload);
        const optionType = optionBiasFromPayload(payload);
        const instrument = profile.preferredInstrument;
        const chain = getOptionChain(payload, instrument);
        const underlyingInstrument = getUnderlyingInstrument(payload, instrument);
        const underlyingValue = positiveNumber(chain?.underlyingValue)
            || positiveNumber(payload?.decision?.marketContext?.selectedPrice)
            || positiveNumber(underlyingInstrument?.price);
        const effectiveProfile = normalizeEffectiveProfile(profile, chain);
        const strikeStyle = resolveStrikeStyle(profile, payload);

        if (!optionType) {
            return {
                actionable: false,
                optionType,
                instrument,
                chain,
                underlyingValue,
                effectiveProfile,
                reason: "The live signal does not support a clean CALLS or PUTS setup yet.",
                title: "No options trade right now",
                notation: "WAIT",
                sourceUrl: chain?.sourceUrl || null
            };
        }

        if (!chain || !Array.isArray(chain.contracts) || !chain.contracts.length || !Number.isFinite(underlyingValue)) {
            return {
                actionable: false,
                optionType,
                instrument,
                chain,
                underlyingValue,
                effectiveProfile,
                reason: `Live ${getInstrumentLabel(instrument)} option data is unavailable right now.`,
                title: "Trade plan unavailable",
                notation: "WAIT",
                sourceUrl: chain?.sourceUrl || null
            };
        }

        const shouldForceNextExpiry = (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") && chain.expiries?.[1];
        let selectedExpiry = shouldForceNextExpiry
            ? chain.expiries[1]
            : (profile.expiryPreference === "next" && chain.expiries?.[1] ? chain.expiries[1] : null);
        selectedExpiry = selectedExpiry || chain.expiries?.[0] || chain.contracts[0]?.expiryDate || null;

        let selected = chooseContract(chain, optionType, strikeStyle, underlyingValue, selectedExpiry);
        if (!selected) {
            return {
                actionable: false,
                optionType,
                instrument,
                chain,
                underlyingValue,
                effectiveProfile,
                reason: "A liquid live contract could not be found for the selected profile.",
                title: "Trade plan unavailable",
                notation: "WAIT",
                sourceUrl: chain?.sourceUrl || null
            };
        }

        let premium = buildPremiumReference(selected.leg);
        if (premium?.reference && premium.reference < 1 && chain.expiries?.[1] && selectedExpiry !== chain.expiries[1]) {
            const fallbackSelection = chooseContract(chain, optionType, strikeStyle, underlyingValue, chain.expiries[1]);
            const fallbackPremium = buildPremiumReference(fallbackSelection?.leg);
            if (fallbackSelection && fallbackPremium?.reference && fallbackPremium.reference >= premium.reference) {
                selectedExpiry = chain.expiries[1];
                selected = fallbackSelection;
                premium = fallbackPremium;
            }
        }

        const riskLevels = buildRiskLevels(
            premium?.reference,
            {
                confidence: decisionSignal.confidence
            },
            payload.decision,
            chain,
            optionType,
            underlyingValue,
            payload.india?.indiaVix?.price
        );
        const sizing = buildSizing(effectiveProfile, premium?.reference, riskLevels?.stopLoss);

        return {
            actionable: true,
            optionType,
            instrument,
            chain,
            underlyingValue,
            selectedExpiry,
            selected,
            premium,
            riskLevels,
            sizing,
            effectiveProfile: {
                ...effectiveProfile,
                strikeStyle
            },
            quickOptions: decisionSignal.quickOptions,
            sessionLabel: payload.session?.label || "Market"
        };
    }

    function chooseSpreadShortLeg(chain, selectedExpiry, optionType, longRow, widthSteps = 1) {
        const rows = (chain?.contracts || [])
            .filter((row) => row.expiryDate === selectedExpiry)
            .sort((left, right) => left.strikePrice - right.strikePrice);

        if (!rows.length) {
            return null;
        }

        const longIndex = rows.findIndex((row) => Number(row.strikePrice) === Number(longRow?.strikePrice));
        if (longIndex < 0) {
            return null;
        }

        const direction = optionType === "CE" ? 1 : -1;
        for (let offset = widthSteps; offset <= widthSteps + 2; offset += 1) {
            const targetIndex = longIndex + (direction * offset);
            if (targetIndex < 0 || targetIndex >= rows.length) {
                continue;
            }

            const row = rows[targetIndex];
            const leg = getLeg(row, optionType);
            if (isLiquidLeg(leg)) {
                return { row, leg, widthSteps: offset };
            }
        }

        return null;
    }

    function shouldPreferDebitSpread(payload, premiumReference, underlyingValue, profile = {}) {
        const confidence = Number(payload.decision?.confidence || payload.signal?.confidence || 0);
        const vix = positiveNumber(payload.india?.indiaVix?.price) || 0;
        const sessionMode = String(payload.session?.mode || "").toUpperCase();
        const preferredStructure = String(payload?.decision?.optionsIntelligence?.suggestedStructure || "").toUpperCase();
        const aggressiveness = String(profile.tradeAggressiveness || "BALANCED").toUpperCase();
        const premiumRatio = premiumReference && underlyingValue ? premiumReference / underlyingValue : 0;

        return preferredStructure === "SPREAD"
            || sessionMode === "PREOPEN"
            || sessionMode === "POSTCLOSE"
            || sessionMode === "CLOSED"
            || aggressiveness === "DEFENSIVE"
            || vix >= 16
            || confidence < (aggressiveness === "AGGRESSIVE" ? 66 : 72)
            || premiumRatio >= 0.009;
    }

    function calculateLongBreakeven(strikePrice, optionType, premiumReference) {
        if (!Number.isFinite(strikePrice) || !Number.isFinite(premiumReference)) {
            return null;
        }

        return optionType === "CE"
            ? round(strikePrice + premiumReference, 2)
            : round(strikePrice - premiumReference, 2);
    }

    function formatPlaybookValue(value, isCurrency = false) {
        if (value === "Open") {
            return "Open";
        }
        if (!Number.isFinite(value)) {
            return "Unavailable";
        }
        return isCurrency ? `Rs ${formatValue(value)}` : formatValue(value);
    }

    function buildLongOptionPlaybook(payload, setup) {
        const isCall = setup.optionType === "CE";
        const premiumReference = setup.premium?.reference;
        const breakeven = calculateLongBreakeven(setup.selected.row.strikePrice, setup.optionType, premiumReference);
        const confidence = Number(payload.decision?.confidence || payload.signal?.confidence || 0);
        const vix = positiveNumber(payload.india?.indiaVix?.price);

        return {
            actionable: true,
            tone: isCall ? "bullish" : "bearish",
            title: isCall ? "Long Call" : "Long Put",
            badge: "Single-leg buy",
            summary: isCall
                ? "Momentum and controlled volatility support carrying a simple long-call structure."
                : "Directional weakness and manageable volatility support a simple long-put structure.",
            structureNote: isCall
                ? "Choose the cleaner outright call when conviction is high and premium risk is still acceptable."
                : "Choose the cleaner outright put when downside conviction is high and premium risk is still acceptable.",
            legs: [
                {
                    action: "Buy",
                    label: buildContractLabel(setup.instrument, setup.selectedExpiry, setup.selected.row.strikePrice, setup.optionType),
                    premium: premiumReference,
                    note: `Use the live entry zone ${setup.premium.zoneLabel}.`
                }
            ],
            metrics: [
                { label: "Entry cost", value: formatPlaybookValue(premiumReference, true) },
                { label: "Breakeven", value: formatPlaybookValue(breakeven) },
                { label: "Max loss", value: formatPlaybookValue(premiumReference, true) },
                { label: "Max reward", value: "Open" }
            ],
            fitChecklist: [
                `Confidence is ${confidence}% and the dashboard bias still says ${setup.quickOptions}.`,
                `INDIA VIX ${vix ? `near ${formatValue(vix)}` : "is unavailable but not blocking the setup"} does not force a defensive structure.`,
                "Use the outright buy only if the premium stays near the entry zone and the opening confirmation holds."
            ],
            avoidChecklist: [
                "Skip the long-option buy if the premium spikes sharply before entry.",
                "Reduce size or switch to a spread if implied volatility expands further after the open.",
                "Avoid carrying the position if the signal flips to WAIT or the spot invalidation breaks."
            ],
            sourceUrl: setup.chain?.sourceUrl || null
        };
    }

    function buildDebitSpreadPlaybook(payload, setup) {
        const preferredWidth = Number(payload.decision?.confidence || payload.signal?.confidence || 0) >= 78 ? 2 : 1;
        const shortSelection = chooseSpreadShortLeg(
            setup.chain,
            setup.selectedExpiry,
            setup.optionType,
            setup.selected.row,
            preferredWidth
        );

        if (!shortSelection) {
            return buildLongOptionPlaybook(payload, setup);
        }

        const shortPremium = buildPremiumReference(shortSelection.leg);
        const longPremium = setup.premium?.reference;
        const shortReference = shortPremium?.reference;
        const netDebit = Number.isFinite(longPremium) && Number.isFinite(shortReference)
            ? round(longPremium - shortReference, 2)
            : null;
        const width = round(Math.abs(shortSelection.row.strikePrice - setup.selected.row.strikePrice), 2);

        if (!Number.isFinite(netDebit) || netDebit <= 0 || !Number.isFinite(width) || width <= netDebit) {
            return buildLongOptionPlaybook(payload, setup);
        }

        const isCall = setup.optionType === "CE";
        const breakeven = isCall
            ? round(setup.selected.row.strikePrice + netDebit, 2)
            : round(setup.selected.row.strikePrice - netDebit, 2);
        const maxReward = round(width - netDebit, 2);
        const rewardRisk = netDebit > 0 ? round(maxReward / netDebit, 2) : null;
        const vix = positiveNumber(payload.india?.indiaVix?.price);

        return {
            actionable: true,
            tone: isCall ? "bullish" : "bearish",
            title: isCall ? "Bull Call Spread" : "Bear Put Spread",
            badge: "Defined-risk debit spread",
            summary: isCall
                ? "Premium control matters here, so the bullish view is better expressed with a call spread."
                : "Premium control matters here, so the bearish view is better expressed with a put spread.",
            structureNote: isCall
                ? "The short call trims entry cost and theta burn while keeping upside to the next strike zone."
                : "The short put trims entry cost and theta burn while keeping downside exposure to the next strike zone.",
            legs: [
                {
                    action: "Buy",
                    label: buildContractLabel(setup.instrument, setup.selectedExpiry, setup.selected.row.strikePrice, setup.optionType),
                    premium: longPremium,
                    note: `Use the live entry zone ${setup.premium.zoneLabel}.`
                },
                {
                    action: "Sell",
                    label: buildContractLabel(setup.instrument, setup.selectedExpiry, shortSelection.row.strikePrice, setup.optionType),
                    premium: shortReference,
                    note: `Farther ${isCall ? "OTM" : "lower-strike"} hedge leg to cap cost.`
                }
            ],
            metrics: [
                { label: "Net debit", value: formatPlaybookValue(netDebit, true) },
                { label: "Breakeven", value: formatPlaybookValue(breakeven) },
                { label: "Max loss", value: formatPlaybookValue(netDebit, true) },
                { label: "Max reward", value: formatPlaybookValue(maxReward, true) },
                { label: "Reward / risk", value: Number.isFinite(rewardRisk) ? `${formatValue(rewardRisk)}x` : "Unavailable" }
            ],
            fitChecklist: [
                `INDIA VIX ${vix ? `around ${formatValue(vix)}` : "is not low enough"} favors defined risk over a naked premium buy.`,
                "The spread reduces entry cost and softens theta / IV pressure versus a single-leg option.",
                "This works best when you expect a move toward the next strike zone, not an unlimited trend day."
            ],
            avoidChecklist: [
                "Avoid the spread if the short leg is illiquid or the bid/ask widens sharply.",
                "Do not use it when you expect an outsized breakout beyond the sold strike too quickly.",
                "Stand aside if the dashboard loses the directional bias before entry."
            ],
            sourceUrl: setup.chain?.sourceUrl || null
        };
    }

    function buildOptionsPlaybook(payload, profile) {
        const setup = resolveTradeSetup(payload, profile);
        const pcr = setup.chain?.putCallRatio;
        const confidence = Number(payload.decision?.confidence || payload.signal?.confidence || 0);
        const vix = positiveNumber(payload.india?.indiaVix?.price);

        if (!setup.actionable) {
            return {
                actionable: false,
                tone: "wait",
                title: "Wait / No Trade",
                badge: "Capital preservation",
                summary: setup.reason,
                structureNote: "The app is intentionally standing aside until bias, volatility, and live chain quality line up better.",
                legs: [],
                metrics: [
                    { label: "Bias", value: payload.decision?.direction || payload.signal?.cePeBias || "Unavailable" },
                    { label: "Confidence", value: `${confidence}%` },
                    { label: "VIX", value: Number.isFinite(vix) ? formatValue(vix) : "Unavailable" },
                    { label: "PCR", value: Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable" }
                ],
                fitChecklist: [
                    "Wait for a cleaner CE or PE bias before committing premium.",
                    "Let feed coverage recover if the live option chain or internals are degraded.",
                    "Preserve capital when the setup is mixed instead of forcing a trade."
                ],
                avoidChecklist: [
                    "Avoid revenge trades when the dashboard still says WAIT.",
                    "Do not buy options only because the market moved without your setup.",
                    "Skip entries when VIX is rising but the direction is still mixed."
                ],
                sourceUrl: setup.sourceUrl || null
            };
        }

        return shouldPreferDebitSpread(payload, setup.premium?.reference, setup.underlyingValue, profile)
            ? buildDebitSpreadPlaybook(payload, setup)
            : buildLongOptionPlaybook(payload, setup);
    }

    function buildTradePlan(payload, profile) {
        const setup = resolveTradeSetup(payload, profile);

        if (!setup.actionable) {
            return {
                actionable: false,
                notation: setup.notation,
                title: setup.title,
                reason: setup.reason,
                profile: setup.effectiveProfile,
                sourceUrl: setup.sourceUrl
            };
        }

        const planId = `${setup.instrument}:${setup.selectedExpiry}:${setup.selected.row.strikePrice}:${setup.optionType}`;
        const sideLabel = setup.optionType === "CE" ? "BUY CALL" : "BUY PUT";
        const entrySpotText = setup.optionType === "CE"
            ? `${getInstrumentLabel(setup.instrument)} should hold above ${formatValue(setup.riskLevels.spotTrigger)}`
            : `${getInstrumentLabel(setup.instrument)} should stay below ${formatValue(setup.riskLevels.spotTrigger)}`;
        const invalidationText = setup.optionType === "CE"
            ? `Exit if spot breaks below ${formatValue(setup.riskLevels.spotInvalidation)} or premium loses ${formatValue(setup.riskLevels.stopLoss)}.`
            : `Exit if spot moves above ${formatValue(setup.riskLevels.spotInvalidation)} or premium loses ${formatValue(setup.riskLevels.stopLoss)}.`;

        return {
            actionable: true,
            planId,
            notation: sideLabel,
            direction: setup.quickOptions,
            instrument: setup.instrument,
            instrumentLabel: getInstrumentLabel(setup.instrument),
            expiry: setup.selectedExpiry,
            sourceUrl: setup.chain.sourceUrl || null,
            title: `${sideLabel} ${getInstrumentLabel(setup.instrument)}`,
            reason: payload.decision?.summary
                ? `${payload.decision.summary} Live ${getInstrumentLabel(setup.instrument)} option liquidity confirms a ${setup.quickOptions} setup.`
                : `${setup.sessionLabel} plan based on live ${getInstrumentLabel(setup.instrument)} option-chain liquidity and the current ${setup.quickOptions} bias.`,
            contract: {
                symbol: setup.instrument,
                label: buildContractLabel(setup.instrument, setup.selectedExpiry, setup.selected.row.strikePrice, setup.optionType),
                strikePrice: setup.selected.row.strikePrice,
                expiry: setup.selectedExpiry,
                optionType: setup.optionType,
                identifier: setup.selected.leg.identifier,
                lastPrice: setup.selected.leg.lastPrice,
                buyPrice1: setup.selected.leg.buyPrice1,
                sellPrice1: setup.selected.leg.sellPrice1,
                openInterest: setup.selected.leg.openInterest,
                totalTradedVolume: setup.selected.leg.totalTradedVolume,
                impliedVolatility: setup.selected.leg.impliedVolatility,
                underlyingValue: setup.underlyingValue
            },
            entry: {
                premiumReference: setup.premium.reference,
                zoneLow: setup.premium.zoneLow,
                zoneHigh: setup.premium.zoneHigh,
                zoneLabel: setup.premium.zoneLabel,
                spotTrigger: setup.riskLevels.spotTrigger,
                triggerText: `Enter only if ${entrySpotText} and the dashboard still says ${setup.quickOptions}.`
            },
            exit: {
                stopLoss: setup.riskLevels.stopLoss,
                target1: setup.riskLevels.target1,
                target2: setup.riskLevels.target2,
                spotInvalidation: setup.riskLevels.spotInvalidation,
                invalidationText,
                trailText: `After target 1, trail the stop to entry (${formatValue(setup.premium.reference)}) and protect open profit.`,
                timeExitText: "If the move does not follow through by late afternoon or the session flips risk-off, close the position."
            },
            sizing: setup.sizing,
            checklist: [
                `Decision engine says ${payload.decision?.status || "WAIT"} with ${payload.decision?.confidence || 0}% confidence.`,
                `Use ${setup.effectiveProfile.strikeStyle} strike selection with ${setup.effectiveProfile.expiryPreference} expiry.`,
                `Profile preset is ${setup.effectiveProfile.sessionPreset} with ${setup.effectiveProfile.tradeAggressiveness.toLowerCase()} aggressiveness.`,
                "Do not take the trade if the premium is outside the entry zone or live spread widens sharply."
            ]
        };
    }

    function monitorActiveTrade(payload, activeTrade) {
        if (!activeTrade) {
            return null;
        }

        const chain = getOptionChain(payload, activeTrade.instrument);
        if (!chain || !Array.isArray(chain.contracts)) {
            return {
                action: "CHECK",
                headline: "Monitor unavailable",
                detail: "Live option-chain data is unavailable, so the app cannot confirm hold or exit right now.",
                sourceUrl: chain?.sourceUrl || null
            };
        }

        const row = chain.contracts.find((item) => item.expiryDate === activeTrade.expiry && Number(item.strikePrice) === Number(activeTrade.strikePrice));
        const leg = row ? getLeg(row, activeTrade.optionType) : null;

        if (!leg || !Number.isFinite(leg.lastPrice)) {
            return {
                action: "CHECK",
                headline: "Contract not found",
                detail: "The tracked contract is not present in the current live chain. Recheck the trade manually.",
                sourceUrl: chain.sourceUrl || null
            };
        }

        const currentPremium = positiveNumber(leg.sellPrice1) || positiveNumber(leg.lastPrice) || positiveNumber(leg.buyPrice1);
        const underlyingValue = positiveNumber(chain.underlyingValue) || positiveNumber(getUnderlyingInstrument(payload, activeTrade.instrument)?.price);
        const pnlPercent = currentPremium && activeTrade.entryPrice
            ? round(((currentPremium - activeTrade.entryPrice) / activeTrade.entryPrice) * 100, 2)
            : null;
        const expectedQuick = activeTrade.optionType === "CE" ? "CALLS" : "PUTS";
        const liveQuick = getDecisionSignal(payload).quickOptions;
        const currentConfidence = Number(payload?.decision?.confidence || 0);
        const previousConfidence = Number(activeTrade.lastConfidence || activeTrade.entryConfidence || currentConfidence);
        const entryConfidence = Number(activeTrade.entryConfidence || previousConfidence || currentConfidence);
        const confidenceTrend = Number.isFinite(previousConfidence)
            ? round(currentConfidence - previousConfidence, 0)
            : null;
        const confidenceFromEntry = Number.isFinite(entryConfidence)
            ? round(currentConfidence - entryConfidence, 0)
            : null;
        const premiumTrend = Number.isFinite(pnlPercent)
            ? (pnlPercent >= 12 ? "EXPANDING" : pnlPercent <= -8 ? "CONTRACTING" : "STABLE")
            : "STABLE";
        const lateSession = payload.session?.mode === "POSTCLOSE"
            || payload.session?.mode === "CLOSED"
            || payload.decision?.optionsIntelligence?.thetaRisk === "High";
        const holdSignal = String(payload?.decision?.hold?.status || "").toUpperCase();
        const feedBlocked = Boolean(payload?.feedHealth?.blocksTradeSignals);

        let action = "HOLD";
        let headline = "Hold the trade";
        let detail = "Signal, premium, and timing still support the trade plan.";

        if (feedBlocked) {
            action = "INVALIDATED";
            headline = "Critical data is stale";
            detail = "The app cannot trust the live trade state until the critical feeds refresh.";
        } else if (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") {
            action = "FULL_EXIT";
            headline = "Exit before session end";
            detail = "The market session is over or closing. Do not carry this as an intraday options plan.";
        } else if (
            Number.isFinite(activeTrade.spotInvalidation)
            && Number.isFinite(underlyingValue)
            && ((activeTrade.optionType === "CE" && underlyingValue <= activeTrade.spotInvalidation)
                || (activeTrade.optionType === "PE" && underlyingValue >= activeTrade.spotInvalidation))
        ) {
            action = "FULL_EXIT";
            headline = "Spot invalidation broke";
            detail = "Underlying spot has moved through the invalidation level from the original plan.";
        } else if (Number.isFinite(activeTrade.stopLoss) && currentPremium <= activeTrade.stopLoss) {
            action = "FULL_EXIT";
            headline = "Premium stop-loss hit";
            detail = "Current option premium is at or below the stored stop-loss.";
        } else if (liveQuick !== expectedQuick) {
            action = "INVALIDATED";
            headline = "Signal flipped against the trade";
            detail = `The dashboard now favors ${liveQuick || "WAIT"} instead of ${expectedQuick}.`;
        } else if (Number.isFinite(activeTrade.target2) && currentPremium >= activeTrade.target2) {
            action = "FULL_EXIT";
            headline = "Target 2 reached";
            detail = "Book the remaining position and reset for the next setup.";
        } else if (Number.isFinite(activeTrade.target1) && currentPremium >= activeTrade.target1) {
            action = "PARTIAL_EXIT";
            headline = "Book partial, then trail";
            detail = "First target is met. Book partial and trail the rest at entry or better.";
        } else if (holdSignal === "EXIT" && Number.isFinite(pnlPercent) && pnlPercent > 0) {
            action = "TRAIL";
            headline = "Trail aggressively";
            detail = "The hold logic is weakening, so tighten stops and protect the open gain.";
        } else if (holdSignal === "EXIT") {
            action = "FULL_EXIT";
            headline = "Full exit on structure break";
            detail = payload?.decision?.hold?.detail || "Structure no longer supports the trade.";
        } else if ((Number.isFinite(confidenceTrend) && confidenceTrend <= -15) || (Number.isFinite(confidenceFromEntry) && confidenceFromEntry <= -20)) {
            action = premiumTrend === "EXPANDING" ? "TRAIL" : "FULL_EXIT";
            headline = premiumTrend === "EXPANDING" ? "Confidence fell, trail now" : "Confidence collapsed";
            detail = premiumTrend === "EXPANDING"
                ? "Keep the trade only with a tighter trailing stop because confidence dropped sharply."
                : "Confidence and premium both weakened. Exit and wait for a cleaner reset.";
        } else if (lateSession && Number.isFinite(pnlPercent) && pnlPercent > 4) {
            action = "TRAIL";
            headline = "Time-based trail";
            detail = "Late-session theta risk is rising. Trail the stop and reduce holding time.";
        } else if (premiumTrend === "CONTRACTING" && Number.isFinite(pnlPercent) && pnlPercent < 0) {
            action = "TRAIL";
            headline = "Premium is contracting";
            detail = "The option premium is shrinking faster than expected. Tighten risk immediately.";
        } else if (liveQuick === expectedQuick && (pnlPercent === null || pnlPercent >= -6)) {
            action = "HOLD";
            headline = "Hold while bias is intact";
            detail = "The contract remains above stop, confidence is stable, and the live bias still supports the trade.";
        }

        return {
            action,
            label: action === "PARTIAL_EXIT"
                ? "PARTIAL EXIT"
                : action === "FULL_EXIT"
                    ? "FULL EXIT"
                    : action,
            headline,
            detail,
            planId: activeTrade.planId,
            contractLabel: buildContractLabel(activeTrade.instrument, activeTrade.expiry, activeTrade.strikePrice, activeTrade.optionType),
            currentPremium,
            underlyingValue,
            pnlPercent,
            currentConfidence,
            confidenceTrend,
            confidenceFromEntry,
            premiumTrend,
            timePressure: lateSession ? "High" : "Normal",
            sourceUrl: chain.sourceUrl || null,
            alertKey: `${activeTrade.planId}:${action}:${headline}:${round(currentPremium || 0, 2)}`
        };
    }

    function formatMacroNarrativeValue(instrument, suffix = "") {
        return Number.isFinite(instrument?.price) ? `${formatValue(instrument.price)}${suffix}` : "Unavailable";
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
                sourceUrl: SOURCE_LINKS.nseFiiDii
            },
            macroSummary: `DXY ${formatMacroNarrativeValue(payload.macro.dxy)}, US10Y ${formatMacroNarrativeValue(payload.macro.us10y, "%")}, Brent ${formatMacroNarrativeValue(payload.macro.brent)}.`
        };
    }

    function withFallbackInstrument(instrument, definition, reason) {
        return instrument || createUnavailableInstrument(definition, reason);
    }

    async function loadMarketData(traderProfile, externalSignal) {
        const [nseSnapshot, yahooMarkets] = await Promise.all([
            fetchNseSnapshot({
                preferredInstrument: traderProfile.preferredInstrument,
                expiryPreference: traderProfile.expiryPreference
            }, externalSignal),
            fetchYahooCollection("yahooMarket", externalSignal)
        ]);

        const sensex = yahooMarkets.quotes.sensex || createUnavailableInstrument({
            ...INSTRUMENTS.yahooMarket.sensex,
            sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(INSTRUMENTS.yahooMarket.sensex.symbol)}`
        }, "Unavailable");

        const indian = {
            nifty: withFallbackInstrument(nseSnapshot.indian?.nifty, INDIA_FALLBACKS.nifty, "NSE index feed unavailable."),
            bankNifty: withFallbackInstrument(nseSnapshot.indian?.bankNifty, INDIA_FALLBACKS.bankNifty, "NSE index feed unavailable."),
            indiaVix: withFallbackInstrument(nseSnapshot.indian?.indiaVix, INDIA_FALLBACKS.indiaVix, "NSE volatility feed unavailable."),
            giftNifty: withFallbackInstrument(nseSnapshot.indian?.giftNifty, INDIA_FALLBACKS.giftNifty, "NSE market status feed unavailable.")
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

    async function loadMacroData(externalSignal) {
        const yahooMacro = await fetchYahooCollection("yahooMacro", externalSignal);
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

    function calculateCoverage(signal) {
        return round((signal.breakdown.filter((item) => item.currentValue !== "Unavailable").length / signal.breakdown.length) * 100, 0);
    }

    function hasUsableLiveData(sourceStatuses = []) {
        return sourceStatuses.some((status) => ["live", "delayed", "partial"].includes(String(status?.status || "").toLowerCase()));
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

    function buildProxyMetadata(proxyState) {
        const configuredProxy = getConfiguredProxyOrigin();
        const defaultProxy = getDefaultProxyOrigin();
        const proxyOrigin = proxyState?.proxyOrigin || configuredProxy || defaultProxy || "";

        if (proxyState?.available && proxyOrigin) {
            return {
                connected: true,
                mode: configuredProxy ? "remote-backend" : "same-origin",
                label: configuredProxy ? "Remote Proxy Connected" : "Same-origin API Connected",
                detail: `Live source requests are routed through ${proxyOrigin}.`
            };
        }

        if (configuredProxy) {
            return {
                connected: false,
                mode: "remote-backend",
                label: "Remote Proxy Disconnected",
                detail: `Saved proxy backend ${configuredProxy} did not respond to /api/health.`
            };
        }

        if (defaultProxy) {
            return {
                connected: false,
                mode: "same-origin",
                label: "Same-origin API Offline",
                detail: `No API responded at ${buildProxyApiUrl(defaultProxy, SAME_ORIGIN_HEALTH_PATH)}.`
            };
        }

        return {
            connected: false,
            mode: "browser-only",
            label: "No Proxy Backend",
            detail: "Static mode has no proxy backend, so browser CORS limits live cross-origin feeds."
        };
    }

    function getProxyFallbackReason(proxy) {
        if (proxy?.connected) {
            return "Critical live feeds are unavailable right now, so the static bundle is falling back to the last saved snapshot.";
        }

        if (proxy?.mode === "remote-backend") {
            return "The saved proxy backend is disconnected, so the static bundle is showing the last saved snapshot.";
        }

        if (proxy?.mode === "same-origin") {
            return "The same-origin API is offline, so the static bundle is showing the last saved snapshot.";
        }

        return "No proxy backend is configured, so the static bundle is showing the last saved snapshot.";
    }

    function buildFeedHealth(sourceStatuses = [], traderProfile = {}, proxyState = null) {
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

        const staleCriticalSources = sources.filter((source) =>
            source.critical && (source.stale || ["error", "unavailable"].includes(String(source.status || "").toLowerCase()))
        );
        const proxy = buildProxyMetadata(proxyState);

        return {
            proxy,
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

    async function buildStandaloneDashboardPayload({ settings = {}, activeTrade = null, signal = null } = {}) {
        const traderProfile = normalizeTraderProfile({
            capital: settings.capital,
            riskPercent: settings.riskPercent,
            instrument: settings.instrument,
            engineVersion: settings.engineVersion,
            sessionPreset: settings.sessionPreset,
            tradeAggressiveness: settings.tradeAggressiveness,
            strikeStyle: settings.strikeStyle,
            expiryPreference: settings.expiryPreference,
            lotSize: settings.lotSize,
            minimumConfidence: settings.minimumConfidence,
            vwapBandPercent: settings.vwapBandPercent
        });
        const normalizedTrade = normalizeActiveTrade(activeTrade || {});

        const [marketData, macroData, newsData, intradayData, buildInfo, proxyState] = await Promise.all([
            loadMarketData(traderProfile, signal),
            loadMacroData(signal),
            fetchNewsData(signal),
            loadIntradayData(signal),
            getBuildInfo(signal),
            hasSameOriginProxy(signal)
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

        const signalOutput = calculateSignalScore({
            india: payload.india,
            global: payload.global,
            macro: payload.macro,
            internals: payload.internals,
            news: payload.news,
            session: payload.session
        });

        payload.signal = signalOutput;
        const sourceStatuses = [
            ...marketData.sourceStatuses,
            ...macroData.sourceStatuses,
            ...newsData.sourceStatuses,
            ...intradayData.sourceStatuses
        ];
        payload.feedHealth = buildFeedHealth(sourceStatuses, traderProfile, proxyState);
        payload.decision = buildDecisionEngine({
            traderProfile,
            activeTrade: normalizedTrade,
            session: payload.session,
            india: payload.india,
            global: payload.global,
            macro: payload.macro,
            internals: payload.internals,
            news: payload.news,
            intraday: intradayData,
            signal: signalOutput
        });
        applyFeedHealthGuard(payload, payload.feedHealth);
        payload.summaryCards = buildSummaryCards(payload);
        payload.narrative = buildNarrative(payload);
        payload.tradePlan = buildTradePlan(payload, traderProfile);
        payload.optionsPlaybook = buildOptionsPlaybook(payload, traderProfile);
        payload.tradeMonitor = monitorActiveTrade(payload, normalizedTrade);

        if (normalizedTrade && payload.tradeMonitor) {
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

        const responsePayload = {
            generatedAt: new Date().toISOString(),
            dashboard: payload,
            sourceStatuses: payload.feedHealth.sources,
            metadata: {
                version: buildInfo.version,
                builtAt: buildInfo.builtAt,
                buildSource: buildInfo.source,
                coverage: calculateCoverage(signalOutput),
                mode: "browser-standalone",
                proxy: payload.feedHealth.proxy
            }
        };

        if (!hasUsableLiveData(responsePayload.sourceStatuses)) {
            const cachedSnapshot = readSnapshot();
            if (cachedSnapshot?.dashboard) {
                const cachedDashboard = {
                    ...cachedSnapshot.dashboard,
                    traderProfile,
                    feedHealth: payload.feedHealth,
                    tradeMonitor: normalizedTrade ? {
                        action: "INVALIDATED",
                        label: "INVALIDATED",
                        headline: "Live validation unavailable",
                        detail: "This is a cached snapshot without fresh critical feeds, so the active trade cannot be validated."
                    } : null
                };
                applyFeedHealthGuard(cachedDashboard, payload.feedHealth);
                return {
                    ...cachedSnapshot,
                    dashboard: cachedDashboard,
                    sourceStatuses: responsePayload.sourceStatuses,
                    metadata: {
                        ...(cachedSnapshot.metadata || {}),
                        version: buildInfo.version,
                        builtAt: buildInfo.builtAt,
                        buildSource: buildInfo.source,
                        mode: "browser-standalone-cached",
                        proxy: payload.feedHealth.proxy,
                        fallbackReason: getProxyFallbackReason(payload.feedHealth.proxy)
                    }
                };
            }

            payload.tradeMonitor = normalizedTrade ? {
                action: "INVALIDATED",
                label: "INVALIDATED",
                headline: "Live validation unavailable",
                detail: "Critical live feeds are unavailable in static mode, so the active trade cannot be validated."
            } : null;
            responsePayload.metadata.fallbackReason = getProxyFallbackReason(payload.feedHealth.proxy);
            return responsePayload;
        }

        writeSnapshot(responsePayload);
        return responsePayload;
    }

    function renderProxyNote(message) {
        const note = document.getElementById("proxyOriginNote");
        if (!note) {
            return;
        }
        note.textContent = message;
    }

    function syncProxyControls() {
        const input = document.getElementById("proxyOriginInput");
        if (!input) {
            return;
        }

        const configuredProxy = getConfiguredProxyOrigin();
        input.value = configuredProxy;

        if (configuredProxy) {
            renderProxyNote(`Using proxy backend ${configuredProxy}. Live source requests will go through ${buildProxyApiUrl(configuredProxy, SAME_ORIGIN_PROXY_PATH)}.`);
            return;
        }

        const defaultProxy = getDefaultProxyOrigin();
        if (defaultProxy) {
            renderProxyNote(`No remote proxy saved. The page will first try the same-origin API at ${buildProxyApiUrl(defaultProxy, SAME_ORIGIN_PROXY_PATH)}.`);
            return;
        }

        renderProxyNote("No proxy backend is configured. On static hosts, some live sources may be blocked until you save a backend origin.");
    }

    function saveProxyOriginFromInput() {
        const input = document.getElementById("proxyOriginInput");
        if (!input) {
            return;
        }

        const normalized = normalizeProxyOrigin(input.value);
        if (input.value.trim() && !normalized) {
            renderProxyNote("Proxy backend URL is invalid. Use a full origin such as https://your-backend.example.com.");
            return;
        }

        writeStoredProxyOrigin(normalized);
        proxyAvailabilityPromise = null;
        syncProxyControls();
        window.location.reload();
    }

    function clearSavedProxyOrigin() {
        writeStoredProxyOrigin("");
        proxyAvailabilityPromise = null;
        syncProxyControls();
        window.location.reload();
    }

    function setupProxyControls() {
        const saveButton = document.getElementById("saveProxyOriginBtn");
        const clearButton = document.getElementById("clearProxyOriginBtn");
        const input = document.getElementById("proxyOriginInput");

        if (!saveButton || !clearButton || !input) {
            return;
        }

        syncProxyControls();

        saveButton.addEventListener("click", saveProxyOriginFromInput);
        clearButton.addEventListener("click", clearSavedProxyOrigin);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                saveProxyOriginFromInput();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupProxyControls, { once: true });
    } else {
        setupProxyControls();
    }

    window.buildStandaloneDashboardPayload = buildStandaloneDashboardPayload;
    window.readStandaloneDashboardSnapshot = readSnapshot;
    window.setStandaloneProxyOrigin = (value) => {
        const normalized = normalizeProxyOrigin(value);
        writeStoredProxyOrigin(normalized);
        proxyAvailabilityPromise = null;
        syncProxyControls();
        return normalized;
    };
})();
