import * as logger from "./logger";

// Mobile User-Agent to force simple HTML from Bing
const USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
];

function getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export interface SearchResult {
    title: string;
    link: string;
    snippet: string;
    source: "Bing" | "Wikipedia";
}

const SEARCH_TIMEOUT = 10000; // 10 second timeout

/**
 * Search the web using multiple providers for reliability.
 * Combines results from Bing and Wikipedia.
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
    logger.info(`🔍 Combined search: "${query}"`);

    // Run Bing and Wikipedia in parallel
    const [bingResults, wikiResults] = await Promise.allSettled([
        searchBing(query),
        searchWikipedia(query)
    ]);

    let finalResults: SearchResult[] = [];

    // Process Bing Results
    if (bingResults.status === "fulfilled") {
        finalResults.push(...bingResults.value);
    } else {
        logger.error(`🔍 Bing search failed: ${bingResults.reason}`);
    }

    // Process Wikipedia Results
    if (wikiResults.status === "fulfilled") {
        finalResults.push(...wikiResults.value);
    } else {
        logger.error(`🔍 Wikipedia search failed: ${wikiResults.reason}`);
    }

    // Deduplicate by link
    const seenLinks = new Set<string>();
    const uniqueResults = finalResults.filter(r => {
        if (seenLinks.has(r.link)) return false;
        seenLinks.add(r.link);
        return true;
    });

    if (uniqueResults.length === 0) {
        logger.warn("🔍 No results found from any source.");
        return [];
    }

    // Cap results to reduce context size for AI (top 5 most relevant)
    const MAX_RESULTS = 5;
    const cappedResults = uniqueResults.slice(0, MAX_RESULTS);

    logger.info(`🔍 Found ${uniqueResults.length} unique results, using top ${cappedResults.length}.`);
    return cappedResults;
}

async function searchBing(query: string): Promise<SearchResult[]> {
    try {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": getRandomUserAgent(),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
            },
            signal: AbortSignal.timeout(SEARCH_TIMEOUT),
        });

        if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);

        const html = await response.text();
        const results: SearchResult[] = [];

        // Regex to find list items (more robust for attributes)
        // Matches <li class="b_algo" ... > ... </li>
        const resultLoop = /<li class="b_algo"[^>]*>(.*?)<\/li>/g;
        let match;

        while ((match = resultLoop.exec(html)) !== null) {
            const innerHtml = match[1];

            // Extract Title & Link
            // Look for <h2>...<a href="...">Title</a>...</h2>
            const titleMatch = /<h2[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<\/h2>/s.exec(innerHtml) ||
                /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s.exec(innerHtml);

            if (!titleMatch) continue;

            const link = titleMatch[1];
            let title = stripHtml(titleMatch[2]);

            // Extract Snippet (Paragraph)
            // Look for <p>...</p> or <div class="b_caption">...</div>
            const snippetMatch = /<p[^>]*>(.*?)<\/p>/s.exec(innerHtml) ||
                /<div class="b_caption"[^>]*>(.*?)<\/div>/s.exec(innerHtml);
            let snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "No description available.";

            results.push({ title, link, snippet, source: "Bing" });
        }

        logger.info(`🔍 Bing returned ${results.length} results`);
        return results;

    } catch (e) {
        logger.error(`🔍 Bing Error: ${e}`);
        return [];
    }
}

async function searchWikipedia(query: string): Promise<SearchResult[]> {
    try {
        const url = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.search) {
            const results = data.query.search.map((item: any) => ({
                title: item.title,
                link: `https://id.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
                snippet: stripHtml(item.snippet),
                source: "Wikipedia"
            }));
            logger.info(`🔍 Wikipedia returned ${results.length} results`);
            return results;
        }
        return [];
    } catch (e) {
        logger.error(`🔍 Wikipedia Error: ${e}`);
        return [];
    }
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Format search results into context text for the AI model
 */
export function formatResultsAsContext(results: SearchResult[]): string {
    if (results.length === 0) return "";

    let context = "\n\n--- Web Search Results (Real-time from Internet) ---\n";
    results.forEach((r, i) => {
        context += `\n[${i + 1}] ${r.title}`;
        context += `\nSource: ${r.source} (${r.link})`;
        context += `\nSnippet: ${r.snippet}\n`;
    });
    context += "\n--- End of Search Results ---\n";
    return context;
}
