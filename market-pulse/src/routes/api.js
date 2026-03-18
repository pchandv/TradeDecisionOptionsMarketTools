const express = require("express");
const { buildDashboardPayload } = require("../services/dashboardService");

const router = express.Router();

router.get("/health", (request, response) => {
    response.json({
        ok: true,
        timestamp: new Date().toISOString()
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

module.exports = router;
