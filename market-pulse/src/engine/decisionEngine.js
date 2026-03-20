const { DECISION_CONFIG } = require("../config/sources");
const { clamp, formatValue, round } = require("../utils/formatters");

function getInstrumentLabel(symbol) {
    return symbol === "BANKNIFTY" ? "BANK NIFTY" : "NIFTY";
}

function getSelectedSpot(india, symbol) {
    return symbol === "BANKNIFTY" ? india?.bankNifty : india?.nifty;
}

function getSelectedIntraday(intraday, symbol) {
    return intraday?.instruments?.[symbol] || null;
}

function getCurrentPrice(spot, intraday) {
    const lastCandle = intraday?.series?.[intraday.series.length - 1];
    return Number.isFinite(lastCandle?.close) ? lastCandle.close : (spot?.price ?? null);
}

function getSeriesCloses(series = []) {
    return series
        .map((candle) => candle.close)
        .filter((value) => Number.isFinite(value));
}

function findPivots(series = []) {
    const highs = [];
    const lows = [];

    for (let index = 1; index < series.length - 1; index += 1) {
        const previous = series[index - 1];
        const current = series[index];
        const next = series[index + 1];

        if (current.high > previous.high && current.high >= next.high) {
            highs.push({ index, value: current.high });
        }
        if (current.low < previous.low && current.low <= next.low) {
            lows.push({ index, value: current.low });
        }
    }

    return { highs, lows };
}

function detectTrendStructure(series = []) {
    const recentSeries = series.slice(-14);
    if (recentSeries.length < 5) {
        return {
            regime: "SIDEWAYS",
            badge: "Sideways",
            score: 0,
            strength: 0.3,
            detail: "Not enough intraday candles to validate HH/HL or LH/LL."
        };
    }

    const pivots = findPivots(recentSeries);
    const lastHighs = pivots.highs.slice(-2);
    const lastLows = pivots.lows.slice(-2);
    let regime = "SIDEWAYS";
    let score = 0;
    let detail = "Recent swing highs and lows are overlapping.";
    let strength = 0.45;

    if (lastHighs.length >= 2 && lastLows.length >= 2) {
        const higherHighs = lastHighs[1].value > lastHighs[0].value;
        const higherLows = lastLows[1].value > lastLows[0].value;
        const lowerHighs = lastHighs[1].value < lastHighs[0].value;
        const lowerLows = lastLows[1].value < lastLows[0].value;

        if (higherHighs && higherLows) {
            regime = "UPTREND";
            score = 1;
            strength = 0.85;
            detail = "Higher highs and higher lows are active.";
        } else if (lowerHighs && lowerLows) {
            regime = "DOWNTREND";
            score = -1;
            strength = 0.85;
            detail = "Lower highs and lower lows are active.";
        }
    }

    if (score === 0) {
        const closes = getSeriesCloses(recentSeries);
        const first = closes[0];
        const last = closes[closes.length - 1];
        const movePercent = Number.isFinite(first) && first
            ? round(((last - first) / first) * 100, 2)
            : null;

        if (movePercent >= 0.45) {
            regime = "UPTREND";
            score = 0.5;
            strength = 0.65;
            detail = "Closes are drifting higher even though pivots are not fully clean yet.";
        } else if (movePercent <= -0.45) {
            regime = "DOWNTREND";
            score = -0.5;
            strength = 0.65;
            detail = "Closes are drifting lower even though pivots are not fully clean yet.";
        }
    }

    return {
        regime,
        badge: regime === "UPTREND" ? "Uptrend Active" : regime === "DOWNTREND" ? "Downtrend Active" : "Sideways",
        score,
        strength,
        detail
    };
}

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
    const combinedFlows = Array.isArray(internals?.fiiDii?.combined) ? internals.fiiDii.combined : [];
    const fiiRow = combinedFlows.find((item) => item.category === "FII/FPI");
    const fiiNet = Number(fiiRow?.netValue);

    if (Number.isFinite(fiiNet)) {
        return fiiNet;
    }

    const fallbackCombined = combinedFlows.reduce((sum, item) => {
        const value = Number(item?.netValue);
        return Number.isFinite(value) ? sum + value : sum;
    }, 0);

    return combinedFlows.length ? fallbackCombined : null;
}

