const { DECISION_CONFIG } = require("../config/sources");
const { clamp, formatValue, round } = require("../utils/formatters");

function getInstrumentLabel(symbol) {
    return symbol === "BANKNIFTY" ? "BANK NIFTY" : "NIFTY";
}

function getSelectedSpot(india, symbol) {
    return symbol === "BANKNIFTY" ? india.bankNifty : india.nifty;
}

function getConfirmingSpot(india, symbol) {
    return symbol === "BANKNIFTY" ? india.nifty : india.bankNifty;
}

function getSelectedIntraday(intraday, symbol) {
    return intraday?.instruments?.[symbol] || null;
}

function getConfirmingIntraday(intraday, symbol) {
    return intraday?.instruments?.[symbol === "BANKNIFTY" ? "NIFTY" : "BANKNIFTY"] || null;
}

function getCurrentPrice(spot, intraday) {
    const lastCandle = intraday?.series?.[intraday.series.length - 1];
    return Number.isFinite(lastCandle?.close) ? lastCandle.close : spot?.price;
}

function getSeriesCloses(series = []) {
    return series
        .map((candle) => candle.close)
        .filter((value) => Number.isFinite(value));
}

function scoreFromBands(value, bullishBands, bearishBands) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    for (const band of bullishBands) {
        if (value >= band.threshold) {
            return band.score;
        }
    }

    for (const band of bearishBands) {
        if (value <= band.threshold) {
            return band.score;
        }
    }

    return 0;
}

