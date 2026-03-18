const { SIGNAL_CONFIG } = require("../config/sources");
const { clamp, formatValue, round } = require("../utils/formatters");

function scoreAgainstBands(value, bands) {
    if (!Number.isFinite(value)) {
        return {
            score: 0,
            interpretation: "Signal unavailable.",
            effect: "Neutral"
        };
    }

    for (const band of bands) {
        if (band.test(value)) {
            return band.output;
        }
    }

    return {
        score: 0,
        interpretation: "Signal unavailable.",
        effect: "Neutral"
    };
}

function buildComponent(parameter, valueText, output) {
    return {
        parameter,
        currentValue: valueText,
        interpretation: output.interpretation,
        score: output.score,
        effect: output.effect
    };
}

function scaleOutput(output, multiplier = 1) {
    if (!Number.isFinite(multiplier) || multiplier === 1) {
        return output;
    }

    return {
        ...output,
        score: Math.round(output.score * multiplier)
    };
}

function getSessionScoringProfile(sessionMode) {
    const normalized = String(sessionMode || "LIVE").toUpperCase();
    const isOvernightLens = normalized === "PREOPEN" || normalized === "POSTCLOSE" || normalized === "CLOSED";

    return {
        isOvernightLens,
        decisionWindow: isOvernightLens ? "for the next open" : "right now",
        multipliers: isOvernightLens
            ? {
                giftNifty: 1.35,
                niftyPriceAction: 0.2,
                indiaVix: 1,
                bankStrength: 0.35,
                breadth: 0.35,
                pcr: 0.65,
                fiiDii: 0.8,
                globalCues: 1.15,
                dxy: 1,
                us10y: 1,
                crude: 1,
                news: 1.1
            }
            : {
                giftNifty: 1,
                niftyPriceAction: 1,
                indiaVix: 1,
                bankStrength: 1,
                breadth: 1,
                pcr: 1,
                fiiDii: 1,
                globalCues: 1,
                dxy: 1,
                us10y: 1,
                crude: 1,
                news: 1
            }
    };
}

function classifySignal(score) {
    if (score >= 55) {
        return "Strong Bullish";
    }
    if (score >= 20) {
        return "Bullish";
    }
    if (score <= -55) {
        return "Strong Bearish";
    }
    if (score <= -20) {
        return "Bearish";
    }
    return "Sideways";
}

function buildQuickNotation(marketSignal, cePeBias, confidence) {
    const direction = marketSignal.includes("Bullish")
        ? "UP"
        : marketSignal.includes("Bearish")
            ? "DOWN"
            : "WAIT";
    const options = cePeBias === "CE bias"
        ? "CALLS"
        : cePeBias === "PE bias"
            ? "PUTS"
            : "WAIT";
    const conviction = confidence >= 75
        ? "HIGH"
        : confidence >= 55
            ? "MED"
            : "LOW";

    return {
        direction,
        options,
        conviction
    };
}

