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
                    "[data-name='legend-source-item'] [data-value]",
                    ".priceWrapper-"
                ],
                changePercent: [
                    "[data-field-key='chp']",
                    "[data-name='legend-source-item'] .changePercent-"
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
                    ".market-depth .price",
                    ".quote .last-price"
                ],
                changePercent: [
                    ".dim",
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
                    ".marketwatch-container"
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
            /\b(BANKNIFTY|NIFTY|FINNIFTY|MIDCPNIFTY|SENSEX)\b/i
        ],
        spotPrice: [
            /\b(?:Spot|Index|LTP|Last(?:\s+Price)?)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
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
        FIELD_PATTERNS,
        SIGNAL_PATTERNS,
        SITE_ADAPTERS,
        detectSiteAdapter,
        getAdapterById
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
