(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const SIDE_BY_BIAS = {
        BULLISH: "CE",
        WEAK_BULLISH: "CE",
        BEARISH: "PE",
        WEAK_BEARISH: "PE",
        WAIT: "NONE"
    };

    const EMPTY_RESULT = {
        contract: {
            label: "--",
            strike: null,
            side: "NONE",
            premiumSource: "NONE"
        },
        pricing: {
            currentPremium: null,
            entryZone: {
                min: null,
                max: null,
                note: "Premium entry zone is not available."
            },
            stopLoss: {
                value: null,
                type: "NONE",
                note: "Premium stop loss is not available."
            },
            targets: [
                { label: "T1", value: null, note: "No target available." },
                { label: "T2", value: null, note: "No target available." }
            ]
        },
        setupQuality: "AVOID",
        riskReward: {
            rrToT1: "N/A",
            rrToT2: "N/A",
            numericRrT1: null,
            numericRrT2: null
        },
        warnings: ["Premium setup unavailable."],
        reasoning: ["Insufficient option inputs for premium planning."],
        statusNote: "No actionable premium setup.",
        shouldWaitForConfirmation: true
    };

    // Main entry point: converts directional context into a premium trade plan.
    function evaluate(input, settings) {
        const context = normalizeContext(input, settings);
        const warnings = [];
        const reasoning = [];

        if (context.marketBias === "WAIT") {
            return buildNoTradeResult("Overall bias is WAIT, so no contract is suggested.");
        }

        const contract = selectBestContract(context);
        if (!contract || contract.side === "NONE" || !Number.isFinite(contract.strike)) {
            return buildNoTradeResult("No suitable contract was found for the current context.");
        }

        const premiumInfo = getLivePremiumForContract(contract, context.optionChain, context.extractedPageData);
        let currentPremium = premiumInfo.premium;
        let premiumSource = premiumInfo.premiumSource;

        if (!Number.isFinite(currentPremium)) {
            if (!context.allowEstimatedPremium) {
                warnings.push("Live premium is unavailable and estimated premium is disabled in settings.");
                return buildNoTradeResult("Premium data is missing. Enable estimated premium or open an option chain page.", warnings);
            }

            const estimate = estimatePremium(context, contract);
            currentPremium = estimate.premium;
            premiumSource = "ESTIMATED";
            warnings.push("Current premium is estimated because live option data is unavailable.");
            reasoning.push(estimate.note);
        } else if (premiumSource === "SCRAPED") {
            warnings.push("Premium is scraped from visible page text. Validate against option chain before entry.");
        } else {
            reasoning.push("Live option premium was used from option-chain data.");
        }

        if (!Number.isFinite(currentPremium) || currentPremium <= 0) {
            return buildNoTradeResult("Premium could not be resolved to a usable positive value.");
        }

        currentPremium = Utils.round(currentPremium, 2);

        const entryZone = calculateEntryZone(currentPremium, context);
        const stopLoss = calculatePremiumStopLoss(currentPremium, context, contract);
        const targets = calculatePremiumTargets(currentPremium, context, contract);
        const riskReward = calculateRiskReward(entryZone, stopLoss, targets);
        const baseAlignment = isTrendAligned(context);
        const isMixedStructure = context.structure === "MIXED" || context.structure === "SIDEWAYS";
        const hasKeyLevels = Number.isFinite(context.support) || Number.isFinite(context.resistance);
        const isExtremeVolatility = Number.isFinite(context.vix) && context.vix >= context.highVixCutoff;

        if (isExtremeVolatility) {
            warnings.push("Volatility is elevated. Premium decay and whipsaws can be extreme.");
        }

        if (isMixedStructure && !baseAlignment) {
            warnings.push("Structure is mixed and trend alignment is weak.");
        }

        if (!hasKeyLevels) {
            warnings.push("Support/resistance levels are missing, so invalidation and target mapping are less reliable.");
        }

        if (riskReward.numericRrT1 != null && riskReward.numericRrT1 < context.minimumAcceptableRr) {
            warnings.push(`Risk-reward to T1 is below minimum threshold (${context.minimumAcceptableRr}).`);
        }

        const quality = resolveSetupQuality({
            context: context,
            premiumSource: premiumSource,
            riskReward: riskReward,
            hasKeyLevels: hasKeyLevels,
            isMixedStructure: isMixedStructure,
            baseAlignment: baseAlignment,
            isExtremeVolatility: isExtremeVolatility
        });

        const shouldWaitForConfirmation = shouldWait(context, quality);
        if (shouldWaitForConfirmation) {
            warnings.push("Candidate only. Wait for confirmation before entry.");
        }

        reasoning.push(buildContextReason(context, contract, premiumSource));
        reasoning.push(buildExecutionReason(context, shouldWaitForConfirmation));

        return {
            contract: {
                label: contract.contractLabel,
                strike: contract.strike,
                side: contract.side,
                premiumSource: premiumSource
            },
            pricing: {
                currentPremium: currentPremium,
                entryZone: entryZone,
                stopLoss: stopLoss,
                targets: targets
            },
            setupQuality: quality,
            riskReward: riskReward,
            warnings: Utils.pickSummaryReasoning(warnings, 8),
            reasoning: Utils.pickSummaryReasoning(reasoning, 10),
            statusNote: shouldWaitForConfirmation
                ? "Candidate only. Do not enter until confirmation."
                : "Setup is actionable if your chart confirms this bias.",
            shouldWaitForConfirmation: shouldWaitForConfirmation
        };
    }

    function buildNoTradeResult(reason, extraWarnings) {
        const base = JSON.parse(JSON.stringify(EMPTY_RESULT));
        base.reasoning = [reason || "No actionable premium setup."];
        base.warnings = Array.isArray(extraWarnings) && extraWarnings.length
            ? Utils.pickSummaryReasoning(extraWarnings, 6)
            : ["No premium trade suggested."];
        base.statusNote = "No premium setup.";
        base.shouldWaitForConfirmation = true;
        return base;
    }

    function normalizeContext(input, settings) {
        const payload = input || {};
        const activeSettings = settings || Utils.DEFAULT_SETTINGS;
        const instrument = Utils.normalizeInstrumentSelection(payload.instrument || "NIFTY");
        const instrumentType = payload.instrumentType || Utils.getInstrumentType(instrument);
        const marketBias = normalizeMarketBias(payload.marketBias);
        const optionChain = Utils.normalizeOptionChain(payload.optionChain);
        const selectedRiskMode = Utils.normalizePremiumRiskMode(payload.selectedRiskMode || activeSettings.defaultPremiumRiskMode);

        return {
            instrument: instrument,
            instrumentType: instrumentType,
            marketBias: marketBias,
            confidence: Utils.clamp(Utils.toNumber(payload.confidence) || 0, 0, 100),
            spotPrice: Utils.toNumber(payload.spotPrice),
            trend15m: String(payload.trend15m || "").toUpperCase(),
            trend1h: String(payload.trend1h || "").toUpperCase(),
            support: Utils.toNumber(payload.support),
            resistance: Utils.toNumber(payload.resistance),
            breakout: Boolean(payload.breakout),
            breakdown: Boolean(payload.breakdown),
            structure: String(payload.structure || "MIXED").toUpperCase(),
            vix: Utils.toNumber(payload.vix),
            pcr: Utils.toNumber(payload.pcr),
            maxPain: Utils.toNumber(payload.maxPain),
            selectedRiskMode: selectedRiskMode,
            optionChain: optionChain,
            extractedPageData: Utils.normalizeExtractedOptionPremiums(payload.extractedPageData),
            entryType: String(payload.entryType || "NONE").toUpperCase(),
            tradeStatus: String(payload.tradeStatus || "NO_TRADE").toUpperCase(),
            minimumAcceptableRr: Utils.toNumber(activeSettings.premiumMinAcceptableRr) || 1.4,
            allowEstimatedPremium: activeSettings.allowEstimatedPremium !== false,
            highVixCutoff: (Utils.toNumber(activeSettings.highVixThreshold) || 18) + 6,
            settings: activeSettings
        };
    }

    function normalizeMarketBias(value) {
        const upper = String(value || "WAIT").toUpperCase();
        if (SIDE_BY_BIAS[upper]) {
            return upper;
        }
        return "WAIT";
    }

    function getStrikeStep(instrument, instrumentType, settings) {
        const normalizedInstrument = Utils.normalizeInstrumentSelection(instrument);
        const stepFromSymbol = Utils.getStrikeIncrement(normalizedInstrument);
        if (Number.isFinite(stepFromSymbol) && stepFromSymbol > 0) {
            return stepFromSymbol;
        }

        if (instrumentType === Utils.INSTRUMENT_TYPES.STOCK) {
            const stockFallback = Utils.toNumber(settings && settings.stockOptionStrikeStep);
            return Number.isFinite(stockFallback) && stockFallback > 0 ? stockFallback : 20;
        }

        return 50;
    }

    function getNearestATMStrike(spotPrice, strikeStep) {
        if (!Number.isFinite(spotPrice) || !Number.isFinite(strikeStep) || strikeStep <= 0) {
            return null;
        }
        return Math.round(spotPrice / strikeStep) * strikeStep;
    }

    // Chooses CE/PE strike by risk mode and liquidity quality from available chain rows.
    function selectBestContract(context) {
        const side = SIDE_BY_BIAS[context.marketBias] || "NONE";
        if (side === "NONE") {
            return {
                strike: null,
                side: "NONE",
                contractLabel: "--",
                moneyness: "NONE"
            };
        }

        const strikeStep = getStrikeStep(context.instrument, context.instrumentType, context.settings);
        const atmStrike = getNearestATMStrike(context.spotPrice, strikeStep);
        if (!Number.isFinite(atmStrike)) {
            return {
                strike: null,
                side: "NONE",
                contractLabel: "--",
                moneyness: "NONE"
            };
        }

        const preferredStrike = chooseStrikeByRiskMode(context.selectedRiskMode, side, atmStrike, strikeStep);
        const chain = context.optionChain && Array.isArray(context.optionChain.strikes)
            ? context.optionChain.strikes
            : [];
        const candidates = dedupeNumbers([
            preferredStrike,
            atmStrike,
            atmStrike + strikeStep,
            atmStrike - strikeStep,
            preferredStrike + strikeStep,
            preferredStrike - strikeStep
        ]);

        if (!chain.length) {
            return buildContract(context.instrument, preferredStrike, side, context.spotPrice);
        }

        const scored = candidates.map((strike) => {
            const row = chain.find((item) => Number(item.strike) === Number(strike));
            return scoreOptionRow(row, strike, preferredStrike, side, context);
        }).filter(Boolean).sort((left, right) => right.score - left.score);

        if (scored.length && scored[0].row && Number.isFinite(scored[0].row.strike)) {
            return buildContract(context.instrument, scored[0].row.strike, side, context.spotPrice);
        }

        return buildContract(context.instrument, preferredStrike, side, context.spotPrice);
    }

    function chooseStrikeByRiskMode(riskMode, side, atmStrike, strikeStep) {
        if (!Number.isFinite(atmStrike) || !Number.isFinite(strikeStep)) {
            return atmStrike;
        }

        if (riskMode === Utils.PREMIUM_RISK_MODES.CONSERVATIVE) {
            if (side === "CE") {
                return atmStrike - strikeStep;
            }
            if (side === "PE") {
                return atmStrike + strikeStep;
            }
            return atmStrike;
        }

        if (riskMode === Utils.PREMIUM_RISK_MODES.AGGRESSIVE) {
            if (side === "CE") {
                return atmStrike + strikeStep;
            }
            if (side === "PE") {
                return atmStrike - strikeStep;
            }
            return atmStrike;
        }

        return atmStrike;
    }

    function scoreOptionRow(row, strike, preferredStrike, side, context) {
        const strikeDistancePenalty = Math.abs((strike - preferredStrike) / Math.max(1, getStrikeStep(context.instrument, context.instrumentType, context.settings))) * 8;
        let score = 60 - strikeDistancePenalty;

        if (!row) {
            return {
                row: null,
                score: score - 40
            };
        }

        const ltp = side === "CE" ? Utils.toNumber(row.ceLtp) : Utils.toNumber(row.peLtp);
        const oi = side === "CE" ? Utils.toNumber(row.ceOi) : Utils.toNumber(row.peOi);
        const iv = side === "CE" ? Utils.toNumber(row.ceIv) : Utils.toNumber(row.peIv);

        if (Number.isFinite(ltp) && ltp > 0) {
            score += ltp < 8 ? 6 : 15;
            score += ltp > 4 ? 6 : 0;
        } else {
            score -= 25;
        }

        if (Number.isFinite(oi) && oi > 0) {
            score += 8;
            if (oi > 10000) {
                score += 4;
            }
        }

        if (Number.isFinite(iv)) {
            if (iv >= 45 && context.selectedRiskMode !== Utils.PREMIUM_RISK_MODES.AGGRESSIVE) {
                score -= 10;
            } else if (iv <= 9) {
                score -= 4;
            } else {
                score += 3;
            }
        }

        return {
            row: row,
            score: score
        };
    }

    function buildContract(instrument, strike, side, spot) {
        const normalizedStrike = Number.isFinite(strike) ? Utils.round(strike, 2) : null;
        const label = normalizedStrike != null ? `${instrument} ${Math.round(normalizedStrike)} ${side}` : "--";
        return {
            strike: normalizedStrike,
            side: side,
            contractLabel: label,
            moneyness: classifyMoneyness(normalizedStrike, spot, side)
        };
    }

    function classifyMoneyness(strike, spot, side) {
        if (!Number.isFinite(strike) || !Number.isFinite(spot)) {
            return "UNKNOWN";
        }
        const diff = strike - spot;
        if (Math.abs(diff) <= 0.0001) {
            return "ATM";
        }
        if (side === "CE") {
            return diff < 0 ? "ITM" : "OTM";
        }
        if (side === "PE") {
            return diff > 0 ? "ITM" : "OTM";
        }
        return "UNKNOWN";
    }

    function getLivePremiumForContract(contract, optionChain, extractedPageData) {
        const row = findChainStrike(optionChain, contract.strike);
        if (row) {
            const ltp = contract.side === "CE" ? Utils.toNumber(row.ceLtp) : Utils.toNumber(row.peLtp);
            if (Number.isFinite(ltp) && ltp > 0) {
                return {
                    premium: Utils.round(ltp, 2),
                    premiumSource: "LIVE"
                };
            }
        }

        const scraped = resolveScrapedPremium(contract, extractedPageData);
        if (Number.isFinite(scraped) && scraped > 0) {
            return {
                premium: Utils.round(scraped, 2),
                premiumSource: "SCRAPED"
            };
        }

        return {
            premium: null,
            premiumSource: "NONE"
        };
    }

    function findChainStrike(optionChain, strike) {
        const rows = optionChain && Array.isArray(optionChain.strikes) ? optionChain.strikes : [];
        if (!Number.isFinite(strike)) {
            return null;
        }
        return rows.find((item) => Number(item.strike) === Number(strike)) || null;
    }

    function resolveScrapedPremium(contract, extractedPageData) {
        const map = extractedPageData || {};
        const strikeKey = String(Math.round(contract.strike || 0));
        const side = String(contract.side || "NONE").toUpperCase();
        const label = String(contract.contractLabel || "").toUpperCase();
        const keys = [
            `${strikeKey}-${side}`,
            `${strikeKey} ${side}`,
            `${label}`,
            `${strikeKey}${side}`
        ];

        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            const value = Utils.toNumber(map[key]);
            if (Number.isFinite(value) && value > 0) {
                return value;
            }
        }

        return null;
    }

    // Fallback estimator when live/scraped premium is missing.
    function estimatePremium(context, contract) {
        const strikeStep = getStrikeStep(context.instrument, context.instrumentType, context.settings);
        const atm = getNearestATMStrike(context.spotPrice, strikeStep);
        const distanceSteps = Number.isFinite(atm) && Number.isFinite(contract.strike)
            ? Math.abs(contract.strike - atm) / Math.max(1, strikeStep)
            : 0;

        const intrinsic = calculateIntrinsic(contract.side, context.spotPrice, contract.strike);
        const baseAtm = estimateBaseAtmPremium(context, strikeStep);
        const distanceFactor = Math.max(0.25, Math.exp(-0.42 * distanceSteps));
        const volatilityFactor = deriveVolatilityFactor(context.vix);
        const confidenceFactor = Utils.clamp(0.75 + (context.confidence / 220), 0.75, 1.3);
        const weakBiasFactor = /WEAK/.test(context.marketBias) ? 0.9 : 1;
        const timeValue = baseAtm * distanceFactor * volatilityFactor * confidenceFactor * weakBiasFactor;
        const premium = Math.max(1, intrinsic + timeValue);

        return {
            premium: Utils.round(premium, 2),
            confidence: "LOW",
            note: "Estimated because live option premium is not available."
        };
    }

    function calculateIntrinsic(side, spot, strike) {
        if (!Number.isFinite(spot) || !Number.isFinite(strike)) {
            return 0;
        }
        if (side === "CE") {
            return Math.max(0, spot - strike);
        }
        if (side === "PE") {
            return Math.max(0, strike - spot);
        }
        return 0;
    }

    function estimateBaseAtmPremium(context, strikeStep) {
        const spot = Utils.toNumber(context.spotPrice);
        if (!Number.isFinite(spot)) {
            return Math.max(12, strikeStep * 0.9);
        }

        if (context.instrumentType === Utils.INSTRUMENT_TYPES.INDEX) {
            if (context.instrument === "BANKNIFTY") {
                return Math.max(45, spot * 0.0026);
            }
            return Math.max(25, spot * 0.003);
        }

        return Math.max(8, strikeStep * 0.8);
    }

    function deriveVolatilityFactor(vix) {
        if (!Number.isFinite(vix)) {
            return 1;
        }
        if (vix >= 28) {
            return 1.45;
        }
        if (vix >= 22) {
            return 1.28;
        }
        if (vix >= 18) {
            return 1.12;
        }
        if (vix <= 12) {
            return 0.82;
        }
        return 1;
    }

    function calculateEntryZone(contractPremium, context) {
        if (!Number.isFinite(contractPremium) || contractPremium <= 0) {
            return {
                min: null,
                max: null,
                note: "Premium entry zone is not available."
            };
        }

        const chasePct = resolveRiskSetting(context, "premiumChaseBuffer");
        const pullbackPct = resolveRiskSetting(context, "premiumPullbackBuffer");

        if (context.breakout || context.breakdown || context.entryType === "BREAKOUT" || context.entryType === "BREAKDOWN") {
            return {
                min: Utils.round(contractPremium, 2),
                max: Utils.round(contractPremium * (1 + (chasePct / 100)), 2),
                note: "Breakout/breakdown setup: allow a small chase above current premium."
            };
        }

        if (context.entryType === "PULLBACK" || /WEAK/.test(context.marketBias)) {
            return {
                min: Utils.round(Math.max(0.5, contractPremium * (1 - (pullbackPct / 100))), 2),
                max: Utils.round(contractPremium, 2),
                note: "Pullback setup: prefer buying closer to premium dips."
            };
        }

        return {
            min: Utils.round(Math.max(0.5, contractPremium * (1 - ((pullbackPct * 0.5) / 100))), 2),
            max: Utils.round(contractPremium * (1 + ((chasePct * 0.5) / 100)), 2),
            note: "Balanced setup: use a tight premium band around current price."
        };
    }

    // Prioritizes spot-mapped invalidation, then falls back to configured premium %.
    function calculatePremiumStopLoss(contractPremium, context, contract) {
        if (!Number.isFinite(contractPremium) || contractPremium <= 0) {
            return {
                value: null,
                type: "NONE",
                note: "Premium stop loss is not available."
            };
        }

        const invalidationLevel = resolveInvalidationLevel(context, contract.side);
        const delta = estimateDelta(context, contract);
        if (Number.isFinite(invalidationLevel) && Number.isFinite(context.spotPrice)) {
            const spotRisk = Math.abs(context.spotPrice - invalidationLevel);
            if (spotRisk > 0 && Number.isFinite(delta) && delta > 0) {
                const mappedPremiumRisk = spotRisk * delta;
                const mappedStop = contractPremium - mappedPremiumRisk;
                if (Number.isFinite(mappedStop) && mappedStop > 0.5) {
                    return {
                        value: Utils.round(mappedStop, 2),
                        type: "SPOT_MAPPED",
                        note: "Stop loss maps spot invalidation to premium risk using approximate delta."
                    };
                }
            }
        }

        const fallbackPct = resolveRiskSetting(context, "premiumStopLoss");
        const fallback = contractPremium * (1 - (fallbackPct / 100));
        return {
            value: Utils.round(Math.max(0.5, fallback), 2),
            type: "PERCENT_FALLBACK",
            note: "Fallback stop uses configured premium percentage."
        };
    }

    function resolveInvalidationLevel(context, side) {
        if (side === "CE") {
            return Number.isFinite(context.support) ? context.support : null;
        }
        if (side === "PE") {
            return Number.isFinite(context.resistance) ? context.resistance : null;
        }
        return null;
    }

    function calculatePremiumTargets(contractPremium, context, contract) {
        if (!Number.isFinite(contractPremium) || contractPremium <= 0) {
            return [
                { label: "T1", value: null, note: "No target available." },
                { label: "T2", value: null, note: "No target available." }
            ];
        }

        const delta = estimateDelta(context, contract);
        const target1Spot = resolveSpotTarget(context, contract.side, 1);
        const target2Spot = resolveSpotTarget(context, contract.side, 2);
        const t1Mapped = mapSpotTargetToPremium(contractPremium, context.spotPrice, target1Spot, delta);
        const t2Mapped = mapSpotTargetToPremium(contractPremium, context.spotPrice, target2Spot, delta);

        const fallbackT1Pct = resolveRiskSetting(context, "premiumTarget1");
        const fallbackT2Pct = resolveRiskSetting(context, "premiumTarget2");
        const fallbackT1 = Utils.round(contractPremium * (1 + (fallbackT1Pct / 100)), 2);
        const fallbackT2 = Utils.round(contractPremium * (1 + (fallbackT2Pct / 100)), 2);

        return [
            {
                label: "T1",
                value: Number.isFinite(t1Mapped) ? Utils.round(t1Mapped, 2) : fallbackT1,
                note: Number.isFinite(t1Mapped)
                    ? "Mapped from the next spot level."
                    : "Fallback target based on configured premium percentage."
            },
            {
                label: "T2",
                value: Number.isFinite(t2Mapped) ? Utils.round(Math.max(t2Mapped, fallbackT1), 2) : fallbackT2,
                note: Number.isFinite(t2Mapped)
                    ? "Mapped from the major spot level."
                    : "Fallback target based on configured premium percentage."
            }
        ];
    }

    function resolveSpotTarget(context, side, targetOrder) {
        const step = getStrikeStep(context.instrument, context.instrumentType, context.settings);
        const spot = context.spotPrice;
        if (!Number.isFinite(spot)) {
            return null;
        }

        if (side === "CE") {
            if (targetOrder === 1) {
                if (context.breakout) {
                    return spot + step;
                }
                if (Number.isFinite(context.resistance) && context.resistance > spot) {
                    return context.resistance;
                }
                if (Number.isFinite(context.maxPain) && context.maxPain > spot) {
                    return context.maxPain;
                }
                return spot + step;
            }
            if (context.breakout) {
                return spot + (step * 2.2);
            }
            if (Number.isFinite(context.resistance) && context.resistance > spot) {
                return context.resistance + (step * 1.5);
            }
            return spot + (step * 2.4);
        }

        if (targetOrder === 1) {
            if (context.breakdown) {
                return spot - step;
            }
            if (Number.isFinite(context.support) && context.support < spot) {
                return context.support;
            }
            if (Number.isFinite(context.maxPain) && context.maxPain < spot) {
                return context.maxPain;
            }
            return spot - step;
        }
        if (context.breakdown) {
            return spot - (step * 2.2);
        }
        if (Number.isFinite(context.support) && context.support < spot) {
            return context.support - (step * 1.5);
        }
        return spot - (step * 2.4);
    }

    function mapSpotTargetToPremium(currentPremium, spot, spotTarget, delta) {
        if (!Number.isFinite(currentPremium) || !Number.isFinite(spot) || !Number.isFinite(spotTarget) || !Number.isFinite(delta)) {
            return null;
        }
        const spotMove = Math.abs(spotTarget - spot);
        if (spotMove <= 0) {
            return null;
        }
        return currentPremium + (spotMove * delta);
    }

    function estimateDelta(context, contract) {
        const moneyness = String(contract.moneyness || "ATM").toUpperCase();
        if (moneyness === "ITM") {
            return 0.62;
        }
        if (moneyness === "OTM") {
            return context.selectedRiskMode === Utils.PREMIUM_RISK_MODES.AGGRESSIVE ? 0.42 : 0.34;
        }
        return 0.5;
    }

    function calculateRiskReward(entryZone, stopLoss, targets) {
        const entryMid = resolveEntryMidpoint(entryZone);
        const stop = stopLoss && Number.isFinite(stopLoss.value) ? stopLoss.value : null;
        const t1 = targets && targets[0] && Number.isFinite(targets[0].value) ? targets[0].value : null;
        const t2 = targets && targets[1] && Number.isFinite(targets[1].value) ? targets[1].value : null;

        if (!Number.isFinite(entryMid) || !Number.isFinite(stop)) {
            return {
                rrToT1: "N/A",
                rrToT2: "N/A",
                numericRrT1: null,
                numericRrT2: null
            };
        }

        const risk = entryMid - stop;
        if (!Number.isFinite(risk) || risk <= 0) {
            return {
                rrToT1: "N/A",
                rrToT2: "N/A",
                numericRrT1: null,
                numericRrT2: null
            };
        }

        const rr1 = Number.isFinite(t1) ? (t1 - entryMid) / risk : null;
        const rr2 = Number.isFinite(t2) ? (t2 - entryMid) / risk : null;

        return {
            rrToT1: Number.isFinite(rr1) && rr1 > 0 ? `1:${Utils.round(rr1, 2)}` : "N/A",
            rrToT2: Number.isFinite(rr2) && rr2 > 0 ? `1:${Utils.round(rr2, 2)}` : "N/A",
            numericRrT1: Number.isFinite(rr1) && rr1 > 0 ? Utils.round(rr1, 3) : null,
            numericRrT2: Number.isFinite(rr2) && rr2 > 0 ? Utils.round(rr2, 3) : null
        };
    }

    function resolveEntryMidpoint(entryZone) {
        if (!entryZone) {
            return null;
        }
        const min = Utils.toNumber(entryZone.min);
        const max = Utils.toNumber(entryZone.max);
        if (Number.isFinite(min) && Number.isFinite(max)) {
            return (min + max) / 2;
        }
        return Number.isFinite(max) ? max : Number.isFinite(min) ? min : null;
    }

    // Applies safety gates and quality grading for UI confidence signaling.
    function resolveSetupQuality(args) {
        const context = args.context;
        const premiumSource = args.premiumSource;
        const riskReward = args.riskReward;
        const hasKeyLevels = args.hasKeyLevels;
        const isMixedStructure = args.isMixedStructure;
        const baseAlignment = args.baseAlignment;
        const isExtremeVolatility = args.isExtremeVolatility;

        if (context.marketBias === "WAIT") {
            return "AVOID";
        }

        if (!hasKeyLevels) {
            return "AVOID";
        }

        if (isMixedStructure && !baseAlignment) {
            return "AVOID";
        }

        if (isExtremeVolatility && context.selectedRiskMode !== Utils.PREMIUM_RISK_MODES.AGGRESSIVE) {
            return "LOW";
        }

        if (premiumSource === "ESTIMATED") {
            return /WEAK/.test(context.marketBias) ? "LOW" : "MEDIUM";
        }

        const rrGood = Number.isFinite(riskReward.numericRrT1) && riskReward.numericRrT1 >= context.minimumAcceptableRr;
        const strongBias = context.marketBias === "BULLISH" || context.marketBias === "BEARISH";

        if (strongBias && baseAlignment && rrGood && (premiumSource === "LIVE" || premiumSource === "SCRAPED")) {
            return "HIGH";
        }

        if (rrGood) {
            return strongBias ? "MEDIUM" : "LOW";
        }

        return "LOW";
    }

    function isTrendAligned(context) {
        if (context.marketBias === "BULLISH" || context.marketBias === "WEAK_BULLISH") {
            return context.trend15m === "BULLISH" && (context.trend1h === "BULLISH" || context.trend1h === "SIDEWAYS");
        }
        if (context.marketBias === "BEARISH" || context.marketBias === "WEAK_BEARISH") {
            return context.trend15m === "BEARISH" && (context.trend1h === "BEARISH" || context.trend1h === "SIDEWAYS");
        }
        return false;
    }

    function shouldWait(context, quality) {
        if (quality === "AVOID") {
            return true;
        }
        if (context.tradeStatus === "WAIT_CONFIRMATION" || context.tradeStatus === "NO_TRADE") {
            return true;
        }
        if (/WEAK/.test(context.marketBias)) {
            return true;
        }
        if (!(context.breakout || context.breakdown) && context.entryType !== "PULLBACK") {
            return true;
        }
        return false;
    }

    function buildContextReason(context, contract, premiumSource) {
        const strike = Number.isFinite(contract.strike) ? Math.round(contract.strike) : "--";
        return `${context.marketBias} bias points to ${context.instrument} ${strike} ${contract.side}, premium source: ${premiumSource}.`;
    }

    function buildExecutionReason(context, shouldWaitForConfirmation) {
        if (shouldWaitForConfirmation) {
            if (context.breakdown) {
                return "Candidate only: wait for a clean breakdown confirmation before entry.";
            }
            if (context.breakout) {
                return "Candidate only: wait for breakout hold confirmation before entry.";
            }
            return "Candidate only: wait for confirmation from price action.";
        }
        return "Entry can be considered if price action confirms this setup on your chart.";
    }

    function resolveRiskSetting(context, prefix) {
        const mode = context.selectedRiskMode;
        const suffix = mode === Utils.PREMIUM_RISK_MODES.CONSERVATIVE
            ? "ConservativePct"
            : mode === Utils.PREMIUM_RISK_MODES.AGGRESSIVE
                ? "AggressivePct"
                : "BalancedPct";
        const key = `${prefix}${suffix}`;
        const value = Utils.toNumber(context.settings && context.settings[key]);
        return Number.isFinite(value) ? value : 0;
    }

    function dedupeNumbers(values) {
        const seen = {};
        const list = [];
        (values || []).forEach((value) => {
            if (!Number.isFinite(value)) {
                return;
            }
            const key = String(Math.round(value * 100) / 100);
            if (!seen[key]) {
                seen[key] = true;
                list.push(value);
            }
        });
        return list;
    }

    global.OptionsOptionPremiumEngine = {
        evaluate: evaluate,
        getStrikeStep: getStrikeStep,
        getNearestATMStrike: getNearestATMStrike,
        selectBestContract: selectBestContract,
        getLivePremiumForContract: getLivePremiumForContract,
        estimatePremium: estimatePremium,
        calculateEntryZone: calculateEntryZone,
        calculatePremiumStopLoss: calculatePremiumStopLoss,
        calculatePremiumTargets: calculatePremiumTargets,
        calculateRiskReward: calculateRiskReward
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
