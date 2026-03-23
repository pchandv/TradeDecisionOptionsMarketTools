(function () {
    "use strict";

    const ACTIONS = {
        PING: "OTA_CHATGPT_PING",
        RUN_PROMPT: "OTA_CHATGPT_RUN_PROMPT"
    };

    let activeRunId = null;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        const payload = request || {};

        if (payload.action === ACTIONS.PING) {
            sendResponse({ ok: true, payload: { ready: true } });
            return;
        }

        if (payload.action !== ACTIONS.RUN_PROMPT) {
            sendResponse({ ok: false, error: "Unsupported chat bridge action." });
            return;
        }

        runPromptFlow(payload)
            .then((result) => sendResponse({ ok: true, payload: result }))
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    });

    async function runPromptFlow(payload) {
        const runId = payload.runId || `run-${Date.now()}`;
        if (activeRunId && activeRunId !== runId) {
            throw new Error("ChatGPT bridge is already running. Please wait for current response.");
        }

        activeRunId = runId;
        try {
            const prompt = String(payload.prompt || "").trim();
            if (!prompt) {
                throw new Error("Prompt is empty.");
            }

            const inputResult = await findInputWithRetry(3, 700);
            if (!inputResult) {
                throw new Error("ChatGPT input not found after 3 retries.");
            }

            const baseline = snapshotAssistantState();
            setPromptValue(inputResult, prompt);
            await waitFor(150);
            triggerSend(inputResult);
            const responseText = await waitForAssistantResponse(baseline, Number(payload.timeoutMs) || 20000, 2500);

            // This async runtime message is the primary bridge callback path.
            chrome.runtime.sendMessage({
                type: "AI_RESPONSE",
                payload: responseText,
                runId: runId
            });

            return {
                runId: runId,
                text: responseText
            };
        } finally {
            activeRunId = null;
        }
    }

    async function findInputWithRetry(maxAttempts, delayMs) {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const input = findInput();
            if (input) {
                return input;
            }
            if (attempt < maxAttempts) {
                await waitFor(delayMs);
            }
        }
        return null;
    }

    function findInput() {
        const textarea = document.querySelector("textarea");
        if (isUsableInput(textarea)) {
            return { element: textarea, type: "textarea" };
        }

        const editable = Array.from(document.querySelectorAll("[contenteditable='true']"))
            .find((node) => isUsableInput(node));
        if (editable) {
            return { element: editable, type: "editable" };
        }

        return null;
    }

    function setPromptValue(inputResult, prompt) {
        const node = inputResult.element;
        node.focus();

        if (inputResult.type === "textarea") {
            node.value = prompt;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            return;
        }

        node.textContent = prompt;
        node.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: prompt,
            inputType: "insertText"
        }));
    }

    function triggerSend(inputResult) {
        const button = findSendButton();
        if (button) {
            button.click();
            return;
        }

        // Fallback for layouts where send is keyboard-driven.
        const target = inputResult.element;
        target.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true
        }));
    }

    function findSendButton() {
        const selectors = [
            "button[type='submit']",
            "button[data-testid='send-button']",
            "button[aria-label*='Send']",
            "button[aria-label*='send']"
        ];

        for (let index = 0; index < selectors.length; index += 1) {
            const button = document.querySelector(selectors[index]);
            if (button && !button.disabled && isVisible(button)) {
                return button;
            }
        }
        return null;
    }

    function snapshotAssistantState() {
        const messages = getAssistantMessages();
        return {
            count: messages.length,
            lastText: messages.length ? extractNodeText(messages[messages.length - 1]) : ""
        };
    }

    function getAssistantMessages() {
        const byRole = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
        if (byRole.length) {
            return byRole;
        }

        const fallback = Array.from(document.querySelectorAll("[data-testid*='assistant'], article"));
        return fallback.filter((node) => /assistant|chatgpt/i.test(node.getAttribute("data-testid") || node.className || ""));
    }

    async function waitForAssistantResponse(baseline, timeoutMs, settleMs) {
        return new Promise((resolve, reject) => {
            let done = false;
            let candidateText = "";
            let settleTimer = null;
            let pollTimer = null;
            let timeoutTimer = null;

            const observer = new MutationObserver(() => evaluate());

            function cleanup() {
                observer.disconnect();
                if (settleTimer) {
                    clearTimeout(settleTimer);
                }
                if (pollTimer) {
                    clearInterval(pollTimer);
                }
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                }
            }

            function finishWithSuccess(text) {
                if (done) {
                    return;
                }
                done = true;
                cleanup();
                resolve(text);
            }

            function finishWithError(message) {
                if (done) {
                    return;
                }
                done = true;
                cleanup();
                reject(new Error(message));
            }

            function evaluate() {
                const current = snapshotAssistantState();
                const hasNewMessage = current.count > baseline.count;
                const hasChangedText = current.count === baseline.count
                    && current.lastText
                    && current.lastText !== baseline.lastText;

                if (!(hasNewMessage || hasChangedText)) {
                    return;
                }

                const nextText = String(current.lastText || "").trim();
                if (!nextText) {
                    return;
                }

                candidateText = nextText;
                if (settleTimer) {
                    clearTimeout(settleTimer);
                }
                settleTimer = setTimeout(() => {
                    finishWithSuccess(candidateText);
                }, settleMs);
            }

            try {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            } catch (error) {
                finishWithError("Unable to observe ChatGPT response stream.");
                return;
            }

            pollTimer = setInterval(evaluate, 500);
            timeoutTimer = setTimeout(() => {
                if (candidateText) {
                    finishWithSuccess(candidateText);
                    return;
                }
                finishWithError("No ChatGPT response within timeout window.");
            }, timeoutMs);

            evaluate();
        });
    }

    function extractNodeText(node) {
        return String((node && node.innerText) || "").trim();
    }

    function isUsableInput(node) {
        return Boolean(node && isVisible(node) && !node.hasAttribute("disabled") && !node.getAttribute("aria-disabled"));
    }

    function isVisible(node) {
        if (!node) {
            return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }

    function waitFor(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
})();
