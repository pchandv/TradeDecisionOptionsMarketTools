const { INVESTING_UNIVERSE } = require("../config/sources");
const { fetchNseEquityQuotes } = require("./nseService");
const { buildInvestingIdeas } = require("../engine/investmentEngine");

async function fetchInvestingIdeas() {
    const equityQuotes = await fetchNseEquityQuotes(INVESTING_UNIVERSE.map((item) => item.symbol));
    return {
        investing: buildInvestingIdeas(equityQuotes.quotes),
        sourceStatus: equityQuotes.sourceStatus
    };
}

async function buildInvestingPayload() {
    const result = await fetchInvestingIdeas();
    return {
        generatedAt: new Date().toISOString(),
        investing: result.investing,
        sourceStatuses: [result.sourceStatus],
        metadata: {
            version: "investing-beta-1.0.0",
            mode: "server-assisted"
        }
    };
}

module.exports = {
    buildInvestingPayload,
    fetchInvestingIdeas
};
