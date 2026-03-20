const { INVESTING_UNIVERSE } = require("../config/sources");
const { fetchAlphaVantageFundamentals } = require("./alphaVantageService");
const { fetchNseEquityQuotes } = require("./nseService");
const { buildInvestingIdeas } = require("../engine/investmentEngine");
const { getBuildInfo } = require("../config/buildInfo");

async function fetchInvestingIdeas() {
    const [equityQuotes, fundamentals] = await Promise.all([
        fetchNseEquityQuotes(INVESTING_UNIVERSE.map((item) => item.symbol)),
        fetchAlphaVantageFundamentals(INVESTING_UNIVERSE)
    ]);

    return {
        investing: buildInvestingIdeas(equityQuotes.quotes, {
            fundamentalsBySymbol: fundamentals.bySymbol
        }),
        sourceStatuses: [
            equityQuotes.sourceStatus,
            fundamentals.sourceStatus
        ]
    };
}

async function buildInvestingPayload() {
    const result = await fetchInvestingIdeas();
    const buildInfo = getBuildInfo();
    return {
        generatedAt: new Date().toISOString(),
        investing: result.investing,
        sourceStatuses: result.sourceStatuses,
        metadata: {
            version: buildInfo.version,
            builtAt: buildInfo.builtAt,
            buildSource: buildInfo.source,
            mode: "server-assisted",
            strategyMode: result.investing.strategyMode
        }
    };
}

module.exports = {
    buildInvestingPayload,
    fetchInvestingIdeas
};
