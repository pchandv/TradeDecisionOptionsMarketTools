(function (global) {
    "use strict";

    const SITE_ADAPTERS = [
        {
            id: "tradingview",
            name: "TradingView",
            hostPatterns: ["tradingview.com"],
            selectors: {
                instrument: [
                    "[data-symbol-short]",
                    "[data-name='legend-source-title']",
                    "[data-name='header-toolbar-symbol-search']"
                ],
                spotPrice: [
                    "[data-field-key='last']",
                    "[data-name='legend-source-item'] [data-value]"
                ],
                changePercent: [
                    "[data-field-key='chp']",
                    "[data-name='legend-source-item'] .changePercent-"
                ],
                vwap: [
                    "[data-name='legend-source-item']",
                    ".valuesWrapper-"
                ],
                rawSignalTexts: [
                    "[data-name='legend-source-item']",
                    ".valuesWrapper-"
                ]
            }
        },
        {
            id: "zerodha-kite",
            name: "Zerodha Kite",
            hostPatterns: ["kite.zerodha.com"],
            selectors: {
                instrument: [
                    ".instrument-name",
                    ".tradingsymbol",
                    ".nice-name"
                ],
                spotPrice: [
                    ".last-price",
                    ".quote .last-price"
                ],
                changePercent: [
                    ".change-percent",
                    ".percent-change"
                ],
                support: [
                    "[data-label='Support']",
                    ".support-value"
                ],
                resistance: [
                    "[data-label='Resistance']",
                    ".resistance-value"
                ],
                rawSignalTexts: [
                    ".order-window",
                    ".marketwatch-container",
                    ".market-depth"
                ]
            }
        },
        {
            id: "custom-page",
            name: "Custom Hosted Page",
            hostPatterns: ["localhost", "127.0.0.1", "github.io"],
            selectors: {
                instrument: [
                    "[data-ota-field='instrument']",
                    "[data-ota-instrument]"
                ],
                spotPrice: [
                    "[data-ota-field='spotPrice']",
                    "[data-ota-spot-price]"
                ],
                openPrice: [
                    "[data-ota-field='openPrice']",
                    "[data-ota-open-price]"
                ],
                previousClose: [
                    "[data-ota-field='previousClose']",
                    "[data-ota-previous-close]"
                ],
                dayHigh: [
                    "[data-ota-field='dayHigh']",
                    "[data-ota-day-high]"
                ],
                dayLow: [
                    "[data-ota-field='dayLow']",
                    "[data-ota-day-low]"
                ],
                changePercent: [
                    "[data-ota-field='changePercent']",
                    "[data-ota-change-percent]"
                ],
                pcr: [
                    "[data-ota-field='pcr']",
                    "[data-ota-pcr]"
                ],
                vix: [
                    "[data-ota-field='vix']",
                    "[data-ota-vix]"
                ],
                atmIv: [
                    "[data-ota-field='atmIv']",
                    "[data-ota-atm-iv]"
                ],
                maxPain: [
                    "[data-ota-field='maxPain']",
                    "[data-ota-max-pain]"
                ],
                support: [
                    "[data-ota-field='support']",
                    "[data-ota-support]"
                ],
                resistance: [
                    "[data-ota-field='resistance']",
                    "[data-ota-resistance]"
                ],
                callOi: [
                    "[data-ota-field='callOi']",
                    "[data-ota-call-oi]"
                ],
                putOi: [
                    "[data-ota-field='putOi']",
                    "[data-ota-put-oi]"
                ],
                vwap: [
                    "[data-ota-field='vwap']",
                    "[data-ota-vwap]"
                ],
                movingAverage: [
                    "[data-ota-field='movingAverage']",
                    "[data-ota-moving-average]"
                ],
                giftNifty: [
                    "[data-ota-field='giftNifty']",
                    "[data-ota-gift-nifty]"
                ],
                dowFutures: [
                    "[data-ota-field='dowFutures']",
                    "[data-ota-dow-futures]"
                ],
                nasdaqFutures: [
                    "[data-ota-field='nasdaqFutures']",
                    "[data-ota-nasdaq-futures]"
                ],
                crude: [
                    "[data-ota-field='crude']",
                    "[data-ota-crude]"
                ],
                dxy: [
                    "[data-ota-field='dxy']",
                    "[data-ota-dxy]"
                ],
                usYield: [
                    "[data-ota-field='usYield']",
                    "[data-ota-us-yield]"
                ],
                rawSignalTexts: [
                    "[data-ota-field='signal']",
                    "[data-ota-signal]",
                    "[data-ota-field]"
                ]
            }
        },
        {
            id: "generic",
            name: "Generic Website",
            hostPatterns: [],
            selectors: {
                instrument: [
                    "h1",
                    "header h1",
                    "title"
                ],
                rawSignalTexts: [
                    "main",
                    "body"
                ]
            }
        }
    ];

    const FIELD_PATTERNS = {
        instrument: [
            /\b(BANKNIFTY|NIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|RELIANCE|HDFC\s*BANK|HDFCBANK|TCS|INFY|ICICI\s*BANK|ICICIBANK|SBIN|L&T|LT)\b/i
        ],
        spotPrice: [
            /\b(?:Spot|Index|LTP|Last(?:\s+Price)?)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        openPrice: [
            /\b(?:Open|Opening Price)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        previousClose: [
            /\b(?:Prev(?:ious)?\s*Close|Previous Close)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        dayHigh: [
            /\b(?:Day High|High)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        dayLow: [
            /\b(?:Day Low|Low)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        changePercent: [
            /\b(?:Change|Chg|Change %|Percent Change)\s*[:\-]?\s*(-?[0-9]+(?:\.[0-9]+)?)\s*%/i,
            /\((-?[0-9]+(?:\.[0-9]+)?)%\)/i
        ],
        pcr: [
            /\bPCR\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/i,
            /\bPut\s*Call\s*Ratio\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/i
        ],
        vix: [
            /\b(?:India\s*VIX|VIX)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/i
        ],
        atmIv: [
            /\b(?:ATM\s*IV|IV)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/i
        ],
        maxPain: [
            /\bMax\s*Pain\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        support: [
            /\b(?:Support|S1|Primary Support)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        resistance: [
            /\b(?:Resistance|R1|Primary Resistance)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        callOi: [
            /\b(?:Call\s*OI|CE\s*OI|Call Open Interest)\s*[:\-]?\s*([0-9.,\sKMBLCR]+)/i
        ],
        putOi: [
            /\b(?:Put\s*OI|PE\s*OI|Put Open Interest)\s*[:\-]?\s*([0-9.,\sKMBLCR]+)/i
        ],
        vwap: [
            /\bVWAP\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        movingAverage: [
            /\b(?:MA|Moving Average|EMA|SMA)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
        ],
        giftNifty: [
            /\b(?:GIFT\s*NIFTY)\s*[:\-]?\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i
        ],
        dowFutures: [
            /\b(?:Dow(?:\s*Futures)?|US30)\s*[:\-]?\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i
        ],
        nasdaqFutures: [
            /\b(?:Nasdaq(?:\s*Futures)?|US100)\s*[:\-]?\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i
        ],
        crude: [
            /\b(?:Crude|Brent)\s*[:\-]?\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i
        ],
        dxy: [
            /\b(?:DXY|Dollar Index)\s*[:\-]?\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i
        ],
        usYield: [
            /\b(?:US Yield|10Y Yield|UST 10Y)\s*[:\-]?\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i
        ]
    };

    const SIGNAL_PATTERNS = {
        bullish: [
            /\bBULLISH\b/i,
            /\bBUY\b/i,
            /\bUPTREND\b/i,
            /\bLONG\b/i
        ],
        bearish: [
            /\bBEARISH\b/i,
            /\bSELL\b/i,
            /\bDOWNTREND\b/i,
            /\bSHORT\b/i
        ],
        neutral: [
            /\bNEUTRAL\b/i,
            /\bSIDEWAYS\b/i
        ],
        wait: [
            /\bWAIT\b/i,
            /\bNO\s*TRADE\b/i
        ]
    };

    function detectSiteAdapter(url) {
        const normalizedUrl = String(url || "");
        const adapter = SITE_ADAPTERS.find((candidate) => candidate.hostPatterns.some((pattern) => normalizedUrl.includes(pattern)));
        return adapter || SITE_ADAPTERS[SITE_ADAPTERS.length - 1];
    }

    function getAdapterById(id) {
        return SITE_ADAPTERS.find((adapter) => adapter.id === id) || SITE_ADAPTERS[SITE_ADAPTERS.length - 1];
    }

    global.OptionsSiteSelectors = {
        FIELD_PATTERNS: FIELD_PATTERNS,
        SIGNAL_PATTERNS: SIGNAL_PATTERNS,
        SITE_ADAPTERS: SITE_ADAPTERS,
        detectSiteAdapter: detectSiteAdapter,
        getAdapterById: getAdapterById
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
