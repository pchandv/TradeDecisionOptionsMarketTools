const { parseMarketDate, round } = require("../utils/formatters");

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

function calculateRsi(series = [], period = 14) {
    const closes = getSeriesCloses(series);
    if (closes.length <= period) {
        return null;
    }

    let gains = 0;
    let losses = 0;
    for (let index = 1; index <= period; index += 1) {
        const change = closes[index] - closes[index - 1];
        if (change >= 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let index = period + 1; index < closes.length; index += 1) {
        const change = closes[index] - closes[index - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        averageGain = ((averageGain * (period - 1)) + gain) / period;
        averageLoss = ((averageLoss * (period - 1)) + loss) / period;
    }

    if (averageLoss === 0) {
        return 100;
    }

    const relativeStrength = averageGain / averageLoss;
    return round(100 - (100 / (1 + relativeStrength)), 2);
}

function calculateAtr(series = [], period = 14) {
    if (series.length <= period) {
        return null;
    }

    const trueRanges = [];
    for (let index = 1; index < series.length; index += 1) {
        const current = series[index];
        const previous = series[index - 1];
        if (![current?.high, current?.low, previous?.close].every(Number.isFinite)) {
            continue;
        }

        const trueRange = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );
        trueRanges.push(trueRange);
    }

    if (trueRanges.length < period) {
        return null;
    }

    let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (let index = period; index < trueRanges.length; index += 1) {
        atr = ((atr * (period - 1)) + trueRanges[index]) / period;
    }

    return round(atr, 2);
}

function calculateAtrExpansion(series = [], period = 14) {
    if (series.length < (period * 2)) {
        return null;
    }

    const currentAtr = calculateAtr(series, period);
    const priorAtr = calculateAtr(series.slice(0, -period), period);
    if (!Number.isFinite(currentAtr) || !Number.isFinite(priorAtr) || priorAtr === 0) {
        return null;
    }

    return round(currentAtr / priorAtr, 2);
}

function getRecentSwingLevels(series = []) {
    const pivots = findPivots(series.slice(-20));
    const recentHigh = pivots.highs.length
        ? pivots.highs[pivots.highs.length - 1].value
        : (series.slice(-10).reduce((max, candle) => (Number.isFinite(candle?.high) ? Math.max(max, candle.high) : max), Number.NEGATIVE_INFINITY));
    const recentLow = pivots.lows.length
        ? pivots.lows[pivots.lows.length - 1].value
        : (series.slice(-10).reduce((min, candle) => (Number.isFinite(candle?.low) ? Math.min(min, candle.low) : min), Number.POSITIVE_INFINITY));

    return {
        recentHigh: Number.isFinite(recentHigh) ? round(recentHigh, 2) : null,
        recentLow: Number.isFinite(recentLow) ? round(recentLow, 2) : null
    };
}

function resolvePreferredExpiry(chain, traderProfile = {}) {
    const expiries = Array.isArray(chain?.expiries) ? chain.expiries.filter(Boolean) : [];
    if (!expiries.length) {
        return null;
    }

    if (String(traderProfile.expiryPreference || "").toLowerCase() === "next" && expiries[1]) {
        return expiries[1];
    }

    return expiries[0];
}

function getExpiryRows(chain, traderProfile = {}) {
    const selectedExpiry = resolvePreferredExpiry(chain, traderProfile);
    const rows = Array.isArray(chain?.contracts)
        ? chain.contracts
            .filter((row) => !selectedExpiry || row.expiryDate === selectedExpiry)
            .filter((row) => Number.isFinite(Number(row?.strikePrice)))
            .sort((left, right) => left.strikePrice - right.strikePrice)
        : [];

    return {
        selectedExpiry,
        rows
    };
}

function calculateMaxPain(chain, traderProfile = {}) {
    const { selectedExpiry, rows } = getExpiryRows(chain, traderProfile);
    if (!rows.length) {
        return {
            expiry: selectedExpiry,
            strike: null,
            totalPain: null
        };
    }

    let best = null;
    rows.forEach((candidate) => {
        const candidateStrike = Number(candidate.strikePrice);
        let totalPain = 0;

        rows.forEach((row) => {
            const strikePrice = Number(row.strikePrice);
            const callOi = Number(row?.CE?.openInterest || 0);
            const putOi = Number(row?.PE?.openInterest || 0);
            totalPain += Math.max(0, candidateStrike - strikePrice) * callOi;
            totalPain += Math.max(0, strikePrice - candidateStrike) * putOi;
        });

        if (!best || totalPain < best.totalPain) {
            best = {
                expiry: selectedExpiry,
                strike: candidateStrike,
                totalPain
            };
        }
    });

    return best || {
        expiry: selectedExpiry,
        strike: null,
        totalPain: null
    };
}

function calculateOiBalance(chain, traderProfile = {}) {
    const { selectedExpiry, rows } = getExpiryRows(chain, traderProfile);
    if (!rows.length) {
        return {
            expiry: selectedExpiry,
            totalCallOi: null,
            totalPutOi: null,
            totalCallChangeOi: null,
            totalPutChangeOi: null,
            directionalRatio: null
        };
    }

    const totals = rows.reduce((accumulator, row) => {
        accumulator.totalCallOi += Number(row?.CE?.openInterest || 0);
        accumulator.totalPutOi += Number(row?.PE?.openInterest || 0);
        accumulator.totalCallChangeOi += Number(row?.CE?.changeInOpenInterest || 0);
        accumulator.totalPutChangeOi += Number(row?.PE?.changeInOpenInterest || 0);
        return accumulator;
    }, {
        totalCallOi: 0,
        totalPutOi: 0,
        totalCallChangeOi: 0,
        totalPutChangeOi: 0
    });

    const oiDenominator = Math.abs(totals.totalCallOi) + Math.abs(totals.totalPutOi);
    const changeDenominator = Math.abs(totals.totalCallChangeOi) + Math.abs(totals.totalPutChangeOi);
    const oiBias = oiDenominator ? (totals.totalPutOi - totals.totalCallOi) / oiDenominator : 0;
    const changeBias = changeDenominator ? (totals.totalPutChangeOi - totals.totalCallChangeOi) / changeDenominator : 0;

    return {
        expiry: selectedExpiry,
        ...totals,
        directionalRatio: round((changeBias * 0.65) + (oiBias * 0.35), 4)
    };
}

function calculateIvPercentileProxy(chain, traderProfile = {}) {
    const { selectedExpiry, rows } = getExpiryRows(chain, traderProfile);
    if (!rows.length) {
        return {
            expiry: selectedExpiry,
            percentile: null,
            atmIv: null,
            averageIv: null
        };
    }

    const allIvs = [];
    rows.forEach((row) => {
        [row?.CE?.impliedVolatility, row?.PE?.impliedVolatility].forEach((value) => {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) {
                allIvs.push(numeric);
            }
        });
    });

    if (!allIvs.length) {
        return {
            expiry: selectedExpiry,
            percentile: null,
            atmIv: null,
            averageIv: null
        };
    }

    const underlyingValue = Number(chain?.underlyingValue);
    const nearest = rows.reduce((best, row) => {
        if (!Number.isFinite(underlyingValue)) {
            return best;
        }
        const distance = Math.abs(Number(row.strikePrice) - underlyingValue);
        if (!best || distance < best.distance) {
            return {
                row,
                distance
            };
        }
        return best;
    }, null);

    const atmRow = nearest?.row || rows[Math.floor(rows.length / 2)];
    const atmValues = [atmRow?.CE?.impliedVolatility, atmRow?.PE?.impliedVolatility]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
    const atmIv = atmValues.length
        ? atmValues.reduce((sum, value) => sum + value, 0) / atmValues.length
        : null;

    if (!Number.isFinite(atmIv)) {
        return {
            expiry: selectedExpiry,
            percentile: null,
            atmIv: null,
            averageIv: round(allIvs.reduce((sum, value) => sum + value, 0) / allIvs.length, 2)
        };
    }

    const below = allIvs.filter((value) => value <= atmIv).length;
    return {
        expiry: selectedExpiry,
        percentile: round((below / allIvs.length) * 100, 2),
        atmIv: round(atmIv, 2),
        averageIv: round(allIvs.reduce((sum, value) => sum + value, 0) / allIvs.length, 2)
    };
}

