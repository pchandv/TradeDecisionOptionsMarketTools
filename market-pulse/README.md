# Live Market Behavior Signal Dashboard

Production-oriented Node.js + Express dashboard that serves a browser UI and fetches live market, macro, derivatives, and news data server-side.

The app does not use mock data, sample values, or hardcoded market numbers. If a source fails, the UI shows `unavailable` or `error`.

## Folder Structure

```text
market-pulse/
├─ public/
│  ├─ app.js
│  ├─ index.html
│  └─ styles.css
├─ src/
│  ├─ config/
│  │  └─ sources.js
│  ├─ engine/
│  │  ├─ newsEngine.js
│  │  └─ signalEngine.js
│  ├─ routes/
│  │  └─ api.js
│  ├─ services/
│  │  ├─ dashboardService.js
│  │  ├─ newsService.js
│  │  ├─ nseService.js
│  │  └─ yahooService.js
│  └─ utils/
│     ├─ formatters.js
│     └─ http.js
├─ .env.example
├─ package.json
├─ server.js
└─ README.md
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Optional environment variables:

```bash
copy .env.example .env
```

Available variables:

- `PORT`: server port. Default: `3000`
- `HTTP_TIMEOUT_MS`: per-request timeout. Default: `15000`
- `ALPHA_VANTAGE_API_KEY`: optional free Alpha Vantage key for the investing page's deeper fundamentals mode
- `ALPHA_VANTAGE_CACHE_HOURS`: how long overview fundamentals stay in memory before refetching. Default: `24`

No API keys are required for the trading dashboard. The investing page can still run without keys, but it will use an NSE-only fallback model unless `ALPHA_VANTAGE_API_KEY` is configured.

3. Start the app:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

Additional page:

```text
http://localhost:3000/investing.html
```

## GitHub Pages

The project includes a browser-only static publish path for GitHub Pages.

This repository deploys through GitHub Actions because the app lives in `market-pulse/` instead of the repository root.

1. Export the static bundle:

```bash
npm run export:pages
```

2. In GitHub, open **Settings -> Pages** and set the source to:

```text
GitHub Actions
```

3. Push to `main` or run the workflow in `.github/workflows/deploy-pages.yml`.

4. GitHub Pages will publish `market-pulse/docs`, which contains the standalone browser version of the dashboard.

Published files:

- `docs/index.html`
- `docs/app.js`
- `docs/browser-standalone-loader.js`
- `docs/styles.css`
- `docs/icon.svg`
- `docs/.nojekyll`

Important limitation:

- GitHub Pages can host the browser-only dashboard, but it cannot bypass source-side blocking rules.
- The branch-based `main` + `/docs` Pages setting will not work for this repo layout because the publish directory is nested under `market-pulse/docs`.
- Yahoo and Google News usually work better in browser mode than NSE.
- NSE feeds may still be `partial`, `unavailable`, or `error` on some refreshes depending on CORS, anti-bot checks, cookies, and exchange-side behavior.
- The dashboard will show real error states instead of inventing values.

## Live Sources Used

### Market and Macro Quotes

- Yahoo Finance chart endpoint
  - Used for: `SENSEX`, Nasdaq futures, S&P 500 futures, Dow futures, Nikkei, Hang Seng, ASX 200, US 10Y, DXY futures proxy, WTI crude, Brent, gold, silver, natural gas
  - Why: broad coverage across global indices, futures, and macro assets from a single server-side source

### Indian Market and Derivatives

- NSE India `api/allIndices`
  - Used for: `NIFTY 50`, `BANK NIFTY`, `INDIA VIX`, advance/decline breadth
  - Why: official NSE market snapshot

- NSE India `api/marketStatus`
  - Used for: `GIFT NIFTY`, India market status
  - Why: official NSE market status JSON includes GIFT Nifty snapshot

- NSE India `api/option-chain-contract-info` and `api/option-chain-v3`
  - Used for: nearest-expiry NIFTY PCR and OI support/resistance
  - Why: official option-chain contract metadata and live option-chain data

- NSE India `api/fiidiiTradeReact` and `api/fiidiiTradeNse`
  - Used for: FII/DII data
  - Why: official institutional activity reports

- NSE India `api/live-analysis-oi-spurts-underlyings`
  - Used for: OI spurt status coverage
  - Why: official derivatives activity feed

### News

- Google News RSS search feeds
  - Used for: India market news, US market news, global macro/risk news
  - Why: no API key required, good headline coverage, works server-side

## Signal Engine

The weighted signal engine combines:

- GIFT Nifty opening gap
- NIFTY cash move
- India VIX
- Bank Nifty relative strength
- Breadth
- Put Call Ratio
- FII/DII flows
- Global market composite
- DXY
- US 10Y yield
- Crude
- News sentiment score

Outputs:

- `Strong Bullish`
- `Bullish`
- `Sideways`
- `Bearish`
- `Strong Bearish`

It also derives:

- opening bias
- intraday bias
- CE / PE / no-trade bias
- confidence %
- risk warnings

## Investing Ideas Page

The app now includes a separate `investing.html` page for long-term watchlist ideas.

How it works:

- `NSE quote layer`: live price, stock PE, sector PE, and 52-week range
- `Fundamentals layer`: optional Alpha Vantage overview metrics such as ROE, margins, revenue growth, earnings growth, analyst target, and price-to-book
- `Scoring model`: blends quality, growth, valuation, and opportunity into a shortlist score

Modes:

- `Fundamentals Enriched`: available when `ALPHA_VANTAGE_API_KEY` is configured and overview data loads successfully
- `NSE Valuation Fallback`: used when the fundamentals provider is not configured or coverage is incomplete

Important limitations:

- The investing page is a research shortlist, not a brokerage recommendation engine.
- Alpha Vantage free keys are helpful for prototyping, but they have tighter usage limits than the NSE quote layer, so the app caches overview results in memory.
- GitHub Pages static hosting can show the investing methodology page, but live investing ideas still require the server-assisted app.

## Engineering Notes

- Source URLs and symbols are centralized in [sources.js](./src/config/sources.js).
- The app uses server-side fetches to avoid browser CORS issues.
- Each source reports `live`, `delayed`, `unavailable`, or `error`.
- No fallback sample values are injected if a live source fails.
- To add a new source, start in `src/config/sources.js`, then add a service mapper instead of hardcoding values in the UI.

## Important Data Licensing / Terms Note

This project is production-oriented in architecture, but real exchange and quote-provider usage still depends on each source's terms, entitlements, and permitted usage.

In particular:

- NSE pages and option-chain pages include usage restrictions that should be reviewed before commercial deployment.
- Yahoo Finance data is convenient for dashboards, but it is not a licensed exchange feed replacement.

For commercial or broker-integrated deployment, replace the same service layer with licensed market data vendors while keeping the UI and signal engine intact.
