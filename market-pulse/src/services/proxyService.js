const { NSE_ENDPOINTS } = require("../config/sources");
const { fetchText, fetchWithTimeout, normalizeError } = require("../utils/http");

const ALLOWED_PROXY_HOSTS = new Set([
    "www.nseindia.com",
    "query1.finance.yahoo.com",
    "news.google.com"
]);

let nseSession = {
    cookieHeader: "",
    fetchedAt: 0
};

function validateProxyUrl(rawUrl) {
    const url = new URL(String(rawUrl || ""));
    if (url.protocol !== "https:") {
        throw new Error("Only https proxy targets are allowed.");
    }
    if (!ALLOWED_PROXY_HOSTS.has(url.hostname)) {
        throw new Error(`Proxy host is not allowed: ${url.hostname}`);
    }

    return url;
}

function buildReferer(url) {
    if (url.hostname === "query1.finance.yahoo.com") {
        return "https://finance.yahoo.com/";
    }
    if (url.hostname === "www.nseindia.com") {
        return NSE_ENDPOINTS.home;
    }

    return `${url.origin}/`;
}

async function refreshNseSession() {
    const { headers } = await fetchText(NSE_ENDPOINTS.home, {
        headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            referer: NSE_ENDPOINTS.home
        }
    });

    const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    nseSession = {
        cookieHeader: cookies.map((cookie) => cookie.split(";")[0]).join("; "),
        fetchedAt: Date.now()
    };
}

async function fetchNseProxyResponse(targetUrl, timeoutMs) {
    if (!nseSession.cookieHeader || (Date.now() - nseSession.fetchedAt) > (20 * 60 * 1000)) {
        await refreshNseSession();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetchWithTimeout(targetUrl, {
                timeoutMs,
                headers: {
                    referer: buildReferer(new URL(targetUrl)),
                    cookie: nseSession.cookieHeader
                }
            });

            if (response.ok) {
                return response;
            }

            throw new Error(`Request failed (${response.status}) for ${targetUrl}`);
        } catch (error) {
            const message = normalizeError(error);
            const shouldRetry = attempt === 0 && /403|401|Unexpected token/i.test(message);

            if (!shouldRetry) {
                throw error;
            }

            await refreshNseSession();
        }
    }

    throw new Error("Unable to establish a usable NSE proxy session.");
}

async function proxyRemoteRequest(rawUrl, options = {}) {
    const url = validateProxyUrl(rawUrl);
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : undefined;
    const response = url.hostname === "www.nseindia.com"
        ? await fetchNseProxyResponse(url.toString(), timeoutMs)
        : await fetchWithTimeout(url.toString(), {
            timeoutMs,
            headers: {
                referer: buildReferer(url)
            }
        });

    const body = await response.text();

    return {
        targetUrl: url.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") || "text/plain; charset=utf-8",
        body
    };
}

module.exports = {
    proxyRemoteRequest
};
