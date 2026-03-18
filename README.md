# TradeDecisionOptionsMarketTools

This repository hosts the `market-pulse` app in a subfolder and publishes its browser-only static dashboard to GitHub Pages with a GitHub Actions workflow.

## GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, open **Pages** and set the source to **GitHub Actions**.
3. Push to `main` or run the **Deploy GitHub Pages** workflow manually.

The workflow in [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) will:

- install dependencies in `market-pulse`
- run `npm run export:pages`
- publish `market-pulse/docs` to GitHub Pages

## Local Development

```bash
cd market-pulse
npm install
npm start
```

The app-specific documentation lives in [`market-pulse/README.md`](./market-pulse/README.md).
