const { round } = require("../utils/formatters");

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function pushUnique(list, message) {
    if (message && !list.includes(message)) {
        list.push(message);
    }
}

function buildScoreBand(score, bands) {
    const bucket = bands.find((item) => score >= item.min);
    return bucket ? bucket.label : bands[bands.length - 1].label;
}

function buildNseDerivedMetrics(quote) {
    const symbolPe = toNumber(quote.symbolPe);
    const sectorPe = toNumber(quote.sectorPe);
    const discountToSectorPe = Number.isFinite(symbolPe) && Number.isFinite(sectorPe) && sectorPe > 0
        ? round(((sectorPe - symbolPe) / sectorPe) * 100, 2)
        : null;
    const drawdownFrom52WeekHigh = Number.isFinite(quote.weekHigh) && quote.weekHigh > 0
        ? round(((quote.weekHigh - quote.price) / quote.weekHigh) * 100, 2)
        : null;
    const liftFrom52WeekLow = Number.isFinite(quote.weekLow) && quote.weekLow > 0
        ? round(((quote.price - quote.weekLow) / quote.weekLow) * 100, 2)
        : null;

    return {
        discountToSectorPe,
        drawdownFrom52WeekHigh,
        liftFrom52WeekLow
    };
}

function buildFundamentalCoverage(fundamentals) {
    const trackedMetrics = [
        fundamentals?.returnOnEquityTTM,
        fundamentals?.operatingMarginTTM,
        fundamentals?.profitMargin,
        fundamentals?.quarterlyRevenueGrowthYOY,
        fundamentals?.quarterlyEarningsGrowthYOY,
        fundamentals?.priceToBookRatio,
        fundamentals?.analystTargetPrice
    ];

    return trackedMetrics.filter((value) => Number.isFinite(value)).length;
}