function calculateSignalScore(context) {
    const nifty = context.india.nifty;
    const bankNifty = context.india.bankNifty;
    const giftNifty = context.india.giftNifty;
    const indiaVix = context.india.indiaVix;
    const breadth = context.internals.breadth;
    const optionChain = context.internals.optionChain;
    const macro = context.macro;
    const news = context.news.aggregate;
    const global = context.global;
    const sessionProfile = getSessionScoringProfile(context.session?.mode);
    const multipliers = sessionProfile.multipliers;
    const fiiCombined = context.internals.fiiDii.combined || [];
    const indiaVixPrice = indiaVix?.price;
    const dxyPrice = macro.dxy?.price;
    const us10yPrice = macro.us10y?.price;
    const crudeChangePercent = macro.crude?.changePercent ?? 0;

    const giftGapPct = giftNifty?.price && nifty?.previousClose
        ? round(((giftNifty.price - nifty.previousClose) / nifty.previousClose) * 100, 2)
        : null;
    const niftyMovePct = nifty?.changePercent ?? null;
    const bankRelativeStrength = bankNifty?.changePercent !== null && niftyMovePct !== null
        ? round(bankNifty.changePercent - niftyMovePct, 2)
        : null;
    const breadthPct = breadth?.advances && (breadth.advances + (breadth.declines || 0))
        ? round((breadth.advances / (breadth.advances + breadth.declines)) * 100, 2)
        : null;
    const pcr = optionChain?.putCallRatio ?? null;
    const fiiNet = fiiCombined.find((entry) => entry.category === "FII/FPI")?.netValue;
    const diiNet = fiiCombined.find((entry) => entry.category === "DII")?.netValue;
    const hasFlowData = Number.isFinite(Number(fiiNet)) || Number.isFinite(Number(diiNet));
    const combinedFlow = hasFlowData ? Number(fiiNet || 0) + Number(diiNet || 0) : null;
    const globalCompositeValues = Object.values(global)
        .map((item) => item.changePercent)
        .filter((value) => Number.isFinite(value));
    const globalComposite = globalCompositeValues.length
        ? round(globalCompositeValues.reduce((sum, value) => sum + value, 0) / globalCompositeValues.length, 2)
        : null;

    const weights = SIGNAL_CONFIG.weights;
    const breakdown = [];

    const giftComponent = scaleOutput(scoreAgainstBands(giftGapPct, [
        { test: (value) => value >= 0.6, output: { score: weights.giftNifty, interpretation: "GIFT Nifty signals a firm positive opening setup.", effect: "Bullish" } },
        { test: (value) => value >= 0.2, output: { score: Math.round(weights.giftNifty * 0.65), interpretation: "GIFT Nifty is mildly positive versus NIFTY close.", effect: "Bullish" } },
        { test: (value) => value <= -0.6, output: { score: -weights.giftNifty, interpretation: "GIFT Nifty signals a weak or gap-down opening bias.", effect: "Bearish" } },
        { test: (value) => value <= -0.2, output: { score: -Math.round(weights.giftNifty * 0.65), interpretation: "GIFT Nifty is mildly negative versus NIFTY close.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "GIFT Nifty is near flat versus the NIFTY close.", effect: "Neutral" } }
    ]), multipliers.giftNifty);
    breakdown.push(buildComponent("GIFT Nifty Gap", giftGapPct !== null ? `${formatValue(giftGapPct)}%` : "Unavailable", giftComponent));

    const cashComponent = scaleOutput(scoreAgainstBands(niftyMovePct, [
        { test: (value) => value >= 1, output: { score: weights.niftyPriceAction, interpretation: "Cash index action confirms strong buying participation.", effect: "Bullish" } },
        { test: (value) => value >= 0.3, output: { score: Math.round(weights.niftyPriceAction * 0.5), interpretation: "Cash index action is positive but not impulsive.", effect: "Bullish" } },
        { test: (value) => value <= -1, output: { score: -weights.niftyPriceAction, interpretation: "Cash index action confirms downside pressure.", effect: "Bearish" } },
        { test: (value) => value <= -0.3, output: { score: -Math.round(weights.niftyPriceAction * 0.5), interpretation: "Cash index action is modestly weak.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Cash index action is balanced and non-directional.", effect: "Neutral" } }
    ]), multipliers.niftyPriceAction);
    breakdown.push(buildComponent("NIFTY Cash Action", niftyMovePct !== null ? `${formatValue(niftyMovePct)}%` : "Unavailable", cashComponent));

    const vixComponent = scaleOutput(scoreAgainstBands(indiaVixPrice, [
        { test: (value) => value <= 14, output: { score: Math.round(weights.indiaVix * 0.8), interpretation: "Low volatility is supportive for directional continuation.", effect: "Bullish" } },
        { test: (value) => value <= 18, output: { score: Math.round(weights.indiaVix * 0.35), interpretation: "Volatility is contained and manageable.", effect: "Bullish" } },
        { test: (value) => value >= 22, output: { score: -weights.indiaVix, interpretation: "High volatility raises whipsaw and gap risk.", effect: "Bearish" } },
        { test: (value) => value >= 19, output: { score: -Math.round(weights.indiaVix * 0.55), interpretation: "Volatility is elevated and warrants caution.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Volatility is in a middle regime with no clear edge.", effect: "Neutral" } }
    ]), multipliers.indiaVix);
    breakdown.push(buildComponent("INDIA VIX", Number.isFinite(indiaVixPrice) ? formatValue(indiaVixPrice) : "Unavailable", vixComponent));

    const bankComponent = scaleOutput(scoreAgainstBands(bankRelativeStrength, [
        { test: (value) => value >= 0.4, output: { score: weights.bankStrength, interpretation: "BANK NIFTY is outperforming and confirming risk appetite.", effect: "Bullish" } },
        { test: (value) => value >= 0.15, output: { score: Math.round(weights.bankStrength * 0.5), interpretation: "BANK NIFTY is modestly stronger than NIFTY.", effect: "Bullish" } },
        { test: (value) => value <= -0.4, output: { score: -weights.bankStrength, interpretation: "BANK NIFTY is lagging and weakening market leadership.", effect: "Bearish" } },
        { test: (value) => value <= -0.15, output: { score: -Math.round(weights.bankStrength * 0.5), interpretation: "BANK NIFTY is slightly weaker than NIFTY.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Banks are not providing a decisive leadership signal.", effect: "Neutral" } }
    ]), multipliers.bankStrength);
    breakdown.push(buildComponent("Bank Relative Strength", bankRelativeStrength !== null ? `${formatValue(bankRelativeStrength)}%` : "Unavailable", bankComponent));

    const breadthComponent = scaleOutput(scoreAgainstBands(breadthPct, [
        { test: (value) => value >= 65, output: { score: weights.breadth, interpretation: "Breadth is strong with broad-based participation.", effect: "Bullish" } },
        { test: (value) => value >= 55, output: { score: Math.round(weights.breadth * 0.5), interpretation: "Breadth is positive but not dominant.", effect: "Bullish" } },
        { test: (value) => value <= 35, output: { score: -weights.breadth, interpretation: "Breadth is weak and points to defensive participation.", effect: "Bearish" } },
        { test: (value) => value <= 45, output: { score: -Math.round(weights.breadth * 0.5), interpretation: "Breadth is slightly negative.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Breadth is balanced and does not add conviction.", effect: "Neutral" } }
    ]), multipliers.breadth);
    breakdown.push(buildComponent("Breadth", breadthPct !== null ? `${formatValue(breadthPct)}% advancers` : "Unavailable", breadthComponent));

    const pcrComponent = scaleOutput(scoreAgainstBands(pcr, [
        { test: (value) => value >= 0.95 && value <= 1.3, output: { score: weights.pcr, interpretation: "PCR sits in a constructive zone for balanced bullish positioning.", effect: "Bullish" } },
        { test: (value) => value >= 0.8 && value < 0.95, output: { score: -Math.round(weights.pcr * 0.55), interpretation: "Low PCR reflects heavier call positioning and caution.", effect: "Bearish" } },
        { test: (value) => value < 0.8, output: { score: -weights.pcr, interpretation: "PCR is weak and indicates a bearish options posture.", effect: "Bearish" } },
        { test: (value) => value > 1.3, output: { score: 0, interpretation: "PCR is elevated, which can indicate hedging rather than clean risk-on conviction.", effect: "Neutral" } },
        { test: () => true, output: { score: 0, interpretation: "PCR is neutral.", effect: "Neutral" } }
    ]), multipliers.pcr);
    breakdown.push(buildComponent("Put Call Ratio", pcr !== null ? formatValue(pcr) : "Unavailable", pcrComponent));

    const flowComponent = scaleOutput(scoreAgainstBands(combinedFlow, [
        { test: (value) => value >= 1500, output: { score: weights.fiiDii, interpretation: "Institutional flows are strongly net supportive.", effect: "Bullish" } },
        { test: (value) => value >= 300, output: { score: Math.round(weights.fiiDii * 0.5), interpretation: "Institutional flows have a mild positive bias.", effect: "Bullish" } },
        { test: (value) => value <= -1500, output: { score: -weights.fiiDii, interpretation: "Institutional flows are decisively risk-off.", effect: "Bearish" } },
        { test: (value) => value <= -300, output: { score: -Math.round(weights.fiiDii * 0.5), interpretation: "Institutional flows are mildly negative.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Institutional flows are mixed.", effect: "Neutral" } }
    ]), multipliers.fiiDii);
    breakdown.push(buildComponent("FII + DII Net", Number.isFinite(combinedFlow) ? `Rs ${formatValue(combinedFlow)} Cr` : "Unavailable", flowComponent));

    const globalComponent = scaleOutput(scoreAgainstBands(globalComposite, [
        { test: (value) => value >= 0.6, output: { score: weights.globalCues, interpretation: "Global futures and Asia are broadly supportive.", effect: "Bullish" } },
        { test: (value) => value >= 0.2, output: { score: Math.round(weights.globalCues * 0.55), interpretation: "Global cues are modestly positive.", effect: "Bullish" } },
        { test: (value) => value <= -0.6, output: { score: -weights.globalCues, interpretation: "Global cues are decisively risk-off.", effect: "Bearish" } },
        { test: (value) => value <= -0.2, output: { score: -Math.round(weights.globalCues * 0.55), interpretation: "Global cues are mildly negative.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Global cues are mixed.", effect: "Neutral" } }
    ]), multipliers.globalCues);
    breakdown.push(buildComponent("Global Cues", globalComposite !== null ? `${formatValue(globalComposite)}% avg` : "Unavailable", globalComponent));

    const dxyComponent = scaleOutput(scoreAgainstBands(dxyPrice, [
        { test: (value) => value <= 100, output: { score: weights.dxy, interpretation: "A softer dollar supports EM risk appetite.", effect: "Bullish" } },
        { test: (value) => value >= 105, output: { score: -weights.dxy, interpretation: "A strong dollar can pressure emerging market flows.", effect: "Bearish" } },
        { test: (value) => value >= 103, output: { score: -Math.round(weights.dxy * 0.6), interpretation: "Dollar strength is a moderate headwind.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Dollar index is not giving a strong edge.", effect: "Neutral" } }
    ]), multipliers.dxy);
    breakdown.push(buildComponent("DXY", Number.isFinite(dxyPrice) ? formatValue(dxyPrice) : "Unavailable", dxyComponent));

    const yieldComponent = scaleOutput(scoreAgainstBands(us10yPrice, [
        { test: (value) => value <= 3.7, output: { score: Math.round(weights.us10y * 0.55), interpretation: "Lower treasury yields are supportive for equities.", effect: "Bullish" } },
        { test: (value) => value >= 4.4, output: { score: -weights.us10y, interpretation: "High treasury yields tighten financial conditions.", effect: "Bearish" } },
        { test: (value) => value >= 4.1, output: { score: -Math.round(weights.us10y * 0.55), interpretation: "Yields are elevated enough to pressure multiples.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Treasury yields are in a middle range.", effect: "Neutral" } }
    ]), multipliers.us10y);
    breakdown.push(buildComponent("US 10Y Yield", Number.isFinite(us10yPrice) ? `${formatValue(us10yPrice)}%` : "Unavailable", yieldComponent));

    const crudeReference = macro.brent?.price ?? macro.crude?.price ?? null;
    const crudeComponent = scaleOutput(scoreAgainstBands(crudeReference, [
        { test: (value) => value <= 70, output: { score: Math.round(weights.crude * 0.55), interpretation: "Benign crude pricing helps inflation and import costs.", effect: "Bullish" } },
        { test: (value) => value >= 90, output: { score: -weights.crude, interpretation: "A crude spike is a macro headwind for India.", effect: "Bearish" } },
        { test: (value) => value >= 80, output: { score: -Math.round(weights.crude * 0.55), interpretation: "Crude is elevated and deserves caution.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Crude is not flashing an extreme macro signal.", effect: "Neutral" } }
    ]), multipliers.crude);
    breakdown.push(buildComponent("Crude / Brent", crudeReference !== null ? formatValue(crudeReference) : "Unavailable", crudeComponent));

    const newsComponent = scaleOutput(scoreAgainstBands(news.score, [
        { test: (value) => value >= 18, output: { score: weights.news, interpretation: "Headline flow is clearly supportive for risk appetite.", effect: "Bullish" } },
        { test: (value) => value >= 6, output: { score: Math.round(weights.news * 0.5), interpretation: "Headline flow leans constructive.", effect: "Bullish" } },
        { test: (value) => value <= -18, output: { score: -weights.news, interpretation: "Headline flow is clearly risk-off.", effect: "Bearish" } },
        { test: (value) => value <= -6, output: { score: -Math.round(weights.news * 0.5), interpretation: "Headline flow leans defensive.", effect: "Bearish" } },
        { test: () => true, output: { score: 0, interpretation: "Headline flow is mixed and non-directional.", effect: "Neutral" } }
    ]), multipliers.news);
    breakdown.push(buildComponent("News Sentiment", news.score !== null ? formatValue(news.score) : "Unavailable", newsComponent));

    const totalScore = breakdown.reduce((sum, component) => sum + component.score, 0);
    const normalizedScore = round((totalScore / SIGNAL_CONFIG.maxAbsoluteScore) * 100, 2);
    const openingBias = giftGapPct >= SIGNAL_CONFIG.openingGapPct.bullish
        ? "Gap Up"
        : giftGapPct <= SIGNAL_CONFIG.openingGapPct.bearish
            ? "Gap Down"
            : "Flat";
    const hasOvernightConflict = sessionProfile.isOvernightLens
        && ((openingBias === "Gap Down" && normalizedScore > 0 && normalizedScore < 55)
            || (openingBias === "Gap Up" && normalizedScore < 0 && normalizedScore > -55));
    const decisionScore = hasOvernightConflict
        ? round(openingBias === "Gap Down" ? Math.min(normalizedScore, 19) : Math.max(normalizedScore, -19), 2)
        : normalizedScore;
    const marketSignal = classifySignal(decisionScore);
    const availableComponents = breakdown.filter((item) => item.currentValue !== "Unavailable").length;
    const coverage = availableComponents / breakdown.length;
    const sameDirectionCount = breakdown.filter((item) => Math.sign(item.score) === Math.sign(totalScore) && item.score !== 0).length;
    const confidence = Math.round(clamp((coverage * 45) + ((Math.abs(decisionScore) / 100) * 35) + ((sameDirectionCount / breakdown.length) * 20), 18, 96));
    const effectiveConfidence = hasOvernightConflict ? Math.min(confidence, 54) : confidence;

    const intradayBias = normalizedScore >= 20
        ? "Trend Up"
        : normalizedScore <= -20
            ? "Trend Down"
            : "Sideways";
    const overnightBullishVeto = sessionProfile.isOvernightLens && openingBias === "Gap Down";
    const overnightBearishVeto = sessionProfile.isOvernightLens && openingBias === "Gap Up";

    const cePeBias = marketSignal.includes("Bullish") && effectiveConfidence >= 55 && (indiaVixPrice || 0) < 22 && !overnightBullishVeto
        ? "CE bias"
        : marketSignal.includes("Bearish") && effectiveConfidence >= 55 && (indiaVixPrice || 0) < 22 && !overnightBearishVeto
            ? "PE bias"
            : "No trade";

    const riskFlags = [];
    if ((indiaVixPrice || 0) >= 22) {
        riskFlags.push({ label: "High VIX warning", detail: `INDIA VIX at ${formatValue(indiaVixPrice)} is elevated and can amplify whipsaws.`, severity: "high" });
    }
    if ((macro.brent?.price || 0) >= 90 || crudeChangePercent >= 2) {
        riskFlags.push({ label: "Crude spike warning", detail: "Energy prices are elevated and can pressure inflation-sensitive sectors.", severity: "medium" });
    }
    if ((us10yPrice || 0) >= 4.4) {
        riskFlags.push({ label: "Yield spike warning", detail: "US 10Y yields are elevated, which can compress equity risk appetite.", severity: "medium" });
    }
    if ((news.highImpactCount || 0) > 0 && news.score < 0) {
        riskFlags.push({ label: "Risk-off alert", detail: "Negative high-impact headlines are active in the news flow.", severity: "high" });
    }
    if (!riskFlags.length) {
        riskFlags.push({ label: "Risk panel", detail: "No extreme macro or volatility warning is dominating right now.", severity: "low" });
    }

    const strategy = {
        ceConditions: [
            `Prefer calls when ${openingBias === "Gap Up" ? "overnight cues remain supportive" : "post-open confirmation improves"} and BANK NIFTY stays stronger than NIFTY.`,
            "Look for breadth above 55% advancers with PCR staying above 0.95.",
            "Favor CE setups only when INDIA VIX remains controlled and high-impact news does not flip risk-off."
        ],
        peConditions: [
            `Prefer puts when ${openingBias === "Gap Down" ? "weak overnight cues persist" : "cash market breaks lower after the open"} and BANK NIFTY lags.`,
            "Look for weak breadth, lower PCR, and negative institutional or global signals.",
            "Favor PE setups when yields, DXY, or crude are pressuring risk assets."
        ],
        noTradeConditions: [
            "Avoid forcing trades when the total score stays near neutral or sources are degraded.",
            "Stand aside when high-impact macro headlines are active and volatility is elevated.",
            "No-trade remains the default if CE/PE bias and confidence do not align."
        ],
        volatilityWarning: (indiaVixPrice || 0) >= 22
            ? "Volatility is high. Reduce size, widen stops, or skip the trade."
            : "Volatility is manageable, but still require price confirmation before execution.",
        first15MinuteRule: "Wait for the first 15 minutes after the cash open to confirm whether the opening gap is accepting or fading."
    };

    const topDrivers = breakdown
        .filter((item) => Number.isFinite(item.score) && item.score !== 0)
        .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
        .slice(0, 3)
        .map((item) => item.parameter);
    const quick = buildQuickNotation(marketSignal, cePeBias, effectiveConfidence);

    const summary = {
        plainEnglish: marketSignal === "Strong Bullish" || marketSignal === "Bullish"
            ? `The dashboard sees more positive signals than negative ones ${sessionProfile.decisionWindow}.`
            : marketSignal === "Strong Bearish" || marketSignal === "Bearish"
                ? `The dashboard sees more negative signals than positive ones ${sessionProfile.decisionWindow}.`
                : `The dashboard sees mixed signals, so direction is not clean ${sessionProfile.decisionWindow}.`,
        whyItLooksThisWay: topDrivers.length
            ? `Biggest drivers: ${topDrivers.join(", ")}.`
            : "No dominant driver is available yet.",
        tradePosture: sessionProfile.isOvernightLens
            ? (cePeBias === "CE bias"
                ? "Calls stay on watch only if overnight strength survives the next open and the first 15 minutes confirm."
                : cePeBias === "PE bias"
                    ? "Puts stay on watch only if overnight weakness carries into the next open and the first 15 minutes confirm."
                    : "No-trade is preferred until the next session opens and the live signals align more clearly.")
            : (cePeBias === "CE bias"
                ? "Calls are favored only if the opening move confirms after the first 15 minutes."
                : cePeBias === "PE bias"
                    ? "Puts are favored only if weakness confirms after the first 15 minutes."
                    : "No-trade is preferred until the live signals align more clearly.")
    };

    return {
        score: decisionScore,
        marketSignal,
        confidence: effectiveConfidence,
        cePeBias,
        openingBias,
        intradayBias,
        quick,
        breakdown,
        summary,
        strategy,
        risks: riskFlags
    };
}

module.exports = {
    calculateSignalScore
};
