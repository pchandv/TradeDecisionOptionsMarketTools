const { DECISION_CONFIG } = require("../config/sources");
const { clamp, formatValue, round } = require("../utils/formatters");
const {
    calculateAtrExpansion,
    calculateGlobalCueBias,
    calculateIvPercentileProxy,
    calculateIvTrend,
    calculateMaxPain,
    calculateOiBalance,
    calculateRsi,
    calculateVwapPosition,
    detectTrendStructure,
    getCurrentPrice,
    getInstrumentLabel,
    getRecentSwingLevels,
    getSelectedIntraday,
    getSelectedSpot,
    getSessionTiming,
    resolvePreferredExpiry
} = require("./indicatorEngine");

function getGiftGapPercent(context, selectedSpot) {
    const giftPrice = context?.india?.giftNifty?.price;
    const referenceClose = context?.india?.nifty?.previousClose ?? selectedSpot?.previousClose;
    if (!Number.isFinite(giftPrice) || !Number.isFinite(referenceClose) || !referenceClose) {
        return null;
    }
    return round(((giftPrice - referenceClose) / referenceClose) * 100, 2);
}

function getBreadthRatio(breadth) {
    const advancing = Number(breadth?.advances);
    const declining = Number(breadth?.declines);
    if (!Number.isFinite(advancing) || !Number.isFinite(declining) || advancing < 0 || declining < 0) {
        return null;
    }
    if (declining === 0) {
        return advancing > 0 ? Number.POSITIVE_INFINITY : null;
    }
    return round(advancing / declining, 2);
}

function getFiiNetFlow(internals) {
    const rows = Array.isArray(internals?.fiiDii?.combined) ? internals.fiiDii.combined : [];
    const fiiRow = rows.find((item) => item.category === "FII/FPI");
    const direct = Number(fiiRow?.netValue);
    if (Number.isFinite(direct)) {
        return direct;
    }
    return rows.length
        ? rows.reduce((sum, item) => sum + (Number(item?.netValue) || 0), 0)
        : null;
}

function normalizePcrSignal(pcr) {
    const thresholds = DECISION_CONFIG.adaptiveModel.pcr;
    if (!Number.isFinite(pcr)) {
        return 0;
    }
    if (pcr <= thresholds.bullish) {
        return 1;
    }
    if (pcr >= thresholds.bearish) {
        return -1;
    }
    if (pcr < 1) {
        return round(clamp((1 - pcr) / (1 - thresholds.bullish), -1, 1), 2);
    }
    return round(-clamp((pcr - 1) / (thresholds.bearish - 1), -1, 1), 2);
}

function normalizeMaxPainSignal(currentPrice, strike) {
    if (!Number.isFinite(currentPrice) || !Number.isFinite(strike) || !currentPrice) {
        return 0;
    }
    const distancePercent = ((currentPrice - strike) / currentPrice) * 100;
    const neutralBand = DECISION_CONFIG.adaptiveModel.maxPainNeutralBandPercent;
    if (Math.abs(distancePercent) <= neutralBand) {
        return 0;
    }
    return round(clamp(distancePercent / 1.2, -1, 1), 2);
}

function normalizeOiSignal(value) {
    return Number.isFinite(value) ? round(clamp(value / 0.45, -1, 1), 2) : 0;
}

function normalizeVwapSignal(distancePercent, band) {
    if (!Number.isFinite(distancePercent)) {
        return 0;
    }
    if (Math.abs(distancePercent) <= band) {
        return 0;
    }
    return round(clamp(distancePercent / (band * 2.4), -1, 1), 2);
}

function normalizeRsiSignal(rsi) {
    return Number.isFinite(rsi) ? round(clamp((rsi - 50) / 15, -1, 1), 2) : 0;
}

function getBreakLevels(openingRange, swings) {
    const highs = [openingRange?.completed ? openingRange.high : null, swings?.recentHigh].filter(Number.isFinite);
    const lows = [openingRange?.completed ? openingRange.low : null, swings?.recentLow].filter(Number.isFinite);
    return {
        bullish: highs.length ? round(Math.max(...highs), 2) : null,
        bearish: lows.length ? round(Math.min(...lows), 2) : null
    };
}