function scoreFundamentals(quote, fundamentals, derivedMetrics) {
    const reasons = [];
    const cautions = [];

    let qualityScore = 50;
    let growthScore = 50;
    let valuationScore = 50;
    let opportunityScore = 50;

    const roe = toNumber(fundamentals?.returnOnEquityTTM);
    const operatingMargin = toNumber(fundamentals?.operatingMarginTTM);
    const profitMargin = toNumber(fundamentals?.profitMargin);
    const revenueGrowth = toNumber(fundamentals?.quarterlyRevenueGrowthYOY);
    const earningsGrowth = toNumber(fundamentals?.quarterlyEarningsGrowthYOY);
    const priceToBookRatio = toNumber(fundamentals?.priceToBookRatio);
    const analystTargetPrice = toNumber(fundamentals?.analystTargetPrice);
    const targetUpsidePercent = Number.isFinite(analystTargetPrice) && Number.isFinite(quote.price) && quote.price > 0
        ? round(((analystTargetPrice - quote.price) / quote.price) * 100, 2)
        : null;

    if (Number.isFinite(roe)) {
        if (roe >= 18) {
            qualityScore += 22;
            pushUnique(reasons, "Return on equity is strong for a long-term compounder screen.");
        } else if (roe >= 14) {
            qualityScore += 14;
            pushUnique(reasons, "Return on equity is healthy.");
        } else if (roe < 10) {
            qualityScore -= 14;
            pushUnique(cautions, "Return on equity is not yet comfortably strong.");
        }
    } else {
        pushUnique(cautions, "Return on equity is unavailable in the current fundamentals feed.");
    }

    if (Number.isFinite(profitMargin)) {
        if (profitMargin >= 15) {
            qualityScore += 14;
            pushUnique(reasons, "Profit margin is comfortably above average compounder thresholds.");
        } else if (profitMargin >= 8) {
            qualityScore += 7;
            pushUnique(reasons, "Profit margin is respectable.");
        } else if (profitMargin < 5) {
            qualityScore -= 10;
            pushUnique(cautions, "Profit margin is on the thinner side.");
        }
    }

    if (Number.isFinite(operatingMargin)) {
        if (operatingMargin >= 18) {
            qualityScore += 12;
            pushUnique(reasons, "Operating margin supports durable business quality.");
        } else if (operatingMargin >= 10) {
            qualityScore += 6;
        } else if (operatingMargin < 8) {
            qualityScore -= 8;
            pushUnique(cautions, "Operating margin leaves less room for execution mistakes.");
        }
    }

    if (Number.isFinite(revenueGrowth)) {
        if (revenueGrowth >= 12) {
            growthScore += 18;
            pushUnique(reasons, "Revenue growth remains healthy.");
        } else if (revenueGrowth >= 5) {
            growthScore += 10;
        } else if (revenueGrowth < 0) {
            growthScore -= 16;
            pushUnique(cautions, "Revenue growth is negative right now.");
        }
    } else {
        pushUnique(cautions, "Revenue growth data is unavailable.");
    }

    if (Number.isFinite(earningsGrowth)) {
        if (earningsGrowth >= 12) {
            growthScore += 20;
            pushUnique(reasons, "Earnings growth is supportive of a compounding thesis.");
        } else if (earningsGrowth >= 5) {
            growthScore += 10;
        } else if (earningsGrowth < 0) {
            growthScore -= 18;
            pushUnique(cautions, "Earnings growth is negative right now.");
        }
    } else {
        pushUnique(cautions, "Earnings growth data is unavailable.");
    }

    if (Number.isFinite(derivedMetrics.discountToSectorPe)) {
        if (derivedMetrics.discountToSectorPe >= 20) {
            valuationScore += 18;
            pushUnique(reasons, "Live PE is materially below the sector PE.");
        } else if (derivedMetrics.discountToSectorPe >= 5) {
            valuationScore += 10;
            pushUnique(reasons, "Live PE is below the sector PE.");
        } else if (derivedMetrics.discountToSectorPe <= -20) {
            valuationScore -= 14;
            pushUnique(cautions, "Live PE is materially above the sector PE.");
        }
    } else {
        pushUnique(cautions, "Sector PE comparison is unavailable.");
    }

    if (Number.isFinite(priceToBookRatio)) {
        if (priceToBookRatio <= 4) {
            valuationScore += 10;
        } else if (priceToBookRatio <= 8) {
            valuationScore += 5;
        } else if (priceToBookRatio > 12) {
            valuationScore -= 8;
            pushUnique(cautions, "Price to book is already quite rich.");
        }
    }

    if (Number.isFinite(targetUpsidePercent)) {
        if (targetUpsidePercent >= 15) {
            valuationScore += 10;
            pushUnique(reasons, "Analyst target still implies decent upside from the current price.");
        } else if (targetUpsidePercent < 0) {
            valuationScore -= 8;
            pushUnique(cautions, "Analyst target is below the current market price.");
        }
    }

    if (Number.isFinite(derivedMetrics.drawdownFrom52WeekHigh)) {
        if (derivedMetrics.drawdownFrom52WeekHigh >= 12 && derivedMetrics.drawdownFrom52WeekHigh <= 30) {
            opportunityScore += 16;
            pushUnique(reasons, "Price is below the 52-week high without looking broken.");
        } else if (derivedMetrics.drawdownFrom52WeekHigh <= 3) {
            opportunityScore -= 8;
            pushUnique(cautions, "Price is still very close to the 52-week high.");
        } else if (derivedMetrics.drawdownFrom52WeekHigh > 35) {
            opportunityScore -= 6;
            pushUnique(cautions, "Price is deeply below the 52-week high, so the business story needs closer review.");
        }
    }

    if (Number.isFinite(derivedMetrics.liftFrom52WeekLow)) {
        if (derivedMetrics.liftFrom52WeekLow <= 25) {
            opportunityScore += 8;
            pushUnique(reasons, "Price is still near the lower part of the annual range.");
        } else if (derivedMetrics.liftFrom52WeekLow >= 60) {
            opportunityScore -= 6;
            pushUnique(cautions, "Price has already traveled well above the 52-week low.");
        }
    }

    if (Number.isFinite(quote.changePercent) && Math.abs(quote.changePercent) >= 3) {
        opportunityScore -= 4;
        pushUnique(cautions, "The stock is moving sharply today, which can increase entry risk.");
    }

    qualityScore = clamp(Math.round(qualityScore), 0, 100);
    growthScore = clamp(Math.round(growthScore), 0, 100);
    valuationScore = clamp(Math.round(valuationScore), 0, 100);
    opportunityScore = clamp(Math.round(opportunityScore), 0, 100);

    const score = Math.round(
        (qualityScore * 0.35)
        + (growthScore * 0.25)
        + (valuationScore * 0.25)
        + (opportunityScore * 0.15)
    );

    return {
        score: clamp(score, 0, 100),
        qualityScore,
        growthScore,
        valuationScore,
        opportunityScore,
        targetUpsidePercent,
        reasons,
        cautions
    };
}

