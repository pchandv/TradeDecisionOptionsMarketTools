const numberFormatter = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
});

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function formatNumber(value) {
    return Number.isFinite(value) ? numberFormatter.format(value) : "Unavailable";
}

export function formatCurrency(value) {
    return Number.isFinite(value) ? `Rs ${numberFormatter.format(value)}` : "Unavailable";
}

export function formatPercent(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}%` : "Unavailable";
}

export function formatSignedPercent(value) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }

    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatSignedNumber(value) {
    if (!Number.isFinite(value)) {
        return "Unavailable";
    }

    return `${value > 0 ? "+" : ""}${numberFormatter.format(value)}`;
}

export function formatTimestamp(value) {
    if (!value) {
        return "Unavailable";
    }

    return new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

export function toneFromStatus(status, direction = "WAIT") {
    if (status === "EXIT") {
        return "negative";
    }
    if (status === "WAIT" || direction === "WAIT") {
        return "neutral";
    }
    return direction === "PE" ? "negative" : "positive";
}

export function toneFromScore(score) {
    if (!Number.isFinite(score)) {
        return "neutral";
    }
    if (score > 0) {
        return "positive";
    }
    if (score < 0) {
        return "negative";
    }
    return "neutral";
}

export function compactDirection(direction) {
    if (direction === "CE" || direction === "PE") {
        return direction;
    }
    return "WAIT";
}