function calculateVwapPosition(selectedIntraday) {
    return {
        price: selectedIntraday?.proxy?.price ?? null,
        vwap: selectedIntraday?.proxy?.vwap ?? null,
        distancePercent: selectedIntraday?.proxy?.vwapDistancePercent ?? null,
        relativeVolume: selectedIntraday?.proxy?.relativeVolume ?? null
    };
}

function calculateIvTrend(context) {
    const vixSeries = context?.intraday?.instruments?.INDIA_VIX?.series || [];
    const closes = getSeriesCloses(vixSeries);
    if (closes.length < 4) {
        return {
            changePercent: null,
            direction: "FLAT"
        };
    }

    const reference = closes[Math.max(0, closes.length - 4)];
    const latest = closes[closes.length - 1];
    if (!Number.isFinite(reference) || !reference || !Number.isFinite(latest)) {
        return {
            changePercent: null,
            direction: "FLAT"
        };
    }

    const changePercent = round(((latest - reference) / reference) * 100, 2);
    return {
        changePercent,
        direction: changePercent >= 0.8 ? "RISING" : changePercent <= -0.8 ? "FALLING" : "FLAT"
    };
}

function calculateGlobalCueBias(context = {}) {
    const contributions = [];
    const push = (value) => {
        if (Number.isFinite(value)) {
            contributions.push(value);
        }
    };

    push(Number.isFinite(context?.global?.nasdaqFutures?.changePercent)
        ? Math.max(-1, Math.min(1, context.global.nasdaqFutures.changePercent / 1.2))
        : null);
    push(Number.isFinite(context?.global?.sp500Futures?.changePercent)
        ? Math.max(-1, Math.min(1, context.global.sp500Futures.changePercent / 1.1))
        : null);
    push(Number.isFinite(context?.macro?.dxy?.changePercent)
        ? Math.max(-1, Math.min(1, -(context.macro.dxy.changePercent / 0.5)))
        : null);
    push(Number.isFinite(context?.macro?.crude?.changePercent)
        ? Math.max(-1, Math.min(1, -(context.macro.crude.changePercent / 2)))
        : null);

    if (!contributions.length) {
        return {
            score: 0,
            sentiment: "Neutral",
            detail: "Global cue overlay is unavailable."
        };
    }

    const score = round(contributions.reduce((sum, value) => sum + value, 0) / contributions.length, 2);
    return {
        score,
        sentiment: score >= 0.25 ? "Supportive" : score <= -0.25 ? "Risk-off" : "Neutral",
        detail: score >= 0.25
            ? "Global futures and macro cues are supportive."
            : score <= -0.25
                ? "Global futures and macro cues are defensive."
                : "Global cues are mixed and only lightly affect the setup."
    };
}

