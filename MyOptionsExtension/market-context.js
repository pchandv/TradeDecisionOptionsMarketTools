(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    function buildMarketContext(args) {
        const snapshots = Array.isArray(args && args.snapshots) ? args.snapshots.filter(Boolean) : [];
        const evaluations = args && args.evaluations ? args.evaluations : {};
        const snapshotsByTab = args && args.snapshotsByTab ? args.snapshotsByTab : {};
        const settings = args && args.settings ? args.settings : Utils.DEFAULT_SETTINGS;
        const aggregateValues = buildAggregateValues(snapshots);

        return {
            snapshots: snapshots,
            evaluations: evaluations,
            snapshotsByTab: snapshotsByTab,
            settings: settings,
            instrument: aggregateValues.instrument,
            aggregateValues: aggregateValues.values,
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

    global.OptionsMarketContext = {
        buildAggregateValues,
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
