(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const FINAL_ACTIONS = {
        DO_NOT_TRADE: "DO NOT TRADE",
        WAIT_FOR_CONFIRMATION: "WAIT FOR CONFIRMATION",
        BUY_CE: "BUY CE",
        BUY_PE: "BUY PE"
    };

    const TRAFFIC_LIGHTS = {
        RED: {
            color: "red",
            icon: "🔴",
            label: "DO NOT TRADE"
        },
        YELLOW: {
            color: "yellow",
            icon: "🟡",
            label: "WAIT"
        },
        GREEN: {
            color: "green",
            icon: "🟢",
            label: "TRADE"
        }
    };

    function getActiveProfile(state) {
        const source = state && state.userProfile
            ? state.userProfile
            : state && state.settings
                ? state.settings.defaultProfile
                : Utils.USER_PROFILES.BEGINNER;
        return Utils.normalizeUserProfile(source);
    }

    function buildBeginnerSnapshot(state) {
        const settings = state && state.settings ? state.settings : Utils.DEFAULT_SETTINGS;
        const overall = state && state.overallSignal ? state.overallSignal : Utils.createEmptyOverallSignal();
        const trendAnalysis = state && state.latestTrendAnalysis ? state.latestTrendAnalysis : Utils.createEmptyTrendAnalysis();
        const tradePlan = state && state.latestTradePlan ? state.latestTradePlan : Utils.createEmptyTradePlan();
        const keyLevels = state && state.latestSupportResistance ? state.latestSupportResistance : Utils.createEmptySupportResistance();
        const news = state && state.latestNewsSentiment ? state.latestNewsSentiment : Utils.createEmptyNewsSentiment();

        const finalAction = resolveFinalAction(overall, tradePlan);
        const trafficLight = resolveTrafficLight(finalAction);
        const confidenceBand = resolveConfidenceBand(overall.confidence, settings);
        const summary = buildOneLineSummary(finalAction, overall, trendAnalysis, keyLevels, news);
        const executionLogic = buildExecutionLogic(finalAction, tradePlan, keyLevels);

        return {
            profile: Utils.USER_PROFILES.BEGINNER,
            finalAction: finalAction,
            trafficLight: trafficLight,
            confidenceBand: confidenceBand,
            summary: summary,
            executionLogic: executionLogic,
            quickLevels: {
                support: keyLevels.nearestSupport,
                resistance: keyLevels.nearestResistance
            }
        };
    }

    function resolveFinalAction(overall, tradePlan) {
        const status = String(tradePlan && tradePlan.status || "NO_TRADE").toUpperCase();
        const direction = String(tradePlan && tradePlan.direction || "NONE").toUpperCase();
        const signal = String(overall && overall.signal || "WAIT").toUpperCase();
        const confidence = Utils.toNumber(overall && overall.confidence) || 0;

        if (status === "NO_TRADE" || direction === "NONE") {
            return FINAL_ACTIONS.DO_NOT_TRADE;
        }

        if (status === "WAIT_CONFIRMATION" || signal === "WAIT" || confidence < 45) {
            return FINAL_ACTIONS.WAIT_FOR_CONFIRMATION;
        }

        if ((status === "READY" || status === "AGGRESSIVE_READY") && direction === "CE") {
            return FINAL_ACTIONS.BUY_CE;
        }

        if ((status === "READY" || status === "AGGRESSIVE_READY") && direction === "PE") {
            return FINAL_ACTIONS.BUY_PE;
        }

        return FINAL_ACTIONS.WAIT_FOR_CONFIRMATION;
    }

    function resolveTrafficLight(finalAction) {
        if (finalAction === FINAL_ACTIONS.BUY_CE || finalAction === FINAL_ACTIONS.BUY_PE) {
            return TRAFFIC_LIGHTS.GREEN;
        }
        if (finalAction === FINAL_ACTIONS.WAIT_FOR_CONFIRMATION) {
            return TRAFFIC_LIGHTS.YELLOW;
        }
        return TRAFFIC_LIGHTS.RED;
    }

    function resolveConfidenceBand(confidence, settings) {
        const weakThreshold = Utils.toNumber(settings && settings.beginnerWeakConfidenceThreshold) || 35;
        const strongThreshold = Utils.toNumber(settings && settings.beginnerStrongConfidenceThreshold) || 60;
        const safeConfidence = Utils.clamp(Math.round(confidence || 0), 0, 100);

        if (safeConfidence < weakThreshold) {
            return {
                label: "WEAK",
                display: "WEAK ❌",
                className: "weak"
            };
        }

        if (safeConfidence <= strongThreshold) {
            return {
                label: "MODERATE",
                display: "MODERATE ⚠️",
                className: "moderate"
            };
        }

        return {
            label: "STRONG",
            display: "STRONG ✅",
            className: "strong"
        };
    }

    function buildOneLineSummary(finalAction, overall, trendAnalysis, keyLevels, news) {
        const biasText = describeBias(overall, trendAnalysis);
        const levelText = describeLevelTrigger(finalAction, keyLevels);
        const newsText = describeNewsEffect(news);

        return [biasText, newsText, levelText]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function describeBias(overall, trendAnalysis) {
        const shortSignal = String(trendAnalysis && trendAnalysis.bias15m && trendAnalysis.bias15m.signal || "SIDEWAYS").toUpperCase();
        const longSignal = String(trendAnalysis && trendAnalysis.bias1h && trendAnalysis.bias1h.signal || "SIDEWAYS").toUpperCase();
        const overallSignal = String(overall && overall.signal || "WAIT").toUpperCase();

        if (overallSignal === "BULLISH" || overallSignal === "WEAK_BULLISH") {
            if (shortSignal === "BULLISH" && longSignal === "BULLISH") {
                return "Market is bullish with trend alignment.";
            }
            return "Market is mildly bullish but still needs confirmation.";
        }

        if (overallSignal === "BEARISH" || overallSignal === "WEAK_BEARISH") {
            if (shortSignal === "BEARISH" && longSignal === "BEARISH") {
                return "Market is bearish with trend alignment.";
            }
            return "Market is mildly bearish but still needs confirmation.";
        }

        if (shortSignal === "SIDEWAYS" && longSignal === "SIDEWAYS") {
            return "Market is range-bound and not giving a clean directional edge.";
        }

        return "Market signals are mixed right now.";
    }

    function describeNewsEffect(news) {
        const sentiment = String(news && news.sentiment || "NEUTRAL").toUpperCase();
        if (sentiment === "BULLISH") {
            return "News flow is offering a mild bullish tailwind.";
        }
        if (sentiment === "BEARISH") {
            return "News flow is adding a bearish tone.";
        }
        return "";
    }

    function describeLevelTrigger(finalAction, keyLevels) {
        const support = Number.isFinite(keyLevels && keyLevels.nearestSupport) ? Utils.formatNumber(keyLevels.nearestSupport, 2) : null;
        const resistance = Number.isFinite(keyLevels && keyLevels.nearestResistance) ? Utils.formatNumber(keyLevels.nearestResistance, 2) : null;

        if (finalAction === FINAL_ACTIONS.BUY_CE && resistance) {
            return `Focus on strength above ${resistance}.`;
        }

        if (finalAction === FINAL_ACTIONS.BUY_PE && support) {
            return `Focus on weakness below ${support}.`;
        }

        if (support) {
            return `Wait for a clear move around ${support}${resistance ? ` / ${resistance}` : ""}.`;
        }

        if (resistance) {
            return `Wait for a clean breakout or rejection near ${resistance}.`;
        }

        return "Wait for the next clean support or resistance test.";
    }

    function buildExecutionLogic(finalAction, tradePlan, keyLevels) {
        const support = Number.isFinite(keyLevels && keyLevels.nearestSupport) ? Utils.formatNumber(keyLevels.nearestSupport, 2) : null;
        const resistance = Number.isFinite(keyLevels && keyLevels.nearestResistance) ? Utils.formatNumber(keyLevels.nearestResistance, 2) : null;
        const direction = String(tradePlan && tradePlan.direction || "NONE").toUpperCase();

        if (finalAction === FINAL_ACTIONS.BUY_CE) {
            return resistance
                ? `IF price stays above ${resistance} -> BUY CE ELSE WAIT FOR CONFIRMATION`
                : "IF price confirms higher highs -> BUY CE ELSE WAIT FOR CONFIRMATION";
        }

        if (finalAction === FINAL_ACTIONS.BUY_PE) {
            return support
                ? `IF price breaks below ${support} -> BUY PE ELSE WAIT FOR CONFIRMATION`
                : "IF price confirms lower lows -> BUY PE ELSE WAIT FOR CONFIRMATION";
        }

        if (direction === "CE" && resistance) {
            return `IF price moves above ${resistance} -> BUY CE ELSE DO NOT TRADE`;
        }

        if (direction === "PE" && support) {
            return `IF price moves below ${support} -> BUY PE ELSE DO NOT TRADE`;
        }

        if (support && resistance) {
            return `IF price breaks above ${resistance} -> BUY CE ELSE IF price breaks below ${support} -> BUY PE ELSE DO NOT TRADE`;
        }

        return "IF confirmation is missing -> DO NOT TRADE";
    }

    global.OptionsProfileEngine = {
        FINAL_ACTIONS: FINAL_ACTIONS,
        TRAFFIC_LIGHTS: TRAFFIC_LIGHTS,
        buildBeginnerSnapshot: buildBeginnerSnapshot,
        getActiveProfile: getActiveProfile
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