function getPriceActionState(currentPrice, breakLevels, trend) {
    if (!Number.isFinite(currentPrice)) {
        return { signal: 0, breakoutDirection: 0, state: "Unavailable", detail: "Spot price is unavailable." };
    }

    const buffer = DECISION_CONFIG.adaptiveModel.priceBreakBufferPercent / 100;
    const bullishLevel = Number.isFinite(breakLevels.bullish) ? breakLevels.bullish * (1 + buffer) : null;
    const bearishLevel = Number.isFinite(breakLevels.bearish) ? breakLevels.bearish * (1 - buffer) : null;

    if (Number.isFinite(bullishLevel) && currentPrice >= bullishLevel) {
        return {
            signal: 1,
            breakoutDirection: 1,
            state: "Bullish breakout",
            detail: `Spot is holding above ${formatValue(breakLevels.bullish)}.`
        };
    }
    if (Number.isFinite(bearishLevel) && currentPrice <= bearishLevel) {
        return {
            signal: -1,
            breakoutDirection: -1,
            state: "Bearish breakdown",
            detail: `Spot is holding below ${formatValue(breakLevels.bearish)}.`
        };
    }

    const driftSignal = round(clamp((trend?.score || 0) * 0.85, -1, 1), 2);
    return {
        signal: driftSignal,
        breakoutDirection: 0,
        state: "Inside structure",
        detail: "Spot is still trading inside the active breakout range."
    };
}

function detectMarketType({ trend, vwapSignal, oiSignal, rsi, ivPercentile, atrExpansion, vixPrice, pcr }) {
    const regime = DECISION_CONFIG.adaptiveModel.regime;
    if (
        (Number.isFinite(ivPercentile) && ivPercentile >= regime.ivPercentileVolatile)
        || (Number.isFinite(atrExpansion) && atrExpansion >= regime.atrExpansionVolatile)
        || (Number.isFinite(vixPrice) && vixPrice >= 18)
    ) {
        return { code: "VOLATILE", label: "Volatile", detail: "IV or ATR expansion is elevated." };
    }

    if (
        Math.abs(trend?.score || 0) >= 0.5
        && Math.abs(vwapSignal || 0) >= 0.55
        && Math.abs(oiSignal || 0) >= regime.oiDirectionalTrending
        && (
            (Number.isFinite(rsi) && rsi >= regime.rsiTrendFloor)
            || (Number.isFinite(rsi) && rsi <= regime.rsiTrendCeiling)
        )
    ) {
        return { code: "TRENDING", label: "Trending", detail: "Trend structure, VWAP, and OI are aligned." };
    }

    if (
        Math.abs(vwapSignal || 0) < 0.35
        && (!Number.isFinite(rsi) || (rsi >= 45 && rsi <= 55))
        && (!Number.isFinite(pcr) || (pcr >= 0.9 && pcr <= 1.1))
    ) {
        return { code: "SIDEWAYS", label: "Sideways", detail: "Spot is oscillating around VWAP with muted momentum." };
    }

    return { code: "TRENDING", label: "Trending", detail: "Directional conditions are stronger than mean-reversion signals." };
}

function getModeProfile(traderProfile = {}) {
    const mode = String(traderProfile?.tradeAggressiveness || "BALANCED").toUpperCase();
    if (mode === "AGGRESSIVE") {
        return {
            key: "AGGRESSIVE",
            tradeThresholdOffset: -8,
            conditionalGap: 22,
            partialDataPenalty: 8,
            severeDataPenalty: 14
        };
    }
    if (mode === "DEFENSIVE" || mode === "CONSERVATIVE") {
        return {
            key: "DEFENSIVE",
            tradeThresholdOffset: 8,
            conditionalGap: 18,
            partialDataPenalty: 12,
            severeDataPenalty: 18
        };
    }
    return {
        key: "BALANCED",
        tradeThresholdOffset: 0,
        conditionalGap: 20,
        partialDataPenalty: 10,
        severeDataPenalty: 16
    };
}

function adjustWeights(baseWeights, marketType, globalCueScore, traderProfile) {
    const weights = { ...baseWeights };
    const modeProfile = getModeProfile(traderProfile);

    if (marketType.code === "SIDEWAYS") {
        weights.maxPain += 4;
        weights.pcr += 2;
        weights.priceAction -= 4;
        weights.oiBalance -= 2;
    } else if (marketType.code === "VOLATILE") {
        weights.iv += 4;
        weights.vwap += 2;
        weights.rsi -= 2;
        weights.maxPain -= 2;
    } else {
        weights.priceAction += 4;
        weights.oiBalance += 3;
        weights.vwap += 2;
        weights.maxPain -= 2;
        weights.pcr -= 1;
    }

    if (Math.abs(globalCueScore || 0) >= 0.35) {
        weights.priceAction += 2;
        weights.oiBalance += 1;
        weights.rsi += 1;
    }

    if (modeProfile.key === "AGGRESSIVE") {
        weights.priceAction += 4;
        weights.vwap += 2;
        weights.oiBalance += 2;
        weights.iv -= 2;
        weights.maxPain -= 2;
    } else if (modeProfile.key === "DEFENSIVE") {
        weights.iv += 3;
        weights.maxPain += 2;
        weights.pcr += 1;
        weights.priceAction -= 3;
        weights.oiBalance -= 3;
    }

    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    return Object.fromEntries(
        Object.entries(weights).map(([key, value]) => [key, round((value / total) * 100, 2)])
    );
}

