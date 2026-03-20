import { fetchDashboardPayload } from "./api.js";
import { recordJournalEntry, updateJournalOutcome } from "./journal.js";
import { applySessionPreset, SESSION_PRESETS } from "./presets.js";
import { renderDashboard } from "./render.js";
import { createState, DEFAULT_SETTINGS, STORAGE_KEYS } from "./state.js";
import { readStorageJson, removeStorageKey, writeStorageJson } from "./storage.js";

const state = createState();

function isStandaloneMode() {
    return document.body?.dataset?.appMode === "browser-standalone";
}

function normalizePositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function setError(message) {
    const banner = document.getElementById("errorBanner");
    banner.hidden = !message;
    banner.className = `banner ${message ? "error" : ""}`;
    banner.textContent = message || "";
}

function loadLocalState() {
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...(readStorageJson(STORAGE_KEYS.settings, {}) || {})
    };
    state.activeTrade = readStorageJson(STORAGE_KEYS.activeTrade, null);
}

function syncControlsFromState() {
    document.getElementById("instrumentInput").value = state.settings.instrument;
    document.getElementById("engineVersionInput").value = state.settings.engineVersion;
    document.getElementById("sessionPresetInput").value = state.settings.sessionPreset;
    document.getElementById("tradeAggressivenessInput").value = state.settings.tradeAggressiveness;
    document.getElementById("strikeStyleInput").value = state.settings.strikeStyle;
    document.getElementById("expiryPreferenceInput").value = state.settings.expiryPreference;
    document.getElementById("capitalInput").value = state.settings.capital;
    document.getElementById("riskPercentInput").value = state.settings.riskPercent;
    document.getElementById("lotSizeInput").value = state.settings.lotSize;
    document.getElementById("minimumConfidenceInput").value = state.settings.minimumConfidence;
    document.getElementById("vwapBandPercentInput").value = state.settings.vwapBandPercent;
    document.getElementById("autoRefreshToggle").checked = state.settings.autoRefresh;
    document.getElementById("refreshInterval").value = String(state.settings.intervalMs);
}

function persistSettings() {
    writeStorageJson(STORAGE_KEYS.settings, state.settings);
}

function saveSettingsFromForm() {
    state.settings = {
        ...state.settings,
        instrument: document.getElementById("instrumentInput").value || DEFAULT_SETTINGS.instrument,
        engineVersion: document.getElementById("engineVersionInput").value || DEFAULT_SETTINGS.engineVersion,
        sessionPreset: document.getElementById("sessionPresetInput").value || DEFAULT_SETTINGS.sessionPreset,
        tradeAggressiveness: document.getElementById("tradeAggressivenessInput").value || DEFAULT_SETTINGS.tradeAggressiveness,
        strikeStyle: document.getElementById("strikeStyleInput").value || DEFAULT_SETTINGS.strikeStyle,
        expiryPreference: document.getElementById("expiryPreferenceInput").value || DEFAULT_SETTINGS.expiryPreference,
        capital: normalizePositiveNumber(document.getElementById("capitalInput").value) || DEFAULT_SETTINGS.capital,
        riskPercent: normalizePositiveNumber(document.getElementById("riskPercentInput").value) || DEFAULT_SETTINGS.riskPercent,
        lotSize: document.getElementById("lotSizeInput").value || "",
        minimumConfidence: normalizePositiveNumber(document.getElementById("minimumConfidenceInput").value) || DEFAULT_SETTINGS.minimumConfidence,
        vwapBandPercent: normalizePositiveNumber(document.getElementById("vwapBandPercentInput").value) || DEFAULT_SETTINGS.vwapBandPercent
    };

    persistSettings();
}

function syncManualControlsToCustomPreset() {
    state.settings.sessionPreset = SESSION_PRESETS.CUSTOM.key;
    document.getElementById("sessionPresetInput").value = SESSION_PRESETS.CUSTOM.key;
}

function resetAutoRefreshTimer() {
    if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
    }

    if (state.settings.autoRefresh) {
        state.timerId = setInterval(() => {
            loadDashboard();
        }, state.settings.intervalMs);
    }
}

function maybeNotifyTradeMonitor(payload) {
    const monitor = payload?.dashboard?.tradeMonitor;
    if (!state.activeTrade || !monitor?.alertKey || !("Notification" in window) || Notification.permission !== "granted") {
        return;
    }

    const previous = localStorage.getItem(STORAGE_KEYS.lastAlert);
    if (previous === monitor.alertKey) {
        return;
    }

    localStorage.setItem(STORAGE_KEYS.lastAlert, monitor.alertKey);
    new Notification(`Trade update: ${monitor.action}`, {
        body: `${monitor.headline}. ${monitor.detail}`,
        icon: "./icon.svg",
        tag: monitor.planId || "trade-monitor"
    });
}

