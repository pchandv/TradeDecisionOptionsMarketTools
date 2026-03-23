(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;
    const Context = global.OptionsMarketContext;

    function evaluate(args, settings) {
        const marketContext = args.marketContext;
        const overallSignal = args.overallSignal || Utils.createEmptyOverallSignal();
        const trendAnalysis = args.trendAnalysis || Utils.createEmptyTrendAnalysis();
        const gapPrediction = args.gapPrediction || Utils.createEmptyGapPrediction();
        const values = marketContext.aggregateValues || Utils.createEmptyValues();
        const levels = resolveLevels(marketContext, values);
        const reasoning = [];
        const warnings = [];
        const plan = Utils.createEmptyTradePlan();
        const bullishAlignment = isBullishSetup(overallSignal, trendAnalysis);
        const bearishAlignment = isBearishSetup(overallSignal, trendAnalysis);
        const rangePosition = Context.positionWithinRange(values.spotPrice, levels.support, levels.resistance);

        if (!bullishAlignment && !bearishAlignment) {
            plan.status = "NO_TRADE";
            plan.reasoning = ["Directional engine and trend engine are not aligned enough for a trade."];
            plan.warnings = ["No trade", "Mixed bias"];
            return { tradePlan: plan };
        }

        if (Number.isFinite(values.vix) && values.vix >= settings.highVixThreshold) {
            warnings.push("Volatility is high, so setups need extra confirmation.");
        }

        if (rangePosition != null && rangePosition > 0.35 && rangePosition < 0.65) {
            warnings.push("Price is sitting in the middle of the range.");
        }

        if (overallSignal.confidence < settings.confidenceThreshold && overallSignal.confidence < 70) {
            warnings.push("Directional confidence is not strong yet.");
        }

        if (!Number.isFinite(levels.support) || !Number.isFinite(levels.resistance)) {
            warnings.push("Key levels are incomplete, so structure-based entries are weaker.");
        } else if (levels.supportStrength === "WEAK" || levels.resistanceStrength === "WEAK") {
            warnings.push("Key levels are available but still weakly confirmed.");
        }

        if (bullishAlignment) {
            buildBullishPlan(plan, values, levels, trendAnalysis, gapPrediction, settings, reasoning, warnings);
        } else if (bearishAlignment) {
            buildBearishPlan(plan, values, levels, trendAnalysis, gapPrediction, settings, reasoning, warnings);
        }

        if (!Number.isFinite(plan.entryZone.min) && !Number.isFinite(plan.entryZone.max)) {
            plan.status = plan.status === "NO_TRADE" ? plan.status : "WAIT_CONFIRMATION";
            warnings.push("Reliable entry levels are not available.");
        }

        const riskRewardValue = parseRiskReward(plan.riskReward);
        if (riskRewardValue != null && riskRewardValue < settings.tradeMinRiskReward) {
            warnings.push(`Risk-reward is below ${settings.tradeMinRiskReward}.`);
            if (plan.status === "READY" || plan.status === "AGGRESSIVE_READY") {
                plan.status = "WAIT_CONFIRMATION";
            }
            if (plan.setupQuality === "HIGH") {
                plan.setupQuality = "MEDIUM";
            }
        }

        if (warnings.some((item) => /middle of the range|confidence/i.test(item))) {
            if (plan.status === "READY" || plan.status === "AGGRESSIVE_READY") {
                plan.status = "WAIT_CONFIRMATION";
            }
            if (plan.setupQuality === "HIGH") {
                plan.setupQuality = "MEDIUM";
            }
        }

        if (warnings.some((item) => /Mixed bias|No trade/i.test(item))) {
            plan.status = "NO_TRADE";
            plan.direction = "NONE";
        }

        plan.reasoning = Utils.pickSummaryReasoning(reasoning.length ? reasoning : ["Setup is still forming."], 6);
        plan.warnings = Utils.pickSummaryReasoning(warnings.length ? warnings : ["Confirm with chart and risk management."], 5);
        return {
            tradePlan: plan
        };
    }

    function buildBullishPlan(plan, values, levels, trendAnalysis, gapPrediction, settings, reasoning, warnings) {
        plan.direction = "CE";
        plan.invalidation = "Bullish view fails if support breaks or breakout fails quickly.";
        const breakoutBuffer = percentOf(levels.resistance || values.spotPrice, settings.tradeBreakoutBufferPercent);
        const pullbackBuffer = percentOf(levels.support || values.spotPrice, settings.tradePullbackBufferPercent);

        if (levels.breakout || (Number.isFinite(values.spotPrice) && Number.isFinite(levels.resistance) && values.spotPrice >= levels.resistance - breakoutBuffer)) {
            plan.entryType = "BREAKOUT";
            plan.entryZone = {
                min: Utils.round(levels.resistance, 2),
                max: Utils.round(levels.resistance + breakoutBuffer, 2),
                note: "Wait for price to hold above resistance before CE entry."
            };
            plan.stopLoss = buildStopLoss(values, levels, "bullish", settings, levels.support || levels.resistance);
            reasoning.push("Trade plan prefers a bullish breakout above derived resistance.");
        } else if (Number.isFinite(values.spotPrice) && Number.isFinite(levels.support) && values.spotPrice <= levels.support + pullbackBuffer) {
            plan.entryType = "PULLBACK";
            plan.entryZone = {
                min: Utils.round(levels.support, 2),
                max: Utils.round(levels.support + pullbackBuffer, 2),
                note: "Look for a support hold before CE entry."
            };
            plan.stopLoss = buildStopLoss(values, levels, "bullish", settings, levels.support);
            reasoning.push("Trade plan prefers a CE pullback near support.");
        } else {
            plan.entryType = "MOMENTUM";
            plan.entryZone = {
                min: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice, 2) : null,
                max: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice + percentOf(values.spotPrice, settings.tradeBreakoutBufferPercent), 2) : null,
                note: "Wait for momentum confirmation before entry."
            };
            plan.stopLoss = buildStopLoss(values, levels, "bullish", settings, levels.support || values.spotPrice);
            reasoning.push("Bullish bias exists, but the entry still needs price confirmation.");
        }

        plan.targets = buildTargets(values, levels, plan.entryZone, plan.stopLoss, "bullish");
        plan.riskReward = buildRiskReward(plan.entryZone, plan.stopLoss, plan.targets[0]);
        plan.setupQuality = resolveSetupQuality(trendAnalysis, "bullish", gapPrediction, warnings, levels);
        plan.status = resolveTradeStatus(plan.setupQuality, warnings, trendAnalysis);
    }

    function buildBearishPlan(plan, values, levels, trendAnalysis, gapPrediction, settings, reasoning, warnings) {
        plan.direction = "PE";
        plan.invalidation = "Bearish view fails if resistance breaks or breakdown fails quickly.";
        const breakoutBuffer = percentOf(levels.support || values.spotPrice, settings.tradeBreakoutBufferPercent);
        const pullbackBuffer = percentOf(levels.resistance || values.spotPrice, settings.tradePullbackBufferPercent);

        if (levels.breakdown || (Number.isFinite(values.spotPrice) && Number.isFinite(levels.support) && values.spotPrice <= levels.support + breakoutBuffer)) {
            plan.entryType = "BREAKDOWN";
            plan.entryZone = {
                min: Utils.round(levels.support - breakoutBuffer, 2),
                max: Utils.round(levels.support, 2),
                note: "Wait for price to stay below support before PE entry."
            };
            plan.stopLoss = buildStopLoss(values, levels, "bearish", settings, levels.resistance || levels.support);
            reasoning.push("Trade plan prefers a PE breakdown below support.");
        } else if (Number.isFinite(values.spotPrice) && Number.isFinite(levels.resistance) && values.spotPrice >= levels.resistance - pullbackBuffer) {
            plan.entryType = "PULLBACK";
            plan.entryZone = {
                min: Utils.round(levels.resistance - pullbackBuffer, 2),
                max: Utils.round(levels.resistance, 2),
                note: "Look for resistance rejection before PE entry."
            };
            plan.stopLoss = buildStopLoss(values, levels, "bearish", settings, levels.resistance);
            reasoning.push("Trade plan prefers a PE pullback from resistance.");
        } else {
            plan.entryType = "MEAN_REVERSION";
            plan.entryZone = {
                min: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice - percentOf(values.spotPrice, settings.tradeBreakoutBufferPercent), 2) : null,
                max: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice, 2) : null,
                note: "Wait for bearish confirmation before entry."
            };
            plan.stopLoss = buildStopLoss(values, levels, "bearish", settings, levels.resistance || values.spotPrice);
            reasoning.push("Bearish bias exists, but price still needs confirmation.");
        }

        plan.targets = buildTargets(values, levels, plan.entryZone, plan.stopLoss, "bearish");
        plan.riskReward = buildRiskReward(plan.entryZone, plan.stopLoss, plan.targets[0]);
        plan.setupQuality = resolveSetupQuality(trendAnalysis, "bearish", gapPrediction, warnings, levels);
        plan.status = resolveTradeStatus(plan.setupQuality, warnings, trendAnalysis);
    }

    function buildStopLoss(values, levels, direction, settings, anchorLevel) {
        const reference = Number.isFinite(anchorLevel)
            ? anchorLevel
            : direction === "bullish"
                ? pickFirstFinite(levels.support, values.spotPrice)
                : pickFirstFinite(levels.resistance, values.spotPrice);
        const fallbackOffset = percentOf(reference, settings.tradeDefaultStopPercent);
        if (!Number.isFinite(reference)) {
            return {
                value: null,
                type: "NONE",
                note: "No structural stop loss level is visible."
            };
        }

        if (direction === "bullish") {
            return {
                value: Utils.round(reference - fallbackOffset, 2),
                type: "STRUCTURE",
                note: "Stop loss sits below the nearest support."
            };
        }

        return {
            value: Utils.round(reference + fallbackOffset, 2),
            type: "STRUCTURE",
            note: "Stop loss sits above the nearest resistance."
        };
    }

    function buildTargets(values, levels, entryZone, stopLoss, direction) {
        const referenceEntry = Number.isFinite(entryZone.max) ? entryZone.max : entryZone.min;
        if (!Number.isFinite(referenceEntry) || !Number.isFinite(stopLoss.value)) {
            return [
                { label: "T1", value: null, note: "No target available." },
                { label: "T2", value: null, note: "No target available." }
            ];
        }

        const risk = Math.abs(referenceEntry - stopLoss.value);
        if (!risk) {
            return [
                { label: "T1", value: null, note: "No target available." },
                { label: "T2", value: null, note: "No target available." }
            ];
        }

        if (direction === "bullish") {
            const t1 = firstHigherLevel(referenceEntry, [
                levels.resistance,
                levels.secondaryResistance,
                values.maxPain
            ]) || (referenceEntry + risk);
            const t2 = firstHigherLevel(t1, [
                levels.secondaryResistance,
                values.maxPain
            ]) || (referenceEntry + (risk * 2));
            return [
                { label: "T1", value: Utils.round(t1, 2), note: "Conservative bullish objective." },
                { label: "T2", value: Utils.round(t2, 2), note: "Extended bullish objective." }
            ];
        }

        const t1 = firstLowerLevel(referenceEntry, [
            levels.support,
            levels.secondarySupport,
            values.maxPain
        ]) || (referenceEntry - risk);
        const t2 = firstLowerLevel(t1, [
            levels.secondarySupport,
            values.maxPain
        ]) || (referenceEntry - (risk * 2));
        return [
            { label: "T1", value: Utils.round(t1, 2), note: "Conservative bearish objective." },
            { label: "T2", value: Utils.round(t2, 2), note: "Extended bearish objective." }
        ];
    }

    function buildRiskReward(entryZone, stopLoss, target) {
        const entry = Number.isFinite(entryZone.max) ? entryZone.max : entryZone.min;
        if (!Number.isFinite(entry) || !Number.isFinite(stopLoss.value) || !target || !Number.isFinite(target.value)) {
            return "N/A";
        }

        const risk = Math.abs(entry - stopLoss.value);
        const reward = Math.abs(target.value - entry);
        if (!risk) {
            return "N/A";
        }

        return `1:${Utils.round(reward / risk, 2)}`;
    }

    function resolveSetupQuality(trendAnalysis, direction, gapPrediction, warnings, levels) {
        const aligned = direction === "bullish"
            ? trendAnalysis.alignment.status === "ALIGNED_BULLISH"
            : trendAnalysis.alignment.status === "ALIGNED_BEARISH";
        const gapSupport = gapPrediction.primary === (direction === "bullish" ? "GAP_UP" : "GAP_DOWN");
        const structuralSupport = direction === "bullish"
            ? levels.supportStrength === "STRONG" || levels.breakout
            : levels.resistanceStrength === "STRONG" || levels.breakdown;

        if (aligned && gapSupport && structuralSupport && !warnings.length) {
            return "HIGH";
        }
        if (aligned || gapSupport || structuralSupport) {
            return "MEDIUM";
        }
        return "LOW";
    }

    function resolveTradeStatus(setupQuality, warnings, trendAnalysis) {
        if (setupQuality === "LOW") {
            return "WAIT_CONFIRMATION";
        }
        if (warnings.some((item) => /Volatility|range|confidence/i.test(item))) {
            return "WAIT_CONFIRMATION";
        }
        if (setupQuality === "HIGH"
            && !warnings.length
            && (trendAnalysis.alignment.status === "ALIGNED_BULLISH" || trendAnalysis.alignment.status === "ALIGNED_BEARISH")) {
            return "AGGRESSIVE_READY";
        }
        return "READY";
    }

    function isBullishSetup(overallSignal, trendAnalysis) {
        return Context.isBullishSignal(overallSignal.signal)
            && Context.isBullishSignal(trendAnalysis.bias15m.signal)
            && !Context.isBearishSignal(trendAnalysis.bias1h.signal);
    }

    function isBearishSetup(overallSignal, trendAnalysis) {
        return Context.isBearishSignal(overallSignal.signal)
            && Context.isBearishSignal(trendAnalysis.bias15m.signal)
            && !Context.isBullishSignal(trendAnalysis.bias1h.signal);
    }

    function parseRiskReward(text) {
        const match = String(text || "").match(/1:(\d+(?:\.\d+)?)/);
        return match ? Utils.toNumber(match[1]) : null;
    }

    function percentOf(value, percent) {
        if (!Number.isFinite(value) || !Number.isFinite(percent)) {
            return 0;
        }
        return value * (percent / 100);
    }

    function resolveLevels(marketContext, values) {
        const derived = marketContext && marketContext.supportResistance ? marketContext.supportResistance : Utils.createEmptySupportResistance();
        return {
            support: pickFirstFinite(derived.nearestSupport, values.support),
            resistance: pickFirstFinite(derived.nearestResistance, values.resistance),
            secondarySupport: pickFirstFinite(derived.secondarySupport, Array.isArray(derived.supportLevels) ? derived.supportLevels[1] : null),
            secondaryResistance: pickFirstFinite(derived.secondaryResistance, Array.isArray(derived.resistanceLevels) ? derived.resistanceLevels[1] : null),
            breakout: Boolean(derived.breakout),
            breakdown: Boolean(derived.breakdown),
            supportStrength: derived.strength && derived.strength.support ? derived.strength.support : "WEAK",
            resistanceStrength: derived.strength && derived.strength.resistance ? derived.strength.resistance : "WEAK"
        };
    }

    function firstHigherLevel(reference, candidates) {
        return (candidates || [])
            .filter((value) => Number.isFinite(value) && value > reference)
            .sort((left, right) => left - right)[0] || null;
    }

    function firstLowerLevel(reference, candidates) {
        return (candidates || [])
            .filter((value) => Number.isFinite(value) && value < reference)
            .sort((left, right) => right - left)[0] || null;
    }

    function pickFirstFinite() {
        for (let index = 0; index < arguments.length; index += 1) {
            if (Number.isFinite(arguments[index])) {
                return arguments[index];
            }
        }
        return null;
    }

    global.OptionsTradeEngine = {
        evaluate: evaluate
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
