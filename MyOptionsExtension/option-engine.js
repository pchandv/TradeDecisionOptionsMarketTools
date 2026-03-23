(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    function evaluate(args) {
        const payload = args || {};
        const instrument = Utils.normalizeInstrumentSelection(payload.instrument || payload.selectedInstrument || "NIFTY");
        const instrumentType = payload.instrumentType || Utils.getInstrumentType(instrument);
        const tradePlan = payload.tradePlan || Utils.createEmptyTradePlan();
        const marketContext = payload.marketContext || {};
        const values = marketContext.aggregateValues || Utils.createEmptyValues();
        const spotPrice = Utils.toNumber(payload.spotPrice != null ? payload.spotPrice : values.spotPrice);
        const direction = resolveDirection(tradePlan, payload.overallSignal);

        if (!Number.isFinite(spotPrice) || direction === "NONE") {
            return createInsufficientPlan(instrument, instrumentType);
        }

        const strikeStep = Utils.getStrikeIncrement(instrument);
        const profile = resolveRiskProfile(tradePlan);
        const atmStrike = Utils.roundToStrike(spotPrice, instrument, "nearest");
        const strike = profile === "AGGRESSIVE"
            ? pickOtmStrike(atmStrike, strikeStep, direction)
            : atmStrike;
        const optionType = direction === "CE" ? "CE" : "PE";

        const premium = resolvePremium({
            instrument: instrument,
            optionType: optionType,
            strike: strike,
            instrumentType: instrumentType,
            tradePlan: tradePlan,
            marketContext: marketContext
        });

        if (!Number.isFinite(premium.value)) {
            return {
                instrument: instrument,
                instrumentType: instrumentType,
                strategyProfile: profile,
                strike: strike,
                type: optionType,
                symbol: `${instrument} ${strike} ${optionType}`,
                entryPriceRange: null,
                stopLoss: null,
                targets: [],
                premiumSource: premium.source,
                needsUserPremiumInput: true,
                message: "Option premium not available. Please input premium manually or open option chain."
            };
        }

        const base = premium.value;
        const entryMin = Utils.round(base * 0.95, 2);
        const entryMax = Utils.round(base * 1.05, 2);
        const stopLoss = Utils.round(base * 0.75, 2);
        const target1 = Utils.round(base * 1.4, 2);
        const target2 = Utils.round(base * 1.8, 2);

        return {
            instrument: instrument,
            instrumentType: instrumentType,
            strategyProfile: profile,
            strike: strike,
            type: optionType,
            symbol: `${instrument} ${strike} ${optionType}`,
            entryPriceRange: {
                min: entryMin,
                max: entryMax,
                text: `₹${Utils.formatNumber(entryMin, 2)} - ₹${Utils.formatNumber(entryMax, 2)}`
            },
            stopLoss: stopLoss,
            targets: [target1, target2],
            premiumSource: premium.source,
            needsUserPremiumInput: false,
            message: premium.source === "SCRAPED"
                ? "Premium pulled from visible page data."
                : "Premium estimated from projected spot move and delta factor."
        };
    }

    function createInsufficientPlan(instrument, instrumentType) {
        return {
            instrument: instrument,
            instrumentType: instrumentType,
            strategyProfile: "CONSERVATIVE",
            strike: null,
            type: "NONE",
            symbol: "--",
            entryPriceRange: null,
            stopLoss: null,
            targets: [],
            premiumSource: "UNAVAILABLE",
            needsUserPremiumInput: true,
            message: instrumentType === Utils.INSTRUMENT_TYPES.STOCK
                ? "Data not sufficient for stock analysis"
                : "Data not sufficient for option analysis"
        };
    }

    function resolveDirection(tradePlan, overallSignal) {
        const planDirection = String(tradePlan && tradePlan.direction || "").toUpperCase();
        if (planDirection === "CE" || planDirection === "PE") {
            return planDirection;
        }
        const signal = String(overallSignal && overallSignal.signal || "").toUpperCase();
        if (signal === "BULLISH" || signal === "WEAK_BULLISH") {
            return "CE";
        }
        if (signal === "BEARISH" || signal === "WEAK_BEARISH") {
            return "PE";
        }
        return "NONE";
    }

    function resolveRiskProfile(tradePlan) {
        const setup = String(tradePlan && tradePlan.setupQuality || "").toUpperCase();
        const status = String(tradePlan && tradePlan.status || "").toUpperCase();
        if (setup === "HIGH" || status === "AGGRESSIVE_READY") {
            return "AGGRESSIVE";
        }
        return "CONSERVATIVE";
    }

    function pickOtmStrike(atmStrike, strikeStep, direction) {
        if (!Number.isFinite(atmStrike) || !Number.isFinite(strikeStep)) {
            return atmStrike;
        }
        if (direction === "CE") {
            return atmStrike + strikeStep;
        }
        if (direction === "PE") {
            return atmStrike - strikeStep;
        }
        return atmStrike;
    }

    function resolvePremium(args) {
        const scraped = readPremiumFromSnapshots(args.marketContext, args.optionType, args.strike);
        if (Number.isFinite(scraped)) {
            return {
                value: Utils.round(scraped, 2),
                source: "SCRAPED"
            };
        }

        const estimated = estimatePremium(args.tradePlan, args.instrumentType);
        if (Number.isFinite(estimated)) {
            return {
                value: Utils.round(estimated, 2),
                source: "ESTIMATED"
            };
        }

        return {
            value: null,
            source: "USER_INPUT_REQUIRED"
        };
    }

    function estimatePremium(tradePlan, instrumentType) {
        const projectedMove = tradePlan && tradePlan.projectedMove ? tradePlan.projectedMove : null;
        const expectedSpotMove = Math.abs(Utils.toNumber(projectedMove && projectedMove.expectedPoints) || 0);
        if (!Number.isFinite(expectedSpotMove) || expectedSpotMove <= 0) {
            return null;
        }

        const deltaFactor = instrumentType === Utils.INSTRUMENT_TYPES.STOCK ? 0.38 : 0.45;
        return expectedSpotMove * deltaFactor;
    }

    function readPremiumFromSnapshots(marketContext, optionType, strike) {
        const snapshots = Array.isArray(marketContext && marketContext.snapshots) ? marketContext.snapshots : [];
        if (!snapshots.length) {
            return null;
        }

        const strikePattern = Number.isFinite(strike) ? String(Math.round(strike)) : "";
        for (let index = snapshots.length - 1; index >= 0; index -= 1) {
            const rawSignals = Array.isArray(snapshots[index].rawSignals) ? snapshots[index].rawSignals : [];
            const blob = rawSignals.join(" ");
            const byStrike = strikePattern
                ? blob.match(new RegExp(`${strikePattern}\\s*${optionType}\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)`, "i"))
                : null;
            if (byStrike && byStrike[1]) {
                const value = Utils.toNumber(byStrike[1]);
                if (Number.isFinite(value)) {
                    return value;
                }
            }

            const generic = blob.match(new RegExp(`${optionType}\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)`, "i"));
            if (generic && generic[1]) {
                const genericValue = Utils.toNumber(generic[1]);
                if (Number.isFinite(genericValue)) {
                    return genericValue;
                }
            }
        }

        return null;
    }

    global.OptionsOptionEngine = {
        evaluate: evaluate
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
