export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

const MAX_RESULTS = 5;

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// DuckDuckGo wraps outbound links as //duckduckgo.com/l/?uddg=<encoded-url>
function resolveUrl(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ?? u.toString();
  } catch {
    return href;
  }
}

export async function webSearch(query: string): Promise<WebSearchResult[]> {
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; learnEasyBot/1.0)" },
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    const links = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];

    const results: WebSearchResult[] = [];
    for (let i = 0; i < links.length && results.length < MAX_RESULTS; i++) {
      results.push({
        title: stripTags(links[i][2]),
        snippet: snippets[i] ? stripTags(snippets[i][1]) : "",
        url: resolveUrl(links[i][1]),
      });
    }
    return results;
  } catch {
    return [];
  }
}