function detectTrap(gapPercent, vixPrice, priceSignal) {
    const threshold = DECISION_CONFIG.institutionalModel.trapGapThreshold;
    const vixThreshold = DECISION_CONFIG.institutionalModel.vixBearishThreshold;
    if (Number.isFinite(gapPercent) && gapPercent > threshold && Number.isFinite(vixPrice) && vixPrice > vixThreshold && priceSignal <= 0) {
        return { label: "BULL TRAP", tone: "negative", detail: "Gap-up optimism is fading while volatility stays high." };
    }
    if (Number.isFinite(gapPercent) && gapPercent < -threshold && Number.isFinite(vixPrice) && vixPrice > vixThreshold && priceSignal >= 0) {
        return { label: "BEAR TRAP", tone: "positive", detail: "Gap-down fear is being rejected while volatility stays high." };
    }
    return { label: "NONE", tone: "neutral", detail: "No opening trap is active." };
}

function determineBias(score, availableInputs) {
    if (!availableInputs) {
        return "NEUTRAL";
    }
    return score >= 0 ? "UP" : "DOWN";
}

function determineStrength(score) {
    const bands = DECISION_CONFIG.adaptiveModel.scoreBands;
    if (score >= bands.strongBullish) {
        return "Strong Bullish";
    }
    if (score >= bands.mildBullish) {
        return "Mild Bullish";
    }
    if (score <= bands.strongBearish) {
        return "Strong Bearish";
    }
    if (score <= bands.mildBearish) {
        return "Mild Bearish";
    }
    return "No Trade Zone";
}

function determineConfidenceTag(confidence) {
    if (confidence >= 65) {
        return "Strong";
    }
    if (confidence >= 40) {
        return "Moderate";
    }
    return "Weak";
}

function buildConfidence(rawScore, availableInputs, totalInputs, traderProfile) {
    const modeProfile = getModeProfile(traderProfile);
    const rawConfidence = Math.round(Math.abs(rawScore));
    if (!availableInputs) {
        return {
            confidence: 20,
            penalty: 0,
            availableInputs,
            totalInputs
        };
    }

    const minimumRequired = Math.min(totalInputs, 4);
    const penalty = availableInputs >= totalInputs
        ? 0
        : availableInputs >= minimumRequired
            ? modeProfile.partialDataPenalty
            : modeProfile.severeDataPenalty;

    return {
        confidence: Math.max(20, rawConfidence - penalty),
        penalty,
        availableInputs,
        totalInputs
    };
}

function buildTradeThresholds(traderProfile = {}) {
    const modeProfile = getModeProfile(traderProfile);
    const baseTradeThreshold = Number(traderProfile?.minimumConfidence) || DECISION_CONFIG.adaptiveModel.tradeThreshold;
    const tradeThreshold = Math.round(clamp(baseTradeThreshold + modeProfile.tradeThresholdOffset, 45, 90));
    const conditionalThreshold = Math.round(clamp(tradeThreshold - modeProfile.conditionalGap, 20, tradeThreshold - 5));

    return {
        tradeThreshold,
        conditionalThreshold,
        modeProfile
    };
}

function determineDecisionStatus({ availableInputs, confidence, tradeThreshold, conditionalThreshold, entryReady }) {
    if (!availableInputs) {
        return "WAIT";
    }
    if (confidence >= tradeThreshold && entryReady) {
        return "TRADE";
    }
    if (confidence >= conditionalThreshold) {
        return "CONDITIONAL";
    }
    return "WAIT";
}

function buildEntryCondition(action, breakLevels, vwapPosition, marketType) {
    if (action !== "CE" && action !== "PE") {
        return "Wait for enough live data to rebuild the setup.";
    }

    const breakoutLevel = action === "CE" ? breakLevels.bullish : breakLevels.bearish;
    const breakoutText = Number.isFinite(breakoutLevel)
        ? `${action === "CE" ? "above" : "below"} ${formatValue(breakoutLevel)}`
        : action === "CE"
            ? "above the active breakout level"
            : "below the active breakdown level";
    const vwapText = Number.isFinite(vwapPosition?.vwap)
        ? `${action === "CE" ? "with VWAP support above" : "with VWAP pressure below"} ${formatValue(vwapPosition.vwap)}`
        : `${action === "CE" ? "with VWAP support intact" : "with VWAP pressure intact"}`;
    const styleText = marketType?.code === "TRENDING" ? "or on a clean pullback that respects structure" : "";

    return `Enter ${action} only ${breakoutText} ${vwapText}${styleText}.`;
}

