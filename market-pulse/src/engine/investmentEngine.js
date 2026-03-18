const { round } = require("../utils/formatters");

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function buildInvestingIdeas(quotes = []) {
    const candidates = quotes
        .filter((quote) => quote && Number.isFinite(quote.price))
        .map((quote) => {
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

            let score = 35;
            const reasons = [];
            const cautions = [];

            if (Number.isFinite(discountToSectorPe)) {
                if (discountToSectorPe >= 20) {
                    score += 25;
                    reasons.push("Live PE is materially below the sector PE.");
                } else if (discountToSectorPe >= 5) {
                    score += 15;
                    reasons.push("Live PE is below the sector PE.");
                } else if (discountToSectorPe >= -5) {
                    score += 5;
                    reasons.push("Live PE is close to the sector PE.");
                } else if (discountToSectorPe >= -20) {
                    score -= 10;
                    cautions.push("Live PE is above the sector PE.");
                } else {
                    score -= 18;
                    cautions.push("Live PE is far above the sector PE.");
                }
            } else {
                cautions.push("Live PE comparison is unavailable.");
            }

            if (Number.isFinite(drawdownFrom52WeekHigh)) {
                if (drawdownFrom52WeekHigh >= 20) {
                    score += 18;
                    reasons.push("Price is meaningfully below the 52-week high.");
                } else if (drawdownFrom52WeekHigh >= 10) {
                    score += 10;
                    reasons.push("Price is below the 52-week high without being stretched.");
                } else if (drawdownFrom52WeekHigh <= 3) {
                    score -= 8;
                    cautions.push("Price is still close to the 52-week high.");
                }
            }

            if (Number.isFinite(liftFrom52WeekLow)) {
                if (liftFrom52WeekLow <= 15) {
                    score += 10;
                    reasons.push("Price is still near the lower part of the yearly range.");
                } else if (liftFrom52WeekLow >= 45) {
                    score -= 5;
                    cautions.push("Price has already moved far from the 52-week low.");
                }
            }

            if (Number.isFinite(quote.changePercent)) {
                if (quote.changePercent <= -3) {
                    cautions.push("The stock is under notable short-term selling pressure today.");
                } else if (quote.changePercent >= 3) {
                    cautions.push("The stock is already moving strongly today, so chasing can raise entry risk.");
                }
            }

            score = clamp(Math.round(score), 0, 100);

            const verdict = score >= 70
                ? "Best Value Watch"
                : score >= 55
                    ? "Watch Closely"
                    : score >= 40
                        ? "Keep On Radar"
                        : "Not Compelling Today";

            return {
                ...quote,
                score,
                verdict,
                discountToSectorPe,
                drawdownFrom52WeekHigh,
                liftFrom52WeekLow,
                reasons,
                cautions
            };
        })
        .sort((left, right) => right.score - left.score);

    return {
        available: candidates.length > 0,
        title: "Investing Watchlist Beta",
        summary: "This module ranks a curated large-cap watchlist using free live NSE valuation context and price location within the 52-week range.",
        dataTier: "Free NSE quote data",
        limitations: [
            "Free NSE data gives price, sector PE comparison, and 52-week range, but not deep balance-sheet or cash-flow metrics.",
            "Treat this as a value watchlist, not a complete long-term investing engine yet.",
            "For true fundamental strength scoring, add a keyed provider later for ROE, debt, growth, and free cash flow."
        ],
        candidates: candidates.slice(0, 6)
    };
}

module.exports = {
    buildInvestingIdeas
};
