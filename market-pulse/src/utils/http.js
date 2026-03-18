const { COMMON_HEADERS, TIMEOUTS } = require("../config/sources");

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUTS.http);

    try {
        return await fetch(url, {
            ...options,
            headers: {
                ...COMMON_HEADERS,
                ...(options.headers || {})
            },
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchJson(url, options = {}) {
    const response = await fetchWithTimeout(url, options);
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
    }

    try {
        return {
            data: JSON.parse(text),
            headers: response.headers
        };
    } catch (error) {
        throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 240)}`);
    }
}

async function fetchText(url, options = {}) {
    const response = await fetchWithTimeout(url, options);
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
    }

    return {
        data: text,
        headers: response.headers
    };
}

function normalizeError(error) {
    if (error?.name === "AbortError") {
        return "Request timed out";
    }
    return error?.message || "Unknown fetch error";
}

module.exports = {
    fetchJson,
    fetchText,
    fetchWithTimeout,
    normalizeError
};
