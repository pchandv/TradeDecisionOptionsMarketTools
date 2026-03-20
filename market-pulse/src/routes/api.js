const express = require("express");
const { buildDashboardPayload } = require("../services/dashboardService");
const { buildInvestingPayload } = require("../services/investingService");
const { proxyRemoteRequest } = require("../services/proxyService");
const { getBuildInfo } = require("../config/buildInfo");

const router = express.Router();

router.get("/health", (request, response) => {
    const buildInfo = getBuildInfo();
    response.json({
        ok: true,
        timestamp: new Date().toISOString(),
        version: buildInfo.version,
        builtAt: buildInfo.builtAt,
        buildSource: buildInfo.source
    });
});

router.get("/dashboard", async (request, response) => {
    try {
        const payload = await buildDashboardPayload(request.query || {});
        response.json(payload);
    } catch (error) {
        response.status(500).json({
            error: "dashboard_fetch_failed",
            message: error?.message || "Unable to assemble the live dashboard payload."
        });
    }
});

router.get("/investing", async (request, response) => {
    try {
        const payload = await buildInvestingPayload();
        response.json(payload);
    } catch (error) {
        response.status(500).json({
            error: "investing_fetch_failed",
            message: error?.message || "Unable to assemble the investing ideas payload."
        });
    }
});

router.get("/proxy", async (request, response) => {
    try {
        const url = String(request.query?.url || "").trim();
        if (!url) {
            response.status(400).json({
                error: "proxy_url_missing",
                message: "Query parameter `url` is required."
            });
            return;
        }

        const proxied = await proxyRemoteRequest(url, {
            timeoutMs: request.query?.timeoutMs
        });

        response.setHeader("Cache-Control", "no-store, max-age=0");
        response.setHeader("Content-Type", proxied.contentType);
        response.setHeader("X-Proxy-Target", proxied.targetUrl);
        response.status(proxied.status).send(proxied.body);
    } catch (error) {
        response.status(502).json({
            error: "proxy_fetch_failed",
            message: error?.message || "Unable to proxy the requested source."
        });
    }
});

module.exports = router;
