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
        const reasoning = [];
        const warnings = [];
        const plan = Utils.createEmptyTradePlan();
        const bullishAlignment = isBullishSetup(overallSignal, trendAnalysis);
        const bearishAlignment = isBearishSetup(overallSignal, trendAnalysis);
        const rangePosition = Context.positionWithinRange(values.spotPrice, values.support, values.resistance);

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

        if (bullishAlignment) {
            buildBullishPlan(plan, values, trendAnalysis, gapPrediction, settings, reasoning, warnings);
        } else if (bearishAlignment) {
            buildBearishPlan(plan, values, trendAnalysis, gapPrediction, settings, reasoning, warnings);
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

    function buildBullishPlan(plan, values, trendAnalysis, gapPrediction, settings, reasoning, warnings) {
        plan.direction = "CE";
        plan.invalidation = "Bullish view fails if support breaks or breakout fails quickly.";
        const breakoutBuffer = percentOf(values.resistance || values.spotPrice, settings.tradeBreakoutBufferPercent);
        const pullbackBuffer = percentOf(values.support || values.spotPrice, settings.tradePullbackBufferPercent);

        if (Number.isFinite(values.spotPrice) && Number.isFinite(values.resistance) && values.spotPrice >= values.resistance - breakoutBuffer) {
            plan.entryType = "BREAKOUT";
            plan.entryZone = {
                min: Utils.round(values.resistance, 2),
                max: Utils.round(values.resistance + breakoutBuffer, 2),
                note: "Wait for price to hold above resistance before CE entry."
            };
            plan.stopLoss = buildStopLoss(values, "bullish", settings, values.resistance);
            reasoning.push("Trade plan prefers a bullish breakout above resistance.");
        } else if (Number.isFinite(values.spotPrice) && Number.isFinite(values.support) && values.spotPrice <= values.support + pullbackBuffer) {
            plan.entryType = "PULLBACK";
            plan.entryZone = {
                min: Utils.round(values.support, 2),
                max: Utils.round(values.support + pullbackBuffer, 2),
                note: "Look for a support hold before CE entry."
            };
            plan.stopLoss = buildStopLoss(values, "bullish", settings, values.support);
            reasoning.push("Trade plan prefers a bullish pullback near support.");
        } else {
            plan.entryType = "MOMENTUM";
            plan.entryZone = {
                min: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice, 2) : null,
                max: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice + percentOf(values.spotPrice, settings.tradeBreakoutBufferPercent), 2) : null,
                note: "Wait for momentum confirmation before entry."
            };
            plan.stopLoss = buildStopLoss(values, "bullish", settings, values.spotPrice);
            reasoning.push("Bullish bias exists, but the entry still needs price confirmation.");
        }

        plan.targets = buildTargets(values, plan.entryZone, plan.stopLoss, "bullish");
        plan.riskReward = buildRiskReward(plan.entryZone, plan.stopLoss, plan.targets[0]);
        plan.setupQuality = resolveSetupQuality(trendAnalysis, "bullish", gapPrediction, warnings);
        plan.status = resolveTradeStatus(plan.setupQuality, warnings, trendAnalysis);
    }

    function buildBearishPlan(plan, values, trendAnalysis, gapPrediction, settings, reasoning, warnings) {
        plan.direction = "PE";
        plan.invalidation = "Bearish view fails if resistance breaks or breakdown fails quickly.";
        const breakoutBuffer = percentOf(values.support || values.spotPrice, settings.tradeBreakoutBufferPercent);
        const pullbackBuffer = percentOf(values.resistance || values.spotPrice, settings.tradePullbackBufferPercent);

        if (Number.isFinite(values.spotPrice) && Number.isFinite(values.support) && values.spotPrice <= values.support + breakoutBuffer) {
            plan.entryType = "MOMENTUM";
            plan.entryZone = {
                min: Utils.round(values.support - breakoutBuffer, 2),
                max: Utils.round(values.support, 2),
                note: "Wait for price to stay below support before PE entry."
            };
            plan.stopLoss = buildStopLoss(values, "bearish", settings, values.support);
            reasoning.push("Trade plan prefers a bearish breakdown below support.");
        } else if (Number.isFinite(values.spotPrice) && Number.isFinite(values.resistance) && values.spotPrice >= values.resistance - pullbackBuffer) {
            plan.entryType = "PULLBACK";
            plan.entryZone = {
                min: Utils.round(values.resistance - pullbackBuffer, 2),
                max: Utils.round(values.resistance, 2),
                note: "Look for resistance rejection before PE entry."
            };
            plan.stopLoss = buildStopLoss(values, "bearish", settings, values.resistance);
            reasoning.push("Trade plan prefers a bearish pullback from resistance.");
        } else {
            plan.entryType = "MEAN_REVERSION";
            plan.entryZone = {
                min: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice - percentOf(values.spotPrice, settings.tradeBreakoutBufferPercent), 2) : null,
                max: Number.isFinite(values.spotPrice) ? Utils.round(values.spotPrice, 2) : null,
                note: "Wait for bearish confirmation before entry."
            };
            plan.stopLoss = buildStopLoss(values, "bearish", settings, values.spotPrice);
            reasoning.push("Bearish bias exists, but price still needs confirmation.");
        }

        plan.targets = buildTargets(values, plan.entryZone, plan.stopLoss, "bearish");
        plan.riskReward = buildRiskReward(plan.entryZone, plan.stopLoss, plan.targets[0]);
        plan.setupQuality = resolveSetupQuality(trendAnalysis, "bearish", gapPrediction, warnings);
        plan.status = resolveTradeStatus(plan.setupQuality, warnings, trendAnalysis);
    }

    function buildStopLoss(values, direction, settings, anchorLevel) {
        const reference = Number.isFinite(anchorLevel) ? anchorLevel : values.spotPrice;
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
                note: "Stop loss sits below the nearest bullish structure."
            };
        }

        return {
            value: Utils.round(reference + fallbackOffset, 2),
            type: "STRUCTURE",
            note: "Stop loss sits above the nearest bearish structure."
        };
    }

    function buildTargets(values, entryZone, stopLoss, direction) {
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
            const t1 = Number.isFinite(values.resistance) && values.resistance > referenceEntry
                ? values.resistance
                : referenceEntry + risk;
            const t2 = Number.isFinite(values.maxPain) && values.maxPain > t1
                ? values.maxPain
                : referenceEntry + (risk * 2);
            return [
                { label: "T1", value: Utils.round(t1, 2), note: "Conservative bullish objective." },
                { label: "T2", value: Utils.round(t2, 2), note: "Extended bullish objective." }
            ];
        }

        const t1 = Number.isFinite(values.support) && values.support < referenceEntry
            ? values.support
            : referenceEntry - risk;
        const t2 = Number.isFinite(values.maxPain) && values.maxPain < t1
            ? values.maxPain
            : referenceEntry - (risk * 2);
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

    function resolveSetupQuality(trendAnalysis, direction, gapPrediction, warnings) {
        const aligned = direction === "bullish"
            ? trendAnalysis.alignment.status === "ALIGNED_BULLISH"
            : trendAnalysis.alignment.status === "ALIGNED_BEARISH";
        const gapSupport = gapPrediction.primary === (direction === "bullish" ? "GAP_UP" : "GAP_DOWN");

        if (aligned && gapSupport && !warnings.length) {
            return "HIGH";
        }
        if (aligned || gapSupport) {
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

    global.OptionsTradeEngine = {
        evaluate: evaluate
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
