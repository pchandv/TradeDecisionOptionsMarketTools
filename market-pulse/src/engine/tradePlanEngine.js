const { formatValue, round } = require("../utils/formatters");

const DEFAULT_TRADER_PROFILE = {
    capital: 100000,
    riskPercent: 1,
    preferredInstrument: "NIFTY",
    strikeStyle: "ATM",
    expiryPreference: "current",
    lotSize: null
};

function positiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeChoice(value, allowed, fallback) {
    const normalized = String(value || "").toUpperCase();
    return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeExpiryChoice(value) {
    const normalized = String(value || "").toLowerCase();
    return normalized === "next" ? "next" : "current";
}

function optionBiasFromSignal(signal) {
    const quickOption = signal?.quick?.options || "WAIT";
    if (quickOption === "CALLS") {
        return "CE";
    }
    if (quickOption === "PUTS") {
        return "PE";
    }
    return null;
}

function getInstrumentLabel(symbol) {
    return symbol === "BANKNIFTY" ? "BANK NIFTY" : "NIFTY";
}

function getUnderlyingInstrument(payload, symbol) {
    return symbol === "BANKNIFTY" ? payload.india.bankNifty : payload.india.nifty;
}

function getOptionChain(payload, symbol) {
    return payload.internals.optionChains?.[symbol] || null;
}

function getLeg(row, optionType) {
    return optionType === "CE" ? row.CE : row.PE;
}

function findNearestStrikeIndex(rows, underlyingValue) {
    if (!rows.length || !Number.isFinite(underlyingValue)) {
        return 0;
    }

    let bestIndex = 0;
    let bestDistance = Infinity;

    rows.forEach((row, index) => {
        const distance = Math.abs(row.strikePrice - underlyingValue);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function buildCandidateOrder(baseIndex, total) {
    const order = [];
    for (let offset = 0; offset < total; offset += 1) {
        const lower = baseIndex - offset;
        const higher = baseIndex + offset;

        if (lower >= 0) {
            order.push(lower);
        }
        if (offset > 0 && higher < total) {
            order.push(higher);
        }
    }
    return order;
}

function isLiquidLeg(leg) {
    if (!leg || !Number.isFinite(leg.lastPrice) || leg.lastPrice <= 0) {
        return false;
    }

    return (Number(leg.totalTradedVolume || 0) > 0)
        || (Number(leg.openInterest || 0) > 0)
        || (Number(leg.buyPrice1 || 0) > 0)
        || (Number(leg.sellPrice1 || 0) > 0);
}

function chooseContract(chain, optionType, strikeStyle, underlyingValue, selectedExpiry) {
    const rows = (chain?.contracts || [])
        .filter((row) => row.expiryDate === selectedExpiry)
        .sort((left, right) => left.strikePrice - right.strikePrice);

    if (!rows.length) {
        return null;
    }

    const atmIndex = findNearestStrikeIndex(rows, underlyingValue);
    const desiredShift = strikeStyle === "ATM"
        ? 0
        : optionType === "CE"
            ? (strikeStyle === "ITM" ? -1 : 1)
            : (strikeStyle === "ITM" ? 1 : -1);
    const desiredIndex = Math.min(rows.length - 1, Math.max(0, atmIndex + desiredShift));
    const searchOrder = buildCandidateOrder(desiredIndex, rows.length);

    for (const index of searchOrder) {
        const row = rows[index];
        const leg = getLeg(row, optionType);
        if (isLiquidLeg(leg)) {
            return { row, leg };
        }
    }

    return null;
}

function buildPremiumReference(leg) {
    const buy = positiveNumber(leg?.buyPrice1);
    const sell = positiveNumber(leg?.sellPrice1);

    if (buy && sell && sell >= buy) {
        return {
            reference: round((buy + sell) / 2, 2),
            zoneLow: round(buy, 2),
            zoneHigh: round(sell, 2),
            zoneLabel: `Rs ${formatValue(buy)} to Rs ${formatValue(sell)}`
        };
    }

    const lastPrice = positiveNumber(leg?.lastPrice);
    if (!lastPrice) {
        return null;
    }

    const buffer = lastPrice * 0.02;
    return {
        reference: round(lastPrice, 2),
        zoneLow: round(lastPrice - buffer, 2),
        zoneHigh: round(lastPrice + buffer, 2),
        zoneLabel: `Around Rs ${formatValue(lastPrice)}`
    };
}

function buildRiskLevels(referencePrice, signal, chain, optionType, underlyingValue, vixPrice) {
    if (!Number.isFinite(referencePrice)) {
        return null;
    }

    const confidence = Number(signal?.confidence || 0);
    const vix = positiveNumber(vixPrice);
    const stopLossPct = vix && vix >= 18
        ? 0.2
        : confidence >= 70
            ? 0.16
            : 0.14;
    const target1Pct = confidence >= 70 ? 0.16 : 0.12;
    const target2Pct = confidence >= 70 ? 0.28 : 0.22;
    const stepSize = positiveNumber(chain?.stepSize) || 1;

    return {
        stopLoss: round(referencePrice * (1 - stopLossPct), 2),
        target1: round(referencePrice * (1 + target1Pct), 2),
        target2: round(referencePrice * (1 + target2Pct), 2),
        spotInvalidation: optionType === "CE"
            ? round(chain?.support?.strike || (underlyingValue - stepSize), 2)
            : round(chain?.resistance?.strike || (underlyingValue + stepSize), 2),
        spotTrigger: optionType === "CE"
            ? round(Math.max(chain?.support?.strike || underlyingValue, underlyingValue), 2)
            : round(Math.min(chain?.resistance?.strike || underlyingValue, underlyingValue), 2)
    };
}

function buildSizing(profile, entryReference, stopLoss) {
    const riskBudget = round((profile.capital * profile.riskPercent) / 100, 2);
    const perUnitRisk = Number.isFinite(entryReference) && Number.isFinite(stopLoss)
        ? round(entryReference - stopLoss, 2)
        : null;
    const maxContracts = perUnitRisk && perUnitRisk > 0
        ? Math.floor(riskBudget / perUnitRisk)
        : null;
    const maxLots = profile.lotSize && maxContracts !== null
        ? Math.floor(maxContracts / profile.lotSize)
        : null;
    const perLotRisk = profile.lotSize && perUnitRisk
        ? round(perUnitRisk * profile.lotSize, 2)
        : null;

    return {
        capital: profile.capital,
        riskPercent: profile.riskPercent,
        riskBudget,
        lotSize: profile.lotSize,
        perUnitRisk,
        perLotRisk,
        maxContracts,
        maxLots,
        requiresLotSize: !profile.lotSize,
        note: profile.lotSize
            ? (maxLots > 0
                ? `Risk budget supports up to ${maxLots} lot(s) at the current stop distance.`
                : "Risk budget is too small for one full lot at the current stop distance.")
            : "Enter your broker lot size to convert the risk budget into lots."
    };
}

function buildContractLabel(symbol, expiry, strikePrice, optionType) {
    return `${getInstrumentLabel(symbol)} ${expiry} ${strikePrice} ${optionType}`;
}

function normalizeTraderProfile(rawProfile = {}) {
    const capital = positiveNumber(rawProfile.capital) || DEFAULT_TRADER_PROFILE.capital;
    const riskPercent = positiveNumber(rawProfile.riskPercent) || DEFAULT_TRADER_PROFILE.riskPercent;

    return {
        capital,
        riskPercent,
        preferredInstrument: normalizeChoice(
            rawProfile.preferredInstrument || rawProfile.instrument,
            ["NIFTY", "BANKNIFTY"],
            DEFAULT_TRADER_PROFILE.preferredInstrument
        ),
        strikeStyle: normalizeChoice(
            rawProfile.strikeStyle,
            ["ATM", "ITM", "OTM"],
            DEFAULT_TRADER_PROFILE.strikeStyle
        ),
        expiryPreference: normalizeExpiryChoice(rawProfile.expiryPreference),
        lotSize: positiveNumber(rawProfile.lotSize)
    };
}

function normalizeActiveTrade(rawTrade = {}) {
    const instrument = normalizeChoice(rawTrade.activeInstrument || rawTrade.instrument, ["NIFTY", "BANKNIFTY"], "");
    const optionType = normalizeChoice(rawTrade.activeOptionType || rawTrade.optionType, ["CE", "PE"], "");
    const strikePrice = positiveNumber(rawTrade.activeStrike || rawTrade.strikePrice);
    const expiry = String(rawTrade.activeExpiry || rawTrade.expiry || "");
    const entryPrice = positiveNumber(rawTrade.activeEntry || rawTrade.entryPrice);

    if (!instrument || !optionType || !strikePrice || !expiry || !entryPrice) {
        return null;
    }

    return {
        planId: String(rawTrade.activePlanId || rawTrade.planId || `${instrument}:${expiry}:${strikePrice}:${optionType}`),
        instrument,
        optionType,
        strikePrice,
        expiry,
        entryPrice,
        stopLoss: positiveNumber(rawTrade.activeStop || rawTrade.stopLoss),
        target1: positiveNumber(rawTrade.activeTarget1 || rawTrade.target1),
        target2: positiveNumber(rawTrade.activeTarget2 || rawTrade.target2),
        spotInvalidation: positiveNumber(rawTrade.activeSpotInvalidation || rawTrade.spotInvalidation),
        acknowledgedAt: rawTrade.activeTakenAt || rawTrade.acknowledgedAt || null,
        lotSize: positiveNumber(rawTrade.activeLotSize || rawTrade.lotSize),
        maxLots: positiveNumber(rawTrade.activeMaxLots || rawTrade.maxLots)
    };
}

function buildTradePlan(payload, profile) {
    const optionType = optionBiasFromSignal(payload.signal);
    const instrument = profile.preferredInstrument;
    const chain = getOptionChain(payload, instrument);
    const underlyingInstrument = getUnderlyingInstrument(payload, instrument);
    const underlyingValue = positiveNumber(chain?.underlyingValue) || positiveNumber(underlyingInstrument?.price);

    if (!optionType) {
        return {
            actionable: false,
            notation: "WAIT",
            title: "No options trade right now",
            reason: "The live signal does not support a clean CALLS or PUTS setup yet.",
            profile,
            sourceUrl: chain?.sourceUrl || null
        };
    }

    if (!chain || !Array.isArray(chain.contracts) || !chain.contracts.length || !Number.isFinite(underlyingValue)) {
        return {
            actionable: false,
            notation: "WAIT",
            title: "Trade plan unavailable",
            reason: `Live ${getInstrumentLabel(instrument)} option data is unavailable right now.`,
            profile,
            sourceUrl: chain?.sourceUrl || null
        };
    }

    const shouldForceNextExpiry = (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") && chain.expiries?.[1];
    let selectedExpiry = shouldForceNextExpiry
        ? chain.expiries[1]
        : (profile.expiryPreference === "next" && chain.expiries?.[1] ? chain.expiries[1] : null);
    selectedExpiry = selectedExpiry || chain.expiries?.[0] || chain.contracts[0]?.expiryDate || null;

    let selected = chooseContract(chain, optionType, profile.strikeStyle, underlyingValue, selectedExpiry);
    if (!selected) {
        return {
            actionable: false,
            notation: "WAIT",
            title: "Trade plan unavailable",
            reason: "A liquid live contract could not be found for the selected profile.",
            profile,
            sourceUrl: chain.sourceUrl || null
        };
    }

    let premium = buildPremiumReference(selected.leg);
    if (premium?.reference && premium.reference < 1 && chain.expiries?.[1] && selectedExpiry !== chain.expiries[1]) {
        const fallbackSelection = chooseContract(chain, optionType, profile.strikeStyle, underlyingValue, chain.expiries[1]);
        const fallbackPremium = buildPremiumReference(fallbackSelection?.leg);
        if (fallbackSelection && fallbackPremium?.reference && fallbackPremium.reference >= premium.reference) {
            selectedExpiry = chain.expiries[1];
            selected = fallbackSelection;
            premium = fallbackPremium;
        }
    }

    const riskLevels = buildRiskLevels(
        premium?.reference,
        payload.signal,
        chain,
        optionType,
        underlyingValue,
        payload.india?.indiaVix?.price
    );
    const sizing = buildSizing(profile, premium?.reference, riskLevels?.stopLoss);
    const planId = `${instrument}:${selectedExpiry}:${selected.row.strikePrice}:${optionType}`;
    const sideLabel = optionType === "CE" ? "BUY CALL" : "BUY PUT";
    const quickOptions = payload.signal.quick?.options || "WAIT";
    const sessionLabel = payload.session?.label || "Market";
    const entrySpotText = optionType === "CE"
        ? `${getInstrumentLabel(instrument)} should hold above ${formatValue(riskLevels.spotTrigger)}`
        : `${getInstrumentLabel(instrument)} should stay below ${formatValue(riskLevels.spotTrigger)}`;
    const invalidationText = optionType === "CE"
        ? `Exit if spot breaks below ${formatValue(riskLevels.spotInvalidation)} or premium loses ${formatValue(riskLevels.stopLoss)}.`
        : `Exit if spot moves above ${formatValue(riskLevels.spotInvalidation)} or premium loses ${formatValue(riskLevels.stopLoss)}.`;

    return {
        actionable: true,
        planId,
        notation: sideLabel,
        direction: quickOptions,
        instrument,
        instrumentLabel: getInstrumentLabel(instrument),
        expiry: selectedExpiry,
        sourceUrl: chain.sourceUrl || null,
        title: `${sideLabel} ${getInstrumentLabel(instrument)}`,
        reason: `${sessionLabel} plan based on live ${getInstrumentLabel(instrument)} option-chain liquidity and the current ${quickOptions} bias.`,
        contract: {
            symbol: instrument,
            label: buildContractLabel(instrument, selectedExpiry, selected.row.strikePrice, optionType),
            strikePrice: selected.row.strikePrice,
            expiry: selectedExpiry,
            optionType,
            identifier: selected.leg.identifier,
            lastPrice: selected.leg.lastPrice,
            buyPrice1: selected.leg.buyPrice1,
            sellPrice1: selected.leg.sellPrice1,
            openInterest: selected.leg.openInterest,
            totalTradedVolume: selected.leg.totalTradedVolume,
            impliedVolatility: selected.leg.impliedVolatility,
            underlyingValue
        },
        entry: {
            premiumReference: premium.reference,
            zoneLow: premium.zoneLow,
            zoneHigh: premium.zoneHigh,
            zoneLabel: premium.zoneLabel,
            spotTrigger: riskLevels.spotTrigger,
            triggerText: `Enter only if ${entrySpotText} and the dashboard still says ${quickOptions}.`
        },
        exit: {
            stopLoss: riskLevels.stopLoss,
            target1: riskLevels.target1,
            target2: riskLevels.target2,
            spotInvalidation: riskLevels.spotInvalidation,
            invalidationText,
            trailText: `After target 1, trail the stop to entry (${formatValue(premium.reference)}) and protect open profit.`,
            timeExitText: "If the move does not follow through by late afternoon or the session flips risk-off, close the position."
        },
        sizing,
        checklist: [
            `Signal notation is ${payload.signal.quick?.direction || "WAIT"} / ${quickOptions}.`,
            `Use ${profile.strikeStyle} strike selection with ${profile.expiryPreference} expiry.`,
            "Do not take the trade if the premium is outside the entry zone or live spread widens sharply."
        ]
    };
}

function monitorActiveTrade(payload, activeTrade) {
    if (!activeTrade) {
        return null;
    }

    const chain = getOptionChain(payload, activeTrade.instrument);
    if (!chain || !Array.isArray(chain.contracts)) {
        return {
            action: "CHECK",
            headline: "Monitor unavailable",
            detail: "Live option-chain data is unavailable, so the app cannot confirm hold or exit right now.",
            sourceUrl: chain?.sourceUrl || null
        };
    }

    const row = chain.contracts.find((item) => item.expiryDate === activeTrade.expiry && Number(item.strikePrice) === Number(activeTrade.strikePrice));
    const leg = row ? getLeg(row, activeTrade.optionType) : null;

    if (!leg || !Number.isFinite(leg.lastPrice)) {
        return {
            action: "CHECK",
            headline: "Contract not found",
            detail: "The tracked contract is not present in the current live chain. Recheck the trade manually.",
            sourceUrl: chain.sourceUrl || null
        };
    }

    const currentPremium = positiveNumber(leg.sellPrice1) || positiveNumber(leg.lastPrice) || positiveNumber(leg.buyPrice1);
    const underlyingValue = positiveNumber(chain.underlyingValue) || positiveNumber(getUnderlyingInstrument(payload, activeTrade.instrument)?.price);
    const pnlPercent = currentPremium && activeTrade.entryPrice
        ? round(((currentPremium - activeTrade.entryPrice) / activeTrade.entryPrice) * 100, 2)
        : null;
    const expectedQuick = activeTrade.optionType === "CE" ? "CALLS" : "PUTS";

    let action = "HOLD";
    let headline = "Hold the trade";
    let detail = "Signal and premium still support the trade plan.";

    if (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") {
        action = "EXIT";
        headline = "Exit before session end";
        detail = "The market session is over or closing. Do not carry this as an intraday options plan.";
    } else if (
        Number.isFinite(activeTrade.spotInvalidation)
        && Number.isFinite(underlyingValue)
        && ((activeTrade.optionType === "CE" && underlyingValue <= activeTrade.spotInvalidation)
            || (activeTrade.optionType === "PE" && underlyingValue >= activeTrade.spotInvalidation))
    ) {
        action = "EXIT";
        headline = "Spot invalidation broke";
        detail = "Underlying spot has moved through the invalidation level from the original plan.";
    } else if (Number.isFinite(activeTrade.stopLoss) && currentPremium <= activeTrade.stopLoss) {
        action = "EXIT";
        headline = "Premium stop-loss hit";
        detail = "Current option premium is at or below the stored stop-loss.";
    } else if (payload.signal.quick?.options !== expectedQuick) {
        action = "INVALIDATED";
        headline = "Signal flipped against the trade";
        detail = `The dashboard now favors ${payload.signal.quick?.options || "WAIT"} instead of ${expectedQuick}.`;
    } else if (Number.isFinite(activeTrade.target2) && currentPremium >= activeTrade.target2) {
        action = "EXIT";
        headline = "Target 2 reached";
        detail = "Book the remaining position and reset for the next setup.";
    } else if (Number.isFinite(activeTrade.target1) && currentPremium >= activeTrade.target1) {
        action = "PARTIAL";
        headline = "Book partial, then trail";
        detail = "First target is met. Book partial and trail the rest at entry or better.";
    } else if (payload.signal.quick?.options === expectedQuick && (pnlPercent === null || pnlPercent >= -6)) {
        action = "HOLD";
        headline = "Hold while bias is intact";
        detail = "The contract remains above stop and the live bias still supports the trade.";
    }

    return {
        action,
        headline,
        detail,
        planId: activeTrade.planId,
        contractLabel: buildContractLabel(activeTrade.instrument, activeTrade.expiry, activeTrade.strikePrice, activeTrade.optionType),
        currentPremium,
        underlyingValue,
        pnlPercent,
        sourceUrl: chain.sourceUrl || null,
        alertKey: `${activeTrade.planId}:${action}:${headline}:${round(currentPremium || 0, 2)}`
    };
}

module.exports = {
    buildTradePlan,
    monitorActiveTrade,
    normalizeActiveTrade,
    normalizeTraderProfile
};
