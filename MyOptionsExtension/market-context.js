(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    function buildMarketContext(args) {
        const snapshots = Array.isArray(args && args.snapshots) ? args.snapshots.filter(Boolean) : [];
        const evaluations = args && args.evaluations ? args.evaluations : {};
        const snapshotsByTab = args && args.snapshotsByTab ? args.snapshotsByTab : {};
        const settings = args && args.settings ? args.settings : Utils.DEFAULT_SETTINGS;
        const aggregateValues = buildAggregateValues(snapshots);
        const supportResistance = buildAggregateSupportResistance(snapshots, aggregateValues.values);

        if (Number.isFinite(supportResistance.nearestSupport)) {
            aggregateValues.values.support = supportResistance.nearestSupport;
        }
        if (Number.isFinite(supportResistance.nearestResistance)) {
            aggregateValues.values.resistance = supportResistance.nearestResistance;
        }

        return {
            snapshots: snapshots,
            evaluations: evaluations,
            snapshotsByTab: snapshotsByTab,
            settings: settings,
            instrument: aggregateValues.instrument,
            aggregateValues: aggregateValues.values,
            supportResistance: supportResistance,
            rawSignals: aggregateValues.rawSignals,
            latestTimestamp: aggregateValues.latestTimestamp,
            marketRegime: classifyMarketRegime(aggregateValues.values, settings)
        };
    }

    function buildAggregateValues(snapshots) {
        const values = Utils.createEmptyValues();
        const instruments = {};
        const rawSignals = [];
        let latestTimestamp = null;

        Object.keys(values).forEach((fieldName) => {
            values[fieldName] = Utils.averageNumbers(
                snapshots.map((snapshot) => snapshot && snapshot.values ? snapshot.values[fieldName] : null)
            );
        });

        snapshots.forEach((snapshot) => {
            if (!snapshot) {
                return;
            }
            if (snapshot.instrument && snapshot.instrument !== "UNKNOWN") {
                instruments[snapshot.instrument] = (instruments[snapshot.instrument] || 0) + 1;
            }
            if (Array.isArray(snapshot.rawSignals)) {
                rawSignals.push(...snapshot.rawSignals);
            }
            if (!latestTimestamp || new Date(snapshot.timestamp).getTime() > new Date(latestTimestamp).getTime()) {
                latestTimestamp = snapshot.timestamp;
            }
        });

        return {
            instrument: pickMostCommonKey(instruments) || "UNKNOWN",
            values: values,
            rawSignals: Utils.dedupeStrings(rawSignals),
            latestTimestamp: latestTimestamp || new Date().toISOString()
        };
    }

    function buildAggregateSupportResistance(snapshots, aggregateValues) {
        const fallback = Utils.createEmptySupportResistance();
        const supportSamples = [];
        const resistanceSamples = [];
        const secondarySupportSamples = [];
        const secondaryResistanceSamples = [];
        const supportLevels = [];
        const resistanceLevels = [];
        const reasoning = [];
        const supportStrengths = [];
        const resistanceStrengths = [];
        let breakout = false;
        let breakdown = false;

        snapshots.forEach((snapshot) => {
            if (!snapshot) {
                return;
            }

            const derived = snapshot.supportResistance || {};
            const values = snapshot.values || {};
            const support = pickFirstFinite(derived.nearestSupport, values.support);
            const resistance = pickFirstFinite(derived.nearestResistance, values.resistance);
            const secondarySupport = pickFirstFinite(derived.secondarySupport, null);
            const secondaryResistance = pickFirstFinite(derived.secondaryResistance, null);

            if (Number.isFinite(support)) {
                supportSamples.push(support);
                supportLevels.push(support);
            }
            if (Number.isFinite(resistance)) {
                resistanceSamples.push(resistance);
                resistanceLevels.push(resistance);
            }
            if (Number.isFinite(secondarySupport)) {
                secondarySupportSamples.push(secondarySupport);
                supportLevels.push(secondarySupport);
            }
            if (Number.isFinite(secondaryResistance)) {
                secondaryResistanceSamples.push(secondaryResistance);
                resistanceLevels.push(secondaryResistance);
            }

            if (Array.isArray(derived.supportLevels)) {
                supportLevels.push(...derived.supportLevels.filter(Number.isFinite));
            }
            if (Array.isArray(derived.resistanceLevels)) {
                resistanceLevels.push(...derived.resistanceLevels.filter(Number.isFinite));
            }
            if (Array.isArray(derived.reasoning)) {
                reasoning.push(...derived.reasoning.slice(0, 2));
            }
            if (derived.strength && derived.strength.support) {
                supportStrengths.push(derived.strength.support);
            }
            if (derived.strength && derived.strength.resistance) {
                resistanceStrengths.push(derived.strength.resistance);
            }

            breakout = breakout || Boolean(derived.breakout);
            breakdown = breakdown || Boolean(derived.breakdown);
        });

        const nearestSupport = Utils.averageNumbers(supportSamples);
        const nearestResistance = Utils.averageNumbers(resistanceSamples);
        const secondarySupport = Utils.averageNumbers(secondarySupportSamples);
        const secondaryResistance = Utils.averageNumbers(secondaryResistanceSamples);

        if (!breakout
            && Number.isFinite(aggregateValues && aggregateValues.spotPrice)
            && Number.isFinite(nearestResistance)
            && aggregateValues.spotPrice > nearestResistance
            && Number.isFinite(aggregateValues.changePercent)
            && aggregateValues.changePercent > 0) {
            breakout = true;
        }

        if (!breakdown
            && Number.isFinite(aggregateValues && aggregateValues.spotPrice)
            && Number.isFinite(nearestSupport)
            && aggregateValues.spotPrice < nearestSupport
            && Number.isFinite(aggregateValues.changePercent)
            && aggregateValues.changePercent < 0) {
            breakdown = true;
        }

        return Object.assign({}, fallback, {
            nearestSupport: Utils.round(nearestSupport, 2),
            nearestResistance: Utils.round(nearestResistance, 2),
            secondarySupport: Utils.round(secondarySupport, 2),
            secondaryResistance: Utils.round(secondaryResistance, 2),
            supportLevels: sortLevelsDescending(Utils.dedupeStrings(supportLevels.filter(Number.isFinite).map(String)).map(Number)).slice(0, 4),
            resistanceLevels: sortLevelsAscending(Utils.dedupeStrings(resistanceLevels.filter(Number.isFinite).map(String)).map(Number)).slice(0, 4),
            breakout: breakout,
            breakdown: breakdown,
            strength: {
                support: resolveDominantStrength(supportStrengths),
                resistance: resolveDominantStrength(resistanceStrengths)
            },
            reasoning: Utils.pickSummaryReasoning(reasoning, 6)
        });
    }

    function calculateSlope(history, windowMinutes, fieldName) {
        const recent = getHistoryWindow(history, windowMinutes);
        if (recent.length < 2) {
            return null;
        }

        const first = recent[0].values ? recent[0].values[fieldName] : null;
        const last = recent[recent.length - 1].values ? recent[recent.length - 1].values[fieldName] : null;
        if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
            return null;
        }

        return ((last - first) / Math.abs(first)) * 100;
    }

    function getHistoryWindow(history, windowMinutes) {
        const source = Array.isArray(history) ? history.filter(Boolean) : [];
        if (!source.length) {
            return [];
        }

        const latestTimestamp = new Date(source[source.length - 1].timestamp).getTime();
        const cutoff = latestTimestamp - (windowMinutes * 60 * 1000);

        return source.filter((snapshot) => new Date(snapshot.timestamp).getTime() >= cutoff);
    }

    function extractDirectionalText(rawSignals) {
        const joined = Array.isArray(rawSignals) ? rawSignals.join(" ").toLowerCase() : "";
        const bullish = (joined.match(/\bbullish\b|\bbuy\b|\blong\b|\buptrend\b/g) || []).length;
        const bearish = (joined.match(/\bbearish\b|\bsell\b|\bshort\b|\bdowntrend\b/g) || []).length;
        const neutral = (joined.match(/\bneutral\b|\bsideways\b|\bwait\b|\bno trade\b/g) || []).length;

        if (bullish > bearish) {
            return "bullish";
        }
        if (bearish > bullish) {
            return "bearish";
        }
        if (neutral > 0) {
            return "neutral";
        }
        return "unknown";
    }

    function nearLevel(spot, level, bufferPercent) {
        if (!Number.isFinite(spot) || !Number.isFinite(level) || !Number.isFinite(bufferPercent) || spot === 0) {
            return false;
        }
        return Math.abs(((spot - level) / spot) * 100) <= bufferPercent;
    }

    function positionWithinRange(spot, support, resistance) {
        if (!Number.isFinite(spot) || !Number.isFinite(support) || !Number.isFinite(resistance) || resistance <= support) {
            return null;
        }
        return (spot - support) / (resistance - support);
    }

    function safeDivide(numerator, denominator) {
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
            return null;
        }
        return numerator / denominator;
    }

    function normalizeProbabilities(scores) {
        const gapUp = Math.max(0, scores.gapUp || 0);
        const gapDown = Math.max(0, scores.gapDown || 0);
        const flatOpen = Math.max(0, scores.flatOpen || 0);
        const total = gapUp + gapDown + flatOpen;

        if (!total) {
            return {
                gapUp: 34,
                gapDown: 33,
                flatOpen: 33
            };
        }

        return {
            gapUp: Math.round((gapUp / total) * 100),
            gapDown: Math.round((gapDown / total) * 100),
            flatOpen: Math.max(0, 100 - Math.round((gapUp / total) * 100) - Math.round((gapDown / total) * 100))
        };
    }

    function clampConfidence(value) {
        return Utils.clamp(Math.round(value || 0), 0, 100);
    }

    function classifyMarketRegime(values, settings) {
        if (Number.isFinite(values.vix) && values.vix >= settings.highVixThreshold) {
            return "HIGH_VOLATILITY";
        }

        if (Number.isFinite(values.support) && Number.isFinite(values.resistance) && Number.isFinite(values.spotPrice)) {
            const position = positionWithinRange(values.spotPrice, values.support, values.resistance);
            if (position != null && position > 0.35 && position < 0.65) {
                return "RANGE_BOUND";
            }
        }

        if (Number.isFinite(values.changePercent) && values.changePercent > 0.6) {
            return "TRENDING_UP";
        }
        if (Number.isFinite(values.changePercent) && values.changePercent < -0.6) {
            return "TRENDING_DOWN";
        }

        return "BALANCED";
    }

    function isBullishSignal(signal) {
        const upper = String(signal || "").toUpperCase();
        return upper === "BULLISH" || upper === "WEAK_BULLISH";
    }

    function isBearishSignal(signal) {
        const upper = String(signal || "").toUpperCase();
        return upper === "BEARISH" || upper === "WEAK_BEARISH";
    }

    function isSidewaysSignal(signal) {
        const upper = String(signal || "").toUpperCase();
        return upper === "SIDEWAYS" || upper === "WAIT" || upper === "NEUTRAL";
    }

    function pickMostCommonKey(counts) {
        let bestKey = "";
        let bestCount = 0;
        Object.keys(counts || {}).forEach((key) => {
            if (counts[key] > bestCount) {
                bestKey = key;
                bestCount = counts[key];
            }
        });
        return bestKey || null;
    }

    function pickFirstFinite() {
        for (let index = 0; index < arguments.length; index += 1) {
            if (Number.isFinite(arguments[index])) {
                return arguments[index];
            }
        }
        return null;
    }

    function resolveDominantStrength(strengths) {
        if (!Array.isArray(strengths) || !strengths.length) {
            return "WEAK";
        }
        if (strengths.includes("STRONG")) {
            return "STRONG";
        }
        if (strengths.includes("MODERATE")) {
            return "MODERATE";
        }
        return "WEAK";
    }

    function sortLevelsAscending(levels) {
        return (levels || []).filter(Number.isFinite).sort((left, right) => left - right).map((level) => Utils.round(level, 2));
    }

    function sortLevelsDescending(levels) {
        return (levels || []).filter(Number.isFinite).sort((left, right) => right - left).map((level) => Utils.round(level, 2));
    }

    global.OptionsMarketContext = {
        buildAggregateValues,
        buildAggregateSupportResistance,
        buildMarketContext,
        calculateSlope,
        clampConfidence,
        classifyMarketRegime,
        extractDirectionalText,
        getHistoryWindow,
        isBearishSignal,
        isBullishSignal,
        isSidewaysSignal,
        nearLevel,
        normalizeProbabilities,
        positionWithinRange,
        safeDivide
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