async function loadDashboard(options = {}) {
    if (state.isLoading) {
        if (options.userInitiated) {
            state.pendingReload = true;
        }
        return;
    }

    state.isLoading = true;
    const refreshButton = document.getElementById("manualRefreshBtn");
    const controller = new AbortController();
    state.controller = controller;
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    setError("");

    try {
        const payload = await fetchDashboardPayload(state.settings, state.activeTrade, controller.signal);
        state.payload = payload;
        if (state.activeTrade) {
            state.activeTrade.lastConfidence = payload?.dashboard?.decision?.confidence ?? state.activeTrade.lastConfidence;
            writeStorageJson(STORAGE_KEYS.activeTrade, state.activeTrade);
            updateJournalOutcome(state.activeTrade, payload?.dashboard?.tradeMonitor);
        }
        renderDashboard(state, payload);
        setError(payload?.metadata?.fallbackReason || (payload?.dashboard?.feedHealth?.blocksTradeSignals ? payload.dashboard.feedHealth.summary : ""));
        maybeNotifyTradeMonitor(payload);
    } catch (error) {
        setError(error?.name === "AbortError"
            ? "Live request timed out. Try again on the next refresh."
            : (error.message || "Unable to load the decision dashboard."));
    } finally {
        state.isLoading = false;
        if (state.controller === controller) {
            state.controller = null;
        }
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh now";

        if (state.pendingReload) {
            state.pendingReload = false;
            loadDashboard();
        }
    }
}

function takeCurrentTrade() {
    const plan = state.payload?.dashboard?.tradePlan;
    if (!plan?.actionable) {
        return;
    }

    state.activeTrade = {
        planId: plan.planId,
        instrument: plan.contract.symbol,
        optionType: plan.contract.optionType,
        strikePrice: plan.contract.strikePrice,
        expiry: plan.contract.expiry,
        entryPrice: plan.entry.premiumReference,
        stopLoss: plan.exit.stopLoss,
        target1: plan.exit.target1,
        target2: plan.exit.target2,
        spotInvalidation: plan.exit.spotInvalidation,
        entryConfidence: state.payload?.dashboard?.decision?.confidence ?? null,
        lastConfidence: state.payload?.dashboard?.decision?.confidence ?? null,
        lotSize: normalizePositiveNumber(state.settings.lotSize),
        maxLots: plan.sizing.maxLots,
        acknowledgedAt: new Date().toISOString(),
        label: plan.contract.label
    };

    writeStorageJson(STORAGE_KEYS.activeTrade, state.activeTrade);
    recordJournalEntry({
        payload: state.payload,
        activeTrade: state.activeTrade,
        settings: state.settings
    });
    removeStorageKey(STORAGE_KEYS.lastAlert);
    loadDashboard({ userInitiated: true });
}

function clearActiveTrade() {
    state.activeTrade = null;
    removeStorageKey(STORAGE_KEYS.activeTrade);
    removeStorageKey(STORAGE_KEYS.lastAlert);
    loadDashboard({ userInitiated: true });
}

async function enableAlerts() {
    if (!("Notification" in window)) {
        setError("Browser notifications are not supported on this device.");
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        setError("Browser alerts were not enabled.");
        return;
    }

    setError("");
}

function bindControls() {
    document.getElementById("settingsForm").addEventListener("change", () => {
        saveSettingsFromForm();
        loadDashboard({ userInitiated: true });
    });

    document.getElementById("sessionPresetInput").addEventListener("change", (event) => {
        state.settings = applySessionPreset(event.target.value, {
            ...state.settings,
            tradeAggressiveness: document.getElementById("tradeAggressivenessInput").value || state.settings.tradeAggressiveness
        });
        syncControlsFromState();
        persistSettings();
        resetAutoRefreshTimer();
        loadDashboard({ userInitiated: true });
    });

    ["minimumConfidenceInput", "vwapBandPercentInput", "tradeAggressivenessInput"].forEach((id) => {
        document.getElementById(id).addEventListener("change", () => {
            syncManualControlsToCustomPreset();
        });
    });

    document.getElementById("manualRefreshBtn").addEventListener("click", () => {
        loadDashboard({ userInitiated: true });
    });

    document.getElementById("autoRefreshToggle").addEventListener("change", (event) => {
        state.settings.autoRefresh = event.target.checked;
        persistSettings();
        resetAutoRefreshTimer();
    });

    document.getElementById("refreshInterval").addEventListener("change", (event) => {
        state.settings.intervalMs = Number(event.target.value) || DEFAULT_SETTINGS.intervalMs;
        syncManualControlsToCustomPreset();
        persistSettings();
        resetAutoRefreshTimer();
    });

    document.getElementById("clearTradeBtn").addEventListener("click", clearActiveTrade);
    document.getElementById("enableAlertsBtn").addEventListener("click", enableAlerts);

    document.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-action]");
        if (!actionButton) {
            return;
        }

        const { action } = actionButton.dataset;
        if (action === "take-trade") {
            takeCurrentTrade();
        }
    });
}

function renderStandaloneSnapshot() {
    if (!isStandaloneMode() || typeof window.readStandaloneDashboardSnapshot !== "function") {
        return;
    }

    const snapshot = window.readStandaloneDashboardSnapshot();
    if (!snapshot?.dashboard) {
        return;
    }

    state.payload = snapshot;
    renderDashboard(state, snapshot);
}

window.addEventListener("DOMContentLoaded", () => {
    loadLocalState();
    syncControlsFromState();
    bindControls();
    renderStandaloneSnapshot();
    resetAutoRefreshTimer();
    loadDashboard();
});