function normalizeGiftSignal(gapPercent) {
    const flatThreshold = DECISION_CONFIG.institutionalModel.giftFlatThreshold;

    if (!Number.isFinite(gapPercent)) {
        return 0;
    }
    if (Math.abs(gapPercent) < flatThreshold) {
        return 0;
    }
    return gapPercent > 0 ? 1 : -1;
}

function normalizeVixSignal(vixPrice) {
    if (!Number.isFinite(vixPrice)) {
        return 0;
    }
    if (vixPrice > DECISION_CONFIG.institutionalModel.vixBearishThreshold) {
        return -1;
    }
    if (vixPrice < DECISION_CONFIG.institutionalModel.vixBullishThreshold) {
        return 1;
    }
    return 0;
}

function normalizePcrSignal(pcr) {
    if (!Number.isFinite(pcr)) {
        return 0;
    }
    if (pcr > DECISION_CONFIG.institutionalModel.pcrBearishThreshold) {
        return -1;
    }
    if (pcr < DECISION_CONFIG.institutionalModel.pcrBullishThreshold) {
        return 1;
    }
    return 0;
}

function normalizeBreadthSignal(breadthRatio) {
    if (!Number.isFinite(breadthRatio)) {
        if (breadthRatio === Number.POSITIVE_INFINITY) {
            return 1;
        }
        return 0;
    }
    if (breadthRatio > DECISION_CONFIG.institutionalModel.breadthBullishThreshold) {
        return 1;
    }
    if (breadthRatio < DECISION_CONFIG.institutionalModel.breadthBearishThreshold) {
        return -1;
    }
    return 0;
}

function normalizeFlowSignal(fiiFlow) {
    if (!Number.isFinite(fiiFlow)) {
        return 0;
    }
    if (fiiFlow > 0) {
        return 1;
    }
    if (fiiFlow < 0) {
        return -1;
    }
    return 0;
}

function normalizePriceSignal(currentPrice, openingRange) {
    const first15High = openingRange?.high;
    const first15Low = openingRange?.low;
    if (!openingRange?.completed || !Number.isFinite(currentPrice) || !Number.isFinite(first15High) || !Number.isFinite(first15Low)) {
        return 0;
    }

    if (currentPrice > first15High) {
        return 1;
    }
    if (currentPrice < first15Low) {
        return -1;
    }
    return 0;
}

function determineBias(score) {
    if (score > DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
        return "UP";
    }
    if (score < -DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
        return "DOWN";
    }
    return "NEUTRAL";
}

function determineAction(score, priceSignal) {
    if (priceSignal === 0) {
        return "WAIT";
    }
    if (score > DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
        return "CE";
    }
    if (score < -DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
        return "PE";
    }
    return "WAIT";
}

function detectTrap(gapPercent, vixPrice, priceSignal) {
    const threshold = DECISION_CONFIG.institutionalModel.trapGapThreshold;
    const vixThreshold = DECISION_CONFIG.institutionalModel.vixBearishThreshold;

    if (Number.isFinite(gapPercent) && gapPercent > threshold && Number.isFinite(vixPrice) && vixPrice > vixThreshold && priceSignal <= 0) {
        return {
            label: "BULL TRAP",
            tone: "negative",
            detail: "Gap-up optimism is not being accepted while VIX stays elevated."
        };
    }

    if (Number.isFinite(gapPercent) && gapPercent < -threshold && Number.isFinite(vixPrice) && vixPrice > vixThreshold && priceSignal >= 0) {
        return {
            label: "BEAR TRAP",
            tone: "positive",
            detail: "Gap-down fear is being rejected while VIX stays elevated."
        };
    }

    return {
        label: "NONE",
        tone: "neutral",
        detail: "No opening trap is currently active."
    };
}

function buildComponent(key, label, signal, weight, value, detail) {
    return {
        key,
        label,
        signal,
        weight,
        score: round(signal * weight, 2),
        value,
        detail: `Signal ${signal > 0 ? "+" : ""}${signal} x weight ${weight.toFixed(2)}. ${detail}`,
        tone: signal > 0 ? "bullish" : signal < 0 ? "bearish" : "neutral"
    };
}

