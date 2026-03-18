const { INSTRUMENTS, SOURCE_LABELS, SOURCE_LINKS, YAHOO_BASE_URL } = require("../config/sources");
const { fetchJson, normalizeError } = require("../utils/http");
const { createSourceStatus, createUnavailableInstrument, round, statusFromTimestamp } = require("../utils/formatters");

function getInstrumentCollection(collectionName) {
    return Object.values(INSTRUMENTS[collectionName] || {});
}

function mapYahooQuote(definition, rawChart) {
    const meta = rawChart?.chart?.result?.[0]?.meta;
    const quoteSeries = rawChart?.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = Array.isArray(quoteSeries?.close)
        ? quoteSeries.close.filter((value) => Number.isFinite(value))
        : [];

    if (!meta) {
        return createUnavailableInstrument(definition, "Yahoo Finance did not return this symbol.");
    }

    const transform = definition.transform === "yieldTenth" ? (value) => round(value / 10, 2) : (value) => round(value, 2);
    const lastPrice = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes.at(-1);
    const previousClose = Number.isFinite(meta.previousClose) ? meta.previousClose : (Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : closes.at(-2));
    const timestamp = meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : null;
    const change = Number.isFinite(lastPrice) && Number.isFinite(previousClose)
        ? lastPrice - previousClose
        : null;
    const changePercent = Number.isFinite(change) && Number.isFinite(previousClose) && previousClose !== 0
        ? (change / previousClose) * 100
        : null;

    return {
        key: definition.key,
        label: definition.label,
        symbol: definition.symbol,
        source: definition.source,
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(definition.symbol)}`,
        price: transform(Number(lastPrice)),
        change: transform(Number(change)),
        changePercent: round(Number(changePercent), 2),
        previousClose: transform(Number(previousClose)),
        open: transform(Number(meta.regularMarketOpen)),
        high: transform(Number(meta.regularMarketDayHigh)),
        low: transform(Number(meta.regularMarketDayLow)),
        updatedAt: timestamp,
        marketState: meta.marketState || "",
        status: statusFromTimestamp(timestamp, meta.marketState),
        reason: null
    };
}

async function fetchYahooQuotes(collectionName) {
    const definitions = getInstrumentCollection(collectionName);

    try {
        const quotes = {};
        const responses = await Promise.allSettled(definitions.map(async (definition) => {
            const url = `${YAHOO_BASE_URL}/${encodeURIComponent(definition.symbol)}?interval=1d&range=5d&includePrePost=true`;
            const { data } = await fetchJson(url, {
                headers: {
                    referer: "https://finance.yahoo.com/"
                }
            });

            return [definition.key, data];
        }));
        const responseMap = new Map();

        responses.forEach((response) => {
            if (response.status === "fulfilled") {
                responseMap.set(response.value[0], response.value[1]);
            }
        });

        definitions.forEach((definition) => {
            quotes[definition.key] = responseMap.has(definition.key)
                ? mapYahooQuote(definition, responseMap.get(definition.key))
                : createUnavailableInstrument(definition, "Yahoo Finance did not return a usable chart payload.");
        });

        const lastUpdated = definitions
            .map((definition) => quotes[definition.key]?.updatedAt)
            .find(Boolean) || null;

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
    } catch (error) {
        const reason = normalizeError(error);
        const quotes = {};

        definitions.forEach((definition) => {
            quotes[definition.key] = createUnavailableInstrument(definition, reason);
        });

        return {
            quotes,
            sourceStatus: createSourceStatus(
                collectionName,
                SOURCE_LABELS[collectionName],
                "error",
                reason,
                null,
                "Yahoo Finance",
                SOURCE_LINKS.yahooFinance
            )
        };
    }
}

module.exports = {
    fetchYahooQuotes
};
