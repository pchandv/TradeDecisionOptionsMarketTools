import { readStorageJson, writeStorageJson } from "./storage.js";
import { STORAGE_KEYS } from "./state.js";

const MAX_JOURNAL_ENTRIES = 120;

function readJournal() {
    return readStorageJson(STORAGE_KEYS.journal, []);
}

function writeJournal(entries) {
    writeStorageJson(STORAGE_KEYS.journal, entries.slice(-MAX_JOURNAL_ENTRIES));
}

export function recordJournalEntry({ payload, activeTrade, settings }) {
    if (!payload?.dashboard?.decision || !payload?.dashboard?.tradePlan || !activeTrade?.planId) {
        return null;
    }

    const entries = readJournal();
    const existingIndex = entries.findIndex((entry) => entry.planId === activeTrade.planId);
    const snapshot = {
        id: activeTrade.planId,
        planId: activeTrade.planId,
        createdAt: new Date().toISOString(),
        instrument: activeTrade.instrument,
        optionType: activeTrade.optionType,
        expiry: activeTrade.expiry,
        strikePrice: activeTrade.strikePrice,
        entryPrice: activeTrade.entryPrice,
        settings: {
            instrument: settings.instrument,
            engineVersion: settings.engineVersion,
            compareMode: Boolean(settings.compareMode),
            sessionPreset: settings.sessionPreset,
            tradeAggressiveness: settings.tradeAggressiveness,
            minimumConfidence: settings.minimumConfidence,
            vwapBandPercent: settings.vwapBandPercent
        },
        inputs: {
            marketType: payload.dashboard.decision.marketType?.code || null,
            trap: payload.dashboard.decision.trap || null,
            riskLevel: payload.dashboard.decision.riskMeter?.level || null,
            feedBlocked: Boolean(payload.dashboard.feedHealth?.blocksTradeSignals)
        },
        decision: {
            bias: payload.dashboard.decision.bias,
            action: payload.dashboard.decision.action,
            score: payload.dashboard.decision.score,
            confidence: payload.dashboard.decision.confidence,
            marketType: payload.dashboard.decision.marketType?.code || null,
            explainability: Array.isArray(payload.dashboard.decision.components)
                ? payload.dashboard.decision.components.map((component) => ({
                    key: component.key,
                    label: component.label,
                    score: component.score
                }))
                : []
        },
        tradePlan: {
            planId: payload.dashboard.tradePlan.planId,
            trigger: payload.dashboard.tradePlan.entry?.spotTrigger ?? null,
            stopLoss: payload.dashboard.tradePlan.exit?.stopLoss ?? null,
            target1: payload.dashboard.tradePlan.exit?.target1 ?? null,
            target2: payload.dashboard.tradePlan.exit?.target2 ?? null
        },
        outcome: null,
        result: null,
        updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        entries[existingIndex] = {
            ...entries[existingIndex],
            ...snapshot
        };
    } else {
        entries.push(snapshot);
    }

    writeJournal(entries);
    return snapshot.id;
}

export function updateJournalOutcome(activeTrade, monitor) {
    if (!activeTrade?.planId || !monitor?.action) {
        return;
    }

    const entries = readJournal();
    const existingIndex = entries.findIndex((entry) => entry.planId === activeTrade.planId);
    if (existingIndex < 0) {
        return;
    }

    entries[existingIndex] = {
        ...entries[existingIndex],
        updatedAt: new Date().toISOString(),
        outcome: {
            action: monitor.action,
            label: monitor.label || monitor.action,
            pnlPercent: monitor.pnlPercent ?? null,
            currentConfidence: monitor.currentConfidence ?? null,
            confidenceTrend: monitor.confidenceTrend ?? null,
            premiumTrend: monitor.premiumTrend ?? null
        },
        result: ["FULL_EXIT", "INVALIDATED"].includes(monitor.action)
            ? (Number(monitor.pnlPercent || 0) > 0 ? "WIN" : "LOSS")
            : entries[existingIndex].result
    };

    writeJournal(entries);
}
