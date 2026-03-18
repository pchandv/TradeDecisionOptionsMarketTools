const { NSE_ENDPOINTS, SOURCE_LABELS, SOURCE_LINKS } = require("../config/sources");
const { fetchJson, fetchText, normalizeError } = require("../utils/http");
const {
    createSourceStatus,
    parseMarketDate,
    round,
    statusFromTimestamp,
    toNumber
} = require("../utils/formatters");

let nseSession = {
    cookieHeader: "",
    fetchedAt: 0
};

async function refreshNseSession() {
    const { headers } = await fetchText(NSE_ENDPOINTS.home, {
        headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            referer: NSE_ENDPOINTS.home
        }
    });

    const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    nseSession = {
        cookieHeader: cookies.map((cookie) => cookie.split(";")[0]).join("; "),
        fetchedAt: Date.now()
    };
}

async function fetchNseJson(url, options = {}) {
    const referer = options.referer || NSE_ENDPOINTS.home;

    if (!nseSession.cookieHeader || (Date.now() - nseSession.fetchedAt) > (20 * 60 * 1000)) {
        await refreshNseSession();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const { data } = await fetchJson(url, {
                timeoutMs: options.timeoutMs,
                headers: {
                    referer,
                    cookie: nseSession.cookieHeader
                }
            });

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

            await refreshNseSession();
        }
    }

    throw new Error("Unable to establish a usable NSE session.");
}

function mapIndexInstrument(rawIndex, key, label, fetchedAt, marketState) {
    const updatedAt = fetchedAt || parseMarketDate(rawIndex.previousDay);
    const status = statusFromTimestamp(updatedAt, marketState || "OPEN");
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
        status,
        advances: toNumber(rawIndex.advances),
        declines: toNumber(rawIndex.declines),
        unchanged: toNumber(rawIndex.unchanged),
        reason: null
    };
}

function mapEquityQuote(rawQuote) {
    const lastUpdateTime = parseMarketDate(rawQuote?.metadata?.lastUpdateTime);
    const weekHighLow = rawQuote?.priceInfo?.weekHighLow || {};
    const issuedSize = toNumber(rawQuote?.securityInfo?.issuedSize);
    const lastPrice = toNumber(rawQuote?.priceInfo?.lastPrice);

    return {
        key: String(rawQuote?.info?.symbol || "").toLowerCase(),
        symbol: rawQuote?.info?.symbol || null,
        companyName: rawQuote?.info?.companyName || rawQuote?.info?.symbol || "Unknown company",
        industry: rawQuote?.industryInfo?.basicIndustry || rawQuote?.industryInfo?.industry || rawQuote?.info?.industry || "Unavailable",
        sector: rawQuote?.industryInfo?.sector || rawQuote?.metadata?.pdSectorInd || "Unavailable",
        source: "NSE India",
        sourceUrl: SOURCE_LINKS.nseEquityQuote(rawQuote?.info?.symbol || ""),
        price: lastPrice,
        change: toNumber(rawQuote?.priceInfo?.change),
        changePercent: toNumber(rawQuote?.priceInfo?.pChange),
        previousClose: toNumber(rawQuote?.priceInfo?.previousClose),
        open: toNumber(rawQuote?.priceInfo?.open),
        high: toNumber(rawQuote?.priceInfo?.intraDayHighLow?.max),
        low: toNumber(rawQuote?.priceInfo?.intraDayHighLow?.min),
        weekHigh: toNumber(weekHighLow.max),
        weekLow: toNumber(weekHighLow.min),
        weekHighDate: weekHighLow.maxDate || null,
        weekLowDate: weekHighLow.minDate || null,
        symbolPe: toNumber(rawQuote?.metadata?.pdSymbolPe),
        sectorPe: toNumber(rawQuote?.metadata?.pdSectorPe),
        marketCapApprox: Number.isFinite(issuedSize) && Number.isFinite(lastPrice)
            ? round(issuedSize * lastPrice, 2)
            : null,
        updatedAt: lastUpdateTime,
        status: statusFromTimestamp(lastUpdateTime, "OPEN"),
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
            expiryDate: row.expiryDates || null,
            strikePrice: toNumber(row.strikePrice),
            CE: mapOptionLeg(row.CE, "CE"),
            PE: mapOptionLeg(row.PE, "PE")
        }))
        .filter((row) => Number.isFinite(row.strikePrice));
    const expiries = (contractInfo?.expiryDates || [])
        .filter((value) => typeof value === "string" && value.trim());
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

async function fetchOptionChain(symbol, options = {}) {
    const contractInfo = await fetchNseJson(NSE_ENDPOINTS.optionChainContractInfo(symbol), {
        referer: `${NSE_ENDPOINTS.home}option-chain`,
        timeoutMs: 30000
    });
    const expiryCount = Number.isFinite(Number(options.expiryCount)) ? Number(options.expiryCount) : 1;
    const expiryDates = (contractInfo.expiryDates || []).slice(0, Math.max(1, expiryCount));
    if (!expiryDates.length) {
        throw new Error(`No expiry dates returned for ${symbol}.`);
    }

    const optionChains = await Promise.all(expiryDates.map((expiry) => fetchNseJson(
        NSE_ENDPOINTS.optionChainV3(symbol, expiry),
        {
            referer: `${NSE_ENDPOINTS.home}option-chain`,
            timeoutMs: 30000
        }
    )));

    return buildOptionChainData(symbol, contractInfo, optionChains);
}

