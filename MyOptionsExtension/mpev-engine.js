(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;
    const Context = global.OptionsMarketContext;

    function buildMorningProjection(args) {
        const overallSignal = args.overallSignal || Utils.createEmptyOverallSignal();
        const trendAnalysis = args.trendAnalysis || Utils.createEmptyTrendAnalysis();
        const gapPrediction = args.gapPrediction || Utils.createEmptyGapPrediction();
        const marketContext = args.marketContext;
        const values = marketContext.aggregateValues || Utils.createEmptyValues();
        const dateKey = Utils.toDateKey(marketContext.latestTimestamp || new Date().toISOString());

        return {
            dateKey: dateKey,
            mp: {
                timestamp: Date.now(),
                projectedSignal: overallSignal.signal,
                projectedGap: gapPrediction.primary,
                confidence: overallSignal.confidence,
                reasoning: Utils.pickSummaryReasoning(
                    []
                        .concat(overallSignal.reasoning || [])
                        .concat(trendAnalysis.bias15m.reasoning || [])
                        .concat(gapPrediction.reasoning || []),
                    6
                ),
                keyLevels: {
                    spot: values.spotPrice,
                    support: values.support,
                    resistance: values.resistance,
                    maxPain: values.maxPain
                },
                trend15m: trendAnalysis.bias15m.signal,
                trend1h: trendAnalysis.bias1h.signal
            }
        };
    }

    function buildEndOfDayValidation(args) {
        const mpEntry = args.mpEntry;
        const marketContext = args.marketContext;
        const values = marketContext.aggregateValues || Utils.createEmptyValues();
        const overallSignal = args.overallSignal || Utils.createEmptyOverallSignal();
        const dateKey = mpEntry ? mpEntry.dateKey : Utils.toDateKey(marketContext.latestTimestamp || new Date().toISOString());
        const actualDirection = deriveActualDirection(values, overallSignal);
        const actualGap = deriveActualGap(values, marketContext.rawSignals);
        const predictionResult = derivePredictionResult(mpEntry, actualDirection);
        let validationScore = scorePredictionResult(predictionResult);
        const notes = [];

        if (mpEntry && mpEntry.mp && mpEntry.mp.projectedGap && mpEntry.mp.projectedGap === actualGap && actualGap !== "UNKNOWN") {
            validationScore += 10;
            notes.push("Projected gap matched the observed gap state.");
        }

        if (predictionResult === "UNKNOWN") {
            notes.push("Actual direction could not be validated with confidence.");
        } else if (predictionResult === "HIT") {
            notes.push("Projection matched the session direction.");
        } else if (predictionResult === "PARTIAL_HIT") {
            notes.push("Projection captured part of the session behavior.");
        } else {
            notes.push("Projection did not match the session behavior.");
        }

        return {
            dateKey: dateKey,
            ev: {
                actualDirection: actualDirection,
                actualGap: actualGap,
                closeVsOpenPercent: deriveCloseVsOpen(values),
                validationScore: Utils.clamp(validationScore, 0, 100),
                predictionResult: predictionResult,
                notes: notes
            }
        };
    }

    function computeAccuracyMetrics(mpHistory, evHistory) {
        const mpMap = {};
        const validatedPairs = [];

        (mpHistory || []).forEach((entry) => {
            mpMap[entry.dateKey] = entry;
        });

        (evHistory || []).forEach((entry) => {
            if (mpMap[entry.dateKey]) {
                validatedPairs.push({
                    mp: mpMap[entry.dateKey],
                    ev: entry
                });
            }
        });

        if (!validatedPairs.length) {
            return Utils.createEmptyAccuracyMetrics();
        }

        const total = validatedPairs.length;
        const hits = validatedPairs.filter((pair) => pair.ev.ev.predictionResult === "HIT").length;
        const partialHits = validatedPairs.filter((pair) => pair.ev.ev.predictionResult === "PARTIAL_HIT").length;
        const gapHits = validatedPairs.filter((pair) => pair.mp.mp.projectedGap === pair.ev.ev.actualGap && pair.ev.ev.actualGap !== "UNKNOWN").length;
        const averageConfidence = Utils.averageNumbers(validatedPairs.map((pair) => pair.mp.mp.confidence)) || 0;

        return {
            totalProjections: total,
            hitRate: Math.round((hits / total) * 100),
            partialHitRate: Math.round((partialHits / total) * 100),
            gapAccuracy: Math.round((gapHits / total) * 100),
            averageConfidence: Math.round(averageConfidence),
            confidenceAccuracyCorrelation: Utils.round(calculateCorrelation(validatedPairs), 2) || 0
        };
    }

    function upsertEntry(history, entry) {
        const next = Array.isArray(history) ? history.slice() : [];
        const existingIndex = next.findIndex((item) => item.dateKey === entry.dateKey);
        if (existingIndex >= 0) {
            next[existingIndex] = entry;
        } else {
            next.push(entry);
        }
        return next.sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));
    }

    function getTodayProjection(mpHistory, timestamp) {
        const today = Utils.toDateKey(timestamp || new Date().toISOString());
        return (mpHistory || []).find((entry) => entry.dateKey === today) || null;
    }

    function deriveActualDirection(values, overallSignal) {
        if (Number.isFinite(values.changePercent)) {
            if (values.changePercent > 0.3) {
                return "UP";
            }
            if (values.changePercent < -0.3) {
                return "DOWN";
            }
            return "FLAT";
        }

        if (Context.isBullishSignal(overallSignal.signal)) {
            return "UP";
        }
        if (Context.isBearishSignal(overallSignal.signal)) {
            return "DOWN";
        }
        if (overallSignal.signal === "WAIT") {
            return "FLAT";
        }
        return "UNKNOWN";
    }

    function deriveActualGap(values, rawSignals) {
        if (Number.isFinite(values.openPrice) && Number.isFinite(values.previousClose) && values.previousClose !== 0) {
            const gapPercent = ((values.openPrice - values.previousClose) / values.previousClose) * 100;
            if (gapPercent > 0.25) {
                return "GAP_UP";
            }
            if (gapPercent < -0.25) {
                return "GAP_DOWN";
            }
            return "FLAT_OPEN";
        }

        const textDirection = Context.extractDirectionalText(rawSignals);
        if (textDirection === "bullish") {
            return "GAP_UP";
        }
        if (textDirection === "bearish") {
            return "GAP_DOWN";
        }
        return "UNKNOWN";
    }

    function derivePredictionResult(mpEntry, actualDirection) {
        if (!mpEntry || !mpEntry.mp || !actualDirection || actualDirection === "UNKNOWN") {
            return "UNKNOWN";
        }

        const projected = mpEntry.mp.projectedSignal;
        if (projected === "WAIT" && actualDirection === "FLAT") {
            return "HIT";
        }
        if (projected === "BULLISH" && actualDirection === "UP") {
            return "HIT";
        }
        if (projected === "BEARISH" && actualDirection === "DOWN") {
            return "HIT";
        }
        if (projected === "WEAK_BULLISH" && (actualDirection === "UP" || actualDirection === "FLAT")) {
            return actualDirection === "UP" ? "HIT" : "PARTIAL_HIT";
        }
        if (projected === "WEAK_BEARISH" && (actualDirection === "DOWN" || actualDirection === "FLAT")) {
            return actualDirection === "DOWN" ? "HIT" : "PARTIAL_HIT";
        }
        if (projected === "WAIT" && actualDirection === "UP") {
            return "PARTIAL_HIT";
        }
        if (projected === "WAIT" && actualDirection === "DOWN") {
            return "PARTIAL_HIT";
        }
        return "MISS";
    }

    function deriveCloseVsOpen(values) {
        if (!Number.isFinite(values.openPrice) || !Number.isFinite(values.spotPrice) || values.openPrice === 0) {
            return null;
        }
        return Utils.round(((values.spotPrice - values.openPrice) / values.openPrice) * 100, 2);
    }

    function scorePredictionResult(predictionResult) {
        if (predictionResult === "HIT") {
            return 85;
        }
        if (predictionResult === "PARTIAL_HIT") {
            return 60;
        }
        if (predictionResult === "MISS") {
            return 20;
        }
        return 0;
    }

    function calculateCorrelation(validatedPairs) {
        if (!validatedPairs.length) {
            return 0;
        }

        const xValues = validatedPairs.map((pair) => pair.mp.mp.confidence || 0);
        const yValues = validatedPairs.map((pair) => pair.ev.ev.validationScore || 0);
        const xMean = Utils.averageNumbers(xValues) || 0;
        const yMean = Utils.averageNumbers(yValues) || 0;
        let numerator = 0;
        let xVariance = 0;
        let yVariance = 0;

        for (let index = 0; index < xValues.length; index += 1) {
            const xDiff = xValues[index] - xMean;
            const yDiff = yValues[index] - yMean;
            numerator += xDiff * yDiff;
            xVariance += xDiff * xDiff;
            yVariance += yDiff * yDiff;
        }

        const denominator = Math.sqrt(xVariance * yVariance);
        if (!denominator) {
            return 0;
        }
        return numerator / denominator;
    }

    global.OptionsMPEVEngine = {
        buildEndOfDayValidation: buildEndOfDayValidation,
        buildMorningProjection: buildMorningProjection,
        computeAccuracyMetrics: computeAccuracyMetrics,
        getTodayProjection: getTodayProjection,
        upsertEntry: upsertEntry
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
