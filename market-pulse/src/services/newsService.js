const { XMLParser } = require("fast-xml-parser");
const { NEWS_FEEDS, SOURCE_LABELS, SOURCE_LINKS } = require("../config/sources");
const { fetchText, normalizeError } = require("../utils/http");
const { createSourceStatus } = require("../utils/formatters");

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true
});

function ensureArray(value) {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function cleanTitle(rawTitle) {
    return String(rawTitle || "").replace(/\s+/g, " ").trim();
}

function splitGoogleNewsTitle(rawTitle) {
    const title = cleanTitle(rawTitle);
    const parts = title.split(" - ");
    if (parts.length < 2) {
        return {
            title,
            source: "Unknown"
        };
    }

    return {
        title: parts.slice(0, -1).join(" - "),
        source: parts[parts.length - 1]
    };
}

function parseFeedItems(xmlText, category) {
    const parsed = parser.parse(xmlText);
    const items = ensureArray(parsed?.rss?.channel?.item);
    const seen = new Set();

    return items
        .map((item) => {
            const split = splitGoogleNewsTitle(item.title);
            const dedupeKey = `${split.title}::${item.pubDate || ""}`;
            if (seen.has(dedupeKey)) {
                return null;
            }
            seen.add(dedupeKey);

            return {
                id: item.guid?.["#text"] || item.guid || item.link || dedupeKey,
                title: split.title,
                source: split.source,
                link: item.link,
                publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
                category
            };
        })
        .filter(Boolean)
        .slice(0, 8);
}

async function fetchSingleFeed(feedDefinition, category) {
    try {
        const { data } = await fetchText(feedDefinition.url, {
            headers: {
                accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
                referer: "https://news.google.com/"
            }
        });

        const items = parseFeedItems(data, category);
        const lastUpdated = items[0]?.publishedAt || null;

        return {
            items,
            status: createSourceStatus(
                feedDefinition.key,
                SOURCE_LABELS[feedDefinition.key],
                items.length ? "live" : "unavailable",
                items.length ? "News feed fetched successfully." : "News feed returned no items.",
                lastUpdated,
                feedDefinition.source,
                SOURCE_LINKS[feedDefinition.key]
            )
        };
    } catch (error) {
        return {
            items: [],
            status: createSourceStatus(
                feedDefinition.key,
                SOURCE_LABELS[feedDefinition.key],
                "error",
                normalizeError(error),
                null,
                feedDefinition.source,
                SOURCE_LINKS[feedDefinition.key]
            )
        };
    }
}

async function fetchNewsData() {
    const [india, us, macro] = await Promise.all([
        fetchSingleFeed(NEWS_FEEDS.india, "india"),
        fetchSingleFeed(NEWS_FEEDS.us, "us"),
        fetchSingleFeed(NEWS_FEEDS.macro, "macro")
    ]);

    return {
        buckets: {
            india: india.items,
            us: us.items,
            macro: macro.items
        },
        sourceStatuses: [india.status, us.status, macro.status]
    };
}

module.exports = {
    fetchNewsData
};
