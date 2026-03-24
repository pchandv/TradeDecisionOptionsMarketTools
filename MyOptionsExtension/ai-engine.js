(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    function buildAIPrompt(marketContext) {
        const safePayload = marketContext && typeof marketContext === "object" ? marketContext : {};
        const instrument = safePayload.instrument || "selected instrument";
        return [
            "You are a professional options trader.",
            "",
            `Analyze ${instrument} options trade setup from the following data.`,
            "",
            "Analyze the following market data and respond STRICTLY in JSON format:",
            "",
            "{",
            "  \"summary\": \"\",",
            "  \"beginnerAdvice\": \"\",",
            "  \"proInsight\": \"\",",
            "  \"tradeSuggestion\": \"BUY CE | BUY PE | WAIT\",",
            "  \"riskWarning\": \"\"",
            "}",
            "",
            "Keep responses concise.",
            "",
            "Market Data:",
            JSON.stringify(safePayload, null, 2)
        ].join("\n");
    }

    function parseAIResponse(text) {
        const sourceText = String(text || "").trim();
        const empty = createParsedResult({
            summary: "",
            beginnerAdvice: "",
            proInsight: "",
            tradeSuggestion: "WAIT",
            riskWarning: ""
        }, sourceText, "RAW_FALLBACK");

        if (!sourceText) {
            return empty;
        }

        const direct = tryParseJson(sourceText);
        if (direct) {
            return normalizeParsedPayload(direct, sourceText, "DIRECT_JSON");
        }

        const fenced = extractCodeFenceJson(sourceText);
        if (fenced) {
            const parsedFence = tryParseJson(fenced);
            if (parsedFence) {
                return normalizeParsedPayload(parsedFence, sourceText, "FENCED_JSON");
            }
        }

        const bracket = extractBracketJson(sourceText);
        if (bracket) {
            const parsedBracket = tryParseJson(bracket);
            if (parsedBracket) {
                return normalizeParsedPayload(parsedBracket, sourceText, "INLINE_JSON");
            }
        }

        return empty;
    }

    function buildAIMarketPayload(args) {
        const source = args || {};
        const overallSignal = source.overallSignal || Utils.createEmptyOverallSignal();
        const trendAnalysis = source.trendAnalysis || Utils.createEmptyTrendAnalysis();
        const tradePlan = source.tradePlan || Utils.createEmptyTradePlan();
        const supportResistance = source.supportResistance || Utils.createEmptySupportResistance();
        const structureAnalysis = source.structureAnalysis || Utils.createEmptyStructureAnalysis();
        const tomorrowPrediction = source.tomorrowPrediction || Utils.createEmptyTomorrowPrediction();
        const premiumPlan = tradePlan && tradePlan.premiumTradePlan ? tradePlan.premiumTradePlan : Utils.createEmptyPremiumTradePlan();
        return {
            generatedAt: new Date().toISOString(),
            instrument: source.marketContext && source.marketContext.instrument ? source.marketContext.instrument : "UNKNOWN",
            marketBias: overallSignal.marketBias || overallSignal.signal || "WAIT",
            tradeReadiness: overallSignal.tradeReadiness || tradePlan.status || "NO_TRADE",
            confidence: overallSignal.confidence || 0,
            trend15m: trendAnalysis.bias15m && trendAnalysis.bias15m.signal ? trendAnalysis.bias15m.signal : "SIDEWAYS",
            trend1h: trendAnalysis.bias1h && trendAnalysis.bias1h.signal ? trendAnalysis.bias1h.signal : "SIDEWAYS",
            support: supportResistance.nearestSupport,
            resistance: supportResistance.nearestResistance,
            breakout: Boolean(supportResistance.breakout),
            breakdown: Boolean(supportResistance.breakdown),
            structure: structureAnalysis.structure || "MIXED",
            suggestedContract: tradePlan && tradePlan.suggestedContract ? tradePlan.suggestedContract.symbol : "--",
            premiumPlan: premiumPlan,
            newsSentiment: source.newsSentiment || Utils.createEmptyNewsSentiment(),
            tomorrowOutlook: tomorrowPrediction && tomorrowPrediction.tomorrowPrediction
                ? tomorrowPrediction.tomorrowPrediction
                : Utils.createEmptyTomorrowPrediction().tomorrowPrediction,
            modelContext: {
                marketRegime: source.marketContext && source.marketContext.marketRegime ? source.marketContext.marketRegime : "BALANCED",
                gapPrediction: source.gapPrediction || Utils.createEmptyGapPrediction(),
                tradePlan: tradePlan,
                supportResistance: supportResistance,
                structureAnalysis: structureAnalysis
            }
        };
    }

    function normalizeParsedPayload(parsed, rawText, parseMode) {
        const payload = parsed && typeof parsed === "object" ? parsed : {};
        const tradeSuggestion = normalizeTradeSuggestion(payload.tradeSuggestion);

        return createParsedResult({
            summary: String(payload.summary || "").trim(),
            beginnerAdvice: String(payload.beginnerAdvice || "").trim(),
            proInsight: String(payload.proInsight || "").trim(),
            tradeSuggestion: tradeSuggestion,
            riskWarning: String(payload.riskWarning || "").trim()
        }, rawText, parseMode);
    }

    function createParsedResult(data, rawText, parseMode) {
        return {
            summary: data.summary || "",
            beginnerAdvice: data.beginnerAdvice || "",
            proInsight: data.proInsight || "",
            tradeSuggestion: normalizeTradeSuggestion(data.tradeSuggestion),
            riskWarning: data.riskWarning || "",
            rawText: String(rawText || ""),
            parseMode: parseMode || "RAW_FALLBACK"
        };
    }

    function tryParseJson(text) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return null;
        }
    }

    function extractCodeFenceJson(text) {
        const match = String(text || "").match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        return match ? match[1].trim() : "";
    }

    function extractBracketJson(text) {
        const source = String(text || "");
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) {
            return "";
        }
        return source.slice(start, end + 1).trim();
    }

    function normalizeTradeSuggestion(value) {
        const upper = String(value || "WAIT").trim().toUpperCase();
        if (upper === "BUY CE") {
            return "BUY CE";
        }
        if (upper === "BUY PE") {
            return "BUY PE";
        }
        if (upper === "WAIT") {
            return "WAIT";
        }
        if (upper.includes("CE")) {
            return "BUY CE";
        }
        if (upper.includes("PE")) {
            return "BUY PE";
        }
        return "WAIT";
    }

    global.OptionsAIEngine = {
        buildAIPrompt: buildAIPrompt,
        parseAIResponse: parseAIResponse,
        buildAIMarketPayload: buildAIMarketPayload
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
