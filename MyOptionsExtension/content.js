(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;
    const Selectors = window.OptionsSiteSelectors;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request || !request.action) {
            sendResponse({ ok: false, error: "No action supplied." });
            return;
        }

        if (request.action === Utils.ACTIONS.PING) {
            sendResponse({ ok: true, payload: { alive: true } });
            return;
        }

        if (request.action === Utils.ACTIONS.EXTRACT_PAGE_SNAPSHOT) {
            extractPageSnapshot(request.settings || Utils.DEFAULT_SETTINGS)
                .then((payload) => sendResponse({ ok: true, payload: payload }))
                .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        sendResponse({ ok: false, error: "Unknown action." });
    });

    async function extractPageSnapshot(settings) {
        const adapter = pickAdapter(settings);
        const visibleText = Utils.getVisibleText(document);
        const warnings = [];
        const methods = [];
        const values = Utils.createEmptyValues();
        const rawSignals = [];
        const selectorHits = {};

        const customValues = extractCustomValues();
        Object.assign(values, customValues.values);
        if (customValues.hitCount > 0) {
            methods.push("custom-data-attributes");
        }

        Object.keys(values).forEach((fieldName) => {
            if (Number.isFinite(values[fieldName])) {
                return;
            }

            const selectorValue = extractFieldFromSelectors(fieldName, adapter.selectors);
            if (Number.isFinite(selectorValue)) {
                values[fieldName] = selectorValue;
                selectorHits[fieldName] = true;
                methods.push(`selector:${fieldName}`);
                return;
            }

            const textValue = extractFieldFromText(fieldName, visibleText);
            if (Number.isFinite(textValue)) {
                values[fieldName] = textValue;
                methods.push(`text:${fieldName}`);
            }
        });

        const instrument = extractInstrument(adapter, visibleText) || "UNKNOWN";
        if (!Number.isFinite(values.spotPrice)) {
            const fallbackSpot = extractFallbackSpotPrice(visibleText, instrument);
            if (Number.isFinite(fallbackSpot)) {
                values.spotPrice = fallbackSpot;
                methods.push("fallback:spotPrice");
            }
        }
        if (!instrument || instrument === "UNKNOWN") {
            warnings.push("Instrument could not be confidently identified.");
        }

        rawSignals.push(...extractSignalTexts(adapter, visibleText));
        const extractorConfidence = calculateExtractorConfidence(values, methods, customValues.hitCount, Object.keys(selectorHits).length, rawSignals.length);

        if (!visibleText) {
            warnings.push("The page has very little visible text to inspect.");
        }
        if (!Number.isFinite(values.spotPrice)) {
            warnings.push("Spot price was not visible on the page.");
        }
        if (!rawSignals.length) {
            warnings.push("No visible bullish/bearish signal words were found.");
        }

        return Utils.createEmptySnapshot({
            url: location.href,
            siteType: adapter.id,
            timestamp: new Date().toISOString(),
            instrument: instrument,
            pageTitle: document.title,
            values: values,
            rawSignals: Utils.dedupeStrings(rawSignals).slice(0, 8),
            extractorMeta: {
                method: methods.length ? methods.join(", ") : "generic-text-scan",
                confidence: extractorConfidence,
                warnings: warnings
            }
        });
    }

    function pickAdapter(settings) {
        const detected = Selectors.detectSiteAdapter(location.href);
        const enabled = Array.isArray(settings.enabledSiteAdapters) ? settings.enabledSiteAdapters : Utils.DEFAULT_SETTINGS.enabledSiteAdapters;
        if (enabled.includes(detected.id)) {
            return detected;
        }
        return Selectors.getAdapterById("generic");
    }

    function extractCustomValues() {
        const values = Utils.createEmptyValues();
        let hitCount = 0;

        document.querySelectorAll("[data-ota-field]").forEach((element) => {
            const fieldName = element.getAttribute("data-ota-field");
            if (!fieldName || !(fieldName in values)) {
                return;
            }
            const numericValue = parseFieldValue(fieldName, readElementText(element));
            if (Number.isFinite(numericValue)) {
                values[fieldName] = numericValue;
                hitCount += 1;
            }
        });

        return {
            values: values,
            hitCount: hitCount
        };
    }

    function extractFieldFromSelectors(fieldName, selectorMap) {
        const selectors = selectorMap && selectorMap[fieldName] ? selectorMap[fieldName] : [];
        for (let index = 0; index < selectors.length; index += 1) {
            const selector = selectors[index];
            const element = selector === "title" ? null : document.querySelector(selector);
            const rawText = selector === "title" ? document.title : readElementText(element);
            const parsed = parseFieldValue(fieldName, rawText);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return null;
    }

    function extractFieldFromText(fieldName, visibleText) {
        const patterns = Selectors.FIELD_PATTERNS[fieldName] || [];
        if (!patterns.length) {
            return null;
        }
        return Utils.extractFirstMatch(visibleText, patterns, (match) => parseFieldValue(fieldName, match[1]));
    }

    function extractInstrument(adapter, visibleText) {
        const selectorCandidates = (adapter.selectors.instrument || [])
            .map((selector) => selector === "title" ? document.title : readElementText(document.querySelector(selector)))
            .filter(Boolean);

        const allCandidates = selectorCandidates.concat([document.title, visibleText]);
        for (let index = 0; index < allCandidates.length; index += 1) {
            const match = Utils.extractFirstMatch(allCandidates[index], Selectors.FIELD_PATTERNS.instrument || []);
            if (match) {
                return Utils.normalizeInstrumentSelection(match);
            }
        }
        return null;
    }

    function extractSignalTexts(adapter, visibleText) {
        const sourceTexts = [];
        (adapter.selectors.rawSignalTexts || []).forEach((selector) => {
            const element = selector === "body" ? document.body : document.querySelector(selector);
            const text = readElementText(element);
            if (text) {
                sourceTexts.push(text);
            }
        });
        sourceTexts.push(visibleText);

        const foundSignals = [];
        sourceTexts.forEach((text) => {
            Object.keys(Selectors.SIGNAL_PATTERNS).forEach((signalKey) => {
                const patterns = Selectors.SIGNAL_PATTERNS[signalKey];
                patterns.forEach((pattern) => {
                    const match = String(text || "").match(pattern);
                    if (match) {
                        foundSignals.push(match[0].trim());
                    }
                });
            });
        });
        return foundSignals;
    }

    function readElementText(element) {
        if (!element) {
            return "";
        }
        return String(
            element.value
            || element.innerText
            || element.textContent
            || element.getAttribute("content")
            || element.getAttribute("aria-label")
            || ""
        ).trim();
    }

    function parseFieldValue(fieldName, rawText) {
        if (!rawText) {
            return null;
        }

        if (fieldName === "changePercent") {
            const match = String(rawText).match(/-?[0-9]+(?:\.[0-9]+)?/);
            return match ? Utils.toNumber(match[0]) : null;
        }

        return Utils.parseNumberFromText(rawText);
    }

    function extractFallbackSpotPrice(visibleText, instrument) {
        const patterns = [];
        if (instrument && instrument !== "UNKNOWN") {
            const escapedInstrument = escapeRegExp(String(instrument).toUpperCase());
            patterns.push(new RegExp(`\\b${escapedInstrument}\\b[^\\d]{0,20}([0-9,]{2,7}(?:\\.[0-9]+)?)`, "i"));
            patterns.push(new RegExp(`([0-9,]{2,7}(?:\\.[0-9]+)?)\\s*${escapedInstrument}\\b`, "i"));
        }
        patterns.push(/\b(?:Current Price|Current|Spot|Index|LTP|Last Traded Price|Last Price)\b[^\d]{0,20}([0-9,]{2,7}(?:\.[0-9]+)?)/i);

        return Utils.extractFirstMatch(visibleText, patterns, (match) => Utils.parseNumberFromText(match[1]));
    }

    function escapeRegExp(text) {
        return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function calculateExtractorConfidence(values, methods, customHits, selectorHits, signalCount) {
        const presentValues = Utils.countPresentValues(values);
        let confidence = (presentValues * 8) + (methods.length * 4) + (customHits * 10) + (selectorHits * 6) + (signalCount * 2);
        if (presentValues >= 4) {
            confidence += 10;
        }
        return Utils.clamp(confidence, 15, 95);
    }
})();
