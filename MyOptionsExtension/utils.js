(function (global) {
    "use strict";

    const STORAGE_VERSION = 4;
    const ALARM_NAME = "options-trading-assistant-monitor";
    const MAX_TEXT_SCAN_LENGTH = 150000;

    const ACTIONS = {
        PING: "OTA_PING",
        EXTRACT_PAGE_SNAPSHOT: "OTA_EXTRACT_PAGE_SNAPSHOT",
        SCAN_TAB: "OTA_SCAN_TAB",
        SCAN_ALL_MONITORED_TABS: "OTA_SCAN_ALL_MONITORED_TABS",
        START_MONITOR_TAB: "OTA_START_MONITOR_TAB",
        STOP_MONITOR_TAB: "OTA_STOP_MONITOR_TAB",
        TOGGLE_MONITOR_TAB: "OTA_TOGGLE_MONITOR_TAB",
        CLEAR_HISTORY: "OTA_CLEAR_HISTORY",
        SETTINGS_UPDATED: "OTA_SETTINGS_UPDATED",
        SAVE_MORNING_PROJECTION: "OTA_SAVE_MORNING_PROJECTION",
        RUN_EV_VALIDATION: "OTA_RUN_EV_VALIDATION",
        REFRESH_NEWS: "OTA_REFRESH_NEWS",
        GENERATE_TOMORROW_VIEW: "OTA_GENERATE_TOMORROW_VIEW",
        RUN_AI_ANALYSIS: "OTA_RUN_AI_ANALYSIS",
        SET_SELECTED_INSTRUMENT: "OTA_SET_SELECTED_INSTRUMENT"
    };

    const DEFAULT_SETTINGS = {
        defaultProfile: "BEGINNER",
        bullishPcrThreshold: 1.15,
        bearishPcrThreshold: 0.85,
        highVixThreshold: 18,
        elevatedVixThreshold: 15,
        confidenceThreshold: 60,
        lowConfidenceThreshold: 35,
        beginnerWeakConfidenceThreshold: 35,
        beginnerStrongConfidenceThreshold: 60,
        monitoringIntervalSeconds: 60,
        sustainedConditionMinutes: 2,
        notificationsEnabled: true,
        soundEnabled: false,
        diagnosticsMode: false,
        enableNewsEngine: true,
        newsEnabled: true,
        newsCacheMinutes: 7,
        newsRefreshMinutes: 7,
        enablePostMarketAutoPrediction: true,
        enableTomorrowPrediction: true,
        marketCloseTime: "15:30",
        aiBridgeCooldownSeconds: 30,
        aiBridgeTimeoutSeconds: 20,
        enabledSiteAdapters: ["tradingview", "zerodha-kite", "custom-page", "option-chain-page", "global-cues-page", "news-page", "generic"],
        retentionHistoryLimit: 120,
        alertCooldownMinutes: 10,
        maxSnapshotsPerTab: 200,
        supportResistanceBufferPercent: 0.4,
        highIvThreshold: 25,
        extremeIvThreshold: 35,
        maxPainBiasPercent: 0.35,
        oiBullishRatio: 1.15,
        oiBearishRatio: 0.87,
        minimumDataPoints: 2,
        trend15mSlopeWeight: 18,
        trend1hSlopeWeight: 22,
        trendConsistencyBonus: 10,
        trendSidewaysSensitivity: 0.18,
        gapGlobalCueWeight: 12,
        gapLateMomentumWeight: 18,
        gapConfidenceThreshold: 50,
        tradeMinRiskReward: 1.5,
        tradeDefaultStopPercent: 0.6,
        tradeBreakoutBufferPercent: 0.2,
        tradePullbackBufferPercent: 0.25,
        tradeHighVolatilityPenalty: 12,
        defaultPremiumRiskMode: "BALANCED",
        stockOptionStrikeStep: 20,
        premiumStopLossConservativePct: 18,
        premiumStopLossBalancedPct: 22,
        premiumStopLossAggressivePct: 28,
        premiumTarget1ConservativePct: 15,
        premiumTarget1BalancedPct: 18,
        premiumTarget1AggressivePct: 20,
        premiumTarget2ConservativePct: 30,
        premiumTarget2BalancedPct: 35,
        premiumTarget2AggressivePct: 40,
        premiumChaseBufferConservativePct: 4,
        premiumChaseBufferBalancedPct: 6,
        premiumChaseBufferAggressivePct: 8,
        premiumPullbackBufferConservativePct: 5,
        premiumPullbackBufferBalancedPct: 7,
        premiumPullbackBufferAggressivePct: 10,
        premiumMinAcceptableRr: 1.4,
        allowEstimatedPremium: true,
        autoSaveMorningProjection: false,
        evValidationHour: 15,
        historyRetentionDays: 20
    };

    const INSTRUMENT_TYPES = {
        INDEX: "INDEX",
        STOCK: "STOCK"
    };

    const INSTRUMENT_CATALOG = [
        { id: "NIFTY", label: "NIFTY", type: INSTRUMENT_TYPES.INDEX, strikeStep: 50 },
        { id: "BANKNIFTY", label: "BANKNIFTY", type: INSTRUMENT_TYPES.INDEX, strikeStep: 100 },
        { id: "RELIANCE", label: "RELIANCE", type: INSTRUMENT_TYPES.STOCK, strikeStep: 20 },
        { id: "HDFCBANK", label: "HDFC BANK", type: INSTRUMENT_TYPES.STOCK, strikeStep: 20 },
        { id: "TCS", label: "TCS", type: INSTRUMENT_TYPES.STOCK, strikeStep: 50 },
        { id: "INFY", label: "INFY", type: INSTRUMENT_TYPES.STOCK, strikeStep: 20 },
        { id: "ICICIBANK", label: "ICICI BANK", type: INSTRUMENT_TYPES.STOCK, strikeStep: 20 },
        { id: "SBIN", label: "SBIN", type: INSTRUMENT_TYPES.STOCK, strikeStep: 10 },
        { id: "LT", label: "L&T", type: INSTRUMENT_TYPES.STOCK, strikeStep: 20 }
    ];

    const USER_PROFILES = {
        BEGINNER: "BEGINNER",
        PROFESSIONAL: "PROFESSIONAL"
    };

    const PREMIUM_RISK_MODES = {
        CONSERVATIVE: "CONSERVATIVE",
        BALANCED: "BALANCED",
        AGGRESSIVE: "AGGRESSIVE"
    };

    const STRIKE_STEPS = {
        NIFTY: 50,
        BANKNIFTY: 100,
        FINNIFTY: 50,
        MIDCPNIFTY: 25,
        SENSEX: 100
    };

    function createEmptyValues() {
        return {
            spotPrice: null,
            openPrice: null,
            previousClose: null,
            dayHigh: null,
            dayLow: null,
            changePercent: null,
            pcr: null,
            vix: null,
            atmIv: null,
            maxPain: null,
            support: null,
            resistance: null,
            callOi: null,
            putOi: null,
            vwap: null,
            movingAverage: null,
            giftNifty: null,
            dowFutures: null,
            nasdaqFutures: null,
            crude: null,
            dxy: null,
            usYield: null
        };
    }

    function createEmptySnapshot(partial) {
        const payload = partial || {};
        return {
            tabId: payload.tabId || null,
            url: payload.url || "",
            sourceType: payload.sourceType || payload.siteType || "unknown-source",
            siteType: payload.siteType || payload.sourceType || "generic",
            timestamp: payload.timestamp || new Date().toISOString(),
            instrument: payload.instrument || "UNKNOWN",
            title: payload.title || payload.pageTitle || "",
            pageTitle: payload.pageTitle || payload.title || "",
            values: Object.assign(createEmptyValues(), payload.values || {}),
            rawSignals: Array.isArray(payload.rawSignals) ? payload.rawSignals.slice(0, 12) : [],
            headlines: Array.isArray(payload.headlines) ? payload.headlines.slice(0, 20) : [],
            optionChain: normalizeOptionChain(payload.optionChain),
            extractedOptionPremiums: normalizeExtractedOptionPremiums(payload.extractedOptionPremiums),
            supportResistance: payload.supportResistance || null,
            structureAnalysis: payload.structureAnalysis || null,
            extractionMeta: Object.assign({
                method: "unknown",
                confidence: 0,
                warnings: []
            }, payload.extractionMeta || payload.extractorMeta || {}),
            extractorMeta: Object.assign({
                method: "unknown",
                confidence: 0,
                warnings: []
            }, payload.extractorMeta || payload.extractionMeta || {})
        };
    }

    function createEmptyOptionChain() {
        return {
            strikes: []
        };
    }

    function createEmptyPremiumTradePlan() {
        return {
            contract: {
                label: "--",
                strike: null,
                side: "NONE",
                premiumSource: "NONE"
            },
            pricing: {
                currentPremium: null,
                entryZone: {
                    min: null,
                    max: null,
                    note: "Premium entry zone is not available."
                },
                stopLoss: {
                    value: null,
                    type: "NONE",
                    note: "Premium stop loss is not available."
                },
                targets: [
                    { label: "T1", value: null, note: "No target available." },
                    { label: "T2", value: null, note: "No target available." }
                ]
            },
            setupQuality: "AVOID",
            riskReward: {
                rrToT1: "N/A",
                rrToT2: "N/A",
                numericRrT1: null,
                numericRrT2: null
            },
            executionPlan: {
                allowedNow: false,
                ifElsePlan: ["IF confirmation is missing -> DO NOT TRADE"],
                invalidationText: "No premium setup available."
            },
            warnings: ["Premium setup unavailable."],
            reasoning: ["Insufficient option inputs for premium planning."],
            statusNote: "No actionable premium setup.",
            shouldWaitForConfirmation: true
        };
    }

    function createEmptyOverallSignal() {
        return {
            signal: "WAIT",
            marketBias: "WAIT",
            tradeReadiness: "NO_TRADE",
            confidence: 0,
            strength: "WEAK",
            bullishScore: 0,
            bearishScore: 0,
            score: 0,
            scoreBreakdown: {},
            reasoning: ["No monitored data has been evaluated yet."],
            riskFlags: ["Data is not available yet."],
            recommendedStance: "Wait for visible market data before acting.",
            updatedAt: null,
            tabCount: 0
        };
    }

    function createEmptyTrendBias(signal) {
        return {
            signal: signal || "SIDEWAYS",
            confidence: 0,
            strength: "WEAK",
            scoreBullish: 0,
            scoreBearish: 0,
            reasoning: ["Not enough history is available yet."]
        };
    }

    function createEmptyTrendAnalysis() {
        return {
            bias15m: createEmptyTrendBias("SIDEWAYS"),
            bias1h: createEmptyTrendBias("SIDEWAYS"),
            alignment: {
                status: "NEUTRAL",
                notes: ["Trend alignment is not available yet."]
            }
        };
    }

    function createEmptyGapPrediction() {
        return {
            primary: "UNKNOWN",
            confidence: 0,
            probabilities: {
                gapUp: 34,
                gapDown: 33,
                flatOpen: 33
            },
            reasoning: ["Gap prediction needs more context."],
            warnings: ["Incomplete data"]
        };
    }

    function createEmptyTradePlan() {
        return {
            status: "NO_TRADE",
            direction: "NONE",
            setupQuality: "LOW",
            entryType: "NONE",
            entryZone: {
                min: null,
                max: null,
                note: "No entry zone is active."
            },
            stopLoss: {
                value: null,
                type: "NONE",
                note: "No stop loss is available."
            },
            targets: [
                { label: "T1", value: null, note: "No target" },
                { label: "T2", value: null, note: "No target" }
            ],
            suggestedContract: {
                symbol: "--",
                strike: null,
                optionType: "NONE",
                moneyness: "NONE",
                note: "No strike suggestion is active."
            },
            projectedMove: {
                primaryValue: null,
                stretchValue: null,
                expectedPoints: null,
                note: "Projected value will appear with a usable setup."
            },
            premiumTradePlan: createEmptyPremiumTradePlan(),
            executionPlan: {
                allowedNow: false,
                ifElsePlan: ["IF confirmation is missing -> DO NOT TRADE"],
                invalidationText: "Wait for a cleaner setup."
            },
            riskReward: "N/A",
            invalidation: "Wait for a cleaner setup.",
            reasoning: ["Trade setup quality is not sufficient yet."],
            warnings: ["No trade"]
        };
    }

    function createEmptySupportResistance() {
        return {
            nearestSupport: null,
            nearestResistance: null,
            secondarySupport: null,
            secondaryResistance: null,
            supportLevels: [],
            resistanceLevels: [],
            breakout: false,
            breakdown: false,
            zone: "MID",
            strength: {
                support: "WEAK",
                resistance: "WEAK"
            },
            reasoning: ["Key levels are not available yet."]
        };
    }

    function createEmptyStructureAnalysis() {
        return {
            trend: "SIDEWAYS",
            structure: "MIXED",
            range: {
                high: null,
                low: null,
                mid: null
            },
            zone: "MID",
            momentum: "NONE",
            exhaustion: false,
            rejection: {
                atSupport: false,
                atResistance: false
            },
            rangePosition: null,
            tradeSuggestion: {
                action: "WAIT",
                reason: "Structure data is not available yet."
            },
            reasoning: ["Structure analysis needs more price history."]
        };
    }

    function createEmptyAccuracyMetrics() {
        return {
            totalProjections: 0,
            hitRate: 0,
            partialHitRate: 0,
            gapAccuracy: 0,
            averageConfidence: 0,
            confidenceAccuracyCorrelation: 0
        };
    }

    function createEmptyNewsSentiment() {
        return {
            sentiment: "NEUTRAL",
            confidence: 0,
            summary: "No major news detected.",
            topNews: [],
            bullishScore: 0,
            bearishScore: 0,
            keywords: [],
            fetchedAt: null,
            stale: false,
            sourceStatuses: []
        };
    }

    function createEmptyTomorrowPrediction() {
        return {
            available: false,
            generatedAt: null,
            autoGenerated: false,
            tomorrowPrediction: {
                bias: "SIDEWAYS",
                strength: "WEAK",
                gapExpectation: "FLAT",
                confidence: 0,
                keyLevels: {
                    support: null,
                    resistance: null
                },
                strategy: {
                    openPlan: "Generate tomorrow view after market close or from the manual button.",
                    breakoutPlan: "Breakout strategy will appear after the outlook is generated.",
                    breakdownPlan: "Breakdown strategy will appear after the outlook is generated."
                },
                holdAdvice: {
                    CE: "AVOID",
                    PE: "AVOID"
                },
                reasoning: ["Tomorrow outlook will appear after post-market analysis runs."]
            }
        };
    }

    function createEmptyAIAnalysis() {
        return {
            state: "IDLE",
            statusText: "AI not available",
            lastRunAt: null,
            updatedAt: null,
            runId: null,
            sourceTabId: null,
            cooldownUntil: null,
            error: "",
            rawOutput: "",
            parsed: {
                summary: "",
                beginnerAdvice: "",
                proInsight: "",
                tradeSuggestion: "WAIT",
                riskWarning: "",
                parseMode: "NONE"
            }
        };
    }

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

    function createInitialState() {
        return {
            version: STORAGE_VERSION,
            settings: Object.assign({}, DEFAULT_SETTINGS),
            userProfile: USER_PROFILES.BEGINNER,
            selectedInstrument: "NIFTY",
            monitoredTabs: {},
            latestSnapshots: {},
            snapshotsByTab: {},
            latestEvaluations: {},
            overallSignal: createEmptyOverallSignal(),
            latestTrendAnalysis: createEmptyTrendAnalysis(),
            latestGapPrediction: createEmptyGapPrediction(),
            latestTradePlan: createEmptyTradePlan(),
            latestSupportResistance: createEmptySupportResistance(),
            latestStructureAnalysis: createEmptyStructureAnalysis(),
            latestNewsSentiment: createEmptyNewsSentiment(),
            latestTomorrowPrediction: createEmptyTomorrowPrediction(),
            latestDiagnostics: createEmptyDiagnostics(),
            aiAnalysis: createEmptyAIAnalysis(),
            signalHistory: [],
            alertHistory: [],
            mpHistory: [],
            evHistory: [],
            accuracyMetrics: createEmptyAccuracyMetrics(),
            lastAlertMap: {}
        };
    }

    function normalizeStoredState(rawState) {
        const state = rawState || {};
        const settings = mergeSettings(state.settings || {});
        return {
            version: STORAGE_VERSION,
            settings: settings,
            userProfile: normalizeUserProfile(state.userProfile || settings.defaultProfile),
            selectedInstrument: normalizeInstrumentSelection(state.selectedInstrument),
            monitoredTabs: normalizeMonitoredTabs(state.monitoredTabs),
            latestSnapshots: normalizeSnapshotMap(state.latestSnapshots),
            snapshotsByTab: normalizeSnapshotHistory(state.snapshotsByTab, settings),
            latestEvaluations: normalizeRecord(state.latestEvaluations),
            overallSignal: normalizeOverallSignal(state.overallSignal),
            latestTrendAnalysis: normalizeTrendAnalysis(state.latestTrendAnalysis),
            latestGapPrediction: normalizeGapPrediction(state.latestGapPrediction),
            latestTradePlan: normalizeTradePlan(state.latestTradePlan),
            latestSupportResistance: normalizeSupportResistance(state.latestSupportResistance),
            latestStructureAnalysis: normalizeStructureAnalysis(state.latestStructureAnalysis),
            latestNewsSentiment: normalizeNewsSentiment(state.latestNewsSentiment),
            latestTomorrowPrediction: normalizeTomorrowPrediction(state.latestTomorrowPrediction),
            latestDiagnostics: Object.assign(createEmptyDiagnostics(), normalizeRecord(state.latestDiagnostics)),
            aiAnalysis: normalizeAIAnalysis(state.aiAnalysis),
            signalHistory: normalizeTimedHistory(state.signalHistory, settings),
            alertHistory: normalizeTimedHistory(state.alertHistory, settings),
            mpHistory: normalizeTimedHistory(state.mpHistory, settings),
            evHistory: normalizeTimedHistory(state.evHistory, settings),
            accuracyMetrics: Object.assign(createEmptyAccuracyMetrics(), normalizeRecord(state.accuracyMetrics)),
            lastAlertMap: normalizeRecord(state.lastAlertMap)
        };
    }

    function normalizeOverallSignal(signal) {
        return Object.assign(createEmptyOverallSignal(), signal || {});
    }

    function normalizeTrendAnalysis(value) {
        return Object.assign(createEmptyTrendAnalysis(), value || {});
    }

    function normalizeGapPrediction(value) {
        return Object.assign(createEmptyGapPrediction(), value || {});
    }

    function normalizeTradePlan(value) {
        const defaults = createEmptyTradePlan();
        const source = value || {};
        return Object.assign({}, defaults, source, {
            entryZone: Object.assign({}, defaults.entryZone, source.entryZone || {}),
            stopLoss: Object.assign({}, defaults.stopLoss, source.stopLoss || {}),
            targets: Array.isArray(source.targets) && source.targets.length
                ? source.targets.map((item, index) => Object.assign({}, defaults.targets[index] || defaults.targets[0], item || {}))
                : defaults.targets,
            suggestedContract: Object.assign({}, defaults.suggestedContract, source.suggestedContract || {}),
            projectedMove: Object.assign({}, defaults.projectedMove, source.projectedMove || {}),
            executionPlan: Object.assign({}, defaults.executionPlan, source.executionPlan || {}),
            premiumTradePlan: normalizePremiumTradePlan(source.premiumTradePlan)
        });
    }

    function normalizeSupportResistance(value) {
        return Object.assign(createEmptySupportResistance(), value || {});
    }

    function normalizeStructureAnalysis(value) {
        return Object.assign(createEmptyStructureAnalysis(), value || {});
    }

    function normalizeNewsSentiment(value) {
        const defaults = createEmptyNewsSentiment();
        const source = value || {};
        return Object.assign({}, defaults, source, {
            topNews: Array.isArray(source.topNews)
                ? source.topNews.slice(0, 10).map((item) => Object.assign({
                    title: "",
                    source: "Unknown",
                    sentiment: "NEUTRAL",
                    impact: "LOW",
                    link: "",
                    publishedAt: null
                }, item || {}))
                : defaults.topNews,
            keywords: Array.isArray(source.keywords) ? dedupeStrings(source.keywords) : defaults.keywords,
            sourceStatuses: Array.isArray(source.sourceStatuses) ? source.sourceStatuses.slice(0, 8) : defaults.sourceStatuses
        });
    }

    function normalizeTomorrowPrediction(value) {
        const defaults = createEmptyTomorrowPrediction();
        const source = value || {};
        return Object.assign({}, defaults, source, {
            tomorrowPrediction: Object.assign({}, defaults.tomorrowPrediction, source.tomorrowPrediction || {}, {
                keyLevels: Object.assign({}, defaults.tomorrowPrediction.keyLevels, source.tomorrowPrediction && source.tomorrowPrediction.keyLevels ? source.tomorrowPrediction.keyLevels : {}),
                strategy: Object.assign({}, defaults.tomorrowPrediction.strategy, source.tomorrowPrediction && source.tomorrowPrediction.strategy ? source.tomorrowPrediction.strategy : {}),
                holdAdvice: Object.assign({}, defaults.tomorrowPrediction.holdAdvice, source.tomorrowPrediction && source.tomorrowPrediction.holdAdvice ? source.tomorrowPrediction.holdAdvice : {}),
                reasoning: Array.isArray(source.tomorrowPrediction && source.tomorrowPrediction.reasoning)
                    ? source.tomorrowPrediction.reasoning.slice(0, 8)
                    : defaults.tomorrowPrediction.reasoning
            })
        });
    }

    function normalizeAIAnalysis(value) {
        const defaults = createEmptyAIAnalysis();
        const source = value || {};
        return Object.assign({}, defaults, source, {
            parsed: Object.assign({}, defaults.parsed, source.parsed || {})
        });
    }

    function normalizeOptionChain(value) {
        const source = value && typeof value === "object" ? value : createEmptyOptionChain();
        const strikes = Array.isArray(source.strikes) ? source.strikes : [];
        const normalizedStrikes = strikes.map((item) => {
            const row = item || {};
            return {
                strike: toNumber(row.strike),
                ceLtp: toNumber(row.ceLtp),
                peLtp: toNumber(row.peLtp),
                ceOi: toNumber(row.ceOi),
                peOi: toNumber(row.peOi),
                ceIv: toNumber(row.ceIv),
                peIv: toNumber(row.peIv)
            };
        }).filter((row) => Number.isFinite(row.strike)).slice(0, 120);

        return {
            strikes: normalizedStrikes
        };
    }

    function normalizeExtractedOptionPremiums(value) {
        const source = value && typeof value === "object" ? value : {};
        const normalized = {};
        Object.keys(source).forEach((key) => {
            const premium = toNumber(source[key]);
            if (Number.isFinite(premium) && premium > 0) {
                normalized[String(key).toUpperCase()] = premium;
            }
        });
        return normalized;
    }

    function normalizePremiumTradePlan(value) {
        const defaults = createEmptyPremiumTradePlan();
        const source = value || {};
        const pricing = source.pricing || {};
        const riskReward = source.riskReward || {};

        return Object.assign({}, defaults, source, {
            contract: Object.assign({}, defaults.contract, source.contract || {}),
            pricing: Object.assign({}, defaults.pricing, pricing, {
                entryZone: Object.assign({}, defaults.pricing.entryZone, pricing.entryZone || {}),
                stopLoss: Object.assign({}, defaults.pricing.stopLoss, pricing.stopLoss || {}),
                targets: Array.isArray(pricing.targets) && pricing.targets.length
                    ? pricing.targets.map((item, index) => Object.assign({}, defaults.pricing.targets[index] || defaults.pricing.targets[0], item || {}))
                    : defaults.pricing.targets
            }),
            riskReward: Object.assign({}, defaults.riskReward, riskReward),
            executionPlan: Object.assign({}, defaults.executionPlan, source.executionPlan || {}),
            warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 8) : defaults.warnings,
            reasoning: Array.isArray(source.reasoning) ? source.reasoning.slice(0, 10) : defaults.reasoning
        });
    }

    function normalizeMonitoredTabs(record) {
        const normalized = {};
        Object.keys(record || {}).forEach((key) => {
            const source = record[key];
            if (!source || !source.tabId) {
                return;
            }
            normalized[source.tabId] = Object.assign({
                tabId: source.tabId,
                url: source.url || "",
                title: source.title || "Untitled tab",
                siteType: source.siteType || "generic",
                addedAt: source.addedAt || new Date().toISOString(),
                lastScanAt: source.lastScanAt || null,
                lastError: source.lastError || "",
                monitored: source.monitored !== false
            }, source);
        });
        return normalized;
    }

    function normalizeSnapshotMap(record) {
        const normalized = {};
        Object.keys(record || {}).forEach((key) => {
            normalized[key] = createEmptySnapshot(record[key]);
        });
        return normalized;
    }

    function normalizeSnapshotHistory(record, settings) {
        const normalized = {};
        Object.keys(record || {}).forEach((key) => {
            const snapshots = Array.isArray(record[key]) ? record[key] : [];
            normalized[key] = pruneHistoryByDays(
                snapshots.map((item) => createEmptySnapshot(item)),
                settings.historyRetentionDays
            ).slice(-Math.max(settings.retentionHistoryLimit, 180));
        });
        return normalized;
    }

    function normalizeTimedHistory(items, settings) {
        const source = Array.isArray(items) ? items.slice() : [];
        return pruneHistoryByDays(limitArray(source, Math.max(settings.retentionHistoryLimit, 180)), settings.historyRetentionDays);
    }

    function pruneHistoryByDays(items, days) {
        const safeDays = Math.max(1, toNumber(days) || DEFAULT_SETTINGS.historyRetentionDays);
        const cutoff = Date.now() - (safeDays * 24 * 60 * 60 * 1000);
        return (items || []).filter((item) => {
            const timestamp = item && (item.timestamp || item.updatedAt || item.dateKey);
            if (!timestamp) {
                return true;
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(timestamp))) {
                return new Date(`${timestamp}T00:00:00`).getTime() >= cutoff;
            }
            return new Date(timestamp).getTime() >= cutoff;
        });
    }

    function normalizeRecord(record) {
        return record && typeof record === "object" ? Object.assign({}, record) : {};
    }

    function mergeSettings(overrides) {
        const merged = Object.assign({}, DEFAULT_SETTINGS, overrides || {});
        merged.defaultProfile = normalizeUserProfile(merged.defaultProfile);
        merged.defaultPremiumRiskMode = normalizePremiumRiskMode(merged.defaultPremiumRiskMode);
        merged.monitoringIntervalSeconds = clamp(toNumber(merged.monitoringIntervalSeconds) || DEFAULT_SETTINGS.monitoringIntervalSeconds, 30, 3600);
        merged.sustainedConditionMinutes = clamp(toNumber(merged.sustainedConditionMinutes) || DEFAULT_SETTINGS.sustainedConditionMinutes, 1, 60);
        merged.retentionHistoryLimit = clamp(toNumber(merged.retentionHistoryLimit) || DEFAULT_SETTINGS.retentionHistoryLimit, 20, 600);
        merged.alertCooldownMinutes = clamp(toNumber(merged.alertCooldownMinutes) || DEFAULT_SETTINGS.alertCooldownMinutes, 1, 180);
        merged.lowConfidenceThreshold = clamp(toNumber(merged.lowConfidenceThreshold) || DEFAULT_SETTINGS.lowConfidenceThreshold, 20, 60);
        merged.beginnerWeakConfidenceThreshold = clamp(toNumber(merged.beginnerWeakConfidenceThreshold) || DEFAULT_SETTINGS.beginnerWeakConfidenceThreshold, 10, 80);
        merged.beginnerStrongConfidenceThreshold = clamp(toNumber(merged.beginnerStrongConfidenceThreshold) || DEFAULT_SETTINGS.beginnerStrongConfidenceThreshold, 20, 95);
        merged.historyRetentionDays = clamp(toNumber(merged.historyRetentionDays) || DEFAULT_SETTINGS.historyRetentionDays, 3, 120);
        if (merged.beginnerStrongConfidenceThreshold < merged.beginnerWeakConfidenceThreshold) {
            merged.beginnerStrongConfidenceThreshold = merged.beginnerWeakConfidenceThreshold + 5;
        }
        merged.tradeMinRiskReward = clamp(toNumber(merged.tradeMinRiskReward) || DEFAULT_SETTINGS.tradeMinRiskReward, 0.8, 5);
        merged.tradeDefaultStopPercent = clamp(toNumber(merged.tradeDefaultStopPercent) || DEFAULT_SETTINGS.tradeDefaultStopPercent, 0.2, 3);
        merged.tradeBreakoutBufferPercent = clamp(toNumber(merged.tradeBreakoutBufferPercent) || DEFAULT_SETTINGS.tradeBreakoutBufferPercent, 0.05, 2);
        merged.tradePullbackBufferPercent = clamp(toNumber(merged.tradePullbackBufferPercent) || DEFAULT_SETTINGS.tradePullbackBufferPercent, 0.05, 2);
        merged.stockOptionStrikeStep = clamp(toNumber(merged.stockOptionStrikeStep) || DEFAULT_SETTINGS.stockOptionStrikeStep, 1, 500);
        merged.premiumStopLossConservativePct = clamp(toNumber(merged.premiumStopLossConservativePct) || DEFAULT_SETTINGS.premiumStopLossConservativePct, 5, 60);
        merged.premiumStopLossBalancedPct = clamp(toNumber(merged.premiumStopLossBalancedPct) || DEFAULT_SETTINGS.premiumStopLossBalancedPct, 5, 60);
        merged.premiumStopLossAggressivePct = clamp(toNumber(merged.premiumStopLossAggressivePct) || DEFAULT_SETTINGS.premiumStopLossAggressivePct, 5, 80);
        merged.premiumTarget1ConservativePct = clamp(toNumber(merged.premiumTarget1ConservativePct) || DEFAULT_SETTINGS.premiumTarget1ConservativePct, 5, 80);
        merged.premiumTarget1BalancedPct = clamp(toNumber(merged.premiumTarget1BalancedPct) || DEFAULT_SETTINGS.premiumTarget1BalancedPct, 5, 80);
        merged.premiumTarget1AggressivePct = clamp(toNumber(merged.premiumTarget1AggressivePct) || DEFAULT_SETTINGS.premiumTarget1AggressivePct, 5, 120);
        merged.premiumTarget2ConservativePct = clamp(toNumber(merged.premiumTarget2ConservativePct) || DEFAULT_SETTINGS.premiumTarget2ConservativePct, 10, 150);
        merged.premiumTarget2BalancedPct = clamp(toNumber(merged.premiumTarget2BalancedPct) || DEFAULT_SETTINGS.premiumTarget2BalancedPct, 10, 150);
        merged.premiumTarget2AggressivePct = clamp(toNumber(merged.premiumTarget2AggressivePct) || DEFAULT_SETTINGS.premiumTarget2AggressivePct, 10, 180);
        merged.premiumChaseBufferConservativePct = clamp(toNumber(merged.premiumChaseBufferConservativePct) || DEFAULT_SETTINGS.premiumChaseBufferConservativePct, 1, 40);
        merged.premiumChaseBufferBalancedPct = clamp(toNumber(merged.premiumChaseBufferBalancedPct) || DEFAULT_SETTINGS.premiumChaseBufferBalancedPct, 1, 40);
        merged.premiumChaseBufferAggressivePct = clamp(toNumber(merged.premiumChaseBufferAggressivePct) || DEFAULT_SETTINGS.premiumChaseBufferAggressivePct, 1, 60);
        merged.premiumPullbackBufferConservativePct = clamp(toNumber(merged.premiumPullbackBufferConservativePct) || DEFAULT_SETTINGS.premiumPullbackBufferConservativePct, 1, 40);
        merged.premiumPullbackBufferBalancedPct = clamp(toNumber(merged.premiumPullbackBufferBalancedPct) || DEFAULT_SETTINGS.premiumPullbackBufferBalancedPct, 1, 40);
        merged.premiumPullbackBufferAggressivePct = clamp(toNumber(merged.premiumPullbackBufferAggressivePct) || DEFAULT_SETTINGS.premiumPullbackBufferAggressivePct, 1, 60);
        merged.premiumTarget2ConservativePct = Math.max(merged.premiumTarget2ConservativePct, merged.premiumTarget1ConservativePct + 5);
        merged.premiumTarget2BalancedPct = Math.max(merged.premiumTarget2BalancedPct, merged.premiumTarget1BalancedPct + 5);
        merged.premiumTarget2AggressivePct = Math.max(merged.premiumTarget2AggressivePct, merged.premiumTarget1AggressivePct + 5);
        merged.premiumMinAcceptableRr = clamp(toNumber(merged.premiumMinAcceptableRr) || DEFAULT_SETTINGS.premiumMinAcceptableRr, 0.8, 5);
        merged.evValidationHour = clamp(toNumber(merged.evValidationHour) || DEFAULT_SETTINGS.evValidationHour, 9, 18);
        merged.newsCacheMinutes = clamp(toNumber(merged.newsCacheMinutes) || toNumber(merged.newsRefreshMinutes) || DEFAULT_SETTINGS.newsCacheMinutes, 5, 10);
        merged.newsRefreshMinutes = merged.newsCacheMinutes;
        merged.aiBridgeCooldownSeconds = clamp(toNumber(merged.aiBridgeCooldownSeconds) || DEFAULT_SETTINGS.aiBridgeCooldownSeconds, 15, 180);
        merged.aiBridgeTimeoutSeconds = clamp(toNumber(merged.aiBridgeTimeoutSeconds) || DEFAULT_SETTINGS.aiBridgeTimeoutSeconds, 10, 60);
        merged.diagnosticsMode = merged.diagnosticsMode === true;
        merged.newsEnabled = merged.newsEnabled !== false;
        merged.enableNewsEngine = merged.enableNewsEngine !== false && merged.newsEnabled !== false;
        merged.enableTomorrowPrediction = merged.enableTomorrowPrediction !== false;
        merged.enablePostMarketAutoPrediction = merged.enablePostMarketAutoPrediction !== false && merged.enableTomorrowPrediction !== false;
        merged.marketCloseTime = typeof merged.marketCloseTime === "string" && /^\d{2}:\d{2}$/.test(merged.marketCloseTime)
            ? merged.marketCloseTime
            : DEFAULT_SETTINGS.marketCloseTime;
        merged.maxSnapshotsPerTab = clamp(toNumber(merged.maxSnapshotsPerTab) || DEFAULT_SETTINGS.maxSnapshotsPerTab, 50, 300);
        merged.allowEstimatedPremium = merged.allowEstimatedPremium !== false;
        merged.enabledSiteAdapters = Array.isArray(merged.enabledSiteAdapters) && merged.enabledSiteAdapters.length
            ? merged.enabledSiteAdapters
            : DEFAULT_SETTINGS.enabledSiteAdapters.slice();
        return merged;
    }

    function normalizeUserProfile(value) {
        const upper = String(value || USER_PROFILES.BEGINNER).toUpperCase();
        return upper === USER_PROFILES.PROFESSIONAL ? USER_PROFILES.PROFESSIONAL : USER_PROFILES.BEGINNER;
    }

    function normalizePremiumRiskMode(value) {
        const upper = String(value || PREMIUM_RISK_MODES.BALANCED).toUpperCase();
        if (upper === PREMIUM_RISK_MODES.CONSERVATIVE) {
            return PREMIUM_RISK_MODES.CONSERVATIVE;
        }
        if (upper === PREMIUM_RISK_MODES.AGGRESSIVE) {
            return PREMIUM_RISK_MODES.AGGRESSIVE;
        }
        return PREMIUM_RISK_MODES.BALANCED;
    }

    function normalizeInstrumentSelection(value) {
        const compact = compactInstrumentToken(value);
        if (!compact) {
            return "NIFTY";
        }

        const exact = INSTRUMENT_CATALOG.find((item) => {
            return compactInstrumentToken(item.id) === compact
                || compactInstrumentToken(item.label) === compact;
        });
        if (exact) {
            return exact.id;
        }

        const aliasMap = {
            NIFTY50: "NIFTY",
            NIFTYBANK: "BANKNIFTY",
            RELIANCEINDUSTRIES: "RELIANCE",
            RELIANCEINDUSTRIESLTD: "RELIANCE",
            HDFC: "HDFCBANK",
            ICICI: "ICICIBANK",
            INFOSYS: "INFY",
            TATACONSULTANCYSERVICES: "TCS",
            STATEBANK: "SBIN",
            STATEBANKOFINDIA: "SBIN",
            LARSEN: "LT",
            LARSENTOUBRO: "LT",
            LTO: "LT"
        };
        if (aliasMap[compact]) {
            return aliasMap[compact];
        }

        if (compact.includes("BANKNIFTY")) {
            return "BANKNIFTY";
        }
        if (compact.includes("NIFTY")) {
            return "NIFTY";
        }
        if (compact.includes("RELIANCE")) {
            return "RELIANCE";
        }
        if (compact.includes("HDFCBANK") || compact.includes("HDFC")) {
            return "HDFCBANK";
        }
        if (compact.includes("ICICIBANK") || compact.includes("ICICI")) {
            return "ICICIBANK";
        }
        if (compact.includes("INFY") || compact.includes("INFOSYS")) {
            return "INFY";
        }
        if (compact.includes("TCS") || compact.includes("TATACONSULTANCY")) {
            return "TCS";
        }
        if (compact.includes("SBIN") || compact.includes("STATEBANK")) {
            return "SBIN";
        }
        if (compact.includes("LARSEN") || compact === "LT") {
            return "LT";
        }

        return "NIFTY";
    }

    function compactInstrumentToken(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    function getInstrumentMeta(instrument) {
        const id = normalizeInstrumentSelection(instrument);
        return INSTRUMENT_CATALOG.find((item) => item.id === id) || INSTRUMENT_CATALOG[0];
    }

    function getInstrumentType(instrument) {
        const meta = getInstrumentMeta(instrument);
        return meta.type;
    }

    function isIndexInstrument(instrument) {
        return getInstrumentType(instrument) === INSTRUMENT_TYPES.INDEX;
    }

    function limitArray(items, limit) {
        const safeLimit = Math.max(1, toNumber(limit) || DEFAULT_SETTINGS.retentionHistoryLimit);
        return (items || []).slice(-safeLimit);
    }

    function appendLimitedHistory(history, item, limit) {
        const next = Array.isArray(history) ? history.slice() : [];
        next.push(item);
        return limitArray(next, limit);
    }

    function appendSnapshotHistory(snapshotsByTab, tabId, snapshot, settings) {
        const history = Array.isArray(snapshotsByTab[tabId]) ? snapshotsByTab[tabId].slice() : [];
        history.push(createEmptySnapshot(snapshot));
        snapshotsByTab[tabId] = pruneHistoryByDays(history, settings.historyRetentionDays).slice(-Math.max(settings.retentionHistoryLimit, 180));
        return snapshotsByTab[tabId];
    }

    function toNumber(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === "string" && !value.trim()) {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function round(value, digits) {
        if (!Number.isFinite(value)) {
            return null;
        }
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    function averageNumbers(values) {
        const finiteValues = (values || []).filter((value) => Number.isFinite(value));
        if (!finiteValues.length) {
            return null;
        }
        return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
    }

    function createId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    function dedupeStrings(items) {
        return Array.from(new Set((items || []).filter(Boolean)));
    }

    function isAccessibleUrl(url) {
        return typeof url === "string"
            && url.startsWith("http")
            && !url.startsWith("https://chrome.google.com/webstore");
    }

    function inferSiteTypeFromUrl(url) {
        if (!url) {
            return "generic";
        }
        if (url.includes("tradingview.com")) {
            return "tradingview";
        }
        if (url.includes("kite.zerodha.com")) {
            return "zerodha-kite";
        }
        if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("github.io")) {
            return "custom-page";
        }
        return "generic";
    }

    function formatDateTime(value) {
        if (!value) {
            return "Never";
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

    function formatRelativeTime(value) {
        if (!value) {
            return "Never";
        }
        const date = new Date(value);
        const deltaMs = Date.now() - date.getTime();
        if (!Number.isFinite(deltaMs)) {
            return "Unknown";
        }
        const seconds = Math.floor(deltaMs / 1000);
        if (seconds < 60) {
            return `${seconds}s ago`;
        }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes}m ago`;
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours}h ago`;
        }
        return `${Math.floor(hours / 24)}d ago`;
    }

    function formatNumber(value, digits) {
        if (!Number.isFinite(value)) {
            return "--";
        }
        return new Intl.NumberFormat("en-IN", {
            maximumFractionDigits: digits == null ? 2 : digits
        }).format(value);
    }

    function getStrikeIncrement(instrument) {
        const key = normalizeInstrumentSelection(instrument);
        const meta = INSTRUMENT_CATALOG.find((item) => item.id === key);
        if (meta && Number.isFinite(meta.strikeStep)) {
            return meta.strikeStep;
        }
        return STRIKE_STEPS[key] || 50;
    }

    function roundToStrike(value, instrument, mode) {
        if (!Number.isFinite(value)) {
            return null;
        }
        const step = getStrikeIncrement(instrument);
        if (mode === "up") {
            return Math.ceil(value / step) * step;
        }
        if (mode === "down") {
            return Math.floor(value / step) * step;
        }
        return Math.round(value / step) * step;
    }

    function formatSignalLabel(signal) {
        const upper = String(signal || "WAIT").toUpperCase();
        if (upper === "BULLISH") {
            return "UP";
        }
        if (upper === "WEAK_BULLISH") {
            return "UP WATCH";
        }
        if (upper === "BEARISH") {
            return "DOWN";
        }
        if (upper === "WEAK_BEARISH") {
            return "DOWN WATCH";
        }
        if (upper === "SIDEWAYS") {
            return "RANGE";
        }
        if (upper === "NEUTRAL") {
            return "NEUTRAL";
        }
        return upper || "WAIT";
    }

    function formatGapLabel(signal) {
        const upper = String(signal || "UNKNOWN").toUpperCase();
        if (upper === "GAP_UP") {
            return "OPEN UP";
        }
        if (upper === "GAP_DOWN") {
            return "OPEN DOWN";
        }
        if (upper === "FLAT_OPEN") {
            return "FLAT OPEN";
        }
        return upper;
    }

    function formatAlignmentLabel(status) {
        const upper = String(status || "NEUTRAL").toUpperCase();
        if (upper === "ALIGNED_BULLISH") {
            return "UP ALIGNED";
        }
        if (upper === "ALIGNED_BEARISH") {
            return "DOWN ALIGNED";
        }
        if (upper === "MIXED") {
            return "MIXED";
        }
        return "NEUTRAL";
    }

    function formatTradeStatusLabel(status) {
        const upper = String(status || "NO_TRADE").toUpperCase();
        if (upper === "WAIT_CONFIRMATION") {
            return "WAIT CONFIRM";
        }
        if (upper === "AGGRESSIVE_READY") {
            return "READY+";
        }
        if (upper === "NO_TRADE") {
            return "NO TRADE";
        }
        return upper.replace(/_/g, " ");
    }

    function formatDirectionLabel(direction) {
        const upper = String(direction || "NONE").toUpperCase();
        if (upper === "CE") {
            return "CALL SIDE";
        }
        if (upper === "PE") {
            return "PUT SIDE";
        }
        return "NONE";
    }

    function humanizeAssistantText(text) {
        return String(text || "")
            .replace(/\bWEAK_BULLISH\b/g, "UP WATCH")
            .replace(/\bWEAK_BEARISH\b/g, "DOWN WATCH")
            .replace(/\bBULLISH\b/g, "UP")
            .replace(/\bBEARISH\b/g, "DOWN")
            .replace(/\bstrong bullish\b/gi, "strong up")
            .replace(/\bstrong bearish\b/gi, "strong down")
            .replace(/\bmild bullish\b/gi, "mild up")
            .replace(/\bmild bearish\b/gi, "mild down")
            .replace(/\bbullish bias\b/gi, "up bias")
            .replace(/\bbearish bias\b/gi, "down bias")
            .replace(/\bbullish setups?\b/gi, "upside setups")
            .replace(/\bbearish setups?\b/gi, "downside setups")
            .replace(/\bbullish\b/gi, "up")
            .replace(/\bbearish\b/gi, "down");
    }

    function formatSignedNumber(value, digits) {
        if (!Number.isFinite(value)) {
            return "--";
        }
        const rounded = round(value, digits == null ? 2 : digits);
        return `${rounded > 0 ? "+" : ""}${rounded}`;
    }

    function parseNumberFromText(text) {
        if (!text) {
            return null;
        }

        const cleaned = String(text)
            .replace(/,/g, "")
            .replace(/Rs\.?/gi, "")
            .replace(/\u20B9/g, "")
            .trim();

        const match = cleaned.match(/(-?\d+(?:\.\d+)?)(?:\s*(K|M|B|L|CR))?/i);
        if (!match) {
            return null;
        }

        let value = Number(match[1]);
        if (!Number.isFinite(value)) {
            return null;
        }

        const suffix = (match[2] || "").toUpperCase();
        if (suffix === "K") {
            value *= 1000;
        } else if (suffix === "M") {
            value *= 1000000;
        } else if (suffix === "B") {
            value *= 1000000000;
        } else if (suffix === "L") {
            value *= 100000;
        } else if (suffix === "CR") {
            value *= 10000000;
        }

        return value;
    }

    function parsePercentFromText(text) {
        if (!text) {
            return null;
        }
        const match = String(text).match(/(-?\d+(?:\.\d+)?)\s*%?/);
        return match ? toNumber(match[1]) : null;
    }

    function extractFirstMatch(text, patterns, mapper) {
        const body = String(text || "");
        for (let index = 0; index < patterns.length; index += 1) {
            const pattern = patterns[index];
            const match = body.match(pattern);
            if (match) {
                return mapper ? mapper(match) : match[1];
            }
        }
        return null;
    }

    function getVisibleText(documentRef) {
        const doc = documentRef || (typeof document !== "undefined" ? document : null);
        if (!doc || !doc.body) {
            return "";
        }
        return String(doc.body.innerText || "").slice(0, MAX_TEXT_SCAN_LENGTH);
    }

    function toDateKey(value) {
        const date = value ? new Date(value) : new Date();
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function storageGet(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(result);
            });
        });
    }

    function storageSet(payload) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(payload, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    function storageRemove(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    async function loadState() {
        const state = await storageGet(null);
        return normalizeStoredState(state);
    }

    async function saveState(state) {
        const normalized = normalizeStoredState(state);
        await storageSet(normalized);
        return normalized;
    }

    async function loadUserProfile() {
        const state = await loadState();
        return state.userProfile;
    }

    async function setUserProfile(profile) {
        const nextProfile = normalizeUserProfile(profile);
        await storageSet({ userProfile: nextProfile });
        return nextProfile;
    }

    async function loadSelectedInstrument() {
        const state = await loadState();
        return state.selectedInstrument;
    }

    async function setSelectedInstrument(instrument) {
        const nextInstrument = normalizeInstrumentSelection(instrument);
        await storageSet({ selectedInstrument: nextInstrument });
        return nextInstrument;
    }

    function tabsQuery(query) {
        return new Promise((resolve, reject) => {
            chrome.tabs.query(query, (tabs) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(tabs || []);
            });
        });
    }

    function tabsGet(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(tab);
            });
        });
    }

    function tabsSendMessage(tabId, message) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    function executeScript(tabId, files) {
        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: files
        });
    }

    function createNotification(id, options) {
        return new Promise((resolve, reject) => {
            chrome.notifications.create(id, options, (createdId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(createdId);
            });
        });
    }

    function createOrUpdateAlarm(periodSeconds) {
        const minutes = Math.max((periodSeconds || DEFAULT_SETTINGS.monitoringIntervalSeconds) / 60, 0.5);
        chrome.alarms.create(ALARM_NAME, {
            periodInMinutes: minutes
        });
    }

    function clearAlarm() {
        return new Promise((resolve) => {
            chrome.alarms.clear(ALARM_NAME, resolve);
        });
    }

    function downloadJson(filename, payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function pickSummaryReasoning(reasons, limit) {
        return dedupeStrings(reasons).slice(0, limit || 4);
    }

    function countPresentValues(values) {
        return Object.values(values || {}).filter((value) => Number.isFinite(value)).length;
    }

    global.OptionsAssistantUtils = {
        ACTIONS,
        ALARM_NAME,
        DEFAULT_SETTINGS,
        INSTRUMENT_CATALOG,
        INSTRUMENT_TYPES,
        MAX_TEXT_SCAN_LENGTH,
        PREMIUM_RISK_MODES,
        STORAGE_VERSION,
        USER_PROFILES,
        appendLimitedHistory,
        appendSnapshotHistory,
        averageNumbers,
        clamp,
        clearAlarm,
        countPresentValues,
        createEmptyAccuracyMetrics,
        createEmptyGapPrediction,
        createEmptyNewsSentiment,
        createEmptyOptionChain,
        createEmptyOverallSignal,
        createEmptyDiagnostics,
        createEmptyAIAnalysis,
        createEmptyPremiumTradePlan,
        createEmptySnapshot,
        createEmptySupportResistance,
        createEmptyStructureAnalysis,
        createEmptyTradePlan,
        createEmptyTomorrowPrediction,
        createEmptyTrendAnalysis,
        createEmptyTrendBias,
        createEmptyValues,
        createId,
        createInitialState,
        createNotification,
        createOrUpdateAlarm,
        dedupeStrings,
        downloadJson,
        executeScript,
        extractFirstMatch,
        formatDateTime,
        formatAlignmentLabel,
        formatDirectionLabel,
        formatGapLabel,
        formatNumber,
        formatRelativeTime,
        formatSignalLabel,
        formatSignedNumber,
        formatTradeStatusLabel,
        getVisibleText,
        getStrikeIncrement,
        humanizeAssistantText,
        inferSiteTypeFromUrl,
        isIndexInstrument,
        isAccessibleUrl,
        limitArray,
        loadState,
        loadSelectedInstrument,
        loadUserProfile,
        mergeSettings,
        getInstrumentMeta,
        getInstrumentType,
        normalizeUserProfile,
        normalizeInstrumentSelection,
        normalizeOptionChain,
        normalizeExtractedOptionPremiums,
        normalizePremiumTradePlan,
        normalizePremiumRiskMode,
        normalizeStoredState,
        parseNumberFromText,
        parsePercentFromText,
        pickSummaryReasoning,
        pruneHistoryByDays,
        roundToStrike,
        round,
        saveState,
        setSelectedInstrument,
        setUserProfile,
        storageGet,
        storageRemove,
        storageSet,
        tabsGet,
        tabsQuery,
        tabsSendMessage,
        toDateKey,
        toNumber
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