function formatSignalValue(signal) {
    if (!Number.isFinite(signal)) {
        return "Unavailable";
    }
    return signal > 0 ? "+1" : signal < 0 ? "-1" : "0";
}

function describePriceLocation(priceSignal, openingRange) {
    if (!openingRange?.completed) {
        return "Waiting for first 15-minute range";
    }
    if (priceSignal > 0) {
        return "Above first 15-minute high";
    }
    if (priceSignal < 0) {
        return "Below first 15-minute low";
    }
    return "Inside first 15-minute range";
}

function buildOpeningState(gapPercent, currentPrice, openingRange, priceSignal) {
    const gapType = !Number.isFinite(gapPercent) || Math.abs(gapPercent) < DECISION_CONFIG.institutionalModel.giftFlatThreshold
        ? "FLAT"
        : gapPercent > 0
            ? "GAP_UP"
            : "GAP_DOWN";

    const first15High = openingRange?.high ?? null;
    const first15Low = openingRange?.low ?? null;

    if (!openingRange?.completed || !Number.isFinite(currentPrice)) {
        return {
            gapType,
            gapPercent,
            first15High,
            first15Low,
            score: 0,
            title: "Opening range not ready",
            detail: "Wait for the first 15-minute high and low before taking a directional option trade."
        };
    }

    if (priceSignal > 0) {
        return {
            gapType,
            gapPercent,
            first15High,
            first15Low,
            score: 1,
            title: "Price confirmed above first 15-minute high",
            detail: `Spot is trading above ${formatValue(first15High)}, so bullish continuation is confirmed.`
        };
    }

    if (priceSignal < 0) {
        return {
            gapType,
            gapPercent,
            first15High,
            first15Low,
            score: -1,
            title: "Price confirmed below first 15-minute low",
            detail: `Spot is trading below ${formatValue(first15Low)}, so bearish continuation is confirmed.`
        };
    }

    return {
        gapType,
        gapPercent,
        first15High,
        first15Low,
        score: 0,
        title: "Price is still inside the first 15-minute range",
        detail: `Wait for acceptance above ${formatValue(first15High)} or below ${formatValue(first15Low)}.`
    };
}

function buildNoTradeZone({ action, bias, score, priceSignal, opening, trap }) {
    const reasons = [];

    if (!opening?.first15High || !opening?.first15Low) {
        reasons.push("Opening range is not complete yet.");
    }
    if (priceSignal === 0) {
        reasons.push("Price is still inside the first 15-minute range.");
    }
    if (Math.abs(score) <= DECISION_CONFIG.institutionalModel.tradeScoreThreshold) {
        reasons.push("Weighted score is not strong enough for a trade.");
    }
    if (trap.label !== "NONE" && action === "WAIT") {
        reasons.push(`${trap.label} is active, but price has not confirmed the reversal entry yet.`);
    }
    if (action === "WAIT" && bias !== "NEUTRAL" && priceSignal === 0) {
        reasons.push(`Bias is ${bias}, but confirmation is missing.`);
    }

    return {
        active: action === "WAIT",
        reasons
    };
}

function buildConfidence(score) {
    return Math.min(95, Math.round(Math.abs(score) * 100));
}

function buildRiskMeter(vixPrice, trap, priceSignal, score) {
    let raw = 38;

    if (Number.isFinite(vixPrice) && vixPrice > DECISION_CONFIG.institutionalModel.vixBearishThreshold) {
        raw += 24;
    } else if (Number.isFinite(vixPrice) && vixPrice < DECISION_CONFIG.institutionalModel.vixBullishThreshold) {
        raw -= 8;
    }

    if (trap.label !== "NONE") {
        raw += 14;
    }
    if (priceSignal === 0) {
        raw += 12;
    }
    if (Math.abs(score) >= 0.6) {
        raw -= 8;
    } else if (Math.abs(score) < 0.25) {
        raw += 8;
    }

    const scoreValue = Math.round(clamp(raw, 12, 95));
    return {
        score: scoreValue,
        level: scoreValue >= 70 ? "High" : scoreValue >= 45 ? "Moderate" : "Controlled",
        detail: scoreValue >= 70
            ? "Volatility or trap conditions are elevated. Confirm every level before entering."
            : scoreValue >= 45
                ? "The setup is tradable, but it still needs disciplined entry and stop execution."
                : "Risk conditions are relatively stable for a directional attempt."
    };
}