function scoreFallback(quote, derivedMetrics) {
    const reasons = [];
    const cautions = [];
    let score = 35;

    if (Number.isFinite(derivedMetrics.discountToSectorPe)) {
        if (derivedMetrics.discountToSectorPe >= 20) {
            score += 25;
            pushUnique(reasons, "Live PE is materially below the sector PE.");
        } else if (derivedMetrics.discountToSectorPe >= 5) {
            score += 15;
            pushUnique(reasons, "Live PE is below the sector PE.");
        } else if (derivedMetrics.discountToSectorPe >= -5) {
            score += 5;
        } else if (derivedMetrics.discountToSectorPe >= -20) {
            score -= 10;
            pushUnique(cautions, "Live PE is above the sector PE.");
        } else {
            score -= 18;
            pushUnique(cautions, "Live PE is far above the sector PE.");
        }
    } else {
        pushUnique(cautions, "Live PE comparison is unavailable.");
    }

    if (Number.isFinite(derivedMetrics.drawdownFrom52WeekHigh)) {
        if (derivedMetrics.drawdownFrom52WeekHigh >= 20) {
            score += 18;
            pushUnique(reasons, "Price is meaningfully below the 52-week high.");
        } else if (derivedMetrics.drawdownFrom52WeekHigh >= 10) {
            score += 10;
            pushUnique(reasons, "Price is below the 52-week high without being stretched.");
        } else if (derivedMetrics.drawdownFrom52WeekHigh <= 3) {
            score -= 8;
            pushUnique(cautions, "Price is still close to the 52-week high.");
        }
    }

    if (Number.isFinite(derivedMetrics.liftFrom52WeekLow)) {
        if (derivedMetrics.liftFrom52WeekLow <= 15) {
            score += 10;
            pushUnique(reasons, "Price is still near the lower part of the yearly range.");
        } else if (derivedMetrics.liftFrom52WeekLow >= 45) {
            score -= 5;
            pushUnique(cautions, "Price has already moved far from the 52-week low.");
        }
    }

    if (Number.isFinite(quote.changePercent)) {
        if (quote.changePercent <= -3) {
            pushUnique(cautions, "The stock is under notable short-term selling pressure today.");
        } else if (quote.changePercent >= 3) {
            pushUnique(cautions, "The stock is already moving strongly today, so chasing can raise entry risk.");
        }
    }

    return {
        score: clamp(Math.round(score), 0, 100),
        qualityScore: null,
        growthScore: null,
        valuationScore: clamp(Math.round(score + 8), 0, 100),
        opportunityScore: clamp(Math.round(score), 0, 100),
        targetUpsidePercent: null,
        reasons,
        cautions
    };
}

