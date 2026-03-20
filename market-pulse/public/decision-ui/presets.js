export const SESSION_PRESETS = {
    CUSTOM: {
        key: "CUSTOM",
        label: "Custom"
    },
    OPEN_DRIVE: {
        key: "OPEN_DRIVE",
        label: "Open Drive",
        minimumConfidence: 56,
        vwapBandPercent: 0.2,
        intervalMs: 5000,
        tradeAggressiveness: "AGGRESSIVE"
    },
    MIDDAY_CHOP: {
        key: "MIDDAY_CHOP",
        label: "Midday Chop",
        minimumConfidence: 68,
        vwapBandPercent: 0.12,
        intervalMs: 15000,
        tradeAggressiveness: "DEFENSIVE"
    },
    EXPIRY_FAST: {
        key: "EXPIRY_FAST",
        label: "Expiry Fast",
        minimumConfidence: 60,
        vwapBandPercent: 0.22,
        intervalMs: 5000,
        tradeAggressiveness: "BALANCED"
    },
    RISK_OFF: {
        key: "RISK_OFF",
        label: "Risk Off",
        minimumConfidence: 74,
        vwapBandPercent: 0.1,
        intervalMs: 10000,
        tradeAggressiveness: "DEFENSIVE"
    }
};

export function applySessionPreset(presetKey, settings) {
    const preset = SESSION_PRESETS[presetKey] || SESSION_PRESETS.CUSTOM;
    if (preset.key === "CUSTOM") {
        return {
            ...settings,
            sessionPreset: "CUSTOM"
        };
    }

    return {
        ...settings,
        sessionPreset: preset.key,
        minimumConfidence: preset.minimumConfidence,
        vwapBandPercent: preset.vwapBandPercent,
        intervalMs: preset.intervalMs,
        tradeAggressiveness: preset.tradeAggressiveness
    };
}
