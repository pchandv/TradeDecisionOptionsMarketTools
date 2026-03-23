# Options Trading Assistant

Options Trading Assistant is a Manifest V3 Chrome extension that watches the trading tabs you choose, extracts visible market signals from the DOM, scores a directional options bias locally, and shows alerts plus a report dashboard.

It does **not** place trades. It is a decision-support tool only.

## Features

- Monitor multiple tabs at the same time
- Extract visible values from TradingView, Zerodha Kite, your own hosted pages, and generic sites
- Use adapter-based selectors first, then generic text-pattern scanning
- Run a local weighted decision engine with reasoning and risk flags
- Show a compact popup, a full report dashboard, and a settings page
- Trigger local browser notifications with cooldown and sustained-condition checks
- Store snapshots, alert history, and signal history in `chrome.storage.local`
- Work without external APIs because it reads visible page content directly

## Project files

- `manifest.json`: Extension manifest and permissions
- `background.js`: Service worker, scan orchestration, storage updates, alerts
- `content.js`: Page extraction logic running inside tabs
- `popup.html` / `popup.js`: Compact extension popup
- `report.html` / `report.js`: Full monitoring dashboard
- `options.html` / `options.js`: Settings editor
- `styles.css`: Shared extension styling
- `utils.js`: Shared helpers, storage wrappers, formatting, defaults
- `decision-engine.js`: Local scoring and bias logic
- `selectors.js`: Site adapters, selector lists, text patterns
- `icons/README.txt`: Icon notes and placeholder asset guidance

## How to load the unpacked extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `MyOptionsExtension` folder.
5. Pin the extension if you want easy popup access.

## How to use it

1. Open one or more market-related tabs such as TradingView, Zerodha Kite, or your own hosted page.
2. Open the extension popup on a tab you want to monitor.
3. Click **Start Monitoring Current Tab**.
4. Click **Scan Current Tab** for an immediate read.
5. Open **Full Report** to view detailed reasoning, risk flags, per-tab data, alerts, and signal history.
6. Open **Settings** to tune thresholds such as PCR, VIX, monitoring cadence, and retention limits.

## Extraction model

The extension uses two layers:

1. Adapter-first extraction
   - `selectors.js` defines site adapters for:
   - `tradingview`
   - `zerodha-kite`
   - `custom-page`
   - `generic`
   - Each adapter contains likely selectors for fields like spot price, support, resistance, and raw signal text.

2. Generic fallback parsing
   - If selectors fail, `content.js` scans visible text and applies regex patterns such as:
   - `PCR 0.84`
   - `India VIX 13.2`
   - `Max Pain 23500`
   - `ATM IV 17.5`

This means the extension can still extract useful values even when a page has no dedicated adapter.

## Custom page support

If you control your own page, you can make extraction much more reliable by adding attributes such as:

```html
<div data-ota-field="instrument">NIFTY</div>
<div data-ota-field="spotPrice">23645.25</div>
<div data-ota-field="pcr">1.08</div>
<div data-ota-field="vix">13.7</div>
<div data-ota-signal="bullish">Bullish bias forming</div>
```

Supported `data-ota-field` values include:

- `instrument`
- `spotPrice`
- `changePercent`
- `pcr`
- `vix`
- `atmIv`
- `maxPain`
- `support`
- `resistance`
- `callOi`
- `putOi`

## How to add a new site adapter

1. Open `selectors.js`.
2. Add a new adapter entry in `SITE_ADAPTERS`.
3. Provide:
   - `id`
   - `label`
   - `urlPatterns`
   - selector arrays for the fields that site exposes
4. Add the adapter ID to the default enabled list in `utils.js` if you want it enabled by default.
5. Reload the extension in `chrome://extensions`.
6. Open the new site and run a manual scan.

Example adapter shape:

```javascript
exampleSite: {
    id: "example-site",
    label: "Example Site",
    urlPatterns: ["example.com"],
    selectors: {
        instrument: [".symbol-name"],
        spotPrice: [".spot-price"],
        pcr: [".pcr-value"],
        rawSignalTexts: [".signal-pill"]
    }
}
```

## Settings stored in Chrome

The extension stores the following in `chrome.storage.local`:

- `settings`
- `monitoredTabs`
- `latestSnapshots`
- `latestEvaluations`
- `overallSignal`
- `signalHistory`
- `alertHistory`
- `lastAlertMap`

The state is normalized through `utils.js` so defaults remain migration-safe.

## Testing on an arbitrary webpage

You can test extraction even on a plain HTML page.

1. Open any webpage you control or a local HTML file served over `http://localhost`.
2. Add visible text such as:

```text
NIFTY
PCR 1.19
India VIX 13.1
ATM IV 16.8
Support 23480
Resistance 23620
Bullish bias forming
```

3. Load the page in Chrome.
4. Start monitoring the tab from the popup.
5. Click **Scan Current Tab**.
6. Open **Full Report** and confirm the extracted snapshot and decision output.

## Debugging tips

- Open `chrome://extensions` and click **service worker** under the extension to inspect background logs.
- Use the inspected tab DevTools console to check content-script errors on a page.
- If extraction is weak, inspect the page DOM and add site-specific selectors in `selectors.js`.
- If a page is a browser-internal page or restricted Chrome page, the extension cannot read it.
- If notifications do not appear, check Chrome notification permissions at the OS level.
- If scans stop after a tab closes, the background worker removes stale tab state automatically.

## Limitations

- The extension only reads visible DOM text and elements that Chrome allows content scripts to access.
- Some broker pages can change their markup frequently, which may require selector updates.
- OCR is not included in this version, so values inside images or canvases may not be captured reliably.
- Complex multi-leg strategy analysis is outside the current scope.

## Safety note

- This extension is an assistant, not an auto-trader.
- Always confirm with your own chart and risk management.
- Data is extracted from visible pages and may be incomplete.
- This is not financial advice.

## Suggested future enhancements

- Screenshot OCR mode for canvas-heavy pages
- Strategy presets for CE/PE directional setups
- Custom rule builder for personal scoring systems
- Confidence backtesting against stored history
- Signal validation tracker with outcome tagging
