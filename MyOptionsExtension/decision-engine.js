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
            highVixThreshold: highVixThreshold || 18
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
            pageSignal: false
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

        let confidence = (Math.max(bullishScore, bearishScore) / total) * 100;
        const missingFactorCount = Object.values(availability).filter((value) => !value).length;

        if (missingFactorCount > 0) {
            confidence -= missingFactorCount * config.missingFactorPenalty;
            riskFlags.push("Incomplete data");
        }

        if (bullishScore > 0 && bearishScore > 0) {
            const scoreGap = Math.abs(bullishScore - bearishScore);
            confidence -= scoreGap <= config.balancedScoreGap ? config.severeConflictPenalty : config.conflictPenalty;
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
        let signal = SIGNALS.WAIT;

        if (!total) {
            signal = SIGNALS.WAIT;
        } else if (scoreGap <= config.balancedScoreGap) {
            signal = SIGNALS.WAIT;
            riskFlags.push("Mixed signals");
        } else if (confidence < config.weakSignalFloor) {
            signal = SIGNALS.WAIT;
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

    global.OptionsDecisionEngine = {
        ENGINE_DEFAULTS,
        SIGNALS,
        STRENGTH,
        evaluateAll,
        evaluateSnapshot,
        getConfig
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