function determineSuggestedStrikeStyle(action, score, confidence, trend, trap) {
    if (action === "WAIT") {
        return "ATM";
    }
    if (trap.label !== "NONE" || confidence < 55) {
        return "ITM";
    }
    if (Math.abs(score) >= 0.7 && ((action === "CE" && trend.regime === "UPTREND") || (action === "PE" && trend.regime === "DOWNTREND"))) {
        return "OTM";
    }
    if (Math.abs(score) >= 0.5) {
        return "ATM";
    }
    return "ITM";
}

function buildMode(action) {
    return action === "WAIT" ? "WAIT" : "TRADE";
}

function buildStatusEngine(action, activeTrade) {
    if (!activeTrade) {
        return {
            status: action === "WAIT" ? "WAIT" : "TRADE",
            detail: null
        };
    }

    if (action === "WAIT") {
        return {
            status: "EXIT",
            detail: "Live confirmation is gone. Exit the active trade."
        };
    }

    if (activeTrade.optionType !== action) {
        return {
            status: "EXIT",
            detail: `Live action flipped to ${action}. Exit the active ${activeTrade.optionType} trade.`
        };
    }

    return {
        status: "TRADE",
        detail: "The active trade still aligns with the live decision engine."
    };
}

function buildHeadline(status, action) {
    if (status === "EXIT") {
        return "EXIT";
    }
    if (action === "CE") {
        return "BUY CE";
    }
    if (action === "PE") {
        return "BUY PE";
    }
    return "WAIT";
}

function buildSummary({ status, mode, action, bias, trap, opening, selectedInstrumentLabel }) {
    if (status === "EXIT") {
        return "Exit the active trade and wait for a fresh confirmed entry.";
    }

    if (action === "CE") {
        return trap.label === "BEAR TRAP"
            ? `${trap.label} confirmed. Bias is ${bias}. Buy ${selectedInstrumentLabel} CE only above ${formatValue(opening.first15High)}.`
            : `Bias is ${bias}. Buy ${selectedInstrumentLabel} CE only above ${formatValue(opening.first15High)}.`;
    }

    if (action === "PE") {
        return trap.label === "BULL TRAP"
            ? `${trap.label} confirmed. Bias is ${bias}. Buy ${selectedInstrumentLabel} PE only below ${formatValue(opening.first15Low)}.`
            : `Bias is ${bias}. Buy ${selectedInstrumentLabel} PE only below ${formatValue(opening.first15Low)}.`;
    }

    if (mode === "WAIT" && bias === "UP" && Number.isFinite(opening.first15High)) {
        return `Bias is UP, but price is still inside the first 15-minute range. Wait for CE above ${formatValue(opening.first15High)}.`;
    }

    if (mode === "WAIT" && bias === "DOWN" && Number.isFinite(opening.first15Low)) {
        return `Bias is DOWN, but price is still inside the first 15-minute range. Wait for PE below ${formatValue(opening.first15Low)}.`;
    }

    return "Signals are mixed. Stay in WAIT mode until the weighted score and price confirmation align.";
}

