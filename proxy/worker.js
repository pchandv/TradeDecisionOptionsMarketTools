const ALLOWED_HOSTS = new Set([
    "www.nseindia.com",
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "news.google.com"
]);

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store"
};

const COMMON_HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    accept: "application/json, text/plain, */*",
    "accept-language": "en-IN,en-US;q=0.9,en;q=0.8",
    pragma: "no-cache",
    "cache-control": "no-cache"
};

let nseSession = {
    cookieHeader: "",
    fetchedAt: 0
};

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS
            });
        }

        const requestUrl = new URL(request.url);
        const targetParam = requestUrl.searchParams.get("url");
        const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";

        if (!targetParam) {
            return jsonResponse({
                ok: true,
                service: "options-market-decision-engine-proxy",
                usage: `${requestUrl.origin}${pathname === "/" ? "/api" : pathname}?url=<https-url>`
            });
        }

        if (pathname !== "/" && pathname !== "/api") {
            return jsonResponse({
                ok: false,
                error: "Unsupported path. Use /api?url=<https-url>."
            }, 404);
        }

        try {
            const targetUrl = validateTargetUrl(targetParam);
            const upstreamResponse = await fetchUpstream(targetUrl);
            const contentType = upstreamResponse.headers.get("content-type") || "text/plain; charset=utf-8";
            const text = await upstreamResponse.text();
            const isJson = /json/i.test(contentType);
            const payload = {
                ok: upstreamResponse.ok,
                status: upstreamResponse.status,
                url: targetUrl.toString(),
                contentType,
                data: isJson ? safeJsonParse(text) : null,
                text: isJson ? null : text,
                proxiedAt: new Date().toISOString()
            };

            if (!upstreamResponse.ok) {
                payload.error = `Upstream request failed with status ${upstreamResponse.status}.`;
            }

            return jsonResponse(payload, upstreamResponse.ok ? 200 : upstreamResponse.status);
        } catch (error) {
            return jsonResponse({
                ok: false,
                error: error instanceof Error ? error.message : "Unknown proxy error",
                proxiedAt: new Date().toISOString()
            }, 502);
        }
    }
};

function validateTargetUrl(rawUrl) {
    const targetUrl = new URL(String(rawUrl || "").trim());

    if (targetUrl.protocol !== "https:") {
        throw new Error("Only https proxy targets are allowed.");
    }

    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
        throw new Error(`Host is not allowlisted: ${targetUrl.hostname}`);
    }

    return targetUrl;
}

async function fetchUpstream(targetUrl) {
    if (targetUrl.hostname === "www.nseindia.com") {
        return fetchNseWithSession(targetUrl);
    }

    return fetch(targetUrl.toString(), {
        method: "GET",
        headers: buildHeaders(targetUrl)
    });
}

async function fetchNseWithSession(targetUrl) {
    if (!nseSession.cookieHeader || (Date.now() - nseSession.fetchedAt) > (20 * 60 * 1000)) {
        await primeNseSession();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(targetUrl.toString(), {
            method: "GET",
            headers: buildHeaders(targetUrl, {
                cookie: nseSession.cookieHeader
            })
        });

        if (response.ok) {
            return response;
        }

        if (attempt === 0 && (response.status === 401 || response.status === 403)) {
            await primeNseSession();
            continue;
        }

        return response;
    }

    throw new Error("Unable to establish a valid NSE session.");
}

async function primeNseSession() {
    const response = await fetch("https://www.nseindia.com/", {
        method: "GET",
        headers: buildHeaders(new URL("https://www.nseindia.com/"), {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        })
    });

    nseSession = {
        cookieHeader: extractCookies(response.headers),
        fetchedAt: Date.now()
    };
}

function extractCookies(headers) {
    if (typeof headers.getSetCookie === "function") {
        return headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    }

    if (typeof headers.getAll === "function") {
        const cookies = headers.getAll("Set-Cookie");
        if (Array.isArray(cookies) && cookies.length) {
            return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
        }
    }

    const singleCookie = headers.get("set-cookie");
    return singleCookie
        ? singleCookie.split(/,(?=[^;,]+=)/).map((cookie) => cookie.split(";")[0]).join("; ")
        : "";
}

function buildHeaders(targetUrl, extraHeaders = {}) {
    return {
        ...COMMON_HEADERS,
        referer: targetUrl.hostname === "www.nseindia.com"
            ? "https://www.nseindia.com/"
            : targetUrl.hostname.includes("yahoo")
                ? "https://finance.yahoo.com/"
                : "https://news.google.com/",
        ...extraHeaders
    };
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...CORS_HEADERS
        }
    });
}
