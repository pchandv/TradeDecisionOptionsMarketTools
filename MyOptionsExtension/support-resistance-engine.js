(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;
    const STORAGE_PREFIX = "priceHistory_";
    const CLUSTER_TOLERANCE_PERCENT = 0.3;
    const STRUCTURE_SNAP_PERCENT = 0.12;

    async function updatePriceHistory(price, tabId) {
        if (!Number.isFinite(price) || tabId == null) {
            return [];
        }

        const storageKey = getStorageKey(tabId);
        const stored = await Utils.storageGet(storageKey);
        const history = Array.isArray(stored[storageKey]) ? stored[storageKey].slice() : [];
        history.push(price);
        const trimmed = history.slice(-50);
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
        const swingHighs = [];
        const swingLows = [];
        const source = Array.isArray(history) ? history.filter(Number.isFinite) : [];

        for (let index = 1; index < source.length - 1; index += 1) {
            if (source[index] > source[index - 1] && source[index] > source[index + 1]) {
                swingHighs.push(source[index]);
            }

            if (source[index] < source[index - 1] && source[index] < source[index + 1]) {
                swingLows.push(source[index]);
            }
        }

        return {
            swingHighs: swingHighs,
            swingLows: swingLows
        };
    }

    function clusterLevels(levels) {
        const source = Array.isArray(levels) ? levels.filter(Number.isFinite).sort((left, right) => left - right) : [];
        if (!source.length) {
            return [];
        }

        const clusters = [];
        let currentCluster = [source[0]];

        for (let index = 1; index < source.length; index += 1) {
            const currentValue = source[index];
            const clusterCenter = average(currentCluster);
            const tolerance = Math.abs(clusterCenter) * (CLUSTER_TOLERANCE_PERCENT / 100);

            if (Math.abs(currentValue - clusterCenter) <= tolerance) {
                currentCluster.push(currentValue);
            } else {
                clusters.push(buildCluster(currentCluster));
                currentCluster = [currentValue];
            }
        }

        clusters.push(buildCluster(currentCluster));

        return clusters
            .sort((left, right) => {
                if (right.count !== left.count) {
                    return right.count - left.count;
                }
                return Math.abs(left.level) - Math.abs(right.level);
            })
            .slice(0, 2);
    }

    function getRoundLevels(price) {
        if (!Number.isFinite(price)) {
            return [];
        }
        const nearest50 = Math.round(price / 50) * 50;
        const nearest100 = Math.round(price / 100) * 100;
        return Array.from(new Set([nearest50, nearest100]));
    }

    function calculateSupportResistance(args) {
        const currentPrice = Utils.toNumber(args && args.currentPrice);
        const maxPain = Utils.toNumber(args && args.maxPain);
        const changePercent = Utils.toNumber(args && args.changePercent);
        const history = Array.isArray(args && args.history) ? args.history.filter(Number.isFinite) : [];
        const reasoning = [];

        if (!Number.isFinite(currentPrice)) {
            return Utils.createEmptySupportResistance();
        }

        const swings = detectSwings(history);
        const supportClusters = clusterLevels(swings.swingLows);
        const resistanceClusters = clusterLevels(swings.swingHighs);
        const roundLevels = getRoundLevels(currentPrice);
        const historyTooShort = history.length < 5;

        const supportCandidates = supportClusters.map((cluster) => ({
            level: cluster.level,
            count: cluster.count,
            source: "swing"
        }));
        const resistanceCandidates = resistanceClusters.map((cluster) => ({
            level: cluster.level,
            count: cluster.count,
            source: "swing"
        }));

        roundLevels.forEach((level) => {
            if (level <= currentPrice) {
                supportCandidates.push({ level: level, count: 1, source: "round" });
            }
            if (level >= currentPrice) {
                resistanceCandidates.push({ level: level, count: 1, source: "round" });
            }
        });

        if (Number.isFinite(maxPain)) {
            supportCandidates.push({ level: maxPain, count: 3, source: "maxPain" });
            resistanceCandidates.push({ level: maxPain, count: 3, source: "maxPain" });
            reasoning.push("Max pain is included as a strong key level.");
        }

        if (historyTooShort) {
            reasoning.push("History is short, so round-number levels are weighted more heavily.");
        } else {
            reasoning.push(`Detected ${swings.swingLows.length} swing low(s) and ${swings.swingHighs.length} swing high(s).`);
        }

        let nearestSupport = pickClosestBelow(supportCandidates, currentPrice);
        let nearestResistance = pickClosestAbove(resistanceCandidates, currentPrice);

        if (!nearestSupport) {
            supportCandidates.push({ level: Math.floor(currentPrice / 100) * 100, count: 1, source: "fallbackRound" });
            nearestSupport = pickClosestBelow(supportCandidates, currentPrice);
            reasoning.push("Support fallback used a nearby round-number level.");
        }

        if (!nearestResistance) {
            resistanceCandidates.push({ level: Math.ceil(currentPrice / 100) * 100, count: 1, source: "fallbackRound" });
            nearestResistance = pickClosestAbove(resistanceCandidates, currentPrice);
            reasoning.push("Resistance fallback used a nearby round-number level.");
        }

        const supportLevels = uniqueLevels(supportCandidates.map((item) => item.level))
            .filter((level) => level <= currentPrice)
            .sort((left, right) => right - left);
        const resistanceLevels = uniqueLevels(resistanceCandidates.map((item) => item.level))
            .filter((level) => level >= currentPrice)
            .sort((left, right) => left - right);
        const secondarySupport = pickSecondaryBelow(supportCandidates, currentPrice, nearestSupport && nearestSupport.level);
        const secondaryResistance = pickSecondaryAbove(resistanceCandidates, currentPrice, nearestResistance && nearestResistance.level);
        const breakoutReference = nearestResistance || pickClosestOverall(resistanceCandidates, currentPrice);
        const breakdownReference = nearestSupport || pickClosestOverall(supportCandidates, currentPrice);
        const breakout = Boolean(breakoutReference && currentPrice > breakoutReference.level && (changePercent || 0) > 0);
        const breakdown = Boolean(breakdownReference && currentPrice < breakdownReference.level && (changePercent || 0) < 0);

        if (nearestSupport) {
            reasoning.push(`Nearest support is around ${Utils.formatNumber(nearestSupport.level, 2)}.`);
        }
        if (nearestResistance) {
            reasoning.push(`Nearest resistance is around ${Utils.formatNumber(nearestResistance.level, 2)}.`);
        }
        if (breakout) {
            reasoning.push("Price is trading above the nearest resistance with positive momentum.");
        }
        if (breakdown) {
            reasoning.push("Price is trading below the nearest support with negative momentum.");
        }

        return {
            nearestSupport: nearestSupport ? Utils.round(nearestSupport.level, 2) : null,
            nearestResistance: nearestResistance ? Utils.round(nearestResistance.level, 2) : null,
            secondarySupport: secondarySupport ? Utils.round(secondarySupport.level, 2) : null,
            secondaryResistance: secondaryResistance ? Utils.round(secondaryResistance.level, 2) : null,
            supportLevels: supportLevels.slice(0, 4).map((level) => Utils.round(level, 2)),
            resistanceLevels: resistanceLevels.slice(0, 4).map((level) => Utils.round(level, 2)),
            breakout: breakout,
            breakdown: breakdown,
            strength: {
                support: resolveStrength(nearestSupport, maxPain, historyTooShort),
                resistance: resolveStrength(nearestResistance, maxPain, historyTooShort)
            },
            reasoning: Utils.pickSummaryReasoning(reasoning, 6)
        };
    }

    function resolveStrength(levelCandidate, maxPain, historyTooShort) {
        if (!levelCandidate || historyTooShort) {
            return "WEAK";
        }

        if (levelCandidate.count > 2 || (Number.isFinite(maxPain) && Math.abs(levelCandidate.level - maxPain) <= Math.abs(maxPain) * 0.003)) {
            return "STRONG";
        }
        if (levelCandidate.count === 2) {
            return "MODERATE";
        }
        return "WEAK";
    }

    function buildCluster(cluster) {
        return {
            level: snapLevelToRound(average(cluster)),
            count: cluster.length
        };
    }

    function average(items) {
        if (!items.length) {
            return 0;
        }
        return items.reduce((sum, value) => sum + value, 0) / items.length;
    }

    function uniqueLevels(levels) {
        return Array.from(new Set((levels || []).filter(Number.isFinite)));
    }

    function pickClosestBelow(candidates, currentPrice) {
        const filtered = (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level <= currentPrice)
            .sort((left, right) => right.level - left.level);
        return filtered[0] || null;
    }

    function pickClosestAbove(candidates, currentPrice) {
        const filtered = (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level >= currentPrice)
            .sort((left, right) => left.level - right.level);
        return filtered[0] || null;
    }

    function pickSecondaryBelow(candidates, currentPrice, excludeLevel) {
        const filtered = (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level < currentPrice && item.level !== excludeLevel)
            .sort((left, right) => right.level - left.level);
        return filtered[0] || null;
    }

    function pickSecondaryAbove(candidates, currentPrice, excludeLevel) {
        const filtered = (candidates || [])
            .filter((item) => Number.isFinite(item.level) && item.level > currentPrice && item.level !== excludeLevel)
            .sort((left, right) => left.level - right.level);
        return filtered[0] || null;
    }

    function pickClosestOverall(candidates, currentPrice) {
        const filtered = (candidates || []).filter((item) => Number.isFinite(item.level));
        if (!filtered.length) {
            return null;
        }
        return filtered.sort((left, right) => Math.abs(left.level - currentPrice) - Math.abs(right.level - currentPrice))[0];
    }

    function getStorageKey(tabId) {
        return `${STORAGE_PREFIX}${tabId}`;
    }

    function snapLevelToRound(level) {
        if (!Number.isFinite(level)) {
            return null;
        }
        const nearest50 = Math.round(level / 50) * 50;
        const nearest100 = Math.round(level / 100) * 100;
        const candidates = [nearest50, nearest100];
        const bestCandidate = candidates
            .filter(Number.isFinite)
            .sort((left, right) => Math.abs(left - level) - Math.abs(right - level))[0];

        if (!Number.isFinite(bestCandidate) || level === 0) {
            return level;
        }

        const distancePercent = Math.abs(((level - bestCandidate) / level) * 100);
        return distancePercent <= STRUCTURE_SNAP_PERCENT ? bestCandidate : level;
    }

    global.OptionsSupportResistanceEngine = {
        STORAGE_PREFIX: STORAGE_PREFIX,
        calculateSupportResistance: calculateSupportResistance,
        clusterLevels: clusterLevels,
        detectSwings: detectSwings,
        getStorageKey: getStorageKey,
        getPriceHistory: getPriceHistory,
        getRoundLevels: getRoundLevels,
        updatePriceHistory: updatePriceHistory
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