function buildCandidate(quote, fundamentals) {
    const derivedMetrics = buildNseDerivedMetrics(quote);
    const fundamentalCoverage = buildFundamentalCoverage(fundamentals);
    const hasFundamentals = fundamentalCoverage >= 4;
    const scored = hasFundamentals
        ? scoreFundamentals(quote, fundamentals, derivedMetrics)
        : scoreFallback(quote, derivedMetrics);

    const score = clamp(scored.score, 0, 100);
    const verdict = hasFundamentals
        ? buildScoreBand(score, [
            { min: 78, label: "Strong Compounder Watch" },
            { min: 65, label: "Research Priority" },
            { min: 52, label: "Keep On Watchlist" },
            { min: 0, label: "Wait For Better Setup" }
        ])
        : buildScoreBand(score, [
            { min: 70, label: "Value Watch Only" },
            { min: 55, label: "Watch Closely" },
            { min: 40, label: "Keep On Radar" },
            { min: 0, label: "Not Compelling Today" }
        ]);

    return {
        ...quote,
        fundamentals: fundamentals || null,
        score,
        verdict,
        analysisMode: hasFundamentals ? "fundamentals-enriched" : "nse-valuation-fallback",
        fundamentalCoverage,
        discountToSectorPe: derivedMetrics.discountToSectorPe,
        drawdownFrom52WeekHigh: derivedMetrics.drawdownFrom52WeekHigh,
        liftFrom52WeekLow: derivedMetrics.liftFrom52WeekLow,
        targetUpsidePercent: scored.targetUpsidePercent,
        scoreBreakdown: {
            quality: scored.qualityScore,
            growth: scored.growthScore,
            valuation: scored.valuationScore,
            opportunity: scored.opportunityScore
        },
        reasons: scored.reasons,
        cautions: scored.cautions
    };
}

function buildInvestingIdeas(quotes = [], options = {}) {
    const fundamentalsBySymbol = options.fundamentalsBySymbol || {};

    const candidates = quotes
        .filter((quote) => quote && Number.isFinite(quote.price))
        .map((quote) => buildCandidate(quote, fundamentalsBySymbol[quote.symbol] || null))
        .sort((left, right) => right.score - left.score);

    const enrichedCount = candidates.filter((item) => item.analysisMode === "fundamentals-enriched").length;
    const topCandidates = candidates.slice(0, 6);
    const summary = enrichedCount
        ? "This page blends live NSE quote context with optional Alpha Vantage fundamentals to rank watchlist ideas for long-term compounder research."
        : "This page is currently running in NSE-only fallback mode, so it ranks valuation context and annual price position but not deep business quality yet.";

    return {
        available: candidates.length > 0,
        title: enrichedCount ? "Investment Ideas For Fundamentally Strong Compounders" : "Long-Term Compounder Watchlist Beta",
        summary,
        strategyMode: enrichedCount ? "fundamentals-enriched" : "nse-valuation-fallback",
        methodologyBadge: enrichedCount ? "Fundamentals Enriched" : "NSE Valuation Fallback",
        dataTier: enrichedCount ? "NSE live quotes + Alpha Vantage overview metrics" : "Free NSE quote data",
        qualityCoverage: {
            enrichedCount,
            totalUniverseCount: candidates.length
        },
        criteria: enrichedCount
            ? [
                "Quality: ROE, operating margin, and profit margin",
                "Growth: quarterly revenue and earnings growth",
                "Valuation: stock PE vs sector PE, price to book, and analyst target gap",
                "Opportunity: distance from the 52-week high and low"
            ]
            : [
                "Valuation context from stock PE versus sector PE",
                "Opportunity context from 52-week high and low distance",
                "Short-term entry caution from large one-day price moves"
            ],
        limitations: enrichedCount
            ? [
                "This is still a shortlist engine, not a broker recommendation or a complete valuation model.",
                "Alpha Vantage overview data is useful, but it is not a full annual-report-grade financial statement engine.",
                "Deeper debt, cash-flow, capital-allocation, and governance checks should still be reviewed manually."
            ]
            : [
                "The fundamentals provider is not configured or did not return enough coverage, so this page is using the lighter NSE-only model.",
                "Free NSE data gives price, sector PE comparison, and 52-week range, but not deep balance-sheet or cash-flow metrics.",
                "Add ALPHA_VANTAGE_API_KEY to upgrade this page toward a true compounder screener."
            ],
        candidates: topCandidates
    };
}

module.exports = {
    buildInvestingIdeas
};
