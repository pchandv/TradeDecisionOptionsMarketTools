const { DECISION_CONFIG } = require("../config/sources");
const { clamp, formatValue, round } = require("../utils/formatters");

const DEFAULT_TRADER_PROFILE = {
    capital: 100000,
    riskPercent: 1,
    preferredInstrument: "NIFTY",
    engineVersion: DECISION_CONFIG.defaultVersion,
    sessionPreset: "CUSTOM",
    tradeAggressiveness: "BALANCED",
    strikeStyle: "AUTO",
    expiryPreference: "current",
    lotSize: null,
    minimumConfidence: 64,
    vwapBandPercent: 0.18
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

function normalizeBoundedNumber(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return clamp(numeric, minimum, maximum);
}

function getDecisionSignal(payload) {
    if (payload?.decision && payload.decision.status !== "TRADE") {
        return {
            optionType: null,
            quickOptions: "WAIT",
            quickDirection: "WAIT",
            confidence: payload.decision.confidence || 0
        };
    }

    if (payload?.decision?.action === "CE" || payload?.decision?.direction === "CE") {
        return {
            optionType: "CE",
            quickOptions: "CALLS",
            quickDirection: payload?.decision?.bias || "UP",
            confidence: payload.decision.confidence || 0
        };
    }
    if (payload?.decision?.action === "PE" || payload?.decision?.direction === "PE") {
        return {
            optionType: "PE",
            quickOptions: "PUTS",
            quickDirection: payload?.decision?.bias || "DOWN",
            confidence: payload.decision.confidence || 0
        };
    }

    const quickOption = payload?.signal?.quick?.options || "WAIT";
    if (quickOption === "CALLS") {
        return {
            optionType: "CE",
            quickOptions: quickOption,
            quickDirection: payload?.signal?.quick?.direction || "UP",
            confidence: payload?.signal?.confidence || 0
        };
    }
    if (quickOption === "PUTS") {
        return {
            optionType: "PE",
            quickOptions: quickOption,
            quickDirection: payload?.signal?.quick?.direction || "DOWN",
            confidence: payload?.signal?.confidence || 0
        };
    }

    return {
        optionType: null,
        quickOptions: "WAIT",
        quickDirection: "WAIT",
        confidence: payload?.decision?.confidence || payload?.signal?.confidence || 0
    };
}

function optionBiasFromPayload(payload) {
    const decision = getDecisionSignal(payload);
    if (decision.optionType === "CE") {
        return "CE";
    }
    if (decision.optionType === "PE") {
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

function buildRiskLevels(referencePrice, signal, decision, chain, optionType, underlyingValue, vixPrice) {
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
    const ceEntry = positiveNumber(decision?.entry?.CE_above);
    const peEntry = positiveNumber(decision?.entry?.PE_below);

    return {
        stopLoss: round(referencePrice * (1 - stopLossPct), 2),
        target1: round(referencePrice * (1 + target1Pct), 2),
        target2: round(referencePrice * (1 + target2Pct), 2),
        spotInvalidation: optionType === "CE"
            ? round(peEntry || chain?.support?.strike || (underlyingValue - stepSize), 2)
            : round(ceEntry || chain?.resistance?.strike || (underlyingValue + stepSize), 2),
        spotTrigger: optionType === "CE"
            ? round(ceEntry || Math.max(chain?.support?.strike || underlyingValue, underlyingValue), 2)
            : round(peEntry || Math.min(chain?.resistance?.strike || underlyingValue, underlyingValue), 2)
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

function resolveStrikeStyle(profile, payload) {
    if (profile.strikeStyle && profile.strikeStyle !== "AUTO") {
        return profile.strikeStyle;
    }

    if (profile.tradeAggressiveness === "DEFENSIVE") {
        return payload?.decision?.action === "WAIT" ? "ATM" : "ITM";
    }
    if (profile.tradeAggressiveness === "AGGRESSIVE" && Number(payload?.decision?.confidence || 0) >= 70) {
        return "OTM";
    }

    return payload?.decision?.suggestedStrikeStyle || "ATM";
}

function normalizeEffectiveProfile(profile, chain) {
    return {
        ...profile,
        lotSize: profile.lotSize || positiveNumber(chain?.lotSize)
    };
}

function resolveTradeSetup(payload, profile) {
    const decisionSignal = getDecisionSignal(payload);
    const optionType = optionBiasFromPayload(payload);
    const instrument = profile.preferredInstrument;
    const chain = getOptionChain(payload, instrument);
    const underlyingInstrument = getUnderlyingInstrument(payload, instrument);
    const underlyingValue = positiveNumber(chain?.underlyingValue)
        || positiveNumber(payload?.decision?.marketContext?.selectedPrice)
        || positiveNumber(underlyingInstrument?.price);
    const effectiveProfile = normalizeEffectiveProfile(profile, chain);
    const strikeStyle = resolveStrikeStyle(profile, payload);

    if (!optionType) {
        return {
            actionable: false,
            optionType,
            instrument,
            chain,
            underlyingValue,
            effectiveProfile,
            reason: "The live signal does not support a clean CALLS or PUTS setup yet.",
            title: "No options trade right now",
            notation: "WAIT",
            sourceUrl: chain?.sourceUrl || null
        };
    }

    if (!chain || !Array.isArray(chain.contracts) || !chain.contracts.length || !Number.isFinite(underlyingValue)) {
        return {
            actionable: false,
            optionType,
            instrument,
            chain,
            underlyingValue,
            effectiveProfile,
            reason: `Live ${getInstrumentLabel(instrument)} option data is unavailable right now.`,
            title: "Trade plan unavailable",
            notation: "WAIT",
            sourceUrl: chain?.sourceUrl || null
        };
    }

    const shouldForceNextExpiry = (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") && chain.expiries?.[1];
    let selectedExpiry = shouldForceNextExpiry
        ? chain.expiries[1]
        : (profile.expiryPreference === "next" && chain.expiries?.[1] ? chain.expiries[1] : null);
    selectedExpiry = selectedExpiry || chain.expiries?.[0] || chain.contracts[0]?.expiryDate || null;

    let selected = chooseContract(chain, optionType, strikeStyle, underlyingValue, selectedExpiry);
    if (!selected) {
        return {
            actionable: false,
            optionType,
            instrument,
            chain,
            underlyingValue,
            effectiveProfile,
            reason: "A liquid live contract could not be found for the selected profile.",
            title: "Trade plan unavailable",
            notation: "WAIT",
            sourceUrl: chain?.sourceUrl || null
        };
    }

    let premium = buildPremiumReference(selected.leg);
    if (premium?.reference && premium.reference < 1 && chain.expiries?.[1] && selectedExpiry !== chain.expiries[1]) {
        const fallbackSelection = chooseContract(chain, optionType, strikeStyle, underlyingValue, chain.expiries[1]);
        const fallbackPremium = buildPremiumReference(fallbackSelection?.leg);
        if (fallbackSelection && fallbackPremium?.reference && fallbackPremium.reference >= premium.reference) {
            selectedExpiry = chain.expiries[1];
            selected = fallbackSelection;
            premium = fallbackPremium;
        }
    }

    const riskLevels = buildRiskLevels(
        premium?.reference,
        {
            confidence: decisionSignal.confidence
        },
        payload.decision,
        chain,
        optionType,
        underlyingValue,
        payload.india?.indiaVix?.price
    );
    const sizing = buildSizing(effectiveProfile, premium?.reference, riskLevels?.stopLoss);

    return {
        actionable: true,
        optionType,
        instrument,
        chain,
        underlyingValue,
        selectedExpiry,
        selected,
        premium,
        riskLevels,
        sizing,
        effectiveProfile: {
            ...effectiveProfile,
            strikeStyle
        },
        quickOptions: decisionSignal.quickOptions,
        sessionLabel: payload.session?.label || "Market"
    };
}

function chooseSpreadShortLeg(chain, selectedExpiry, optionType, longRow, widthSteps = 1) {
    const rows = (chain?.contracts || [])
        .filter((row) => row.expiryDate === selectedExpiry)
        .sort((left, right) => left.strikePrice - right.strikePrice);

    if (!rows.length) {
        return null;
    }

    const longIndex = rows.findIndex((row) => Number(row.strikePrice) === Number(longRow?.strikePrice));
    if (longIndex < 0) {
        return null;
    }

    const direction = optionType === "CE" ? 1 : -1;
    for (let offset = widthSteps; offset <= widthSteps + 2; offset += 1) {
        const targetIndex = longIndex + (direction * offset);
        if (targetIndex < 0 || targetIndex >= rows.length) {
            continue;
        }

        const row = rows[targetIndex];
        const leg = getLeg(row, optionType);
        if (isLiquidLeg(leg)) {
            return { row, leg, widthSteps: offset };
        }
    }

    return null;
}

function shouldPreferDebitSpread(payload, premiumReference, underlyingValue, profile = {}) {
    const confidence = Number(payload.decision?.confidence || payload.signal?.confidence || 0);
    const vix = positiveNumber(payload.india?.indiaVix?.price) || 0;
    const sessionMode = String(payload.session?.mode || "").toUpperCase();
    const preferredStructure = String(payload.decision?.optionsIntelligence?.suggestedStructure || "").toUpperCase();
    const aggressiveness = String(profile.tradeAggressiveness || "BALANCED").toUpperCase();
    const premiumRatio = premiumReference && underlyingValue
        ? premiumReference / underlyingValue
        : 0;

    return preferredStructure === "SPREAD"
        || sessionMode === "PREOPEN"
        || sessionMode === "POSTCLOSE"
        || sessionMode === "CLOSED"
        || aggressiveness === "DEFENSIVE"
        || vix >= 16
        || confidence < (aggressiveness === "AGGRESSIVE" ? 66 : 72)
        || premiumRatio >= 0.009;
}

function calculateLongBreakeven(strikePrice, optionType, premiumReference) {
    if (!Number.isFinite(strikePrice) || !Number.isFinite(premiumReference)) {
        return null;
    }

    return optionType === "CE"
        ? round(strikePrice + premiumReference, 2)
        : round(strikePrice - premiumReference, 2);
}

function formatPayoffValue(value, isCurrency = false) {
    if (value === "Open") {
        return "Open";
    }
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    return isCurrency ? `Rs ${formatValue(value)}` : formatValue(value);
}

function buildLongOptionPlaybook(payload, setup) {
    const isCall = setup.optionType === "CE";
    const premiumReference = setup.premium?.reference;
    const breakeven = calculateLongBreakeven(setup.selected.row.strikePrice, setup.optionType, premiumReference);
    const confidence = Number(payload.decision?.confidence || payload.signal?.confidence || 0);
    const vix = positiveNumber(payload.india?.indiaVix?.price);

    return {
        actionable: true,
        tone: isCall ? "bullish" : "bearish",
        title: isCall ? "Long Call" : "Long Put",
        badge: "Single-leg buy",
        summary: isCall
            ? "Momentum and controlled volatility support carrying a simple long-call structure."
            : "Directional weakness and manageable volatility support a simple long-put structure.",
        structureNote: isCall
            ? "Choose the cleaner outright call when conviction is high and premium risk is still acceptable."
            : "Choose the cleaner outright put when downside conviction is high and premium risk is still acceptable.",
        legs: [
            {
                action: "Buy",
                label: buildContractLabel(setup.instrument, setup.selectedExpiry, setup.selected.row.strikePrice, setup.optionType),
                premium: premiumReference,
                note: `Use the live entry zone ${setup.premium.zoneLabel}.`
            }
        ],
        metrics: [
            { label: "Entry cost", value: formatPayoffValue(premiumReference, true) },
            { label: "Breakeven", value: formatPayoffValue(breakeven) },
            { label: "Max loss", value: formatPayoffValue(premiumReference, true) },
            { label: "Max reward", value: "Open" }
        ],
        fitChecklist: [
            `Confidence is ${confidence}% and the dashboard bias still says ${setup.quickOptions}.`,
            `INDIA VIX ${vix ? `near ${formatValue(vix)}` : "is unavailable but not blocking the setup"} does not force a defensive structure.`,
            "Use the outright buy only if the premium stays near the entry zone and the opening confirmation holds."
        ],
        avoidChecklist: [
            "Skip the long-option buy if the premium spikes sharply before entry.",
            "Reduce size or switch to a spread if implied volatility expands further after the open.",
            "Avoid carrying the position if the signal flips to WAIT or the spot invalidation breaks."
        ],
        sourceUrl: setup.chain?.sourceUrl || null
    };
}

function buildDebitSpreadPlaybook(payload, setup) {
    const preferredWidth = Number(payload.decision?.confidence || payload.signal?.confidence || 0) >= 78 ? 2 : 1;
    const shortSelection = chooseSpreadShortLeg(
        setup.chain,
        setup.selectedExpiry,
        setup.optionType,
        setup.selected.row,
        preferredWidth
    );

    if (!shortSelection) {
        return buildLongOptionPlaybook(payload, setup);
    }

    const shortPremium = buildPremiumReference(shortSelection.leg);
    const longPremium = setup.premium?.reference;
    const shortReference = shortPremium?.reference;
    const netDebit = Number.isFinite(longPremium) && Number.isFinite(shortReference)
        ? round(longPremium - shortReference, 2)
        : null;
    const width = round(Math.abs(shortSelection.row.strikePrice - setup.selected.row.strikePrice), 2);

    if (!Number.isFinite(netDebit) || netDebit <= 0 || !Number.isFinite(width) || width <= netDebit) {
        return buildLongOptionPlaybook(payload, setup);
    }

    const isCall = setup.optionType === "CE";
    const breakeven = isCall
        ? round(setup.selected.row.strikePrice + netDebit, 2)
        : round(setup.selected.row.strikePrice - netDebit, 2);
    const maxReward = round(width - netDebit, 2);
    const rewardRisk = netDebit > 0 ? round(maxReward / netDebit, 2) : null;
    const vix = positiveNumber(payload.india?.indiaVix?.price);

    return {
        actionable: true,
        tone: isCall ? "bullish" : "bearish",
        title: isCall ? "Bull Call Spread" : "Bear Put Spread",
        badge: "Defined-risk debit spread",
        summary: isCall
            ? "Premium control matters here, so the bullish view is better expressed with a call spread."
            : "Premium control matters here, so the bearish view is better expressed with a put spread.",
        structureNote: isCall
            ? "The short call trims entry cost and theta burn while keeping upside to the next strike zone."
            : "The short put trims entry cost and theta burn while keeping downside exposure to the next strike zone.",
        legs: [
            {
                action: "Buy",
                label: buildContractLabel(setup.instrument, setup.selectedExpiry, setup.selected.row.strikePrice, setup.optionType),
                premium: longPremium,
                note: `Use the live entry zone ${setup.premium.zoneLabel}.`
            },
            {
                action: "Sell",
                label: buildContractLabel(setup.instrument, setup.selectedExpiry, shortSelection.row.strikePrice, setup.optionType),
                premium: shortReference,
                note: `Farther ${isCall ? "OTM" : "lower-strike"} hedge leg to cap cost.`
            }
        ],
        metrics: [
            { label: "Net debit", value: formatPayoffValue(netDebit, true) },
            { label: "Breakeven", value: formatPayoffValue(breakeven) },
            { label: "Max loss", value: formatPayoffValue(netDebit, true) },
            { label: "Max reward", value: formatPayoffValue(maxReward, true) },
            { label: "Reward / risk", value: Number.isFinite(rewardRisk) ? `${formatValue(rewardRisk)}x` : "Unavailable" }
        ],
        fitChecklist: [
            `INDIA VIX ${vix ? `around ${formatValue(vix)}` : "is not low enough"} favors defined risk over a naked premium buy.`,
            "The spread reduces entry cost and softens theta / IV pressure versus a single-leg option.",
            "This works best when you expect a move toward the next strike zone, not an unlimited trend day."
        ],
        avoidChecklist: [
            "Avoid the spread if the short leg is illiquid or the bid/ask widens sharply.",
            "Do not use it when you expect an outsized breakout beyond the sold strike too quickly.",
            "Stand aside if the dashboard loses the directional bias before entry."
        ],
        sourceUrl: setup.chain?.sourceUrl || null
    };
}

function buildOptionsPlaybook(payload, profile) {
    const setup = resolveTradeSetup(payload, profile);
    const pcr = setup.chain?.putCallRatio;
    const confidence = Number(payload.decision?.confidence || payload.signal?.confidence || 0);
    const vix = positiveNumber(payload.india?.indiaVix?.price);

    if (!setup.actionable) {
        return {
            actionable: false,
            tone: "wait",
            title: "Wait / No Trade",
            badge: "Capital preservation",
            summary: setup.reason,
            structureNote: "The app is intentionally standing aside until bias, volatility, and live chain quality line up better.",
            legs: [],
            metrics: [
                { label: "Bias", value: payload.decision?.direction || payload.signal?.cePeBias || "Unavailable" },
                { label: "Confidence", value: `${confidence}%` },
                { label: "VIX", value: Number.isFinite(vix) ? formatValue(vix) : "Unavailable" },
                { label: "PCR", value: Number.isFinite(pcr) ? formatValue(pcr) : "Unavailable" }
            ],
            fitChecklist: [
                "Wait for a cleaner CE or PE bias before committing premium.",
                "Let feed coverage recover if the live option chain or internals are degraded.",
                "Preserve capital when the setup is mixed instead of forcing a trade."
            ],
            avoidChecklist: [
                "Avoid revenge trades when the dashboard still says WAIT.",
                "Do not buy options only because the market moved without your setup.",
                "Skip entries when VIX is rising but the direction is still mixed."
            ],
            sourceUrl: setup.sourceUrl || null
        };
    }

    return shouldPreferDebitSpread(payload, setup.premium?.reference, setup.underlyingValue, profile)
        ? buildDebitSpreadPlaybook(payload, setup)
        : buildLongOptionPlaybook(payload, setup);
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
        engineVersion: normalizeChoice(
            rawProfile.engineVersion,
            Object.keys(DECISION_CONFIG.engineVersions),
            DEFAULT_TRADER_PROFILE.engineVersion
        ),
        sessionPreset: normalizeChoice(
            rawProfile.sessionPreset,
            ["CUSTOM", "OPEN_DRIVE", "MIDDAY_CHOP", "EXPIRY_FAST", "RISK_OFF"],
            DEFAULT_TRADER_PROFILE.sessionPreset
        ),
        tradeAggressiveness: normalizeChoice(
            rawProfile.tradeAggressiveness,
            ["DEFENSIVE", "BALANCED", "AGGRESSIVE"],
            DEFAULT_TRADER_PROFILE.tradeAggressiveness
        ),
        strikeStyle: normalizeChoice(
            rawProfile.strikeStyle,
            ["AUTO", "ATM", "ITM", "OTM"],
            DEFAULT_TRADER_PROFILE.strikeStyle
        ),
        expiryPreference: normalizeExpiryChoice(rawProfile.expiryPreference),
        lotSize: positiveNumber(rawProfile.lotSize),
        minimumConfidence: normalizeBoundedNumber(
            rawProfile.minimumConfidence,
            DEFAULT_TRADER_PROFILE.minimumConfidence,
            50,
            90
        ),
        vwapBandPercent: normalizeBoundedNumber(
            rawProfile.vwapBandPercent,
            DEFAULT_TRADER_PROFILE.vwapBandPercent,
            0.05,
            0.5
        )
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
        entryConfidence: positiveNumber(rawTrade.activeEntryConfidence || rawTrade.entryConfidence),
        lastConfidence: positiveNumber(rawTrade.activeLastConfidence || rawTrade.lastConfidence),
        acknowledgedAt: rawTrade.activeTakenAt || rawTrade.acknowledgedAt || null,
        lotSize: positiveNumber(rawTrade.activeLotSize || rawTrade.lotSize),
        maxLots: positiveNumber(rawTrade.activeMaxLots || rawTrade.maxLots)
    };
}

function buildTradePlan(payload, profile) {
    const setup = resolveTradeSetup(payload, profile);

    if (!setup.actionable) {
        return {
            actionable: false,
            notation: setup.notation,
            title: setup.title,
            reason: setup.reason,
            profile: setup.effectiveProfile,
            sourceUrl: setup.sourceUrl
        };
    }

    const planId = `${setup.instrument}:${setup.selectedExpiry}:${setup.selected.row.strikePrice}:${setup.optionType}`;
    const sideLabel = setup.optionType === "CE" ? "BUY CALL" : "BUY PUT";
    const entrySpotText = setup.optionType === "CE"
        ? `${getInstrumentLabel(setup.instrument)} should hold above ${formatValue(setup.riskLevels.spotTrigger)}`
        : `${getInstrumentLabel(setup.instrument)} should stay below ${formatValue(setup.riskLevels.spotTrigger)}`;
    const invalidationText = setup.optionType === "CE"
        ? `Exit if spot breaks below ${formatValue(setup.riskLevels.spotInvalidation)} or premium loses ${formatValue(setup.riskLevels.stopLoss)}.`
        : `Exit if spot moves above ${formatValue(setup.riskLevels.spotInvalidation)} or premium loses ${formatValue(setup.riskLevels.stopLoss)}.`;

    return {
        actionable: true,
        planId,
        notation: sideLabel,
        direction: setup.quickOptions,
        instrument: setup.instrument,
        instrumentLabel: getInstrumentLabel(setup.instrument),
        expiry: setup.selectedExpiry,
        sourceUrl: setup.chain.sourceUrl || null,
        title: `${sideLabel} ${getInstrumentLabel(setup.instrument)}`,
        reason: payload.decision?.summary
            ? `${payload.decision.summary} Live ${getInstrumentLabel(setup.instrument)} option liquidity confirms a ${setup.quickOptions} setup.`
            : `${setup.sessionLabel} plan based on live ${getInstrumentLabel(setup.instrument)} option-chain liquidity and the current ${setup.quickOptions} bias.`,
        contract: {
            symbol: setup.instrument,
            label: buildContractLabel(setup.instrument, setup.selectedExpiry, setup.selected.row.strikePrice, setup.optionType),
            strikePrice: setup.selected.row.strikePrice,
            expiry: setup.selectedExpiry,
            optionType: setup.optionType,
            identifier: setup.selected.leg.identifier,
            lastPrice: setup.selected.leg.lastPrice,
            buyPrice1: setup.selected.leg.buyPrice1,
            sellPrice1: setup.selected.leg.sellPrice1,
            openInterest: setup.selected.leg.openInterest,
            totalTradedVolume: setup.selected.leg.totalTradedVolume,
            impliedVolatility: setup.selected.leg.impliedVolatility,
            underlyingValue: setup.underlyingValue
        },
        entry: {
            premiumReference: setup.premium.reference,
            zoneLow: setup.premium.zoneLow,
            zoneHigh: setup.premium.zoneHigh,
            zoneLabel: setup.premium.zoneLabel,
            spotTrigger: setup.riskLevels.spotTrigger,
            triggerText: `Enter only if ${entrySpotText} and the dashboard still says ${setup.quickOptions}.`
        },
        exit: {
            stopLoss: setup.riskLevels.stopLoss,
            target1: setup.riskLevels.target1,
            target2: setup.riskLevels.target2,
            spotInvalidation: setup.riskLevels.spotInvalidation,
            invalidationText,
            trailText: `After target 1, trail the stop to entry (${formatValue(setup.premium.reference)}) and protect open profit.`,
            timeExitText: "If the move does not follow through by late afternoon or the session flips risk-off, close the position."
        },
        sizing: setup.sizing,
        checklist: [
            `Decision engine says ${payload.decision?.status || "WAIT"} with ${payload.decision?.confidence || 0}% confidence.`,
            `Use ${setup.effectiveProfile.strikeStyle} strike selection with ${setup.effectiveProfile.expiryPreference} expiry.`,
            `Profile preset is ${setup.effectiveProfile.sessionPreset} with ${setup.effectiveProfile.tradeAggressiveness.toLowerCase()} aggressiveness.`,
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
    const liveQuick = getDecisionSignal(payload).quickOptions;
    const currentConfidence = Number(payload?.decision?.confidence || 0);
    const previousConfidence = Number(activeTrade.lastConfidence || activeTrade.entryConfidence || currentConfidence);
    const entryConfidence = Number(activeTrade.entryConfidence || previousConfidence || currentConfidence);
    const confidenceTrend = Number.isFinite(previousConfidence)
        ? round(currentConfidence - previousConfidence, 0)
        : null;
    const confidenceFromEntry = Number.isFinite(entryConfidence)
        ? round(currentConfidence - entryConfidence, 0)
        : null;
    const premiumTrend = Number.isFinite(pnlPercent)
        ? (pnlPercent >= 12 ? "EXPANDING" : pnlPercent <= -8 ? "CONTRACTING" : "STABLE")
        : "STABLE";
    const lateSession = payload.session?.mode === "POSTCLOSE"
        || payload.session?.mode === "CLOSED"
        || payload.decision?.optionsIntelligence?.thetaRisk === "High";
    const holdSignal = String(payload?.decision?.hold?.status || "").toUpperCase();
    const feedBlocked = Boolean(payload?.feedHealth?.blocksTradeSignals);

    let action = "HOLD";
    let headline = "Hold the trade";
    let detail = "Signal, premium, and timing still support the trade plan.";

    if (feedBlocked) {
        action = "INVALIDATED";
        headline = "Critical data is stale";
        detail = "The app cannot trust the live trade state until the critical feeds refresh.";
    } else if (payload.session?.mode === "POSTCLOSE" || payload.session?.mode === "CLOSED") {
        action = "FULL_EXIT";
        headline = "Exit before session end";
        detail = "The market session is over or closing. Do not carry this as an intraday options plan.";
    } else if (
        Number.isFinite(activeTrade.spotInvalidation)
        && Number.isFinite(underlyingValue)
        && ((activeTrade.optionType === "CE" && underlyingValue <= activeTrade.spotInvalidation)
            || (activeTrade.optionType === "PE" && underlyingValue >= activeTrade.spotInvalidation))
    ) {
        action = "FULL_EXIT";
        headline = "Spot invalidation broke";
        detail = "Underlying spot has moved through the invalidation level from the original plan.";
    } else if (Number.isFinite(activeTrade.stopLoss) && currentPremium <= activeTrade.stopLoss) {
        action = "FULL_EXIT";
        headline = "Premium stop-loss hit";
        detail = "Current option premium is at or below the stored stop-loss.";
    } else if (liveQuick !== expectedQuick) {
        action = "INVALIDATED";
        headline = "Signal flipped against the trade";
        detail = `The dashboard now favors ${liveQuick || "WAIT"} instead of ${expectedQuick}.`;
    } else if (Number.isFinite(activeTrade.target2) && currentPremium >= activeTrade.target2) {
        action = "FULL_EXIT";
        headline = "Target 2 reached";
        detail = "Book the remaining position and reset for the next setup.";
    } else if (Number.isFinite(activeTrade.target1) && currentPremium >= activeTrade.target1) {
        action = "PARTIAL_EXIT";
        headline = "Book partial, then trail";
        detail = "First target is met. Book partial and trail the rest at entry or better.";
    } else if (holdSignal === "EXIT" && Number.isFinite(pnlPercent) && pnlPercent > 0) {
        action = "TRAIL";
        headline = "Trail aggressively";
        detail = "The hold logic is weakening, so tighten stops and protect the open gain.";
    } else if (holdSignal === "EXIT") {
        action = "FULL_EXIT";
        headline = "Full exit on structure break";
        detail = payload?.decision?.hold?.detail || "Structure no longer supports the trade.";
    } else if ((Number.isFinite(confidenceTrend) && confidenceTrend <= -15) || (Number.isFinite(confidenceFromEntry) && confidenceFromEntry <= -20)) {
        action = premiumTrend === "EXPANDING" ? "TRAIL" : "FULL_EXIT";
        headline = premiumTrend === "EXPANDING" ? "Confidence fell, trail now" : "Confidence collapsed";
        detail = premiumTrend === "EXPANDING"
            ? "Keep the trade only with a tighter trailing stop because confidence dropped sharply."
            : "Confidence and premium both weakened. Exit and wait for a cleaner reset.";
    } else if (lateSession && Number.isFinite(pnlPercent) && pnlPercent > 4) {
        action = "TRAIL";
        headline = "Time-based trail";
        detail = "Late-session theta risk is rising. Trail the stop and reduce holding time.";
    } else if (premiumTrend === "CONTRACTING" && Number.isFinite(pnlPercent) && pnlPercent < 0) {
        action = "TRAIL";
        headline = "Premium is contracting";
        detail = "The option premium is shrinking faster than expected. Tighten risk immediately.";
    } else if (liveQuick === expectedQuick && (pnlPercent === null || pnlPercent >= -6)) {
        action = "HOLD";
        headline = "Hold while bias is intact";
        detail = "The contract remains above stop, confidence is stable, and the live bias still supports the trade.";
    }

    return {
        action,
        label: action === "PARTIAL_EXIT"
            ? "PARTIAL EXIT"
            : action === "FULL_EXIT"
                ? "FULL EXIT"
                : action,
        headline,
        detail,
        planId: activeTrade.planId,
        contractLabel: buildContractLabel(activeTrade.instrument, activeTrade.expiry, activeTrade.strikePrice, activeTrade.optionType),
        currentPremium,
        underlyingValue,
        pnlPercent,
        currentConfidence,
        confidenceTrend,
        confidenceFromEntry,
        premiumTrend,
        timePressure: lateSession ? "High" : "Normal",
        sourceUrl: chain.sourceUrl || null,
        alertKey: `${activeTrade.planId}:${action}:${headline}:${round(currentPremium || 0, 2)}`
    };
}

module.exports = {
    buildTradePlan,
    buildOptionsPlaybook,
    monitorActiveTrade,
    normalizeActiveTrade,
    normalizeTraderProfile
};
