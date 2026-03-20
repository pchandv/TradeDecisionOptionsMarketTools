function countTrailingDirectionalMatches(history = [], action) {
    if (!action || action === "WAIT") {
        return 0;
    }

    let count = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.action !== action) {
            break;
        }
        count += 1;
    }
    return count;
}

function findLastDirectionalAction(history = []) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const action = history[index]?.action;
        if (action === "CE" || action === "PE") {
            return action;
        }
    }
    return "WAIT";
}

export function applyDecisionStabilityGuard(payload, history = [], activeTrade = null) {
    const decision = payload?.dashboard?.decision;
    if (!decision) {
        return payload;
    }

    const rawAction = decision.action || "WAIT";
    const rawStatus = decision.status || "WAIT";
    const lastDirectionalAction = findLastDirectionalAction(history);
    const reversal = (rawAction === "CE" || rawAction === "PE")
        && lastDirectionalAction !== "WAIT"
        && lastDirectionalAction !== rawAction;
    const confirmationsNeeded = reversal ? 3 : 2;
    const directionalMatches = countTrailingDirectionalMatches(history, rawAction);
    const confirmations = rawAction === "WAIT" ? 0 : directionalMatches + 1;
    const shouldHoldBackNewTrade = !activeTrade
        && rawStatus === "TRADE"
        && (rawAction === "CE" || rawAction === "PE")
        && confirmations < confirmationsNeeded;

    decision.stability = {
        locked: shouldHoldBackNewTrade,
        rawAction,
        rawStatus,
        reversal,
        confirmations,
        confirmationsNeeded,
        detail: shouldHoldBackNewTrade
            ? `Stability gate requires ${confirmationsNeeded} matching refreshes before ${rawAction}. Current confirmation count is ${confirmations}.`
            : "Directional signal cleared the stability gate."
    };

    if (!shouldHoldBackNewTrade) {
        return payload;
    }

    const holdbackReason = reversal
        ? `Reversal protection is active. Wait for ${confirmationsNeeded} matching ${rawAction} refreshes before switching direction.`
        : `Wait for one more confirming ${rawAction} refresh before entering.`;

    decision.status = "CONDITIONAL";
    decision.mode = "CONDITIONAL";
    decision.optionType = rawAction;
    decision.headline = rawAction === "CE" ? "CE ON TRIGGER" : rawAction === "PE" ? "PE ON TRIGGER" : "WAIT";
    decision.summary = holdbackReason;
    decision.noTradeZone = {
        ...(decision.noTradeZone || {}),
        active: true,
        reasons: [...(decision.noTradeZone?.reasons || []), holdbackReason]
    };
    decision.quick = {
        ...(decision.quick || {}),
        status: "CONDITIONAL",
        mode: "CONDITIONAL",
        optionType: rawAction
    };

    if (payload?.dashboard?.tradePlan) {
        payload.dashboard.tradePlan = {
            ...payload.dashboard.tradePlan,
            actionable: false,
            conditional: true,
            tradeState: "CONDITIONAL",
            notation: payload.dashboard.tradePlan.contract?.optionType
                ? `${payload.dashboard.tradePlan.contract.optionType} ON TRIGGER`
                : payload.dashboard.tradePlan.notation || "WAIT",
            title: payload.dashboard.tradePlan.title || "Confirmation pending",
            reason: holdbackReason
        };
    }

    return payload;
}
