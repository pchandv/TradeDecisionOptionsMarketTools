(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    function createEmptyDiagnostics() {
        return {
            generatedAt: null,
            enabled: false,
            sourceTypesByTab: [],
            rawFieldsByTab: [],
            mergedMarketContext: {},
            scoreBreakdown: {},
            confidenceReducers: [],
            missingFields: {
                critical: [],
                optional: []
            },
            historyLengthByTab: [],
            supportResistanceSource: "none",
            premiumSource: "NONE",
            warnings: []
        };
    }

    function buildDiagnostics(args) {
        const payload = args || {};
        const state = payload.state || {};
        const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots.filter(Boolean) : [];
        const marketContext = payload.marketContext || {};
        const aggregate = payload.aggregate || {};
        const overall = aggregate.overall || state.overallSignal || Utils.createEmptyOverallSignal();
        const tradePlan = payload.tradePlan || state.latestTradePlan || Utils.createEmptyTradePlan();
        const premiumTradePlan = tradePlan.premiumTradePlan || payload.premiumTradePlan || Utils.createEmptyPremiumTradePlan();
        const settings = state.settings || Utils.DEFAULT_SETTINGS;

        const sourceTypesByTab = snapshots.map((snapshot) => ({
            tabId: snapshot.tabId,
            sourceType: snapshot.sourceType || snapshot.siteType || "unknown-source",
            title: snapshot.pageTitle || snapshot.title || "",
            url: snapshot.url || "",
            instrument: snapshot.instrument || "UNKNOWN"
        }));

        const rawFieldsByTab = snapshots.map((snapshot) => {
            const values = snapshot.values || {};
            const present = Object.keys(values).filter((key) => Number.isFinite(values[key]));
            const missingCritical = CRITICAL_FIELDS.filter((field) => !Number.isFinite(values[field]));
            return {
                tabId: snapshot.tabId,
                extractionMethod: snapshot.extractionMeta && snapshot.extractionMeta.method
                    ? snapshot.extractionMeta.method
                    : snapshot.extractorMeta && snapshot.extractorMeta.method
                        ? snapshot.extractorMeta.method
                        : "unknown",
                extractionConfidence: snapshot.extractionMeta && Number.isFinite(snapshot.extractionMeta.confidence)
                    ? snapshot.extractionMeta.confidence
                    : snapshot.extractorMeta && Number.isFinite(snapshot.extractorMeta.confidence)
                        ? snapshot.extractorMeta.confidence
                        : 0,
                presentFields: present,
                missingCriticalFields: missingCritical,
                optionChainRows: snapshot.optionChain && Array.isArray(snapshot.optionChain.strikes)
                    ? snapshot.optionChain.strikes.length
                    : 0,
                warnings: (snapshot.extractionMeta && snapshot.extractionMeta.warnings)
                    || (snapshot.extractorMeta && snapshot.extractorMeta.warnings)
                    || []
            };
        });

        const mergedMarketContext = {
            instrument: marketContext.instrument || state.selectedInstrument || "UNKNOWN",
            type: marketContext.type || Utils.getInstrumentType(marketContext.instrument || state.selectedInstrument || "NIFTY"),
            spotPrice: safeNumber(marketContext.spotPrice),
            support: safeNumber(marketContext.support),
            resistance: safeNumber(marketContext.resistance),
            marketRegime: marketContext.marketRegime || "BALANCED",
            trend: marketContext.trend || "SIDEWAYS",
            newsSentiment: marketContext.newsSentiment || "NEUTRAL"
        };

        const scoreBreakdown = {
            marketBias: overall.signal || "WAIT",
            confidence: safeNumber(overall.confidence),
            strength: overall.strength || "WEAK",
            bullishScore: safeNumber(overall.bullishScore),
            bearishScore: safeNumber(overall.bearishScore),
            score: safeNumber(overall.score),
            tradeStatus: tradePlan.status || "NO_TRADE",
            tradeDirection: tradePlan.direction || "NONE",
            premiumSetupQuality: premiumTradePlan.setupQuality || "AVOID"
        };

        const missingFields = computeMissingFields(snapshots);
        const confidenceReducers = collectConfidenceReducers({
            overall: overall,
            snapshots: snapshots,
            missingFields: missingFields,
            settings: settings,
            tradePlan: tradePlan,
            premiumTradePlan: premiumTradePlan
        });

        const historyLengthByTab = Object.keys(state.snapshotsByTab || {}).map((tabId) => ({
            tabId: Number(tabId),
            length: Array.isArray(state.snapshotsByTab[tabId]) ? state.snapshotsByTab[tabId].length : 0
        }));

        const supportResistanceSource = resolveSupportResistanceSource(snapshots, state.latestSupportResistance);
        const premiumSource = premiumTradePlan && premiumTradePlan.contract
            ? premiumTradePlan.contract.premiumSource || "NONE"
            : "NONE";

        const warnings = [];
        if (overall.signal === "WAIT" && (overall.confidence || 0) < 25) {
            warnings.push("Final bias is WAIT with low confidence.");
        }
        if (premiumSource === "ESTIMATED") {
            warnings.push("Premium trade uses estimated premium.");
        }
        if (!Number.isFinite(mergedMarketContext.support) || !Number.isFinite(mergedMarketContext.resistance)) {
            warnings.push("Support/resistance levels are not fully available.");
        }

        return {
            generatedAt: new Date().toISOString(),
            enabled: settings.diagnosticsMode === true,
            sourceTypesByTab: sourceTypesByTab,
            rawFieldsByTab: rawFieldsByTab,
            mergedMarketContext: mergedMarketContext,
            scoreBreakdown: scoreBreakdown,
            confidenceReducers: confidenceReducers,
            missingFields: missingFields,
            historyLengthByTab: historyLengthByTab,
            supportResistanceSource: supportResistanceSource,
            premiumSource: premiumSource,
            warnings: warnings
        };
    }

    const CRITICAL_FIELDS = ["spotPrice"];
    const OPTIONAL_FIELDS = ["pcr", "vix", "maxPain", "support", "resistance", "vwap", "callOi", "putOi"];

    function computeMissingFields(snapshots) {
        if (!snapshots.length) {
            return {
                critical: CRITICAL_FIELDS.slice(),
                optional: OPTIONAL_FIELDS.slice()
            };
        }

        const flattened = Utils.createEmptyValues();
        Object.keys(flattened).forEach((field) => {
            flattened[field] = Utils.averageNumbers(snapshots.map((snapshot) => snapshot.values && snapshot.values[field]));
        });

        return {
            critical: CRITICAL_FIELDS.filter((field) => !Number.isFinite(flattened[field])),
            optional: OPTIONAL_FIELDS.filter((field) => !Number.isFinite(flattened[field]))
        };
    }

    function collectConfidenceReducers(args) {
        const overall = args.overall || Utils.createEmptyOverallSignal();
        const snapshots = Array.isArray(args.snapshots) ? args.snapshots : [];
        const missing = args.missingFields || { critical: [], optional: [] };
        const settings = args.settings || Utils.DEFAULT_SETTINGS;
        const tradePlan = args.tradePlan || Utils.createEmptyTradePlan();
        const premiumTradePlan = args.premiumTradePlan || Utils.createEmptyPremiumTradePlan();
        const reducers = [];

        if (missing.critical.length) {
            reducers.push(`Missing critical fields: ${missing.critical.join(", ")}`);
        }
        if (missing.optional.length >= 4) {
            reducers.push(`Several optional fields are missing: ${missing.optional.join(", ")}`);
        }
        if (Array.isArray(overall.riskFlags) && overall.riskFlags.length) {
            reducers.push(...overall.riskFlags.slice(0, 5));
        }
        if (tradePlan.status === "WAIT_CONFIRMATION") {
            reducers.push("Trade readiness is WAIT_CONFIRMATION.");
        }
        if (tradePlan.status === "NO_TRADE") {
            reducers.push("Trade readiness is NO_TRADE.");
        }
        if (premiumTradePlan.contract && premiumTradePlan.contract.premiumSource === "ESTIMATED") {
            reducers.push("Premium source is ESTIMATED.");
        }
        if (snapshots.some((snapshot) => !Number.isFinite(snapshot.values && snapshot.values.spotPrice))) {
            reducers.push("One or more tabs do not provide spot price.");
        }
        if (snapshots.every((snapshot) => !snapshot.optionChain || !snapshot.optionChain.strikes || !snapshot.optionChain.strikes.length)) {
            reducers.push("No tab currently provides option-chain rows.");
        }
        if (settings.newsEnabled === false || settings.enableNewsEngine === false) {
            reducers.push("News engine is disabled.");
        }

        return Utils.dedupeStrings(reducers).slice(0, 12);
    }

    function resolveSupportResistanceSource(snapshots, latestSupportResistance) {
        const hasLive = snapshots.some((snapshot) => {
            const values = snapshot.values || {};
            return Number.isFinite(values.support) || Number.isFinite(values.resistance);
        });
        if (hasLive) {
            return "live";
        }

        if (latestSupportResistance && (Number.isFinite(latestSupportResistance.nearestSupport) || Number.isFinite(latestSupportResistance.nearestResistance))) {
            return "derived";
        }

        return "fallback";
    }

    function safeNumber(value) {
        const number = Utils.toNumber(value);
        return Number.isFinite(number) ? Utils.round(number, 4) : null;
    }

    global.OptionsDiagnosticsEngine = {
        buildDiagnostics: buildDiagnostics,
        createEmptyDiagnostics: createEmptyDiagnostics
    };
})(typeof globalThis !== "undefined" ? globalThis : this);

