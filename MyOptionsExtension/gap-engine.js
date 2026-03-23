(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;
    const Context = global.OptionsMarketContext;

    function evaluate(args, settings) {
        const marketContext = args.marketContext;
        const overallSignal = args.overallSignal || Utils.createEmptyOverallSignal();
        const trendAnalysis = args.trendAnalysis || Utils.createEmptyTrendAnalysis();
        const values = marketContext.aggregateValues || Utils.createEmptyValues();
        const reasoning = [];
        const warnings = [];
        const scores = {
            gapUp: 34,
            gapDown: 33,
            flatOpen: 33
        };
        let dataPoints = 0;

        if (Context.isBullishSignal(trendAnalysis.bias15m.signal) && Context.isBullishSignal(trendAnalysis.bias1h.signal)) {
            scores.gapUp += 20;
            reasoning.push("Short-term and hourly trend are aligned bullish.");
            dataPoints += 1;
        } else if (Context.isBearishSignal(trendAnalysis.bias15m.signal) && Context.isBearishSignal(trendAnalysis.bias1h.signal)) {
            scores.gapDown += 20;
            reasoning.push("Short-term and hourly trend are aligned bearish.");
            dataPoints += 1;
        } else {
            scores.flatOpen += 12;
            reasoning.push("Trend alignment is mixed, so a muted open remains possible.");
        }

        if (overallSignal.signal === "BULLISH") {
            scores.gapUp += settings.gapLateMomentumWeight;
            reasoning.push("Overall signal remains bullish into the close.");
            dataPoints += 1;
        } else if (overallSignal.signal === "BEARISH") {
            scores.gapDown += settings.gapLateMomentumWeight;
            reasoning.push("Overall signal remains bearish into the close.");
            dataPoints += 1;
        } else if (overallSignal.signal === "WEAK_BULLISH") {
            scores.gapUp += 10;
            reasoning.push("Overall signal leans mildly bullish.");
            dataPoints += 1;
        } else if (overallSignal.signal === "WEAK_BEARISH") {
            scores.gapDown += 10;
            reasoning.push("Overall signal leans mildly bearish.");
            dataPoints += 1;
        }

        if (Number.isFinite(values.changePercent)) {
            dataPoints += 1;
            if (values.changePercent > 0.7) {
                scores.gapUp += 12;
                reasoning.push("Late-session momentum remains positive.");
            } else if (values.changePercent < -0.7) {
                scores.gapDown += 12;
                reasoning.push("Late-session momentum remains negative.");
            } else {
                scores.flatOpen += 8;
            }
        }

        if (Number.isFinite(values.vix)) {
            dataPoints += 1;
            if (values.vix >= settings.highVixThreshold) {
                scores.flatOpen += 12;
                scores.gapUp += 6;
                scores.gapDown += 6;
                warnings.push("High VIX increases overnight uncertainty.");
            } else if (values.vix <= settings.elevatedVixThreshold) {
                scores.flatOpen -= 4;
                reasoning.push("VIX is controlled, so directional continuation is more believable.");
            }
        }

        if (Number.isFinite(values.pcr)) {
            dataPoints += 1;
            if (values.pcr >= settings.bullishPcrThreshold) {
                scores.gapUp += 10;
                reasoning.push("PCR remains supportive for a higher open.");
            } else if (values.pcr <= settings.bearishPcrThreshold) {
                scores.gapDown += 10;
                reasoning.push("PCR remains supportive for a weaker open.");
            }
        }

        if (Number.isFinite(values.maxPain) && Number.isFinite(values.spotPrice)) {
            dataPoints += 1;
            if (values.maxPain > values.spotPrice) {
                scores.gapUp += 8;
                reasoning.push("Max pain above spot adds mild gap-up support.");
            } else if (values.maxPain < values.spotPrice) {
                scores.gapDown += 8;
                reasoning.push("Max pain below spot adds mild gap-down support.");
            }
        }

        const globalCueScore = scoreGlobalCues(values, settings);
        if (globalCueScore > 0) {
            scores.gapUp += globalCueScore;
            reasoning.push("Visible global cues lean positive.");
            dataPoints += 1;
        } else if (globalCueScore < 0) {
            scores.gapDown += Math.abs(globalCueScore);
            reasoning.push("Visible global cues lean negative.");
            dataPoints += 1;
        }

        if (trendAnalysis.alignment.status === "MIXED") {
            scores.flatOpen += 10;
            warnings.push("Trend alignment is mixed.");
        }

        const probabilities = Context.normalizeProbabilities(scores);
        const ranked = [
            { key: "GAP_UP", value: probabilities.gapUp },
            { key: "GAP_DOWN", value: probabilities.gapDown },
            { key: "FLAT_OPEN", value: probabilities.flatOpen }
        ].sort((left, right) => right.value - left.value);

        let confidence = ranked[0].value - ranked[1].value + (dataPoints * 4);
        if (warnings.length) {
            confidence -= warnings.length * 6;
        }
        confidence = Context.clampConfidence(confidence);

        let primary = ranked[0].key;
        if (confidence < settings.lowConfidenceThreshold || dataPoints < 2) {
            primary = ranked[0].value <= 40 ? "UNKNOWN" : ranked[0].key;
            warnings.push("Gap read has limited conviction.");
        }

        return {
            gapPrediction: {
                primary: primary,
                confidence: confidence,
                probabilities: probabilities,
                reasoning: Utils.pickSummaryReasoning(reasoning, 5),
                warnings: Utils.pickSummaryReasoning(warnings.length ? warnings : ["Incomplete data"], 4)
            }
        };
    }

    function scoreGlobalCues(values, settings) {
        let score = 0;

        if (Number.isFinite(values.giftNifty)) {
            score += values.giftNifty > 0 ? settings.gapGlobalCueWeight : -settings.gapGlobalCueWeight;
        }
        if (Number.isFinite(values.dowFutures)) {
            score += values.dowFutures > 0 ? 6 : -6;
        }
        if (Number.isFinite(values.nasdaqFutures)) {
            score += values.nasdaqFutures > 0 ? 6 : -6;
        }
        if (Number.isFinite(values.crude)) {
            score += values.crude < 0 ? 4 : -4;
        }
        if (Number.isFinite(values.dxy)) {
            score += values.dxy < 0 ? 4 : -4;
        }
        if (Number.isFinite(values.usYield)) {
            score += values.usYield < 0 ? 3 : -3;
        }

        return score;
    }

    global.OptionsGapEngine = {
        evaluate: evaluate
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
