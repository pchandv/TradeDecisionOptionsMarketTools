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

module.exports = {
    fetchInvestingIdeas
};
