import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from "@google/genai";

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
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  } catch (e) {
    return url || '';
  }
};

export async function searchWeb(query: string) {
  const engines = [
    {
      name: 'DuckDuckGo HTML',
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
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
      url: `https://duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
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
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
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
      url: `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
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
