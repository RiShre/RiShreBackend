import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (AppleChromebook; OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const getHeaders = (url: string) => {
  const urlObj = new URL(url);
  return {
    'User-Agent': getRandomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': `https://${urlObj.hostname}/`,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  };
};

const fetchWithRetry = async (url: string, retries = 3, delay = 1500): Promise<any> => {
  const jitter = Math.floor(Math.random() * 500);
  try {
    if (retries === 3) await new Promise(resolve => setTimeout(resolve, jitter));
    return await axios.get(url, { 
      headers: getHeaders(url),
      timeout: 15000,
      validateStatus: (status) => status === 200 || status === 202
    });
  } catch (error: any) {
    const status = error.response?.status;
    const shouldRetry = (status === 429 || status === 202 || error.code === 'ECONNABORTED' || status === 403);
    if (shouldRetry && retries > 0) {
      console.warn(`Retry needed (Status: ${status || error.code}). Retrying in ${delay + jitter}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
      return fetchWithRetry(url, retries - 1, delay * 2);
    }
    throw error;
  }
};

const unwrapUrl = (url: string | undefined): string => {
  if (!url) return '';
  try {
    if (url.includes('uddg=')) {
      const parts = url.split('uddg=');
      if (parts.length > 1) {
        const encodedUrl = parts[1].split('&')[0];
        return decodeURIComponent(encodedUrl);
      }
    }
    if (url.includes('/url?q=')) {
      const parts = url.split('/url?q=');
      if (parts.length > 1) {
        const encodedUrl = parts[1].split('&')[0];
        return decodeURIComponent(encodedUrl);
      }
    }
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  } catch (e) {
    return url || '';
  }
};

function cleanQuery(query: string): string {
  if (!query) return '';
  
  let cleaned = query;
  // If system prompts are somehow prefixed to the query, strip them
  if (cleaned.includes('[System Instruction:')) {
    const parts = cleaned.split(']');
    cleaned = parts.slice(parts.length - 1).join(']');
  }
  
  // Strip conversational wrappers
  cleaned = cleaned.replace(/^(who is|what is|tell me about|search for|google search|can you search|please search for|find info on|look up|check the|information about|details on|anything about|who was|who are|what are|search web for|search the web for|find out)\s+/i, '');
  cleaned = cleaned.replace(/\s+(please|now|urgently|google|search|on the web|on google)$/i, '');
  cleaned = cleaned.trim();
  
  return cleaned || query;
}

export async function searchWeb(query: string) {
  const cleanedQuery = cleanQuery(query);
  console.log(`[RiShre Web Search] Original: "${query}" | Optimized Keywords: "${cleanedQuery}"`);

  const engines = [
    {
      name: 'Google',
      url: `https://www.google.com/search?q=${encodeURIComponent(cleanedQuery)}&hl=en`,
      parse: ($: any) => {
        const results: any[] = [];
        
        // 1. Try modern Google desktop JS layout
        $('div.g').each((i: number, el: any) => {
          const titleLink = $(el).find('a').first();
          const titleHex = $(el).find('h3');
          const snippetNode = $(el).find('div[style*="line-clamp"], .VwiC3b, .s');
          if (titleLink.length && titleHex.length) {
            const title = titleHex.text().trim();
            const rawLink = titleLink.attr('href');
            const link = unwrapUrl(rawLink);
            const snippet = snippetNode.text().trim();
            if (title && link && !link.includes('google.com/')) {
              results.push({ title, link, snippet });
            }
          }
        });

        // 2. Try standard non-JS basic HTML layout (.kCrYT & .BNeawe)
        if (results.length === 0) {
          $('.kCrYT').each((i: number, el: any) => {
            const linkNode = $(el).find('a').first();
            const rawLink = linkNode.attr('href');
            if (rawLink && rawLink.includes('/url?q=')) {
              const link = unwrapUrl(rawLink);
              const titleNode = linkNode.find('.BNeawe').first();
              const title = titleNode.text().trim();
              
              if (title && link && !link.includes('google.com/')) {
                // Find next snippet block
                const nextContainer = $(el).next('.kCrYT');
                const snippet = nextContainer.find('.BNeawe.s3v9rd').text().trim() || nextContainer.text().trim();
                results.push({ title, link, snippet: snippet.substring(0, 300) || "Visit site for details." });
              }
            }
          });
        }

        // 3. Fallback standard anchor list parsing
        if (results.length === 0) {
          $('a').each((i: number, el: any) => {
            const rawLink = $(el).attr('href');
            if (rawLink && rawLink.includes('/url?q=')) {
              const link = unwrapUrl(rawLink);
              const titleNode = $(el).find('h3, div, span').first();
              const title = titleNode.text().trim();
              if (title && link && !link.includes('google.com/')) {
                const snippet = $(el).closest('div').next().text().trim();
                results.push({ title, link, snippet: snippet.substring(0, 200) || "Visit site for details." });
              }
            }
          });
        }
        return results;
      }
    },
    {
      name: 'DuckDuckGo HTML',
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanedQuery)}`,
      parse: ($: any) => {
        const results: any[] = [];
        $('.result').each((i: number, el: any) => {
          const titleLink = $(el).find('.result__a');
          if (titleLink.length) {
            const title = titleLink.text().trim();
            const rawLink = titleLink.attr('href');
            const link = unwrapUrl(rawLink);
            const snippet = $(el).find('.result__snippet').text().trim();
            if (title && link) results.push({ title, link, snippet });
          }
        });
        return results;
      }
    },
    {
      name: 'DuckDuckGo Lite',
      url: `https://duckduckgo.com/lite/?q=${encodeURIComponent(cleanedQuery)}`,
      parse: ($: any) => {
        const results: any[] = [];
        $('table').last().find('tr').each((i: number, el: any) => {
          const titleLink = $(el).find('a.result-link');
          if (titleLink.length) {
            const title = titleLink.text().trim();
            const rawLink = titleLink.attr('href');
            const link = unwrapUrl(rawLink);
            const snippet = $(el).next().find('.result-snippet').text().trim();
            if (title && link) results.push({ title, link, snippet });
          }
        });
        return results;
      }
    },
    {
      name: 'Bing',
      url: `https://www.bing.com/search?q=${encodeURIComponent(cleanedQuery)}`,
      parse: ($: any) => {
        const results: any[] = [];
        $('.b_algo').each((i: number, el: any) => {
          const title = $(el).find('h2').text().trim();
          const link = $(el).find('h2 a').attr('href');
          const snippet = $(el).find('.b_caption p, .b_snippet').text().trim();
          if (title && link) results.push({ title, link, snippet });
        });
        return results;
      }
    },
    {
      name: 'Yahoo',
      url: `https://search.yahoo.com/search?p=${encodeURIComponent(cleanedQuery)}`,
      parse: ($: any) => {
        const results: any[] = [];
        $('.algo').each((i: number, el: any) => {
          const title = $(el).find('h3').text().trim();
          const link = $(el).find('h3 a').attr('href');
          const snippet = $(el).find('.compText, .st').text().trim();
          if (title && link) results.push({ title, link, snippet });
        });
        return results;
      }
    }
  ];

  for (const engine of engines) {
    try {
      console.log(`Trying engine: ${engine.name}`);
      const { data } = await fetchWithRetry(engine.url);
      const $ = cheerio.load(data);
      const results = engine.parse($);

      if (results.length > 0) {
        console.log(`Success with ${engine.name}: Found ${results.length} results`);
        return results.slice(0, 15);
      }
    } catch (error: any) {
      console.error(`Engine ${engine.name} failed:`, error.message);
    }
  }

  return [];
}
