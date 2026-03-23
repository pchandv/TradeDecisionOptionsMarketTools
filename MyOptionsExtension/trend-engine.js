(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;
    const Context = global.OptionsMarketContext;

    function evaluate(marketContext, settings) {
        const snapshots = marketContext && marketContext.snapshots ? marketContext.snapshots : [];
        const shortRows = [];
        const longRows = [];

        snapshots.forEach((snapshot) => {
            const history = Array.isArray(marketContext.snapshotsByTab[snapshot.tabId]) ? marketContext.snapshotsByTab[snapshot.tabId] : [snapshot];
            shortRows.push(scoreTimeframe(snapshot, history, "15m", settings));
            longRows.push(scoreTimeframe(snapshot, history, "1h", settings));
        });

        const bias15m = aggregateRows(shortRows, "15m", settings);
        const bias1h = aggregateRows(longRows, "1h", settings);
        const alignment = buildAlignment(bias15m, bias1h);

        return {
            bias15m: bias15m,
            bias1h: bias1h,
            alignment: alignment
        };
    }

    function scoreTimeframe(snapshot, history, timeframe, settings) {
        const values = Object.assign(Utils.createEmptyValues(), snapshot.values || {});
        const reasoning = [];
        let bullish = 0;
        let bearish = 0;
        let sideways = 0;
        let availableSignals = 0;

        const slopeWindow = timeframe === "15m" ? 15 : 60;
        const slopeWeight = timeframe === "15m" ? settings.trend15mSlopeWeight : settings.trend1hSlopeWeight;
        const slope = Context.calculateSlope(history, slopeWindow, "spotPrice");

        if (Number.isFinite(slope)) {
            availableSignals += 1;
            if (slope > settings.trendSidewaysSensitivity) {
                bullish += slopeWeight;
                reasoning.push(`${timeframe} slope is positive.`);
            } else if (slope < -settings.trendSidewaysSensitivity) {
                bearish += slopeWeight;
                reasoning.push(`${timeframe} slope is negative.`);
            } else {
                sideways += 14;
                reasoning.push(`${timeframe} slope is muted.`);
            }
        }

        if (Number.isFinite(values.spotPrice) && Number.isFinite(values.vwap)) {
            availableSignals += 1;
            if (values.spotPrice > values.vwap) {
                bullish += 12;
                reasoning.push("Spot is above VWAP.");
            } else if (values.spotPrice < values.vwap) {
                bearish += 12;
                reasoning.push("Spot is below VWAP.");
            }
        }

        if (Number.isFinite(values.spotPrice) && Number.isFinite(values.resistance)) {
            availableSignals += 1;
            if (values.spotPrice > values.resistance) {
                bullish += 14;
                reasoning.push("Price is above resistance.");
            } else if (Context.nearLevel(values.spotPrice, values.resistance, settings.supportResistanceBufferPercent)) {
                bearish += 8;
                reasoning.push("Price is testing resistance without a clear breakout.");
            }
        }

        if (Number.isFinite(values.spotPrice) && Number.isFinite(values.support)) {
            availableSignals += 1;
            if (values.spotPrice < values.support) {
                bearish += 14;
                reasoning.push("Price is below support.");
            } else if (Context.nearLevel(values.spotPrice, values.support, settings.supportResistanceBufferPercent)) {
                bullish += 8;
                reasoning.push("Price is holding near support.");
            }
        }

        if (Number.isFinite(values.changePercent)) {
            availableSignals += 1;
            if (values.changePercent > 0) {
                bullish += timeframe === "15m" ? 8 : 6;
                reasoning.push("Momentum is positive.");
            } else if (values.changePercent < 0) {
                bearish += timeframe === "15m" ? 8 : 6;
                reasoning.push("Momentum is negative.");
            }
        }

        if (Number.isFinite(values.putOi) && Number.isFinite(values.callOi)) {
            availableSignals += 1;
            if (values.putOi > values.callOi) {
                bullish += 10;
                reasoning.push("Put OI dominates Call OI.");
            } else if (values.callOi > values.putOi) {
                bearish += 10;
                reasoning.push("Call OI dominates Put OI.");
            }
        }

        const textDirection = Context.extractDirectionalText(snapshot.rawSignals);
        if (textDirection !== "unknown") {
            availableSignals += 1;
            if (textDirection === "bullish") {
                bullish += 10;
                reasoning.push("Visible page text leans bullish.");
            } else if (textDirection === "bearish") {
                bearish += 10;
                reasoning.push("Visible page text leans bearish.");
            } else {
                sideways += 8;
                reasoning.push("Visible page text looks neutral.");
            }
        }

        if (timeframe === "1h") {
            if (Number.isFinite(values.maxPain) && Number.isFinite(values.spotPrice)) {
                availableSignals += 1;
                if (values.maxPain > values.spotPrice) {
                    bullish += 8;
                    reasoning.push("Max pain sits above spot.");
                } else if (values.maxPain < values.spotPrice) {
                    bearish += 8;
                    reasoning.push("Max pain sits below spot.");
                }
            }

            if (Number.isFinite(values.pcr)) {
                availableSignals += 1;
                if (values.pcr >= settings.bullishPcrThreshold) {
                    bullish += 12;
                    reasoning.push("PCR regime remains supportive.");
                } else if (values.pcr <= settings.bearishPcrThreshold) {
                    bearish += 12;
                    reasoning.push("PCR regime remains bearish.");
                }
            }
        }

        const consistencyDirection = detectConsistency(history, timeframe === "15m" ? 4 : 6);
        if (consistencyDirection === "bullish") {
            bullish += settings.trendConsistencyBonus;
            reasoning.push("Recent snapshots stayed consistently bullish.");
        } else if (consistencyDirection === "bearish") {
            bearish += settings.trendConsistencyBonus;
            reasoning.push("Recent snapshots stayed consistently bearish.");
        }

        const rangePosition = Context.positionWithinRange(values.spotPrice, values.support, values.resistance);
        if (rangePosition != null && rangePosition > 0.35 && rangePosition < 0.65 && Math.abs(slope || 0) <= settings.trendSidewaysSensitivity) {
            sideways += 18;
            reasoning.push("Price is trapped in the middle of the range.");
        }

        return buildBiasResult(timeframe, bullish, bearish, sideways, availableSignals, reasoning, settings);
    }

    function buildBiasResult(timeframe, bullish, bearish, sideways, availableSignals, reasoning, settings) {
        const totalDirectional = bullish + bearish;
        let confidence = totalDirectional ? (Math.max(bullish, bearish) / totalDirectional) * 100 : 0;
        const gap = Math.abs(bullish - bearish);

        if (availableSignals < 2) {
            confidence -= 20;
        }
        if (bullish > 0 && bearish > 0) {
            confidence -= gap <= 8 ? 18 : 10;
        }
        if (sideways > 0 && totalDirectional < 18) {
            confidence -= 8;
        }

        confidence = Context.clampConfidence(confidence);

        let signal = "SIDEWAYS";
        if (!totalDirectional && !sideways) {
            signal = "SIDEWAYS";
        } else if (sideways >= 18 && gap <= 10) {
            signal = "SIDEWAYS";
        } else if (gap <= 6 && sideways >= 10) {
            signal = "SIDEWAYS";
        } else if (confidence < settings.lowConfidenceThreshold) {
            signal = bullish >= bearish ? "WEAK_BULLISH" : "WEAK_BEARISH";
        } else if (bullish > bearish) {
            signal = confidence >= 55 ? "BULLISH" : "WEAK_BULLISH";
        } else if (bearish > bullish) {
            signal = confidence >= 55 ? "BEARISH" : "WEAK_BEARISH";
        }

        const summary = buildSummary(timeframe, signal);
        const notes = reasoning.slice();
        notes.push(summary);

        return {
            signal: signal,
            confidence: confidence,
            scoreBullish: Utils.round(bullish, 2),
            scoreBearish: Utils.round(bearish, 2),
            reasoning: Utils.pickSummaryReasoning(notes, 5)
        };
    }

    function detectConsistency(history, count) {
        const recent = Array.isArray(history) ? history.slice(-Math.max(2, count)) : [];
        if (recent.length < 3) {
            return "unknown";
        }

        let bullishMoves = 0;
        let bearishMoves = 0;
        for (let index = 1; index < recent.length; index += 1) {
            const previous = recent[index - 1].values ? recent[index - 1].values.spotPrice : null;
            const current = recent[index].values ? recent[index].values.spotPrice : null;
            if (!Number.isFinite(previous) || !Number.isFinite(current)) {
                continue;
            }
            if (current > previous) {
                bullishMoves += 1;
            } else if (current < previous) {
                bearishMoves += 1;
            }
        }

        if (bullishMoves >= 3 && bearishMoves === 0) {
            return "bullish";
        }
        if (bearishMoves >= 3 && bullishMoves === 0) {
            return "bearish";
        }
        return "unknown";
    }

    function aggregateRows(rows, timeframe, settings) {
        if (!rows.length) {
            return Utils.createEmptyTrendBias("SIDEWAYS");
        }

        const bullish = Utils.averageNumbers(rows.map((row) => row.scoreBullish)) || 0;
        const bearish = Utils.averageNumbers(rows.map((row) => row.scoreBearish)) || 0;
        const confidence = Math.round(Utils.averageNumbers(rows.map((row) => row.confidence)) || 0);
        const reasoning = [];

        rows.forEach((row) => {
            reasoning.push(...(row.reasoning || []).slice(0, 1));
        });

        const result = buildBiasResult(timeframe, bullish, bearish, 0, rows.length, reasoning, settings);
        result.confidence = Context.clampConfidence((result.confidence + confidence) / 2);
        return result;
    }

    function buildAlignment(bias15m, bias1h) {
        if (Context.isBullishSignal(bias15m.signal) && Context.isBullishSignal(bias1h.signal)) {
            return {
                status: "ALIGNED_BULLISH",
                notes: ["15-minute and 1-hour bias both lean bullish."]
            };
        }
        if (Context.isBearishSignal(bias15m.signal) && Context.isBearishSignal(bias1h.signal)) {
            return {
                status: "ALIGNED_BEARISH",
                notes: ["15-minute and 1-hour bias both lean bearish."]
            };
        }
        if (Context.isSidewaysSignal(bias15m.signal) && Context.isSidewaysSignal(bias1h.signal)) {
            return {
                status: "NEUTRAL",
                notes: ["Both trend views are non-directional."]
            };
        }
        return {
            status: "MIXED",
            notes: ["Short-term and broader trend are not fully aligned."]
        };
    }

    function buildSummary(timeframe, signal) {
        if (signal === "BULLISH") {
            return `${timeframe} bias is bullish with usable confirmation.`;
        }
        if (signal === "BEARISH") {
            return `${timeframe} bias is bearish with usable confirmation.`;
        }
        if (signal === "WEAK_BULLISH") {
            return `${timeframe} bias is weak bullish and still needs confirmation.`;
        }
        if (signal === "WEAK_BEARISH") {
            return `${timeframe} bias is weak bearish and still needs confirmation.`;
        }
        return `${timeframe} bias is sideways or undecided.`;
    }

    global.OptionsTrendEngine = {
        evaluate: evaluate
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
