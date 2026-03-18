const MONTHS = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11
};

function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 2) {
    if (!Number.isFinite(value)) {
        return null;
    }

    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function parseMarketDate(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    const match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) {
        const fallback = new Date(value);
        return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
    }

    const [, dayValue, monthToken, yearValue, hourValue = "00", minuteValue = "00", secondValue = "00"] = match;
    const monthIndex = MONTHS[monthToken];
    if (monthIndex === undefined) {
        return null;
    }

    const date = new Date(Date.UTC(
        Number(yearValue),
        monthIndex,
        Number(dayValue),
        Number(hourValue),
        Number(minuteValue),
        Number(secondValue)
    ));

    return date.toISOString();
}

function formatValue(value, digits = 2) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    return value.toFixed(digits);
}

function statusFromTimestamp(timestamp, state = "") {
    if (!timestamp) {
        return "unavailable";
    }

    const ageMinutes = (Date.now() - new Date(timestamp).getTime()) / 60000;
    const normalized = String(state || "").toUpperCase();
    const liveStates = ["REGULAR", "OPEN", "PRE", "POST", "STREAMING"];

    if (liveStates.some((token) => normalized.includes(token)) && ageMinutes <= 30) {
        return "live";
    }

    if (ageMinutes <= 24 * 60) {
        return "delayed";
    }

    return "unavailable";
}

function createSourceStatus(key, label, status, message, lastUpdated, source, sourceUrl) {
    return {
        key,
        label,
        status,
        message,
        lastUpdated: lastUpdated || null,
        source: source || null,
        sourceUrl: sourceUrl || null
    };
}

function createUnavailableInstrument(definition, reason) {
    return {
        key: definition.key,
        label: definition.label,
        symbol: definition.symbol || definition.key,
        source: definition.source,
        sourceUrl: definition.sourceUrl || null,
        price: null,
        change: null,
        changePercent: null,
        previousClose: null,
        open: null,
        high: null,
        low: null,
        updatedAt: null,
        status: "unavailable",
        reason
    };
}

function summarizeDirection(value, positiveLabel, negativeLabel, neutralLabel = "Neutral") {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }
    if (value > 0) {
        return positiveLabel;
    }
    if (value < 0) {
        return negativeLabel;
    }
    return neutralLabel;
}

module.exports = {
    clamp,
    createSourceStatus,
    createUnavailableInstrument,
    formatValue,
    parseMarketDate,
    round,
    statusFromTimestamp,
    summarizeDirection,
    toNumber
};
