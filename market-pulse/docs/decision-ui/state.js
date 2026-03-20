export const STORAGE_KEYS = {
    settings: "market-pulse.decision.settings",
    activeTrade: "market-pulse.decision.active-trade",
    lastAlert: "market-pulse.decision.last-alert"
};

export const DEFAULT_SETTINGS = {
    instrument: "NIFTY",
    engineVersion: "adaptive-v2",
    strikeStyle: "AUTO",
    expiryPreference: "current",
    capital: 100000,
    riskPercent: 1,
    lotSize: "",
    minimumConfidence: 64,
    vwapBandPercent: 0.18,
    autoRefresh: true,
    intervalMs: 10000
};

export function createState() {
    return {
        settings: { ...DEFAULT_SETTINGS },
        activeTrade: null,
        payload: null,
        timerId: null,
        isLoading: false,
        pendingReload: false,
        controller: null
    };
}