function buildDecisionSummary({ status, bias, confidenceTag, marketType, action, tradeLevels, entryCondition, availableInputs, totalInputs, dataPenalty }) {
    if (!availableInputs) {
        return "Live directional inputs are unavailable. Wait for the feeds to recover before trusting the workstation.";
    }

    if (status === "TRADE") {
        return `${bias} bias with ${confidenceTag.toLowerCase()} confidence in a ${marketType.label.toLowerCase()} regime. ${entryCondition}`;
    }
    if (status === "CONDITIONAL") {
        return `${bias} bias is active, but confirmation is still pending. ${entryCondition}`;
    }

    const dataNote = dataPenalty > 0
        ? ` Feed coverage is partial (${availableInputs}/${totalInputs}), so confidence is intentionally reduced.`
        : "";
    const watchLevel = action === "CE" ? tradeLevels.CE_above : tradeLevels.PE_below;
    const watchText = Number.isFinite(watchLevel)
        ? `${action} only on acceptance ${action === "CE" ? "above" : "below"} ${formatValue(watchLevel)}.`
        : `Wait for a cleaner ${action} trigger.`;

    return `${bias} bias is still weak for immediate execution. ${watchText}${dataNote}`;
}

function buildDecisionReasons({ status, confidence, tradeThreshold, conditionalThreshold, entryReady, marketType, dataPenalty, availableInputs, totalInputs, action, breakLevels, vwapPosition }) {
    const reasons = [];

    if (!availableInputs) {
        reasons.push("All live decision inputs are unavailable.");
        return reasons;
    }
    if (dataPenalty > 0) {
        reasons.push(`Only ${availableInputs}/${totalInputs} weighted inputs are live, so confidence is discounted.`);
    }
    if (status !== "TRADE" && confidence < tradeThreshold && confidence >= conditionalThreshold) {
        reasons.push(`Confidence is below the live trade threshold (${tradeThreshold}%).`);
    }
    if (status === "WAIT" && confidence < conditionalThreshold) {
        reasons.push("Trend strength is too weak for an intraday options entry.");
    }
    if (!entryReady) {
        const triggerLevel = action === "CE" ? breakLevels.bullish : breakLevels.bearish;
        reasons.push(Number.isFinite(triggerLevel)
            ? `Price has not confirmed ${action === "CE" ? "above" : "below"} ${formatValue(triggerLevel)} yet.`
            : "Price confirmation is still missing.");
    }
    if (marketType?.code === "SIDEWAYS") {
        reasons.push("Chop risk is elevated while spot is too close to VWAP.");
    }
    if (Number.isFinite(vwapPosition?.distancePercent) && Math.abs(vwapPosition.distancePercent) <= 0.1) {
        reasons.push("Spot is still hugging VWAP, so the move needs cleaner separation.");
    }

    return reasons;
}

function buildIvSignal(ivPercentile, ivTrendDirection, directionalBias) {
    if (!directionalBias) {
        return 0;
    }
    let quality = 0;
    if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile) {
        quality = -0.95;
    } else if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivHighPercentile) {
        quality = -0.35;
    } else if (Number.isFinite(ivPercentile) && ivPercentile <= 35) {
        quality = 0.35;
    }

    if (ivTrendDirection === "RISING") {
        quality += 0.2;
    } else if (ivTrendDirection === "FALLING") {
        quality -= 0.25;
    }

    return round(clamp(quality, -1, 1) * Math.sign(directionalBias), 2);
}

function createComponent(key, label, signal, weight, value, detail, available) {
    return {
        key,
        label,
        signal,
        weight,
        score: round(signal * weight, 2),
        value,
        detail,
        tone: signal > 0 ? "bullish" : signal < 0 ? "bearish" : "neutral",
        available: Boolean(available)
    };
}

function buildTradeLevels(action, currentPrice, breakLevels, vwap, swings, marketType) {
    const entryLevel = action === "CE" ? breakLevels.bullish : action === "PE" ? breakLevels.bearish : null;
    const fallbackEntry = action === "CE"
        ? (Number.isFinite(vwap) ? vwap : swings?.recentHigh)
        : action === "PE"
            ? (Number.isFinite(vwap) ? vwap : swings?.recentLow)
            : null;
    const chosenEntry = Number.isFinite(entryLevel) ? entryLevel : fallbackEntry;
    const stopLoss = action === "CE"
        ? [vwap, swings?.recentLow].filter((value) => Number.isFinite(value) && value < chosenEntry).sort((a, b) => b - a)[0] ?? null
        : action === "PE"
            ? [vwap, swings?.recentHigh].filter((value) => Number.isFinite(value) && value > chosenEntry).sort((a, b) => a - b)[0] ?? null
            : null;
    const riskDistance = Number.isFinite(chosenEntry) && Number.isFinite(stopLoss) ? Math.abs(chosenEntry - stopLoss) : null;
    const target = action === "CE"
        ? (Number.isFinite(chosenEntry) && Number.isFinite(riskDistance) ? round(chosenEntry + (riskDistance * DECISION_CONFIG.adaptiveModel.riskRewardFloor), 2) : null)
        : action === "PE"
            ? (Number.isFinite(chosenEntry) && Number.isFinite(riskDistance) ? round(chosenEntry - (riskDistance * DECISION_CONFIG.adaptiveModel.riskRewardFloor), 2) : null)
            : null;

    return {
        style: action === "WAIT"
            ? "Wait"
            : marketType.code === "TRENDING" && Number.isFinite(currentPrice) && Number.isFinite(vwap) && Math.abs(currentPrice - vwap) <= Math.abs(currentPrice * 0.0025)
                ? "Pullback"
                : "Breakout",
        CE_above: breakLevels.bullish,
        PE_below: breakLevels.bearish,
        entryLevel: chosenEntry,
        stopLoss,
        target,
        riskReward: Number.isFinite(riskDistance) && riskDistance > 0 ? DECISION_CONFIG.adaptiveModel.riskRewardFloor : null
    };
}