function getIstNow() {
    const parts = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).formatToParts(new Date());

    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        year: Number(map.year),
        month: Number(map.month),
        day: Number(map.day),
        hour: Number(map.hour),
        minute: Number(map.minute)
    };
}

function getSessionTiming(selectedExpiry) {
    const now = getIstNow();
    const minutes = (now.hour * 60) + now.minute;
    const lateSession = minutes >= ((14 * 60) + 30);
    const expiryTimestamp = selectedExpiry ? parseMarketDate(selectedExpiry) : null;
    const expiryDate = expiryTimestamp ? new Date(expiryTimestamp) : null;
    const nowDate = new Date(Date.UTC(now.year, now.month - 1, now.day));
    const nearExpiryDays = expiryDate
        ? Math.round((expiryDate.getTime() - nowDate.getTime()) / 86400000)
        : null;

    return {
        lateSession,
        minutesToClose: Math.max(0, (15 * 60) + 30 - minutes),
        nearExpiry: Number.isFinite(nearExpiryDays) ? nearExpiryDays <= 1 : false,
        nearExpiryDays
    };
}

module.exports = {
    calculateAtr,
    calculateAtrExpansion,
    calculateGlobalCueBias,
    calculateIvPercentileProxy,
    calculateIvTrend,
    calculateMaxPain,
    calculateOiBalance,
    calculateRsi,
    calculateVwapPosition,
    detectTrendStructure,
    findPivots,
    getCurrentPrice,
    getInstrumentLabel,
    getRecentSwingLevels,
    getSelectedIntraday,
    getSelectedSpot,
    getSeriesCloses,
    getSessionTiming,
    resolvePreferredExpiry
};
