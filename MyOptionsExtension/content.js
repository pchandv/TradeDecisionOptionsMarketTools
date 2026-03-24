(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;
    const Selectors = window.OptionsSiteSelectors;
    const LiveExtractionEngine = window.OptionsLiveExtractionEngine;
    const OptionChainExtractor = window.OptionsOptionChainExtractor;

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
        const sourceType = LiveExtractionEngine && typeof LiveExtractionEngine.detectSourceType === "function"
            ? LiveExtractionEngine.detectSourceType(location.href, visibleText, document.title)
            : "unknown-source";
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
        const optionPayload = extractOptionChainPayload(visibleText, instrument, sourceType);
        if (!Number.isFinite(values.pcr) && Number.isFinite(optionPayload.values.pcr)) {
            values.pcr = optionPayload.values.pcr;
            methods.push("option-chain:pcr");
        }
        if (!Number.isFinite(values.maxPain) && Number.isFinite(optionPayload.values.maxPain)) {
            values.maxPain = optionPayload.values.maxPain;
            methods.push("option-chain:maxPain");
        }
        if (!Number.isFinite(values.callOi) && Number.isFinite(optionPayload.values.callOi)) {
            values.callOi = optionPayload.values.callOi;
            methods.push("option-chain:callOi");
        }
        if (!Number.isFinite(values.putOi) && Number.isFinite(optionPayload.values.putOi)) {
            values.putOi = optionPayload.values.putOi;
            methods.push("option-chain:putOi");
        }
        if (optionPayload.optionChain.strikes.length) {
            methods.push(`option-chain:${optionPayload.optionChain.strikes.length}`);
        }
        if (optionPayload.extractionMeta && Array.isArray(optionPayload.extractionMeta.warnings)) {
            warnings.push(...optionPayload.extractionMeta.warnings);
        }

        const headlines = sourceType === "news-source" ? extractHeadlines(document) : [];
        if (headlines.length) {
            methods.push(`headlines:${headlines.length}`);
        }

        const extractorConfidence = calculateExtractorConfidence(
            values,
            methods,
            customValues.hitCount,
            Object.keys(selectorHits).length,
            rawSignals.length,
            optionPayload.optionChain.strikes.length
        );

        if (!visibleText) {
            warnings.push("The page has very little visible text to inspect.");
        }
        if (!Number.isFinite(values.spotPrice)) {
            warnings.push("Spot price was not visible on the page.");
        }
        if (!rawSignals.length) {
            warnings.push("No visible bullish/bearish signal words were found.");
        }
        if (!optionPayload.optionChain.strikes.length) {
            warnings.push("Option chain premium rows were not detected on this page.");
        }

        const snapshotPayload = {
            url: location.href,
            sourceType: sourceType,
            siteType: adapter.id,
            timestamp: new Date().toISOString(),
            instrument: instrument,
            title: document.title,
            pageTitle: document.title,
            values: values,
            rawSignals: Utils.dedupeStrings(rawSignals).slice(0, 12),
            headlines: headlines,
            optionChain: optionPayload.optionChain,
            extractedOptionPremiums: optionPayload.extractedPremiums,
            extractionMeta: {
                method: methods.length ? methods.join(", ") : "generic-text-scan",
                confidence: extractorConfidence,
                warnings: warnings
            },
            extractorMeta: {
                method: methods.length ? methods.join(", ") : "generic-text-scan",
                confidence: extractorConfidence,
                warnings: warnings
            }
        };

        if (LiveExtractionEngine && typeof LiveExtractionEngine.buildLiveSnapshot === "function") {
            return LiveExtractionEngine.buildLiveSnapshot(snapshotPayload);
        }

        return Utils.createEmptySnapshot(snapshotPayload);
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

    function extractOptionChainPayload(visibleText, instrument, sourceType) {
        if (OptionChainExtractor && typeof OptionChainExtractor.extract === "function") {
            return OptionChainExtractor.extract({
                documentRef: document,
                visibleText: visibleText,
                instrument: instrument,
                sourceType: sourceType
            });
        }

        const fromDataAttributes = extractOptionChainFromDataAttributes();
        const fromTables = fromDataAttributes.length ? [] : extractOptionChainFromTables();
        const fromText = (!fromDataAttributes.length && !fromTables.length)
            ? extractOptionChainFromText(visibleText)
            : [];
        const selectedRows = fromDataAttributes.length
            ? fromDataAttributes
            : fromTables.length
                ? fromTables
                : fromText;
        const optionChain = Utils.normalizeOptionChain({ strikes: selectedRows });

        return {
            optionChain: optionChain,
            values: {
                pcr: Utils.extractFirstMatch(visibleText, [/\bPCR\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/i], (match) => Utils.toNumber(match[1])),
                maxPain: Utils.extractFirstMatch(visibleText, [/\bMax\s*Pain\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)/i], (match) => Utils.parseNumberFromText(match[1])),
                callOi: null,
                putOi: null
            },
            extractionMeta: {
                method: selectedRows.length ? "legacy-option-chain" : "legacy-none",
                confidence: selectedRows.length ? 50 : 0,
                warnings: selectedRows.length ? [] : ["Option chain data was not found."]
            },
            extractedPremiums: buildExtractedPremiumMap(optionChain, instrument)
        };
    }

    function extractOptionChainFromDataAttributes() {
        const rows = [];
        document.querySelectorAll("[data-ota-option-row]").forEach((row) => {
            const strike = parseFieldValue("spotPrice", row.getAttribute("data-strike") || readElementText(row.querySelector("[data-ota-strike]")));
            if (!Number.isFinite(strike)) {
                return;
            }

            rows.push({
                strike: strike,
                ceLtp: parseFieldValue("spotPrice", row.getAttribute("data-ce-ltp") || readElementText(row.querySelector("[data-ota-ce-ltp]"))),
                peLtp: parseFieldValue("spotPrice", row.getAttribute("data-pe-ltp") || readElementText(row.querySelector("[data-ota-pe-ltp]"))),
                ceOi: parseFieldValue("spotPrice", row.getAttribute("data-ce-oi") || readElementText(row.querySelector("[data-ota-ce-oi]"))),
                peOi: parseFieldValue("spotPrice", row.getAttribute("data-pe-oi") || readElementText(row.querySelector("[data-ota-pe-oi]"))),
                ceIv: parseFieldValue("spotPrice", row.getAttribute("data-ce-iv") || readElementText(row.querySelector("[data-ota-ce-iv]"))),
                peIv: parseFieldValue("spotPrice", row.getAttribute("data-pe-iv") || readElementText(row.querySelector("[data-ota-pe-iv]")))
            });
        });
        return dedupeOptionRows(rows).slice(0, 120);
    }

    function extractOptionChainFromTables() {
        const rows = [];
        const tables = Array.from(document.querySelectorAll("table"));
        for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
            const table = tables[tableIndex];
            const headerCells = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"));
            if (!headerCells.length) {
                continue;
            }

            const headers = headerCells.map((cell) => String(readElementText(cell)).toLowerCase());
            const strikeIndex = findHeaderIndex(headers, [/strike/]);
            const ceLtpIndex = findHeaderIndex(headers, [/\bce\b.*\bltp\b/, /\bcall\b.*\bltp\b/, /\bce\b.*\bprice\b/, /\bcall\b.*\bprice\b/]);
            const peLtpIndex = findHeaderIndex(headers, [/\bpe\b.*\bltp\b/, /\bput\b.*\bltp\b/, /\bpe\b.*\bprice\b/, /\bput\b.*\bprice\b/]);
            if (strikeIndex < 0 || (ceLtpIndex < 0 && peLtpIndex < 0)) {
                continue;
            }

            const ceOiIndex = findHeaderIndex(headers, [/\bce\b.*\boi\b/, /\bcall\b.*\boi\b/]);
            const peOiIndex = findHeaderIndex(headers, [/\bpe\b.*\boi\b/, /\bput\b.*\boi\b/]);
            const ceIvIndex = findHeaderIndex(headers, [/\bce\b.*\biv\b/, /\bcall\b.*\biv\b/]);
            const peIvIndex = findHeaderIndex(headers, [/\bpe\b.*\biv\b/, /\bput\b.*\biv\b/]);
            const dataRows = Array.from(table.querySelectorAll("tbody tr")).slice(0, 80);

            dataRows.forEach((row) => {
                const cells = Array.from(row.querySelectorAll("td, th"));
                const strike = parseTableCell(cells, strikeIndex);
                if (!Number.isFinite(strike)) {
                    return;
                }

                rows.push({
                    strike: strike,
                    ceLtp: parseTableCell(cells, ceLtpIndex),
                    peLtp: parseTableCell(cells, peLtpIndex),
                    ceOi: parseTableCell(cells, ceOiIndex),
                    peOi: parseTableCell(cells, peOiIndex),
                    ceIv: parseTableCell(cells, ceIvIndex),
                    peIv: parseTableCell(cells, peIvIndex)
                });
            });

            if (rows.length >= 12) {
                break;
            }
        }

        return dedupeOptionRows(rows).slice(0, 120);
    }

    function extractOptionChainFromText(visibleText) {
        const rows = [];
        const pattern = /(\d{3,6})[^\n]{0,40}?\bCE\b[^0-9]{0,8}(\d+(?:\.\d+)?)[^\n]{0,40}?\bPE\b[^0-9]{0,8}(\d+(?:\.\d+)?)/gi;
        let match;
        while ((match = pattern.exec(String(visibleText || ""))) && rows.length < 80) {
            const strike = Utils.toNumber(match[1]);
            const ceLtp = Utils.toNumber(match[2]);
            const peLtp = Utils.toNumber(match[3]);
            if (Number.isFinite(strike)) {
                rows.push({
                    strike: strike,
                    ceLtp: ceLtp,
                    peLtp: peLtp,
                    ceOi: null,
                    peOi: null,
                    ceIv: null,
                    peIv: null
                });
            }
        }
        return dedupeOptionRows(rows).slice(0, 120);
    }

    function parseTableCell(cells, index) {
        if (!Array.isArray(cells) || index < 0 || index >= cells.length) {
            return null;
        }
        return parseFieldValue("spotPrice", readElementText(cells[index]));
    }

    function findHeaderIndex(headers, patterns) {
        for (let index = 0; index < headers.length; index += 1) {
            const value = headers[index];
            for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
                if (patterns[patternIndex].test(value)) {
                    return index;
                }
            }
        }
        return -1;
    }

    function dedupeOptionRows(rows) {
        const byStrike = {};
        (rows || []).forEach((row) => {
            if (!row || !Number.isFinite(row.strike)) {
                return;
            }
            const key = String(Math.round(row.strike));
            const current = byStrike[key] || { strike: row.strike, ceLtp: null, peLtp: null, ceOi: null, peOi: null, ceIv: null, peIv: null };
            ["ceLtp", "peLtp", "ceOi", "peOi", "ceIv", "peIv"].forEach((field) => {
                if (!Number.isFinite(current[field]) && Number.isFinite(row[field])) {
                    current[field] = row[field];
                }
            });
            byStrike[key] = current;
        });

        return Object.values(byStrike)
            .sort((left, right) => left.strike - right.strike)
            .map((item) => ({
                strike: item.strike,
                ceLtp: item.ceLtp,
                peLtp: item.peLtp,
                ceOi: item.ceOi,
                peOi: item.peOi,
                ceIv: item.ceIv,
                peIv: item.peIv
            }));
    }

    function buildExtractedPremiumMap(optionChain, instrument) {
        const map = {};
        const strikes = optionChain && Array.isArray(optionChain.strikes) ? optionChain.strikes : [];
        strikes.forEach((row) => {
            if (!Number.isFinite(row.strike)) {
                return;
            }
            const strike = String(Math.round(row.strike));
            if (Number.isFinite(row.ceLtp)) {
                map[`${strike}-CE`] = row.ceLtp;
                map[`${strike} CE`] = row.ceLtp;
                if (instrument && instrument !== "UNKNOWN") {
                    map[`${instrument} ${strike} CE`] = row.ceLtp;
                }
            }
            if (Number.isFinite(row.peLtp)) {
                map[`${strike}-PE`] = row.peLtp;
                map[`${strike} PE`] = row.peLtp;
                if (instrument && instrument !== "UNKNOWN") {
                    map[`${instrument} ${strike} PE`] = row.peLtp;
                }
            }
        });
        return map;
    }

    function calculateExtractorConfidence(values, methods, customHits, selectorHits, signalCount, optionRows) {
        const presentValues = Utils.countPresentValues(values);
        let confidence = (presentValues * 8) + (methods.length * 4) + (customHits * 10) + (selectorHits * 6) + (signalCount * 2);
        if (Number.isFinite(optionRows) && optionRows > 0) {
            confidence += Math.min(20, optionRows);
        }
        if (presentValues >= 4) {
            confidence += 10;
        }
        return Utils.clamp(confidence, 15, 95);
    }

    function extractHeadlines(documentRef) {
        const source = documentRef || document;
        const selectors = [
            "h1",
            "h2",
            "h3",
            "[data-testid*='headline']",
            ".headline",
            "article a"
        ];
        const collected = [];
        selectors.forEach((selector) => {
            source.querySelectorAll(selector).forEach((node) => {
                const text = readElementText(node);
                if (!text || text.length < 20 || text.length > 180) {
                    return;
                }
                if (!/[a-zA-Z]/.test(text)) {
                    return;
                }
                collected.push(text);
            });
        });
        return Utils.dedupeStrings(collected).slice(0, 20);
    }
})();
