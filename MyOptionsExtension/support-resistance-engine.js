(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;
    const STORAGE_PREFIX = "priceHistory_";
    const DEFAULT_CLUSTER_TOLERANCE_PERCENT = 0.28;

    async function updatePriceHistory(price, tabId) {
        if (!Number.isFinite(price) || tabId == null) {
            return [];
        }

        const storageKey = getStorageKey(tabId);
        const stored = await Utils.storageGet(storageKey);
        const history = Array.isArray(stored[storageKey]) ? stored[storageKey].filter(Number.isFinite) : [];
        history.push(price);
        const trimmed = history.slice(-200);
        await Utils.storageSet({ [storageKey]: trimmed });
        return trimmed;
    }

    async function getPriceHistory(tabId) {
        if (tabId == null) {
            return [];
        }
        const storageKey = getStorageKey(tabId);
        const stored = await Utils.storageGet(storageKey);
        return Array.isArray(stored[storageKey]) ? stored[storageKey].filter(Number.isFinite) : [];
    }

    function detectSwings(history) {
        const source = Array.isArray(history) ? history.filter(Number.isFinite) : [];
        const swingHighs = [];
        const swingLows = [];
        const lookback = source.length > 80 ? 2 : 1;

        for (let index = lookback; index < source.length - lookback; index += 1) {
            const current = source[index];
            const left = source.slice(Math.max(0, index - lookback), index);
            const right = source.slice(index + 1, index + 1 + lookback);
            const leftHigh = Math.max(...left);
            const rightHigh = Math.max(...right);
            const leftLow = Math.min(...left);
            const rightLow = Math.min(...right);

            if (current >= leftHigh && current >= rightHigh) {
                swingHighs.push(current);
            }
            if (current <= leftLow && current <= rightLow) {
                swingLows.push(current);
            }
        }

        return {
            swingHighs: swingHighs,
            swingLows: swingLows
        };
    }

    function clusterLevels(levels, tolerancePercent) {
        const source = Array.isArray(levels) ? levels.filter(Number.isFinite).sort((left, right) => left - right) : [];
        if (!source.length) {
            return [];
        }

        const tolerance = Number.isFinite(tolerancePercent) ? tolerancePercent : DEFAULT_CLUSTER_TOLERANCE_PERCENT;
        const clusters = [];
        let current = [source[0]];

        for (let index = 1; index < source.length; index += 1) {
            const value = source[index];
            const center = average(current);
            const dynamicTolerance = Math.max(1, Math.abs(center) * (tolerance / 100));
            if (Math.abs(value - center) <= dynamicTolerance) {
                current.push(value);
            } else {
                clusters.push(buildCluster(current));
                current = [value];
            }
        }

        clusters.push(buildCluster(current));
        return clusters.sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return left.level - right.level;
        });
    }

    function getRoundLevels(price) {
        if (!Number.isFinite(price)) {
            return [];
        }
        const rounded = [
            Math.round(price / 25) * 25,
            Math.round(price / 50) * 50,
            Math.round(price / 100) * 100
        ];
        return Array.from(new Set(rounded.filter(Number.isFinite)));
    }

    function calculateSupportResistance(args) {
        const currentPrice = Utils.toNumber(args && args.currentPrice);
        const maxPain = Utils.toNumber(args && args.maxPain);
        const changePercent = Utils.toNumber(args && args.changePercent);
        const sessionHigh = Utils.toNumber(args && args.sessionHigh);
        const sessionLow = Utils.toNumber(args && args.sessionLow);
        const history = Array.isArray(args && args.history) ? args.history.filter(Number.isFinite).slice(-200) : [];
        const bufferPercent = Utils.toNumber(args && args.bufferPercent) || 0.2;
        const reasoning = [];

        if (!Number.isFinite(currentPrice)) {
            return Utils.createEmptySupportResistance();
        }

        const swings = detectSwings(history);
        const supportClusters = clusterLevels(swings.swingLows);
        const resistanceClusters = clusterLevels(swings.swingHighs);
        const supportCandidates = supportClusters.map((cluster) => ({
            level: cluster.level,
            score: cluster.count * 2,
            source: "swing-cluster"
        }));
        const resistanceCandidates = resistanceClusters.map((cluster) => ({
            level: cluster.level,
            score: cluster.count * 2,
            source: "swing-cluster"
        }));

        getRoundLevels(currentPrice).forEach((level) => {
            if (level <= currentPrice) {
                supportCandidates.push({ level: level, score: 1, source: "round" });
            }
            if (level >= currentPrice) {
                resistanceCandidates.push({ level: level, score: 1, source: "round" });
            }
        });

        if (Number.isFinite(sessionLow)) {
            supportCandidates.push({ level: sessionLow, score: 2, source: "session-low" });
            reasoning.push("Session low included as fallback support.");
        }
        if (Number.isFinite(sessionHigh)) {
            resistanceCandidates.push({ level: sessionHigh, score: 2, source: "session-high" });
            reasoning.push("Session high included as fallback resistance.");
        }

        if (Number.isFinite(maxPain)) {
            supportCandidates.push({ level: maxPain, score: 3, source: "max-pain" });
            resistanceCandidates.push({ level: maxPain, score: 3, source: "max-pain" });
            reasoning.push("Max pain included as a soft magnetic level.");
        }

        let nearestSupport = pickNearestBelow(supportCandidates, currentPrice);
        let nearestResistance = pickNearestAbove(resistanceCandidates, currentPrice);

        if (!nearestSupport) {
            nearestSupport = {
                level: Math.floor(currentPrice / 50) * 50,
                score: 1,
                source: "round-fallback"
            };
            reasoning.push("Round-number fallback used for nearest support.");
        }
        if (!nearestResistance) {
            nearestResistance = {
                level: Math.ceil(currentPrice / 50) * 50,
                score: 1,
                source: "round-fallback"
            };
            reasoning.push("Round-number fallback used for nearest resistance.");
        }

        const secondarySupport = pickSecondaryBelow(supportCandidates, currentPrice, nearestSupport && nearestSupport.level);
        const secondaryResistance = pickSecondaryAbove(resistanceCandidates, currentPrice, nearestResistance && nearestResistance.level);

        const breakout = Number.isFinite(nearestResistance && nearestResistance.level)
            ? currentPrice > nearestResistance.level + percentOf(nearestResistance.level, bufferPercent) && (changePercent || 0) > 0
            : false;
        const breakdown = Number.isFinite(nearestSupport && nearestSupport.level)
            ? currentPrice < nearestSupport.level - percentOf(nearestSupport.level, bufferPercent) && (changePercent || 0) < 0
            : false;

        const supportLevels = uniqueLevels(supportCandidates.map((item) => item.level))
            .filter((level) => level <= currentPrice)
            .sort((left, right) => right - left)
            .slice(0, 6);
        const resistanceLevels = uniqueLevels(resistanceCandidates.map((item) => item.level))
            .filter((level) => level >= currentPrice)
            .sort((left, right) => left - right)
            .slice(0, 6);

        const supportStrength = resolveStrength(nearestSupport, maxPain, history.length);
        const resistanceStrength = resolveStrength(nearestResistance, maxPain, history.length);
        const zone = resolveZone({
            currentPrice: currentPrice,
            support: nearestSupport && nearestSupport.level,
            resistance: nearestResistance && nearestResistance.level,
            breakout: breakout,
            breakdown: breakdown
        });

        if (history.length >= 8) {
            reasoning.push(`Detected ${swings.swingLows.length} swing lows and ${swings.swingHighs.length} swing highs from rolling history.`);
        } else {
            reasoning.push("History is limited, so fallback levels are weighted higher.");
        }
        reasoning.push(`Zone classification: ${zone}.`);

        return {
            nearestSupport: toRounded(nearestSupport && nearestSupport.level),
            nearestResistance: toRounded(nearestResistance && nearestResistance.level),
            secondarySupport: toRounded(secondarySupport && secondarySupport.level),
            secondaryResistance: toRounded(secondaryResistance && secondaryResistance.level),
            supportLevels: supportLevels.map(toRounded),
            resistanceLevels: resistanceLevels.map(toRounded),
            breakout: breakout,
            breakdown: breakdown,
            zone: zone,
            supportStrength: supportStrength,
            resistanceStrength: resistanceStrength,
            strength: {
                support: supportStrength,
                resistance: resistanceStrength
            },
            reasoning: Utils.pickSummaryReasoning(reasoning, 8)
        };
    }

    function resolveZone(args) {
        if (args.breakout) {
            return "BREAKOUT";
        }
        if (args.breakdown) {
            return "BREAKDOWN";
        }

        const support = Utils.toNumber(args.support);
        const resistance = Utils.toNumber(args.resistance);
        const current = Utils.toNumber(args.currentPrice);
        if (!Number.isFinite(current) || !Number.isFinite(support) || !Number.isFinite(resistance) || resistance <= support) {
            return "MID";
        }

        const ratio = (current - support) / (resistance - support);
        if (ratio <= 0.25) {
            return "SUPPORT";
        }
        if (ratio >= 0.75) {
            return "RESISTANCE";
        }
        return "MID";
    }

    function resolveStrength(candidate, maxPain, historyLength) {
        if (!candidate) {
            return "WEAK";
        }

        let score = candidate.score || 0;
        if (historyLength >= 50) {
            score += 1;
        }
        if (Number.isFinite(maxPain) && Math.abs(candidate.level - maxPain) <= percentOf(maxPain, 0.35)) {
            score += 2;
        }

        if (score >= 6) {
            return "STRONG";
        }
        if (score >= 3) {
            return "MODERATE";
        }
        return "WEAK";
    }

    function buildCluster(values) {
        return {
            level: average(values),
            count: values.length
        };
    }

    function pickNearestBelow(candidates, currentPrice) {
        return (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level <= currentPrice)
            .sort((left, right) => {
                if (Math.abs(left.level - currentPrice) !== Math.abs(right.level - currentPrice)) {
                    return Math.abs(left.level - currentPrice) - Math.abs(right.level - currentPrice);
                }
                return (right.score || 0) - (left.score || 0);
            })[0] || null;
    }

    function pickNearestAbove(candidates, currentPrice) {
        return (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level >= currentPrice)
            .sort((left, right) => {
                if (Math.abs(left.level - currentPrice) !== Math.abs(right.level - currentPrice)) {
                    return Math.abs(left.level - currentPrice) - Math.abs(right.level - currentPrice);
                }
                return (right.score || 0) - (left.score || 0);
            })[0] || null;
    }

    function pickSecondaryBelow(candidates, currentPrice, excludeLevel) {
        return (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level < currentPrice && item.level !== excludeLevel)
            .sort((left, right) => right.level - left.level)[0] || null;
    }

    function pickSecondaryAbove(candidates, currentPrice, excludeLevel) {
        return (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level > currentPrice && item.level !== excludeLevel)
            .sort((left, right) => left.level - right.level)[0] || null;
    }

    function uniqueLevels(levels) {
        return Array.from(new Set((levels || []).filter(Number.isFinite).map((value) => String(Math.round(value * 100) / 100))))
            .map((item) => Number(item))
            .filter(Number.isFinite);
    }

    function percentOf(value, percent) {
        if (!Number.isFinite(value) || !Number.isFinite(percent)) {
            return 0;
        }
        return Math.abs(value) * (percent / 100);
    }

    function average(values) {
        if (!values || !values.length) {
            return 0;
        }
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function toRounded(value) {
        return Number.isFinite(value) ? Utils.round(value, 2) : null;
    }

    function getStorageKey(tabId) {
        return `${STORAGE_PREFIX}${tabId}`;
    }

    global.OptionsSupportResistanceEngine = {
        STORAGE_PREFIX: STORAGE_PREFIX,
        calculateSupportResistance: calculateSupportResistance,
        clusterLevels: clusterLevels,
        detectSwings: detectSwings,
        getPriceHistory: getPriceHistory,
        getRoundLevels: getRoundLevels,
        getStorageKey: getStorageKey,
        updatePriceHistory: updatePriceHistory
    };
})(typeof globalThis !== "undefined" ? globalThis : this);

