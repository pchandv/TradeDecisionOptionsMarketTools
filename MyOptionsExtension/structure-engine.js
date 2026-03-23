(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const TREND = {
        BULLISH: "BULLISH",
        BEARISH: "BEARISH",
        SIDEWAYS: "SIDEWAYS"
    };

    const STRUCTURE = {
        BULLISH: "HH_HL",
        BEARISH: "LH_LL",
        MIXED: "MIXED"
    };

    const ZONES = {
        SUPPORT: "SUPPORT",
        RESISTANCE: "RESISTANCE",
        MID: "MID"
    };

    const MOMENTUM = {
        STRONG_UP: "STRONG_UP",
        STRONG_DOWN: "STRONG_DOWN",
        NONE: "NONE"
    };

    const ACTIONS = {
        BUY_CE: "BUY_CE",
        BUY_PE: "BUY_PE",
        WAIT: "WAIT"
    };

    const DEFAULTS = {
        trendWindow: 5,
        rangeWindow: 20,
        swingLookback: 1,
        touchBufferPercent: 0.35,
        midZonePercentOfRange: 0.2,
        momentumWindow: 3,
        momentumBaselineWindow: 8,
        momentumSpikeRatio: 1.35,
        minimumTouchCount: 2
    };

    function analyze(args) {
        const currentPrice = Utils.toNumber(args && args.currentPrice);
        const supportResistance = args && args.supportResistance ? args.supportResistance : null;
        const series = buildSeries(args && args.priceHistory, currentPrice);
        const reasoning = [];

        if (!Number.isFinite(currentPrice) || series.length < 2) {
            return Utils.createEmptyStructureAnalysis();
        }

        const trend = detectTrend(series);
        const swings = detectSwings(series);
        const structure = detectStructure(swings);
        const range = detectRange(series);
        const zone = determineZone(currentPrice, range, supportResistance);
        const momentumResult = detectMomentum(series);
        const breakout = detectBreakout(series);
        const rejection = detectRejections(series, range);
        const tradeSuggestion = buildTradeSuggestion({
            trend: trend,
            structure: structure,
            zone: zone,
            breakout: breakout,
            rejection: rejection
        });

        reasoning.push(buildTrendReason(trend));
        reasoning.push(buildStructureReason(structure));
        reasoning.push(buildZoneReason(zone, currentPrice, range, supportResistance));

        if (momentumResult.momentum !== MOMENTUM.NONE) {
            reasoning.push(momentumResult.reason);
        }
        if (momentumResult.exhaustion) {
            reasoning.push("Momentum spike is showing signs of exhaustion.");
        }
        if (breakout.up) {
            reasoning.push("Price is pushing above the recent range high.");
        } else if (breakout.down) {
            reasoning.push("Price is slipping below the recent range low.");
        }
        if (rejection.resistanceConfirmed) {
            reasoning.push("Repeated failures near range high confirm resistance.");
        }
        if (rejection.supportConfirmed) {
            reasoning.push("Repeated bounces near range low confirm support.");
        }
        reasoning.push(tradeSuggestion.reason);

        return {
            trend: trend,
            structure: structure,
            range: range,
            zone: zone,
            momentum: momentumResult.momentum,
            exhaustion: momentumResult.exhaustion,
            tradeSuggestion: tradeSuggestion,
            reasoning: Utils.pickSummaryReasoning(reasoning, 7)
        };
    }

    function aggregateAnalyses(analyses) {
        const source = Array.isArray(analyses) ? analyses.filter(Boolean) : [];
        if (!source.length) {
            return Utils.createEmptyStructureAnalysis();
        }

        const trend = pickMostCommon(source.map((item) => item.trend), TREND.SIDEWAYS);
        const structure = pickMostCommon(source.map((item) => item.structure), STRUCTURE.MIXED);
        const zone = pickMostCommon(source.map((item) => item.zone), ZONES.MID);
        const momentum = pickMostCommon(source.map((item) => item.momentum), MOMENTUM.NONE);
        const action = pickMostCommon(source.map((item) => item.tradeSuggestion && item.tradeSuggestion.action), ACTIONS.WAIT);
        const reasons = [];

        source.forEach((item) => {
            reasons.push(...(item.reasoning || []).slice(0, 2));
        });

        return {
            trend: trend,
            structure: structure,
            range: {
                high: Utils.round(Utils.averageNumbers(source.map((item) => item.range && item.range.high)), 2),
                low: Utils.round(Utils.averageNumbers(source.map((item) => item.range && item.range.low)), 2),
                mid: Utils.round(Utils.averageNumbers(source.map((item) => item.range && item.range.mid)), 2)
            },
            zone: zone,
            momentum: momentum,
            exhaustion: source.some((item) => item.exhaustion),
            tradeSuggestion: {
                action: action,
                reason: buildAggregateSuggestionReason(action, trend, zone)
            },
            reasoning: Utils.pickSummaryReasoning(reasons, 7)
        };
    }

    function buildSeries(priceHistory, currentPrice) {
        const history = Array.isArray(priceHistory) ? priceHistory.filter(Number.isFinite) : [];
        if (!Number.isFinite(currentPrice)) {
            return history.slice();
        }
        if (!history.length || history[history.length - 1] !== currentPrice) {
            return history.concat([currentPrice]);
        }
        return history.slice();
    }

    function detectTrend(series) {
        const window = series.slice(-DEFAULTS.trendWindow);
        if (window.length < DEFAULTS.trendWindow) {
            return TREND.SIDEWAYS;
        }

        let increasing = true;
        let decreasing = true;
        for (let index = 1; index < window.length; index += 1) {
            if (!(window[index] > window[index - 1])) {
                increasing = false;
            }
            if (!(window[index] < window[index - 1])) {
                decreasing = false;
            }
        }

        if (increasing) {
            return TREND.BULLISH;
        }
        if (decreasing) {
            return TREND.BEARISH;
        }
        return TREND.SIDEWAYS;
    }

    function detectSwings(series) {
        const swingHighs = [];
        const swingLows = [];

        for (let index = DEFAULTS.swingLookback; index < series.length - DEFAULTS.swingLookback; index += 1) {
            const previous = series[index - 1];
            const current = series[index];
            const next = series[index + 1];

            if (current > previous && current > next) {
                swingHighs.push({ index: index, price: current });
            }
            if (current < previous && current < next) {
                swingLows.push({ index: index, price: current });
            }
        }

        return {
            swingHighs: swingHighs,
            swingLows: swingLows
        };
    }

    function detectStructure(swings) {
        const highs = swings.swingHighs || [];
        const lows = swings.swingLows || [];

        if (highs.length < 2 || lows.length < 2) {
            return STRUCTURE.MIXED;
        }

        const lastHigh = highs[highs.length - 1].price;
        const previousHigh = highs[highs.length - 2].price;
        const lastLow = lows[lows.length - 1].price;
        const previousLow = lows[lows.length - 2].price;

        if (lastHigh > previousHigh && lastLow > previousLow) {
            return STRUCTURE.BULLISH;
        }
        if (lastHigh < previousHigh && lastLow < previousLow) {
            return STRUCTURE.BEARISH;
        }
        return STRUCTURE.MIXED;
    }

    function detectRange(series) {
        const window = series.slice(-DEFAULTS.rangeWindow);
        const high = Math.max(...window);
        const low = Math.min(...window);
        const mid = (high + low) / 2;

        return {
            high: Utils.round(high, 2),
            low: Utils.round(low, 2),
            mid: Utils.round(mid, 2)
        };
    }

    function determineZone(currentPrice, range, supportResistance) {
        const resistance = supportResistance && Number.isFinite(supportResistance.nearestResistance)
            ? supportResistance.nearestResistance
            : range.high;
        const support = supportResistance && Number.isFinite(supportResistance.nearestSupport)
            ? supportResistance.nearestSupport
            : range.low;

        if (isNearLevel(currentPrice, resistance, DEFAULTS.touchBufferPercent)) {
            return ZONES.RESISTANCE;
        }
        if (isNearLevel(currentPrice, support, DEFAULTS.touchBufferPercent)) {
            return ZONES.SUPPORT;
        }

        const band = Math.abs(range.high - range.low) * DEFAULTS.midZonePercentOfRange;
        if (Number.isFinite(range.mid) && Math.abs(currentPrice - range.mid) <= band) {
            return ZONES.MID;
        }

        return ZONES.MID;
    }

    function detectMomentum(series) {
        const recent = series.slice(-(DEFAULTS.momentumWindow + 1));
        if (recent.length < DEFAULTS.momentumWindow + 1) {
            return {
                momentum: MOMENTUM.NONE,
                exhaustion: false,
                reason: "Momentum is not clear yet."
            };
        }

        const diffs = [];
        for (let index = 1; index < recent.length; index += 1) {
            diffs.push(recent[index] - recent[index - 1]);
        }

        const baselineSeries = series.slice(-(DEFAULTS.momentumBaselineWindow + 1));
        const baselineDiffs = [];
        for (let index = 1; index < baselineSeries.length; index += 1) {
            baselineDiffs.push(Math.abs(baselineSeries[index] - baselineSeries[index - 1]));
        }

        const averageRecent = Utils.averageNumbers(diffs.map(Math.abs)) || 0;
        const averageBaseline = Utils.averageNumbers(baselineDiffs) || 0;
        const upward = diffs.every((diff) => diff > 0);
        const downward = diffs.every((diff) => diff < 0);
        const spike = averageBaseline > 0 && averageRecent >= averageBaseline * DEFAULTS.momentumSpikeRatio;
        const exhaustion = detectExhaustion(series, averageBaseline);

        if (upward && spike) {
            return {
                momentum: MOMENTUM.STRONG_UP,
                exhaustion: exhaustion,
                reason: "Recent prices show a strong upward momentum burst."
            };
        }

        if (downward && spike) {
            return {
                momentum: MOMENTUM.STRONG_DOWN,
                exhaustion: exhaustion,
                reason: "Recent prices show a strong downward momentum burst."
            };
        }

        return {
            momentum: MOMENTUM.NONE,
            exhaustion: exhaustion,
            reason: "Momentum is not clear yet."
        };
    }

    function detectExhaustion(series, baselineMove) {
        const recent = series.slice(-4);
        if (recent.length < 4) {
            return false;
        }

        const diff1 = recent[1] - recent[0];
        const diff2 = recent[2] - recent[1];
        const diff3 = recent[3] - recent[2];
        const threshold = Math.max(baselineMove || 0, Math.abs(diff1), Math.abs(diff2)) * 0.45;

        if (diff1 > 0 && diff2 > 0 && diff3 < 0 && Math.abs(diff3) >= threshold) {
            return true;
        }
        if (diff1 < 0 && diff2 < 0 && diff3 > 0 && Math.abs(diff3) >= threshold) {
            return true;
        }
        return false;
    }

    function detectBreakout(series) {
        const reference = series.length > 1 ? series.slice(-Math.min(DEFAULTS.rangeWindow + 1, series.length), -1) : [];
        if (!reference.length) {
            return { up: false, down: false };
        }

        const currentPrice = series[series.length - 1];
        const referenceHigh = Math.max(...reference);
        const referenceLow = Math.min(...reference);

        return {
            up: currentPrice > referenceHigh,
            down: currentPrice < referenceLow
        };
    }

    function detectRejections(series, range) {
        const window = series.slice(-Math.min(12, series.length));
        let resistanceTouches = 0;
        let supportTouches = 0;

        for (let index = 0; index < window.length; index += 1) {
            const price = window[index];
            const next = window[index + 1];

            if (isNearLevel(price, range.high, DEFAULTS.touchBufferPercent) && Number.isFinite(next) && next < price) {
                resistanceTouches += 1;
            }
            if (isNearLevel(price, range.low, DEFAULTS.touchBufferPercent) && Number.isFinite(next) && next > price) {
                supportTouches += 1;
            }
        }

        return {
            resistanceConfirmed: resistanceTouches >= DEFAULTS.minimumTouchCount,
            supportConfirmed: supportTouches >= DEFAULTS.minimumTouchCount
        };
    }

    function buildTradeSuggestion(args) {
        if (args.breakout.up) {
            return {
                action: ACTIONS.BUY_CE,
                reason: "Breakout above range high supports a strong CE continuation setup."
            };
        }

        if (args.breakout.down) {
            return {
                action: ACTIONS.BUY_PE,
                reason: "Breakdown below range low supports a strong PE continuation setup."
            };
        }

        if (args.zone === ZONES.MID) {
            return {
                action: ACTIONS.WAIT,
                reason: "Price is sitting in the mid zone, so this is a no-trade area."
            };
        }

        if (args.structure === STRUCTURE.BEARISH && args.zone === ZONES.RESISTANCE) {
            return {
                action: ACTIONS.BUY_PE,
                reason: "Bearish structure near resistance favors PE entries."
            };
        }

        if (args.structure === STRUCTURE.BULLISH && args.zone === ZONES.SUPPORT) {
            return {
                action: ACTIONS.BUY_CE,
                reason: "Bullish structure near support favors CE entries."
            };
        }

        if (args.rejection.resistanceConfirmed && args.zone === ZONES.RESISTANCE) {
            return {
                action: ACTIONS.BUY_PE,
                reason: "Repeated rejection near range high keeps bearish pressure active."
            };
        }

        if (args.rejection.supportConfirmed && args.zone === ZONES.SUPPORT) {
            return {
                action: ACTIONS.BUY_CE,
                reason: "Repeated support bounces keep bullish pressure active."
            };
        }

        return {
            action: ACTIONS.WAIT,
            reason: "Structure and location are not aligned enough for a clean trade."
        };
    }

    function buildTrendReason(trend) {
        if (trend === TREND.BULLISH) {
            return "Last five prices are stepping higher, so short-term trend is bullish.";
        }
        if (trend === TREND.BEARISH) {
            return "Last five prices are stepping lower, so short-term trend is bearish.";
        }
        return "Recent prices are mixed, so trend is sideways.";
    }

    function buildStructureReason(structure) {
        if (structure === STRUCTURE.BULLISH) {
            return "Swing structure shows higher highs and higher lows.";
        }
        if (structure === STRUCTURE.BEARISH) {
            return "Swing structure shows lower highs and lower lows.";
        }
        return "Swing structure is mixed and lacks clean directional order.";
    }

    function buildZoneReason(zone, currentPrice, range, supportResistance) {
        if (zone === ZONES.SUPPORT) {
            const support = supportResistance && Number.isFinite(supportResistance.nearestSupport)
                ? supportResistance.nearestSupport
                : range.low;
            return `Price is trading near support around ${Utils.formatNumber(support, 2)}.`;
        }
        if (zone === ZONES.RESISTANCE) {
            const resistance = supportResistance && Number.isFinite(supportResistance.nearestResistance)
                ? supportResistance.nearestResistance
                : range.high;
            return `Price is trading near resistance around ${Utils.formatNumber(resistance, 2)}.`;
        }
        return `Price is near the middle of the active range around ${Utils.formatNumber(range.mid, 2)}.`;
    }

    function buildAggregateSuggestionReason(action, trend, zone) {
        if (action === ACTIONS.BUY_CE) {
            return `Aggregate structure leans ${String(trend || TREND.BULLISH).toLowerCase()} and supports CE ideas.`;
        }
        if (action === ACTIONS.BUY_PE) {
            return `Aggregate structure leans ${String(trend || TREND.BEARISH).toLowerCase()} and supports PE ideas.`;
        }
        return `Aggregate structure is best treated as wait while price stays around the ${String(zone || ZONES.MID).toLowerCase()} zone.`;
    }

    function pickMostCommon(items, fallback) {
        const counts = {};
        let bestValue = fallback;
        let bestCount = 0;

        (items || []).filter(Boolean).forEach((item) => {
            counts[item] = (counts[item] || 0) + 1;
            if (counts[item] > bestCount) {
                bestValue = item;
                bestCount = counts[item];
            }
        });

        return bestCount ? bestValue : fallback;
    }

    function isNearLevel(price, level, bufferPercent) {
        if (!Number.isFinite(price) || !Number.isFinite(level) || !Number.isFinite(bufferPercent) || price === 0) {
            return false;
        }
        return Math.abs(((price - level) / price) * 100) <= bufferPercent;
    }

    global.OptionsStructureEngine = {
        ACTIONS: ACTIONS,
        DEFAULTS: DEFAULTS,
        MOMENTUM: MOMENTUM,
        STRUCTURE: STRUCTURE,
        TREND: TREND,
        ZONES: ZONES,
        aggregateAnalyses: aggregateAnalyses,
        analyze: analyze,
        detectBreakout: detectBreakout,
        detectMomentum: detectMomentum,
        detectRange: detectRange,
        detectStructure: detectStructure,
        detectSwings: detectSwings,
        detectTrend: detectTrend
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
