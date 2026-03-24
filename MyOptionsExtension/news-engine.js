(function (global) {
    "use strict";

    const Utils = global.OptionsAssistantUtils;

    const DEFAULT_FEEDS = [
        {
            key: "google-markets",
            name: "Google News Markets",
            url: "https://news.google.com/rss/search?q=(nifty%20OR%20banknifty%20OR%20sensex%20OR%20indian%20stock%20market)%20when:1d&hl=en-IN&gl=IN&ceid=IN:en"
        },
        {
            key: "google-macro",
            name: "Google News Macro",
            url: "https://news.google.com/rss/search?q=(inflation%20OR%20interest%20rate%20OR%20fed%20OR%20crude%20oil%20OR%20war%20OR%20recession)%20(india%20market)%20when:1d&hl=en-IN&gl=IN&ceid=IN:en"
        },
        {
            key: "google-flows",
            name: "Google News Flows",
            url: "https://news.google.com/rss/search?q=(fii%20OR%20dii%20OR%20earnings%20OR%20india%20vix)%20(stock%20market)%20when:1d&hl=en-IN&gl=IN&ceid=IN:en"
        }
    ];

    const BULLISH_PATTERNS = [
        { pattern: /\bgrowth\b/gi, weight: 2, keyword: "growth" },
        { pattern: /\brally\b/gi, weight: 3, keyword: "rally" },
        { pattern: /\bstrong\b/gi, weight: 2, keyword: "strong" },
        { pattern: /\bbreakout\b/gi, weight: 3, keyword: "breakout" },
        { pattern: /\bupgrade\b/gi, weight: 2, keyword: "upgrade" },
        { pattern: /\bbeats?\b/gi, weight: 2, keyword: "earnings" },
        { pattern: /\bearnings\b/gi, weight: 2, keyword: "earnings" },
        { pattern: /\bfii\b.{0,18}\b(buying|inflow|support)\b/gi, weight: 3, keyword: "fii" },
        { pattern: /\bdii\b.{0,18}\b(buying|inflow|support)\b/gi, weight: 2, keyword: "dii" }
    ];

    const BEARISH_PATTERNS = [
        { pattern: /\bcrash\b/gi, weight: 4, keyword: "crash" },
        { pattern: /\bfall\b/gi, weight: 3, keyword: "fall" },
        { pattern: /\brisk\b/gi, weight: 2, keyword: "risk" },
        { pattern: /\binflation\b/gi, weight: 3, keyword: "inflation" },
        { pattern: /\binterest rates?\b/gi, weight: 3, keyword: "interest rate" },
        { pattern: /\bcrude oil\b/gi, weight: 2, keyword: "crude oil" },
        { pattern: /\bwar\b/gi, weight: 4, keyword: "war" },
        { pattern: /\bfed\b/gi, weight: 2, keyword: "fed" },
        { pattern: /\brecession\b/gi, weight: 4, keyword: "recession" },
        { pattern: /\bfii\b.{0,18}\b(selling|outflow|cut)\b/gi, weight: 3, keyword: "fii" },
        { pattern: /\bdii\b.{0,18}\b(selling|outflow|cut)\b/gi, weight: 2, keyword: "dii" },
        { pattern: /\bdowngrade\b/gi, weight: 2, keyword: "earnings" }
    ];

    const TRACKED_KEYWORDS = [
        "inflation",
        "interest rate",
        "crude oil",
        "war",
        "fed",
        "recession",
        "earnings",
        "fii",
        "dii",
        "growth",
        "rally",
        "strong",
        "breakout",
        "crash",
        "fall",
        "risk"
    ];

    async function fetchLatestNews(settings) {
        const sourceStatuses = [];
        let headlines = [];

        for (let index = 0; index < DEFAULT_FEEDS.length; index += 1) {
            const feed = DEFAULT_FEEDS[index];
            try {
                const xml = await fetchFeed(feed.url);
                const parsed = parseRss(xml, feed.name);
                headlines = headlines.concat(parsed.slice(0, 8));
                sourceStatuses.push({
                    source: feed.name,
                    status: "ok",
                    count: parsed.length
                });
            } catch (error) {
                sourceStatuses.push({
                    source: feed.name,
                    status: "error",
                    message: error instanceof Error ? error.message : String(error)
                });
            }
        }

        const uniqueHeadlines = dedupeHeadlines(headlines).slice(0, 15);
        if (!uniqueHeadlines.length) {
            return Object.assign(Utils.createEmptyNewsSentiment(), {
                fetchedAt: new Date().toISOString(),
                sourceStatuses: sourceStatuses,
                summary: "No major news detected."
            });
        }

        const scored = uniqueHeadlines.map(scoreHeadline);
        const totals = scored.reduce((accumulator, item) => {
            accumulator.bullishScore += item.bullishScore;
            accumulator.bearishScore += item.bearishScore;
            accumulator.keywords.push(...item.keywords);
            return accumulator;
        }, {
            bullishScore: 0,
            bearishScore: 0,
            keywords: []
        });

        const sentiment = resolveSentiment(totals.bullishScore, totals.bearishScore);
        const confidence = resolveConfidence(totals.bullishScore, totals.bearishScore, scored.length);
        const topNews = scored
            .slice()
            .sort((left, right) => right.impactScore - left.impactScore)
            .slice(0, 5)
            .map((item) => ({
                title: item.title,
                source: item.source,
                sentiment: item.sentiment,
                impact: item.impact,
                link: item.link,
                publishedAt: item.publishedAt
            }));

        return {
            sentiment: sentiment,
            confidence: confidence,
            summary: buildSummary(sentiment, totals, topNews),
            topNews: topNews,
            bullishScore: totals.bullishScore,
            bearishScore: totals.bearishScore,
            keywords: Utils.dedupeStrings(
                totals.keywords.filter((keyword) => TRACKED_KEYWORDS.includes(keyword))
            ).slice(0, 8),
            fetchedAt: new Date().toISOString(),
            stale: false,
            sourceStatuses: sourceStatuses
        };
    }

    function isCacheFresh(newsState, settings) {
        if (!newsState || !newsState.fetchedAt) {
            return false;
        }
        const ttlMinutes = Utils.toNumber(settings && settings.newsCacheMinutes) || Utils.toNumber(settings && settings.newsRefreshMinutes) || 7;
        const ageMs = Date.now() - new Date(newsState.fetchedAt).getTime();
        return ageMs >= 0 && ageMs <= (ttlMinutes * 60 * 1000);
    }

    async function refreshNewsWithCache(existingNewsState, settings, options) {
        const cached = existingNewsState || Utils.createEmptyNewsSentiment();
        const config = settings || Utils.DEFAULT_SETTINGS;
        const forceRefresh = Boolean(options && options.forceRefresh);

        if (config.enableNewsEngine === false || config.newsEnabled === false) {
            return Object.assign(Utils.createEmptyNewsSentiment(), {
                summary: "News engine is disabled in settings."
            });
        }

        if (!forceRefresh && isCacheFresh(cached, config)) {
            return Object.assign({}, cached, { stale: false });
        }

        try {
            return await fetchLatestNews(config);
        } catch (error) {
            if (cached && cached.fetchedAt) {
                return Object.assign({}, cached, {
                    stale: true,
                    summary: `${cached.summary} Using cached headlines because refresh failed.`
                });
            }
            return Object.assign(Utils.createEmptyNewsSentiment(), {
                fetchedAt: new Date().toISOString(),
                stale: true,
                summary: "No major news detected."
            });
        }
    }

    async function fetchFeed(url) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        let timeoutId = null;

        if (controller) {
            timeoutId = setTimeout(() => controller.abort(), 8000);
        }

        try {
            const response = await fetch(url, {
                method: "GET",
                cache: "no-store",
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) {
                throw new Error(`Feed returned ${response.status}`);
            }
            return await response.text();
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    function parseRss(xml, fallbackSource) {
        const items = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
        return items.map((item) => ({
            title: cleanupHeadline(extractTag(item, "title")),
            link: decodeXmlEntities(extractTag(item, "link")),
            publishedAt: decodeXmlEntities(extractTag(item, "pubDate")),
            source: cleanupHeadline(extractSource(item) || fallbackSource)
        })).filter((item) => item.title);
    }

    function scoreHeadline(item) {
        const title = String(item && item.title || "");
        const lower = title.toLowerCase();
        const keywords = [];
        let bullishScore = 0;
        let bearishScore = 0;

        BULLISH_PATTERNS.forEach((entry) => {
            const matches = lower.match(entry.pattern);
            if (matches && matches.length) {
                bullishScore += entry.weight * matches.length;
                keywords.push(entry.keyword);
            }
        });

        BEARISH_PATTERNS.forEach((entry) => {
            const matches = lower.match(entry.pattern);
            if (matches && matches.length) {
                bearishScore += entry.weight * matches.length;
                keywords.push(entry.keyword);
            }
        });

        if (/interest rate/.test(lower) && /\bcut\b/.test(lower)) {
            bullishScore += 2;
            keywords.push("interest rate");
        }

        if (/crude oil/.test(lower) && /\b(up|surge|spike)\b/.test(lower)) {
            bearishScore += 2;
            keywords.push("crude oil");
        }

        if (/earnings/.test(lower) && /\bmiss|weak|cut\b/.test(lower)) {
            bearishScore += 2;
            keywords.push("earnings");
        }

        return Object.assign({}, item, {
            bullishScore: bullishScore,
            bearishScore: bearishScore,
            impactScore: Math.abs(bullishScore - bearishScore) + bullishScore + bearishScore,
            keywords: Utils.dedupeStrings(keywords),
            sentiment: resolveHeadlineSentiment(bullishScore, bearishScore),
            impact: resolveImpact(Math.abs(bullishScore - bearishScore) + bullishScore + bearishScore)
        });
    }

    function resolveImpact(score) {
        if (!Number.isFinite(score)) {
            return "LOW";
        }
        if (score >= 8) {
            return "HIGH";
        }
        if (score >= 4) {
            return "MEDIUM";
        }
        return "LOW";
    }

    function resolveHeadlineSentiment(bullishScore, bearishScore) {
        if (bullishScore > bearishScore) {
            return "BULLISH";
        }
        if (bearishScore > bullishScore) {
            return "BEARISH";
        }
        return "NEUTRAL";
    }

    function resolveSentiment(bullishScore, bearishScore) {
        if (bullishScore - bearishScore >= 3) {
            return "BULLISH";
        }
        if (bearishScore - bullishScore >= 3) {
            return "BEARISH";
        }
        return "NEUTRAL";
    }

    function resolveConfidence(bullishScore, bearishScore, headlineCount) {
        const gap = Math.abs(bullishScore - bearishScore);
        return Utils.clamp(Math.round((gap * 8) + (headlineCount * 3)), 0, 100);
    }

    function buildSummary(sentiment, totals, topNews) {
        const leadKeyword = totals.keywords && totals.keywords.length ? Utils.dedupeStrings(totals.keywords)[0] : null;
        const leadSource = topNews && topNews.length ? topNews[0].source : "market headlines";

        if (sentiment === "BULLISH") {
            return `Market sentiment looks slightly bullish, with ${leadKeyword || "positive cues"} showing up across ${leadSource}.`;
        }
        if (sentiment === "BEARISH") {
            return `Market sentiment looks slightly bearish due to ${leadKeyword || "risk cues"} showing up across ${leadSource}.`;
        }
        return "No major directional news edge is visible right now.";
    }

    function dedupeHeadlines(items) {
        const seen = {};
        return (items || []).filter((item) => {
            const key = String(item && item.title || "").trim().toLowerCase();
            if (!key || seen[key]) {
                return false;
            }
            seen[key] = true;
            return true;
        });
    }

    function extractTag(block, tagName) {
        const match = String(block || "").match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
        return match ? decodeXmlEntities(match[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : "";
    }

    function extractSource(block) {
        const match = String(block || "").match(/<source(?:\s+[^>]*)?>([\s\S]*?)<\/source>/i);
        return match ? decodeXmlEntities(match[1]) : "";
    }

    function cleanupHeadline(value) {
        return decodeXmlEntities(String(value || "").replace(/\s+-\s+[^-]+$/, "").trim());
    }

    function decodeXmlEntities(value) {
        return String(value || "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#8217;/g, "'");
    }

    global.OptionsNewsEngine = {
        DEFAULT_FEEDS: DEFAULT_FEEDS,
        fetchLatestNews: fetchLatestNews,
        isCacheFresh: isCacheFresh,
        refreshNewsWithCache: refreshNewsWithCache
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
