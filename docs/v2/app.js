(function () {
    "use strict";

    const CONFIG = {
        refreshMs: 60000,
        cacheKey: "options-market-decision-engine-v2:lastSnapshot",
        proxyKey: "options-market-decision-engine-v2:proxyBase",
        proxyMetaName: "options-engine-proxy",
        maxScore: 11,
        weights: {
            giftNifty: 2,
            pcr: 2,
            vix: 2,
            crude: 1,
            priceTrend: 2,
            news: 1,
            usdInr: 1
        },
        yahooRange: "1mo",
        yahooInterval: "1d",
        newsFeeds: {
            india: {
                key: "indiaNews",
                label: "India market headlines",
                url: "https://news.google.com/rss/search?q=(Indian%20stock%20market%20OR%20Nifty%20OR%20Sensex%20OR%20RBI%20OR%20Bank%20Nifty)%20when:2d&hl=en-IN&gl=IN&ceid=IN:en"
            },
            us: {
                key: "usNews",
                label: "US market headlines",
                url: "https://news.google.com/rss/search?q=(Nasdaq%20OR%20S%26P%20500%20OR%20Dow%20Jones%20OR%20Fed%20OR%20Wall%20Street)%20when:2d&hl=en-US&gl=US&ceid=US:en"
            },
            macro: {
                key: "macroNews",
                label: "Macro headlines",
                url: "https://news.google.com/rss/search?q=(inflation%20OR%20treasury%20yields%20OR%20crude%20oil%20OR%20Brent%20OR%20war%20OR%20tariffs%20OR%20geopolitics%20OR%20RBI%20OR%20Fed)%20when:2d&hl=en-US&gl=US&ceid=US:en"
            }
        }
    };

    const POSITIVE_PATTERNS = [
        /surge|rally|gain|record high|beats?|upgrade|growth|cools|eases|disinflation|optimism|supportive|recovery|strong demand|rate cut/i,
        /foreign inflow|buying|bullish|positive outlook|strong earnings|outperform/i
    ];

    const NEGATIVE_PATTERNS = [
        /fall|drops?|slides?|selloff|crash|downgrade|miss(es|ed)?|inflation spike|hot inflation|war|tariff|sanction|pressure|risk-off|weakness|cuts? outlook/i,
        /fii outflow|bearish|profit booking|geopolitical|volatility spike|recession/i
    ];

    const HIGH_IMPACT_PATTERNS = [
        /rbi|fed|inflation|cpi|wpi|rate cut|rate hike|yield|bond|crude|brent|war|tariff|budget|gdp|nifty|sensex|bank nifty/i
    ];

    const SOURCE_LABELS = {
        giftNifty: "GIFT Nifty",
        pcr: "PCR",
        vix: "India VIX",
        brent: "Brent crude",
        nifty: "NIFTY price trend",
        news: "Market news",
        usdInr: "USDINR"
    };

    const state = {
        snapshot: null,
        autoRefreshTimer: null,
        countdownTimer: null,
        nextRefreshAt: Date.now() + CONFIG.refreshMs,
        isLoading: false
    };

    const refs = {
        body: document.body,
        biasLabel: document.getElementById("biasLabel"),
        biasSubtext: document.getElementById("biasSubtext"),
        decisionBadge: document.getElementById("decisionBadge"),
        confidenceValue: document.getElementById("confidenceValue"),
        confidenceNote: document.getElementById("confidenceNote"),
        confidenceRing: document.querySelector(".confidence-ring"),
        scoreValue: document.getElementById("scoreValue"),
        signalMeterFill: document.getElementById("signalMeterFill"),
        tradeSuggestion: document.getElementById("tradeSuggestion"),
        tradeSuggestionNote: document.getElementById("tradeSuggestionNote"),
        coverageValue: document.getElementById("coverageValue"),
        refreshStatus: document.getElementById("refreshStatus"),
        lastUpdated: document.getElementById("lastUpdated"),
        refreshCountdown: document.getElementById("refreshCountdown"),
        dataModeValue: document.getElementById("dataModeValue"),
        systemModeText: document.getElementById("systemModeText"),
        warningBanner: document.getElementById("warningBanner"),
        reasonSummary: document.getElementById("reasonSummary"),
        reasonList: document.getElementById("reasonList"),
        signalGrid: document.getElementById("signalGrid"),
        breakdownList: document.getElementById("breakdownList"),
        headlineList: document.getElementById("headlineList"),
        sourceStatusList: document.getElementById("sourceStatusList"),
        refreshButton: document.getElementById("refreshButton"),
        proxyBaseInput: document.getElementById("proxyBaseInput"),
        saveProxyBtn: document.getElementById("saveProxyBtn"),
        clearProxyBtn: document.getElementById("clearProxyBtn")
    };

    init();

    function init() {
        refs.proxyBaseInput.value = getProxyBase();

        const cachedSnapshot = loadCachedSnapshot();
        if (cachedSnapshot) {
            state.snapshot = hydrateCachedSnapshot(cachedSnapshot, "Restored the last successful snapshot while fresh data loads.");
            renderUI(state.snapshot);
        }

        bindEvents();
        refreshData({ silentLoading: Boolean(cachedSnapshot) });
    }

    function bindEvents() {
        refs.refreshButton.addEventListener("click", () => {
            refreshData();
        });

        refs.saveProxyBtn.addEventListener("click", () => {
            const normalized = normalizeProxyBase(refs.proxyBaseInput.value);
            refs.proxyBaseInput.value = normalized;
            saveProxyBase(normalized);
            refreshData();
        });

        refs.clearProxyBtn.addEventListener("click", () => {
            refs.proxyBaseInput.value = "";
            saveProxyBase("");
            refreshData();
        });

        refs.proxyBaseInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                refs.saveProxyBtn.click();
            }
        });
    }

    async function refreshData(options = {}) {
        if (state.isLoading) {
            return;
        }

        state.isLoading = true;
        setLoadingState(true, options.silentLoading);

        try {
            const snapshot = await fetchAllData();
            state.snapshot = snapshot;
            renderUI(snapshot);

            if (snapshot.meta.storeable) {
                saveCachedSnapshot(snapshot);
            }

            scheduleNextRefresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown refresh error";
            const cachedSnapshot = loadCachedSnapshot();
            const fallbackSnapshot = cachedSnapshot
                ? hydrateCachedSnapshot(cachedSnapshot, `Fresh data failed: ${message}`)
                : buildSnapshot(createMockRawData(), {
                    warnings: [`Fresh data failed: ${message}. Showing a mock dataset instead.`],
                    mode: "mock",
                    proxyBase: getProxyBase(),
                    sourceStatuses: buildMockSourceStatuses()
                });

            state.snapshot = fallbackSnapshot;
            renderUI(fallbackSnapshot);
            scheduleNextRefresh();
        } finally {
            state.isLoading = false;
            setLoadingState(false, options.silentLoading);
        }
    }

    async function fetchAllData() {
        const proxyBase = getProxyBase();
        const cachedSnapshot = loadCachedSnapshot();

        if (!proxyBase) {
            return cachedSnapshot
                ? hydrateCachedSnapshot(cachedSnapshot, "No Cloudflare Worker URL is configured, so the dashboard is showing the last successful snapshot.")
                : buildSnapshot(createMockRawData(), {
                    warnings: [
                        "No Cloudflare Worker URL is configured. Save your Worker endpoint above to switch from demo mode to live feeds."
                    ],
                    mode: "mock",
                    proxyBase,
                    sourceStatuses: buildMockSourceStatuses()
                });
        }

        const loaders = [
            { key: "giftNifty", label: SOURCE_LABELS.giftNifty, load: () => fetchGiftNifty(proxyBase) },
            { key: "pcr", label: SOURCE_LABELS.pcr, load: () => fetchPcr(proxyBase) },
            { key: "vix", label: SOURCE_LABELS.vix, load: () => fetchMarketInstrument(proxyBase, "^INDIAVIX", "India VIX", "https://finance.yahoo.com/quote/%5EINDIAVIX/") },
            { key: "brent", label: SOURCE_LABELS.brent, load: () => fetchMarketInstrument(proxyBase, "BZ=F", "Brent Crude", "https://finance.yahoo.com/quote/BZ%3DF/") },
            { key: "nifty", label: SOURCE_LABELS.nifty, load: () => fetchMarketInstrument(proxyBase, "^NSEI", "NIFTY 50", "https://finance.yahoo.com/quote/%5ENSEI/") },
            { key: "news", label: SOURCE_LABELS.news, load: () => fetchNews(proxyBase) },
            { key: "usdInr", label: SOURCE_LABELS.usdInr, load: () => fetchMarketInstrument(proxyBase, "INR=X", "USDINR", "https://finance.yahoo.com/quote/INR%3DX/") }
        ];

        const rawData = createMockRawData();
        const warnings = [];
        const sourceStatuses = [];
        let liveCount = 0;

        const results = await Promise.allSettled(loaders.map((loader) => loader.load()));

        results.forEach((result, index) => {
            const loader = loaders[index];

            if (result.status === "fulfilled" && result.value && result.value.data) {
                rawData[loader.key] = {
                    ...result.value.data,
                    mode: result.value.mode || "live"
                };
                liveCount += result.value.mode === "mock" ? 0 : 1;
                sourceStatuses.push(...result.value.sourceStatuses);
                if (result.value.warning) {
                    warnings.push(result.value.warning);
                }
                return;
            }

            const reason = result.status === "rejected"
                ? normalizeError(result.reason)
                : `${loader.label} is unavailable.`;

            warnings.push(`${loader.label} failed, so demo values were used instead.`);
            sourceStatuses.push({
                key: loader.key,
                label: loader.label,
                state: "mock",
                detail: reason,
                updatedAt: null,
                source: "Fallback dataset"
            });
        });

        if (!liveCount) {
            return cachedSnapshot
                ? hydrateCachedSnapshot(cachedSnapshot, "All live requests failed, so the dashboard restored the last successful snapshot.")
                : buildSnapshot(rawData, {
                    warnings: [
                        "All live requests failed through the configured Worker. Mock data is active until the feeds recover."
                    ],
                    mode: "mock",
                    proxyBase,
                    sourceStatuses
                });
        }

        const mode = liveCount === loaders.length ? "live" : "mixed";

        if (mode === "mixed") {
            warnings.unshift("Some live feeds failed. Missing inputs were replaced with mock values so the engine can still respond.");
        }

        return buildSnapshot(rawData, {
            warnings,
            mode,
            proxyBase,
            sourceStatuses,
            liveCount,
            storeable: true
        });
    }

    async function fetchGiftNifty(proxyBase) {
        const envelope = await proxyFetch(proxyBase, "https://www.nseindia.com/api/marketStatus");
        const raw = envelope.data && envelope.data.giftnifty;

        if (!raw) {
            throw new Error("NSE market status did not include GIFT Nifty.");
        }

        return {
            mode: "live",
            data: {
                label: "GIFT Nifty",
                price: toNumber(raw.LASTPRICE),
                change: toNumber(raw.DAYCHANGE),
                changePercent: toNumber(raw.PERCHANGE),
                expiryDate: raw.EXPIRYDATE || null,
                updatedAt: parseDate(raw.TIMESTMP),
                sourceUrl: "https://www.nseindia.com/api/marketStatus"
            },
            sourceStatuses: [{
                key: "giftNifty",
                label: SOURCE_LABELS.giftNifty,
                state: "live",
                detail: "NSE market status feed loaded successfully.",
                updatedAt: parseDate(raw.TIMESTMP),
                source: "NSE India"
            }]
        };
    }

    async function fetchPcr(proxyBase) {
        const contractEnvelope = await proxyFetch(proxyBase, "https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY");
        const expiries = Array.isArray(contractEnvelope.data && contractEnvelope.data.expiryDates)
            ? contractEnvelope.data.expiryDates.filter(Boolean)
            : [];

        if (!expiries.length) {
            throw new Error("NSE option-chain contract info returned no expiries.");
        }

        const expiry = expiries[0];
        const optionEnvelope = await proxyFetch(
            proxyBase,
            `https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=${encodeURIComponent(expiry)}`
        );

        const rows = Array.isArray(optionEnvelope.data && optionEnvelope.data.records && optionEnvelope.data.records.data)
            ? optionEnvelope.data.records.data
            : [];

        let putOpenInterest = 0;
        let callOpenInterest = 0;

        rows.forEach((row) => {
            if (row && row.PE) {
                putOpenInterest += Number(row.PE.openInterest || 0);
            }
            if (row && row.CE) {
                callOpenInterest += Number(row.CE.openInterest || 0);
            }
        });

        const pcr = callOpenInterest ? round(putOpenInterest / callOpenInterest, 2) : null;
        const timestamp = parseDate(optionEnvelope.data && optionEnvelope.data.records && optionEnvelope.data.records.timestamp);

        if (!Number.isFinite(pcr)) {
            throw new Error("Unable to derive PCR from the NSE option chain.");
        }

        return {
            mode: "live",
            data: {
                label: "PCR",
                value: pcr,
                expiry,
                updatedAt: timestamp,
                totalPutOpenInterest: round(putOpenInterest, 0),
                totalCallOpenInterest: round(callOpenInterest, 0),
                sourceUrl: "https://www.nseindia.com/option-chain"
            },
            sourceStatuses: [{
                key: "pcr",
                label: SOURCE_LABELS.pcr,
                state: "live",
                detail: `Nearest NIFTY expiry PCR calculated from ${expiry}.`,
                updatedAt: timestamp,
                source: "NSE Option Chain"
            }]
        };
    }

    async function fetchMarketInstrument(proxyBase, symbol, label, sourceUrl) {
        const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${CONFIG.yahooInterval}&range=${CONFIG.yahooRange}&includePrePost=true`;
        const envelope = await proxyFetch(proxyBase, target);
        const chart = envelope.data && envelope.data.chart && envelope.data.chart.result && envelope.data.chart.result[0];
        const meta = chart && chart.meta;
        const quote = chart && chart.indicators && chart.indicators.quote && chart.indicators.quote[0];
        const closes = Array.isArray(quote && quote.close)
            ? quote.close.filter((value) => Number.isFinite(value))
            : [];

        if (!meta || !closes.length) {
            throw new Error(`Yahoo chart data for ${label} was incomplete.`);
        }

        const timestamps = Array.isArray(chart.timestamp) ? chart.timestamp : [];
        const updatedAt = meta.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000).toISOString()
            : timestamps.length
                ? new Date(timestamps[timestamps.length - 1] * 1000).toISOString()
                : null;

        const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length - 1];
        const previousClose = Number.isFinite(meta.previousClose) ? meta.previousClose : closes[closes.length - 2];
        const changePercent = Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0
            ? round(((price - previousClose) / previousClose) * 100, 2)
            : null;

        return {
            mode: "live",
            data: {
                label,
                symbol,
                price: round(price, 2),
                previousClose: round(previousClose, 2),
                changePercent,
                closes: closes.slice(-20).map((value) => round(value, 2)),
                updatedAt,
                sourceUrl
            },
            sourceStatuses: [{
                key: getSourceKeyForSymbol(symbol),
                label,
                state: "live",
                detail: `Yahoo chart data for ${label} loaded successfully.`,
                updatedAt,
                source: "Yahoo Finance"
            }]
        };
    }

    async function fetchNews(proxyBase) {
        const feedEntries = Object.entries(CONFIG.newsFeeds);
        const feedResults = await Promise.allSettled(feedEntries.map(([, feed]) => proxyFetch(proxyBase, feed.url)));
        const items = [];
        const sourceStatuses = [];
        let hadLiveFeed = false;

        feedResults.forEach((result, index) => {
            const [bucketKey, feed] = feedEntries[index];

            if (result.status === "fulfilled") {
                const parsedItems = parseNewsXml(result.value.text || "", bucketKey);
                const scoredItems = parsedItems.map((item) => scoreHeadline(item, bucketKey));
                items.push(...scoredItems);
                hadLiveFeed = hadLiveFeed || scoredItems.length > 0;
                sourceStatuses.push({
                    key: feed.key,
                    label: feed.label,
                    state: scoredItems.length ? "live" : "partial",
                    detail: scoredItems.length ? `Loaded ${scoredItems.length} headlines.` : "Feed returned no usable headlines.",
                    updatedAt: scoredItems[0] ? scoredItems[0].publishedAt : null,
                    source: "Google News RSS"
                });
                return;
            }

            sourceStatuses.push({
                key: feed.key,
                label: feed.label,
                state: "partial",
                detail: normalizeError(result.reason),
                updatedAt: null,
                source: "Google News RSS"
            });
        });

        if (!items.length) {
            return {
                mode: "mock",
                data: createMockRawData().news,
                sourceStatuses: [{
                    key: "news",
                    label: SOURCE_LABELS.news,
                    state: "mock",
                    detail: "No live headlines were available, so mock sentiment was used.",
                    updatedAt: null,
                    source: "Fallback dataset"
                }, ...sourceStatuses],
                warning: "Live news feeds were unavailable."
            };
        }

        const aggregate = summarizeNews(items);

        return {
            mode: hadLiveFeed ? "live" : "mock",
            data: {
                label: "News sentiment",
                items: items
                    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
                    .slice(0, 6),
                score: aggregate.score,
                stance: aggregate.stance,
                summary: aggregate.summary,
                highImpactCount: aggregate.highImpactCount,
                updatedAt: items[0] ? items[0].publishedAt : null,
                sourceUrl: "https://news.google.com/"
            },
            sourceStatuses: [{
                key: "news",
                label: SOURCE_LABELS.news,
                state: "live",
                detail: aggregate.summary,
                updatedAt: items[0] ? items[0].publishedAt : null,
                source: "Google News RSS"
            }, ...sourceStatuses]
        };
    }

    function calculateScore(rawData) {
        const breakdown = [];
        const signalCards = [];
        let score = 0;
        let availableSignals = 0;

        const nifty = rawData.nifty || {};
        const giftGapPercent = Number.isFinite(rawData.giftNifty && rawData.giftNifty.price) && Number.isFinite(nifty.previousClose) && nifty.previousClose !== 0
            ? round(((rawData.giftNifty.price - nifty.previousClose) / nifty.previousClose) * 100, 2)
            : rawData.giftNifty && Number.isFinite(rawData.giftNifty.changePercent)
                ? rawData.giftNifty.changePercent
                : null;

        const giftContribution = !Number.isFinite(giftGapPercent)
            ? 0
            : giftGapPercent > 0
                ? CONFIG.weights.giftNifty
                : giftGapPercent < 0
                    ? -CONFIG.weights.giftNifty
                    : 0;

        pushFactor({
            key: "giftNifty",
            label: "GIFT Nifty",
            valueText: Number.isFinite(rawData.giftNifty && rawData.giftNifty.price)
                ? `${formatNumber(rawData.giftNifty.price)} (${formatSignedPercent(rawData.giftNifty.changePercent)})`
                : "Data unavailable",
            noteText: Number.isFinite(giftGapPercent)
                ? `Gap vs NIFTY previous close: ${formatSignedPercent(giftGapPercent)}`
                : "Opening gap could not be verified.",
            contribution: giftContribution,
            effect: giftContribution > 0 ? "bullish" : giftContribution < 0 ? "bearish" : "neutral",
            detail: giftContribution > 0
                ? "Positive GIFT Nifty usually supports an upbeat NIFTY open."
                : giftContribution < 0
                    ? "Negative GIFT Nifty warns of early pressure on NIFTY."
                    : "Flat GIFT Nifty does not add a directional edge.",
            rawMode: rawData.giftNifty && rawData.giftNifty.mode,
            available: Number.isFinite(giftGapPercent)
        });

        const pcrValue = rawData.pcr && rawData.pcr.value;
        const pcrContribution = !Number.isFinite(pcrValue)
            ? 0
            : pcrValue > 1.2
                ? CONFIG.weights.pcr
                : pcrValue < 0.8
                    ? -CONFIG.weights.pcr
                    : 0;

        pushFactor({
            key: "pcr",
            label: "PCR",
            valueText: Number.isFinite(pcrValue) ? `${formatNumber(pcrValue)}${rawData.pcr.expiry ? ` · ${rawData.pcr.expiry}` : ""}` : "Data unavailable",
            noteText: "Above 1.2 is bullish, below 0.8 is bearish in this model.",
            contribution: pcrContribution,
            effect: pcrContribution > 0 ? "bullish" : pcrContribution < 0 ? "bearish" : "neutral",
            detail: pcrContribution > 0
                ? "Options positioning is tilted toward puts over calls."
                : pcrContribution < 0
                    ? "Low PCR shows heavier call positioning and weak downside protection."
                    : "PCR is balanced and not strongly directional.",
            rawMode: rawData.pcr && rawData.pcr.mode,
            available: Number.isFinite(pcrValue)
        });

        const vixAnalysis = analyzeVix(rawData.vix);
        pushFactor({
            key: "vix",
            label: "India VIX",
            valueText: Number.isFinite(rawData.vix && rawData.vix.price)
                ? `${formatNumber(rawData.vix.price)} (${formatSignedPercent(rawData.vix.changePercent)})`
                : "Data unavailable",
            noteText: vixAnalysis.note,
            contribution: vixAnalysis.contribution,
            effect: vixAnalysis.contribution > 0 ? "bullish" : vixAnalysis.contribution < 0 ? "bearish" : "neutral",
            detail: vixAnalysis.detail,
            rawMode: rawData.vix && rawData.vix.mode,
            available: Number.isFinite(rawData.vix && rawData.vix.price)
        });

        const crudeAnalysis = analyzeCrude(rawData.brent);
        pushFactor({
            key: "crude",
            label: "Brent Crude",
            valueText: Number.isFinite(rawData.brent && rawData.brent.price)
                ? `${formatNumber(rawData.brent.price)} (${formatSignedPercent(rawData.brent.changePercent)})`
                : "Data unavailable",
            noteText: crudeAnalysis.note,
            contribution: crudeAnalysis.contribution,
            effect: crudeAnalysis.contribution > 0 ? "bullish" : crudeAnalysis.contribution < 0 ? "bearish" : "neutral",
            detail: crudeAnalysis.detail,
            rawMode: rawData.brent && rawData.brent.mode,
            available: Number.isFinite(rawData.brent && rawData.brent.price)
        });

        const priceTrendAnalysis = analyzePriceTrend(rawData.nifty);
        pushFactor({
            key: "priceTrend",
            label: "NIFTY Trend",
            valueText: Number.isFinite(rawData.nifty && rawData.nifty.price)
                ? `${formatNumber(rawData.nifty.price)} (${formatSignedPercent(rawData.nifty.changePercent)})`
                : "Data unavailable",
            noteText: priceTrendAnalysis.note,
            contribution: priceTrendAnalysis.contribution,
            effect: priceTrendAnalysis.contribution > 0 ? "bullish" : priceTrendAnalysis.contribution < 0 ? "bearish" : "neutral",
            detail: priceTrendAnalysis.detail,
            rawMode: rawData.nifty && rawData.nifty.mode,
            available: Number.isFinite(rawData.nifty && rawData.nifty.price)
        });

        const newsAnalysis = analyzeNews(rawData.news);
        pushFactor({
            key: "news",
            label: "News Sentiment",
            valueText: Number.isFinite(rawData.news && rawData.news.score)
                ? `${formatSignedNumber(rawData.news.score)} score`
                : "Data unavailable",
            noteText: rawData.news && rawData.news.summary ? rawData.news.summary : "Headline pulse unavailable.",
            contribution: newsAnalysis.contribution,
            effect: newsAnalysis.contribution > 0 ? "bullish" : newsAnalysis.contribution < 0 ? "bearish" : "neutral",
            detail: newsAnalysis.detail,
            rawMode: rawData.news && rawData.news.mode,
            available: Array.isArray(rawData.news && rawData.news.items) && rawData.news.items.length > 0
        });

        const usdInrAnalysis = analyzeUsdInr(rawData.usdInr);
        pushFactor({
            key: "usdInr",
            label: "USDINR",
            valueText: Number.isFinite(rawData.usdInr && rawData.usdInr.price)
                ? `${formatNumber(rawData.usdInr.price)} (${formatSignedPercent(rawData.usdInr.changePercent)})`
                : "Data unavailable",
            noteText: usdInrAnalysis.note,
            contribution: usdInrAnalysis.contribution,
            effect: usdInrAnalysis.contribution > 0 ? "bullish" : usdInrAnalysis.contribution < 0 ? "bearish" : "neutral",
            detail: usdInrAnalysis.detail,
            rawMode: rawData.usdInr && rawData.usdInr.mode,
            available: Number.isFinite(rawData.usdInr && rawData.usdInr.price)
        });

        const missingCount = breakdown.length - availableSignals;
        const scorePenalty = round(Math.min(2, missingCount * 0.4), 1);
        const adjustedScore = applyMagnitudePenalty(score, scorePenalty);
        const positiveCount = breakdown.filter((item) => item.contribution > 0).length;
        const negativeCount = breakdown.filter((item) => item.contribution < 0).length;

        return {
            rawScore: round(score, 1),
            score: adjustedScore,
            maxScore: CONFIG.maxScore,
            coverage: {
                available: availableSignals,
                total: breakdown.length,
                missing: missingCount
            },
            conflict: {
                positiveCount,
                negativeCount,
                exists: positiveCount > 0 && negativeCount > 0,
                severity: Math.min(positiveCount, negativeCount)
            },
            penalties: {
                missingDataPenalty: scorePenalty
            },
            breakdown,
            signalCards
        };

        function pushFactor(factor) {
            score += factor.contribution;
            if (factor.available) {
                availableSignals += 1;
            }

            breakdown.push({
                key: factor.key,
                label: factor.label,
                contribution: factor.contribution,
                effect: factor.effect,
                valueText: factor.valueText,
                detail: factor.detail,
                noteText: factor.noteText,
                mode: factor.rawMode || "mock",
                available: factor.available
            });

            signalCards.push({
                key: factor.key,
                label: factor.label,
                valueText: factor.valueText,
                noteText: factor.noteText,
                contribution: factor.contribution,
                effect: factor.effect,
                detail: factor.detail,
                mode: factor.rawMode || "mock"
            });
        }
    }

    function calculateConfidence(scoreModel, rawData, mode) {
        let confidence = Math.round((Math.abs(scoreModel.score) / scoreModel.maxScore) * 100);
        const notes = [];

        if (scoreModel.coverage.missing) {
            const deduction = scoreModel.coverage.missing * 7;
            confidence -= deduction;
            notes.push(`${scoreModel.coverage.missing} signal${scoreModel.coverage.missing > 1 ? "s are" : " is"} missing.`);
        }

        if (scoreModel.conflict.exists) {
            const deduction = scoreModel.conflict.severity >= 2 ? 14 : 8;
            confidence -= deduction;
            notes.push("Signals are conflicting across bullish and bearish buckets.");
        }

        const vixPrice = rawData.vix && rawData.vix.price;
        if (Number.isFinite(vixPrice) && vixPrice >= 20) {
            confidence -= 14;
            notes.push("India VIX is elevated, which reduces directional reliability.");
        } else if (Number.isFinite(vixPrice) && vixPrice >= 17.5) {
            confidence -= 7;
            notes.push("India VIX is firm enough to cap conviction.");
        }

        if (mode === "mixed") {
            confidence = Math.min(confidence, 72);
            notes.push("Some signals are mocked because live feeds were partial.");
        }

        if (mode === "mock") {
            confidence = Math.min(confidence, 46);
            notes.push("Demo-mode data caps confidence.");
        }

        if (mode === "cached") {
            confidence = Math.min(confidence, 58);
            notes.push("Cached snapshots are informative but stale by definition.");
        }

        confidence = clamp(Math.round(confidence), 9, 95);

        return {
            value: confidence,
            label: confidence >= 70 ? "High confidence" : confidence >= 45 ? "Moderate confidence" : "Low confidence",
            notes
        };
    }

    function generateDecision(scoreModel, confidenceModel, rawData, meta) {
        const score = scoreModel.score;
        let bias = "SIDEWAYS";
        let tone = "sideways";

        if (score >= 4) {
            bias = "STRONG BULLISH";
            tone = "bullish";
        } else if (score >= 1) {
            bias = "BULLISH";
            tone = "bullish";
        } else if (score <= -4) {
            bias = "STRONG BEARISH";
            tone = "bearish";
        } else if (score <= -1) {
            bias = "BEARISH";
            tone = "bearish";
        }

        const bullishDrivers = scoreModel.breakdown
            .filter((item) => item.contribution > 0)
            .sort((left, right) => right.contribution - left.contribution)
            .slice(0, 2);

        const bearishDrivers = scoreModel.breakdown
            .filter((item) => item.contribution < 0)
            .sort((left, right) => left.contribution - right.contribution)
            .slice(0, 2);

        let summary = "Signals are balanced, so NIFTY currently reads as sideways.";
        if (tone === "bullish") {
            summary = `NIFTY reads ${bias.toLowerCase()} because ${joinLabels(bullishDrivers)} are providing the strongest support.`;
        } else if (tone === "bearish") {
            summary = `NIFTY reads ${bias.toLowerCase()} because ${joinLabels(bearishDrivers)} are applying the strongest pressure.`;
        }

        const risks = [];
        if (scoreModel.conflict.exists) {
            risks.push("Bullish and bearish factors are still fighting each other.");
        }
        if (Number.isFinite(rawData.vix && rawData.vix.price) && rawData.vix.price >= 20) {
            risks.push("High VIX can create whipsaws even when the score leans directional.");
        }
        if (meta.mode !== "live") {
            risks.push("Feed quality is not fully live, so the engine is leaning on fallback protection.");
        }
        if (!risks.length) {
            risks.push("No single risk override is dominating the setup right now.");
        }

        return {
            bias,
            tone,
            summary,
            reasonSentence: buildReasonSentence(bias, bullishDrivers, bearishDrivers),
            risks,
            tradeSuggestion: buildTradeSuggestion(bias, confidenceModel.value, rawData.vix && rawData.vix.price)
        };
    }

    function renderUI(snapshot) {
        const tone = snapshot.analysis.decision.tone;
        refs.body.dataset.tone = tone;
        refs.body.classList.remove("is-loading");

        refs.biasLabel.textContent = snapshot.analysis.decision.bias;
        refs.biasSubtext.textContent = snapshot.analysis.decision.reasonSentence;
        refs.decisionBadge.textContent = snapshot.analysis.confidence.label;
        refs.decisionBadge.className = `decision-chip ${tone}`;

        refs.confidenceValue.textContent = `${snapshot.analysis.confidence.value}%`;
        refs.confidenceRing.style.setProperty("--confidence", String(snapshot.analysis.confidence.value));
        refs.confidenceNote.textContent = snapshot.analysis.confidence.notes[0] || "Signal alignment is stable.";

        refs.scoreValue.textContent = `${formatSignedNumber(snapshot.analysis.score.score)} / ${snapshot.analysis.score.maxScore}`;
        renderMeter(snapshot.analysis.score.score, snapshot.analysis.score.maxScore);

        refs.tradeSuggestion.textContent = snapshot.analysis.decision.tradeSuggestion.title;
        refs.tradeSuggestionNote.textContent = snapshot.analysis.decision.tradeSuggestion.detail;
        refs.coverageValue.textContent = `${snapshot.analysis.score.coverage.available} / ${snapshot.analysis.score.coverage.total} signals live or recovered`;
        refs.refreshStatus.textContent = snapshot.meta.mode === "live"
            ? "All tracked feeds are live through the configured Cloudflare Worker."
            : snapshot.meta.mode === "mixed"
                ? "Some feeds are live and some are using fallback values."
                : snapshot.meta.mode === "cached"
                    ? "Showing the last successful snapshot from local cache."
                    : "Demo-mode snapshot is active until live feeds recover.";

        refs.lastUpdated.textContent = formatDateTime(snapshot.meta.updatedAt);
        refs.dataModeValue.textContent = toTitleCase(snapshot.meta.mode);
        refs.systemModeText.textContent = snapshot.analysis.decision.bias;
        refs.reasonSummary.textContent = snapshot.analysis.decision.summary;

        renderWarnings(snapshot.meta.warnings);
        renderReasonList(snapshot.analysis);
        renderSignalGrid(snapshot.analysis.score.signalCards);
        renderBreakdown(snapshot.analysis.score.breakdown);
        renderHeadlines(snapshot.rawData.news);
        renderSourceStatuses(snapshot.meta.sourceStatuses);
    }

    function renderWarnings(warnings) {
        const filtered = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
        if (!filtered.length) {
            refs.warningBanner.classList.add("is-hidden");
            refs.warningBanner.textContent = "";
            return;
        }

        refs.warningBanner.classList.remove("is-hidden");
        refs.warningBanner.textContent = filtered.join(" ");
    }

    function renderReasonList(analysis) {
        const items = [
            analysis.decision.reasonSentence,
            ...analysis.confidence.notes,
            ...analysis.decision.risks
        ].filter(Boolean).slice(0, 4);

        refs.reasonList.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    }

    function renderSignalGrid(signalCards) {
        refs.signalGrid.innerHTML = signalCards.map((card) => `
            <article class="signal-card" data-effect="${escapeHtml(card.effect)}">
                <div class="signal-card-head">
                    <div>
                        <h3>${escapeHtml(card.label)}</h3>
                        <p class="signal-aux">${escapeHtml(card.valueText)}</p>
                    </div>
                    <span class="status-chip ${escapeHtml(card.mode)}">${escapeHtml(card.mode)}</span>
                </div>
                <div class="signal-impact ${escapeHtml(card.effect)}">
                    <strong>${formatSignedNumber(card.contribution)}</strong>
                    <span>${escapeHtml(card.effect === "bullish" ? "Bullish push" : card.effect === "bearish" ? "Bearish push" : "Neutral")}</span>
                </div>
                <p class="signal-data-note">${escapeHtml(card.noteText)}</p>
                <p class="signal-detail">${escapeHtml(card.detail)}</p>
            </article>
        `).join("");
    }

    function renderBreakdown(breakdown) {
        refs.breakdownList.innerHTML = breakdown.map((item) => `
            <div class="breakdown-row">
                <div>
                    <h3 class="breakdown-title">${escapeHtml(item.label)}</h3>
                    <p class="breakdown-meta">${escapeHtml(item.valueText)}</p>
                    <p class="breakdown-detail">${escapeHtml(item.detail)}</p>
                </div>
                <div class="breakdown-score ${escapeHtml(item.effect)}">${formatSignedNumber(item.contribution)}</div>
            </div>
        `).join("");
    }

    function renderHeadlines(news) {
        const items = Array.isArray(news && news.items) ? news.items : [];
        if (!items.length) {
            refs.headlineList.innerHTML = `<div class="headline-item"><p class="headline-meta">No headlines are available right now.</p></div>`;
            return;
        }

        refs.headlineList.innerHTML = items.map((item) => `
            <article class="headline-item">
                <div class="headline-row">
                    <h3 class="headline-title">${escapeHtml(item.title)}</h3>
                    <div class="headline-chips">
                        <span class="headline-chip ${escapeHtml((item.sentiment || "neutral").toLowerCase())}">${escapeHtml(item.sentiment || "Neutral")}</span>
                        <span class="impact-chip ${escapeHtml(item.impactTone || "neutral")}">${escapeHtml(item.impact || "Low impact")}</span>
                    </div>
                </div>
                <p class="headline-meta">${escapeHtml(item.source || "Unknown source")} · ${escapeHtml(formatDateTime(item.publishedAt))}</p>
            </article>
        `).join("");
    }

    function renderSourceStatuses(sourceStatuses) {
        refs.sourceStatusList.innerHTML = sourceStatuses.map((item) => `
            <article class="source-status-item">
                <div class="source-status-head">
                    <div>
                        <h3 class="source-status-title">${escapeHtml(item.label)}</h3>
                        <p class="source-status-detail">${escapeHtml(item.detail || "No status detail available.")}</p>
                    </div>
                    <div class="signal-meta">
                        <span class="status-chip ${escapeHtml(item.state || "mock")}">${escapeHtml(item.state || "mock")}</span>
                        <span class="signal-aux">${escapeHtml(item.updatedAt ? formatDateTime(item.updatedAt) : item.source || "")}</span>
                    </div>
                </div>
            </article>
        `).join("");
    }

    function buildSnapshot(rawData, options) {
        const score = calculateScore(rawData);
        const confidence = calculateConfidence(score, rawData, options.mode);
        const decision = generateDecision(score, confidence, rawData, options);
        const updatedAt = getLatestUpdatedAt(rawData) || new Date().toISOString();

        return {
            meta: {
                updatedAt,
                warnings: uniqueStrings(options.warnings || []),
                mode: options.mode,
                proxyBase: options.proxyBase || "",
                sourceStatuses: dedupeStatuses(options.sourceStatuses || []),
                liveCount: options.liveCount || 0,
                storeable: Boolean(options.storeable)
            },
            rawData,
            analysis: {
                score,
                confidence,
                decision
            }
        };
    }

    function hydrateCachedSnapshot(snapshot, warningMessage) {
        const hydrated = clone(snapshot);
        hydrated.meta.mode = "cached";
        hydrated.meta.storeable = false;
        hydrated.meta.warnings = uniqueStrings([warningMessage, ...(hydrated.meta.warnings || [])]);
        hydrated.meta.sourceStatuses = (hydrated.meta.sourceStatuses || []).map((item) => ({
            ...item,
            state: item.state === "mock" ? "mock" : "cached"
        }));

        if (hydrated.rawData) {
            Object.keys(hydrated.rawData).forEach((key) => {
                if (hydrated.rawData[key] && typeof hydrated.rawData[key] === "object") {
                    hydrated.rawData[key].mode = hydrated.rawData[key].mode === "mock" ? "mock" : "cached";
                }
            });
        }

        return buildSnapshot(hydrated.rawData || createMockRawData(), {
            warnings: hydrated.meta.warnings,
            mode: "cached",
            proxyBase: getProxyBase(),
            sourceStatuses: hydrated.meta.sourceStatuses,
            storeable: false
        });
    }

    function scheduleNextRefresh() {
        clearTimeout(state.autoRefreshTimer);
        clearInterval(state.countdownTimer);
        state.nextRefreshAt = Date.now() + CONFIG.refreshMs;

        state.autoRefreshTimer = window.setTimeout(() => {
            refreshData({ silentLoading: true });
        }, CONFIG.refreshMs);

        updateCountdown();
        state.countdownTimer = window.setInterval(updateCountdown, 1000);
    }

    function updateCountdown() {
        const secondsRemaining = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
        refs.refreshCountdown.textContent = `${secondsRemaining}s`;
    }

    function setLoadingState(isLoading, silentLoading) {
        refs.body.classList.toggle("is-loading", isLoading && !silentLoading);
        refs.refreshButton.disabled = isLoading;
        refs.saveProxyBtn.disabled = isLoading;
        refs.clearProxyBtn.disabled = isLoading;
        if (isLoading && !silentLoading) {
            refs.refreshStatus.textContent = "Refreshing feeds and recalculating the NIFTY decision engine...";
        }
    }

    async function proxyFetch(proxyBase, targetUrl) {
        const url = new URL(proxyBase);
        url.searchParams.set("url", targetUrl);

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                accept: "application/json"
            }
        });

        let envelope;
        try {
            envelope = await response.json();
        } catch (error) {
            throw new Error(`Proxy response could not be parsed for ${targetUrl}`);
        }

        if (!response.ok || !envelope.ok) {
            throw new Error(envelope && envelope.error ? envelope.error : `Proxy request failed for ${targetUrl}`);
        }

        return envelope;
    }

    function createMockRawData() {
        return {
            giftNifty: {
                label: "GIFT Nifty",
                price: 22784.5,
                changePercent: 0.58,
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank"
            },
            pcr: {
                label: "PCR",
                value: 1.24,
                expiry: "Nearest expiry",
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank"
            },
            vix: {
                label: "India VIX",
                price: 14.8,
                previousClose: 15.4,
                changePercent: -3.9,
                closes: [16.2, 15.9, 15.6, 15.2, 14.8],
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank"
            },
            brent: {
                label: "Brent Crude",
                price: 81.2,
                previousClose: 82.4,
                changePercent: -1.46,
                closes: [83.5, 82.9, 82.2, 81.8, 81.2],
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank"
            },
            nifty: {
                label: "NIFTY 50",
                price: 22468.9,
                previousClose: 22312.1,
                changePercent: 0.7,
                closes: [21940, 22025, 22180, 22310, 22468.9],
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank"
            },
            news: {
                label: "News sentiment",
                score: 2.4,
                stance: "Bullish",
                summary: "Supportive India and macro headlines are slightly ahead of the risk-off stories.",
                highImpactCount: 1,
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank",
                items: [
                    createMockHeadline("Banks lead gains as risk appetite improves in early trade", "Bullish", "High impact / risk event"),
                    createMockHeadline("Brent oil cools after recent spike, easing inflation worries", "Bullish", "Medium impact"),
                    createMockHeadline("RBI commentary keeps rate path stable for now", "Neutral", "Medium impact")
                ]
            },
            usdInr: {
                label: "USDINR",
                price: 82.79,
                previousClose: 83.02,
                changePercent: -0.28,
                closes: [83.26, 83.18, 83.05, 82.91, 82.79],
                updatedAt: new Date().toISOString(),
                mode: "mock",
                sourceUrl: "about:blank"
            }
        };
    }

    function buildMockSourceStatuses() {
        return Object.keys(SOURCE_LABELS).map((key) => ({
            key,
            label: SOURCE_LABELS[key],
            state: "mock",
            detail: "Demo-mode fallback is active for this signal.",
            updatedAt: null,
            source: "Fallback dataset"
        }));
    }

    function createMockHeadline(title, sentiment, impact) {
        return {
            title,
            source: "Demo feed",
            publishedAt: new Date().toISOString(),
            sentiment,
            impact,
            impactTone: sentiment === "Bullish" ? "bullish" : sentiment === "Bearish" ? "bearish" : "neutral",
            score: sentiment === "Bullish" ? 1.2 : sentiment === "Bearish" ? -1.2 : 0
        };
    }

    function analyzeVix(vix) {
        const changePercent = vix && vix.changePercent;
        const closes = Array.isArray(vix && vix.closes) ? vix.closes : [];
        const multiDayChange = closes.length >= 4 && closes[closes.length - 4]
            ? round(((closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4]) * 100, 2)
            : null;

        if (!Number.isFinite(vix && vix.price)) {
            return {
                contribution: 0,
                note: "VIX data unavailable.",
                detail: "Volatility input is missing, so it cannot reinforce or discount the bias.",
                highRisk: false
            };
        }

        if ((Number.isFinite(changePercent) && changePercent >= 5) || (Number.isFinite(multiDayChange) && multiDayChange >= 8)) {
            return {
                contribution: -CONFIG.weights.vix,
                note: "Rising sharply",
                detail: "Volatility is climbing fast, which usually hurts directional confidence.",
                highRisk: true
            };
        }

        if ((Number.isFinite(changePercent) && changePercent <= -2.5) || (Number.isFinite(multiDayChange) && multiDayChange <= -5)) {
            return {
                contribution: 1,
                note: "Falling",
                detail: "A cooling VIX supports a steadier directional move.",
                highRisk: false
            };
        }

        return {
            contribution: 0,
            note: "Stable",
            detail: "Volatility is not adding a clear directional edge yet.",
            highRisk: Number.isFinite(vix.price) && vix.price >= 20
        };
    }

    function analyzeCrude(brent) {
        const changePercent = brent && brent.changePercent;
        if (!Number.isFinite(brent && brent.price)) {
            return {
                contribution: 0,
                note: "Crude unavailable",
                detail: "Brent crude is missing, so macro pressure from energy cannot be scored."
            };
        }
        if (Number.isFinite(changePercent) && changePercent >= 1) {
            return {
                contribution: -1,
                note: "Rising",
                detail: "Rising crude is a macro headwind for India and usually weighs on risk appetite."
            };
        }
        if (Number.isFinite(changePercent) && changePercent <= -1) {
            return {
                contribution: 1,
                note: "Falling",
                detail: "Cooling crude helps the inflation and import-cost backdrop."
            };
        }
        return {
            contribution: 0,
            note: "Flat",
            detail: "Brent is stable and not moving the score materially."
        };
    }

    function analyzePriceTrend(nifty) {
        const closes = Array.isArray(nifty && nifty.closes) ? nifty.closes : [];
        if (!Number.isFinite(nifty && nifty.price) || closes.length < 5) {
            return {
                contribution: 0,
                note: "Trend unavailable",
                detail: "NIFTY trend data is incomplete, so price structure is treated as neutral."
            };
        }

        const sma5 = average(closes.slice(-5));
        const sma10 = average(closes.slice(-10));
        const base = closes[Math.max(0, closes.length - 5)];
        const slopePercent = base ? round(((closes[closes.length - 1] - base) / base) * 100, 2) : null;
        const price = closes[closes.length - 1];

        if (price > sma5 && sma5 >= sma10 && slopePercent >= 0.45) {
            return {
                contribution: CONFIG.weights.priceTrend,
                note: `Uptrend · SMA5 ${formatNumber(sma5)}`,
                detail: "NIFTY is above short-term trend support and the recent close slope is positive."
            };
        }

        if (price < sma5 && sma5 <= sma10 && slopePercent <= -0.45) {
            return {
                contribution: -CONFIG.weights.priceTrend,
                note: `Downtrend · SMA5 ${formatNumber(sma5)}`,
                detail: "NIFTY is below short-term trend support and recent closes are slipping."
            };
        }

        return {
            contribution: 0,
            note: "Sideways",
            detail: "Price structure is overlapping and does not confirm a clean trend."
        };
    }

    function analyzeNews(news) {
        const score = news && news.score;
        if (!Number.isFinite(score)) {
            return {
                contribution: 0,
                detail: "Headline flow is unavailable.",
                note: "No usable headlines"
            };
        }
        if (score > 1) {
            return {
                contribution: CONFIG.weights.news,
                detail: "Recent headlines lean supportive for market sentiment.",
                note: "Positive pulse"
            };
        }
        if (score < -1) {
            return {
                contribution: -CONFIG.weights.news,
                detail: "Recent headlines lean defensive and could pressure NIFTY sentiment.",
                note: "Negative pulse"
            };
        }
        return {
            contribution: 0,
            detail: "Headlines are mixed and not yet directional.",
            note: "Mixed pulse"
        };
    }

    function analyzeUsdInr(usdInr) {
        const changePercent = usdInr && usdInr.changePercent;
        if (!Number.isFinite(usdInr && usdInr.price)) {
            return {
                contribution: 0,
                note: "USDINR unavailable",
                detail: "Currency pressure is missing, so the optional FX signal is neutral."
            };
        }
        if (Number.isFinite(changePercent) && changePercent >= 0.3) {
            return {
                contribution: -1,
                note: "Rupee weaker",
                detail: "A stronger dollar versus the rupee is a mild headwind for domestic risk appetite."
            };
        }
        if (Number.isFinite(changePercent) && changePercent <= -0.3) {
            return {
                contribution: 1,
                note: "Rupee stronger",
                detail: "A softer dollar against the rupee slightly helps the risk backdrop."
            };
        }
        return {
            contribution: 0,
            note: "FX neutral",
            detail: "USDINR is stable and not adding a directional push."
        };
    }

    function parseNewsXml(xmlText, category) {
        if (!xmlText) {
            return [];
        }

        const documentNode = new DOMParser().parseFromString(xmlText, "application/xml");
        if (documentNode.querySelector("parsererror")) {
            return [];
        }

        return Array.from(documentNode.querySelectorAll("item")).map((item) => {
            const titleText = item.querySelector("title") ? item.querySelector("title").textContent : "";
            const split = splitGoogleNewsTitle(titleText || "");
            return {
                title: split.title,
                source: split.source,
                publishedAt: item.querySelector("pubDate") ? new Date(item.querySelector("pubDate").textContent).toISOString() : null,
                link: item.querySelector("link") ? item.querySelector("link").textContent : "",
                category
            };
        }).filter((item) => item.title).slice(0, 8);
    }

    function splitGoogleNewsTitle(rawTitle) {
        const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
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
            : impactHits >= 1 || rawScore !== 0
                ? "Medium impact"
                : "Low impact";

        const sentiment = rawScore > 0 ? "Bullish" : rawScore < 0 ? "Bearish" : "Neutral";
        const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
        const ageHours = publishedAt ? Math.max(0, (Date.now() - publishedAt) / 3600000) : 24;
        const recencyMultiplier = clamp(1.25 - (ageHours * 0.05), 0.5, 1.2);
        const impactMultiplier = impact === "High impact / risk event" ? 1.5 : impact === "Medium impact" ? 1.1 : 0.75;
        const weightedScore = round(rawScore * recencyMultiplier * impactMultiplier, 2);

        return {
            ...item,
            category,
            sentiment,
            impact,
            impactTone: sentiment === "Bullish" ? "bullish" : sentiment === "Bearish" ? "bearish" : "neutral",
            score: weightedScore
        };
    }

    function summarizeNews(items) {
        const totalScore = round(items.reduce((sum, item) => sum + (item.score || 0), 0), 2);
        const stance = totalScore > 1 ? "Bullish" : totalScore < -1 ? "Bearish" : "Neutral";
        const highImpactCount = items.filter((item) => item.impact === "High impact / risk event").length;
        const strongest = items
            .slice()
            .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
            .slice(0, 2)
            .map((item) => item.title);

        let summary = "Headlines are mixed with no dominant narrative.";
        if (stance === "Bullish") {
            summary = strongest.length
                ? `Supportive headlines are leading the tape, driven by ${strongest.join(" and ")}.`
                : "Supportive headlines are modestly ahead of the negatives.";
        } else if (stance === "Bearish") {
            summary = strongest.length
                ? `Risk-off headlines are dominating, led by ${strongest.join(" and ")}.`
                : "Defensive headlines are weighing on sentiment.";
        }

        return {
            score: totalScore,
            stance,
            highImpactCount,
            summary
        };
    }

    function buildReasonSentence(bias, bullishDrivers, bearishDrivers) {
        if (bias === "SIDEWAYS") {
            if (bullishDrivers.length && bearishDrivers.length) {
                return `${joinLabels(bullishDrivers)} are offset by ${joinLabels(bearishDrivers)}, so NIFTY stays sideways for now.`;
            }
            return "The current signals are too mixed to trust a clean NIFTY direction.";
        }

        if (bias.includes("BULLISH")) {
            const supportText = bullishDrivers.length ? joinLabels(bullishDrivers) : "the broader setup";
            const riskText = bearishDrivers.length ? `, though ${joinLabels(bearishDrivers)} remain a risk` : "";
            return `NIFTY leans bullish because ${supportText} are supportive${riskText}.`;
        }

        const pressureText = bearishDrivers.length ? joinLabels(bearishDrivers) : "the broader setup";
        const supportText = bullishDrivers.length ? `, while ${joinLabels(bullishDrivers)} still offer some support` : "";
        return `NIFTY leans bearish because ${pressureText} are negative${supportText}.`;
    }

    function buildTradeSuggestion(bias, confidence, vixPrice) {
        const highVix = Number.isFinite(vixPrice) && vixPrice >= 20;

        if (bias.includes("BULLISH") && confidence >= 70 && !highVix) {
            return {
                title: "Consider CE on dip",
                detail: "Bullish score and confidence are aligned, and volatility is not blocking the setup."
            };
        }

        if (bias.includes("BEARISH") && confidence >= 70 && !highVix) {
            return {
                title: "Consider PE on rise",
                detail: "Bearish score and confidence are aligned, and volatility is still tradable."
            };
        }

        if (bias === "BULLISH" && confidence >= 52) {
            return {
                title: "Watch CE on breakout",
                detail: "Bias is positive, but a cleaner confirmation would be safer than anticipating."
            };
        }

        if (bias === "BEARISH" && confidence >= 52) {
            return {
                title: "Watch PE on breakdown",
                detail: "Bias is negative, but price confirmation is still more important than speed."
            };
        }

        return {
            title: "Avoid trade",
            detail: highVix
                ? "Volatility is too high for a comfortable directional entry."
                : "Either the score is mixed or the confidence is too low to force a trade."
        };
    }

    function renderMeter(score, maxScore) {
        const ratio = clamp(Math.abs(score) / maxScore, 0, 1);
        refs.signalMeterFill.style.width = `${ratio * 50}%`;
        refs.signalMeterFill.style.left = score >= 0 ? "50%" : `${50 - (ratio * 50)}%`;
    }

    function getProxyBase() {
        const params = new URLSearchParams(window.location.search);
        const queryProxy = params.get("proxy") || params.get("proxyOrigin");
        const metaProxy = document.querySelector(`meta[name="${CONFIG.proxyMetaName}"]`);
        const storedProxy = safeStorageGet(CONFIG.proxyKey);
        return normalizeProxyBase(queryProxy || storedProxy || (metaProxy ? metaProxy.content : ""));
    }

    function saveProxyBase(value) {
        safeStorageSet(CONFIG.proxyKey, normalizeProxyBase(value));
    }

    function normalizeProxyBase(value) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
            return "";
        }

        try {
            const url = new URL(trimmed);
            if (!url.pathname || url.pathname === "/") {
                url.pathname = "/api";
            }
            return url.toString().replace(/\?$/, "");
        } catch (error) {
            return trimmed;
        }
    }

    function loadCachedSnapshot() {
        const raw = safeStorageGet(CONFIG.cacheKey);
        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function saveCachedSnapshot(snapshot) {
        safeStorageSet(CONFIG.cacheKey, JSON.stringify(snapshot));
    }

    function safeStorageGet(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            return "";
        }
    }

    function safeStorageSet(key, value) {
        try {
            if (!value) {
                window.localStorage.removeItem(key);
                return;
            }
            window.localStorage.setItem(key, value);
        } catch (error) {
            // Ignore storage failures in restricted browsing contexts.
        }
    }

    function getLatestUpdatedAt(rawData) {
        return Object.values(rawData || {})
            .map((item) => item && item.updatedAt)
            .filter(Boolean)
            .sort()
            .reverse()[0] || null;
    }

    function normalizeError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error || "Unknown error");
    }

    function dedupeStatuses(sourceStatuses) {
        const seen = new Set();
        return sourceStatuses.filter((item) => {
            const key = item.key || `${item.label}:${item.state}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    function uniqueStrings(values) {
        return Array.from(new Set(values.filter(Boolean)));
    }

    function parseDate(value) {
        if (!value) {
            return null;
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    function getSourceKeyForSymbol(symbol) {
        if (symbol === "^INDIAVIX") {
            return "vix";
        }
        if (symbol === "BZ=F") {
            return "brent";
        }
        if (symbol === "^NSEI") {
            return "nifty";
        }
        if (symbol === "INR=X") {
            return "usdInr";
        }
        return symbol;
    }

    function formatDateTime(value) {
        if (!value) {
            return "Data unavailable";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        return new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function formatNumber(value) {
        if (!Number.isFinite(value)) {
            return "Data unavailable";
        }
        return new Intl.NumberFormat("en-IN", {
            maximumFractionDigits: 2
        }).format(value);
    }

    function formatSignedNumber(value) {
        if (!Number.isFinite(value)) {
            return "0";
        }
        return `${value > 0 ? "+" : ""}${stripTrailingZero(round(value, 1))}`;
    }

    function formatSignedPercent(value) {
        if (!Number.isFinite(value)) {
            return "Data unavailable";
        }
        return `${value > 0 ? "+" : ""}${stripTrailingZero(round(value, 2))}%`;
    }

    function stripTrailingZero(value) {
        return String(value).replace(/\.0$/, "");
    }

    function round(value, digits) {
        if (!Number.isFinite(value)) {
            return null;
        }
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function average(values) {
        const filtered = values.filter((value) => Number.isFinite(value));
        if (!filtered.length) {
            return null;
        }
        return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, 2);
    }

    function applyMagnitudePenalty(score, penalty) {
        if (!penalty) {
            return round(score, 1);
        }
        if (score > 0) {
            return round(Math.max(0, score - penalty), 1);
        }
        if (score < 0) {
            return round(Math.min(0, score + penalty), 1);
        }
        return 0;
    }

    function joinLabels(items) {
        const labels = items.map((item) => item.label);
        if (!labels.length) {
            return "the broader signal set";
        }
        if (labels.length === 1) {
            return labels[0];
        }
        return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    }

    function toTitleCase(value) {
        return String(value || "")
            .split(/[\s_-]+/)
            .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : "")
            .join(" ");
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }
})();
