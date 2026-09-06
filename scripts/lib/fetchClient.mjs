import fs from 'fs';

// Load .env if present and environment variables are not yet loaded
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {}
} else if (fs.existsSync('.env')) {
  try {
    const envContent = fs.readFileSync('.env', 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] || '').trim().replace(/^["'](.*)["']$/, '$1');
      }
    }
  } catch {}
}

/**
 * Universal Scraper & Proxy Client for Government Datasets
 * Supports automated cascading fallback:
 * 1. ZenRows (ZENROWS_API_KEY or SCRAPER_API_KEY)
 * 2. ScrapingBee (SCRAPINGBEE_API_KEY)
 * 3. ScraperAPI (SCRAPERAPI_KEY)
 * 4. Direct Browser Impersonation (Default fallback)
 */

export async function fetchWithBypass(targetUrl, options = {}) {
  const {
    isJson = false,
    renderJs = true,
    headers = {},
    timeout = 35000
  } = options;

  const zenrowsKey = process.env.ZENROWS_API_KEY || process.env.SCRAPER_API_KEY;
  const scrapingbeeKey = process.env.SCRAPINGBEE_API_KEY;
  const scraperApiKey = process.env.SCRAPERAPI_KEY;

  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': isJson ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers
  };

  // Build candidate provider list based on available keys
  const providers = [];

  if (zenrowsKey) {
    const encoded = encodeURIComponent(targetUrl);
    let url = `https://api.zenrows.com/v1/?apikey=${zenrowsKey}&url=${encoded}&js_render=${renderJs}&antibot=true`;
    if (isJson) url += '&json_response=true';
    providers.push({ name: 'ZenRows', url, headers: baseHeaders });
  }

  if (scrapingbeeKey) {
    const encoded = encodeURIComponent(targetUrl);
    const url = `https://app.scrapingbee.com/api/v1/?api_key=${scrapingbeeKey}&url=${encoded}&render_js=${renderJs}&premium_proxy=true`;
    providers.push({ name: 'ScrapingBee', url, headers: baseHeaders });
  }

  if (scraperApiKey) {
    const encoded = encodeURIComponent(targetUrl);
    const url = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encoded}&render=${renderJs}`;
    providers.push({ name: 'ScraperAPI', url, headers: baseHeaders });
  }

  // Direct fetch fallback
  providers.push({ name: 'DirectFetch', url: targetUrl, headers: baseHeaders });

  let lastError = null;

  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(provider.url, {
        headers: provider.headers,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} (${res.statusText}) via ${provider.name}`);
      }

      if (isJson) {
        return await res.json();
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // If provider failed (e.g. out of credits or 403) and we have more providers, continue
      if (providers.indexOf(provider) < providers.length - 1) {
        continue;
      }
    }
  }

  throw lastError || new Error(`All fetch attempts failed for ${targetUrl}`);
}
