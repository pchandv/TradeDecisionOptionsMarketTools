(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const SIGNALS = {
        WAIT: "WAIT",
        BULLISH: "BULLISH",
        BEARISH: "BEARISH",
        WEAK_BULLISH: "WEAK_BULLISH",
        WEAK_BEARISH: "WEAK_BEARISH"
    };

    const STRENGTH = {
        STRONG: "STRONG",
        MODERATE: "MODERATE",
        WEAK: "WEAK"
    };

    const ENGINE_DEFAULTS = {
        pcrStrongBullishWeight: 25,
        pcrMildBullishWeight: 10,
        pcrStrongBearishWeight: 25,
        maxPainWeight: 15,
        momentumWeight: 10,
        vixBearishWeight: 20,
        vixBullishWeight: 10,
        oiWeight: 15,
        pageSignalWeight: 20,
        sessionPriceActionStrongWeight: 18,
        sessionPriceActionMildWeight: 10,
        nearSupportWeight: 12,
        nearResistanceWeight: 12,
        breakoutWeight: 24,
        breakdownWeight: 24,
        strongLevelBonus: 4,
        structureTrendWeight: 10,
        structurePatternWeight: 12,
        structureMomentumWeight: 8,
        structureTradeActionWeight: 10,
        momentumBoostWeight: 10,
        momentumBoostConditionCount: 3,
        weakSignalFloor: 30,
        directionalSignalFloor: 45,
        strongSignalFloor: 70,
        balancedScoreGap: 6,
        missingFactorPenalty: 12,
        conflictPenalty: 14,
        severeConflictPenalty: 22,
        lowExtractorPenalty: 8
    };

    function getConfig(settings) {
        const bullishPcrThreshold = Utils.toNumber(settings && settings.bullishPcrThreshold);
        const bearishPcrThreshold = Utils.toNumber(settings && settings.bearishPcrThreshold);
        const elevatedVixThreshold = Utils.toNumber(settings && settings.elevatedVixThreshold);
        const highVixThreshold = Utils.toNumber(settings && settings.highVixThreshold);

        return Object.assign({}, ENGINE_DEFAULTS, {
            bullishPcrThreshold: Math.max(1.2, bullishPcrThreshold || 1.2),
            mildBullishPcrThreshold: 1.0,
            bearishPcrThreshold: Math.min(0.8, bearishPcrThreshold || 0.8),
            mildBearishPcrThreshold: 0.8,
            vixBullishThreshold: elevatedVixThreshold || 15,
            highVixThreshold: highVixThreshold || 18,
            supportResistanceBufferPercent: Utils.toNumber(settings && settings.supportResistanceBufferPercent) || 0.4
        });
    }

    function evaluateSnapshot(snapshot, settings) {
        const config = getConfig(settings || {});
        const values = Object.assign(Utils.createEmptyValues(), snapshot && snapshot.values ? snapshot.values : {});
        const reasoning = [];
        const riskFlags = [];
        const components = [];
        const availability = {
            pcr: false,
            maxPainVsSpot: false,
            momentum: false,
            vix: false,
            oi: false,
            pageSignal: false,
            sessionPriceAction: false,
            levels: false,
            structure: false
        };
        const score = {
            bullish: 0,
            bearish: 0
        };
        const activeConditions = {
            bullish: 0,
            bearish: 0
        };
        const extractorConfidence = Utils.clamp(
            Utils.toNumber(snapshot && snapshot.extractorMeta && snapshot.extractorMeta.confidence) || 0,
            0,
            100
        );

        function addScore(direction, weight, reason, key) {
            if (!weight || !direction) {
                return;
            }
            score[direction] += weight;
            activeConditions[direction] += 1;
            components.push({
                key: key,
                direction: direction,
                weight: weight,
                reason: reason
            });
            if (reason) {
                reasoning.push(reason);
            }
        }

        applyPcrRule(values, config, availability, addScore, reasoning);
        applyMaxPainRule(values, availability, addScore);
        applyMomentumRule(values, availability, addScore);
        applyVixRule(values, config, availability, addScore, reasoning, riskFlags);
        applyOiRule(values, availability, addScore, reasoning);
        applyPageSignalRule(snapshot, availability, addScore, riskFlags);
        applySessionPriceActionRule(values, availability, addScore, reasoning, config);
        applySupportResistanceRule(snapshot, values, config, availability, addScore, reasoning);
        applyStructureRule(snapshot, availability, addScore, riskFlags, config);
        applyMomentumBoost(config, score, activeConditions, components, reasoning);

        const confidenceResult = buildConfidence({
            bullishScore: score.bullish,
            bearishScore: score.bearish,
            availability: availability,
            extractorConfidence: extractorConfidence,
            riskFlags: riskFlags,
            config: config
        });

        const verdict = buildVerdict({
            bullishScore: score.bullish,
            bearishScore: score.bearish,
            confidence: confidenceResult.confidence,
            config: config,
            riskFlags: riskFlags
        });

        if (!reasoning.length) {
            reasoning.push("No usable directional clues were extracted from the page.");
        }

        reasoning.push(buildBiasSummary(verdict.signal, verdict.strength));

        return {
            tabId: snapshot.tabId,
            instrument: snapshot.instrument || "UNKNOWN",
            signal: verdict.signal,
            confidence: confidenceResult.confidence,
            strength: verdict.strength,
            bullishScore: Utils.round(score.bullish, 2),
            bearishScore: Utils.round(score.bearish, 2),
            score: Utils.round(score.bullish - score.bearish, 2),
            reasoning: Utils.pickSummaryReasoning(reasoning, 6),
            riskFlags: Utils.pickSummaryReasoning(riskFlags, 5),
            recommendedStance: buildRecommendedStance(verdict.signal, verdict.strength, riskFlags),
            components: components,
            extractorConfidence: extractorConfidence,
            siteType: snapshot.siteType,
            timestamp: snapshot.timestamp
        };
    }

    function evaluateAll(snapshotList, settings) {
        const snapshots = Array.isArray(snapshotList) ? snapshotList.filter(Boolean) : [];
        if (!snapshots.length) {
            return {
                overall: Utils.createEmptyOverallSignal(),
                byTab: {},
                rows: []
            };
        }

        const byTab = {};
        const rows = [];
        const reasoning = [];
        const riskFlags = [];
        let weightedBullish = 0;
        let weightedBearish = 0;
        let weightedConfidence = 0;
        let totalWeight = 0;
        let bullishTabs = 0;
        let bearishTabs = 0;
        let waitTabs = 0;

        snapshots.forEach((snapshot) => {
            const evaluation = evaluateSnapshot(snapshot, settings);
            const weight = Math.max(0.4, (evaluation.extractorConfidence || 50) / 100);

            byTab[snapshot.tabId] = evaluation;
            rows.push({
                tabId: snapshot.tabId,
                instrument: snapshot.instrument,
                siteType: snapshot.siteType,
                signal: evaluation.signal,
                confidence: evaluation.confidence,
                strength: evaluation.strength,
                bullishScore: evaluation.bullishScore,
                bearishScore: evaluation.bearishScore,
                score: evaluation.score,
                timestamp: snapshot.timestamp,
                url: snapshot.url,
                pageTitle: snapshot.pageTitle,
                values: snapshot.values,
                reasoning: evaluation.reasoning,
                riskFlags: evaluation.riskFlags
            });

            weightedBullish += evaluation.bullishScore * weight;
            weightedBearish += evaluation.bearishScore * weight;
            weightedConfidence += evaluation.confidence * weight;
            totalWeight += weight;
            reasoning.push(...(evaluation.reasoning || []).slice(0, 2).map((item) => `${snapshot.instrument || snapshot.siteType}: ${item}`));
            riskFlags.push(...(evaluation.riskFlags || []));

            if (isBullishSignal(evaluation.signal)) {
                bullishTabs += 1;
            } else if (isBearishSignal(evaluation.signal)) {
                bearishTabs += 1;
            } else {
                waitTabs += 1;
            }
        });

        if (snapshots.length === 1) {
            const single = Object.assign({}, byTab[snapshots[0].tabId]);
            return {
                overall: Object.assign({}, single, {
                    updatedAt: single.timestamp || new Date().toISOString(),
                    tabCount: 1
                }),
                byTab: byTab,
                rows: rows
            };
        }

        const overallBullish = totalWeight ? Utils.round(weightedBullish / totalWeight, 2) : 0;
        const overallBearish = totalWeight ? Utils.round(weightedBearish / totalWeight, 2) : 0;
        let overallConfidence = totalWeight ? Math.round(weightedConfidence / totalWeight) : 0;

        if (bullishTabs > 0 && bearishTabs > 0) {
            overallConfidence -= bullishTabs === bearishTabs ? ENGINE_DEFAULTS.severeConflictPenalty : ENGINE_DEFAULTS.conflictPenalty;
            riskFlags.push("Mixed signals");
        }

        if (waitTabs > 0) {
            overallConfidence -= Math.min(12, waitTabs * 4);
        }

        overallConfidence = Utils.clamp(overallConfidence, 0, 100);

        const verdict = buildVerdict({
            bullishScore: overallBullish,
            bearishScore: overallBearish,
            confidence: overallConfidence,
            config: getConfig(settings || {}),
            riskFlags: riskFlags
        });

        if (bullishTabs > bearishTabs && bullishTabs > 0) {
            reasoning.push(`${bullishTabs} monitored tab(s) lean bullish overall.`);
        } else if (bearishTabs > bullishTabs && bearishTabs > 0) {
            reasoning.push(`${bearishTabs} monitored tab(s) lean bearish overall.`);
        } else if (bullishTabs > 0 && bearishTabs > 0) {
            reasoning.push("Monitored tabs disagree on direction, so conviction is reduced.");
        }

        reasoning.push(buildBiasSummary(verdict.signal, verdict.strength));

        return {
            overall: {
                signal: verdict.signal,
                confidence: overallConfidence,
                strength: verdict.strength,
                bullishScore: overallBullish,
                bearishScore: overallBearish,
                score: Utils.round(overallBullish - overallBearish, 2),
                reasoning: Utils.pickSummaryReasoning(reasoning, 6),
                riskFlags: Utils.pickSummaryReasoning(riskFlags, 5),
                recommendedStance: buildRecommendedStance(verdict.signal, verdict.strength, riskFlags),
                updatedAt: new Date().toISOString(),
                tabCount: snapshots.length
            },
            byTab: byTab,
            rows: rows
        };
    }

    function applyPcrRule(values, config, availability, addScore, reasoning) {
        if (!Number.isFinite(values.pcr)) {
            return;
        }

        availability.pcr = true;

        if (values.pcr > config.bullishPcrThreshold) {
            addScore("bullish", config.pcrStrongBullishWeight, `PCR ${Utils.round(values.pcr, 2)} strongly bullish.`, "pcr");
            return;
        }

        if (values.pcr >= config.mildBullishPcrThreshold) {
            addScore("bullish", config.pcrMildBullishWeight, `PCR ${Utils.round(values.pcr, 2)} slightly bullish.`, "pcr");
            return;
        }

        if (values.pcr < config.bearishPcrThreshold) {
            addScore("bearish", config.pcrStrongBearishWeight, `PCR ${Utils.round(values.pcr, 2)} strongly bearish.`, "pcr");
            return;
        }

        reasoning.push(`PCR ${Utils.round(values.pcr, 2)} is neutral and does not add directional conviction.`);
    }

    function applyMaxPainRule(values, availability, addScore) {
        if (!Number.isFinite(values.maxPain) || !Number.isFinite(values.spotPrice)) {
            return;
        }

        availability.maxPainVsSpot = true;

        if (values.maxPain > values.spotPrice) {
            addScore("bullish", ENGINE_DEFAULTS.maxPainWeight, "Max pain above spot supports upward bias.", "maxPain");
            return;
        }

        if (values.maxPain < values.spotPrice) {
            addScore("bearish", ENGINE_DEFAULTS.maxPainWeight, "Max pain below spot supports downward bias.", "maxPain");
        }
    }

    function applyMomentumRule(values, availability, addScore) {
        if (!Number.isFinite(values.changePercent)) {
            return;
        }

        availability.momentum = true;

        if (values.changePercent > 0) {
            addScore("bullish", ENGINE_DEFAULTS.momentumWeight, "Price momentum positive.", "momentum");
            return;
        }

        if (values.changePercent < 0) {
            addScore("bearish", ENGINE_DEFAULTS.momentumWeight, "Price momentum negative.", "momentum");
        }
    }

    function applyVixRule(values, config, availability, addScore, reasoning, riskFlags) {
        if (!Number.isFinite(values.vix)) {
            return;
        }

        availability.vix = true;

        if (values.vix >= config.highVixThreshold) {
            addScore("bearish", config.vixBearishWeight, `VIX ${Utils.round(values.vix, 2)} elevated, signalling stress.`, "vix");
            riskFlags.push("Volatility risk high");
            return;
        }

        if (values.vix <= config.vixBullishThreshold) {
            addScore("bullish", config.vixBullishWeight, `VIX ${Utils.round(values.vix, 2)} controlled or easing.`, "vix");
            return;
        }

        reasoning.push(`VIX ${Utils.round(values.vix, 2)} is not extreme but still needs monitoring.`);
    }

    function applyOiRule(values, availability, addScore, reasoning) {
        if (!Number.isFinite(values.putOi) || !Number.isFinite(values.callOi)) {
            return;
        }

        availability.oi = true;

        if (values.putOi > values.callOi) {
            addScore("bullish", ENGINE_DEFAULTS.oiWeight, "Put OI above Call OI supports bullish positioning.", "oi");
            return;
        }

        if (values.callOi > values.putOi) {
            addScore("bearish", ENGINE_DEFAULTS.oiWeight, "Call OI above Put OI supports bearish positioning.", "oi");
            return;
        }

        reasoning.push("Call OI and Put OI are balanced, so OI does not lean either way.");
    }

    function applyPageSignalRule(snapshot, availability, addScore, riskFlags) {
        const pageSignal = detectPageSignal(snapshot && snapshot.rawSignals);
        if (!pageSignal.available) {
            return;
        }

        availability.pageSignal = true;

        if (pageSignal.direction === "bullish") {
            addScore("bullish", ENGINE_DEFAULTS.pageSignalWeight, "Visible page signal already leans bullish.", "pageSignal");
            return;
        }

        if (pageSignal.direction === "bearish") {
            addScore("bearish", ENGINE_DEFAULTS.pageSignalWeight, "Visible page signal already leans bearish.", "pageSignal");
            return;
        }

        riskFlags.push("Existing page signal is neutral or wait-oriented.");
    }

    function applySessionPriceActionRule(values, availability, addScore, reasoning, config) {
        const spot = Utils.toNumber(values.spotPrice);
        const open = Utils.toNumber(values.openPrice);
        const previousClose = Utils.toNumber(values.previousClose);
        const dayHigh = Utils.toNumber(values.dayHigh);
        const dayLow = Utils.toNumber(values.dayLow);

        if (!Number.isFinite(spot)) {
            return;
        }

        const bullishClues = [];
        const bearishClues = [];
        availability.sessionPriceAction = Number.isFinite(open) || Number.isFinite(previousClose) || (Number.isFinite(dayHigh) && Number.isFinite(dayLow));

        if (!availability.sessionPriceAction) {
            return;
        }

        if (Number.isFinite(open)) {
            if (spot > open) {
                bullishClues.push("spot is above the session open");
            } else if (spot < open) {
                bearishClues.push("spot is below the session open");
            }
        }

        if (Number.isFinite(previousClose)) {
            if (spot > previousClose) {
                bullishClues.push("spot is above the previous close");
            } else if (spot < previousClose) {
                bearishClues.push("spot is below the previous close");
            }
        }

        if (Number.isFinite(dayHigh) && Number.isFinite(dayLow) && dayHigh > dayLow) {
            const rangePosition = (spot - dayLow) / (dayHigh - dayLow);
            if (rangePosition >= 0.75) {
                bullishClues.push("price is holding near the day high");
            } else if (rangePosition <= 0.25) {
                bearishClues.push("price is holding near the day low");
            }
        }

        if (!bullishClues.length && !bearishClues.length) {
            return;
        }

        if (bullishClues.length >= 2 && bullishClues.length > bearishClues.length) {
            addScore(
                "bullish",
                bullishClues.length >= 3 ? config.sessionPriceActionStrongWeight : config.sessionPriceActionMildWeight,
                `Session price action supports bulls: ${bullishClues.slice(0, 3).join(", ")}.`,
                "sessionPriceAction"
            );
            return;
        }

        if (bearishClues.length >= 2 && bearishClues.length > bullishClues.length) {
            addScore(
                "bearish",
                bearishClues.length >= 3 ? config.sessionPriceActionStrongWeight : config.sessionPriceActionMildWeight,
                `Session price action supports bears: ${bearishClues.slice(0, 3).join(", ")}.`,
                "sessionPriceAction"
            );
            return;
        }

        if (bullishClues.length > bearishClues.length) {
            addScore(
                "bullish",
                Math.round(config.sessionPriceActionMildWeight * 0.6),
                `Session price action leans bullish: ${bullishClues[0]}.`,
                "sessionPriceAction"
            );
            return;
        }

        if (bearishClues.length > bullishClues.length) {
            addScore(
                "bearish",
                Math.round(config.sessionPriceActionMildWeight * 0.6),
                `Session price action leans bearish: ${bearishClues[0]}.`,
                "sessionPriceAction"
            );
            return;
        }

        reasoning.push("Session price action is mixed and does not add clean directional conviction.");
    }

    function applySupportResistanceRule(snapshot, values, config, availability, addScore, reasoning) {
        const derived = snapshot && snapshot.supportResistance ? snapshot.supportResistance : null;
        const spot = Utils.toNumber(values.spotPrice);
        const support = pickFirstFinite(derived && derived.nearestSupport, values.support);
        const resistance = pickFirstFinite(derived && derived.nearestResistance, values.resistance);
        const supportStrength = derived && derived.strength ? derived.strength.support : "WEAK";
        const resistanceStrength = derived && derived.strength ? derived.strength.resistance : "WEAK";
        const breakout = Boolean(derived && derived.breakout);
        const breakdown = Boolean(derived && derived.breakdown);

        if (!Number.isFinite(spot) || (!Number.isFinite(support) && !Number.isFinite(resistance) && !breakout && !breakdown)) {
            return;
        }

        availability.levels = true;

        const nearSupport = Number.isFinite(support) && isNearLevel(spot, support, config.supportResistanceBufferPercent);
        const nearResistance = Number.isFinite(resistance) && isNearLevel(spot, resistance, config.supportResistanceBufferPercent);

        if (breakout) {
            addScore(
                "bullish",
                config.breakoutWeight + levelStrengthBonus(supportStrength, resistanceStrength, config),
                "Breakout above resistance adds strong bullish confirmation.",
                "breakout"
            );
            return;
        }

        if (breakdown) {
            addScore(
                "bearish",
                config.breakdownWeight + levelStrengthBonus(supportStrength, resistanceStrength, config),
                "Breakdown below support adds strong bearish confirmation.",
                "breakdown"
            );
            return;
        }

        if (nearSupport && nearResistance) {
            const supportDistance = levelDistancePercent(spot, support);
            const resistanceDistance = levelDistancePercent(spot, resistance);
            if (supportDistance + 0.05 < resistanceDistance) {
                addScore(
                    "bullish",
                    config.nearSupportWeight + levelStrengthBonus(supportStrength, null, config),
                    `Spot is holding closer to support around ${Utils.round(support, 2)} than to resistance.`,
                    "nearSupport"
                );
                return;
            }
            if (resistanceDistance + 0.05 < supportDistance) {
                addScore(
                    "bearish",
                    config.nearResistanceWeight + levelStrengthBonus(null, resistanceStrength, config),
                    `Spot is trading closer to resistance near ${Utils.round(resistance, 2)} than to support.`,
                    "nearResistance"
                );
                return;
            }
            reasoning.push("Price is compressed between nearby support and resistance, so levels are not giving a clean edge.");
            return;
        }

        if (nearSupport) {
            addScore(
                "bullish",
                config.nearSupportWeight + levelStrengthBonus(supportStrength, null, config),
                `Spot is holding near support around ${Utils.round(support, 2)}.`,
                "nearSupport"
            );
        }

        if (nearResistance) {
            addScore(
                "bearish",
                config.nearResistanceWeight + levelStrengthBonus(null, resistanceStrength, config),
                `Spot is pressing into resistance near ${Utils.round(resistance, 2)}.`,
                "nearResistance"
            );
        }
    }

    function applyStructureRule(snapshot, availability, addScore, riskFlags, config) {
        const structure = snapshot && snapshot.structureAnalysis ? snapshot.structureAnalysis : null;
        if (!hasUsableStructureAnalysis(structure)) {
            return;
        }

        availability.structure = true;

        if (structure.trend === "BULLISH") {
            addScore("bullish", config.structureTrendWeight, "Price structure trend is bullish.", "structureTrend");
        } else if (structure.trend === "BEARISH") {
            addScore("bearish", config.structureTrendWeight, "Price structure trend is bearish.", "structureTrend");
        }

        if (structure.structure === "HH_HL") {
            addScore("bullish", config.structurePatternWeight, "Higher highs and higher lows support bullish continuation.", "structurePattern");
        } else if (structure.structure === "LH_LL") {
            addScore("bearish", config.structurePatternWeight, "Lower highs and lower lows support bearish continuation.", "structurePattern");
        }

        if (structure.momentum === "STRONG_UP") {
            addScore("bullish", config.structureMomentumWeight, "Structure momentum is strongly upward.", "structureMomentum");
        } else if (structure.momentum === "STRONG_DOWN") {
            addScore("bearish", config.structureMomentumWeight, "Structure momentum is strongly downward.", "structureMomentum");
        }

        if (structure.tradeSuggestion && structure.tradeSuggestion.action === "BUY_CE") {
            addScore("bullish", config.structureTradeActionWeight, "Structure analysis favors CE setups.", "structureTrade");
        } else if (structure.tradeSuggestion && structure.tradeSuggestion.action === "BUY_PE") {
            addScore("bearish", config.structureTradeActionWeight, "Structure analysis favors PE setups.", "structureTrade");
        }

        if (structure.exhaustion) {
            riskFlags.push("Momentum exhaustion");
        }
        if (structure.zone === "MID") {
            riskFlags.push("Structure mid-zone");
        }
    }

    function applyMomentumBoost(config, score, activeConditions, components, reasoning) {
        if (activeConditions.bullish >= config.momentumBoostConditionCount) {
            score.bullish += config.momentumBoostWeight;
            components.push({
                key: "bullishMomentumBoost",
                direction: "bullish",
                weight: config.momentumBoostWeight,
                reason: "Multiple bullish conditions aligned, so bullish bias gets a momentum boost."
            });
            reasoning.push("Multiple bullish conditions aligned, adding a momentum boost.");
        }

        if (activeConditions.bearish >= config.momentumBoostConditionCount) {
            score.bearish += config.momentumBoostWeight;
            components.push({
                key: "bearishMomentumBoost",
                direction: "bearish",
                weight: config.momentumBoostWeight,
                reason: "Multiple bearish conditions aligned, so bearish bias gets a momentum boost."
            });
            reasoning.push("Multiple bearish conditions aligned, adding a momentum boost.");
        }
    }

    function buildConfidence(args) {
        const bullishScore = args.bullishScore || 0;
        const bearishScore = args.bearishScore || 0;
        const availability = args.availability || {};
        const extractorConfidence = args.extractorConfidence || 0;
        const riskFlags = args.riskFlags || [];
        const config = args.config;
        const total = bullishScore + bearishScore;

        if (!total) {
            riskFlags.push("Incomplete data");
            return { confidence: 0 };
        }

        const totalFactorCount = Object.keys(availability).length || 1;
        const availableFactorCount = Object.values(availability).filter(Boolean).length;
        const coverageRatio = availableFactorCount / totalFactorCount;
        let confidence = (Math.max(bullishScore, bearishScore) / total) * 100;

        // Partial DOM extraction is normal on chart pages, so reduce confidence by coverage
        // instead of zeroing the signal when a few key clues are still available.
        confidence *= (0.3 + (0.7 * coverageRatio));

        if (availableFactorCount <= 2) {
            riskFlags.push("Incomplete data");
        } else if (coverageRatio < 0.5) {
            riskFlags.push("Partial data coverage");
        }

        if (bullishScore > 0 && bearishScore > 0) {
            const scoreGap = Math.abs(bullishScore - bearishScore);
            const dominanceRatio = total ? scoreGap / total : 0;
            if (dominanceRatio <= 0.12) {
                confidence -= config.severeConflictPenalty;
            } else if (dominanceRatio <= 0.24) {
                confidence -= config.conflictPenalty;
            } else {
                confidence -= Math.round(config.conflictPenalty * 0.5);
            }
            riskFlags.push("Mixed signals");
        }

        if (extractorConfidence > 0 && extractorConfidence < 50) {
            confidence -= config.lowExtractorPenalty;
        }

        confidence = Math.round(Utils.clamp(confidence, 0, 100));

        if (confidence < config.directionalSignalFloor) {
            riskFlags.push("Low conviction trade");
        }

        return { confidence: confidence };
    }

    function buildVerdict(args) {
        const bullishScore = args.bullishScore || 0;
        const bearishScore = args.bearishScore || 0;
        const confidence = Utils.clamp(args.confidence || 0, 0, 100);
        const config = args.config;
        const riskFlags = args.riskFlags || [];
        const total = bullishScore + bearishScore;
        const scoreGap = Math.abs(bullishScore - bearishScore);
        const dominanceRatio = total ? scoreGap / total : 0;
        let signal = SIGNALS.WAIT;

        if (!total) {
            signal = SIGNALS.WAIT;
        } else if (scoreGap <= config.balancedScoreGap && dominanceRatio <= 0.2) {
            signal = SIGNALS.WAIT;
            riskFlags.push("Mixed signals");
        } else if (confidence < config.weakSignalFloor) {
            signal = dominanceRatio >= 0.35
                ? (bullishScore > bearishScore ? SIGNALS.WEAK_BULLISH : SIGNALS.WEAK_BEARISH)
                : SIGNALS.WAIT;
        } else if (confidence < config.directionalSignalFloor) {
            signal = bullishScore > bearishScore ? SIGNALS.WEAK_BULLISH : SIGNALS.WEAK_BEARISH;
        } else {
            signal = bullishScore > bearishScore ? SIGNALS.BULLISH : SIGNALS.BEARISH;
        }

        return {
            signal: signal,
            strength: determineStrength(signal, confidence, bullishScore, bearishScore, config)
        };
    }

    function determineStrength(signal, confidence, bullishScore, bearishScore, config) {
        if (signal === SIGNALS.WAIT || signal === SIGNALS.WEAK_BULLISH || signal === SIGNALS.WEAK_BEARISH) {
            return STRENGTH.WEAK;
        }

        const dominantScore = Math.max(bullishScore, bearishScore);
        if (confidence >= config.strongSignalFloor && dominantScore >= 45) {
            return STRENGTH.STRONG;
        }

        return STRENGTH.MODERATE;
    }

    function buildBiasSummary(signal, strength) {
        if (signal === SIGNALS.BULLISH) {
            return strength === STRENGTH.STRONG
                ? "Overall bias: Strong Bullish confirmation."
                : "Overall bias: Bullish with usable confirmation.";
        }

        if (signal === SIGNALS.BEARISH) {
            return strength === STRENGTH.STRONG
                ? "Overall bias: Strong Bearish confirmation."
                : "Overall bias: Bearish with usable confirmation.";
        }

        if (signal === SIGNALS.WEAK_BULLISH) {
            return "Overall bias: Mild Bullish (not strong confirmation).";
        }

        if (signal === SIGNALS.WEAK_BEARISH) {
            return "Overall bias: Mild Bearish (not strong confirmation).";
        }

        return "Overall bias: Wait for clearer confirmation.";
    }

    function buildRecommendedStance(signal, strength, riskFlags) {
        if (signal === SIGNALS.BULLISH) {
            return strength === STRENGTH.STRONG
                ? "Bullish bias forming: directional bullish setups are supported, but still confirm on chart."
                : "Bullish bias forming: consider bullish setups only after price confirmation.";
        }

        if (signal === SIGNALS.WEAK_BULLISH) {
            return "Mild bullish bias: smaller-risk bullish ideas only, and only after chart confirmation.";
        }

        if (signal === SIGNALS.BEARISH) {
            return strength === STRENGTH.STRONG
                ? "Bearish bias forming: directional bearish setups are supported, but still confirm on chart."
                : "Bearish bias forming: consider bearish setups only after price confirmation.";
        }

        if (signal === SIGNALS.WEAK_BEARISH) {
            return "Mild bearish bias: smaller-risk bearish ideas only, and only after chart confirmation.";
        }

        if (riskFlags.length) {
            return "Wait: no-trade state until conviction improves and risks reduce.";
        }

        return "Wait: not enough directional evidence is available yet.";
    }

    function detectPageSignal(rawSignals) {
        if (!Array.isArray(rawSignals) || !rawSignals.length) {
            return {
                available: false,
                direction: null
            };
        }

        const body = rawSignals.join(" ").toLowerCase();
        const bullishMatches = (body.match(/\bbullish\b|\bbuy\b|\blong\b|\buptrend\b|\bcall buy\b/g) || []).length;
        const bearishMatches = (body.match(/\bbearish\b|\bsell\b|\bshort\b|\bdowntrend\b|\bput buy\b/g) || []).length;
        const neutralMatches = (body.match(/\bwait\b|\bneutral\b|\bno trade\b|\bsideways\b/g) || []).length;

        if (bullishMatches > bearishMatches) {
            return {
                available: true,
                direction: "bullish"
            };
        }

        if (bearishMatches > bullishMatches) {
            return {
                available: true,
                direction: "bearish"
            };
        }

        if (neutralMatches > 0) {
            return {
                available: true,
                direction: "neutral"
            };
        }

        return {
            available: false,
            direction: null
        };
    }

    function isBullishSignal(signal) {
        const upper = String(signal || "").toUpperCase();
        return upper === SIGNALS.BULLISH || upper === SIGNALS.WEAK_BULLISH;
    }

    function isBearishSignal(signal) {
        const upper = String(signal || "").toUpperCase();
        return upper === SIGNALS.BEARISH || upper === SIGNALS.WEAK_BEARISH;
    }

    function isNearLevel(spot, level, bufferPercent) {
        if (!Number.isFinite(spot) || !Number.isFinite(level) || !Number.isFinite(bufferPercent) || spot === 0) {
            return false;
        }
        return Math.abs(((spot - level) / spot) * 100) <= bufferPercent;
    }

    function levelDistancePercent(spot, level) {
        if (!Number.isFinite(spot) || !Number.isFinite(level) || spot === 0) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.abs(((spot - level) / spot) * 100);
    }

    function levelStrengthBonus(supportStrength, resistanceStrength, config) {
        if (supportStrength === STRENGTH.STRONG || resistanceStrength === STRENGTH.STRONG) {
            return config.strongLevelBonus;
        }
        return 0;
    }

    function pickFirstFinite() {
        for (let index = 0; index < arguments.length; index += 1) {
            if (Number.isFinite(arguments[index])) {
                return arguments[index];
            }
        }
        return null;
    }

    function hasUsableStructureAnalysis(structure) {
        if (!structure) {
            return false;
        }

        const hasRange = Boolean(
            structure.range
            && (Number.isFinite(structure.range.high)
                || Number.isFinite(structure.range.low)
                || Number.isFinite(structure.range.mid))
        );
        const hasDirectionalStructure = structure.trend === "BULLISH"
            || structure.trend === "BEARISH"
            || structure.structure === "HH_HL"
            || structure.structure === "LH_LL"
            || structure.momentum === "STRONG_UP"
            || structure.momentum === "STRONG_DOWN"
            || (structure.tradeSuggestion && structure.tradeSuggestion.action && structure.tradeSuggestion.action !== "WAIT");

        return hasRange || hasDirectionalStructure;
    }

    global.OptionsDecisionEngine = {
        ENGINE_DEFAULTS,
        SIGNALS,
        STRENGTH,
        evaluateAll,
        evaluateSnapshot,
        getConfig
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