async function fetchNseEquityQuotes(symbols = []) {
    const normalizedSymbols = symbols
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean);

    try {
        const responses = await Promise.allSettled(normalizedSymbols.map(async (symbol) => {
            const data = await fetchNseJson(NSE_ENDPOINTS.quoteEquity(symbol), {
                referer: SOURCE_LINKS.nseEquityQuote(symbol),
                timeoutMs: 30000
            });
            return mapEquityQuote(data);
        }));

        const quotes = responses
            .filter((item) => item.status === "fulfilled")
            .map((item) => item.value);
        const lastUpdated = quotes.map((quote) => quote.updatedAt).find(Boolean) || null;

        return {
            quotes,
            sourceStatus: createSourceStatus(
                "nseEquityQuotes",
                SOURCE_LABELS.nseEquityQuotes,
                quotes.length ? "live" : "unavailable",
                quotes.length
                    ? `Fetched ${quotes.length}/${normalizedSymbols.length} NSE equity quotes for the investing watchlist.`
                    : "No NSE equity quotes were returned for the investing watchlist.",
                lastUpdated,
                "NSE India",
                SOURCE_LINKS.nseIndices
            )
        };
    } catch (error) {
        return {
            quotes: [],
            sourceStatus: createSourceStatus(
                "nseEquityQuotes",
                SOURCE_LABELS.nseEquityQuotes,
                "error",
                normalizeError(error),
                null,
                "NSE India",
                SOURCE_LINKS.nseIndices
            )
        };
    }
}

async function fetchNseSnapshot(options = {}) {
    const snapshotFetchedAt = new Date().toISOString();
    const preferredInstrument = String(options.preferredInstrument || "NIFTY").toUpperCase();
    const expiryPreference = String(options.expiryPreference || "current").toLowerCase();
    const needsBankTradePlan = preferredInstrument === "BANKNIFTY";
    const preferredExpiryCount = expiryPreference === "next" ? 2 : 1;
    const coreTasks = await Promise.allSettled([
        fetchNseJson(NSE_ENDPOINTS.allIndices),
        fetchNseJson(NSE_ENDPOINTS.marketStatus)
    ]);
    const optionTasks = await Promise.allSettled([
        fetchOptionChain("NIFTY", { expiryCount: needsBankTradePlan ? 1 : preferredExpiryCount }),
        needsBankTradePlan ? fetchOptionChain("BANKNIFTY", { expiryCount: preferredExpiryCount }) : Promise.resolve(null)
    ]);
    const flowTasks = await Promise.allSettled([
        fetchNseJson(NSE_ENDPOINTS.fiiDiiCombined, { referer: `${NSE_ENDPOINTS.home}reports/fii-dii` }),
        fetchNseJson(NSE_ENDPOINTS.fiiDiiNseOnly, { referer: `${NSE_ENDPOINTS.home}reports/fii-dii` }),
        fetchNseJson(NSE_ENDPOINTS.oiSpurts, { referer: `${NSE_ENDPOINTS.home}market-data/analysis-and-tools-derivatives-market-snapshot` })
    ]);

    const [
        allIndicesResult,
        marketStatusResult
    ] = coreTasks;
    const [
        optionChainResult,
        bankOptionChainResult
    ] = optionTasks;
    const [
        fiiCombinedResult,
        fiiNseResult,
        oiSpurtsResult
    ] = flowTasks;
    const sourceStatuses = [];

    const indexData = allIndicesResult.status === "fulfilled" ? allIndicesResult.value?.data || [] : [];
    const marketStatus = marketStatusResult.status === "fulfilled" ? marketStatusResult.value : null;
    const niftyRaw = indexData.find((item) => item.index === "NIFTY 50");
    const bankNiftyRaw = indexData.find((item) => item.index === "NIFTY BANK");
    const vixRaw = indexData.find((item) => item.index === "INDIA VIX");

    const capitalMarketState = marketStatus?.marketState?.find((item) => item.market === "Capital Market");
    const giftNiftyRaw = marketStatus?.giftnifty || null;
    const giftTimestamp = parseMarketDate(giftNiftyRaw?.TIMESTMP);

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
                "NSE India"
                , SOURCE_LINKS.nseMarketStatus
            )
            : createSourceStatus("nseMarketStatus", SOURCE_LABELS.nseMarketStatus, "error", normalizeError(marketStatusResult.reason), null, "NSE India", SOURCE_LINKS.nseMarketStatus)
    );

    sourceStatuses.push(
        optionChainResult.status === "fulfilled"
            ? createSourceStatus(
                "nseOptionChain",
                SOURCE_LABELS.nseOptionChain,
                statusFromTimestamp(optionChainResult.value.timestamp, "CLOSED"),
                "NSE option chain loaded for the nearest two NIFTY expiries.",
                optionChainResult.value.timestamp,
                "NSE India"
                , SOURCE_LINKS.nseOptionChain
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
                    "NSE option chain loaded for the nearest two BANKNIFTY expiries.",
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
                "NSE India"
                , SOURCE_LINKS.nseFiiDii
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
                "NSE India"
                , SOURCE_LINKS.nseOiSpurts
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
        marketStatus: marketStatus,
        sourceStatuses
    };
}

module.exports = {
    fetchNseEquityQuotes,
    fetchNseSnapshot
};