function buildNotes({ gapPercent, vixPrice, pcr, breadthRatio, fiiFlow, action, bias, trap, opening, score }) {
    const notes = [];

    notes.push(`Weighted score ${formatValue(score)} with bias ${bias}.`);
    notes.push(`GIFT gap ${Number.isFinite(gapPercent) ? `${formatValue(gapPercent)}%` : "Unavailable"}, VIX ${Number.isFinite(vixPrice) ? formatValue(vixPrice) : "Unavailable"}, PCR ${Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable"}.`);
    notes.push(`Breadth ratio ${breadthRatio === Number.POSITIVE_INFINITY ? "All advances" : (Number.isFinite(breadthRatio) ? formatValue(breadthRatio) : "Unavailable")}, FII flow ${Number.isFinite(fiiFlow) ? `Rs ${formatValue(fiiFlow)} Cr` : "Unavailable"}.`);

    if (action === "WAIT" && Number.isFinite(opening?.first15High) && Number.isFinite(opening?.first15Low)) {
        notes.push(`No trade until spot accepts above ${formatValue(opening.first15High)} or below ${formatValue(opening.first15Low)}.`);
    }

    if (trap.label !== "NONE") {
        notes.push(`${trap.label}: ${trap.detail}`);
    }

    return notes;
}

function buildDecisionEngine(context) {
    const selectedInstrument = context.traderProfile?.preferredInstrument || "NIFTY";
    const selectedInstrumentLabel = getInstrumentLabel(selectedInstrument);
    const selectedSpot = getSelectedSpot(context.india, selectedInstrument);
    const selectedIntraday = getSelectedIntraday(context.intraday, selectedInstrument);
    const selectedPrice = getCurrentPrice(selectedSpot, selectedIntraday);
    const openingRange = selectedIntraday?.openingRange || null;
    const chain = context.internals?.optionChains?.[selectedInstrument] || context.internals?.optionChain || null;
    const trend = detectTrendStructure(selectedIntraday?.series || []);
    const gapPercent = getGiftGapPercent(context, selectedSpot);
    const vixPrice = context.india?.indiaVix?.price ?? context.intraday?.instruments?.INDIA_VIX?.price ?? null;
    const pcr = chain?.putCallRatio ?? null;
    const breadthRatio = getBreadthRatio(context.internals?.breadth);
    const fiiFlow = getFiiNetFlow(context.internals);
    const giftSignal = normalizeGiftSignal(gapPercent);
    const vixSignal = normalizeVixSignal(vixPrice);
    const pcrSignal = normalizePcrSignal(pcr);
    const breadthSignal = normalizeBreadthSignal(breadthRatio);
    const flowSignal = normalizeFlowSignal(fiiFlow);
    const priceSignal = normalizePriceSignal(selectedPrice, openingRange);
    const weights = DECISION_CONFIG.institutionalModel.weights;
    const score = round(
        (giftSignal * weights.gift)
        + (vixSignal * weights.vix)
        + (pcrSignal * weights.pcr)
        + (breadthSignal * weights.breadth)
        + (flowSignal * weights.flows)
        + (priceSignal * weights.price),
        2
    );
    const bias = determineBias(score);
    const action = determineAction(score, priceSignal);
    const mode = buildMode(action);
    const confidence = buildConfidence(score);
    const trap = detectTrap(gapPercent, vixPrice, priceSignal);
    const opening = buildOpeningState(gapPercent, selectedPrice, openingRange, priceSignal);
    const noTradeZone = buildNoTradeZone({
        action,
        bias,
        score,
        priceSignal,
        opening,
        trap
    });
    const statusEngine = buildStatusEngine(action, context.activeTrade);
    const riskMeter = buildRiskMeter(vixPrice, trap, priceSignal, score);
    const suggestedStrikeStyle = determineSuggestedStrikeStyle(action, score, confidence, trend, trap);
    const headline = buildHeadline(statusEngine.status, action);
    const components = [
        buildComponent(
            "gift",
            "GIFT NIFTY Gap",
            giftSignal,
            weights.gift,
            Number.isFinite(gapPercent) ? `${formatValue(gapPercent)}%` : "Unavailable",
            Number.isFinite(gapPercent)
                ? `${gapPercent > 0 ? "Positive" : gapPercent < 0 ? "Negative" : "Flat"} opening indication from GIFT NIFTY vs prior NIFTY close.`
                : "GIFT NIFTY gap is unavailable."
        ),
        buildComponent(
            "vix",
            "INDIA VIX",
            vixSignal,
            weights.vix,
            Number.isFinite(vixPrice) ? formatValue(vixPrice) : "Unavailable",
            Number.isFinite(vixPrice)
                ? `Below ${DECISION_CONFIG.institutionalModel.vixBullishThreshold} is bullish, above ${DECISION_CONFIG.institutionalModel.vixBearishThreshold} is bearish.`
                : "India VIX is unavailable."
        ),
        buildComponent(
            "pcr",
            "PCR",
            pcrSignal,
            weights.pcr,
            Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable",
            Number.isFinite(pcr)
                ? `PCR uses Put OI / Call OI. Above ${DECISION_CONFIG.institutionalModel.pcrBearishThreshold} is bearish, below ${DECISION_CONFIG.institutionalModel.pcrBullishThreshold} is bullish in this model.`
                : "PCR is unavailable."
        ),
        buildComponent(
            "breadth",
            "Market Breadth",
            breadthSignal,
            weights.breadth,
            breadthRatio === Number.POSITIVE_INFINITY ? "All advances" : (Number.isFinite(breadthRatio) ? formatValue(breadthRatio) : "Unavailable"),
            "Breadth ratio is advancing stocks divided by declining stocks."
        ),
        buildComponent(
            "flows",
            "FII Flow",
            flowSignal,
            weights.flows,
            Number.isFinite(fiiFlow) ? `Rs ${formatValue(fiiFlow)} Cr` : "Unavailable",
            "Net positive FII flow supports calls; net negative flow supports puts."
        ),
        buildComponent(
            "price",
            "Price Action",
            priceSignal,
            weights.price,
            describePriceLocation(priceSignal, openingRange),
            opening.detail
        )
    ];

    return {
        status: statusEngine.status,
        mode,
        bias,
        action,
        direction: action === "WAIT" ? "WAIT" : action,
        headline,
        confidence,
        score,
        selectedInstrument,
        selectedInstrumentLabel,
        suggestedStrikeStyle,
        trap: trap.label,
        trapDetail: trap.detail,
        trapTone: trap.tone,
        summary: statusEngine.detail || buildSummary({
            status: statusEngine.status,
            mode,
            action,
            bias,
            trap,
            opening,
            selectedInstrumentLabel
        }),
        trend: {
            regime: trend.regime,
            badge: trend.badge,
            detail: trend.detail
        },
        opening,
        noTradeZone,
        entry: {
            CE_above: opening.first15High ?? null,
            PE_below: opening.first15Low ?? null
        },
        vwap: {
            proxyLabel: selectedIntraday?.proxy?.label || "Proxy",
            price: selectedIntraday?.proxy?.price ?? null,
            vwap: selectedIntraday?.proxy?.vwap ?? null,
            distancePercent: selectedIntraday?.proxy?.vwapDistancePercent ?? null,
            relativeVolume: selectedIntraday?.proxy?.relativeVolume ?? null
        },
        levels: {
            support: chain?.support?.strike ?? null,
            resistance: chain?.resistance?.strike ?? null,
            pcr,
            breadthRatio,
            fiiFlow
        },
        marketContext: {
            selectedPrice,
            selectedChangePercent: selectedSpot?.changePercent ?? selectedIntraday?.sessionChangePercent ?? null,
            first15High: opening.first15High ?? null,
            first15Low: opening.first15Low ?? null,
            priceSignal
        },
        scorecard: {
            giftGapPercent: gapPercent,
            giftSignal,
            vix: vixPrice,
            vixSignal,
            pcr,
            pcrSignal,
            breadthRatio,
            breadthSignal,
            fiiFlow,
            flowSignal,
            currentPrice: selectedPrice,
            priceSignal,
            first15MinHigh: opening.first15High ?? null,
            first15MinLow: opening.first15Low ?? null,
            weights
        },
        riskMeter,
        components,
        quick: {
            status: statusEngine.status,
            mode,
            direction: bias,
            optionType: action,
            conviction: confidence >= 70 ? "High" : confidence >= 40 ? "Medium" : "Low",
            trap: trap.label
        },
        notes: buildNotes({
            gapPercent,
            vixPrice,
            pcr,
            breadthRatio,
            fiiFlow,
            action,
            bias,
            trap,
            opening,
            score
        })
    };
}

module.exports = {
    buildDecisionEngine
};