function buildComponent(key, label, score, value, detail) {
    return {
        key,
        label,
        score: round(score, 2),
        value,
        detail,
        tone: score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral"
    };
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
            strength: 0,
            detail: "Not enough intraday candles to validate HH/HL or LH/LL."
        };
    }

    const pivots = findPivots(recentSeries);
    const lastHighs = pivots.highs.slice(-2);
    const lastLows = pivots.lows.slice(-2);
    let regime = "SIDEWAYS";
    let score = 0;
    let detail = "Recent swing highs and lows are overlapping.";
    let strength = 0.4;

    if (lastHighs.length >= 2 && lastLows.length >= 2) {
        const higherHighs = lastHighs[1].value > lastHighs[0].value;
        const higherLows = lastLows[1].value > lastLows[0].value;
        const lowerHighs = lastHighs[1].value < lastHighs[0].value;
        const lowerLows = lastLows[1].value < lastLows[0].value;

        if (higherHighs && higherLows) {
            regime = "UPTREND";
            score = 2.5;
            strength = 0.85;
            detail = "Swing highs and lows are stepping higher, confirming HH/HL structure.";
        } else if (lowerHighs && lowerLows) {
            regime = "DOWNTREND";
            score = -2.5;
            strength = 0.85;
            detail = "Swing highs and lows are stepping lower, confirming LH/LL structure.";
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
            score = 1.5;
            strength = 0.65;
            detail = "Closes are drifting higher even though pivots are not fully clean yet.";
        } else if (movePercent <= -0.45) {
            regime = "DOWNTREND";
            score = -1.5;
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

function summarizeOptionPressure(chain, spotPrice) {
    const stepSize = Number(chain?.stepSize || 0);
    const contracts = Array.isArray(chain?.contracts) ? chain.contracts : [];

    if (!contracts.length || !Number.isFinite(spotPrice) || !Number.isFinite(stepSize) || stepSize <= 0) {
        return {
            score: 0,
            summary: "Option chain pressure unavailable.",
            detail: "Near-the-money OI pressure could not be summarized."
        };
    }

    const nearRows = contracts
        .filter((row) => Math.abs(Number(row.strikePrice) - spotPrice) <= (stepSize * 2))
        .slice(0, 12);

    if (!nearRows.length) {
        return {
            score: 0,
            summary: "Option chain pressure unavailable.",
            detail: "No near-the-money rows were available."
        };
    }

    const totals = nearRows.reduce((accumulator, row) => {
        accumulator.callOi += Number(row.CE?.openInterest || 0);
        accumulator.putOi += Number(row.PE?.openInterest || 0);
        accumulator.callChangeOi += Math.max(0, Number(row.CE?.changeInOpenInterest || 0));
        accumulator.putChangeOi += Math.max(0, Number(row.PE?.changeInOpenInterest || 0));
        accumulator.callVolume += Number(row.CE?.totalTradedVolume || 0);
        accumulator.putVolume += Number(row.PE?.totalTradedVolume || 0);
        return accumulator;
    }, {
        callOi: 0,
        putOi: 0,
        callChangeOi: 0,
        putChangeOi: 0,
        callVolume: 0,
        putVolume: 0
    });

    const oiBalance = totals.putOi || totals.callOi
        ? (totals.putOi - totals.callOi) / Math.max(totals.putOi, totals.callOi)
        : 0;
    const changeBalance = totals.putChangeOi || totals.callChangeOi
        ? (totals.putChangeOi - totals.callChangeOi) / Math.max(totals.putChangeOi, totals.callChangeOi)
        : 0;
    const volumeBalance = totals.putVolume || totals.callVolume
        ? (totals.putVolume - totals.callVolume) / Math.max(totals.putVolume, totals.callVolume)
        : 0;
    const composite = round((oiBalance * 0.45) + (changeBalance * 0.4) + (volumeBalance * 0.15), 2);

    let score = 0;
    let summary = "OI pressure is balanced.";
    if (composite >= 0.18) {
        score = 2.5;
        summary = "Put-side support is stronger than call-side resistance.";
    } else if (composite >= 0.08) {
        score = 1.5;
        summary = "Put writing has a mild edge around ATM strikes.";
    } else if (composite <= -0.18) {
        score = -2.5;
        summary = "Call writing is dominating near-the-money strikes.";
    } else if (composite <= -0.08) {
        score = -1.5;
        summary = "Call-side pressure is slightly stronger around ATM strikes.";
    }

    return {
        score,
        summary,
        detail: `PUT OI ${Math.round(totals.putOi).toLocaleString("en-IN")} vs CALL OI ${Math.round(totals.callOi).toLocaleString("en-IN")}; change OI balance ${formatValue(changeBalance * 100)}%.`,
        putOi: totals.putOi,
        callOi: totals.callOi
    };
}

function buildOpeningStrategy(spot, intraday, vwapDistancePercent, vwapBandPercent) {
    const openPrice = intraday?.open || spot?.open;
    const previousClose = spot?.previousClose;
    const currentPrice = getCurrentPrice(spot, intraday);
    const range = intraday?.openingRange;

    if (!Number.isFinite(openPrice) || !Number.isFinite(previousClose) || !Number.isFinite(currentPrice)) {
        return {
            gapType: "UNKNOWN",
            score: 0,
            title: "Opening strategy unavailable",
            detail: "Gap and opening-range logic needs live open/close data."
        };
    }

    const gapPercent = round(((openPrice - previousClose) / previousClose) * 100, 2);
    const aboveProxyVwap = Number.isFinite(vwapDistancePercent) && vwapDistancePercent >= vwapBandPercent;
    const belowProxyVwap = Number.isFinite(vwapDistancePercent) && vwapDistancePercent <= -vwapBandPercent;
    const insideRange = range
        ? currentPrice <= range.high && currentPrice >= range.low
        : false;
    const aboveRange = range ? currentPrice > range.high : false;
    const belowRange = range ? currentPrice < range.low : false;

    if (gapPercent >= DECISION_CONFIG.openingGapPercent) {
        if (aboveRange && aboveProxyVwap) {
            return {
                gapType: "GAP_UP",
                score: 1.5,
                title: "Gap-up breakout is holding",
                detail: "Price is accepting above the opening range, which supports CE continuation."
            };
        }
        if (belowRange || (currentPrice < openPrice && belowProxyVwap)) {
            return {
                gapType: "GAP_UP",
                score: -1.5,
                title: "Gap-up failure is active",
                detail: "The opening strength failed and price is slipping under the range, which favors PE continuation."
            };
        }

        return {
            gapType: "GAP_UP",
            score: 0,
            title: "Gap-up needs confirmation",
            detail: insideRange
                ? "Price is still trapped inside the opening range. Wait for acceptance or failure."
                : "Gap-up opened strong, but follow-through is not decisive yet."
        };
    }

    if (gapPercent <= -DECISION_CONFIG.openingGapPercent) {
        if (belowRange && belowProxyVwap) {
            return {
                gapType: "GAP_DOWN",
                score: -1.5,
                title: "Gap-down continuation is active",
                detail: "Price is accepting below the opening range, which supports PE continuation."
            };
        }
        if (aboveRange || (currentPrice > openPrice && aboveProxyVwap)) {
            return {
                gapType: "GAP_DOWN",
                score: 1.5,
                title: "Gap-down reversal is building",
                detail: "Buyers reclaimed the opening range after a gap-down. CE setups improve if it holds."
            };
        }

        return {
            gapType: "GAP_DOWN",
            score: 0,
            title: "Gap-down bounce still unresolved",
            detail: insideRange
                ? "Price is inside the opening range after the gap-down. Wait for rejection or reclaim."
                : "Gap-down opened weak, but the rejection signal is not clean yet."
        };
    }

    if (aboveRange && aboveProxyVwap) {
        return {
            gapType: "FLAT",
            score: 1,
            title: "Flat-open breakout",
            detail: "Price is breaking higher from a flat open with VWAP support."
        };
    }
    if (belowRange && belowProxyVwap) {
        return {
            gapType: "FLAT",
            score: -1,
            title: "Flat-open breakdown",
            detail: "Price is breaking lower from a flat open with VWAP pressure."
        };
    }

    return {
        gapType: "FLAT",
        score: 0,
        title: "Flat open / no-trade watch",
        detail: "The open is flat and price has not escaped the opening range decisively."
    };
}

function buildSupportResistanceSignal(chain, spotPrice, trend) {
    const support = chain?.support?.strike;
    const resistance = chain?.resistance?.strike;
    const buffer = DECISION_CONFIG.supportResistanceBufferPercent;

    if (!Number.isFinite(spotPrice) || (!Number.isFinite(support) && !Number.isFinite(resistance))) {
        return {
            score: 0,
            detail: "Support and resistance could not be evaluated."
        };
    }

    const supportDistance = Number.isFinite(support)
        ? round(((spotPrice - support) / spotPrice) * 100, 2)
        : null;
    const resistanceDistance = Number.isFinite(resistance)
        ? round(((resistance - spotPrice) / spotPrice) * 100, 2)
        : null;

    if (Number.isFinite(supportDistance) && supportDistance >= 0 && supportDistance <= buffer && trend.regime === "UPTREND") {
        return {
            score: 1.5,
            detail: `Price is close to support ${support} and the uptrend is still intact.`
        };
    }

    if (Number.isFinite(resistanceDistance) && resistanceDistance >= 0 && resistanceDistance <= buffer && trend.regime === "DOWNTREND") {
        return {
            score: -1.5,
            detail: `Price is close to resistance ${resistance} and the downtrend is still intact.`
        };
    }

    if (Number.isFinite(resistance) && spotPrice > (resistance * 1.0015)) {
        return {
            score: 1,
            detail: `Price is trading above OI resistance ${resistance}, which improves bullish continuation odds.`
        };
    }

    if (Number.isFinite(support) && spotPrice < (support * 0.9985)) {
        return {
            score: -1,
            detail: `Price slipped under OI support ${support}, which weakens the structure.`
        };
    }

    return {
        score: 0,
        detail: `Support ${support || "NA"} / resistance ${resistance || "NA"} are not giving a directional edge right now.`
    };
}

function buildVixSignal(vixIntraday, fallbackVix) {
    const closes = getSeriesCloses(vixIntraday?.series || []);
    const recent = closes.slice(-6);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const liveVix = vixIntraday?.price || fallbackVix?.price || null;
    const movePercent = Number.isFinite(first) && Number.isFinite(last) && first
        ? round(((last - first) / first) * 100, 2)
        : fallbackVix?.changePercent ?? null;
    let score = 0;
    let detail = "VIX is not giving a strong directional signal.";

    if (movePercent >= 3 || liveVix >= 22) {
        score = -1.8;
        detail = `India VIX is rising fast (${formatValue(movePercent || 0)}%), which supports PE bias and wider risk.`;
    } else if (movePercent >= 1.2 || liveVix >= 19) {
        score = -1.1;
        detail = `India VIX is trending higher (${formatValue(movePercent || 0)}%), so upside conviction is weaker.`;
    } else if (movePercent <= -2) {
        score = 1.3;
        detail = `India VIX is cooling (${formatValue(movePercent)}%), which supports CE continuation.`;
    } else if (movePercent <= -0.8) {
        score = 0.8;
        detail = `India VIX is easing (${formatValue(movePercent)}%), which is constructive for longs.`;
    }

    return {
        score,
        movePercent,
        liveVix,
        detail
    };
}

function buildLeadershipSignal(india, selectedInstrument) {
    const niftyChange = india?.nifty?.changePercent;
    const bankChange = india?.bankNifty?.changePercent;
    if (!Number.isFinite(niftyChange) || !Number.isFinite(bankChange)) {
        return {
            score: 0,
            detail: "Index leadership unavailable."
        };
    }

    const diff = round(bankChange - niftyChange, 2);
    if (selectedInstrument === "BANKNIFTY") {
        if (diff >= 0.25) {
            return {
                score: 1,
                detail: `BANK NIFTY is leading NIFTY by ${formatValue(diff)}%, which supports CE continuation.`
            };
        }
        if (diff <= -0.25) {
            return {
                score: -1,
                detail: `BANK NIFTY is lagging NIFTY by ${formatValue(Math.abs(diff))}%, which weakens bullish follow-through.`
            };
        }
    } else {
        if (diff >= 0.25) {
            return {
                score: 1,
                detail: `Banks are outperforming by ${formatValue(diff)}%, which is a constructive risk-on signal for NIFTY.`
            };
        }
        if (diff <= -0.25) {
            return {
                score: -1,
                detail: `Banks are underperforming by ${formatValue(Math.abs(diff))}%, which warns of softer index breadth.`
            };
        }
    }

    return {
        score: 0,
        detail: "NIFTY and BANK NIFTY leadership is balanced."
    };
}

function buildMacroBackdrop(signal) {
    const score = Number(signal?.score || 0);
    if (score >= 40) {
        return {
            score: 1.5,
            detail: "Macro, global cues, and headline flow are broadly supportive."
        };
    }
    if (score >= 20) {
        return {
            score: 1,
            detail: "Macro backdrop is mildly supportive."
        };
    }
    if (score <= -40) {
        return {
            score: -1.5,
            detail: "Macro, global cues, and headline flow are risk-off."
        };
    }
    if (score <= -20) {
        return {
            score: -1,
            detail: "Macro backdrop is mildly defensive."
        };
    }

    return {
        score: 0,
        detail: "Macro backdrop is neutral and should not override intraday structure."
    };
}

function determineSuggestedStrikeStyle(totalScore, confidence) {
    if (Math.abs(totalScore) >= DECISION_CONFIG.scoreThresholds.strongDirectional && confidence >= 78) {
        return "OTM";
    }
    if (confidence >= 64) {
        return "ATM";
    }
    return "ITM";
}

function buildNoTradeZone({ vwapDistancePercent, relativeVolume, pcr, trend, opening }, vwapBandPercent) {
    const reasons = [];
    if (Number.isFinite(vwapDistancePercent) && Math.abs(vwapDistancePercent) <= vwapBandPercent) {
        reasons.push("Price is hugging proxy VWAP.");
    }
    if (Number.isFinite(relativeVolume) && relativeVolume <= DECISION_CONFIG.lowRelativeVolume) {
        reasons.push("Intraday proxy volume is below average.");
    }
    if (Number.isFinite(pcr) && pcr >= DECISION_CONFIG.noTradePcrLow && pcr <= DECISION_CONFIG.noTradePcrHigh) {
        reasons.push("PCR is sitting in the neutral 0.9-1.1 band.");
    }
    if (trend.regime === "SIDEWAYS") {
        reasons.push("Trend structure is sideways.");
    }
    if (opening.score === 0) {
        reasons.push("Opening range has not resolved yet.");
    }

    return {
        active: reasons.length >= 2,
        reasons
    };
}

function buildConfidence(totalScore, components, trendStrength, noTradeActive, vixPrice) {
    const usableComponents = components.filter((component) => Number.isFinite(component.score));
    const directionalComponents = usableComponents.filter((component) => component.score !== 0);
    const direction = Math.sign(totalScore);
    const aligned = directionalComponents.filter((component) => Math.sign(component.score) === direction).length;
    const maxScore = 17;
    const alignmentScore = directionalComponents.length ? aligned / directionalComponents.length : 0.5;
    const coverage = usableComponents.length / Math.max(components.length, 1);
    const base = (
        ((Math.abs(totalScore) / maxScore) * 42)
        + (alignmentScore * 23)
        + (trendStrength * 18)
        + (coverage * 17)
    );
    const penalties = (noTradeActive ? 14 : 0) + ((Number(vixPrice) >= 22) ? 8 : 0);

    return Math.round(clamp(base - penalties, 22, 96));
}

function normalizeDecisionDirection(totalScore) {
    if (totalScore >= DECISION_CONFIG.scoreThresholds.directional) {
        return "CE";
    }
    if (totalScore <= -DECISION_CONFIG.scoreThresholds.directional) {
        return "PE";
    }
    return "WAIT";
}

function buildStatusEngine(direction, confidence, noTradeZone, activeTrade, minimumConfidence) {
    if (activeTrade) {
        const expected = activeTrade.optionType;
        if (direction === "WAIT" || direction !== expected || confidence < Math.max(55, minimumConfidence - 8)) {
            return {
                status: "EXIT",
                label: "EXIT",
                detail: "The active trade lost decision-engine alignment."
            };
        }

        return {
            status: "TRADE",
            label: "TRADE",
            detail: "The active trade still aligns with the live decision engine."
        };
    }

    if (direction === "WAIT" || confidence < minimumConfidence || noTradeZone.active) {
        return {
            status: "WAIT",
            label: "WAIT",
            detail: noTradeZone.active
                ? "No-trade conditions are active. Wait for cleaner separation from VWAP and the opening range."
                : "The directional score is not clean enough for a fresh entry."
        };
    }

    return {
        status: "TRADE",
        label: "TRADE",
        detail: "The live components are aligned well enough for a fresh options trade."
    };
}

function buildRiskMeter(confidence, vixSignal, noTradeZone) {
    const raw = 100 - confidence + (noTradeZone.active ? 12 : 0) + ((vixSignal.liveVix || 0) >= 22 ? 14 : 0);
    const score = Math.round(clamp(raw, 8, 96));
    return {
        score,
        level: score >= 70 ? "High" : score >= 45 ? "Moderate" : "Controlled",
        detail: score >= 70
            ? "Volatility and signal conflict are elevated. Size down or stand aside."
            : score >= 45
                ? "Risk is tradable, but conviction still needs discipline on entry and stop."
                : "Risk conditions are relatively stable for a directional setup."
    };
}

function buildDecisionHeadline(status, direction, confidence) {
    if (status === "EXIT") {
        return "EXIT";
    }
    if (status === "WAIT" || direction === "WAIT") {
        return "NO TRADE";
    }
    return confidence >= 78
        ? `STRONG ${direction}`
        : direction;
}

function buildDecisionEngine(context) {
    const minimumConfidence = Number.isFinite(context.traderProfile?.minimumConfidence)
        ? context.traderProfile.minimumConfidence
        : DECISION_CONFIG.minimumConfidence;
    const vwapBandPercent = Number.isFinite(context.traderProfile?.vwapBandPercent)
        ? context.traderProfile.vwapBandPercent
        : DECISION_CONFIG.vwapBandPercent;
    const selectedInstrument = context.traderProfile?.preferredInstrument || "NIFTY";
    const selectedSpot = getSelectedSpot(context.india, selectedInstrument);
    const confirmingSpot = getConfirmingSpot(context.india, selectedInstrument);
    const selectedIntraday = getSelectedIntraday(context.intraday, selectedInstrument);
    const confirmingIntraday = getConfirmingIntraday(context.intraday, selectedInstrument);
    const vixIntraday = context.intraday?.instruments?.INDIA_VIX || null;
    const chain = context.internals?.optionChains?.[selectedInstrument] || context.internals?.optionChain || null;
    const spotPrice = getCurrentPrice(selectedSpot, selectedIntraday);
    const trend = detectTrendStructure(selectedIntraday?.series || []);
    const pcr = chain?.putCallRatio ?? null;
    const vwapDistancePercent = selectedIntraday?.proxy?.vwapDistancePercent ?? null;
    const relativeVolume = selectedIntraday?.proxy?.relativeVolume ?? null;
    const opening = buildOpeningStrategy(selectedSpot, selectedIntraday, vwapDistancePercent, vwapBandPercent);
    const oiPressure = summarizeOptionPressure(chain, spotPrice);
    const levelSignal = buildSupportResistanceSignal(chain, spotPrice, trend);
    const vixSignal = buildVixSignal(vixIntraday, context.india?.indiaVix);
    const leadershipSignal = buildLeadershipSignal(context.india, selectedInstrument);
    const macroBackdrop = buildMacroBackdrop(context.signal);
    const components = [];

    const vwapScore = scoreFromBands(vwapDistancePercent, [
        { threshold: vwapBandPercent * 1.9, score: 3 },
        { threshold: vwapBandPercent, score: 2 }
    ], [
        { threshold: -(vwapBandPercent * 1.9), score: -3 },
        { threshold: -vwapBandPercent, score: -2 }
    ]);
    components.push(buildComponent(
        "vwap",
        "Price vs Proxy VWAP",
        vwapScore,
        Number.isFinite(vwapDistancePercent) ? `${formatValue(vwapDistancePercent)}%` : "Unavailable",
        Number.isFinite(vwapDistancePercent)
            ? `${selectedIntraday?.proxy?.label || "Proxy"} is ${vwapDistancePercent >= 0 ? "above" : "below"} VWAP.`
            : "VWAP proxy is unavailable right now."
    ));
    components.push(buildComponent("trend", "Trend Structure", trend.score, trend.badge, trend.detail));

    const pcrScore = scoreFromBands(pcr, [
        { threshold: 1.18, score: 2 },
        { threshold: 1.1, score: 1 }
    ], [
        { threshold: 0.82, score: -2 },
        { threshold: 0.9, score: -1 }
    ]);
    components.push(buildComponent(
        "pcr",
        "PCR Regime",
        pcrScore,
        Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable",
        Number.isFinite(pcr)
            ? (pcrScore > 0
                ? "PCR leans supportive for calls."
                : pcrScore < 0
                    ? "PCR leans supportive for puts."
                    : "PCR is neutral and does not add directional edge.")
            : "PCR is unavailable."
    ));

    components.push(buildComponent(
        "oi",
        "Option Chain OI",
        oiPressure.score,
        oiPressure.summary,
        oiPressure.detail
    ));
    components.push(buildComponent(
        "vix",
        "India VIX Trend",
        vixSignal.score,
        Number.isFinite(vixSignal.liveVix)
            ? `${formatValue(vixSignal.liveVix)} (${Number.isFinite(vixSignal.movePercent) ? `${formatValue(vixSignal.movePercent)}%` : "trend"})`
            : "Unavailable",
        vixSignal.detail
    ));
    components.push(buildComponent(
        "levels",
        "Support / Resistance",
        levelSignal.score,
        `S ${chain?.support?.strike || "NA"} / R ${chain?.resistance?.strike || "NA"}`,
        levelSignal.detail
    ));
    components.push(buildComponent(
        "opening",
        "Opening Strategy",
        opening.score,
        opening.title,
        opening.detail
    ));
    components.push(buildComponent(
        "macro",
        "Macro Backdrop",
        macroBackdrop.score,
        context.signal?.marketSignal || "Unavailable",
        macroBackdrop.detail
    ));
    components.push(buildComponent(
        "leadership",
        "Index Leadership",
        leadershipSignal.score,
        confirmingIntraday?.label || confirmingSpot?.label || getInstrumentLabel(selectedInstrument === "BANKNIFTY" ? "NIFTY" : "BANKNIFTY"),
        leadershipSignal.detail
    ));

    const totalScore = round(components.reduce((sum, component) => sum + Number(component.score || 0), 0), 2);
    const direction = normalizeDecisionDirection(totalScore);
    const noTradeZone = buildNoTradeZone({
        vwapDistancePercent,
        relativeVolume,
        pcr,
        trend,
        opening
    }, vwapBandPercent);
    const confidence = buildConfidence(totalScore, components, trend.strength, noTradeZone.active, vixSignal.liveVix);
    const statusEngine = buildStatusEngine(direction, confidence, noTradeZone, context.activeTrade, minimumConfidence);
    const suggestedStrikeStyle = direction === "WAIT"
        ? "ATM"
        : determineSuggestedStrikeStyle(totalScore, confidence);
    const riskMeter = buildRiskMeter(confidence, vixSignal, noTradeZone);
    const headline = buildDecisionHeadline(statusEngine.status, direction, confidence);

    return {
        status: statusEngine.status,
        headline,
        direction: statusEngine.status === "WAIT" ? "WAIT" : direction,
        confidence,
        score: totalScore,
        selectedInstrument,
        selectedInstrumentLabel: getInstrumentLabel(selectedInstrument),
        suggestedStrikeStyle,
        summary: statusEngine.detail,
        trend: {
            regime: trend.regime,
            badge: trend.badge,
            detail: trend.detail
        },
        opening,
        noTradeZone,
        vwap: {
            proxyLabel: selectedIntraday?.proxy?.label || "Proxy",
            price: selectedIntraday?.proxy?.price ?? null,
            vwap: selectedIntraday?.proxy?.vwap ?? null,
            distancePercent: vwapDistancePercent,
            relativeVolume
        },
        levels: {
            support: chain?.support?.strike ?? null,
            resistance: chain?.resistance?.strike ?? null,
            pcr
        },
        marketContext: {
            selectedPrice: spotPrice,
            selectedChangePercent: selectedSpot?.changePercent ?? selectedIntraday?.sessionChangePercent ?? null,
            confirmingChangePercent: confirmingSpot?.changePercent ?? null,
            macroSignal: context.signal?.marketSignal || "Unavailable"
        },
        riskMeter,
        components,
        quick: {
            status: statusEngine.status,
            direction,
            optionType: direction === "CE" || direction === "PE" ? direction : "WAIT",
            conviction: confidence >= 78 ? "High" : confidence >= 64 ? "Medium" : "Low"
        },
        notes: [
            `${getInstrumentLabel(selectedInstrument)} spot ${Number.isFinite(spotPrice) ? formatValue(spotPrice) : "Unavailable"} with ${confidence}% confidence.`,
            direction === "CE"
                ? "Bias favors calls only if price holds away from proxy VWAP and the opening structure remains supportive."
                : direction === "PE"
                    ? "Bias favors puts only if weakness stays accepted below proxy VWAP and resistance is respected."
                    : "Bias is mixed. Preserve capital until trend, VWAP, and PCR separate cleanly."
        ]
    };
}

module.exports = {
    buildDecisionEngine
};
