(function browserStandaloneLoader() {
    const SNAPSHOT_KEY = "live-market-dashboard.browser-standalone.snapshot";
    const HTTP_TIMEOUT_MS = 20000;
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

    async function fetchJson(url, options = {}, externalSignal) {
        const response = await fetchWithTimeout(url, options, externalSignal);
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
        const response = await fetchWithTimeout(url, options, externalSignal);
        const text = await response.text();

        if (!response.ok) {
            throw new Error(`Request failed (${response.status}) for ${url}`);
        }

        return text;
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

    const DEFAULT_TRADER_PROFILE = {
        capital: 100000,
        riskPercent: 1,
        preferredInstrument: "NIFTY",
        strikeStyle: "ATM",
        expiryPreference: "current",
        lotSize: null
    };

    function normalizeChoice(value, allowed, fallback) {
        const normalized = String(value || "").toUpperCase();
        return allowed.includes(normalized) ? normalized : fallback;
    }

    function normalizeExpiryChoice(value) {
        return String(value || "").toLowerCase() === "next" ? "next" : "current";
    }

    function normalizeTraderProfile(rawProfile = {}) {
        const capital = positiveNumber(rawProfile.capital) || DEFAULT_TRADER_PROFILE.capital;
        const riskPercent = positiveNumber(rawProfile.riskPercent) || DEFAULT_TRADER_PROFILE.riskPercent;

        return {
            capital,
            riskPercent,
            preferredInstrument: normalizeChoice(rawProfile.preferredInstrument || rawProfile.instrument, ["NIFTY", "BANKNIFTY"], DEFAULT_TRADER_PROFILE.preferredInstrument),
            strikeStyle: normalizeChoice(rawProfile.strikeStyle, ["ATM", "ITM", "OTM"], DEFAULT_TRADER_PROFILE.strikeStyle),
            expiryPreference: normalizeExpiryChoice(rawProfile.expiryPreference),
            lotSize: positiveNumber(rawProfile.lotSize)
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
            acknowledgedAt: rawTrade.activeTakenAt || rawTrade.acknowledgedAt || null,
            lotSize: positiveNumber(rawTrade.activeLotSize || rawTrade.lotSize),
            maxLots: positiveNumber(rawTrade.activeMaxLots || rawTrade.maxLots)
        };
    }

    function optionBiasFromSignal(signal) {
        const quickOption = signal?.quick?.options || "WAIT";
        if (quickOption === "CALLS") {
            return "CE";
        }
        if (quickOption === "PUTS") {
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

    function buildRiskLevels(referencePrice, signal, chain, optionType, underlyingValue, vixPrice) {
        if (!Number.isFinite(referencePrice)) {
            return null;
        }

        const confidence = Number(signal?.confidence || 0);
        const vix = positiveNumber(vixPrice);
        const stopLossPct = vix && vix >= 18 ? 0.2 : confidence >= 70 ? 0.16 : 0.14;
        const target1Pct = confidence >= 70 ? 0.16 : 0.12;
        const target2Pct = confidence >= 70 ? 0.28 : 0.22;
        const stepSize = positiveNumber(chain?.stepSize) || 1;

        return {
            stopLoss: round(referencePrice * (1 - stopLossPct), 2),
            target1: round(referencePrice * (1 + target1Pct), 2),
            target2: round(referencePrice * (1 + target2Pct), 2),
            spotInvalidation: optionType === "CE"
                ? round(chain?.support?.strike || (underlyingValue - stepSize), 2)
                : round(chain?.resistance?.strike || (underlyingValue + stepSize), 2),
            spotTrigger: optionType === "CE"
                ? round(Math.max(chain?.support?.strike || underlyingValue, underlyingValue), 2)
                : round(Math.min(chain?.resistance?.strike || underlyingValue, underlyingValue), 2)
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

    function normalizeEffectiveProfile(profile, chain) {
        return {
            ...profile,
            lotSize: profile.lotSize || positiveNumber(chain?.lotSize)
        };
    }

    function resolveTradeSetup(payload, profile) {
        const optionType = optionBiasFromSignal(payload.signal);
        const instrument = profile.preferredInstrument;
        const chain = getOptionChain(payload, instrument);
        const underlyingInstrument = getUnderlyingInstrument(payload, instrument);
        const underlyingValue = positiveNumber(chain?.underlyingValue) || positiveNumber(underlyingInstrument?.price);
        const effectiveProfile = normalizeEffectiveProfile(profile, chain);

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

        let selected = chooseContract(chain, optionType, profile.strikeStyle, underlyingValue, selectedExpiry);
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
            const fallbackSelection = chooseContract(chain, optionType, profile.strikeStyle, underlyingValue, chain.expiries[1]);
            const fallbackPremium = buildPremiumReference(fallbackSelection?.leg);
            if (fallbackSelection && fallbackPremium?.reference && fallbackPremium.reference >= premium.reference) {
                selectedExpiry = chain.expiries[1];
                selected = fallbackSelection;
                premium = fallbackPremium;
            }
        }

        const riskLevels = buildRiskLevels(
            premium?.reference,
            payload.signal,
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
            effectiveProfile,
            quickOptions: payload.signal.quick?.options || "WAIT",
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

    function shouldPreferDebitSpread(payload, premiumReference, underlyingValue) {
        const confidence = Number(payload.signal?.confidence || 0);
        const vix = positiveNumber(payload.india?.indiaVix?.price) || 0;
        const sessionMode = String(payload.session?.mode || "").toUpperCase();
        const premiumRatio = premiumReference && underlyingValue ? premiumReference / underlyingValue : 0;

        return sessionMode === "PREOPEN"
            || sessionMode === "POSTCLOSE"
            || sessionMode === "CLOSED"
            || vix >= 16
            || confidence < 72
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
        const confidence = Number(payload.signal?.confidence || 0);
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
        const preferredWidth = Number(payload.signal?.confidence || 0) >= 78 ? 2 : 1;
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
        const confidence = Number(payload.signal?.confidence || 0);
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
                    { label: "Bias", value: payload.signal?.cePeBias || "Unavailable" },
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

        return shouldPreferDebitSpread(payload, setup.premium?.reference, setup.underlyingValue)
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
            reason: `${setup.sessionLabel} plan based on live ${getInstrumentLabel(setup.instrument)} option-chain liquidity and the current ${setup.quickOptions} bias.`,
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
                `Signal notation is ${payload.signal.quick?.direction || "WAIT"} / ${setup.quickOptions}.`,
                `Use ${setup.effectiveProfile.strikeStyle} strike selection with ${setup.effectiveProfile.expiryPreference} expiry.`,
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

        let action = "HOLD";
        let headline = "Hold the trade";
        let detail = "Signal and premium still support the trade plan.";

        if (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") {
            action = "EXIT";
            headline = "Exit before session end";
            detail = "The market session is over or closing. Do not carry this as an intraday options plan.";
        } else if (
            Number.isFinite(activeTrade.spotInvalidation)
            && Number.isFinite(underlyingValue)
            && ((activeTrade.optionType === "CE" && underlyingValue <= activeTrade.spotInvalidation)
                || (activeTrade.optionType === "PE" && underlyingValue >= activeTrade.spotInvalidation))
        ) {
            action = "EXIT";
            headline = "Spot invalidation broke";
            detail = "Underlying spot has moved through the invalidation level from the original plan.";
        } else if (Number.isFinite(activeTrade.stopLoss) && currentPremium <= activeTrade.stopLoss) {
            action = "EXIT";
            headline = "Premium stop-loss hit";
            detail = "Current option premium is at or below the stored stop-loss.";
        } else if (payload.signal.quick?.options !== expectedQuick) {
            action = "INVALIDATED";
            headline = "Signal flipped against the trade";
            detail = `The dashboard now favors ${payload.signal.quick?.options || "WAIT"} instead of ${expectedQuick}.`;
        } else if (Number.isFinite(activeTrade.target2) && currentPremium >= activeTrade.target2) {
            action = "EXIT";
            headline = "Target 2 reached";
            detail = "Book the remaining position and reset for the next setup.";
        } else if (Number.isFinite(activeTrade.target1) && currentPremium >= activeTrade.target1) {
            action = "PARTIAL";
            headline = "Book partial, then trail";
            detail = "First target is met. Book partial and trail the rest at entry or better.";
        } else if (payload.signal.quick?.options === expectedQuick && (pnlPercent === null || pnlPercent >= -6)) {
            action = "HOLD";
            headline = "Hold while bias is intact";
            detail = "The contract remains above stop and the live bias still supports the trade.";
        }

        return {
            action,
            headline,
            detail,
            planId: activeTrade.planId,
            contractLabel: buildContractLabel(activeTrade.instrument, activeTrade.expiry, activeTrade.strikePrice, activeTrade.optionType),
            currentPremium,
            underlyingValue,
            pnlPercent,
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

    async function buildStandaloneDashboardPayload({ settings = {}, activeTrade = null, signal = null } = {}) {
        const traderProfile = normalizeTraderProfile({
            capital: settings.capital,
            riskPercent: settings.riskPercent,
            instrument: settings.instrument,
            strikeStyle: settings.strikeStyle,
            expiryPreference: settings.expiryPreference,
            lotSize: settings.lotSize
        });
        const normalizedTrade = normalizeActiveTrade(activeTrade || {});

        const [marketData, macroData, newsData] = await Promise.all([
            loadMarketData(traderProfile, signal),
            loadMacroData(signal),
            fetchNewsData(signal)
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
        payload.summaryCards = buildSummaryCards(payload);
        payload.narrative = buildNarrative(payload);
        payload.tradePlan = buildTradePlan(payload, traderProfile);
        payload.optionsPlaybook = buildOptionsPlaybook(payload, traderProfile);
        payload.tradeMonitor = monitorActiveTrade(payload, normalizedTrade);

        const responsePayload = {
            generatedAt: new Date().toISOString(),
            dashboard: payload,
            sourceStatuses: [
                ...marketData.sourceStatuses,
                ...macroData.sourceStatuses,
                ...newsData.sourceStatuses
            ],
            metadata: {
                version: "browser-standalone-1.2.0",
                coverage: calculateCoverage(signalOutput),
                mode: "browser-standalone"
            }
        };

        writeSnapshot(responsePayload);
        return responsePayload;
    }

    window.buildStandaloneDashboardPayload = buildStandaloneDashboardPayload;
    window.readStandaloneDashboardSnapshot = readSnapshot;
})();
