(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const KNOWN_TABLE_SELECTORS = [
        "[data-ota-option-chain]",
        "[data-testid*='option-chain']",
        ".option-chain",
        ".optionChain",
        ".nse-option-chain",
        "table"
    ];

    const STRIKE_PATTERNS = [
        /\bstrike\b/i,
        /\bstrike\s*price\b/i
    ];

    const CE_LTP_PATTERNS = [
        /\bce\b.*\bltp\b/i,
        /\bcall\b.*\bltp\b/i,
        /\bce\b.*\bprice\b/i,
        /\bcall\b.*\bprice\b/i
    ];

    const PE_LTP_PATTERNS = [
        /\bpe\b.*\bltp\b/i,
        /\bput\b.*\bltp\b/i,
        /\bpe\b.*\bprice\b/i,
        /\bput\b.*\bprice\b/i
    ];

    const CE_OI_PATTERNS = [
        /\bce\b.*\boi\b/i,
        /\bcall\b.*\boi\b/i
    ];

    const PE_OI_PATTERNS = [
        /\bpe\b.*\boi\b/i,
        /\bput\b.*\boi\b/i
    ];

    const CE_IV_PATTERNS = [
        /\bce\b.*\biv\b/i,
        /\bcall\b.*\biv\b/i
    ];

    const PE_IV_PATTERNS = [
        /\bpe\b.*\biv\b/i,
        /\bput\b.*\biv\b/i
    ];

    function extract(args) {
        const documentRef = args && args.documentRef ? args.documentRef : (typeof document !== "undefined" ? document : null);
        const visibleText = String(args && args.visibleText || "");
        const instrument = String(args && args.instrument || "UNKNOWN").toUpperCase();
        const warnings = [];
        const methods = [];

        if (!documentRef) {
            return {
                optionChain: Utils.createEmptyOptionChain(),
                values: {
                    pcr: extractPcrFromText(visibleText),
                    maxPain: extractMaxPainFromText(visibleText),
                    callOi: null,
                    putOi: null
                },
                extractionMeta: {
                    method: "no-document",
                    confidence: 0,
                    warnings: ["Document is unavailable for option-chain extraction."]
                },
                extractedPremiums: {}
            };
        }

        const attributeRows = extractFromDataAttributes(documentRef);
        if (attributeRows.length) {
            methods.push(`data-attributes:${attributeRows.length}`);
        }

        const selectorRows = attributeRows.length ? [] : extractFromKnownTables(documentRef);
        if (selectorRows.length) {
            methods.push(`known-tables:${selectorRows.length}`);
        }

        const genericRows = (!attributeRows.length && !selectorRows.length)
            ? extractFromGenericTables(documentRef)
            : [];
        if (genericRows.length) {
            methods.push(`generic-table:${genericRows.length}`);
        }

        const cardRows = (!attributeRows.length && !selectorRows.length && !genericRows.length)
            ? extractFromCards(documentRef)
            : [];
        if (cardRows.length) {
            methods.push(`card-layout:${cardRows.length}`);
        }

        const regexRows = (!attributeRows.length && !selectorRows.length && !genericRows.length && !cardRows.length)
            ? extractFromVisibleText(visibleText)
            : [];
        if (regexRows.length) {
            methods.push(`regex-text:${regexRows.length}`);
        }

        const selectedRows = attributeRows.length
            ? attributeRows
            : selectorRows.length
                ? selectorRows
                : genericRows.length
                    ? genericRows
                    : cardRows.length
                        ? cardRows
                        : regexRows;

        const dedupedRows = dedupeRows(selectedRows);
        const optionChain = Utils.normalizeOptionChain({ strikes: dedupedRows });
        const pcrFromDom = extractPcrFromDom(documentRef);
        const pcrFromText = extractPcrFromText(visibleText);
        const maxPainFromDom = extractMaxPainFromDom(documentRef);
        const maxPainFromText = extractMaxPainFromText(visibleText);

        if (!optionChain.strikes.length) {
            warnings.push("Option chain rows were not detected.");
        }
        if (!Number.isFinite(pcrFromDom) && !Number.isFinite(pcrFromText)) {
            warnings.push("PCR was not visible.");
        }
        if (!Number.isFinite(maxPainFromDom) && !Number.isFinite(maxPainFromText)) {
            warnings.push("Max pain was not visible.");
        }

        return {
            optionChain: optionChain,
            values: {
                pcr: pickFirstFinite(pcrFromDom, pcrFromText),
                maxPain: pickFirstFinite(maxPainFromDom, maxPainFromText),
                callOi: estimateTotalOi(optionChain.strikes, "CE"),
                putOi: estimateTotalOi(optionChain.strikes, "PE")
            },
            extractionMeta: {
                method: methods.length ? methods.join(", ") : "none",
                confidence: computeConfidence(optionChain.strikes, methods),
                warnings: warnings
            },
            extractedPremiums: buildExtractedPremiumMap(optionChain, instrument)
        };
    }

    function extractFromDataAttributes(documentRef) {
        const rows = [];
        const candidates = Array.from(documentRef.querySelectorAll("[data-ota-option-row], [data-option-row], [data-strike]"));
        candidates.forEach((row) => {
            const strike = readNumeric(row.getAttribute("data-strike") || textFrom(row.querySelector("[data-ota-strike], [data-strike], .strike")));
            if (!Number.isFinite(strike)) {
                return;
            }
            rows.push({
                strike: strike,
                ceLtp: readNumeric(row.getAttribute("data-ce-ltp") || textFrom(row.querySelector("[data-ota-ce-ltp], [data-ce-ltp], .ce-ltp"))),
                peLtp: readNumeric(row.getAttribute("data-pe-ltp") || textFrom(row.querySelector("[data-ota-pe-ltp], [data-pe-ltp], .pe-ltp"))),
                ceOi: readNumeric(row.getAttribute("data-ce-oi") || textFrom(row.querySelector("[data-ota-ce-oi], [data-ce-oi], .ce-oi"))),
                peOi: readNumeric(row.getAttribute("data-pe-oi") || textFrom(row.querySelector("[data-ota-pe-oi], [data-pe-oi], .pe-oi"))),
                ceIv: readNumeric(row.getAttribute("data-ce-iv") || textFrom(row.querySelector("[data-ota-ce-iv], [data-ce-iv], .ce-iv"))),
                peIv: readNumeric(row.getAttribute("data-pe-iv") || textFrom(row.querySelector("[data-ota-pe-iv], [data-pe-iv], .pe-iv")))
            });
        });
        return rows.slice(0, 200);
    }

    function extractFromKnownTables(documentRef) {
        const rows = [];
        const tables = [];
        KNOWN_TABLE_SELECTORS.forEach((selector) => {
            documentRef.querySelectorAll(selector).forEach((table) => {
                if (table && !tables.includes(table)) {
                    tables.push(table);
                }
            });
        });

        tables.forEach((table) => {
            rows.push(...parseTable(table, true));
        });

        return rows.slice(0, 200);
    }

    function extractFromGenericTables(documentRef) {
        const rows = [];
        documentRef.querySelectorAll("table").forEach((table) => {
            rows.push(...parseTable(table, false));
        });
        return rows.slice(0, 200);
    }

    function parseTable(table, strictHeaderMatch) {
        const rows = [];
        if (!table) {
            return rows;
        }

        const headerCells = Array.from(table.querySelectorAll("thead th, thead td, tr:first-child th, tr:first-child td"));
        const headers = headerCells.map((cell) => normalizeHeader(textFrom(cell)));
        if (!headers.length) {
            return rows;
        }

        const strikeIndex = findHeaderIndex(headers, STRIKE_PATTERNS);
        if (strikeIndex < 0 && strictHeaderMatch) {
            return rows;
        }

        const ceLtpIndex = findHeaderIndex(headers, CE_LTP_PATTERNS);
        const peLtpIndex = findHeaderIndex(headers, PE_LTP_PATTERNS);
        const ceOiIndex = findHeaderIndex(headers, CE_OI_PATTERNS);
        const peOiIndex = findHeaderIndex(headers, PE_OI_PATTERNS);
        const ceIvIndex = findHeaderIndex(headers, CE_IV_PATTERNS);
        const peIvIndex = findHeaderIndex(headers, PE_IV_PATTERNS);

        const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
        const scanRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll("tr")).slice(1);
        scanRows.slice(0, 220).forEach((row) => {
            const cells = Array.from(row.querySelectorAll("td, th"));
            if (!cells.length) {
                return;
            }

            const strike = resolveStrikeFromCells(cells, strikeIndex);
            if (!Number.isFinite(strike)) {
                return;
            }

            const fallback = fallbackSideColumns(cells, strikeIndex);
            rows.push({
                strike: strike,
                ceLtp: readCellByIndex(cells, ceLtpIndex, fallback.ceLtp),
                peLtp: readCellByIndex(cells, peLtpIndex, fallback.peLtp),
                ceOi: readCellByIndex(cells, ceOiIndex, fallback.ceOi),
                peOi: readCellByIndex(cells, peOiIndex, fallback.peOi),
                ceIv: readCellByIndex(cells, ceIvIndex, fallback.ceIv),
                peIv: readCellByIndex(cells, peIvIndex, fallback.peIv)
            });
        });

        return rows;
    }

    function extractFromCards(documentRef) {
        const rows = [];
        const cards = Array.from(documentRef.querySelectorAll("[class*='option'], [data-testid*='option']"));
        cards.forEach((card) => {
            const text = textFrom(card);
            if (!text || !/\bstrike\b|\bCE\b|\bPE\b/i.test(text)) {
                return;
            }
            const strike = extractNumberByPattern(text, /\bstrike\b[^\d]{0,15}(\d{3,6}(?:\.\d+)?)/i);
            if (!Number.isFinite(strike)) {
                return;
            }
            rows.push({
                strike: strike,
                ceLtp: extractNumberByPattern(text, /\bCE\b[^\d]{0,12}(\d+(?:\.\d+)?)/i),
                peLtp: extractNumberByPattern(text, /\bPE\b[^\d]{0,12}(\d+(?:\.\d+)?)/i),
                ceOi: extractNumberByPattern(text, /\bCE\b[^\n]{0,50}?\bOI\b[^\d]{0,12}(\d+(?:\.\d+)?(?:\s*[KMBLCR])?)/i),
                peOi: extractNumberByPattern(text, /\bPE\b[^\n]{0,50}?\bOI\b[^\d]{0,12}(\d+(?:\.\d+)?(?:\s*[KMBLCR])?)/i),
                ceIv: extractNumberByPattern(text, /\bCE\b[^\n]{0,50}?\bIV\b[^\d]{0,12}(\d+(?:\.\d+)?)/i),
                peIv: extractNumberByPattern(text, /\bPE\b[^\n]{0,50}?\bIV\b[^\d]{0,12}(\d+(?:\.\d+)?)/i)
            });
        });
        return rows.slice(0, 200);
    }

    function extractFromVisibleText(visibleText) {
        const rows = [];
        const source = String(visibleText || "");
        const pattern = /(\d{3,6})[^\n]{0,40}\bCE\b[^\d]{0,10}(\d+(?:\.\d+)?)[^\n]{0,40}\bPE\b[^\d]{0,10}(\d+(?:\.\d+)?)/gi;
        let match;
        while ((match = pattern.exec(source)) && rows.length < 200) {
            const strike = Utils.toNumber(match[1]);
            const ceLtp = Utils.toNumber(match[2]);
            const peLtp = Utils.toNumber(match[3]);
            if (!Number.isFinite(strike)) {
                continue;
            }
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
        return rows;
    }

    function buildExtractedPremiumMap(optionChain, instrument) {
        const map = {};
        const rows = optionChain && Array.isArray(optionChain.strikes) ? optionChain.strikes : [];
        rows.forEach((row) => {
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

        return Utils.normalizeExtractedOptionPremiums(map);
    }

    function dedupeRows(rows) {
        const byStrike = {};
        (rows || []).forEach((row) => {
            if (!row || !Number.isFinite(row.strike)) {
                return;
            }
            const key = String(Math.round(row.strike));
            const current = byStrike[key] || {
                strike: row.strike,
                ceLtp: null,
                peLtp: null,
                ceOi: null,
                peOi: null,
                ceIv: null,
                peIv: null
            };
            ["ceLtp", "peLtp", "ceOi", "peOi", "ceIv", "peIv"].forEach((field) => {
                if (!Number.isFinite(current[field]) && Number.isFinite(row[field])) {
                    current[field] = row[field];
                }
            });
            byStrike[key] = current;
        });

        return Object.values(byStrike).sort((left, right) => left.strike - right.strike);
    }

    function computeConfidence(rows, methods) {
        const strikes = Array.isArray(rows) ? rows : [];
        let confidence = 15;
        confidence += Math.min(40, strikes.length);
        if (strikes.some((row) => Number.isFinite(row.ceLtp) || Number.isFinite(row.peLtp))) {
            confidence += 18;
        }
        if (strikes.some((row) => Number.isFinite(row.ceOi) || Number.isFinite(row.peOi))) {
            confidence += 10;
        }
        if (methods.some((method) => method.startsWith("data-attributes") || method.startsWith("known-tables"))) {
            confidence += 12;
        }
        return Utils.clamp(confidence, 0, 98);
    }

    function resolveStrikeFromCells(cells, strikeIndex) {
        if (Number.isFinite(strikeIndex) && strikeIndex >= 0 && strikeIndex < cells.length) {
            const direct = readNumeric(textFrom(cells[strikeIndex]));
            if (Number.isFinite(direct) && direct >= 100 && direct <= 1000000) {
                return direct;
            }
        }

        const centerStart = Math.max(0, Math.floor((cells.length / 2) - 2));
        const centerEnd = Math.min(cells.length - 1, Math.ceil((cells.length / 2) + 2));
        for (let index = centerStart; index <= centerEnd; index += 1) {
            const value = readNumeric(textFrom(cells[index]));
            if (Number.isFinite(value) && value >= 100 && value <= 1000000) {
                return value;
            }
        }

        return null;
    }

    function fallbackSideColumns(cells, strikeIndex) {
        const result = {
            ceLtp: null,
            peLtp: null,
            ceOi: null,
            peOi: null,
            ceIv: null,
            peIv: null
        };

        const safeStrikeIndex = Number.isFinite(strikeIndex) && strikeIndex >= 0 ? strikeIndex : Math.floor(cells.length / 2);
        const left = [];
        const right = [];
        cells.forEach((cell, index) => {
            const numeric = readNumeric(textFrom(cell));
            if (!Number.isFinite(numeric)) {
                return;
            }
            if (index < safeStrikeIndex) {
                left.push(numeric);
            } else if (index > safeStrikeIndex) {
                right.push(numeric);
            }
        });

        result.ceLtp = left.length ? left[left.length - 1] : null;
        result.peLtp = right.length ? right[0] : null;
        result.ceOi = left.length > 1 ? left[Math.max(0, left.length - 2)] : null;
        result.peOi = right.length > 1 ? right[Math.min(right.length - 1, 1)] : null;
        result.ceIv = left.length > 2 ? left[Math.max(0, left.length - 3)] : null;
        result.peIv = right.length > 2 ? right[Math.min(right.length - 1, 2)] : null;

        return result;
    }

    function readCellByIndex(cells, preferredIndex, fallbackValue) {
        if (Number.isFinite(preferredIndex) && preferredIndex >= 0 && preferredIndex < cells.length) {
            const parsed = readNumeric(textFrom(cells[preferredIndex]));
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return Number.isFinite(fallbackValue) ? fallbackValue : null;
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

    function normalizeHeader(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function extractPcrFromDom(documentRef) {
        const candidates = Array.from(documentRef.querySelectorAll("[data-testid*='pcr'], [class*='pcr'], [id*='pcr']"))
            .map((element) => textFrom(element))
            .join(" ");
        return extractPcrFromText(candidates);
    }

    function extractPcrFromText(text) {
        return extractNumberByPattern(text, /\bPCR\b[^\d]{0,12}([0-9]+(?:\.[0-9]+)?)/i);
    }

    function extractMaxPainFromDom(documentRef) {
        const candidates = Array.from(documentRef.querySelectorAll("[data-testid*='max'], [class*='max-pain'], [id*='maxPain'], [id*='max-pain']"))
            .map((element) => textFrom(element))
            .join(" ");
        return extractMaxPainFromText(candidates);
    }

    function extractMaxPainFromText(text) {
        return extractNumberByPattern(text, /\bMax\s*Pain\b[^\d]{0,12}([0-9,]+(?:\.[0-9]+)?)/i);
    }

    function extractNumberByPattern(text, pattern) {
        const body = String(text || "");
        const match = body.match(pattern);
        if (!match) {
            return null;
        }
        return readNumeric(match[1]);
    }

    function readNumeric(value) {
        return Utils.parseNumberFromText(String(value || ""));
    }

    function textFrom(element) {
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

    function estimateTotalOi(rows, side) {
        const field = side === "CE" ? "ceOi" : "peOi";
        const values = (rows || [])
            .map((row) => Utils.toNumber(row && row[field]))
            .filter((value) => Number.isFinite(value) && value > 0);
        if (!values.length) {
            return null;
        }
        return Utils.round(values.reduce((sum, value) => sum + value, 0), 2);
    }

    function pickFirstFinite() {
        for (let index = 0; index < arguments.length; index += 1) {
            if (Number.isFinite(arguments[index])) {
                return arguments[index];
            }
        }
        return null;
    }

    global.OptionsOptionChainExtractor = {
        extract: extract
    };
})(typeof globalThis !== "undefined" ? globalThis : this);

