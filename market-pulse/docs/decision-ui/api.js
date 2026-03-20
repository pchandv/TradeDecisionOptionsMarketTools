function appendIfPresent(params, key, value) {
    if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
    }
}

export function buildDashboardQuery(settings, activeTrade) {
    const params = new URLSearchParams();
    params.set("ts", String(Date.now()));
    params.set("instrument", settings.instrument);
    params.set("engineVersion", settings.engineVersion);
    params.set("sessionPreset", settings.sessionPreset);
    params.set("tradeAggressiveness", settings.tradeAggressiveness);
    params.set("strikeStyle", settings.strikeStyle);
    params.set("expiryPreference", settings.expiryPreference);
    params.set("capital", String(settings.capital));
    params.set("riskPercent", String(settings.riskPercent));
    params.set("minimumConfidence", String(settings.minimumConfidence));
    params.set("vwapBandPercent", String(settings.vwapBandPercent));

    appendIfPresent(params, "lotSize", settings.lotSize);

    if (activeTrade) {
        appendIfPresent(params, "activePlanId", activeTrade.planId);
        appendIfPresent(params, "activeInstrument", activeTrade.instrument);
        appendIfPresent(params, "activeOptionType", activeTrade.optionType);
        appendIfPresent(params, "activeStrike", activeTrade.strikePrice);
        appendIfPresent(params, "activeExpiry", activeTrade.expiry);
        appendIfPresent(params, "activeEntry", activeTrade.entryPrice);
        appendIfPresent(params, "activeStop", activeTrade.stopLoss);
        appendIfPresent(params, "activeTarget1", activeTrade.target1);
        appendIfPresent(params, "activeTarget2", activeTrade.target2);
        appendIfPresent(params, "activeSpotInvalidation", activeTrade.spotInvalidation);
        appendIfPresent(params, "activeEntryConfidence", activeTrade.entryConfidence);
        appendIfPresent(params, "activeLastConfidence", activeTrade.lastConfidence);
        appendIfPresent(params, "activeLotSize", activeTrade.lotSize);
        appendIfPresent(params, "activeMaxLots", activeTrade.maxLots);
        appendIfPresent(params, "activeTakenAt", activeTrade.acknowledgedAt);
    }

    return params.toString();
}

function isStandaloneMode() {
    return document.body?.dataset?.appMode === "browser-standalone";
}

export async function fetchDashboardPayload(settings, activeTrade, signal) {
    if (isStandaloneMode()) {
        if (typeof window.buildStandaloneDashboardPayload !== "function") {
            throw new Error("Standalone data loader is unavailable.");
        }

        const payload = await window.buildStandaloneDashboardPayload({
            settings,
            activeTrade,
            signal
        });

        return payload?.payload ?? payload ?? {
            dashboard: null,
            sourceStatuses: [],
            metadata: null
        };
    }

    const response = await fetch(`/api/dashboard?${buildDashboardQuery(settings, activeTrade)}`, {
        cache: "no-store",
        signal
    });
    const responseText = await response.text();
    let payload = null;

    try {
        payload = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(payload?.message || "Unable to fetch the dashboard payload.");
    }

    return payload?.payload ?? payload ?? {
        dashboard: null,
        sourceStatuses: [],
        metadata: null
    };
}
