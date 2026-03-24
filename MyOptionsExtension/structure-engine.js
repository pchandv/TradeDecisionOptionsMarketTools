(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const TREND = {
        BULLISH: "BULLISH",
        BEARISH: "BEARISH",
        SIDEWAYS: "SIDEWAYS"
    };

    const STRUCTURE = {
        HH_HL: "HH_HL",
        LH_LL: "LH_LL",
        MIXED: "MIXED",
        SIDEWAYS: "SIDEWAYS"
    };

    const ZONES = {
        SUPPORT: "SUPPORT",
        RESISTANCE: "RESISTANCE",
        MID: "MID",
        BREAKOUT: "BREAKOUT",
        BREAKDOWN: "BREAKDOWN"
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

    function analyze(args) {
        const currentPrice = Utils.toNumber(args && args.currentPrice);
        const supportResistance = args && args.supportResistance ? args.supportResistance : Utils.createEmptySupportResistance();
        const series = buildSeries(args && args.priceHistory, currentPrice);
        const reasoning = [];

        if (!Number.isFinite(currentPrice) || series.length < 3) {
            return Utils.createEmptyStructureAnalysis();
        }

        const swings = detectSwings(series);
        const structure = detectStructure(swings, series);
        const trend = structure === STRUCTURE.HH_HL
            ? TREND.BULLISH
            : structure === STRUCTURE.LH_LL
                ? TREND.BEARISH
                : TREND.SIDEWAYS;
        const range = detectRange(series);
        const breakout = detectBreakout(series, range);
        const zone = resolveZone(currentPrice, range, supportResistance, breakout);
        const momentumResult = detectMomentum(series);
        const rejection = detectRejection(series, supportResistance, range);
        const exhaustion = detectExhaustion(series, momentumResult);
        const rangePosition = resolveRangePosition(currentPrice, range);
        const tradeSuggestion = buildTradeSuggestion({
            trend: trend,
            structure: structure,
            zone: zone,
            breakout: breakout,
            momentum: momentumResult.momentum,
            rejection: rejection
        });

        reasoning.push(buildStructureReason(structure));
        reasoning.push(buildZoneReason(zone, supportResistance, range));
        if (momentumResult.reason) {
            reasoning.push(momentumResult.reason);
        }
        if (exhaustion) {
            reasoning.push("Momentum shows signs of exhaustion.");
        }
        if (rejection.atSupport) {
            reasoning.push("Support rejection detected.");
        }
        if (rejection.atResistance) {
            reasoning.push("Resistance rejection detected.");
        }
        reasoning.push(tradeSuggestion.reason);

        return {
            trend: trend,
            structure: structure,
            range: range,
            zone: zone,
            momentum: momentumResult.momentum,
            exhaustion: exhaustion,
            rejection: rejection,
            rangePosition: rangePosition,
            tradeSuggestion: tradeSuggestion,
            reasoning: Utils.pickSummaryReasoning(reasoning, 8)
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
        const reasoning = [];

        source.forEach((item) => {
            reasoning.push(...(item.reasoning || []).slice(0, 2));
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
            exhaustion: source.some((item) => item.exhaustion === true),
            rejection: {
                atSupport: source.some((item) => item.rejection && item.rejection.atSupport),
                atResistance: source.some((item) => item.rejection && item.rejection.atResistance)
            },
            rangePosition: Utils.averageNumbers(source.map((item) => item.rangePosition)),
            tradeSuggestion: {
                action: action,
                reason: buildAggregateSuggestionReason(action, trend, zone)
            },
            reasoning: Utils.pickSummaryReasoning(reasoning, 8)
        };
    }

    function buildSeries(history, currentPrice) {
        const source = Array.isArray(history) ? history.filter(Number.isFinite).slice(-220) : [];
        if (!Number.isFinite(currentPrice)) {
            return source;
        }
        if (!source.length || source[source.length - 1] !== currentPrice) {
            return source.concat([currentPrice]);
        }
        return source;
    }

    function detectSwings(series) {
        const highs = [];
        const lows = [];
        for (let index = 1; index < series.length - 1; index += 1) {
            const left = series[index - 1];
            const current = series[index];
            const right = series[index + 1];
            if (current >= left && current >= right) {
                highs.push({ index: index, price: current });
            }
            if (current <= left && current <= right) {
                lows.push({ index: index, price: current });
            }
        }
        return {
            highs: highs,
            lows: lows
        };
    }

    function detectStructure(swings, series) {
        const highs = swings.highs || [];
        const lows = swings.lows || [];
        if (highs.length < 2 || lows.length < 2) {
            return isSeriesSideways(series) ? STRUCTURE.SIDEWAYS : STRUCTURE.MIXED;
        }

        const lastHigh = highs[highs.length - 1].price;
        const previousHigh = highs[highs.length - 2].price;
        const lastLow = lows[lows.length - 1].price;
        const previousLow = lows[lows.length - 2].price;

        if (lastHigh > previousHigh && lastLow > previousLow) {
            return STRUCTURE.HH_HL;
        }
        if (lastHigh < previousHigh && lastLow < previousLow) {
            return STRUCTURE.LH_LL;
        }
        if (isSeriesSideways(series)) {
            return STRUCTURE.SIDEWAYS;
        }
        return STRUCTURE.MIXED;
    }

    function detectRange(series) {
        const window = series.slice(-Math.min(60, series.length));
        const high = Math.max(...window);
        const low = Math.min(...window);
        return {
            high: Utils.round(high, 2),
            low: Utils.round(low, 2),
            mid: Utils.round((high + low) / 2, 2)
        };
    }

    function detectBreakout(series, range) {
        const reference = series.slice(-Math.min(series.length, 25), -1);
        if (!reference.length) {
            return { up: false, down: false };
        }
        const current = series[series.length - 1];
        const referenceHigh = Math.max(...reference);
        const referenceLow = Math.min(...reference);
        const breakoutUp = current > Math.max(referenceHigh, range.high);
        const breakoutDown = current < Math.min(referenceLow, range.low);
        return {
            up: breakoutUp,
            down: breakoutDown
        };
    }

    function resolveZone(currentPrice, range, levels, breakout) {
        const support = firstFinite(levels.nearestSupport, range.low);
        const resistance = firstFinite(levels.nearestResistance, range.high);
        if (breakout.up) {
            return ZONES.BREAKOUT;
        }
        if (breakout.down) {
            return ZONES.BREAKDOWN;
        }
        if (isNear(currentPrice, support, 0.3)) {
            return ZONES.SUPPORT;
        }
        if (isNear(currentPrice, resistance, 0.3)) {
            return ZONES.RESISTANCE;
        }
        return ZONES.MID;
    }

    function detectMomentum(series) {
        const recent = series.slice(-6);
        if (recent.length < 4) {
            return {
                momentum: MOMENTUM.NONE,
                reason: "Momentum is not clear yet."
            };
        }

        const changes = [];
        for (let index = 1; index < recent.length; index += 1) {
            changes.push(recent[index] - recent[index - 1]);
        }
        const allUp = changes.every((change) => change > 0);
        const allDown = changes.every((change) => change < 0);
        const magnitude = Utils.averageNumbers(changes.map((change) => Math.abs(change))) || 0;
        const baselineSeries = series.slice(-16);
        const baselineChanges = [];
        for (let index = 1; index < baselineSeries.length; index += 1) {
            baselineChanges.push(Math.abs(baselineSeries[index] - baselineSeries[index - 1]));
        }
        const baseline = Utils.averageNumbers(baselineChanges) || 0;
        const isSpike = baseline > 0 ? magnitude >= baseline * 1.35 : magnitude > 0;

        if (allUp && isSpike) {
            return {
                momentum: MOMENTUM.STRONG_UP,
                reason: "Momentum spike supports upside continuation."
            };
        }
        if (allDown && isSpike) {
            return {
                momentum: MOMENTUM.STRONG_DOWN,
                reason: "Momentum spike supports downside continuation."
            };
        }
        return {
            momentum: MOMENTUM.NONE,
            reason: "Momentum is balanced or fading."
        };
    }

    function detectExhaustion(series, momentumResult) {
        if (!momentumResult || momentumResult.momentum === MOMENTUM.NONE || series.length < 5) {
            return false;
        }

        const last = series[series.length - 1];
        const previous = series[series.length - 2];
        const beforePrevious = series[series.length - 3];
        const lastMove = last - previous;
        const priorMove = previous - beforePrevious;

        if (momentumResult.momentum === MOMENTUM.STRONG_UP && priorMove > 0 && lastMove < 0) {
            return true;
        }
        if (momentumResult.momentum === MOMENTUM.STRONG_DOWN && priorMove < 0 && lastMove > 0) {
            return true;
        }
        return false;
    }

    function detectRejection(series, levels, range) {
        const support = firstFinite(levels.nearestSupport, range.low);
        const resistance = firstFinite(levels.nearestResistance, range.high);
        const recent = series.slice(-6);
        let supportRejects = 0;
        let resistanceRejects = 0;
        for (let index = 0; index < recent.length - 1; index += 1) {
            const current = recent[index];
            const next = recent[index + 1];
            if (isNear(current, support, 0.35) && next > current) {
                supportRejects += 1;
            }
            if (isNear(current, resistance, 0.35) && next < current) {
                resistanceRejects += 1;
            }
        }
        return {
            atSupport: supportRejects >= 2,
            atResistance: resistanceRejects >= 2
        };
    }

    function resolveRangePosition(current, range) {
        if (!Number.isFinite(current) || !range || !Number.isFinite(range.high) || !Number.isFinite(range.low) || range.high <= range.low) {
            return null;
        }
        return Utils.round((current - range.low) / (range.high - range.low), 4);
    }

    function buildTradeSuggestion(args) {
        if (args.zone === ZONES.BREAKOUT || (args.trend === TREND.BULLISH && args.momentum === MOMENTUM.STRONG_UP)) {
            return {
                action: ACTIONS.BUY_CE,
                reason: "Structure and momentum support CE continuation."
            };
        }
        if (args.zone === ZONES.BREAKDOWN || (args.trend === TREND.BEARISH && args.momentum === MOMENTUM.STRONG_DOWN)) {
            return {
                action: ACTIONS.BUY_PE,
                reason: "Structure and momentum support PE continuation."
            };
        }
        if (args.zone === ZONES.SUPPORT && args.rejection.atSupport && args.structure !== STRUCTURE.LH_LL) {
            return {
                action: ACTIONS.BUY_CE,
                reason: "Support rejection with no bearish structure failure favors CE candidate."
            };
        }
        if (args.zone === ZONES.RESISTANCE && args.rejection.atResistance && args.structure !== STRUCTURE.HH_HL) {
            return {
                action: ACTIONS.BUY_PE,
                reason: "Resistance rejection with no bullish structure failure favors PE candidate."
            };
        }
        return {
            action: ACTIONS.WAIT,
            reason: "Structure is mixed or in mid-range, so wait for confirmation."
        };
    }

    function buildStructureReason(structure) {
        if (structure === STRUCTURE.HH_HL) {
            return "Structure shows higher highs and higher lows.";
        }
        if (structure === STRUCTURE.LH_LL) {
            return "Structure shows lower highs and lower lows.";
        }
        if (structure === STRUCTURE.SIDEWAYS) {
            return "Structure remains sideways.";
        }
        return "Structure is mixed and needs confirmation.";
    }

    function buildZoneReason(zone, levels, range) {
        const support = firstFinite(levels.nearestSupport, range.low);
        const resistance = firstFinite(levels.nearestResistance, range.high);
        if (zone === ZONES.SUPPORT) {
            return `Price is near support around ${Utils.formatNumber(support, 2)}.`;
        }
        if (zone === ZONES.RESISTANCE) {
            return `Price is near resistance around ${Utils.formatNumber(resistance, 2)}.`;
        }
        if (zone === ZONES.BREAKOUT) {
            return "Price is breaking above recent range highs.";
        }
        if (zone === ZONES.BREAKDOWN) {
            return "Price is breaking below recent range lows.";
        }
        return `Price is near range mid around ${Utils.formatNumber(range.mid, 2)}.`;
    }

    function buildAggregateSuggestionReason(action, trend, zone) {
        if (action === ACTIONS.BUY_CE) {
            return `Aggregate structure leans ${String(trend || TREND.BULLISH).toLowerCase()} and supports CE setups.`;
        }
        if (action === ACTIONS.BUY_PE) {
            return `Aggregate structure leans ${String(trend || TREND.BEARISH).toLowerCase()} and supports PE setups.`;
        }
        return `Aggregate structure is best treated as wait while zone remains ${String(zone || ZONES.MID).toLowerCase()}.`;
    }

    function isNear(price, level, tolerancePercent) {
        if (!Number.isFinite(price) || !Number.isFinite(level) || !Number.isFinite(tolerancePercent) || price === 0) {
            return false;
        }
        return Math.abs(((price - level) / price) * 100) <= tolerancePercent;
    }

    function isSeriesSideways(series) {
        if (!Array.isArray(series) || series.length < 6) {
            return true;
        }
        const window = series.slice(-10);
        const high = Math.max(...window);
        const low = Math.min(...window);
        const spreadPct = high > 0 ? ((high - low) / high) * 100 : 0;
        return spreadPct <= 0.45;
    }

    function firstFinite() {
        for (let index = 0; index < arguments.length; index += 1) {
            if (Number.isFinite(arguments[index])) {
                return arguments[index];
            }
        }
        return null;
    }

    function pickMostCommon(items, fallback) {
        const counts = {};
        let best = fallback;
        let bestCount = 0;
        (items || []).filter(Boolean).forEach((item) => {
            counts[item] = (counts[item] || 0) + 1;
            if (counts[item] > bestCount) {
                best = item;
                bestCount = counts[item];
            }
        });
        return best;
    }

    global.OptionsStructureEngine = {
        ACTIONS: ACTIONS,
        MOMENTUM: MOMENTUM,
        STRUCTURE: STRUCTURE,
        TREND: TREND,
        ZONES: ZONES,
        aggregateAnalyses: aggregateAnalyses,
        analyze: analyze,
        detectMomentum: detectMomentum,
        detectRange: detectRange,
        detectStructure: detectStructure,
        detectSwings: detectSwings
    };
})(typeof globalThis !== "undefined" ? globalThis : this);

