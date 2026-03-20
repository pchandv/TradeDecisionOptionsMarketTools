const {
    INTRADAY_MARKET_SYMBOLS,
    SOURCE_LABELS,
    SOURCE_LINKS,
    YAHOO_BASE_URL
} = require("../config/sources");
const { fetchJson, normalizeError } = require("../utils/http");
const { createSourceStatus, round, statusFromTimestamp, toNumber } = require("../utils/formatters");

function buildYahooQuoteUrl(symbol) {
    return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

async function fetchYahooChart(symbol, interval = "5m", range = "1d") {
    const url = `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=true`;
    const { data } = await fetchJson(url, {
        headers: {
            referer: "https://finance.yahoo.com/"
        }
    });

    return data;
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

async function fetchIntradayContext() {
    const chartRequests = [
        { key: "NIFTY", symbol: INTRADAY_MARKET_SYMBOLS.NIFTY.indexSymbol },
        { key: "NIFTY_PROXY", symbol: INTRADAY_MARKET_SYMBOLS.NIFTY.vwapProxySymbol },
        { key: "BANKNIFTY", symbol: INTRADAY_MARKET_SYMBOLS.BANKNIFTY.indexSymbol },
        { key: "BANKNIFTY_PROXY", symbol: INTRADAY_MARKET_SYMBOLS.BANKNIFTY.vwapProxySymbol },
        { key: "INDIA_VIX", symbol: INTRADAY_MARKET_SYMBOLS.INDIA_VIX.indexSymbol }
    ];

    const responses = await Promise.allSettled(chartRequests.map(async (request) => {
        const data = await fetchYahooChart(request.symbol);
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
            ? buildInstrumentContext(
                INTRADAY_MARKET_SYMBOLS.NIFTY,
                charts.get("NIFTY"),
                charts.get("NIFTY_PROXY") || null
            )
            : null,
        BANKNIFTY: charts.has("BANKNIFTY")
            ? buildInstrumentContext(
                INTRADAY_MARKET_SYMBOLS.BANKNIFTY,
                charts.get("BANKNIFTY"),
                charts.get("BANKNIFTY_PROXY") || null
            )
            : null,
        INDIA_VIX: charts.has("INDIA_VIX")
            ? buildInstrumentContext(INTRADAY_MARKET_SYMBOLS.INDIA_VIX, charts.get("INDIA_VIX"))
            : null
    };

    const liveContexts = Object.values(contexts).filter((context) => context?.price);
    const lastUpdated = liveContexts
        .map((context) => context.updatedAt)
        .find(Boolean) || null;

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

async function safeFetchIntradayContext() {
    try {
        return await fetchIntradayContext();
    } catch (error) {
        return {
            instruments: {
                NIFTY: null,
                BANKNIFTY: null,
                INDIA_VIX: null
            },
            sourceStatuses: [
                createSourceStatus(
                    "yahooIntraday",
                    SOURCE_LABELS.yahooIntraday,
                    "error",
                    normalizeError(error),
                    null,
                    "Yahoo Finance",
                    SOURCE_LINKS.yahooFinance
                )
            ]
        };
    }
}

module.exports = {
    fetchIntradayContext: safeFetchIntradayContext
};
