const { clamp, round } = require("../utils/formatters");

const POSITIVE_PATTERNS = [
    /rate cut/i,
    /easing/i,
    /inflation cool/i,
    /disinflation/i,
    /beats? estimates/i,
    /record high/i,
    /surge/i,
    /strong earnings/i,
    /stimulus/i,
    /liquidity/i,
    /inflows?/i,
    /ceasefire/i,
    /de-escalat/i,
    /rebound/i,
    /upgrade/i
];

const NEGATIVE_PATTERNS = [
    /hawkish/i,
    /rate hike/i,
    /inflation (?:up|hot|sticky|rises?)/i,
    /yields? (?:rise|jump|surge|spike)/i,
    /crude (?:up|higher|jump|spike|surge)/i,
    /brent (?:up|higher|jump|spike|surge)/i,
    /war/i,
    /attack/i,
    /tariffs?/i,
    /sanctions?/i,
    /slump/i,
    /sell[- ]off/i,
    /miss(es|ed)? estimates/i,
    /downgrade/i,
    /outflows?/i,
    /volatility/i,
    /risk[- ]off/i,
    /default/i
];

const HIGH_IMPACT_PATTERNS = [
    /fed/i,
    /fomc/i,
    /rbi/i,
    /cpi/i,
    /ppi/i,
    /inflation/i,
    /treasury/i,
    /yield/i,
    /crude/i,
    /brent/i,
    /war/i,
    /tariff/i,
    /geopolit/i,
    /jobs/i,
    /payroll/i,
    /gdp/i,
    /rate/i
];

function inferEffect(sentiment, title, category) {
    if (/rbi|nifty|sensex|bank nifty/i.test(title) || category === "india") {
        if (sentiment === "Bullish") {
            return "Supportive for Indian equities, banks, and opening sentiment.";
        }
        if (sentiment === "Bearish") {
            return "Adds pressure to Indian index sentiment and options risk appetite.";
        }
        return "Mixed India-specific read with limited directional conviction.";
    }

    if (/fed|nasdaq|s&p|dow|wall street/i.test(title) || category === "us") {
        if (sentiment === "Bullish") {
            return "Constructive for overnight global cues and risk appetite.";
        }
        if (sentiment === "Bearish") {
            return "Could weigh on overnight futures and India opening bias.";
        }
        return "US cue looks mixed and may not give a clean directional handoff.";
    }

    if (sentiment === "Bullish") {
        return "Macro backdrop tilts risk-on for equities.";
    }
    if (sentiment === "Bearish") {
        return "Macro backdrop leans risk-off for equities and high beta names.";
    }
    return "Macro headlines are mixed with no dominant directional impulse.";
}

function scoreHeadline(item, category) {
    const title = item.title || "";
    let rawScore = 0;

    POSITIVE_PATTERNS.forEach((pattern) => {
        if (pattern.test(title)) {
            rawScore += 1;
        }
    });

    NEGATIVE_PATTERNS.forEach((pattern) => {
        if (pattern.test(title)) {
            rawScore -= 1;
        }
    });

    const impactHits = HIGH_IMPACT_PATTERNS.filter((pattern) => pattern.test(title)).length;
    const impact = impactHits >= 2 || Math.abs(rawScore) >= 2
        ? "High impact / risk event"
        : impactHits === 1 || rawScore !== 0
            ? "Medium impact"
            : "Low impact";

    const sentiment = rawScore >= 1
        ? "Bullish"
        : rawScore <= -1
            ? "Bearish"
            : "Neutral";

    const publishedTime = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
    const ageHours = publishedTime ? Math.max(0, (Date.now() - publishedTime) / 3600000) : 24;
    const recencyMultiplier = clamp(1.3 - (ageHours * 0.05), 0.5, 1.25);
    const impactMultiplier = impact === "High impact / risk event" ? 1.8 : impact === "Medium impact" ? 1.2 : 0.7;
    const weightedScore = round(clamp(rawScore * recencyMultiplier * impactMultiplier * 8, -22, 22), 2);

    return {
        ...item,
        category,
        sentiment,
        impact,
        likelyMarketEffect: inferEffect(sentiment, title, category),
        score: weightedScore
    };
}

function aggregateNewsCategory(items) {
    const scoredItems = items.map((item) => scoreHeadline(item, item.category));
    const totalScore = round(scoredItems.reduce((sum, item) => sum + (item.score || 0), 0), 2);
    const averageScore = round(scoredItems.length ? totalScore / scoredItems.length : 0, 2);

    return {
        items: scoredItems,
        totalScore,
        averageScore,
        bullishCount: scoredItems.filter((item) => item.sentiment === "Bullish").length,
        bearishCount: scoredItems.filter((item) => item.sentiment === "Bearish").length,
        highImpactCount: scoredItems.filter((item) => item.impact === "High impact / risk event").length
    };
}

function summarizeNewsEffect(categoryResults) {
    const combinedItems = Object.values(categoryResults).flatMap((bucket) => bucket.items);
    const total = combinedItems.reduce((sum, item) => sum + (item.score || 0), 0);
    const normalized = round(clamp(total, -100, 100), 2);
    const stance = normalized >= 18
        ? "Bullish"
        : normalized <= -18
            ? "Bearish"
            : "Neutral";

    const topPositive = combinedItems
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 2)
        .map((item) => item.title);

    const topNegative = combinedItems
        .filter((item) => item.score < 0)
        .sort((left, right) => left.score - right.score)
        .slice(0, 2)
        .map((item) => item.title);

    let summary = "Headlines are mixed and do not yet establish a dominant market narrative.";
    if (stance === "Bullish") {
        summary = topPositive.length
            ? `Supportive headlines are dominating, led by: ${topPositive.join(" | ")}`
            : "Headline flow is modestly supportive for risk appetite.";
    } else if (stance === "Bearish") {
        summary = topNegative.length
            ? `Risk-off headlines are dominating, led by: ${topNegative.join(" | ")}`
            : "Headline flow is leaning defensive and could cap upside risk appetite.";
    }

    return {
        score: normalized,
        stance,
        summary,
        highImpactCount: combinedItems.filter((item) => item.impact === "High impact / risk event").length
    };
}

function processNewsSentiment(newsBuckets) {
    const categoryResults = {
        india: aggregateNewsCategory(newsBuckets.india || []),
        us: aggregateNewsCategory(newsBuckets.us || []),
        macro: aggregateNewsCategory(newsBuckets.macro || [])
    };

    return {
        categories: categoryResults,
        aggregate: summarizeNewsEffect(categoryResults)
    };
}

module.exports = {
    processNewsSentiment
};
