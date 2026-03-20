const port = Number(process.env.PORT || 3000);
const httpTimeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 15000);
const alphaVantageApiKey = String(process.env.ALPHA_VANTAGE_API_KEY || "").trim();
const alphaVantageCacheHours = Number(process.env.ALPHA_VANTAGE_CACHE_HOURS || 24);

const COMMON_HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    accept: "application/json, text/plain, */*",
    "accept-language": "en-IN,en-US;q=0.9,en;q=0.8",
    pragma: "no-cache",
    "cache-control": "no-cache"
};

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const NSE_BASE_URL = "https://www.nseindia.com";
const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";

// Keep live source URLs and symbol mappings centralized so adding or replacing feeds stays isolated here.
const INSTRUMENTS = {
    yahooMarket: {
        sensex: { key: "sensex", label: "SENSEX", symbol: "^BSESN", source: "Yahoo Finance", group: "india" },
        nasdaqFutures: { key: "nasdaqFutures", label: "Nasdaq Futures", symbol: "NQ=F", source: "Yahoo Finance", group: "global" },
        sp500Futures: { key: "sp500Futures", label: "S&P 500 Futures", symbol: "ES=F", source: "Yahoo Finance", group: "global" },
        dowFutures: { key: "dowFutures", label: "Dow Futures", symbol: "YM=F", source: "Yahoo Finance", group: "global" },
        nikkei: { key: "nikkei", label: "Nikkei 225", symbol: "^N225", source: "Yahoo Finance", group: "global" },
        hangSeng: { key: "hangSeng", label: "Hang Seng", symbol: "^HSI", source: "Yahoo Finance", group: "global" },
        asx200: { key: "asx200", label: "ASX 200", symbol: "^AXJO", source: "Yahoo Finance", group: "global" }
    },
    yahooMacro: {
        us10y: { key: "us10y", label: "US 10Y Yield", symbol: "^TNX", source: "Yahoo Finance", group: "macro" },
        dxy: { key: "dxy", label: "Dollar Index (DXY Proxy)", symbol: "DX=F", source: "Yahoo Finance", group: "macro" },
        crude: { key: "crude", label: "WTI Crude", symbol: "CL=F", source: "Yahoo Finance", group: "macro" },
        brent: { key: "brent", label: "Brent Crude", symbol: "BZ=F", source: "Yahoo Finance", group: "macro" },
        gold: { key: "gold", label: "Gold", symbol: "GC=F", source: "Yahoo Finance", group: "macro" },
        silver: { key: "silver", label: "Silver", symbol: "SI=F", source: "Yahoo Finance", group: "macro" },
        naturalGas: { key: "naturalGas", label: "Natural Gas", symbol: "NG=F", source: "Yahoo Finance", group: "macro" }
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

const NSE_ENDPOINTS = {
    home: `${NSE_BASE_URL}/`,
    marketStatus: `${NSE_BASE_URL}/api/marketStatus`,
    allIndices: `${NSE_BASE_URL}/api/allIndices`,
    quoteEquity: (symbol) => `${NSE_BASE_URL}/api/quote-equity?symbol=${encodeURIComponent(symbol)}`,
    fiiDiiCombined: `${NSE_BASE_URL}/api/fiidiiTradeReact`,
    fiiDiiNseOnly: `${NSE_BASE_URL}/api/fiidiiTradeNse`,
    oiSpurts: `${NSE_BASE_URL}/api/live-analysis-oi-spurts-underlyings`,
    optionChainContractInfo: (symbol) => `${NSE_BASE_URL}/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`,
    optionChainV3: (symbol, expiry) => `${NSE_BASE_URL}/api/option-chain-v3?type=Indices&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`
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
    minimumConfidence: 64,
    vwapBandPercent: 0.18,
    openingGapPercent: 0.25,
    noTradePcrLow: 0.9,
    noTradePcrHigh: 1.1,
    lowRelativeVolume: 0.9,
    supportResistanceBufferPercent: 0.35,
    scoreThresholds: {
        directional: 3,
        strongDirectional: 6
    },
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
    }
};

const SOURCE_LABELS = {
    alphaVantageFundamentals: "Alpha Vantage Fundamentals",
    yahooMarket: "Yahoo Finance Markets",
    yahooMacro: "Yahoo Finance Macro",
    yahooIntraday: "Yahoo Finance Intraday",
    nseIndices: "NSE All Indices",
    nseEquityQuotes: "NSE Equity Quotes",
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
    alphaVantageDocs: "https://www.alphavantage.co/documentation/",
    alphaVantageKeySignup: "https://www.alphavantage.co/support/#api-key",
    yahooFinance: "https://finance.yahoo.com/",
    nseIndices: `${NSE_BASE_URL}/api/allIndices`,
    nseEquityQuote: (symbol) => `${NSE_BASE_URL}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
    nseMarketStatus: `${NSE_BASE_URL}/api/marketStatus`,
    nseOptionChain: `${NSE_BASE_URL}/option-chain`,
    nseBankOptionChain: `${NSE_BASE_URL}/option-chain`,
    nseFiiDii: `${NSE_BASE_URL}/reports/fii-dii`,
    nseOiSpurts: `${NSE_BASE_URL}/market-data/analysis-and-tools-derivatives-market-snapshot`,
    indiaNews: NEWS_FEEDS.india.url,
    usNews: NEWS_FEEDS.us.url,
    macroNews: NEWS_FEEDS.macro.url
};

// Starter universe for the investing module. This is a curated liquid large-cap list, not a full market screener.
const INVESTING_UNIVERSE = [
    { symbol: "RELIANCE", alphaVantageSymbol: "RELIANCE.BSE" },
    { symbol: "TCS", alphaVantageSymbol: "TCS.BSE" },
    { symbol: "INFY", alphaVantageSymbol: "INFY.BSE" },
    { symbol: "HDFCBANK", alphaVantageSymbol: "HDFCBANK.BSE" },
    { symbol: "ICICIBANK", alphaVantageSymbol: "ICICIBANK.BSE" },
    { symbol: "LT", alphaVantageSymbol: "LT.BSE" },
    { symbol: "HINDUNILVR", alphaVantageSymbol: "HINDUNILVR.BSE" },
    { symbol: "ITC", alphaVantageSymbol: "ITC.BSE" },
    { symbol: "SUNPHARMA", alphaVantageSymbol: "SUNPHARMA.BSE" },
    { symbol: "MARUTI", alphaVantageSymbol: "MARUTI.BSE" }
];

module.exports = {
    ALPHA_VANTAGE_BASE_URL,
    COMMON_HEADERS,
    INVESTING_UNIVERSE,
    DECISION_CONFIG,
    INSTRUMENTS,
    INTRADAY_MARKET_SYMBOLS,
    NEWS_FEEDS,
    NSE_BASE_URL,
    NSE_ENDPOINTS,
    SERVER: {
        port
    },
    SIGNAL_CONFIG,
    SOURCE_LABELS,
    SOURCE_LINKS,
    TIMEOUTS: {
        alphaVantageCacheHours,
        http: httpTimeoutMs
    },
    TOKENS: {
        alphaVantageApiKey
    },
    YAHOO_BASE_URL
};