function buildHold(action, activeTrade, currentPrice, vwap, rsi, sessionTiming) {
    const liveOption = activeTrade?.optionType || action;
    if (!liveOption || liveOption === "WAIT" || !Number.isFinite(currentPrice) || !Number.isFinite(vwap)) {
        return {
            status: "WATCH",
            headline: "Wait for a live position",
            detail: "Hold guidance will activate after a CE or PE trade is acknowledged."
        };
    }

    const pullbackBand = Math.abs(vwap) * 0.0018;
    if (liveOption === "CE") {
        if (currentPrice > vwap && Number(rsi) > 55) {
            return { status: "HOLD", headline: "HOLD CE", detail: "Spot is above VWAP and momentum is intact." };
        }
        if (currentPrice >= (vwap - pullbackBand) && Number(rsi) >= 50) {
            return { status: "HOLD", headline: "CONTINUE HOLD", detail: "Pullback is shallow and VWAP still holds." };
        }
        return { status: "EXIT", headline: "EXIT CE", detail: "VWAP support failed or momentum faded." };
    }

    if (currentPrice < vwap && Number(rsi) < 45) {
        return { status: "HOLD", headline: "HOLD PE", detail: "Spot is below VWAP and downside momentum is intact." };
    }
    if (currentPrice <= (vwap + pullbackBand) && Number(rsi) <= 50) {
        return { status: "HOLD", headline: "CONTINUE HOLD", detail: "Pullback is contained below VWAP." };
    }
    return {
        status: "EXIT",
        headline: "EXIT PE",
        detail: sessionTiming?.lateSession || sessionTiming?.nearExpiry
            ? "VWAP reclaim or theta risk is invalidating the bearish hold."
            : "VWAP reclaim or momentum fade is invalidating the bearish hold."
    };
}

function buildRiskWarnings(ivPercentile, ivTrendDirection, sessionTiming, marketType) {
    const warnings = [];
    if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile) {
        warnings.push("IV percentile is above 90. Prefer spreads over naked option buying.");
    } else if (Number.isFinite(ivPercentile) && ivPercentile >= DECISION_CONFIG.adaptiveModel.ivHighPercentile) {
        warnings.push("IV percentile is elevated. Avoid paying up after the move extends.");
    }
    if (ivTrendDirection === "FALLING") {
        warnings.push("IV is falling. Avoid late premium entries.");
    } else if (ivTrendDirection === "RISING") {
        warnings.push("IV is rising. Early momentum entries are favored.");
    }
    if (sessionTiming?.lateSession) {
        warnings.push("It is after 2:30 PM IST. Reduce holding duration.");
    }
    if (sessionTiming?.nearExpiry) {
        warnings.push("Near-expiry theta risk is high. Avoid long holds.");
    }
    if (marketType.code === "VOLATILE") {
        warnings.push("Volatile regime is active. Use smaller size and cleaner triggers.");
    }
    return warnings;
}

function buildAdaptiveDecisionEngine(context) {
    const selectedInstrument = context.traderProfile?.preferredInstrument || "NIFTY";
    const selectedInstrumentLabel = getInstrumentLabel(selectedInstrument);
    const selectedSpot = getSelectedSpot(context.india, selectedInstrument);
    const selectedIntraday = getSelectedIntraday(context.intraday, selectedInstrument);
    const selectedPrice = getCurrentPrice(selectedSpot, selectedIntraday);
    const chain = context.internals?.optionChains?.[selectedInstrument] || context.internals?.optionChain || null;
    const openingRange = selectedIntraday?.openingRange || null;
    const trend = detectTrendStructure(selectedIntraday?.series || []);
    const swings = getRecentSwingLevels(selectedIntraday?.series || []);
    const vwapPosition = calculateVwapPosition(selectedIntraday);
    const band = Number(context.traderProfile?.vwapBandPercent) || DECISION_CONFIG.adaptiveModel.vwapTrendBandPercent;
    const rsi = calculateRsi(selectedIntraday?.series || []);
    const atrExpansion = calculateAtrExpansion(selectedIntraday?.series || []);
    const maxPain = calculateMaxPain(chain, context.traderProfile);
    const oiBalance = calculateOiBalance(chain, context.traderProfile);
    const ivPercentile = calculateIvPercentileProxy(chain, context.traderProfile);
    const ivTrend = calculateIvTrend(context);
    const gapPercent = getGiftGapPercent(context, selectedSpot);
    const vixPrice = context.india?.indiaVix?.price ?? context.intraday?.instruments?.INDIA_VIX?.price ?? null;
    const pcr = chain?.putCallRatio ?? null;
    const breadthRatio = getBreadthRatio(context.internals?.breadth);
    const fiiFlow = getFiiNetFlow(context.internals);
    const globalCue = calculateGlobalCueBias(context);
    const preferredExpiry = resolvePreferredExpiry(chain, context.traderProfile);
    const sessionTiming = getSessionTiming(preferredExpiry);
    const thresholds = buildTradeThresholds(context.traderProfile);

    const vwapSignal = normalizeVwapSignal(vwapPosition.distancePercent, band);
    const oiSignal = normalizeOiSignal(oiBalance.directionalRatio);
    const marketType = detectMarketType({
        trend,
        vwapSignal,
        oiSignal,
        rsi,
        ivPercentile: ivPercentile.percentile,
        atrExpansion,
        vixPrice,
        pcr
    });
    const weights = adjustWeights(DECISION_CONFIG.adaptiveModel.weights, marketType, globalCue.score, context.traderProfile);
    const breakLevels = getBreakLevels(openingRange, swings);
    const priceAction = getPriceActionState(selectedPrice, breakLevels, trend);
    const pcrSignal = normalizePcrSignal(pcr);
    const maxPainSignal = normalizeMaxPainSignal(selectedPrice, maxPain.strike);
    const rsiSignal = normalizeRsiSignal(rsi);
    const directionalBias = priceAction.breakoutDirection || Math.sign((oiSignal * 0.45) + (vwapSignal * 0.35) + ((trend?.score || 0) * 0.2));
    const ivSignal = buildIvSignal(ivPercentile.percentile, ivTrend.direction, directionalBias);
    const score = round(clamp(
        (pcrSignal * weights.pcr)
        + (maxPainSignal * weights.maxPain)
        + (oiSignal * weights.oiBalance)
        + (vwapSignal * weights.vwap)
        + (rsiSignal * weights.rsi)
        + (ivSignal * weights.iv)
        + (priceAction.signal * weights.priceAction)
        + ((globalCue.score || 0) * DECISION_CONFIG.adaptiveModel.globalOverlayMax),
        DECISION_CONFIG.adaptiveModel.scoreRange.minimum,
        DECISION_CONFIG.adaptiveModel.scoreRange.maximum
    ), 2);

    const availability = {
        pcr: Number.isFinite(pcr),
        maxPain: Number.isFinite(selectedPrice) && Number.isFinite(maxPain.strike),
        oiBalance: Number.isFinite(oiBalance.directionalRatio),
        vwap: Number.isFinite(vwapPosition.distancePercent),
        rsi: Number.isFinite(rsi),
        iv: Number.isFinite(ivPercentile.percentile),
        priceAction: Number.isFinite(selectedPrice) && (Number.isFinite(breakLevels.bullish) || Number.isFinite(breakLevels.bearish) || Math.abs(trend?.score || 0) > 0)
    };
    const totalInputs = Object.keys(availability).length;
    const availableInputs = Object.values(availability).filter(Boolean).length;
    const confidenceModel = buildConfidence(score, availableInputs, totalInputs, context.traderProfile);
    const confidence = confidenceModel.confidence;
    const confidenceTag = determineConfidenceTag(confidence);
    const bias = determineBias(score, availableInputs);
    const strength = determineStrength(score);
    const trap = detectTrap(gapPercent, vixPrice, priceAction.signal);
    const directionalAction = bias === "UP" ? "CE" : bias === "DOWN" ? "PE" : "WAIT";
    const breakoutReady = priceAction.breakoutDirection === (bias === "UP" ? 1 : bias === "DOWN" ? -1 : 0);
    const pullbackReady = marketType.code === "TRENDING" && Math.abs(priceAction.signal) >= 0.45;
    const entryReady = breakoutReady || pullbackReady;
    const status = determineDecisionStatus({
        availableInputs,
        confidence,
        tradeThreshold: thresholds.tradeThreshold,
        conditionalThreshold: thresholds.conditionalThreshold,
        entryReady
    });
    const tradeLevels = buildTradeLevels(directionalAction, selectedPrice, breakLevels, vwapPosition.vwap, swings, marketType);
    const entryCondition = buildEntryCondition(directionalAction, breakLevels, vwapPosition, marketType);
    const hold = buildHold(directionalAction, context.activeTrade, selectedPrice, vwapPosition.vwap, rsi, sessionTiming);
    const riskWarnings = buildRiskWarnings(ivPercentile.percentile, ivTrend.direction, sessionTiming, marketType);
    const optionsIntelligence = {
        suggestedStructure: directionalAction === "WAIT"
            ? "WAIT"
            : ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile
                ? "SPREAD"
                : directionalAction,
        directionalOption: directionalAction,
        ivPercentile: ivPercentile.percentile ?? null,
        ivTrend: ivTrend.direction || "FLAT",
        thetaRisk: sessionTiming?.lateSession || sessionTiming?.nearExpiry ? "High" : "Controlled",
        warnings: riskWarnings
    };
    const riskScore = Math.round(clamp(
        34
        + (marketType.code === "VOLATILE" ? 26 : 0)
        + (trap.label !== "NONE" ? 14 : 0)
        + (ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivExtremePercentile ? 18 : ivPercentile.percentile >= DECISION_CONFIG.adaptiveModel.ivHighPercentile ? 10 : 0)
        + (sessionTiming?.lateSession ? 8 : 0)
        - Math.min(18, Math.round(confidence / 6)),
        12,
        95
    ));
    const blockers = buildDecisionReasons({
        status,
        confidence,
        tradeThreshold: thresholds.tradeThreshold,
        conditionalThreshold: thresholds.conditionalThreshold,
        entryReady,
        marketType,
        dataPenalty: confidenceModel.penalty,
        availableInputs,
        totalInputs,
        action: directionalAction,
        breakLevels,
        vwapPosition
    });
    const components = [
        createComponent("pcr", "PCR", pcrSignal, weights.pcr, Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable", "PCR uses Put OI / Call OI.", availability.pcr),
        createComponent("maxPain", "Max Pain Distance", maxPainSignal, weights.maxPain, Number.isFinite(maxPain.strike) ? formatValue(maxPain.strike) : "Unavailable", "Price above max pain is bullish drift; below max pain is bearish drift.", availability.maxPain),
        createComponent("oiBalance", "OI Buildup", oiSignal, weights.oiBalance, Number.isFinite(oiBalance.directionalRatio) ? formatValue(oiBalance.directionalRatio, 4) : "Unavailable", "Positive OI balance means put-side participation is stronger.", availability.oiBalance),
        createComponent("vwap", "VWAP Position", vwapSignal, weights.vwap, Number.isFinite(vwapPosition.distancePercent) ? `${formatValue(vwapPosition.distancePercent)}%` : "Unavailable", "Spot above proxy VWAP is bullish; below proxy VWAP is bearish.", availability.vwap),
        createComponent("rsi", "RSI", rsiSignal, weights.rsi, Number.isFinite(rsi) ? formatValue(rsi) : "Unavailable", "Momentum above 55 is bullish and below 45 is bearish.", availability.rsi),
        createComponent("iv", "IV Quality", ivSignal, weights.iv, Number.isFinite(ivPercentile.percentile) ? `IVP ${formatValue(ivPercentile.percentile)} | ${ivTrend.direction}` : "Unavailable", "IV percentile and IV trend decide whether buying premium or using spreads is better.", availability.iv),
        createComponent("priceAction", "Price Action", priceAction.signal, weights.priceAction, priceAction.state, priceAction.detail, availability.priceAction)
    ];
    const engineVersion = context.traderProfile?.engineVersion || DECISION_CONFIG.defaultVersion;
    const summary = buildDecisionSummary({
        status,
        bias,
        confidenceTag,
        marketType,
        action: directionalAction,
        tradeLevels,
        entryCondition,
        availableInputs,
        totalInputs,
        dataPenalty: confidenceModel.penalty
    });
    const headline = status === "TRADE"
        ? (directionalAction === "CE" ? "BUY CE" : "BUY PE")
        : status === "CONDITIONAL"
            ? (directionalAction === "CE" ? "CE ON TRIGGER" : "PE ON TRIGGER")
            : (directionalAction === "CE" ? "WAIT FOR CE" : directionalAction === "PE" ? "WAIT FOR PE" : "WAIT");

    return {
        engineVersion,
        engineLabel: DECISION_CONFIG.engineVersions[engineVersion]?.label || "Adaptive AI v2",
        status,
        mode: status,
        bias,
        action: directionalAction,
        direction: bias,
        optionType: directionalAction,
        headline,
        confidence,
        confidenceTag,
        score,
        scoreMeter: {
            minimum: DECISION_CONFIG.adaptiveModel.scoreRange.minimum,
            maximum: DECISION_CONFIG.adaptiveModel.scoreRange.maximum,
            value: score,
            label: strength
        },
        selectedInstrument,
        selectedInstrumentLabel,
        suggestedStrikeStyle: optionsIntelligence.suggestedStructure === "SPREAD" ? "ATM" : confidence >= 75 ? "OTM" : confidence >= 55 ? "ATM" : "ITM",
        trap: trap.label,
        trapDetail: trap.detail,
        trapTone: trap.tone,
        summary,
        trend: {
            regime: trend.regime,
            badge: trend.badge,
            detail: trend.detail
        },
        marketType,
        hold,
        optionsIntelligence,
        thresholds,
        executionReady: status === "TRADE",
        entryCondition,
        opening: {
            title: priceAction.state,
            detail: priceAction.detail,
            score: priceAction.signal,
            gapPercent,
            first15High: openingRange?.high ?? null,
            first15Low: openingRange?.low ?? null
        },
        noTradeZone: {
            active: status !== "TRADE",
            reasons: blockers
        },
        entry: {
            CE_above: tradeLevels.CE_above,
            PE_below: tradeLevels.PE_below
        },
        tradeFramework: {
            entryStyle: tradeLevels.style,
            entryLevel: tradeLevels.entryLevel,
            stopLoss: tradeLevels.stopLoss,
            target: tradeLevels.target,
            riskReward: tradeLevels.riskReward,
            optionSuggestion: optionsIntelligence.suggestedStructure
        },
        vwap: {
            proxyLabel: selectedIntraday?.proxy?.label || "Proxy",
            price: vwapPosition.price,
            vwap: vwapPosition.vwap,
            distancePercent: vwapPosition.distancePercent,
            relativeVolume: vwapPosition.relativeVolume
        },
        levels: {
            support: chain?.support?.strike ?? swings?.recentLow ?? null,
            resistance: chain?.resistance?.strike ?? swings?.recentHigh ?? null,
            pcr,
            breadthRatio,
            fiiFlow,
            maxPain: maxPain.strike ?? null
        },
        marketContext: {
            selectedPrice,
            selectedChangePercent: selectedSpot?.changePercent ?? selectedIntraday?.sessionChangePercent ?? null,
            first15High: openingRange?.high ?? null,
            first15Low: openingRange?.low ?? null,
            priceSignal: priceAction.signal,
            rsi,
            atrExpansion,
            ivPercentile: ivPercentile.percentile ?? null
        },
        scorecard: {
            weights,
            pcr,
            pcrSignal,
            maxPain: maxPain.strike ?? null,
            maxPainSignal,
            oiDirectionalRatio: oiBalance.directionalRatio ?? null,
            oiSignal,
            vwapDistancePercent: vwapPosition.distancePercent ?? null,
            vwapSignal,
            rsi,
            rsiSignal,
            ivPercentile: ivPercentile.percentile ?? null,
            ivSignal,
            currentPrice: selectedPrice,
            priceSignal: priceAction.signal,
            first15MinHigh: openingRange?.high ?? null,
            first15MinLow: openingRange?.low ?? null,
            marketType: marketType.code,
            globalCueScore: globalCue.score ?? 0,
            availableInputs,
            totalInputs,
            dataPenalty: confidenceModel.penalty
        },
        riskMeter: {
            score: riskScore,
            level: riskScore >= 72 ? "High" : riskScore >= 46 ? "Moderate" : "Controlled",
            detail: riskScore >= 72
                ? "Volatility, timing, or trap risk is elevated. Size down and demand cleaner entries."
                : riskScore >= 46
                    ? "The setup is tradable, but execution still needs discipline."
                    : "Execution risk is relatively contained for an intraday attempt."
        },
        components,
        quick: {
            status,
            mode: status,
            direction: bias,
            optionType: directionalAction,
            conviction: confidenceTag,
            trap: trap.label
        },
        notes: [
            `Adaptive score ${formatValue(score)} maps to ${strength}.`,
            `Global cue overlay is ${globalCue.sentiment.toLowerCase()} (${formatValue(globalCue.score)}).`,
            `Breadth ratio ${breadthRatio === Number.POSITIVE_INFINITY ? "all advances" : (Number.isFinite(breadthRatio) ? formatValue(breadthRatio) : "Unavailable")}, FII flow ${Number.isFinite(fiiFlow) ? `Rs ${formatValue(fiiFlow)} Cr` : "Unavailable"}, VIX ${Number.isFinite(vixPrice) ? formatValue(vixPrice) : "Unavailable"}, PCR ${Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable"}.`,
            entryCondition,
            ...riskWarnings.slice(0, 3)
        ]
    };
}

module.exports = {
    buildAdaptiveDecisionEngine
};
